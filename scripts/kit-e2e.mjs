// The integration kit in headless Chrome: the React quickstart (examples/react-quickstart), on its own origin, signs
// a player in with <SignInWithVeraKey />, buys a sword for 1 USDG with useVeraKey().pay, keeps the session across a
// reload, and signs out. Its server is createVeraKeyServer. The popup gets a virtual platform passkey with PRF before
// its scripts run. Real proofs and real transactions on a devnode. The CDP harness is connect-e2e.mjs's.
//
//   node scripts/kit-e2e.mjs <siteUrl> [outDir]
//
//   siteUrl  the quickstart, e.g. http://localhost:5192 while `pnpm dev` (VeraKey on :5190, against a devnode
//            deployment) and `pnpm demo:react` run; the relayer needs raised faucet limits for repeated runs
//   outDir   screenshots and kit-results.json (default: a new temporary directory)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [SITE, OUT_ARG] = process.argv.slice(2);
if (!SITE) {
  console.error("usage: node scripts/kit-e2e.mjs <siteUrl> [outDir]");
  process.exit(2);
}
const OUT = OUT_ARG ?? mkdtempSync(path.join(tmpdir(), "verakey-kit-"));
mkdirSync(OUT, { recursive: true });
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "verakey-chrome-"))}`,
  "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const SIGN_IN = `document.querySelector('[data-testid="verakey-sign-in"]')`;
const ERROR = `document.querySelector('[data-testid="verakey-error"]')`;
let ws;

try {
  let browserUrl;
  for (let i = 0; i < 60 && !browserUrl; i++) {
    try { browserUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  ws = new WebSocket(browserUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    for (const listener of listeners) listener(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise(resolve => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (sessionId, expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)).result?.result?.value;
  const waitFor = async (sessionId, expression, ms = 120_000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (sessionId && (await evaluate(sessionId, expression).catch(() => false))) return Date.now() - start;
      await sleep(200);
    }
    throw new Error(`timed out: ${expression.slice(0, 160)}`);
  };
  const hasText = text => `document.body?.innerText.includes(${JSON.stringify(text)})`;
  const button = text => `[...document.querySelectorAll("button")].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled)`;
  const click = async (sessionId, text, ms = 60_000) => {
    await waitFor(sessionId, `!!${button(text)}`, ms);
    await evaluate(sessionId, `${button(text)}.click()`);
  };
  const shot = async (sessionId, name) => {
    if (!sessionId) return;
    const { result } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    if (result?.data) writeFileSync(path.join(OUT, `kit-${name}.png`), Buffer.from(result.data, "base64"));
  };
  const pages = async () => ((await send("Target.getTargets")).result?.targetInfos ?? []).filter(t => t.type === "page").length;

  // Every new page stops before its scripts run. The popup gets a virtual passkey, request recording, and a
  // window.close() that only marks the request done: the next request reuses the same window, and its passkey.
  let site = null;
  let popup = null;
  const popupRequests = [];
  listeners.push(async msg => {
    if (msg.method === "Target.attachedToTarget" && !msg.sessionId) {
      const { sessionId, targetInfo } = msg.params;
      if (targetInfo.type === "page" && targetInfo.openerId) {
        await send("Runtime.enable", {}, sessionId);
        await send("Page.enable", {}, sessionId);
        await send("Network.enable", {}, sessionId);
        await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
        await send("WebAuthn.enable", { enableUI: false }, sessionId);
        await send("WebAuthn.addVirtualAuthenticator", {
          options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
        }, sessionId);
        await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.close = () => { window.__closeRequested = true; };" }, sessionId);
        popup = sessionId;
      } else if (targetInfo.type === "page" && !site) {
        await send("Runtime.enable", {}, sessionId);
        await send("Page.enable", {}, sessionId);
        await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
        site = sessionId;
      }
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    }
    if (msg.method === "Network.requestWillBeSent" && msg.sessionId && msg.sessionId === popup) {
      popupRequests.push(`${msg.params.request.url} ${msg.params.request.postData ?? ""}`.toLowerCase());
    }
  });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (let i = 0; i < 20 && !site; i++) await sleep(100);
  if (!site) {
    const { result } = await send("Target.getTargets");
    const page = result?.targetInfos.find(t => t.type === "page");
    if (page) await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    for (let i = 0; i < 50 && !site; i++) await sleep(100);
  }
  if (!site) throw new Error("no page to drive");

  // Each step builds on the one before, so the first failure skips the rest.
  const step = async (name, fn) => {
    if (results.some(r => !r.ok)) {
      results.push({ step: name, ok: false, skipped: true });
      console.log(`  skip ${name}`);
      return;
    }
    const start = Date.now();
    try {
      const detail = await fn();
      results.push({ step: name, ok: true, ms: Date.now() - start, detail });
      console.log(`  ok   ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    } catch (error) {
      results.push({ step: name, ok: false, ms: Date.now() - start, error: String(error.message ?? error) });
      console.log(`  FAIL ${name} — ${error.message ?? error}`);
      await shot(site, `FAIL-site-${name.replace(/\W+/g, "_")}`).catch(() => {});
      await shot(popup, `FAIL-popup-${name.replace(/\W+/g, "_")}`).catch(() => {});
    }
  };
  const markPopup = () => popup && evaluate(popup, "window.__previous = true");
  const nextPopupDocument = async () => {
    for (let i = 0; i < 100 && !popup; i++) await sleep(100);
    if (!popup) throw new Error("the popup did not open");
    await waitFor(popup, `!window.__previous && ${hasText("Requested by")}`);
  };
  const label = () => evaluate(site, `${SIGN_IN}?.textContent ?? ""`);
  /** Reloads the site and waits for the new document: Page.reload answers before the old one is gone. */
  const reloadSite = async () => {
    await evaluate(site, "window.__beforeReload = true");
    await send("Page.reload", {}, site);
    await waitFor(site, `document.readyState === "complete" && !window.__beforeReload`, 30_000);
  };

  await step("the quickstart loads, and the kit's session route answers", async () => {
    await send("Page.navigate", { url: SITE }, site);
    await waitFor(site, `!!${SIGN_IN} && !${SIGN_IN}.disabled && ${SIGN_IN}.textContent.includes("Sign in with VeraKey")`, 30_000);
    return new URL(SITE).origin;
  });

  let player = null;
  await step("SignInWithVeraKey signs a new player in through one popup, under React StrictMode", async () => {
    await evaluate(site, `${SIGN_IN}.click()`);
    await nextPopupDocument();
    if ((await pages()) !== 2) throw new Error(`${await pages()} pages are open: one click must open one popup`);
    const shown = await evaluate(popup, `document.querySelector("[data-requester]")?.textContent`);
    if (shown !== new URL(SITE).origin) throw new Error(`the popup names ${shown}`);
    await click(popup, "Create a VeraKey passkey");
    await click(popup, "Sign in to", 120_000);
    await waitFor(site, `${SIGN_IN}?.textContent.includes("Sign out") || !!${ERROR}?.textContent`, 180_000);
    if (!(await label()).includes("Sign out")) throw new Error(await evaluate(site, `${ERROR}?.textContent`));
    player = await evaluate(site, `fetch("/api/verakey/session").then(r => r.json()).then(s => s.player)`);
    await shot(site, "signed-in");
    return { label: await label(), account: player?.account };
  });

  await step("no request from the popup carried the player ID during the sign-in", async () => {
    if (!player?.id) throw new Error("no player to check");
    const idHex = player.id.toLowerCase().replace(/^0x/, "");
    const leaks = popupRequests.filter(request => request.includes(idHex));
    if (leaks.length) throw new Error(`leaked in: ${leaks.map(leak => leak.slice(0, 120)).join(" | ")}`);
    return `${popupRequests.length} requests checked`;
  });

  await step("useVeraKey().pay buys a sword: the popup pays 1 USDG, onPayment runs, getPlayer counts it", async () => {
    await markPopup();
    await click(site, "Buy a sword");
    await nextPopupDocument();
    await click(popup, "Unlock with passkey");
    await waitFor(popup, `!!(${button("Get demo USDG")} || ${button("Pay 1.00 USDG")})`, 60_000);
    if (await evaluate(popup, `!!${button("Get demo USDG")}`)) await click(popup, "Get demo USDG");
    await waitFor(popup, `!!${button("Pay 1.00 USDG")}`, 120_000);
    await click(popup, "Pay 1.00 USDG");
    await waitFor(site, `${hasText("Payment verified")} || ${hasText("No payment")}`, 180_000);
    const receipt = await evaluate(site, `document.querySelector('[data-testid="receipt"]').textContent`);
    if (!receipt.includes("Payment verified") || !receipt.includes("Swords: 1")) throw new Error(receipt);
    const swords = await evaluate(site, `fetch("/api/swords").then(r => r.json())`);
    if (swords?.swords !== 1) throw new Error(`/api/swords says ${JSON.stringify(swords)}`);
    await shot(site, "paid");
    return receipt;
  });

  await step("the session survives a reload (the kit's signed cookie)", async () => {
    await reloadSite();
    await waitFor(site, `${SIGN_IN}?.textContent.includes("Sign out") && !${SIGN_IN}.disabled`, 30_000);
    return await label();
  });

  await step("signing out ends the session, also after a reload", async () => {
    await evaluate(site, `${SIGN_IN}.click()`);
    await waitFor(site, `${SIGN_IN}?.textContent.includes("Sign in with VeraKey")`, 30_000);
    await reloadSite();
    await waitFor(site, `${SIGN_IN}?.textContent.includes("Sign in with VeraKey") && !${SIGN_IN}.disabled`, 30_000);
    return await label();
  });

  await step("cancelling in the popup leaves the button as it was, with no error", async () => {
    await markPopup();
    await evaluate(site, `${SIGN_IN}.click()`);
    await nextPopupDocument();
    await click(popup, "Cancel");
    await waitFor(site, `${SIGN_IN}?.textContent.includes("Sign in with VeraKey") && !${SIGN_IN}.disabled`, 30_000);
    const error = await evaluate(site, `${ERROR}.textContent`);
    if (error) throw new Error(`the button shows an error: ${error}`);
    return "cancelled quietly";
  });

  const passed = results.filter(r => r.ok).length;
  writeFileSync(path.join(OUT, "kit-results.json"), JSON.stringify(results, null, 2));
  console.log(`kit: ${passed}/${results.length} steps passed (screenshots in ${OUT})`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.error(`harness: ${error.message ?? error}`);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
}
