import { describe, expect, it } from "vitest";
import { contactHref } from "./site";

describe("contactHref", () => {
  it("links an email address with mailto", () => {
    expect(contactHref("team@verakey.example")).toBe("mailto:team@verakey.example");
  });
  it("keeps a web address as it is", () => {
    expect(contactHref("https://verakey.example/contact")).toBe("https://verakey.example/contact");
  });
});
