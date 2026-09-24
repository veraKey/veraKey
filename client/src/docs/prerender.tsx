import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { Router } from "wouter";
import App from "../App";
import { articleMarkdown } from "./markdown";
import { DOCS_UPDATED, PAGES, findPage, pagesByGroup, type DocPage } from "./registry";

// Prerenders the docs at build time (scripts/prerender-docs.mjs loads this module through Vite): every page as
// HTML the browser hydrates, so readers without JavaScript (curl, AI assistants, search engines) get the content,
// every page as Markdown, and llms.txt and llms-full.txt to find them.

export interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
}
/** Vite's build manifest (.vite/manifest.json): chunks by source file, relative to the web root (client/). */
export type Manifest = Record<string, ManifestChunk>;

export interface DocsAssets {
  css: string[];
  modules: string[];
}

/**
 * `element` as static HTML, with every lazy part loaded. Every Suspense boundary stays inline: React would move a
 * large one behind an inline script, which the CSP blocks. A render error fails the build: React would otherwise
 * leave that part's fallback ("Loading…") in the page.
 */
export async function prerenderHtml(element: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(element, {
    progressiveChunkSize: Number.POSITIVE_INFINITY,
    onError: error => void errors.push(error),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of prelude) chunks.push(Buffer.from(chunk));
  if (errors.length) throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  return Buffer.concat(chunks).toString("utf8");
}

/** The whole app at `path`, as the server sends it for the browser to hydrate. */
export function renderApp(path: string): Promise<string> {
  return prerenderHtml(
    <Router ssrPath={path}>
      <App />
    </Router>
  );
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The built index.html, made into this page: its title and description, its docs assets, and the rendered app. */
export function docsDocument(template: string, page: Pick<DocPage, "path" | "title" | "description">, app: string, assets: DocsAssets): string {
  const head = [
    ...assets.css.map(href => `<link rel="stylesheet" crossorigin href="${href}">`),
    ...assets.modules.map(href => `<link rel="modulepreload" crossorigin href="${href}">`),
    `<link rel="alternate" type="text/markdown" href="${page.path}.md">`,
  ];
  const edits: [RegExp, string, string][] = [
    [/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)} · VeraKey Docs</title>`, "title"],
    [/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(page.description)}" />`, "description"],
    [/<\/head>/, `  ${head.join("\n    ")}\n  </head>`, "head"],
    [/<div id="root"><\/div>/, `<div id="root">${app}</div>`, "root element"],
  ];
  return edits.reduce((html, [pattern, replacement, what]) => {
    if (!pattern.test(html)) throw new Error(`index.html has no ${what} to fill`);
    return html.replace(pattern, () => replacement);
  }, template);
}

/**
 * The chunks and styles a docs page needs beyond those index.html already loads: the docs site's, which loads the
 * page (Vite names that chunk by its file, not its source), and the page's own.
 */
export function docsAssets(manifest: Manifest, pageSource: string): DocsAssets {
  const walk = (key: string, into: Set<string>) => {
    if (into.has(key)) return;
    if (!manifest[key]) throw new Error(`no chunk for ${key} in the build manifest`);
    into.add(key);
    for (const dependency of manifest[key].imports ?? []) walk(dependency, into);
  };
  const loaded = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) walk(key, loaded);
  const site = Object.keys(manifest).find(key => manifest[key].dynamicImports?.includes(pageSource));
  if (!site) throw new Error(`no chunk loads ${pageSource} in the build manifest`);
  const needed = new Set<string>();
  walk(site, needed);
  walk(pageSource, needed);
  const keys = [...needed].filter(key => !loaded.has(key));
  const loadedCss = new Set([...loaded].flatMap(key => manifest[key].css ?? []));
  return {
    css: [...new Set(keys.flatMap(key => manifest[key].css ?? []))].filter(file => !loadedCss.has(file)).map(file => `/${file}`),
    modules: keys.map(key => `/${manifest[key].file}`),
  };
}

const SOURCES = import.meta.glob<{ default: unknown }>(["./pages/**/*.tsx", "!./pages/**/*.test.tsx"]);

/** The page's source file, relative to the web root: the key of its chunk in the build manifest. */
export async function pageSource(page: DocPage): Promise<string> {
  const { default: content } = await page.load();
  for (const [file, load] of Object.entries(SOURCES)) {
    if ((await load()).default === content) return `src/docs/${file.slice(2)}`;
  }
  throw new Error(`no source file for ${page.path}`);
}

const INTRO = findPage("/docs")!;

/** llms.txt (llmstxt.org): what VeraKey is, and every docs page by group, as Markdown. */
export function llmsIndex(origin: string): string {
  const lines = [
    "# VeraKey",
    "",
    `> ${INTRO.description}`,
    "",
    `Every page below is Markdown at its address; ${origin}/llms-full.txt holds all of them in one file. The same`,
    `pages are at ${origin}/docs. The SDK is \`@verakey/sdk\` on npm. Last updated ${DOCS_UPDATED}.`,
  ];
  for (const { group, pages } of pagesByGroup()) {
    lines.push("", `## ${group}`, "");
    for (const page of pages) lines.push(`- [${page.title}](${origin}${page.path}.md): ${page.description}`);
  }
  return `${lines.join("\n")}\n`;
}

/** llms-full.txt: every docs page's Markdown in reading order, each with its address. */
export function llmsFull(origin: string, pages: { page: DocPage; markdown: string }[]): string {
  const header = `# VeraKey documentation\n\n> ${INTRO.description}\n\nEvery page of ${origin}/docs, as Markdown. Last updated ${DOCS_UPDATED}.\n`;
  const bodies = pages.map(({ page, markdown }) => {
    const body = markdown.startsWith("# ") ? markdown : `# ${page.title}\n\n${markdown}`;
    return body.replace(/^# .*\n/, heading => `${heading}\nSource: ${origin}${page.path}\n`);
  });
  return [header, ...bodies].join("\n---\n\n");
}

/** Every file the docs add to the built site, by path under the web root. */
export async function prerenderDocs({ template, manifest, origin }: { template: string; manifest: Manifest; origin: string }): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const markdown: { page: DocPage; markdown: string }[] = [];
  for (const page of PAGES) {
    const app = await renderApp(page.path);
    const file = page.path.slice(1);
    files.set(`${file}.html`, docsDocument(template, page, app, docsAssets(manifest, await pageSource(page))));
    const text = articleMarkdown(app, origin + page.path);
    files.set(`${file}.md`, text);
    markdown.push({ page, markdown: text });
  }
  files.set("llms.txt", llmsIndex(origin));
  files.set("llms-full.txt", llmsFull(origin, markdown));
  return files;
}
