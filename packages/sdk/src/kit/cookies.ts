import { base64UrlDecode, base64UrlEncode } from "../bytes";

/** Signed cookies for the integration kit's server: HMAC-SHA256 with WebCrypto, so they work in Node and edge runtimes. */

const encoder = new TextEncoder();

export function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The MAC of `input`, as 43 base64url characters. */
export async function mac(key: CryptoKey, input: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(input))));
}

/** Whether `tag` is the MAC of `input`; WebCrypto compares in constant time. */
export async function macValid(key: CryptoKey, input: string, tag: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(tag)) return false;
  return crypto.subtle.verify("HMAC", key, base64UrlDecode(tag), encoder.encode(input));
}

/** The cookies of a Cookie header, by name; values stay as sent, since the kit's values need no decoding. */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const item = part.trim();
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const name = item.slice(0, eq).trim();
    if (name && !cookies.has(name)) cookies.set(name, item.slice(eq + 1).trim());
  }
  return cookies;
}

export interface CookieOptions {
  maxAge: number;
  sameSite: "Strict" | "Lax";
  secure: boolean;
}

/** A Set-Cookie value: HttpOnly for the whole site, and Secure on https sites (which `__Host-` names require). */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return `${name}=${value}; Path=/; Max-Age=${options.maxAge}; HttpOnly; SameSite=${options.sameSite}${options.secure ? "; Secure" : ""}`;
}
