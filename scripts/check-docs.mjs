// Checks the docs site in headless Chrome:
//   - every page renders at desktop and phone widths without console errors or horizontal scrolling;
//   - tables of prose stack on phones instead of scrolling sideways;
//   - every internal link and #anchor resolves, including search's section deep links;
//   - search opens with Ctrl+K, finds a section and opens it with Enter;
//   - deep links land on their section;
//   - unknown pages show the docs 404;
//   - Deployments works without /api/config.
//   - the docs never load the prover (bb.js, Noir, the CRS or WebAssembly).
//
//   node scripts/check-docs.mjs <baseUrl> [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [BASE, OUT_ARG] = process.argv.slice(2);
if (!BASE) {
  console.error("usage: node scripts/check-docs.mjs <baseUrl> [outDir]");
  process.exit(2);
}
const OUT = OUT_ARG ?? mkdtempSync(path.join(tmpdir(), "verakey-docs-"));
mkdirSync(OUT, { recursive: true });
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "verakey-chrome-"))}`, "about:blank",
], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const fail = what => {
  failures.push(what);
  console.log(`  FAIL ${what}`);
};
let ws;

try {
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === "page"); } catch {}
    await sleep(200);
  }
  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  let pageErrors = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") pageErrors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (expression, ms = 20_000) => {
    const start = Date.now();
    while (Date.now() - start < ms) { if (await evaluate(expression)) return true; await sleep(100); }
    return false;
  };
  const open = async url => {
    pageErrors = [];
    await send("Page.navigate", { url });
    await waitFor(`document.readyState === "complete"`);
    return waitFor(`!!document.querySelector(".dx-article h2, .dx-notfound")`);
  };
  const viewport = (width, height, mobile) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const shot = async name => {
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const ctrlK = () => send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2, windowsVirtualKeyCode: 75 });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  // 1. Desktop: every page in the sidebar renders.
  await viewport(1440, 900, false);
  if (!(await open(`${BASE}/docs`))) fail("/docs did not render");
  const pages = (await evaluate(`[...new Set([...document.querySelectorAll(".dx-sidebar a")].map(a => new URL(a.href).pathname))]`)) ?? [];
  if (!pages.length) fail("no pages in the sidebar");
  // The brand tokens resolve (they also have to reach the drawer and search dialog portals), and lists keep their markers.
  const styles = await evaluate(`({
    token: getComputedStyle(document.documentElement).getPropertyValue("--vk-lime").trim(),
    openApp: getComputedStyle(document.querySelector(".dx-open-app") ?? document.body).backgroundColor,
    list: getComputedStyle(document.querySelector(".dx-article ul") ?? document.body).listStyleType,
    crumb: getComputedStyle(document.querySelector(".dx-crumb") ?? document.body).color,
    lead: getComputedStyle(document.querySelector(".dx-lead") ?? document.body).fontSize,
  })`);
  if (styles?.crumb !== "rgb(115, 228, 210)") fail(`the page group label is not teal (${styles?.crumb})`);
  if (styles?.lead !== "17px") fail(`the lead paragraph is not 17px (${styles?.lead})`);
  if (!styles?.token) fail("the --vk-* design tokens are not defined at the document root");
  if (styles?.openApp !== "rgb(201, 255, 91)") fail(`"Open app" is not lime (${styles?.openApp})`);
  if (styles?.list !== "disc") fail(`article lists have no bullets (${styles?.list})`);
  const ids = new Map();
  const links = [];
  for (const page of pages) {
    // One retry: a dev server compiles a page's chunk on its first request.
    if (!(await open(`${BASE}${page}`)) && !(await open(`${BASE}${page}`))) { fail(`${page}: did not render`); continue; }
    const info = await evaluate(`({
      notFound: !!document.querySelector(".dx-notfound"),
      title: document.querySelector(".dx-page-head h1")?.textContent ?? "",
      ids: [...document.querySelectorAll("[id]")].map(e => e.id),
      links: [...document.querySelectorAll(".dx-article a[href], .dx-toc a[href], .dx-page-foot a[href]")].map(a => a.getAttribute("href")),
      overflow: document.scrollingElement.scrollWidth - innerWidth,
      blockIcons: [...document.querySelectorAll(".dx-article .dx-ext")].filter(e => getComputedStyle(e).display === "block").length,
    })`);
    if (info.notFound) fail(`${page}: shows the docs 404`);
    if (info.blockIcons) fail(`${page}: ${info.blockIcons} external-link icon(s) break onto a line of their own`);
    if (!info.title.trim()) fail(`${page}: no title`);
    if (info.overflow > 1) fail(`${page}: scrolls horizontally by ${info.overflow}px at 1440px`);
    if (pageErrors.length) fail(`${page}: console errors: ${pageErrors.slice(0, 3).join(" | ")}`);
    ids.set(page, new Set(info.ids));
    for (const href of info.links) links.push({ from: page, href });
  }

  // 2. Links and anchors, including every search deep link.
  await open(`${BASE}/docs`);
  await ctrlK();
  if (!(await waitFor(`!!document.querySelector("[cmdk-item]")`, 5_000))) fail("Ctrl+K did not open search");
  const searchHrefs = (await evaluate(`[...document.querySelectorAll("[cmdk-item][data-href]")].map(e => e.dataset.href)`)) ?? [];
  for (const href of searchHrefs) links.push({ from: "search", href });
  for (const { from, href } of links) {
    if (!href || /^(https?:|mailto:)/.test(href)) continue;
    const [target, hash] = href.startsWith("#") ? [from, href.slice(1)] : href.split("#");
    if (!target.startsWith("/docs")) continue;
    const page = target.replace(/\/+$/, "") || "/docs";
    if (!ids.has(page)) (process.env.DOCS_ALLOW_MISSING ? console.log(`  warn ${from}: link to ${href}: page not written yet`) : fail(`${from}: link to ${href}: no such page`));
    else if (hash && !ids.get(page).has(decodeURIComponent(hash))) fail(`${from}: link to ${href}: no such anchor`);
  }

  // 3. Search: typing finds the protection guide, Enter opens the selected result.
  await evaluate(`(() => { const i = document.querySelector("[cmdk-input]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "freeze"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(300);
  await shot("desktop-search");
  const top = (await evaluate(`[...document.querySelectorAll("[cmdk-item][data-href]")].slice(0, 3).map(e => e.dataset.href)`)) ?? [];
  if (pages.includes("/docs/guides/protect") && !top.some(h => h.startsWith("/docs/guides/protect"))) fail(`search "freeze": top results ${JSON.stringify(top)}`);
  const selected = (await evaluate(`document.querySelector("[cmdk-item][data-selected=true]")?.dataset.href ?? ""`)) ?? "";
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  if (selected && !(await waitFor(`location.pathname === ${JSON.stringify(selected.split("#")[0])}`, 5_000))) fail(`search: Enter did not open ${selected}`);
  // "/" opens search when no text field has focus; Escape closes it.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "/", code: "Slash", windowsVirtualKeyCode: 191 });
  if (!(await waitFor(`!!document.querySelector("[cmdk-input]")`, 3_000))) fail('"/" did not open search');
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  if (!(await waitFor(`!document.querySelector("[cmdk-input]")`, 3_000))) fail("Escape did not close search");

  // 4. A deep link opened directly lands on its section.
  const deep = searchHrefs.find(h => h.startsWith("/docs/security#")) ?? searchHrefs.find(h => h.includes("#"));
  if (deep) {
    await open(`${BASE}${deep}`);
    await sleep(800);
    const y = await evaluate(`document.getElementById(${JSON.stringify(decodeURIComponent(deep.split("#")[1]))})?.getBoundingClientRect().top ?? -1`);
    if (y < 0 || y > 200) fail(`deep link ${deep}: section at ${y}px`);
  }

  // 5. Unknown pages show the docs 404.
  await open(`${BASE}/docs/does-not-exist`);
  if (!(await evaluate(`!!document.querySelector(".dx-notfound")`))) fail("/docs/does-not-exist: no docs 404");

  // 6. Deployments without /api/config still lists the Arbitrum Sepolia contracts.
  if (pages.includes("/docs/reference/deployments")) {
    await send("Network.setBlockedURLs", { urls: ["*/api/config*"] });
    await open(`${BASE}/docs/reference/deployments`);
    if (!(await waitFor(`/0x[0-9a-fA-F]{40}/.test(document.querySelector(".dx-article")?.textContent ?? "")`, 5_000))) fail("deployments: no addresses without /api/config");
    await send("Network.setBlockedURLs", { urls: [] });
  }

  // 7. Phone width: nothing scrolls the page sideways.
  await viewport(390, 844, true);
  for (const page of pages) {
    await open(`${BASE}${page}`);
    const overflow = await evaluate(`document.scrollingElement.scrollWidth - innerWidth`);
    if (overflow > 1) fail(`${page}: scrolls horizontally by ${overflow}px at 390px`);
    // Tables of prose must read without sideways scrolling; tables of numbers may scroll.
    const prose = await evaluate(`[...document.querySelectorAll(".dx-table-wrap")].filter(w => w.scrollWidth - w.clientWidth > 1 && [...w.querySelectorAll("td")].some(td => td.textContent.length > 80)).length`);
    if (prose) fail(`${page}: ${prose} table(s) of prose scroll sideways at 390px`);
    if (pageErrors.length) fail(`${page} (phone): console errors: ${pageErrors.slice(0, 3).join(" | ")}`);
  }
  await open(`${BASE}/docs`);
  await shot("phone-introduction");
  await viewport(1440, 900, false);
  for (const page of ["/docs", "/docs/how-it-works", "/docs/build/quickstart", "/docs/architecture", "/docs/security"]) {
    if (!pages.includes(page)) continue;
    await open(`${BASE}${page}`);
    await shot(`desktop${page.replace(/\//g, "-")}`);
  }

  // 8. The docs never load the prover: no bb.js, Noir, CRS or WebAssembly (the app does, on /app).
  const PROVER = /barretenberg|@aztec|@noir-lang|bb\.js|\/crs\/|\.wasm(\?|$)/i;
  for (const page of ["/docs", "/docs/reference/deployments"]) {
    await open(`${BASE}${page}`);
    await sleep(1_000);
    const loaded = ((await evaluate(`performance.getEntriesByType("resource").map(r => r.name)`)) ?? []).filter(name => PROVER.test(name));
    if (loaded.length) fail(`${page}: loads the prover (${loaded.slice(0, 2).join(", ")})`);
  }
  console.log(`${pages.length} pages, ${links.length} links checked: ${failures.length ? `${failures.length} problem(s)` : "no problems"} (screenshots in ${OUT})`);
} catch (error) {
  fail(`harness: ${error.message ?? error}`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  process.exitCode = failures.length ? 1 : 0;
}
