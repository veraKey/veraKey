import { existsSync } from "node:fs";
import { lazy, Suspense } from "react";
import { describe, expect, it } from "vitest";
import { articleMarkdown } from "./markdown";
import { docsAssets, docsDocument, llmsFull, llmsIndex, pageSource, prerenderHtml, renderApp, type Manifest } from "./prerender";
import { GROUPS, PAGES } from "./registry";

const ORIGIN = "https://verakey.mdloglabs.org";
const signIn = PAGES.find(page => page.path === "/docs/build/sign-in")!;

describe("prerendering the docs", () => {
  it("renders every page whole on the server, as the browser hydrates it: content, navigation and no loading state", async () => {
    for (const page of PAGES) {
      const html = await renderApp(page.path);
      expect(html, page.path).toContain(`<h1>${page.title.replace(/&/g, "&amp;")}</h1>`);
      expect(html, page.path).not.toContain("Loading…");
      // The CSP allows no inline script, so the content must not wait for one.
      expect(html, page.path).not.toMatch(/<script|<template|<[^>]*\shidden[\s=>]/);
      expect(html, page.path).toContain('href="/docs/reference/deployments"');
    }
  }, 60_000);

  it("fails, rather than write a page that only says Loading…, when a page throws while it renders", async () => {
    const Broken = lazy(async () => ({
      default: () => {
        throw new Error("the page broke");
      },
    }));
    const page = (
      <Suspense fallback={<p>Loading…</p>}>
        <Broken />
      </Suspense>
    );
    await expect(prerenderHtml(page)).rejects.toThrow(/the page broke/);
  });

  it("reads a page's Markdown from its article: code with its language, tables, and no site navigation", async () => {
    const text = articleMarkdown(await renderApp(signIn.path), ORIGIN + signIn.path);
    expect(text.startsWith("# Sign in with VeraKey\n\n")).toBe(true);
    for (const part of ["## Test your integration", '```ts title="game.ts"', "| `request` |", "[Deployments](https://verakey.mdloglabs.org/docs/reference/deployments)"]) {
      expect(text).toContain(part);
    }
    expect(text).not.toMatch(/Search docs|Skip to content|Open app/);
  });

  it("puts the page into the built index.html, with its title, description, docs styles and Markdown link", () => {
    const template =
      '<!doctype html><html lang="en" class="dark"><head><meta name="description" content="The app." />' +
      "<title>VeraKey</title></head><body><div id=\"root\"></div></body></html>";
    const html = docsDocument(template, signIn, "<main>content</main>", { css: ["/assets/DocsSite.css"], modules: ["/assets/DocsSite.js"] });
    expect(html).toContain("<title>Sign in with VeraKey · VeraKey Docs</title>");
    expect(html).toContain(`<meta name="description" content="${signIn.description}" />`);
    expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/DocsSite.css">[\s\S]*<\/head>/);
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/DocsSite.js">');
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="/docs/build/sign-in.md">');
    expect(html).toContain('<div id="root"><main>content</main></div>');
    expect(() => docsDocument(template.replace('<div id="root"></div>', ""), signIn, "", { css: [], modules: [] })).toThrow(/root/);
  });

  it("preloads the chunks and styles a docs page needs beyond those index.html loads", () => {
    // As Vite writes it: the docs site's chunk is named by its file, and it loads each page's chunk.
    const manifest: Manifest = {
      "index.html": { file: "assets/index.js", isEntry: true, imports: ["_vendor.js"], css: ["assets/index.css"], dynamicImports: ["_DocsSite-1.js"] },
      "_vendor.js": { file: "assets/vendor.js" },
      "_components.js": { file: "assets/components.js", imports: ["_vendor.js"] },
      "_DocsSite-1.js": {
        file: "assets/DocsSite.js", isDynamicEntry: true, imports: ["index.html", "_components.js"],
        dynamicImports: ["src/docs/pages/developers/SignIn.tsx"], css: ["assets/DocsSite.css"],
      },
      "src/docs/pages/developers/SignIn.tsx": { file: "assets/SignIn.js", isDynamicEntry: true, imports: ["_DocsSite-1.js", "index.html"] },
    };
    expect(docsAssets(manifest, "src/docs/pages/developers/SignIn.tsx")).toEqual({
      css: ["/assets/DocsSite.css"],
      modules: ["/assets/DocsSite.js", "/assets/components.js", "/assets/SignIn.js"],
    });
    expect(() => docsAssets(manifest, "src/docs/pages/Missing.tsx")).toThrow(/Missing/);
  });

  it("finds each page's source file, which names its chunk in the build manifest", async () => {
    for (const page of PAGES) {
      const source = await pageSource(page);
      expect(source, page.path).toMatch(/^src\/docs\/pages\/.+\.tsx$/);
      expect(existsSync(new URL(`../../${source}`, import.meta.url)), source).toBe(true);
    }
  });

  it("lists every page in llms.txt by group, with its Markdown address and description", () => {
    const index = llmsIndex(ORIGIN);
    expect(index).toMatch(/^# VeraKey\n\n> One passkey, unlinkable on-chain identities/);
    expect(index).toContain(`${ORIGIN}/llms-full.txt`);
    for (const group of GROUPS) expect(index).toContain(`\n## ${group}\n`);
    for (const page of PAGES) expect(index).toContain(`- [${page.title}](${ORIGIN}${page.path}.md): ${page.description}`);
  });

  it("puts every page in llms-full.txt, each with its address", () => {
    const full = llmsFull(ORIGIN, PAGES.map(page => ({ page, markdown: `# ${page.title}\n\nText of ${page.path}.\n` })));
    for (const page of PAGES) expect(full).toContain(`# ${page.title}\n\nSource: ${ORIGIN}${page.path}\n\nText of ${page.path}.`);
  });
});
