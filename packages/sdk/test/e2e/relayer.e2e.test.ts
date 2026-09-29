// End-to-end tests for the gasless relayer (server/): the Express app runs against the local nitro
// devnode and is driven over HTTP, the way the web app uses it. Test names follow docs/PRD.md §7c.
//
//   scripts/deploy.sh local && pnpm --filter @verakey/sdk test:e2e
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ActionKind, VeraKeyProver, ZERO_HASH, appIdFromName, changeDataHash, changePayload, computeNullifier, erc20Abi, veraKeyAccountAbi } from "../../src";
import { USDG, VirtualPasskey, authorize, deployment, fieldHex, publicClient, type Owner } from "./harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const appId = appIdFromName("relayer-e2e");
const recipient = privateKeyToAccount(generatePrivateKey()).address;

let baseUrl: string;
let prover: VeraKeyProver;
let owner: Owner;
let account: Address;
let relayerAddress: Address;
let fee: bigint;

/**
 * Calls the relayer API as the client `ip`. The server trusts one proxy hop, so behind a hosting
 * provider's router (and in these tests) the caller's address is the last X-Forwarded-For entry.
 */
async function api(ip: string, method: "GET" | "POST", route: string, body?: unknown, base = baseUrl) {
  const response = await fetch(`${base}/api${route}`, {
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

/**
 * Starts the relayer against the local devnode with `env` and its data in `dir`; resolves once it answers. `stop(true)`
 * keeps the data, for a restart.
 */
async function startRelayer(
  env: Record<string, string>,
  dir = mkdtempSync(path.join(tmpdir(), "verakey-relayer-"))
): Promise<{ url: string; stop: (keepData?: boolean) => void }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, VERAKEY_NETWORK: "local", PORT: String(port), VERAKEY_DATA_DIR: dir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", chunk => (log += chunk));
  child.stderr!.on("data", chunk => (log += chunk));
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(`${url}/api/health`).then(r => r.ok, () => false);
    if (ready) break;
    if (attempt > 150 || child.exitCode !== null) throw new Error(`relayer did not start:\n${log}`);
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    url,
    stop: (keepData = false) => {
      child.kill();
      if (!keepData) rmSync(dir, { recursive: true, force: true });
    },
  };
}

let stopRelayer: () => void = () => {};

beforeAll(async () => {
  const started = await startRelayer({ ACCOUNTS_PER_IP_PER_DAY: "3", UNPAID_SAFETY_ACTIONS_PER_ACCOUNT_PER_DAY: "1" });
  baseUrl = started.url;
  stopRelayer = started.stop;

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
  stopRelayer();
  await prover?.destroy();
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

describe("relayer: Sign in with VeraKey", () => {
  it("GET /api/config carries the factory's configuration hash", async () => {
    const { status, body } = await api("10.0.2.1", "GET", "/config");
    expect(status).toBe(200);
    expect(body.configHash).toBe((deployment as unknown as { configHash: string }).configHash);
  });

  it("isolates every page, and the /connect popup without cutting it off from its opener", async () => {
    const page = await fetch(`${baseUrl}/`);
    expect(page.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(page.headers.get("document-isolation-policy")).toBeNull();
    const popup = await fetch(`${baseUrl}/connect`);
    expect(popup.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(popup.headers.get("cross-origin-embedder-policy")).toBeNull();
    expect(popup.headers.get("document-isolation-policy")).toBe("isolate-and-require-corp");
  });
});

/** A nullifier no earlier run has used: accounts persist on the devnode, and an existing one is never deployed again. */
const freshNullifier = () => BigInt(generatePrivateKey()) % 2n ** 250n;

type Relayed = "pay" | "scheduleChange" | "restrict" | "cancelChange";

/** A new account with its own passkey, created and funded through the relayer at `base`, and a way to act on it. */
async function newAccount(tag: string, ip: string, base = baseUrl) {
  const ownApp = appIdFromName(`relayer-e2e-${tag}-${Date.now()}`);
  const passkey = await VirtualPasskey.create();
  const me: Owner = { passkey, nullifier: await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, ownApp) };
  const created = await api(ip, "POST", "/accounts", { appId: fieldHex(ownApp), nullifier: fieldHex(me.nullifier) }, base);
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  await publicClient.waitForTransactionReceipt({ hash: created.body.hash as Hex });
  const mine = created.body.account as Address;
  const funded = await api(ip, "POST", "/faucet", { account: mine }, base);
  expect(funded.status, JSON.stringify(funded.body)).toBe(200);
  await publicClient.waitForTransactionReceipt({ hash: funded.body.hash as Hex });
  /** A relay request for `functionName`, approved with this account's passkey and the relayer's fee. */
  const request = async (functionName: Relayed, opts: { to?: Address; amount?: bigint; change?: { kind: number; payload: Hex }; changeId?: Hex } = {}) => {
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 300n;
    const kind = { pay: ActionKind.Pay, scheduleChange: ActionKind.ScheduleChange, restrict: ActionKind.Restrict, cancelChange: ActionKind.CancelChange }[functionName];
    const target = opts.to ?? "0x0000000000000000000000000000000000000000";
    const amount = opts.amount ?? 0n;
    const dataHash = opts.change ? changeDataHash(opts.change.kind as never, opts.change.payload) : (opts.changeId ?? ZERO_HASH);
    const auth = await authorize(prover, me, ownApp, mine, { kind, target, amount, dataHash, fee, deadline });
    const tail = [fee, deadline, fieldHex(me.nullifier), auth.clientDataJSON, auth.proof];
    const args =
      functionName === "pay" ? [target, amount, ...tail]
      : functionName === "cancelChange" ? [opts.changeId!, ...tail]
      : [opts.change!.kind, opts.change!.payload, ...tail];
    return { account: mine, functionName, args: args as unknown[] };
  };
  return { mine, request };
}

/** Relays `body` as the visitor `ip`, and waits for its transaction when the relayer sent one. */
async function relayed(ip: string, body: unknown, base = baseUrl) {
  const response = await api(ip, "POST", "/relay", body, base);
  if (response.status === 200) await publicClient.waitForTransactionReceipt({ hash: response.body.hash as Hex });
  return response;
}

// Regression tests for the whole-system audit of 2026-09-29 (NM2-002, NM2-003, NM2-001's relayer side, I-3).
describe("relayer: abuse limits (audit 2026-09-29)", () => {
  it("the faucet pays each account once, even to concurrent requests (NM2-003)", async () => {
    const created = await api("10.0.3.1", "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(freshNullifier()) });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    await publicClient.waitForTransactionReceipt({ hash: created.body.hash as Hex });
    const target = created.body.account as Address;
    const responses = await Promise.all([1, 2, 3].map(i => api(`10.0.3.${10 + i}`, "POST", "/faucet", { account: target })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409, 409]);
    await publicClient.waitForTransactionReceipt({ hash: responses.find(r => r.status === 200)!.body.hash as Hex });
    expect(await usdgBalance(target)).toBe(USDG(5));
  });

  it("every address of one IPv6 /64 shares a visitor's limits (NM2-002)", async () => {
    const create = (i: number) =>
      api(`2001:db8:77:1::${i.toString(16)}`, "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(freshNullifier()) });
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++) statuses.push((await create(i)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    // Another /64 is another visitor.
    expect((await api("2001:db8:77:2::1", "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(freshNullifier()) })).status).toBe(200);
  });

  it("the JSON-RPC proxy refuses large batches and unbounded log queries", async () => {
    const call = (id: number) => ({ jsonrpc: "2.0", id, method: "eth_blockNumber", params: [] });
    const rpc = (body: unknown, ip: string) =>
      fetch(`${baseUrl}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
    expect((await rpc(Array.from({ length: 10 }, (_, i) => call(i)), "10.0.4.1")).status).toBe(200);
    expect((await rpc(Array.from({ length: 11 }, (_, i) => call(i)), "10.0.4.1")).status).toBe(400);
    const logs = (filter: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [filter] });
    expect((await rpc(logs({ fromBlock: "0x0", toBlock: "latest" }), "10.0.4.2")).status).toBe(400);
    expect((await rpc(logs({ address: account, fromBlock: "0x0", toBlock: "0x30d41" }), "10.0.4.2")).status).toBe(400);
    expect((await rpc(logs({ address: account, fromBlock: "0x1", toBlock: "0x100" }), "10.0.4.2")).status).toBe(200);
  });

  it("concurrent copies of one relay request reach the chain once (I-3)", async () => {
    const request = await payRequest(USDG(0.1), fee);
    const nonce = await pendingNonce();
    const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => api(`10.0.5.${i + 1}`, "POST", "/relay", request)));
    const statuses = responses.map(r => r.status);
    expect(statuses.filter(s => s === 200)).toHaveLength(1);
    expect(statuses.every(s => s === 200 || s === 409 || s === 422)).toBe(true);
    await publicClient.waitForTransactionReceipt({ hash: responses.find(r => r.status === 200)!.body.hash as Hex });
    expect(await pendingNonce()).toBe(nonce + 1);
  });

  it("past the day's cap, junk costs an account nothing, changes that do nothing are limited, and freezing and cancelling always go through (NM2-001)", async () => {
    const { mine, request } = await newAccount("safety", "10.0.6.1");
    const maxFee = BigInt(deployment.policy.maxFee!);
    const ok = (response: { status: number; body: Record<string, any> }) => expect(response.status, JSON.stringify(response.body)).toBe(200);
    // The day allows one maxFee: a restrict, a scheduled change and a payment spend it.
    ok(await relayed("10.0.6.2", await request("restrict", { change: changePayload.setLimits(maxFee, maxFee) })));
    ok(await relayed("10.0.6.2", await request("scheduleChange", { change: changePayload.setLimits(2n * maxFee, 2n * maxFee) })));
    const pending = (await publicClient.readContract({ address: mine, abi: veraKeyAccountAbi, functionName: "pendingChangeIds" })) as readonly Hex[];
    const changeId = pending.find(id => BigInt(id) !== 0n)!;
    ok(await relayed("10.0.6.2", await request("pay", { to: recipient, amount: maxFee - 3n * fee })));
    // Past the cap the account waives these fees. A request that fails simulation never counts against the account.
    const noChange = await request("restrict", { change: changePayload.setLimits(maxFee, maxFee) });
    const proof = noChange.args.at(-1) as Hex;
    const junk = { ...noChange, args: [...noChange.args.slice(0, -1), `${proof.slice(0, -2)}${proof.endsWith("00") ? "01" : "00"}`] };
    for (const ip of ["10.0.6.3", "10.0.6.4"]) expect((await relayed(ip, junk)).status).toBe(422);
    // A restrict that changes nothing counts: this relayer sends one a day per account.
    ok(await relayed("10.0.6.2", noChange));
    const limited = await relayed("10.0.6.2", await request("restrict", { change: changePayload.setLimits(maxFee, maxFee) }));
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/today's share/);
    // Defending the account never counts: cancelling a waiting change, and a freeze.
    ok(await relayed("10.0.6.2", await request("cancelChange", { changeId })));
    ok(await relayed("10.0.6.2", await request("restrict", { change: changePayload.freeze() })));
    // Freezing a frozen account with nothing waiting changes nothing, and counts.
    const refrozen = await relayed("10.0.6.2", await request("restrict", { change: changePayload.freeze() }));
    expect(refrozen.status).toBe(429);
    expect(refrozen.body.error).toMatch(/today's share/);
  });
});

describe("relayer: daily budgets for everyone (NM2-002)", () => {
  it("new accounts and faucet grants stop at the day's budget, whoever asks", async () => {
    const budgeted = await startRelayer({ NEW_ACCOUNTS_PER_DAY: "2", FAUCET_GRANTS_PER_DAY: "1" });
    try {
      const create = (ip: string) =>
        api(ip, "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(freshNullifier()) }, budgeted.url);
      const first = await create("10.0.7.1");
      const second = await create("10.0.7.2");
      expect([first.status, second.status]).toEqual([200, 200]);
      expect((await create("10.0.7.3")).status).toBe(429);
      await publicClient.waitForTransactionReceipt({ hash: first.body.hash as Hex });
      await publicClient.waitForTransactionReceipt({ hash: second.body.hash as Hex });
      const grant = await api("10.0.7.4", "POST", "/faucet", { account: first.body.account }, budgeted.url);
      expect(grant.status).toBe(200);
      expect((await api("10.0.7.5", "POST", "/faucet", { account: second.body.account }, budgeted.url)).status).toBe(429);
    } finally {
      budgeted.stop();
    }
  });
});

describe("relayer: a daily gas budget (review 2026-09-29)", () => {
  it("stops what the relayer pays for at the day's gas budget, but never a freeze", async () => {
    // Enough for an account and its demo USDG, not for a payment after them.
    const budgeted = await startRelayer({ RELAY_GAS_PER_DAY: "1200000" });
    try {
      const { request } = await newAccount("gas", "10.0.8.1", budgeted.url);
      const payment = await relayed("10.0.8.2", await request("pay", { to: recipient, amount: USDG(0.1) }), budgeted.url);
      expect(payment.status, JSON.stringify(payment.body)).toBe(429);
      expect(payment.body.error).toMatch(/today's gas/);
      const freeze = await relayed("10.0.8.2", await request("restrict", { change: changePayload.freeze() }), budgeted.url);
      expect(freeze.status, JSON.stringify(freeze.body)).toBe(200);
    } finally {
      budgeted.stop();
    }
  });

  it("remembers only the faucet grants it made, across a restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "verakey-relayer-"));
    const first = await startRelayer({ FAUCET_GRANTS_PER_DAY: "1" }, dir);
    let accounts: Address[] = [];
    let statuses: number[] = [];
    try {
      for (const i of [1, 2]) {
        const created = await api(`10.0.9.${i}`, "POST", "/accounts", { appId: fieldHex(appId), nullifier: fieldHex(freshNullifier()) }, first.url);
        expect(created.status, JSON.stringify(created.body)).toBe(200);
        await publicClient.waitForTransactionReceipt({ hash: created.body.hash as Hex });
        accounts.push(created.body.account);
      }
      const grants = await Promise.all(accounts.map((account, i) => api(`10.0.9.${10 + i}`, "POST", "/faucet", { account }, first.url)));
      statuses = grants.map(grant => grant.status);
      expect([...statuses].sort()).toEqual([200, 429]);
      await publicClient.waitForTransactionReceipt({ hash: grants[statuses.indexOf(200)].body.hash as Hex });
    } finally {
      first.stop(true);
    }
    const second = await startRelayer({ FAUCET_GRANTS_PER_DAY: "5" }, dir);
    try {
      const refused = await api("10.0.9.20", "POST", "/faucet", { account: accounts[statuses.indexOf(429)] }, second.url);
      expect(refused.status, JSON.stringify(refused.body)).toBe(200);
      expect((await api("10.0.9.21", "POST", "/faucet", { account: accounts[statuses.indexOf(200)] }, second.url)).status).toBe(409);
      await publicClient.waitForTransactionReceipt({ hash: refused.body.hash as Hex });
    } finally {
      second.stop();
    }
  });
});
