import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/**
 * The address a rate limit counts: an IPv4 address as it is (an IPv4-mapped IPv6 one too), and an IPv6 address by
 * its /64. One machine or home usually holds a whole /64, so counting single IPv6 addresses would let a visitor
 * rotate through 2^64 of them and never meet a limit.
 */
export function visitorAddress(ip: string | undefined): string {
  if (!ip) return "unknown";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head, tail] = ip.toLowerCase().split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // A trailing embedded IPv4 address fills two groups.
  const width = (groups: string[]) => groups.reduce((n, group) => n + (group.includes(".") ? 2 : 1), 0);
  const groups = tail === undefined ? left : [...left, ...Array(8 - width(left) - width(right)).fill("0"), ...right];
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

/**
 * Rate limits need to recognise a returning visitor, not to know who it is. Keys are an HMAC of the visitor's address
 * (see `visitorAddress`) under a secret that is random, kept only in memory and replaced every UTC day, so the relayer
 * never holds a list of raw IP addresses and yesterday's keys cannot be linked to today's.
 */
export class VisitorKeys {
  private day = -1;
  private secret = randomBytes(32);

  key(ip: string | undefined): string {
    const today = Math.floor(Date.now() / 86_400_000);
    if (today !== this.day) {
      this.day = today;
      this.secret = randomBytes(32);
    }
    return createHmac("sha256", this.secret).update(visitorAddress(ip)).digest("base64url").slice(0, 22);
  }
}

/** Fixed-window counters keyed by caller (IP, account, nullifier). In-memory: one relayer process. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Returns true when `key` may make `weight` more requests now (e.g. the calls of one JSON-RPC batch). */
  take(key: string, weight = 1): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      if (weight > this.limit) return false;
      this.windows.set(key, { start: now, count: weight });
      this.sweep(now);
      return true;
    }
    if (window.count + weight > this.limit) return false;
    window.count += weight;
    return true;
  }

  private sweep(now: number) {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

/** Serializes async jobs so transactions from one key never race for a nonce. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
