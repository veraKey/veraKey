import { bytesToHex, type Hex } from "viem";
import type { PasskeyPublicKey } from "./webauthn";

/**
 * Counts how often any encoding of the passkey public key (either coordinate, raw or as 128-bit
 * limbs) appears in transaction calldata. VeraKey transactions must always return 0: the chain only
 * ever sees the proof, the nullifier and clientDataJSON.
 */
export function countPublicKeyOccurrences(calldata: Hex, publicKey: PasskeyPublicKey): number {
  const haystack = calldata.toLowerCase().slice(2);
  const needles = new Set<string>();
  for (const coordinate of [publicKey.x, publicKey.y]) {
    const hex = bytesToHex(coordinate).slice(2);
    needles.add(hex);
    needles.add(hex.slice(0, 32));
    needles.add(hex.slice(32));
  }
  let count = 0;
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      count += 1;
      from = at + 2;
    }
  }
  return count;
}
