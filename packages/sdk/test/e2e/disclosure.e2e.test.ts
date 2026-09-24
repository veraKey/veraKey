// "Linkable by consent": one passkey proves that it owns the accounts of two apps, for one audience,
// with a fresh approval. Real UltraHonk proofs, checked locally (bb.js) and on-chain (eth_call).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, keccak256, toHex, type Hex } from "viem";
import {
  VeraKeyProver,
  appIdFromName,
  computeNullifier,
  hexToBytes,
  linkDisclosureChallenge,
  toFieldHex,
  veraKeyFactoryAbi,
  verifyDisclosure,
  type DisclosurePackage,
  type LinkStatement,
} from "../../src";
import { LinkProver } from "../../src/link-prover";
import { VirtualPasskey, chain, deployment, devAccount, publicClient, walletFor } from "./harness";

let prover: VeraKeyProver;
let link: LinkProver;
let passkey: VirtualPasskey;
const pay = appIdFromName("pay");
const shop = appIdFromName("shop");
const nullifiers = {} as { pay: bigint; shop: bigint };

const AUDIENCE = "compliance@exchange.example";
const NONCE = keccak256(toHex("verifier nonce 1"));

const options = (overrides: { audience?: string; nonce?: Hex } = {}) => ({
  publicClient: publicClient as never,
  chainId: chain.id,
  factory: deployment.contracts.factory,
  rpIdHash: deployment.rpIdHash,
  origin: deployment.origin,
  linkVerifier: deployment.contracts.linkVerifier,
  linkProver: link,
  audience: AUDIENCE,
  nonce: NONCE,
  ...overrides,
});

async function disclose(overrides: { statement?: Partial<LinkStatement>; origin?: string; signer?: VirtualPasskey } = {}): Promise<DisclosurePackage> {
  const signer = overrides.signer ?? passkey;
  const statement: LinkStatement = {
    chainId: chain.id,
    factory: deployment.contracts.factory,
    appIdA: toFieldHex(pay),
    nullifierA: toFieldHex(nullifiers.pay),
    appIdB: toFieldHex(shop),
    nullifierB: toFieldHex(nullifiers.shop),
    audience: AUDIENCE,
    nonce: NONCE,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides.statement,
  };
  const assertion = await signer.sign(hexToBytes(linkDisclosureChallenge(statement)), { origin: overrides.origin });
  const proof = await link.prove({
    publicKey: signer.publicKey,
    signature: assertion.signature,
    authenticatorData: assertion.authenticatorData,
    prfSecret: signer.prfSecret,
    clientDataJSON: assertion.clientDataJSON,
    rpIdHash: hexToBytes(deployment.rpIdHash),
    appIdA: BigInt(statement.appIdA),
    nullifierA: BigInt(statement.nullifierA),
    appIdB: BigInt(statement.appIdB),
    nullifierB: BigInt(statement.nullifierB),
  });
  return {
    kind: "verakey-link-disclosure",
    version: 1,
    statement,
    origin: overrides.origin ?? deployment.origin,
    clientDataJSON: bytesToHex(assertion.clientDataJSON),
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  };
}

const failed = (verdict: Awaited<ReturnType<typeof verifyDisclosure>>) => verdict.checks.filter(c => !c.ok).map(c => c.name);

beforeAll(async () => {
  prover = await VeraKeyProver.create({ threads: 8 });
  link = new LinkProver(prover.barretenberg);
  passkey = await VirtualPasskey.create();
  nullifiers.pay = await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, pay);
  nullifiers.shop = await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, shop);
  // Deploy the Pay account so the verifier also sees an owned, deployed account.
  const { request } = await publicClient.simulateContract({
    address: deployment.contracts.factory, abi: veraKeyFactoryAbi, functionName: "createAccount",
    args: [toFieldHex(pay), toFieldHex(nullifiers.pay)], account: devAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: await walletFor(devAccount).writeContract(request) });
}, 180_000);

afterAll(async () => {
  await prover?.destroy();
});

describe("linkable by consent", () => {
  it("one_passkey_proves_it_owns_both_accounts", async () => {
    const pkg = await disclose();
    const verdict = await verifyDisclosure(pkg, options());
    expect(failed(verdict)).toEqual([]);
    expect(verdict.valid).toBe(true);
    expect(verdict.accounts?.a.deployed).toBe(true);
    expect(verdict.accounts?.a.ownedByNullifier).toBe(true);
    expect(verdict.accounts?.b.deployed).toBe(false);
    expect(verdict.accounts?.a.address).not.toBe(verdict.accounts?.b.address);
  });

  it("changing_the_audience_after_signing_fails", async () => {
    const pkg = await disclose();
    const edited = { ...pkg, statement: { ...pkg.statement, audience: "someone-else@example" } };
    expect(failed(await verifyDisclosure(edited, options()))).toEqual(["Made for this audience", "Passkey signed this statement"]);
    // Whoever edits it to name themselves still fails: the passkey signed the original audience.
    expect(failed(await verifyDisclosure(edited, options({ audience: "someone-else@example" })))).toEqual(["Passkey signed this statement"]);
  });

  it("a_forwarded_disclosure_fails_for_another_audience", async () => {
    const pkg = await disclose();
    expect(failed(await verifyDisclosure(pkg, options({ audience: "someone-else@example" })))).toEqual(["Made for this audience"]);
  });

  it("a_disclosure_without_the_requested_nonce_fails", async () => {
    const pkg = await disclose();
    const other = keccak256(toHex("verifier nonce 2"));
    expect(failed(await verifyDisclosure(pkg, options({ nonce: other })))).toEqual(["Carries the nonce you asked for"]);
  });

  it("a_long_lived_disclosure_fails", async () => {
    const pkg = await disclose({ statement: { expiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400 } });
    expect(failed(await verifyDisclosure(pkg, options()))).toEqual(["Short-lived"]);
  });

  it("an_expired_disclosure_fails", async () => {
    const pkg = await disclose({ statement: { expiresAt: Math.floor(Date.now() / 1000) - 60 } });
    expect(failed(await verifyDisclosure(pkg, options()))).toEqual(["Not expired"]);
  });

  it("claiming_another_passkeys_nullifier_fails", async () => {
    const stranger = await VirtualPasskey.create();
    const theirs = await computeNullifier(prover.barretenberg, stranger.publicKey, stranger.prfSecret, shop);
    const pkg = await disclose();
    const edited = { ...pkg, statement: { ...pkg.statement, nullifierB: toFieldHex(theirs) } };
    const names = failed(await verifyDisclosure(edited, options()));
    expect(names).toContain("Proof commits to this statement");
    expect(names).toContain("Passkey signed this statement");
    // And the circuit cannot prove it: the passkey does not own that nullifier.
    await expect(disclose({ statement: { nullifierB: toFieldHex(theirs) } })).rejects.toThrow();
  });

  it("a_tampered_proof_fails_locally_and_on_chain", async () => {
    const pkg = await disclose();
    const bytes = Buffer.from(pkg.proof.slice(2), "hex");
    bytes[300] ^= 1;
    const tampered = { ...pkg, proof: `0x${bytes.toString("hex")}` as Hex };
    const names = failed(await verifyDisclosure(tampered, options()));
    expect(names).toEqual(["Proof verifies on-chain (LinkHonkVerifier, eth_call)", "Proof verifies locally (bb.js)"]);
  });

  it("an_assertion_from_another_origin_fails", async () => {
    const pkg = await disclose({ origin: "https://evil.example" });
    expect(failed(await verifyDisclosure(pkg, options()))).toEqual(["Signed on the VeraKey origin"]);
  });

  it("a_disclosure_for_another_deployment_fails", async () => {
    const pkg = await disclose({ statement: { factory: deployment.contracts.factoryAlt } });
    expect(failed(await verifyDisclosure(pkg, options()))).toContain("This deployment");
  });
});
