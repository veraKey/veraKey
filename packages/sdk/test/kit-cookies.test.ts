import { describe, expect, it } from "vitest";
import { hmacKey, mac, macValid, parseCookies, serializeCookie } from "../src/kit/cookies";

const INPUT = "verakey-session|https://game.example|payload";

describe("the kit's cookies", () => {
  it("sign with HMAC-SHA256, and refuse a changed input, tag or key", async () => {
    const key = await hmacKey("k".repeat(32));
    const tag = await mac(key, INPUT);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await macValid(key, INPUT, tag)).toBe(true);
    expect(await macValid(key, `${INPUT}!`, tag)).toBe(false);
    expect(await macValid(key, INPUT, `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`)).toBe(false);
    expect(await macValid(await hmacKey("j".repeat(32)), INPUT, tag)).toBe(false);
    expect(await macValid(key, INPUT, "not base64url!")).toBe(false);
  });
  it("read a Cookie header, the first value of a name winning", () => {
    expect(parseCookies("a=1; b=x.y.z; a=2; junk; =v")).toEqual(new Map([["a", "1"], ["b", "x.y.z"]]));
    expect(parseCookies(null).size).toBe(0);
  });
  it("write HttpOnly cookies for the whole site, Secure only when asked", () => {
    expect(serializeCookie("__Host-verakey-session", "v", { maxAge: 60, sameSite: "Lax", secure: true })).toBe(
      "__Host-verakey-session=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure"
    );
    expect(serializeCookie("verakey-nonce", "", { maxAge: 0, sameSite: "Strict", secure: false })).toBe(
      "verakey-nonce=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
    );
  });
});
