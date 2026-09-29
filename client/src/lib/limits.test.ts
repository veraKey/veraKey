import { describe, expect, it } from "vitest";
import { leftToday } from "./limits";

describe("leftToday", () => {
  it("is the daily cap minus today's spending", () => {
    expect(leftToday(25_000_000n, 4_000_000n)).toBe(21_000_000n);
  });

  it("is zero, never negative, when today's spending reached or passed the cap", () => {
    // A cap lowered below today's spending leaves spending above the cap.
    expect(leftToday(1_000_000n, 1_000_000n)).toBe(0n);
    expect(leftToday(1_000_000n, 5_000_000n)).toBe(0n);
  });
});
