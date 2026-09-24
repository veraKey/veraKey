import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type PublicClient } from "viem";
import { veraKeyAccountAbi } from "../src/abi";
import { base64UrlEncode, bytesToHex, hexToBytes, limbs, sha256, toFieldHex } from "../src/bytes";
import { BN254_R } from "../src/constants";
import { appIdFromName } from "../src/nullifier";
import {
  SIGN_IN_TYPEHASH,
  accountAddressOf,
  appIdFromOrigin,
  normalizeOrigin,
  signInChallenge,
  findPayment,
  verifyPayment,
  verifySignIn,
  type SignInResult,
  type SignInStatement,
} from "../src/signin";

const GAME = "https://game.example";
const statement: SignInStatement = {
  chainId: 421614,
  factory: "0x45bbaf84eea0c285db53fd7d72187e9e3843c3e4",
  origin: GAME,
  appId: "0x1e9cd87f87126b42ff85a42a3d0d866cc041708bfb6fd05cb7b713dff2599af6",
  nullifier: toFieldHex(2n),
  nonce: `0x${"11".repeat(32)}`,
  issuedAt: 1_790_000_000,
  expiresAt: 1_790_000_300,
};

describe("appIdFromOrigin", () => {
  it("derives a field element from the site's origin", () => {
    expect(toFieldHex(appIdFromOrigin(GAME))).toBe(statement.appId);
    expect(appIdFromOrigin("http://localhost:5191")).toBeLessThan(BN254_R);
  });
  it("gives every origin its own id", () => {
    const origins = [GAME, "https://game.example:8443", "http://game.example", "https://play.game.example", "https://other.example"];
    expect(new Set(origins.map(appIdFromOrigin)).size).toBe(origins.length);
  });
  it("never equals the id of one of VeraKey's own apps with the same name", () => {
    expect(appIdFromOrigin(GAME)).not.toBe(appIdFromName(GAME));
  });
  it("normalizes the origin, and refuses anything that is not one", () => {
    expect(appIdFromOrigin("https://Game.Example/")).toBe(appIdFromOrigin(GAME));
    expect(normalizeOrigin("http://localhost:5191/play?level=2#top")).toBe("http://localhost:5191");
    expect(() => appIdFromOrigin("game.example")).toThrow();
    expect(() => appIdFromOrigin("data:text/plain,hi")).toThrow();
  });
});

describe("signInChallenge", () => {
  it("hashes the statement under the sign-in type hash", () => {
    expect(SIGN_IN_TYPEHASH).toBe("0xac886c228cf35779f4d0bfbd47f318dffe6d554d2edd0af8d8d6ff3b872fd52d");
    expect(signInChallenge(statement)).toBe("0x0355bbf61d2a671aca6d892754ab0428a564e8b325cb62cf4af30843a55dbdaa");
  });
  it("changes with every field", () => {
    const variants: Partial<SignInStatement>[] = [
      { chainId: 42161 },
      { factory: "0x0000000000000000000000000000000000000001" },
      { origin: "https://other.example" },
      { appId: toFieldHex(1n) },
      { nullifier: toFieldHex(3n) },
      { nonce: `0x${"22".repeat(32)}` },
      { issuedAt: 1_790_000_001 },
      { expiresAt: 1_790_000_301 },
    ];
    const challenges = variants.map(variant => signInChallenge({ ...statement, ...variant }));
    expect(new Set([signInChallenge(statement), ...challenges]).size).toBe(variants.length + 1);
  });
});

describe("accountAddressOf", () => {
  it("matches the factory on Arbitrum Sepolia", () => {
    // factory.accountAddress(1, 2), read from the Sepolia deployment on 2026-09-24
    const deployment = {
      factory: "0x45bbaf84eea0c285db53fd7d72187e9e3843c3e4",
      accountImplementation: "0x72bb20016847e06c1eba897c7dc504abff164c50",
      configHash: "0x9d584d65853c7a2c6809929eec24071376caba939270ac8de2d7bb4c3e057183",
    } as const;
    expect(accountAddressOf(deployment, 1n, 2n)).toBe("0xF54d3d9a835a4bB87594f55B21a4789b51B2F8F2");
  });
});

const VERAKEY = "https://verakey.example";
const NOW = 1_790_000_100;
const NONCE: Hex = `0x${"11".repeat(32)}`;
const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";
const deployment = {
  chainId: 421614,
  factory: statement.factory,
  rpIdHash: "0x0fe14846fe0610bfa7471c5396156cdf8b0c6594cc04194ffadcf8e8a490f4e1" as Hex,
  origin: VERAKEY,
  honkVerifier: "0x0cB71548faa63543F8c0F04370F163875279A234" as Address,
};

/** A chain that answers the verifier, the factory and the account the way a test needs. */
function chain({ verify = true, account = ACCOUNT, deployed = false, owner = true } = {}): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "verify") return verify;
      if (functionName === "accountAddress") return account;
      if (functionName === "isOwner") return owner;
      throw new Error(`unexpected call ${functionName}`);
    },
    getCode: async () => (deployed ? "0x6080" : undefined),
  } as unknown as PublicClient;
}

/** A sign-in as the popup builds it, with client data the verifier can check; `chain` fakes the proof check. */
async function signedIn(
  overrides: Partial<SignInStatement> = {},
  clientData: { type?: string; origin?: string; crossOrigin?: boolean } = {}
): Promise<SignInResult> {
  const s: SignInStatement = { ...statement, issuedAt: NOW - 10, expiresAt: NOW + 290, ...overrides };
  const json = JSON.stringify({
    type: clientData.type ?? "webauthn.get",
    challenge: base64UrlEncode(hexToBytes(signInChallenge(s))),
    origin: clientData.origin ?? VERAKEY,
    crossOrigin: clientData.crossOrigin ?? false,
  });
  const bytes = new TextEncoder().encode(json);
  const [cdhHi, cdhLo] = limbs(await sha256(bytes));
  const [rpHi, rpLo] = limbs(hexToBytes(deployment.rpIdHash));
  return {
    version: 1,
    statement: s,
    playerId: s.nullifier,
    account: ACCOUNT,
    clientDataJSON: bytesToHex(bytes),
    proof: "0x1234",
    publicInputs: [cdhHi, cdhLo, rpHi, rpLo, BigInt(s.appId), BigInt(s.nullifier)].map(toFieldHex),
  };
}

const verify = (result: SignInResult, options: { origin?: string; nonce?: Hex; client?: PublicClient } = {}) =>
  verifySignIn(result, {
    origin: options.origin ?? GAME,
    nonce: options.nonce ?? NONCE,
    now: NOW,
    publicClient: options.client ?? chain(),
    deployment,
  });
const failed = (verdict: { checks: { name: string; ok: boolean }[] }) => verdict.checks.filter(c => !c.ok).map(c => c.name);

describe("verifySignIn", () => {
  it("accepts a sign-in made for this site", async () => {
    const verdict = await verify(await signedIn());
    expect(failed(verdict)).toEqual([]);
    expect(verdict.valid).toBe(true);
    expect(verdict.playerId).toBe(statement.nullifier);
    expect(verdict.account).toBe(ACCOUNT);
  });
  it("accepts the site's origin written with a trailing slash or capitals", async () => {
    expect((await verify(await signedIn(), { origin: "https://Game.Example/" })).valid).toBe(true);
  });
  it("refuses a sign-in made for another site", async () => {
    const other = "https://other.example";
    const verdict = await verify(await signedIn({ origin: other, appId: toFieldHex(appIdFromOrigin(other)) }));
    expect(failed(verdict)).toEqual(["Made for this site", "App id of this site"]);
  });
  it("refuses another site's app id, even under this site's origin", async () => {
    const verdict = await verify(await signedIn({ appId: toFieldHex(appIdFromOrigin("https://other.example")) }));
    expect(failed(verdict)).toEqual(["App id of this site"]);
  });
  it("refuses a nonce this site did not issue", async () => {
    expect(failed(await verify(await signedIn(), { nonce: `0x${"22".repeat(32)}` }))).toEqual(["Carries the nonce you issued"]);
  });
  it("tolerates a device clock up to a minute off, and names the clock beyond that", async () => {
    expect((await verify(await signedIn({ issuedAt: NOW - 330, expiresAt: NOW - 30 }))).valid).toBe(true);
    const late = await verify(await signedIn({ issuedAt: NOW - 361, expiresAt: NOW - 61 }));
    expect(failed(late)).toEqual(["Not expired"]);
    expect(late.checks.find(c => c.name === "Not expired")?.detail).toMatch(/device clock/);
  });
  it("refuses a sign-in valid for longer than five minutes", async () => {
    expect(failed(await verify(await signedIn({ expiresAt: NOW + 3600 })))).toEqual(["Short-lived"]);
  });
  it("refuses client data that is not a plain passkey assertion on VeraKey", async () => {
    expect(failed(await verify(await signedIn({}, { type: "webauthn.create" })))).toEqual(["Passkey signed this sign-in"]);
    expect(failed(await verify(await signedIn({}, { origin: "https://evil.example" })))).toEqual(["Signed on VeraKey"]);
    expect(failed(await verify(await signedIn({}, { crossOrigin: true })))).toEqual(["Signed on VeraKey"]);
  });
  it("refuses a statement changed after it was signed", async () => {
    const result = await signedIn();
    const changed: SignInResult = { ...result, statement: { ...result.statement, nonce: `0x${"22".repeat(32)}` } };
    expect(failed(await verify(changed, { nonce: changed.statement.nonce }))).toEqual(["Passkey signed this sign-in"]);
  });
  it("refuses public inputs that do not match the statement", async () => {
    const result = await signedIn();
    const publicInputs = [...result.publicInputs];
    publicInputs[5] = toFieldHex(3n);
    expect(failed(await verify({ ...result, publicInputs }))).toEqual(["Proof commits to this sign-in"]);
  });
  it("refuses a proof the verifier rejects", async () => {
    expect(failed(await verify(await signedIn(), { client: chain({ verify: false }) }))).toEqual([
      "Proof verifies on-chain (HonkVerifier, eth_call)",
    ]);
  });
  it("refuses an account that is not this player's, or no longer theirs", async () => {
    const other = await verify(await signedIn(), { client: chain({ account: "0x00000000000000000000000000000000000000bb" }) });
    expect(failed(other)).toEqual(["Account of this player"]);
    expect(failed(await verify(await signedIn(), { client: chain({ deployed: true, owner: false }) }))).toEqual([
      "Player still owns the account",
    ]);
  });
  it("never throws on crafted input: a site's server gets a refusal, not a crash", async () => {
    const result = await signedIn();
    const statementWith = (fields: Partial<SignInStatement>): SignInResult => ({ ...result, statement: { ...result.statement, ...fields } });
    for (const crafted of [statementWith({ expiresAt: 1e13 }), statementWith({ issuedAt: -1 }), statementWith({ chainId: -1 }), statementWith({ issuedAt: NOW + 400 })]) {
      expect(failed(await verify(crafted))).toEqual(["Well-formed fields"]);
    }
    const nullClientData = await verify({ ...result, clientDataJSON: bytesToHex(new TextEncoder().encode("null")) });
    expect(nullClientData.valid).toBe(false);
    expect(failed(nullClientData)).toContain("Passkey signed this sign-in");
  });
  it("refuses anything that is not a well-formed version 1 sign-in", async () => {
    const result = await signedIn();
    expect(failed(await verify({ ...result, version: 2 } as unknown as SignInResult))).toEqual(["Format"]);
    expect(failed(await verify({ ...result, playerId: toFieldHex(9n) }))).toEqual(["Well-formed fields"]);
  });
});

describe("verifyPayment", () => {
  const MERCHANT: Address = "0x00000000000000000000000000000000000000cc";
  const HASH: Hex = `0x${"ab".repeat(32)}`;
  const paidLog = (from: Address, to: Address, amount: bigint, fee: bigint) => ({
    address: from,
    topics: encodeEventTopics({
      abi: veraKeyAccountAbi,
      eventName: "Paid",
      args: { nonce: 0n, to, submitter: "0x00000000000000000000000000000000000000dd" },
    }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, fee]),
    blockHash: HASH,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: HASH,
    transactionIndex: 0,
    removed: false,
  });
  const receipts = (status: "success" | "reverted" | null, logs: unknown[] = []) =>
    ({
      getTransactionReceipt: async () => {
        if (!status) throw new Error("not found");
        return { status, logs };
      },
    }) as unknown as PublicClient;
  const expected = { account: ACCOUNT, to: MERCHANT, amount: 1_000_000n };

  it("accepts a payment from the player's account to this recipient", async () => {
    const verdict = await verifyPayment(HASH, { ...expected, publicClient: receipts("success", [paidLog(ACCOUNT, MERCHANT, 1_000_000n, 20_000n)]) });
    expect(failed(verdict)).toEqual([]);
    expect(verdict.fee).toBe(20_000n);
  });
  it("refuses another amount, another recipient or another payer", async () => {
    const other: Address = "0x00000000000000000000000000000000000000ee";
    const check = (log: ReturnType<typeof paidLog>) => verifyPayment(HASH, { ...expected, publicClient: receipts("success", [log]) });
    expect(failed(await check(paidLog(ACCOUNT, MERCHANT, 2_000_000n, 0n)))).toEqual(["To this recipient, for this amount"]);
    expect(failed(await check(paidLog(ACCOUNT, other, 1_000_000n, 0n)))).toEqual(["To this recipient, for this amount"]);
    expect(failed(await check(paidLog(other, MERCHANT, 1_000_000n, 0n)))).toEqual([
      "Paid by this player's account",
      "To this recipient, for this amount",
    ]);
  });
  it("waits for a payment that is sent but not yet in a block", async () => {
    const log = paidLog(ACCOUNT, MERCHANT, 1_000_000n, 20_000n);
    const pending = {
      getTransactionReceipt: async () => {
        throw new Error("not found");
      },
      getTransaction: async () => ({ hash: HASH }),
      waitForTransactionReceipt: async () => ({ status: "success", logs: [log] }),
    } as unknown as PublicClient;
    expect(failed(await verifyPayment(HASH, { ...expected, publicClient: pending }))).toEqual([]);
  });
  it("refuses a reverted or unknown transaction", async () => {
    expect(failed(await verifyPayment(HASH, { ...expected, publicClient: receipts("reverted") }))).toEqual(["Transaction succeeded"]);
    expect(failed(await verifyPayment(HASH, { ...expected, publicClient: receipts(null) }))).toEqual(["Transaction succeeded"]);
  });
});

describe("findPayment", () => {
  const FOUND: Hex = `0x${"cd".repeat(32)}`;
  it("finds a payment by the paying account and its action nonce", async () => {
    const queries: unknown[] = [];
    const chain = {
      getBlockNumber: async () => 50_000n,
      getContractEvents: async (query: unknown) => {
        queries.push(query);
        return [{ transactionHash: FOUND }];
      },
    } as unknown as PublicClient;
    expect(await findPayment({ publicClient: chain, account: ACCOUNT, nonce: 7n, timeoutMs: 0 })).toBe(FOUND);
    expect(queries[0]).toMatchObject({ address: ACCOUNT, eventName: "Paid", args: { nonce: 7n }, fromBlock: 40_000n, toBlock: 50_000n });
  });
  it("returns null when the account made no payment with that nonce", async () => {
    const chain = { getBlockNumber: async () => 5n, getContractEvents: async () => [] } as unknown as PublicClient;
    expect(await findPayment({ publicClient: chain, account: ACCOUNT, nonce: 7n, timeoutMs: 0 })).toBeNull();
  });
});
