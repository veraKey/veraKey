import { describe, expect, it } from "vitest";
import { PAGES, type DocPage } from "./registry";
import { groupedEntries, rankEntries, searchEntries } from "./search";

const load = async () => ({ default: () => null });
const pages: DocPage[] = [
  { path: "/docs", title: "Introduction", group: "Get started", description: "What it is", keywords: ["overview"], sections: ["What VeraKey is"], load },
  {
    path: "/docs/guides/protect",
    title: "Protect your account",
    group: "Use VeraKey",
    description: "Caps and freeze",
    keywords: ["freeze"],
    sections: ["Freeze", "Scheduled changes"],
    subsections: ["Apply a change"],
    headingKeywords: { "Scheduled changes": ["applyChange"] },
    load,
  },
];

describe("search index", () => {
  it("indexes every page, h2 and h3 heading as a deep link", () => {
    const entries = searchEntries(pages);
    expect(entries.map(e => e.href)).toEqual([
      "/docs", "/docs#what-verakey-is",
      "/docs/guides/protect", "/docs/guides/protect#freeze", "/docs/guides/protect#scheduled-changes", "/docs/guides/protect#apply-a-change",
    ]);
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
    const freeze = entries.find(e => e.href.endsWith("#freeze"))!;
    expect(freeze.subtitle).toBe("Protect your account");
    expect(entries.find(e => e.href.endsWith("#scheduled-changes"))!.keywords).toContain("applyChange");
  });
  it("groups entries in sidebar order", () => {
    expect(groupedEntries(searchEntries(pages)).map(g => g.group)).toEqual(["Get started", "Use VeraKey"]);
  });
});

describe("search ranking", () => {
  const entries = searchEntries(PAGES);
  const first = (query: string) => rankEntries(query, entries)[0]?.href;

  it.each([
    ["Relayer API", "/docs/build/relayer-api"],
    ["Errors", "/docs/reference/errors"],
    ["threat model", "/docs/security#threat-model"],
    ["validator", "/docs/build/erc-7579"],
    ["glossary", "/docs/reference/glossary"],
    ["deploy", "/docs/build/deploy"],
    ["scheduled changes", "/docs/guides/protect#scheduled-changes"],
    ["how it works", "/docs/how-it-works"],
    ["PerTxCapExceeded", "/docs/reference/errors#account-errors"],
    ["NewPayeeCap", "/docs/reference/errors#account-errors"],
    ["pendingChangeIds", "/docs/reference/contracts#account-views"],
    ["factory errors", "/docs/reference/errors#factory-errors"],
  ])("%s opens %s", (query, href) => {
    expect(first(query)).toBe(href);
  });

  it("needs every word of the query to match", () => {
    expect(rankEntries("zzzqqq", entries)).toEqual([]);
    expect(rankEntries("relayer zzzqqq", entries)).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(rankEntries("   ", entries)).toEqual([]);
  });
});
