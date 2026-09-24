import { createHmac, randomBytes } from "node:crypto";

/**
 * Rate limits need to recognise a returning visitor, not to know who it is. Keys are an HMAC of the IP
 * address under a secret that is random, kept only in memory and replaced every UTC day, so the relayer
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
    return createHmac("sha256", this.secret).update(ip ?? "unknown").digest("base64url").slice(0, 22);
  }
}

/** Fixed-window counters keyed by caller (IP, account, nullifier). In-memory: one relayer process. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Returns true when `key` may make another request now. */
  take(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.sweep(now);
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
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
