// "Sign in with VeraKey": a site gets its own player ID and a proof its server verifies, and the player pays the
// site from the account for its origin. Real UltraHonk proofs on the local nitro devnode.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ActionKind,
  SIGN_IN_TTL_SECONDS,
  VeraKeyProver,
  ZERO_HASH,
  accountAddressOf,
  appIdFromOrigin,
  computeNullifier,
  hexToBytes,
  signInChallenge,
  toFieldHex,
  veraKeyAccountAbi,
  veraKeyFactoryAbi,
  verifyPayment,
  verifySignIn,
  type SignInResult,
  type SignInStatement,
} from "../../src";
import { USDG, VirtualPasskey, authorize, chain, deployment, devAccount, publicClient, revertName, walletFor } from "./harness";

const GAME = "http://localhost:5191";
const appId = appIdFromOrigin(GAME);
const merchant = privateKeyToAccount(generatePrivateKey()).address;
const configHash = (deployment as unknown as { configHash: Hex }).configHash;
const relayer = walletFor(devAccount);

let prover: VeraKeyProver;
let passkey: VirtualPasskey;
let nullifier: bigint;
let account: Address;

async function signIn(nonce: Hex): Promise<SignInResult> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const statement: SignInStatement = {
    chainId: chain.id,
    factory: deployment.contracts.factory,
    origin: GAME,
    appId: toFieldHex(appId),
    nullifier: toFieldHex(nullifier),
    nonce,
    issuedAt,
    expiresAt: issuedAt + SIGN_IN_TTL_SECONDS,
  };
  const assertion = await passkey.sign(hexToBytes(signInChallenge(statement)));
  const proof = await prover.prove({
    publicKey: passkey.publicKey,
    signature: assertion.signature,
    authenticatorData: assertion.authenticatorData,
    prfSecret: passkey.prfSecret,
    clientDataJSON: assertion.clientDataJSON,
    rpIdHash: hexToBytes(deployment.rpIdHash),
    appId,
    nullifier,
  });
  return {
    version: 1,
    statement,
    playerId: statement.nullifier,
    account,
    clientDataJSON: bytesToHex(assertion.clientDataJSON),
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  };
}

const options = (nonce: Hex) => ({
  origin: GAME,
  nonce,
  publicClient: publicClient as never,
  prover,
  deployment: {
    chainId: chain.id,
    factory: deployment.contracts.factory,
    rpIdHash: deployment.rpIdHash,
    origin: deployment.origin,
    honkVerifier: deployment.contracts.honkVerifier,
  },
});

beforeAll(async () => {
  prover = await VeraKeyProver.create({ threads: 8 });
  passkey = await VirtualPasskey.create();
  nullifier = await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, appId);
  account = accountAddressOf(
    { factory: deployment.contracts.factory, accountImplementation: deployment.contracts.accountImplementation, configHash },
    appId,
    nullifier
  );
  const { request } = await publicClient.simulateContract({
    address: deployment.contracts.factory,
    abi: veraKeyFactoryAbi,
    functionName: "createAccount",
    args: [toFieldHex(appId), toFieldHex(nullifier)],
    account: devAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
  await publicClient.waitForTransactionReceipt({
    hash: await relayer.writeContract({
      address: deployment.contracts.usdg,
      abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }],
      functionName: "mint",
      args: [account, USDG(5)],
    }),
  });
}, 180_000);

afterAll(async () => {
  await prover?.destroy();
});

describe("sign in with VeraKey", () => {
  it("computes the account address locally, exactly as the factory does", async () => {
    const onChain = await publicClient.readContract({
      address: deployment.contracts.factory,
      abi: veraKeyFactoryAbi,
      functionName: "accountAddress",
      args: [toFieldHex(appId), toFieldHex(nullifier)],
    });
    expect(account).toBe(onChain);
  });

  it("verifies a sign-in on-chain (eth_call) and locally (bb.js)", async () => {
    const nonce = keccak256(toHex("sign-in nonce 1"));
    const verdict = await verifySignIn(await signIn(nonce), options(nonce));
    expect(verdict.checks.filter(c => !c.ok)).toEqual([]);
    expect(verdict.playerId).toBe(toFieldHex(nullifier));
    expect(verdict.account).toBe(account);
  });

  it("refuses a real proof moved onto another statement", async () => {
    const nonce = keccak256(toHex("sign-in nonce 2"));
    const other = keccak256(toHex("sign-in nonce 3"));
    const result = await signIn(nonce);
    const moved = { ...result, statement: { ...result.statement, nonce: other } };
    const verdict = await verifySignIn(moved, options(other));
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.filter(c => !c.ok).map(c => c.name)).toEqual(["Passkey signed this sign-in"]);
  });

  it("a sign-in proof cannot move funds", async () => {
    const result = await signIn(keccak256(toHex("sign-in nonce 4")));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const attempt = publicClient.simulateContract({
      address: account,
      abi: veraKeyAccountAbi,
      functionName: "pay",
      args: [merchant, USDG(1), 0n, deadline, toFieldHex(nullifier), result.clientDataJSON, result.proof],
      account: devAccount,
    });
    expect(await revertName(attempt)).toBe("InvalidClientData");
  });

  it("verifies a payment from the site's account, and refuses a mismatch", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const auth = await authorize(prover, { passkey, nullifier }, appId, account, {
      kind: ActionKind.Pay, target: merchant, amount: USDG(1), dataHash: ZERO_HASH, fee: 0n, deadline,
    });
    const { request } = await publicClient.simulateContract({
      address: account,
      abi: veraKeyAccountAbi,
      functionName: "pay",
      args: [merchant, USDG(1), 0n, deadline, toFieldHex(nullifier), auth.clientDataJSON, auth.proof],
      account: devAccount,
    });
    const hash = await relayer.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    const check = (overrides: { account?: Address; to?: Address; amount?: bigint }) =>
      verifyPayment(hash, { publicClient: publicClient as never, account, to: merchant, amount: USDG(1), ...overrides });
    const paid = await check({});
    expect(paid.valid).toBe(true);
    expect(paid.fee).toBe(0n);
    expect((await check({ amount: USDG(2) })).valid).toBe(false);
    expect((await check({ to: devAccount.address })).valid).toBe(false);
    expect((await check({ account: merchant })).valid).toBe(false);
  });
});
