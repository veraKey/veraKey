import { concat, encodeAbiParameters, getContractAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { toFieldHex } from "./bytes";
import { BN254_R } from "./constants";

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
