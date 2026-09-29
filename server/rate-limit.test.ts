import { describe, expect, it } from "vitest";
import { RateLimiter, VisitorKeys, visitorAddress } from "./rate-limit";

describe("visitorAddress", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(visitorAddress("203.0.113.5")).toBe("203.0.113.5");
  });

  it("reads an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(visitorAddress("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("groups IPv6 addresses by their /64, which one machine usually holds whole", () => {
    expect(visitorAddress("2001:db8:1:2::1")).toBe(visitorAddress("2001:db8:1:2:ffff:ffff:ffff:fffe"));
    expect(visitorAddress("2001:0db8:0001:0002:0000:0000:0000:0009")).toBe(visitorAddress("2001:db8:1:2::9"));
    expect(visitorAddress("2001:db8:1:2::1")).not.toBe(visitorAddress("2001:db8:1:3::1"));
  });

  it("handles a missing or odd address without throwing", () => {
    expect(visitorAddress(undefined)).toBe("unknown");
    expect(visitorAddress("not an address")).toBe("not an address");
  });
});

describe("VisitorKeys", () => {
  it("gives every address of one IPv6 /64 the same key", () => {
    const visitors = new VisitorKeys();
    expect(visitors.key("2001:db8:1:2::1")).toBe(visitors.key("2001:db8:1:2::abcd"));
    expect(visitors.key("2001:db8:1:2::1")).not.toBe(visitors.key("2001:db8:1:3::1"));
  });
});

describe("RateLimiter", () => {
  it("rotating addresses inside one /64 does not reset a visitor's allowance", () => {
    const visitors = new VisitorKeys();
    const faucet = new RateLimiter(3, 24 * 60 * 60_000);
    const allowed = Array.from({ length: 10 }, (_, i) => faucet.take(`faucet:${visitors.key(`2001:db8:1:2::${(i + 1).toString(16)}`)}`));
    expect(allowed).toEqual([true, true, true, false, false, false, false, false, false, false]);
  });

  it("counts a weighted request as that many requests", () => {
    const rpc = new RateLimiter(10, 60_000);
    expect(rpc.take("a", 6)).toBe(true);
    expect(rpc.take("a", 5)).toBe(false);
    expect(rpc.take("a", 4)).toBe(true);
    expect(rpc.take("a")).toBe(false);
  });
});
