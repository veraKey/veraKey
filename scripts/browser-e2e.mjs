// The app's user workflow in headless Chrome, driven over the DevTools protocol, with a virtual
// platform passkey that supports PRF. Every step uses the real app, real proofs and real transactions.
//
//   node scripts/browser-e2e.mjs <baseUrl> [outDir] [desktop|mobile] [spc|live]
//
//   baseUrl  the app, e.g. http://localhost:5190 while `pnpm dev` runs against a devnode deployment
//   outDir   screenshots and <tag>-results.json (default: a new temporary directory)
//   spc      Secure Payment Confirmation: Chrome's feature flag, its SPC test mode and a macOS user
//            agent, so the app enrolls the passkey for the payment sheet and pays through it
//   live     a public deployment whose demo faucet may be empty: no funding, payments or policy changes
//
// Needs Node 22 and Chrome or Chromium (CHROME_BIN, default google-chrome). Each run funds one new
// account from the relayer's faucet, which allows 3 per visitor per day by default: for repeated local
// runs, start the relayer with FAUCET_ACCOUNTS_PER_IP and API_REQUESTS_PER_IP_PER_MINUTE raised.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [BASE, OUT_ARG, MODE = "desktop", FLAG] = process.argv.slice(2);
if (!BASE || !["desktop", "mobile"].includes(MODE) || (FLAG && !["spc", "live"].includes(FLAG))) {
  console.error("usage: node scripts/browser-e2e.mjs <baseUrl> [outDir] [desktop|mobile] [spc|live]");
  process.exit(2);
}
const OUT = OUT_ARG ?? mkdtempSync(path.join(tmpdir(), "verakey-browser-"));
mkdirSync(OUT, { recursive: true });
const mobile = MODE === "mobile";
const spc = FLAG === "spc";
// live: the public deployment, where the demo faucet may be empty: no funding, payments or policy changes.
const live = FLAG === "live";
const tag = `${MODE}${spc ? "-spc" : ""}${live ? "-live" : ""}`;
const port = 9100 + Math.floor(Math.random() * 400);
const args = [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "verakey-chrome-"))}`,
  "--window-size=1440,900", "about:blank",
];
if (spc) args.splice(0, 0, "--enable-features=SecurePaymentConfirmationBrowser");
const chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", args, { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const logs = [];
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
  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    if (msg.method === "Runtime.consoleAPICalled") logs.push(msg.params.type + " " + msg.params.args.map(a => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    return res.result?.result?.value;
  };
  const waitFor = async (expression, ms = 90_000) => {
    const start = Date.now();
    while (Date.now() - start < ms) { if (await evaluate(expression)) return Date.now() - start; await sleep(150); }
    throw new Error(`timed out: ${expression.slice(0, 160)}`);
  };
  const shot = async name => {
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT, `${tag}-${name}.png`), Buffer.from(result.data, "base64"));
  };
  const clickText = (text, css = "button, a") => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
  const setInput = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const bodyHas = text => `document.body.textContent.includes(${JSON.stringify(text)})`;
  const go = async href => { await evaluate(`(() => { const a = document.querySelector('a[href="${href}"]'); if (a) { a.click(); return true; } history.pushState({}, "", "${href}"); dispatchEvent(new PopStateEvent("popstate")); return true; })()`); await waitFor(`location.pathname === "${href}"`); await sleep(500); };
  const step = async (name, fn) => {
    const start = Date.now();
    try {
      const detail = await fn();
      results.push({ step: name, ok: true, ms: Date.now() - start, detail });
      console.log(`  ok   ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    } catch (error) {
      const notes = await evaluate(`[...document.querySelectorAll(".vk-note, .vk-reject, [class*=reject]")].map(n => n.textContent.trim()).filter(Boolean).slice(-3)`).catch(() => []);
      results.push({ step: name, ok: false, ms: Date.now() - start, error: String(error.message ?? error), notes });
      console.log(`  FAIL ${name} — ${error.message ?? error}`, notes);
      await shot(`FAIL-${name.replace(/\W+/g, "_")}`).catch(() => {});
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("WebAuthn.enable", { enableUI: false });
  await send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  // Headless pages count as background tabs after screenshots; a user's page is in front. The payment
  // sheet refuses to open in a background tab, so keep the page focused like a real one.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.bringToFront");
  if (spc) {
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" });
    await send("Page.setSPCTransactionMode", { mode: "autoAccept" });
  }
  await send("Emulation.setDeviceMetricsOverride", mobile
    ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }
    : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/app` });

  await step("register passkey and unlock", async () => {
    await waitFor(`!!document.querySelector(".vk-key-card .vk-btn-primary")`);
    await evaluate(`document.querySelector(".vk-key-card .vk-btn-primary").click()`);
    await waitFor(`!!document.querySelector(".vk-session")`);
    const stored = await evaluate(`JSON.parse(localStorage.getItem("verakey.passkeys.v1") ?? "[]")`);
    return `payment-sheet enrolled: ${!!stored[0]?.payment}`;
  });

  await step(live ? "prover ready" : "prover ready and account funded", async () => {
    await waitFor(`(document.querySelector(".vk-pill.is-prover")?.textContent ?? "").includes("Prover ready")`, 120_000);
    if (live) return await evaluate(`document.querySelector(".vk-pill.is-prover").textContent`);
    await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Demo USDG") && !b.disabled)`);
    await clickText("Demo USDG");
    await waitFor(`[...document.querySelectorAll(".vk-balance strong")].some(e => !["0.00", "—"].includes(e.textContent.trim()))`, 120_000);
    return await evaluate(`document.querySelector(".vk-balance strong").textContent`) + " USDG";
  });

  await step("second app derived with nothing in common", async () => {
    await waitFor(bodyHas("Same passkey, another app"));
    // Loaded when the second-app card's address and nullifier cells hold values, not the "…" placeholder.
    const card = `[...document.querySelectorAll(".vk-panel")].find(p => p.textContent.includes("Same passkey, another app"))`;
    const rows = `[...(${card})?.querySelectorAll("tr") ?? []].filter(r => /Account address|Owner nullifier/.test(r.textContent))`;
    await waitFor(`(() => { const r = ${rows}; return r.length >= 2 && r.every(row => [...row.querySelectorAll("td")].slice(1).every(td => td.textContent.trim().length > 3)); })()`, 120_000);
    const cells = await evaluate(`${rows}.map(r => [...r.querySelectorAll("td")].slice(1).map(td => td.textContent.trim()))`);
    const last = cells.slice(-2);
    if (last.some(([a, b]) => !a || !b || a === b)) throw new Error("pay and second app share a value: " + JSON.stringify(last));
    await evaluate(`[...document.querySelectorAll(".vk-panel")].find(p => p.textContent.includes("Same passkey, another app"))?.scrollIntoView()`);
    await sleep(300);
    await shot("accounts-second-app");
    return last;
  });

  await step("receive panel with EIP-681 QR", async () => {
    await clickText("Receive");
    await waitFor(`!!document.querySelector(".vk-qr svg")`);
    await evaluate(`document.querySelector(".vk-receive").scrollIntoView({ block: "center" })`);
    await sleep(300);
    await shot("accounts-receive");
    await clickText("", `.vk-receive-head button`);
    return "qr rendered";
  });

  if (!live) {
    const paid = mobile ? `!!document.querySelector(".vk-mpay-overlay.is-paid")` : `!!document.querySelector(".vk-receipt")`;
    const done = async () => { if (mobile) { await clickText("Done"); await sleep(300); } };

    await step(spc ? "pay merchant through the payment sheet" : "pay merchant with passkey", async () => {
      await send("Page.bringToFront");
      await go("/app/pay");
      await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Approve with passkey") && !b.disabled)`, 60_000);
      if (spc) await waitFor(`!!document.querySelector(".vk-optin input:checked")`, 20_000);
      await clickText("Approve with passkey");
      await waitFor(paid, 150_000);
      await sleep(800);
      await shot("pay-paid");
      const [item] = await evaluate(`JSON.parse(localStorage.getItem("verakey.activity.v1") ?? "[]").slice(-1)`);
      const rpc = await evaluate(`fetch("/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: ["${"$"}{HASH}"] }) }).then(r => r.json()).catch(() => null)`.replace("${HASH}", item.hash));
      const input = rpc?.result?.input ?? "";
      const sheet = input.includes(Buffer.from('"type":"payment.get"').toString("hex"));
      if (spc && !sheet) throw new Error("expected payment.get client data in calldata");
      await done();
      return { provingMs: item.provingMs, gas: item.gasUsed, pkInCalldata: item.publicKeyOccurrences, paymentSheet: sheet };
    });

    if (spc) {
      await step("require the payment sheet, then pay through it again", async () => {
        await go("/app/policy");
        await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Require the payment sheet now") && !b.disabled)`, 30_000);
        await clickText("Require the payment sheet now");
        await waitFor(bodyHas("Stop requiring it"), 150_000);
        await go("/app/pay");
        await waitFor(`!!document.querySelector(".vk-optin input:checked:disabled")`, 30_000);
        // A small amount, so the account can still afford the next steps' 2 USDG attempt.
        await setInput('input[inputmode="decimal"]', "0.5");
        await sleep(300);
        await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Approve with passkey") && !b.disabled)`, 60_000);
        await clickText("Approve with passkey");
        await waitFor(paid, 150_000);
        await sleep(600);
        await shot("pay-sheet-required");
        await done();
        return "sheet required on-chain; payment confirmed in the sheet";
      });
    }

    await step("lower the new-recipient cap at once (restrict)", async () => {
      await go("/app/policy");
      await waitFor(bodyHas("First payment to a new recipient, at most"), 30_000);
      if (!spc) await waitFor(bodyHas("Not available in this browser"), 10_000);
      const input = `[...document.querySelectorAll("label.vk-field")].find(l => l.textContent.includes("First payment to a new recipient, at most")).querySelector("input")`;
      await evaluate(`(() => { const el = ${input}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "1"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(300);
      if (!(await clickText("Lower now"))) throw new Error("no 'Lower now' button");
      await waitFor(bodyHas("at most 1.00 USDG"), 150_000);
      await shot("policy-lowered");
      return "cap 1.00 USDG applied without timelock";
    });

    await step("first payment above the new-recipient cap is refused", async () => {
      await go("/app/pay");
      await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Approve with passkey") && !b.disabled)`, 60_000);
      if (mobile) await clickText("Pay someone else");
      const recipientInput = mobile ? 'input[aria-label="Recipient address"]' : ".vk-main input.is-mono";
      await waitFor(`!!document.querySelector('${recipientInput}')`);
      const stranger = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, "0")).join("");
      await setInput(recipientInput, stranger);
      await setInput('input[inputmode="decimal"]', "2");
      await sleep(300);
      await clickText("Approve with passkey");
      // The rejection note itself (a toast from the Policy step also mentions the cap).
      await waitFor(`[...document.querySelectorAll(".vk-note")].some(n => n.textContent.includes("above the new-recipient cap"))`, 150_000);
      await sleep(400);
      await shot("pay-new-recipient-refused");
      return "NewPayeeCapExceeded shown";
    });

    await step("a change scheduled elsewhere is listed from the chain", async () => {
      await send("Page.bringToFront");
      await go("/app/policy");
      const allow = `[...document.querySelectorAll("label.vk-field")].find(l => l.textContent.includes("Allow a recipient")).querySelector("input")`;
      await waitFor(`!!(${allow})`, 30_000);
      const someone = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, "0")).join("");
      await evaluate(`(() => { const el = ${allow}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "${someone}"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(300);
      if (!(await clickText("Allow", "button"))) throw new Error("no Allow button");
      await waitFor(`[...document.querySelectorAll(".vk-change")].some(c => c.textContent.includes("Allow recipient"))`, 150_000);
      // Forget it locally, as if it had been scheduled on another device (or by a thief).
      await evaluate(`localStorage.removeItem("verakey.changes.v1")`);
      await go("/app");
      await go("/app/policy");
      await waitFor(bodyHas("Not scheduled from this browser"), 60_000);
      await sleep(300);
      await shot("policy-foreign-change");
      const text = await evaluate(`[...document.querySelectorAll(".vk-change")].map(c => c.textContent.trim())`);
      return text;
    });

    await step("freeze stops payments at once and cancels scheduled changes", async () => {
      await waitFor(bodyHas("Freeze payments now"), 30_000);
      await clickText("Freeze payments now");
      await waitFor(bodyHas("Schedule unfreeze"), 150_000);
      await waitFor(bodyHas("Nothing scheduled."), 60_000);
      await shot("policy-frozen");
      await go("/app/pay");
      await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Approve with passkey") && !b.disabled)`, 60_000);
      await clickText("Approve with passkey");
      await waitFor(`[...document.querySelectorAll(".vk-note")].some(n => n.textContent.includes("this account is frozen"))`, 150_000);
      await shot("pay-frozen-refused");
      return "AccountFrozen shown";
    });
  }

  await step("disclose the link by consent and verify it", async () => {
    await go("/app/disclose");
    await waitFor(`!!document.querySelector('input[placeholder="compliance@exchange.example"]')`);
    await setInput('input[placeholder="compliance@exchange.example"]', "auditor@example.test");
    await sleep(200);
    await clickText("Approve disclosure with passkey");
    await waitFor(bodyHas("Ready to share"), 150_000);
    await shot("disclose-ready");
    await clickText("Verify it as the audience would");
    await waitFor(`location.pathname === "/app/verify"`);
    await waitFor(`(document.querySelector("textarea")?.value ?? "").includes("verakey-link-disclosure")`, 20_000);
    await clickText("Verify");
    await waitFor(bodyHas("Valid: one passkey owns both accounts") + " || " + bodyHas("Not valid"), 150_000);
    await sleep(400);
    await shot("verify-result");
    const valid = await evaluate(bodyHas("Valid: one passkey owns both accounts"));
    const checks = await evaluate(`[...document.querySelectorAll(".vk-verify-row")].map(r => (r.querySelector(".is-ok") ? "✓ " : "✗ ") + r.textContent.trim())`);
    if (!valid) throw new Error("verdict not valid: " + JSON.stringify(checks));
    return checks;
  });

  if (!live) {
    await step("private guardian card", async () => {
      await go("/app/recovery");
      await waitFor(`!!document.querySelector('input[placeholder="0x…"]')`, 30_000);
      const guardian = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, "0")).join("");
      await setInput('input[placeholder="0x…"]', guardian);
      await sleep(200);
      await clickText("Set", "button");
      await waitFor(bodyHas("Guardian card for"), 150_000);
      await shot("recovery-guardian-card");
      return "card shown";
    });
  }
} catch (error) {
  results.push({ step: "harness", ok: false, error: String(error.message ?? error) });
  console.log("harness error:", error.message ?? error);
} finally {
  const failures = results.filter(r => !r.ok).length;
  writeFileSync(path.join(OUT, `${tag}-results.json`), JSON.stringify({ tag, results, logs: logs.slice(-20) }, null, 2));
  console.log(`${tag}: ${results.length - failures}/${results.length} steps passed (screenshots in ${OUT})`);
  const errors = logs.filter(l => l.startsWith("error") || l.startsWith("EXCEPTION"));
  if (failures && errors.length) console.log("page errors:", errors.slice(-8));
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  process.exitCode = failures ? 1 : 0;
}
