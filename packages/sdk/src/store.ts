import { bytesToHex, hexToBytes, type Hex } from "viem";
import { base64UrlDecode, base64UrlEncode } from "./bytes";
import type { PasskeyPublicKey } from "./webauthn";

/**
 * What VeraKey remembers about a passkey on this device: its id and public key. Never the PRF
 * output, never an assertion. Losing this cache is harmless: the public key can be recovered from
 * a fresh assertion.
 */
export interface StoredPasskey {
  credentialId: string; // base64url
  publicKey: { x: Hex; y: Hex };
  label: string;
  createdAt: number;
  /** Enrolled for Secure Payment Confirmation in this browser profile. */
  payment?: boolean;
}

export interface PasskeyStore {
  list(): StoredPasskey[];
  get(credentialId: Uint8Array): StoredPasskey | undefined;
  save(passkey: StoredPasskey): void;
  remove(credentialId: string): void;
}

export function toStoredPasskey(credentialId: Uint8Array, publicKey: PasskeyPublicKey, label: string, payment = false): StoredPasskey {
  return {
    credentialId: base64UrlEncode(credentialId),
    publicKey: { x: bytesToHex(publicKey.x), y: bytesToHex(publicKey.y) },
    label,
    createdAt: Date.now(),
    ...(payment ? { payment: true } : {}),
  };
}

export function publicKeyOf(stored: StoredPasskey): PasskeyPublicKey {
  return { x: hexToBytes(stored.publicKey.x), y: hexToBytes(stored.publicKey.y) };
}

export function credentialIdBytes(stored: StoredPasskey): Uint8Array {
  return base64UrlDecode(stored.credentialId);
}

/** `localStorage`-backed store (browser). */
export class LocalPasskeyStore implements PasskeyStore {
  constructor(private readonly key = "verakey.passkeys.v1") {}

  list(): StoredPasskey[] {
    try {
      return JSON.parse(localStorage.getItem(this.key) ?? "[]") as StoredPasskey[];
    } catch {
      return [];
    }
  }

  get(credentialId: Uint8Array): StoredPasskey | undefined {
    const id = base64UrlEncode(credentialId);
    return this.list().find(p => p.credentialId === id);
  }

  save(passkey: StoredPasskey): void {
    const rest = this.list().filter(p => p.credentialId !== passkey.credentialId);
    localStorage.setItem(this.key, JSON.stringify([...rest, passkey]));
  }

  remove(credentialId: string): void {
    localStorage.setItem(this.key, JSON.stringify(this.list().filter(p => p.credentialId !== credentialId)));
  }
}

/** In-memory store (tests, Node). */
export class MemoryPasskeyStore implements PasskeyStore {
  private readonly items = new Map<string, StoredPasskey>();

  list(): StoredPasskey[] {
    return [...this.items.values()];
  }

  get(credentialId: Uint8Array): StoredPasskey | undefined {
    return this.items.get(base64UrlEncode(credentialId));
  }

  save(passkey: StoredPasskey): void {
    this.items.set(passkey.credentialId, passkey);
  }

  remove(credentialId: string): void {
    this.items.delete(credentialId);
  }
}
