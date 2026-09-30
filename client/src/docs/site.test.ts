import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_DESCRIPTION, SITE_TITLE, contactHref } from "./site";

describe("contactHref", () => {
  it("links an email address with mailto", () => {
    expect(contactHref("team@verakey.example")).toBe("mailto:team@verakey.example");
  });
  it("keeps a web address as it is", () => {
    expect(contactHref("https://verakey.example/contact")).toBe("https://verakey.example/contact");
  });
});

describe("the site's own title and description", () => {
  it("match client/index.html, since the docs put them back when a reader leaves the docs", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const decode = (text: string) =>
      text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "")).toBe(SITE_TITLE);
    expect(decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "")).toBe(SITE_DESCRIPTION);
  });
});
