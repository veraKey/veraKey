// "Sign in with VeraKey" in headless Chrome: the demo game, on its own origin, signs a player in through VeraKey's
// popup and takes a payment, and the game's server verifies both. The popup gets a virtual platform passkey with
// PRF before its scripts run. Real proofs and real transactions on a devnode.
//
//   node scripts/connect-e2e.mjs <gameUrl> [outDir]
//
//   gameUrl  the demo game, e.g. http://localhost:5191 while `pnpm dev` (VeraKey on :5190, against a devnode
//            deployment) and `pnpm demo:game` run; the relayer needs raised faucet limits for repeated runs
//   outDir   screenshots and connect-results.json (default: a new temporary directory)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [GAME, OUT_ARG] = process.argv.slice(2);
if (!GAME) {
  console.error("usage: node scripts/connect-e2e.mjs <gameUrl> [outDir]");
  process.exit(2);
}
const OUT = OUT_ARG ?? mkdtempSync(path.join(tmpdir(), "verakey-connect-"));
mkdirSync(OUT, { recursive: true });
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "verakey-chrome-"))}`,
  "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
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
  // An enabled button whose label contains `text`; clicks wait for it, since buttons stay disabled while loading.
  const button = text => `[...document.querySelectorAll("button")].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled)`;
  const click = async (sessionId, text, ms = 60_000) => {
    await waitFor(sessionId, `!!${button(text)}`, ms);
    await evaluate(sessionId, `${button(text)}.click()`);
  };
  const shot = async (sessionId, name) => {
    if (!sessionId) return;
    const { result } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    if (result?.data) writeFileSync(path.join(OUT, `connect-${name}.png`), Buffer.from(result.data, "base64"));
  };

  // Every new page stops before its scripts run. The popup gets a virtual passkey, request recording, and a
  // window.close() that only marks the request done: the next request reuses the same window, and its passkey.
  let game = null;
  let popup = null;
  let popupTarget = null;
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
        popupTarget = targetInfo.targetId;
      } else if (targetInfo.type === "page" && !game) {
        await send("Runtime.enable", {}, sessionId);
        await send("Page.enable", {}, sessionId);
        await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
        game = sessionId;
      }
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    }
    if (msg.method === "Network.requestWillBeSent" && msg.sessionId && msg.sessionId === popup) {
      popupRequests.push(`${msg.params.request.url} ${msg.params.request.postData ?? ""}`.toLowerCase());
    }
  });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (let i = 0; i < 20 && !game; i++) await sleep(100);
  if (!game) {
    // Auto-attach covers new targets; attach to the page that already exists if it was not covered.
    const { result } = await send("Target.getTargets");
    const page = result?.targetInfos.find(t => t.type === "page");
    if (page) await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    for (let i = 0; i < 50 && !game; i++) await sleep(100);
  }
  if (!game) throw new Error("no page to drive");

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
      await shot(game, `FAIL-game-${name.replace(/\W+/g, "_")}`).catch(() => {});
      await shot(popup, `FAIL-popup-${name.replace(/\W+/g, "_")}`).catch(() => {});
    }
  };
  /** Marks the popup's current document, so a request that reuses the window can wait for the next one. */
  const markPopup = () => popup && evaluate(popup, "window.__previous = true");
  const nextPopupDocument = async () => {
    for (let i = 0; i < 100 && !popup; i++) await sleep(100);
    if (!popup) throw new Error("the popup did not open");
    await waitFor(popup, `!window.__previous && ${hasText("Requested by")}`);
  };

  await step("the game loads on its own origin", async () => {
    await send("Page.navigate", { url: GAME }, game);
    await waitFor(game, hasText("Sign in with VeraKey"), 30_000);
    // A player ID is public once the account is used on-chain: the game must not call it a secret.
    if (await evaluate(game, hasText("only this game knows"))) throw new Error("the game calls the player ID a secret");
    return new URL(GAME).origin;
  });

  await step("the popup names the game, and proves with threads", async () => {
    await click(game, "Sign in with VeraKey");
    await nextPopupDocument();
    const shown = await evaluate(popup, `document.querySelector("[data-requester]")?.textContent`);
    if (shown !== new URL(GAME).origin) throw new Error(`the popup names ${shown}`);
    if (await evaluate(popup, hasText("only it knows"))) throw new Error("the popup calls the player ID a secret");
    await waitFor(popup, `document.documentElement.dataset.prover === "ready"`, 60_000);
    const isolated = await evaluate(popup, "crossOriginIsolated");
    const threads = Number(await evaluate(popup, "document.documentElement.dataset.proverThreads"));
    await shot(popup, "request");
    if (!isolated || !(threads > 1)) throw new Error(`crossOriginIsolated=${isolated}, prover threads=${threads}`);
    return { requester: shown, isolated, threads };
  });

  let player = null;
  await step("the player creates a passkey and signs in, and the game's server verifies it", async () => {
    await click(popup, "Create a VeraKey passkey");
    await click(popup, "Sign in to", 120_000);
    // What the player approves, while the proof is made: a sign-in, never a disclosure.
    await waitFor(popup, hasText("approves this sign-in"), 30_000);
    if (await evaluate(popup, hasText("disclosure"))) throw new Error("the sign-in screen talks about a disclosure");
    await waitFor(game, `${hasText("Signed in")} || ${hasText("Not signed in")}`, 180_000);
    if (!(await evaluate(game, hasText("Signed in")))) throw new Error(await evaluate(game, `document.querySelector("#status").textContent`));
    player = await evaluate(game, `({ ...document.querySelector("#status").dataset })`);
    await shot(game, "signed-in");
    return { playerId: `${player.playerId.slice(0, 12)}…`, account: player.account };
  });

  await step("no request from the popup carried the player ID, the app id or the nonce", async () => {
    if (!player) throw new Error("no sign-in to check");
    const secrets = [player.playerId, player.appId, player.nonce].map(value => value.toLowerCase().replace(/^0x/, ""));
    const leaks = popupRequests.filter(request => secrets.some(secret => request.includes(secret)));
    if (leaks.length) throw new Error(`leaked in: ${leaks.map(leak => leak.slice(0, 120)).join(" | ")}`);
    return `${popupRequests.length} requests checked`;
  });

  await step("the player pays 1 USDG from the game's account, and the game's server verifies the payment", async () => {
    await markPopup();
    await click(game, "Buy a sword");
    await nextPopupDocument();
    const shown = await evaluate(popup, `document.querySelector("[data-requester]")?.textContent`);
    if (shown !== new URL(GAME).origin) throw new Error(`the payment popup names ${shown}`);
    await click(popup, "Unlock with passkey");
    // A new account has no USDG yet: the popup offers a top-up first.
    await waitFor(popup, `!!(${button("Get demo USDG")} || ${button("Pay 1.00 USDG")})`, 60_000);
    if (await evaluate(popup, `!!${button("Get demo USDG")}`)) {
      await shot(popup, "top-up");
      await click(popup, "Get demo USDG");
    }
    await waitFor(popup, `!!${button("Pay 1.00 USDG")}`, 120_000);
    await shot(popup, "pay");
    await click(popup, "Pay 1.00 USDG");
    // While the payment is under way, it cannot be cancelled, and closing the window asks first (a listener cancels
    // beforeunload).
    const midPayment = `(() => {
      if (!document.querySelector(".vk-step.is-active")) return null;
      const cancel = !!${button("Cancel")};
      const guarded = !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
      return { cancel, guarded };
    })()`;
    await waitFor(popup, `!!${midPayment}`, 10_000);
    const during = await evaluate(popup, midPayment);
    if (during?.cancel || !during?.guarded) throw new Error(`mid-payment: Cancel ${during?.cancel ? "enabled" : "disabled"}, closing ${during?.guarded ? "asks" : "does not ask"}`);
    await waitFor(game, `${hasText("Payment verified")} || ${hasText("No payment")}`, 180_000);
    const receipt = await evaluate(game, `document.querySelector("#receipt").textContent`);
    if (!receipt.includes("Payment verified")) throw new Error(receipt);
    await shot(game, "paid");
    return receipt;
  });

  await step("the popup refuses to pay from another account than the one the site names", async () => {
    await markPopup();
    // A payment request for some other player's account, sent with the SDK from the game's page.
    const { verakeyUrl } = await (await fetch(`${GAME}/game-api/config`)).json();
    const sdk = path.resolve(import.meta.dirname, "../packages/sdk/src/connect.ts");
    await evaluate(game, `import("/@fs${sdk}").then(({ VeraKeyConnect }) => {
      window.__otherAccount = new VeraKeyConnect({ url: ${JSON.stringify(verakeyUrl)} })
        .pay({ to: "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe", amount: 1000000n, account: "0x000000000000000000000000000000000000dEaD" })
        .then(() => "paid", error => error.code);
    })`);
    await nextPopupDocument();
    await click(popup, "Unlock with passkey");
    await waitFor(popup, hasText("different player"), 60_000);
    await shot(popup, "other-account");
    if (await evaluate(popup, `!!${button("Pay ")}`)) throw new Error("the popup offers to pay from another account");
    await click(popup, "Cancel");
    const outcome = await evaluate(game, "window.__otherAccount");
    if (outcome !== "cancelled") throw new Error(`the site got ${outcome}`);
    return "refused, then cancelled";
  });

  await step("cancelling in the popup tells the game 'cancelled'", async () => {
    await markPopup();
    await click(game, "Sign in with VeraKey");
    await nextPopupDocument();
    await click(popup, "Cancel");
    await waitFor(game, hasText("cancelled"));
    return "cancelled";
  });

  await step("closing the popup tells the game 'closed'", async () => {
    await markPopup();
    await click(game, "Sign in with VeraKey");
    await nextPopupDocument();
    await send("Target.closeTarget", { targetId: popupTarget });
    popup = null;
    await waitFor(game, hasText("closed"));
    return "closed";
  });

  await step("a page that sends Cross-Origin-Opener-Policy: same-origin is told 'unavailable', not 'closed'", async () => {
    await send("Page.navigate", { url: `${GAME}/?coop=same-origin` }, game);
    await click(game, "Sign in with VeraKey", 30_000);
    await waitFor(game, `${hasText("unavailable")} || ${hasText("closed")}`, 40_000);
    const status = await evaluate(game, `document.querySelector("#status").textContent`);
    if (!status.includes("unavailable") || !status.includes("Cross-Origin-Opener-Policy")) throw new Error(status);
    return "unavailable";
  });

  const passed = results.filter(r => r.ok).length;
  writeFileSync(path.join(OUT, "connect-results.json"), JSON.stringify(results, null, 2));
  console.log(`connect: ${passed}/${results.length} steps passed (screenshots in ${OUT})`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.error(`harness: ${error.message ?? error}`);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
}
