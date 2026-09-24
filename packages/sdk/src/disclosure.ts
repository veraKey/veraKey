import {
  encodeAbiParameters,
  isAddress,
  isHex,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { veraKeyAccountAbi, veraKeyFactoryAbi } from "./abi";
import { base64UrlEncode, hexToBytes, limbs, sha256, toFieldHex } from "./bytes";
import { BN254_R } from "./constants";
import type { LinkProver } from "./link-prover";

/**
 * "Linkable by consent". VeraKey accounts in different apps share nothing on-chain; a disclosure is how
 * their owner proves to a chosen party that two of them belong to the same passkey. The passkey signs a
 * statement naming both apps and nullifiers, the audience, a nonce and an expiry; a zero-knowledge proof
 * (circuits/link) shows that one hidden passkey owns both nullifiers and made that signature.
 */
export const LINK_DISCLOSURE_TYPEHASH = keccak256(
  stringToHex(
    "VeraKeyLinkDisclosure(uint256 chainId,address factory,bytes32 appIdA,bytes32 nullifierA,bytes32 appIdB,bytes32 nullifierB,bytes32 audience,bytes32 nonce,uint64 expiresAt)"
  )
);

export interface LinkStatement {
  chainId: number;
  /** The factory whose accounts are being linked. */
  factory: Address;
  appIdA: Hex;
  nullifierA: Hex;
  appIdB: Hex;
  nullifierB: Hex;
  /** Who the disclosure is for, e.g. "compliance@exchange.example"; hashed into the challenge. */
  audience: string;
  /** 32 bytes, ideally chosen by the audience so an old disclosure cannot be replayed to it. */
  nonce: Hex;
  /** Unix seconds after which verifiers must refuse the disclosure. */
  expiresAt: number;
}

export interface DisclosurePackage {
  kind: "verakey-link-disclosure";
  version: 1;
  statement: LinkStatement;
  /** Human labels only; never used for verification. */
  labels?: { appA?: string; appB?: string };
  origin: string;
  clientDataJSON: Hex;
  proof: Hex;
  publicInputs: Hex[];
}

/** The WebAuthn challenge the passkey signs for `statement`. */
export function linkDisclosureChallenge(statement: LinkStatement): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      [
        LINK_DISCLOSURE_TYPEHASH,
        BigInt(statement.chainId),
        statement.factory,
        statement.appIdA,
        statement.nullifierA,
        statement.appIdB,
        statement.nullifierB,
        keccak256(stringToHex(statement.audience)),
        statement.nonce,
        BigInt(statement.expiresAt),
      ]
    )
  );
}

export interface DisclosureCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface DisclosedAccount {
  appId: Hex;
  nullifier: Hex;
  address: Address;
  deployed: boolean;
  /** `null` while the account is not deployed (the address is still bound to the nullifier). */
  ownedByNullifier: boolean | null;
}

export interface DisclosureVerdict {
  valid: boolean;
  checks: DisclosureCheck[];
  accounts: { a: DisclosedAccount; b: DisclosedAccount } | null;
}

/** Longest remaining validity a verifier accepts by default: disclosures are made for days, not months. */
export const MAX_DISCLOSURE_TTL_SECONDS = 7 * 86_400;

export interface VerifyDisclosureOptions {
  publicClient: PublicClient;
  chainId: number;
  factory: Address;
  rpIdHash: Hex;
  origin: string;
  /**
   * Who is verifying, exactly as the disclosure must name them. A disclosure can be forwarded; this is
   * what makes one made for someone else fail.
   */
  audience: string;
  /** The nonce the verifier asked the owner to include, if it asked for one. */
  nonce?: Hex;
  /** Refuse disclosures valid for longer than this from now (default 7 days). */
  maxTtlSeconds?: number;
  /** The on-chain `LinkHonkVerifier`; checked with `eth_call`, no transaction. */
  linkVerifier?: Address;
  /** Local verification with bb.js, for audiences that do not want to trust an RPC. */
  linkProver?: LinkProver;
  /** Seconds; defaults to now. */
  now?: number;
}

const verifierAbi = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes" }, { name: "", type: "bytes32[]" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const isField = (value: Hex) => isHex(value) && value.length === 66 && BigInt(value) < BN254_R;

/**
 * Checks a disclosure end to end: the statement is for this deployment and not expired; the signed
 * client data is a `webauthn.get` for the VeraKey origin whose challenge is the statement; the proof's
 * public inputs are that client data, this rpId and the two claimed nullifiers; the proof verifies; and
 * each nullifier's account address comes from the factory (and, once deployed, is owned by it).
 */
export async function verifyDisclosure(pkg: DisclosurePackage, options: VerifyDisclosureOptions): Promise<DisclosureVerdict> {
  const checks: DisclosureCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const s = pkg?.statement;
  if (!check("Format", pkg?.kind === "verakey-link-disclosure" && pkg.version === 1 && !!s, "not a VeraKey link disclosure (v1)")) {
    return { valid: false, checks, accounts: null };
  }
  const wellFormed =
    [s.appIdA, s.nullifierA, s.appIdB, s.nullifierB].every(isField) &&
    isHex(s.nonce) && s.nonce.length === 66 && isAddress(s.factory) &&
    Array.isArray(pkg.publicInputs) && pkg.publicInputs.length === 8 && isHex(pkg.clientDataJSON) && isHex(pkg.proof);
  if (!check("Well-formed fields", wellFormed)) return { valid: false, checks, accounts: null };

  check("This deployment", s.chainId === options.chainId && s.factory.toLowerCase() === options.factory.toLowerCase(),
    `chain ${s.chainId}, factory ${s.factory}`);
  check("Two different apps", s.appIdA.toLowerCase() !== s.appIdB.toLowerCase());
  check("Made for this audience", typeof s.audience === "string" && s.audience.trim() !== "" && s.audience === options.audience.trim(),
    `made for "${s.audience}"`);
  if (options.nonce !== undefined) {
    check("Carries the nonce you asked for", s.nonce.toLowerCase() === options.nonce.toLowerCase(), `nonce ${s.nonce}`);
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  check("Not expired", s.expiresAt > now, new Date(s.expiresAt * 1000).toISOString());
  const maxTtl = options.maxTtlSeconds ?? MAX_DISCLOSURE_TTL_SECONDS;
  check("Short-lived", s.expiresAt - now <= maxTtl, `valid until ${new Date(s.expiresAt * 1000).toISOString()}`);

  // The signed client data must be a plain passkey assertion for the VeraKey origin, over the statement.
  const clientData = hexToBytes(pkg.clientDataJSON);
  let parsed: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean } = {};
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientData));
  } catch {
    // reported below
  }
  const expectedChallenge = base64UrlEncode(hexToBytes(linkDisclosureChallenge(s)));
  check("Passkey signed this statement", parsed.type === "webauthn.get" && parsed.challenge === expectedChallenge,
    parsed.type === "webauthn.get" ? undefined : "client data is not a webauthn.get assertion");
  check("Signed on the VeraKey origin", parsed.origin === options.origin && parsed.crossOrigin !== true, parsed.origin);

  const [cdhHi, cdhLo] = limbs(await sha256(clientData));
  const [rpHi, rpLo] = limbs(hexToBytes(options.rpIdHash));
  const expectedInputs = [cdhHi, cdhLo, rpHi, rpLo, BigInt(s.appIdA), BigInt(s.nullifierA), BigInt(s.appIdB), BigInt(s.nullifierB)].map(toFieldHex);
  check("Proof commits to this statement", pkg.publicInputs.every((value, i) => BigInt(value) === BigInt(expectedInputs[i])));

  if (options.linkVerifier) {
    const onChain = await options.publicClient
      .readContract({ address: options.linkVerifier, abi: verifierAbi, functionName: "verify", args: [pkg.proof, expectedInputs] })
      .catch(() => false);
    check("Proof verifies on-chain (LinkHonkVerifier, eth_call)", onChain);
  }
  if (options.linkProver) {
    const local = await options.linkProver.verify({ proof: pkg.proof, publicInputs: expectedInputs }).catch(() => false);
    check("Proof verifies locally (bb.js)", local);
  }
  if (!options.linkVerifier && !options.linkProver) check("Proof verified", false, "no verifier configured");

  const describe = async (appId: Hex, nullifier: Hex): Promise<DisclosedAccount> => {
    const address = await options.publicClient.readContract({
      address: options.factory, abi: veraKeyFactoryAbi, functionName: "accountAddress", args: [appId, nullifier],
    });
    const code = await options.publicClient.getCode({ address });
    const deployed = !!code && code !== "0x";
    const ownedByNullifier = deployed
      ? await options.publicClient.readContract({ address, abi: veraKeyAccountAbi, functionName: "isOwner", args: [nullifier] })
      : null;
    return { appId, nullifier, address, deployed, ownedByNullifier };
  };
  const accounts = { a: await describe(s.appIdA, s.nullifierA), b: await describe(s.appIdB, s.nullifierB) };
  check("Accounts still owned by these nullifiers", accounts.a.ownedByNullifier !== false && accounts.b.ownedByNullifier !== false);

  return { valid: checks.every(c => c.ok), checks, accounts };
}
