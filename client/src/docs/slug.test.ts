import { describe, expect, it } from "vitest";
import { fragmentId, slugify } from "./slug";

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

describe("fragmentId", () => {
  it("decodes a URL fragment into the element id it names", () => {
    expect(fragmentId("#threat-model")).toBe("threat-model");
    expect(fragmentId("#caf%C3%A9")).toBe("café");
    expect(fragmentId("#")).toBe("");
    expect(fragmentId("")).toBe("");
  });
  it("keeps a malformed fragment as it is instead of throwing", () => {
    expect(fragmentId("#50%")).toBe("50%");
    expect(fragmentId("#100%-sure")).toBe("100%-sure");
  });
});
