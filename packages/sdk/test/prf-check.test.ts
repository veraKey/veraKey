import { createHash } from "node:crypto";
import { p256 } from "@noble/curves/p256";
import { bytesToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VeraKeyClient, VeraKeyError } from "../src/client";
import { MemoryPasskeyStore, toStoredPasskey } from "../src/store";
import type { VeraKeyProver } from "../src/prover";

// A passkey that really signs with P-256 and returns whatever PRF secret the test sets, the way one
// password manager can answer the same passkey with another secret through another route.
const sha256 = (data: Uint8Array) => new Uint8Array(createHash("sha256").update(data).digest());
const privateKey = p256.utils.randomPrivateKey();
const point = p256.getPublicKey(privateKey, false);
const publicKey = { x: point.slice(1, 33), y: point.slice(33, 65) };
const credentialId = new Uint8Array(16).map((_, i) => i + 1);
const SPKI_PREFIX = Uint8Array.from(Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"));

const secretA = new Uint8Array(32).fill(0xa1);
const secretB = new Uint8Array(32).fill(0xb2);
let prf = secretA;

function assertion(challenge: Uint8Array) {
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x05; // user present, user verified
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(challenge).toString("base64url"), origin: "https://verakey.test" })
  );
  const digest = sha256(new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]));
  const signature = p256.sign(digest, privateKey).toDERRawBytes();
  const results = prf.slice();
  return {
    rawId: credentialId.slice().buffer,
    response: { authenticatorData: authenticatorData.buffer, clientDataJSON: clientDataJSON.buffer, signature: signature.buffer, userHandle: null },
    getClientExtensionResults: () => ({ prf: { results: { first: results.buffer } } }),
  };
}

function creation(withResult: boolean) {
  const results = prf.slice();
  return {
    rawId: credentialId.slice().buffer,
    response: {
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () => new Uint8Array([...SPKI_PREFIX, ...point]).buffer,
    },
    getClientExtensionResults: () => ({ prf: withResult ? { enabled: true, results: { first: results.buffer } } : { enabled: true } }),
  };
}

function client(store: MemoryPasskeyStore) {
  return new VeraKeyClient({
    rpId: "verakey.test",
    chainId: 421614,
    rpcUrl: "http://127.0.0.1:9",
    factory: "0x0000000000000000000000000000000000000001",
    usdg: "0x0000000000000000000000000000000000000002",
    rpIdHash: `0x${"00".repeat(32)}`,
    relayerUrl: "/api",
    relayerFee: 0n,
    appIds: [],
    loadProver: async () => ({ barretenberg: {} }) as unknown as VeraKeyProver,
    store,
  });
}

let createWithResult = true;
beforeEach(() => {
  prf = secretA;
  createWithResult = true;
  vi.stubGlobal("navigator", {
    credentials: {
      get: async ({ publicKey: options }: { publicKey: { challenge: Uint8Array } }) => assertion(options.challenge),
      create: async () => creation(createWithResult),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the PRF check of a remembered passkey", () => {
  it("remembers a passkey unlocked for the first time with a check of its PRF secret, never the secret", async () => {
    const store = new MemoryPasskeyStore();
    await client(store).unlock();
    const [saved] = store.list();
    expect(saved.publicKey).toEqual({ x: bytesToHex(publicKey.x), y: bytesToHex(publicKey.y) });
    expect(saved.prfCheck).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(saved)).not.toContain(bytesToHex(secretA).slice(2, 18));
  });

  it("unlocks again when the passkey returns the same secret", async () => {
    const store = new MemoryPasskeyStore();
    const vera = client(store);
    await vera.unlock();
    const again = await vera.unlock();
    expect(again.prfSecret).toEqual(secretA);
  });

  it("refuses a passkey that returns another secret than before in this browser, and keeps the session", async () => {
    const store = new MemoryPasskeyStore();
    const vera = client(store);
    await vera.unlock();
    const check = store.list()[0].prfCheck;
    prf = secretB;
    const refusal = await vera.unlock().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(VeraKeyError);
    expect(refusal).toMatchObject({ stage: "device" });
    expect((refusal as Error).message).toMatch(/different secret/);
    expect(store.list()[0].prfCheck).toBe(check);
    expect(vera.session?.prfSecret).toEqual(secretA);
    await expect(vera.authenticate()).rejects.toBeInstanceOf(VeraKeyError);
  });

  it("adds the check to a passkey remembered before checks existed, then holds it to that secret", async () => {
    const store = new MemoryPasskeyStore();
    store.save(toStoredPasskey(credentialId, publicKey, "My passkey"));
    const vera = client(store);
    await vera.unlock();
    expect(store.list()[0].prfCheck).toMatch(/^[0-9a-f]{32}$/);
    prf = secretB;
    await expect(vera.unlock()).rejects.toBeInstanceOf(VeraKeyError);
  });

  it("saves a new passkey with the check of the secret it returned at creation", async () => {
    const store = new MemoryPasskeyStore();
    const vera = client(store);
    const { passkey } = await vera.register("My passkey");
    expect(passkey.prfCheck).toMatch(/^[0-9a-f]{32}$/);
    expect(store.list()[0].prfCheck).toBe(passkey.prfCheck);
    prf = secretB;
    await expect(vera.unlock()).rejects.toBeInstanceOf(VeraKeyError);
  });

  it("checks a new passkey from its first unlock when creation returned no secret", async () => {
    const store = new MemoryPasskeyStore();
    createWithResult = false;
    const vera = client(store);
    const { passkey, session } = await vera.register("My passkey");
    expect(session).toBeNull();
    expect(passkey.prfCheck).toBeUndefined();
    await vera.unlock();
    expect(store.list()[0].prfCheck).toMatch(/^[0-9a-f]{32}$/);
  });
});
