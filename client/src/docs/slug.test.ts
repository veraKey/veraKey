import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("joins lowercase words with hyphens", () => {
    expect(slugify("How an action is authorized")).toBe("how-an-action-is-authorized");
  });
  it("keeps digits and drops punctuation", () => {
    expect(slugify("ERC-7579 validator")).toBe("erc-7579-validator");
    expect(slugify("  Fees & limits (USDG)  ")).toBe("fees-limits-usdg");
    expect(slugify("POST /api/relay")).toBe("post-api-relay");
    expect(slugify("1. Get the SDK")).toBe("1-get-the-sdk");
  });
  it("strips accents and symbols", () => {
    expect(slugify("Café crème")).toBe("cafe-creme");
    expect(slugify("⌘K search")).toBe("k-search");
  });
});
