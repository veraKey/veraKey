import { bytesToHex, hexToBytes, type Hex } from "viem";

export { bytesToHex, hexToBytes, type Hex };

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bigintToBytes32(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new RangeError("value does not fit in 32 bytes");
  return hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt(bytesToHex(bytes));
}

/** Splits 32 bytes into (high, low) 16-byte limbs as integers below 2^128. */
export function limbs(bytes32: Uint8Array): [bigint, bigint] {
  if (bytes32.length !== 32) throw new RangeError("expected 32 bytes");
  return [bytesToBigint(bytes32.subarray(0, 16)), bytesToBigint(bytes32.subarray(16))];
}

export function toFieldHex(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function asBytes(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
