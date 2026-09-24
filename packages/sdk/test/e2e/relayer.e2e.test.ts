// End-to-end tests for the gasless relayer (server/): the Express app runs against the local nitro
// devnode and is driven over HTTP, the way the web app uses it. Test names follow docs/PRD.md §7c.
//
//   scripts/deploy.sh local && pnpm --filter @verakey/sdk test:e2e
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ActionKind, VeraKeyProver, ZERO_HASH, appIdFromName, computeNullifier, erc20Abi } from "../../src";
import { USDG, VirtualPasskey, authorize, deployment, fieldHex, publicClient, type Owner } from "./harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const appId = appIdFromName("relayer-e2e");
const recipient = privateKeyToAccount(generatePrivateKey()).address;

let server: ChildProcess;
let serverLog = "";
let baseUrl: string;
let dataDir: string;
let prover: VeraKeyProver;
let owner: Owner;
let account: Address;
let relayerAddress: Address;
let fee: bigint;

/**
 * Calls the relayer API as the client `ip`. The server trusts one proxy hop, so behind a hosting
 * provider's router (and in these tests) the caller's address is the last X-Forwarded-For entry.
 */
async function api(ip: string, method: "GET" | "POST", route: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: body === undefined ? undefined : JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
      .once("error", reject)
      .listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
  });
}

/** A `pay` relay request with a real proof over `signedFee`. */
async function payRequest(amount: bigint, signedFee: bigint) {
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 300n;
  const auth = await authorize(prover, owner, appId, account, {
    kind: ActionKind.Pay, target: recipient, amount, dataHash: ZERO_HASH, fee: signedFee, deadline,
  });
  return {
    account,
    functionName: "pay",
    args: [recipient, amount, signedFee, deadline, fieldHex(owner.nullifier), auth.clientDataJSON, auth.proof] as unknown[],
  };
}

const pendingNonce = () => publicClient.getTransactionCount({ address: relayerAddress, blockTag: "pending" });
const usdgBalance = (who: Address) =>
  publicClient.readContract({ address: deployment.contracts.usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), "verakey-relayer-"));
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, VERAKEY_NETWORK: "local", PORT: String(port), VERAKEY_DATA_DIR: dataDir, ACCOUNTS_PER_IP_PER_DAY: "3" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", chunk => (serverLog += chunk));
  server.stderr!.on("data", chunk => (serverLog += chunk));
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(`${baseUrl}/api/health`).then(r => r.ok, () => false);
    if (ready) break;
    if (attempt > 150 || server.exitCode !== null) throw new Error(`relayer did not start:\n${serverLog}`);
    await new Promise(r => setTimeout(r, 200));
  }

  const config = await api("10.0.0.100", "GET", "/config");
  relayerAddress = config.body.relayer.address;
  fee = BigInt(config.body.relayer.fee);

  prover = await VeraKeyProver.create({ threads: 8 });
  const passkey = await VirtualPasskey.create();
  owner = { passkey, nullifier: await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, appId) };

  const created = await api("10.0.0.100", "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(owner.nullifier) });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  account = created.body.account;
  await publicClient.waitForTransactionReceipt({ hash: created.body.hash as Hex });

  const funded = await api("10.0.0.100", "POST", "/faucet", { account });
  expect(funded.status, JSON.stringify(funded.body)).toBe(200);
  await publicClient.waitForTransactionReceipt({ hash: funded.body.hash as Hex });
});

afterAll(async () => {
  server?.kill();
  await prover?.destroy();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("relayer", () => {
  it("relayed_payment_pays_the_relayer_fee", async () => {
    const relayerBefore = await usdgBalance(relayerAddress);
    const sent = await api("10.0.0.1", "POST", "/relay", await payRequest(USDG(1), fee));
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: sent.body.hash });
    expect(receipt.status).toBe("success");
    expect(await usdgBalance(recipient)).toBe(USDG(1));
    expect(await usdgBalance(relayerAddress)).toBe(relayerBefore + fee);
  });

  it("invalid_proof_not_broadcast", async () => {
    const request = await payRequest(USDG(1), fee);
    const proof = Buffer.from((request.args[6] as Hex).slice(2), "hex");
    proof[200] ^= 1;
    request.args[6] = `0x${proof.toString("hex")}`;
    const nonce = await pendingNonce();
    const response = await api("10.0.0.2", "POST", "/relay", request);
    expect(response.status).toBe(422);
    expect(response.body.revert).toBe("InvalidProof");
    expect(await pendingNonce()).toBe(nonce);
  });

  it("underpaid_fee_not_relayed", async () => {
    const nonce = await pendingNonce();
    const response = await api("10.0.0.3", "POST", "/relay", await payRequest(USDG(1), fee - 1n));
    expect(response.status).toBe(402);
    expect(await pendingNonce()).toBe(nonce);
  });

  it("look_alike_contract_not_relayed", async () => {
    // A contract that is not a clone of this deployment's account implementation (here the token) is
    // refused before any simulation, so it cannot make the relayer burn gas.
    const request = { ...(await payRequest(USDG(1), fee)), account: deployment.contracts.usdg };
    const nonce = await pendingNonce();
    const response = await api("10.0.0.8", "POST", "/relay", request);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Not a VeraKey account.");
    expect(await pendingNonce()).toBe(nonce);
  });

  it("new_accounts_are_rate_limited_per_visitor", async () => {
    const create = () =>
      api("10.0.0.7", "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(BigInt(generatePrivateKey()) % 2n ** 250n) });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await create()).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    // The limit follows the visitor, not the nullifier they choose.
    expect((await api("10.0.0.9", "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(12345n) })).status).toBe(200);
  });

  it("faucet_funds_each_account_once", async () => {
    const again = await api("10.0.0.4", "POST", "/faucet", { account });
    expect(again.status).toBe(409);
  });

  it("rate_limit_returns_429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await api("10.0.0.5", "GET", "/config")).status);
    expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await api("10.0.0.6", "GET", "/config")).status).toBe(200);
  });
});
