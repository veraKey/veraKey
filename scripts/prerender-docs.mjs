// Prerenders the docs after `vite build` (client/src/docs/prerender.tsx does the work): every page's HTML, which
// the browser hydrates and readers without JavaScript (curl, AI assistants, search engines) read as it is; every
// page as Markdown next to it; and llms.txt and llms-full.txt. The server sends docs/<page>.html for /docs/<page>.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

process.env.NODE_ENV ??= "production";
const { createServer } = await import("vite");

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dist", "public");
const MANIFEST = path.join(OUT, ".vite", "manifest.json");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const template = readFileSync(path.join(OUT, "index.html"), "utf8");
// Links in the Markdown and in llms.txt are absolute, on the origin the docs describe.
const { origin } = JSON.parse(readFileSync(path.join(ROOT, "deployments", "sepolia.json"), "utf8"));

const vite = await createServer({
  configFile: path.join(ROOT, "vite.config.ts"),
  mode: "production",
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false, ws: false },
  // Server rendering needs no browser dependencies: without this, the optimizer would pre-bundle them for
  // production into the cache a running `pnpm dev` serves, and break it (jsxDEV is not a function).
  cacheDir: path.join(ROOT, "node_modules", ".vite-prerender"),
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { prerenderDocs } = await vite.ssrLoadModule("/src/docs/prerender.tsx");
  const files = await prerenderDocs({ template, manifest, origin });
  for (const [file, content] of files) {
    const target = path.join(OUT, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`Prerendered the docs: ${files.size} files.`);
} finally {
  await vite.close();
}
// The manifest was only for this script.
rmSync(path.join(OUT, ".vite"), { recursive: true, force: true });
