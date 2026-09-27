import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type PublicClient } from "viem";
import { veraKeyAccountAbi } from "../../src/abi";
import { base64UrlEncode, bytesToHex, hexToBytes, limbs, sha256, toFieldHex } from "../../src/bytes";
import { signInChallenge, type SignInResult, type SignInStatement } from "../../src/signin";

/** A site, VeraKey, and a chain that answers the way a test needs: shared by the sign-in and kit tests. */

export const GAME = "https://game.example";
export const VERAKEY = "https://verakey.example";
export const NOW = 1_790_000_100;
export const NONCE: Hex = `0x${"11".repeat(32)}`;
export const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";
export const HASH: Hex = `0x${"ab".repeat(32)}`;

export const statement: SignInStatement = {
  chainId: 421614,
  factory: "0x45bbaf84eea0c285db53fd7d72187e9e3843c3e4",
  origin: GAME,
  appId: "0x1e9cd87f87126b42ff85a42a3d0d866cc041708bfb6fd05cb7b713dff2599af6",
  nullifier: toFieldHex(2n),
  nonce: `0x${"11".repeat(32)}`,
  issuedAt: 1_790_000_000,
  expiresAt: 1_790_000_300,
};

export const deployment = {
  chainId: 421614,
  factory: statement.factory,
  rpIdHash: "0x0fe14846fe0610bfa7471c5396156cdf8b0c6594cc04194ffadcf8e8a490f4e1" as Hex,
  origin: VERAKEY,
  honkVerifier: "0x0cB71548faa63543F8c0F04370F163875279A234" as Address,
};

/** A chain that answers the verifier, the factory and the account the way a test needs. */
export function chain({ verify = true, account = ACCOUNT, deployed = false, owner = true, failing = "" } = {}): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === failing) throw new Error("the RPC failed");
      if (functionName === "verify") return verify;
      if (functionName === "accountAddress") return account;
      if (functionName === "isOwner") return owner;
      throw new Error(`unexpected call ${functionName}`);
    },
    getCode: async () => {
      if (failing === "getCode") throw new Error("the RPC failed");
      return deployed ? "0x6080" : undefined;
    },
  } as unknown as PublicClient;
}

/** A sign-in as the popup builds it, with client data the verifier can check; `chain` fakes the proof check. */
export async function signedIn(
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

export const failed = (verdict: { checks: { name: string; ok: boolean }[] }) => verdict.checks.filter(c => !c.ok).map(c => c.name);

/** A `Paid` event log from `from`, as the account emits it. */
export const paidLog = (from: Address, to: Address, amount: bigint, fee: bigint) => ({
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

/** A chain whose one transaction has this status and these logs (null: no such transaction). */
export const receipts = (status: "success" | "reverted" | null, logs: unknown[] = []) =>
  ({
    getTransactionReceipt: async () => {
      if (!status) throw new Error("not found");
      return { status, logs };
    },
  }) as unknown as PublicClient;
