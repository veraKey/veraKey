import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  isAddress,
  isHex,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { honkVerifierAbi, veraKeyAccountAbi, veraKeyFactoryAbi } from "./abi";
import { base64UrlEncode, hexToBytes, limbs, sha256, toFieldHex } from "./bytes";
import { BN254_R } from "./constants";
import type { VeraKeyProver } from "./prover";

/**
 * "Sign in with VeraKey": a site on its own origin signs a player in through VeraKey's popup. The player's passkey
 * signs a statement bound to the site's origin, a nonce from the site's server and a short expiry; the browser
 * proves it with the authorization circuit, and the site's server verifies the proof itself.
 */

/** `keccak256("VeraKeySignIn(uint256 chainId,address factory,bytes32 origin,bytes32 appId,bytes32 nullifier,bytes32 nonce,uint64 issuedAt,uint64 expiresAt)")` */
export const SIGN_IN_TYPEHASH = keccak256(
  stringToHex(
    "VeraKeySignIn(uint256 chainId,address factory,bytes32 origin,bytes32 appId,bytes32 nullifier,bytes32 nonce,uint64 issuedAt,uint64 expiresAt)"
  )
);

/** How long a sign-in stays valid, in seconds. */
export const SIGN_IN_TTL_SECONDS = 300;

export interface SignInStatement {
  chainId: number;
  factory: Address;
  /** The requesting site's serialized origin, e.g. "https://game.example". */
  origin: string;
  appId: Hex;
  /** The player ID: the passkey's nullifier for `appId`. */
  nullifier: Hex;
  /** 32 bytes from the site's server, which accepts each nonce once. */
  nonce: Hex;
  issuedAt: number;
  expiresAt: number;
}

export interface SignInResult {
  version: 1;
  statement: SignInStatement;
  playerId: Hex;
  account: Address;
  clientDataJSON: Hex;
  proof: Hex;
  publicInputs: Hex[];
}

export interface PaymentResult {
  version: 1;
  hash: Hex;
  account: Address;
  to: Address;
  /** USDG base units (6 decimals), as decimal strings. */
  amount: string;
  fee: string;
}

/** The serialized origin of `url` (scheme, host and port). Throws for anything that is not a web origin. */
export function normalizeOrigin(url: string): string {
  const origin = new URL(url).origin;
  if (origin === "null") throw new TypeError(`Not a web origin: ${url}`);
  return origin;
}

/** A site's app id, derived from its origin, so a site only ever gets its own players' IDs. */
export function appIdFromOrigin(origin: string): bigint {
  return BigInt(keccak256(stringToHex(`verakey.origin:${normalizeOrigin(origin)}`))) % BN254_R;
}

/** The WebAuthn challenge the passkey signs for `statement`. */
export function signInChallenge(statement: SignInStatement): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint64" },
      ],
      [
        SIGN_IN_TYPEHASH, BigInt(statement.chainId), statement.factory, keccak256(stringToHex(statement.origin)),
        statement.appId, statement.nullifier, statement.nonce, BigInt(statement.issuedAt), BigInt(statement.expiresAt),
      ]
    )
  );
}

const CLONE_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
const CLONE_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3";

/**
 * The account address for `(appId, nullifier)`, computed locally the way the factory deploys it: CREATE2 of an
 * EIP-1167 clone, salted with `keccak256(appId ‖ nullifier ‖ configHash)`. No RPC call, so no node learns the pair.
 */
export function accountAddressOf(
  deployment: { factory: Address; accountImplementation: Address; configHash: Hex },
  appId: bigint,
  nullifier: bigint
): Address {
  const salt = keccak256(concat([toFieldHex(appId), toFieldHex(nullifier), deployment.configHash]));
  const bytecode = concat([CLONE_PREFIX, deployment.accountImplementation, CLONE_SUFFIX]);
  return getContractAddress({ opcode: "CREATE2", from: deployment.factory, salt, bytecode });
}

export interface SignInCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** The VeraKey deployment a site trusts, pinned in the site's own configuration (never read from a result). */
export interface SignInDeployment {
  chainId: number;
  factory: Address;
  rpIdHash: Hex;
  /** VeraKey's origin, where the passkey signs. */
  origin: string;
  honkVerifier: Address;
}

export interface VerifySignInOptions {
  /** The verifying site's own origin. */
  origin: string;
  /** The nonce the site issued for this sign-in (the site accepts each nonce once). */
  nonce: Hex;
  publicClient: PublicClient;
  deployment: SignInDeployment;
  /** Verify the proof locally with bb.js as well. */
  prover?: VeraKeyProver;
  /** Skip the on-chain proof check; `prover` must then be set. */
  skipOnChainProof?: boolean;
  /** Seconds; defaults to now. */
  now?: number;
  /** Refuse sign-ins valid for longer than this from now (default 300). */
  maxTtlSeconds?: number;
  /** The difference tolerated between the player's device clock and this server's (default 60 s). */
  clockSkewSeconds?: number;
}

const isField = (value: unknown): value is Hex =>
  typeof value === "string" && isHex(value) && value.length === 66 && BigInt(value) < BN254_R;
const isBytes32 = (value: unknown): value is Hex => typeof value === "string" && isHex(value) && value.length === 66;
/** Seconds since 1970, before 2106. */
const isTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 2 ** 32;

/**
 * Checks a sign-in end to end: it was made for this deployment, for this site and its app id, with the nonce the
 * site issued, and it has not expired; the passkey signed exactly this statement on VeraKey's origin; the proof's
 * public inputs are that client data, VeraKey's rpId and the player ID, and the proof verifies; the account is
 * this player's, and still theirs.
 */
export async function verifySignIn(
  result: SignInResult,
  options: VerifySignInOptions
): Promise<{ valid: boolean; checks: SignInCheck[]; playerId: Hex | null; account: Address | null }> {
  const checks: SignInCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  try {
    return await checkSignIn(result, options, checks, check);
  } catch (error) {
    // The result comes from the player's browser: crafted input must be a refusal, never a crash of the site's server.
    check("Checked without errors", false, error instanceof Error ? error.message : String(error));
    return { valid: false, checks, playerId: null, account: null };
  }
}

async function checkSignIn(
  result: SignInResult,
  options: VerifySignInOptions,
  checks: SignInCheck[],
  check: (name: string, ok: boolean, detail?: string) => boolean
): Promise<{ valid: boolean; checks: SignInCheck[]; playerId: Hex | null; account: Address | null }> {
  const refuse = () => ({ valid: false, checks, playerId: null, account: null });
  const s = result?.statement;
  if (!check("Format", result?.version === 1 && typeof s === "object" && s !== null, "not a VeraKey sign-in (v1)")) return refuse();
  const wellFormed =
    isField(s.appId) && isField(s.nullifier) && isBytes32(s.nonce) && isAddress(s.factory) && typeof s.origin === "string" &&
    Number.isSafeInteger(s.chainId) && s.chainId > 0 && isTimestamp(s.issuedAt) && isTimestamp(s.expiresAt) &&
    s.issuedAt <= s.expiresAt &&
    result.playerId === s.nullifier && isAddress(result.account) && Array.isArray(result.publicInputs) &&
    result.publicInputs.length === 6 && isHex(result.clientDataJSON) && isHex(result.proof);
  if (!check("Well-formed fields", wellFormed)) return refuse();

  const { deployment } = options;
  let origin: string | null = null;
  try {
    origin = normalizeOrigin(options.origin);
  } catch {
    // reported by the checks below
  }
  check("This deployment", s.chainId === deployment.chainId && s.factory.toLowerCase() === deployment.factory.toLowerCase(),
    `chain ${s.chainId}, factory ${s.factory}`);
  check("Made for this site", origin !== null && s.origin === origin, `made for ${s.origin}`);
  check("App id of this site", origin !== null && BigInt(s.appId) === appIdFromOrigin(origin));
  check("Carries the nonce you issued", s.nonce.toLowerCase() === options.nonce.toLowerCase());
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  const until = new Date(s.expiresAt * 1000).toISOString();
  check("Not expired", s.expiresAt + skew > now, `expired at ${until}; check the device clock`);
  check("Short-lived", s.expiresAt - now <= (options.maxTtlSeconds ?? SIGN_IN_TTL_SECONDS) + skew,
    `valid until ${until}; check the device clock`);

  const clientData = hexToBytes(result.clientDataJSON);
  let parsed: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown } = {};
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(clientData));
    if (typeof json === "object" && json !== null) parsed = json;
  } catch {
    // reported below
  }
  check("Passkey signed this sign-in",
    parsed.type === "webauthn.get" && parsed.challenge === base64UrlEncode(hexToBytes(signInChallenge(s))));
  check("Signed on VeraKey", parsed.origin === deployment.origin && parsed.crossOrigin !== true, String(parsed.origin));

  const [cdhHi, cdhLo] = limbs(await sha256(clientData));
  const [rpHi, rpLo] = limbs(hexToBytes(deployment.rpIdHash));
  const expected = [cdhHi, cdhLo, rpHi, rpLo, BigInt(s.appId), BigInt(s.nullifier)].map(toFieldHex);
  check("Proof commits to this sign-in",
    result.publicInputs.every((value, i) => isHex(value) && BigInt(value) === BigInt(expected[i])));

  if (!options.skipOnChainProof) {
    const onChain = await options.publicClient
      .readContract({ address: deployment.honkVerifier, abi: honkVerifierAbi, functionName: "verify", args: [result.proof, expected] })
      .catch(() => false);
    check("Proof verifies on-chain (HonkVerifier, eth_call)", onChain === true);
  }
  if (options.prover) {
    const local = await options.prover.verify({ proof: result.proof, publicInputs: expected, provingMs: 0 }).catch(() => false);
    check("Proof verifies locally (bb.js)", local);
  }
  if (options.skipOnChainProof && !options.prover) check("Proof verified", false, "no verifier configured");

  const account = await options.publicClient
    .readContract({ address: deployment.factory, abi: veraKeyFactoryAbi, functionName: "accountAddress", args: [s.appId, s.nullifier] })
    .catch(() => null);
  check("Account of this player", account !== null && account.toLowerCase() === result.account.toLowerCase(), account ?? "unreadable");
  if (account) {
    const code = await options.publicClient.getCode({ address: account }).catch(() => undefined);
    if (code && code !== "0x") {
      const owner = await options.publicClient
        .readContract({ address: account, abi: veraKeyAccountAbi, functionName: "isOwner", args: [s.nullifier] })
        .catch(() => false);
      check("Player still owns the account", owner === true);
    }
  }
  const valid = checks.every(c => c.ok);
  return { valid, checks, playerId: valid ? s.nullifier : null, account: valid ? result.account : null };
}

/** Runs an RPC call, turning any failure (including a malformed argument) into null. */
const attempt = <T>(call: () => Promise<T>): Promise<T | null> => Promise.resolve().then(call).catch(() => null);

/**
 * Checks that transaction `hash` is a successful payment of `amount` from `account` to `to`. A transaction that is
 * sent but not yet in a block is waited for, up to `timeoutMs` (default 30 s).
 */
export async function verifyPayment(
  hash: Hex,
  options: { publicClient: PublicClient; account: Address; to: Address; amount: bigint; timeoutMs?: number }
): Promise<{ valid: boolean; checks: SignInCheck[]; fee: bigint | null }> {
  const checks: SignInCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const client = options.publicClient;
  let receipt = await attempt(() => client.getTransactionReceipt({ hash }));
  if (!receipt && (await attempt(() => client.getTransaction({ hash })))) {
    receipt = await attempt(() => client.waitForTransactionReceipt({ hash, timeout: options.timeoutMs ?? 30_000 }));
  }
  if (!check("Transaction succeeded", receipt?.status === "success", receipt ? receipt.status : "not found")) {
    return { valid: false, checks, fee: null };
  }
  const paid = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "Paid", logs: receipt!.logs }).filter(
    log => log.address.toLowerCase() === options.account.toLowerCase()
  );
  check("Paid by this player's account", paid.length > 0);
  const match = paid.find(log => log.args.to.toLowerCase() === options.to.toLowerCase() && log.args.amount === options.amount);
  check("To this recipient, for this amount", match !== undefined);
  const valid = checks.every(c => c.ok);
  return { valid, checks, fee: valid && match ? match.args.fee : null };
}

/**
 * Finds the payment `account` made with action `nonce` (its `Paid` event), for a payment whose hash never reached
 * the site: `VeraKeyConnectError.pending` says the popup closed while it was being sent. Waits up to `timeoutMs`
 * (default 30 s) for it to land, and returns its transaction hash, or null. Pass `fromBlock` (a block from before the
 * payment) when your RPC limits log queries; the default looks back 10,000 blocks.
 */
export async function findPayment(options: {
  publicClient: PublicClient;
  account: Address;
  nonce: bigint;
  fromBlock?: bigint;
  timeoutMs?: number;
}): Promise<Hex | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const latest = await options.publicClient.getBlockNumber();
    const logs = await options.publicClient.getContractEvents({
      address: options.account,
      abi: veraKeyAccountAbi,
      eventName: "Paid",
      args: { nonce: options.nonce },
      fromBlock: options.fromBlock ?? (latest > 10_000n ? latest - 10_000n : 0n),
      toBlock: latest,
    });
    if (logs[0]) return logs[0].transactionHash;
    if (Date.now() >= deadline) return null;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}
