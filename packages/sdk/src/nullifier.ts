import type { Barretenberg } from "@aztec/bb.js";
import { keccak256, stringToHex, type Hex } from "viem";
import { BN254_R, NULLIFIER_DOMAIN } from "./constants";
import { bigintToBytes32, bytesToBigint, limbs, toFieldHex } from "./bytes";
import type { PasskeyPublicKey } from "./webauthn";

/**
 * `Poseidon2(domain, pk_x, pk_y, prfSecret, appId)` over 128-bit limbs — identical to the circuit's
 * `compute_nullifier`. Without the PRF secret, which never leaves the authenticator, a leaked public
 * key or assertion cannot link one user's accounts across apps.
 */
export async function computeNullifier(
  bb: Barretenberg,
  publicKey: PasskeyPublicKey,
  prfSecret: Uint8Array,
  appId: bigint
): Promise<bigint> {
  if (prfSecret.length !== 32) throw new RangeError("PRF secret must be 32 bytes");
  const [xHi, xLo] = limbs(publicKey.x);
  const [yHi, yLo] = limbs(publicKey.y);
  const [sHi, sLo] = limbs(prfSecret);
  const { hash } = await bb.poseidon2Hash({
    inputs: [NULLIFIER_DOMAIN, xHi, xLo, yHi, yLo, sHi, sLo, appId].map(bigintToBytes32),
  });
  return bytesToBigint(hash);
}

/** A canonical BN254 field element derived from an application name. */
export function appIdFromName(name: string): bigint {
  return BigInt(keccak256(stringToHex(`verakey.app:${name}`))) % BN254_R;
}

export function fieldToHex(value: bigint): Hex {
  return toFieldHex(value);
}
