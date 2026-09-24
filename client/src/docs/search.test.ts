import { describe, expect, it } from "vitest";
import type { DocPage } from "./registry";
import { groupedEntries, searchEntries } from "./search";

const load = async () => ({ default: () => null });
const pages: DocPage[] = [
  { path: "/docs", title: "Introduction", group: "Get started", description: "What it is", keywords: ["overview"], sections: ["What VeraKey is"], load },
  { path: "/docs/guides/protect", title: "Protect your account", group: "Use VeraKey", description: "Caps and freeze", keywords: ["freeze"], sections: ["Freeze", "Scheduled changes"], load },
];

describe("search", () => {
  it("indexes every page and every section as a deep link", () => {
    const entries = searchEntries(pages);
    expect(entries.map(e => e.href)).toEqual([
      "/docs", "/docs#what-verakey-is", "/docs/guides/protect", "/docs/guides/protect#freeze", "/docs/guides/protect#scheduled-changes",
    ]);
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
    const freeze = entries.find(e => e.href.endsWith("#freeze"))!;
    expect(freeze.subtitle).toBe("Protect your account");
    expect(freeze.keywords).toContain("freeze");
  });
  it("groups entries in sidebar order", () => {
    expect(groupedEntries(searchEntries(pages)).map(g => g.group)).toEqual(["Get started", "Use VeraKey"]);
  });
});
