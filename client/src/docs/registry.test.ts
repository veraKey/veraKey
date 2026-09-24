import { describe, expect, it } from "vitest";
import { GROUPS, PAGES, findPage, neighbors, pagesByGroup, sectionHref, type DocPage } from "./registry";

const load = async () => ({ default: () => null });
const fixture: DocPage[] = [
  { path: "/docs", title: "Introduction", group: "Get started", description: "d", keywords: [], sections: ["What VeraKey is"], load },
  { path: "/docs/problem", title: "The problem", group: "Get started", description: "d", keywords: [], sections: [], load },
  { path: "/docs/guides/pay", title: "Pay", group: "Use VeraKey", description: "d", keywords: ["payment"], sections: ["Fees"], load },
];

describe("registry", () => {
  it("finds pages with a trailing slash, a query or a hash", () => {
    expect(findPage("/docs/guides/pay/", fixture)?.title).toBe("Pay");
    expect(findPage("/docs/guides/pay?x=1#fees", fixture)?.title).toBe("Pay");
    expect(findPage("/docs/", fixture)?.title).toBe("Introduction");
    expect(findPage("/docs/nope", fixture)).toBeUndefined();
  });
  it("links neighbours in reading order", () => {
    expect(neighbors("/docs", fixture)).toEqual({ prev: undefined, next: fixture[1] });
    expect(neighbors("/docs/guides/pay", fixture).next).toBeUndefined();
    expect(neighbors("/docs/nope", fixture)).toEqual({});
  });
  it("groups pages in sidebar order and drops empty groups", () => {
    expect(pagesByGroup(fixture).map(g => g.group)).toEqual(["Get started", "Use VeraKey"]);
  });
  it("builds section links from headings", () => {
    expect(sectionHref(fixture[2], "Fees")).toBe("/docs/guides/pay#fees");
  });
  it("keeps the real pages unique, under /docs and described", () => {
    const paths = PAGES.map(p => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of PAGES) {
      expect(page.path.startsWith("/docs")).toBe(true);
      expect(page.description.length).toBeGreaterThan(40);
      expect(GROUPS).toContain(page.group);
      expect(new Set(page.sections).size).toBe(page.sections.length);
    }
  });
});
