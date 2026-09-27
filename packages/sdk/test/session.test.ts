import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { envelope } from "../src/connect";
import { VeraKeySession, VeraKeySessionError } from "../src/session";
import { FakeWindow } from "./fixtures/window";

const VERAKEY = "https://verakey.example";
const MERCHANT: Address = "0x00000000000000000000000000000000000000cc";
const PLAYER = { id: `0x${"2".padStart(64, "0")}` as Hex, account: "0x00000000000000000000000000000000000000aa" as Address };
const NONCE: Hex = `0x${"11".repeat(32)}`;
const HASH: Hex = `0x${"ab".repeat(32)}`;

type Answer = { status?: number; body: unknown } | "offline";

/** The site's server as the page sees it: answers by "METHOD route", and records every call. */
function site(answers: Record<string, (body: any) => Answer>) {
  const calls: { route: string; body: unknown }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = `${init?.method ?? "GET"} ${url.slice(url.lastIndexOf("/") + 1)}`;
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ route, body });
    const answer = answers[route]?.(body) ?? "offline";
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const signedOutSite = (more: Record<string, (body: any) => Answer> = {}) =>
  site({
    "GET session": () => ({ body: { verakeyUrl: VERAKEY, merchant: MERCHANT, player: null } }),
    "POST nonce": () => ({ body: { nonce: NONCE } }),
    "POST sign-in": () => ({ body: { player: PLAYER } }),
    ...more,
  });
const signedInSite = (more: Record<string, (body: any) => Answer> = {}) =>
  signedOutSite({ "GET session": () => ({ body: { verakeyUrl: VERAKEY, merchant: MERCHANT, player: PLAYER } }), ...more });

async function until(check: () => unknown, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function loaded(server: ReturnType<typeof site>, window = new FakeWindow()) {
  const session = new VeraKeySession({ fetch: server.fetch, host: window });
  await session.load();
  return { session, window };
}

/** The popup gets ready, receives the page's request, and answers it with `message`. */
async function answer(window: FakeWindow, message: Record<string, unknown>) {
  window.emit(envelope({ type: "ready" }));
  await until(() => window.request);
  window.emit(envelope({ ...message, id: window.request.id }));
}

describe("VeraKeySession", () => {
  it("loads the player the site's server already knows", async () => {
    const { session } = await loaded(signedInSite());
    expect(session.state).toEqual({ status: "signed-in", player: PLAYER, paying: false, error: null });
    expect((await loaded(signedOutSite())).session.state.status).toBe("signed-out");
  });

  it("tells its subscribers about every change until they stop listening", async () => {
    const server = signedOutSite();
    const session = new VeraKeySession({ fetch: server.fetch, host: new FakeWindow() });
    const seen: string[] = [];
    const stop = session.subscribe(() => seen.push(session.state.status));
    await session.load();
    stop();
    await session.load();
    expect(seen).toEqual(["signed-out"]);
  });

  it("signs in: opens the popup at once, fetches the nonce meanwhile, and has the server verify the result", async () => {
    const server = signedOutSite();
    const { session, window } = await loaded(server);
    const signingIn = session.signIn();
    expect(window.opened).toHaveLength(1);
    expect(session.state.status).toBe("signing-in");
    const result = { version: 1, playerId: PLAYER.id };
    await answer(window, { type: "result", result });
    expect(await signingIn).toEqual(PLAYER);
    expect(session.state).toMatchObject({ status: "signed-in", player: PLAYER, error: null });
    expect(window.request.params).toEqual({ nonce: NONCE });
    expect(server.calls.map(c => c.route)).toEqual(["GET session", "POST nonce", "POST sign-in"]);
    expect(server.calls[2].body).toEqual(result);
  });

  it("resolves null when the player cancels, and keeps no error", async () => {
    const { session, window } = await loaded(signedOutSite());
    const signingIn = session.signIn();
    await answer(window, { type: "error", code: "cancelled", message: "The player cancelled." });
    expect(await signingIn).toBeNull();
    expect(session.state).toMatchObject({ status: "signed-out", error: null });
  });

  it("reports the server's refusal with its checks", async () => {
    const checks = [{ name: "Proof verifies", ok: false, detail: "rejected" }];
    const { session, window } = await loaded(
      signedOutSite({ "POST sign-in": () => ({ status: 401, body: { error: "The sign-in did not verify.", checks } }) })
    );
    const signingIn = session.signIn();
    await answer(window, { type: "result", result: { version: 1 } });
    const error = await signingIn.catch(e => e);
    expect(error).toBeInstanceOf(VeraKeySessionError);
    expect(error).toMatchObject({ code: "server", status: 401, checks, message: "The sign-in did not verify." });
    expect(session.state).toMatchObject({ status: "signed-out", error });
  });

  it("reports its own server's refusal to give a nonce, and the popup closes", async () => {
    const refusal = "Open this site at https://game.example: this request came from http://127.0.0.1:5173.";
    const { session, window } = await loaded(signedOutSite({ "POST nonce": () => ({ status: 403, body: { error: refusal } }) }));
    const error = await session.signIn().catch(e => e);
    expect(error).toMatchObject({ code: "server", status: 403, message: refusal });
    expect(window.popup!.closeCalls).toBe(1);
  });

  it("says when the browser blocks the popup", async () => {
    const window = new FakeWindow();
    window.popup = null;
    const { session } = await loaded(signedOutSite(), window);
    await expect(session.signIn()).rejects.toMatchObject({ code: "blocked" });
    expect(session.state).toMatchObject({ status: "signed-out", error: { code: "blocked" } });
  });

  it("fails a click with network while the site's server is down, and loads again for the next one", async () => {
    let up = false;
    const server = site({ "GET session": () => (up ? { body: { verakeyUrl: VERAKEY, merchant: MERCHANT, player: null } } : "offline") });
    const { session, window } = await loaded(server);
    expect(session.state).toMatchObject({ status: "signed-out", error: { code: "network" } });
    up = true;
    await expect(session.signIn()).rejects.toMatchObject({ code: "network" });
    expect(window.opened).toHaveLength(0);
    await until(() => server.calls.length === 2 && session.state.error === null);
  });

  it("pays the merchant from the signed-in player's account, and returns the server's receipt", async () => {
    const server = signedInSite({ "POST payment": body => ({ body: { hash: body.hash, amount: body.amount, fee: "20000", result: { swords: 1 } } }) });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    expect(session.state.paying).toBe(true);
    await answer(window, { type: "result", result: { version: 1, hash: HASH } });
    expect(await paying).toEqual({ hash: HASH, amount: 1_000_000n, fee: 20_000n, result: { swords: 1 } });
    expect(window.request.params).toEqual({ to: MERCHANT, amount: "1000000", account: PLAYER.account });
    expect(server.calls.at(-1)).toEqual({ route: "POST payment", body: { amount: "1000000", hash: HASH } });
    expect(session.state.paying).toBe(false);
  });

  it("has the server verify a payment the popup sent before it failed", async () => {
    const server = signedInSite({ "POST payment": body => ({ body: { hash: body.hash, amount: body.amount, fee: "0", result: null } }) });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    window.emit(envelope({ type: "ready" }));
    await until(() => window.request);
    window.emit(envelope({ type: "progress", id: window.request.id, stage: "submitted", hash: HASH }));
    window.emit(envelope({ type: "error", id: window.request.id, code: "relay", message: "The relayer stopped answering." }));
    expect((await paying)?.hash).toBe(HASH);
    expect(server.calls.at(-1)?.body).toEqual({ amount: "1000000", hash: HASH });
  });

  it("has the server find a payment the popup may have sent, by its nonce", async () => {
    const server = signedInSite({ "POST payment": () => ({ body: { hash: HASH, amount: "1000000", fee: "0", result: null } }) });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    window.emit(envelope({ type: "ready" }));
    await until(() => window.request);
    window.emit(envelope({ type: "progress", id: window.request.id, stage: "sending", account: PLAYER.account, nonce: "7" }));
    window.emit(envelope({ type: "error", id: window.request.id, code: "relay", message: "The relayer stopped answering." }));
    expect((await paying)?.hash).toBe(HASH);
    expect(server.calls.at(-1)?.body).toEqual({ amount: "1000000", nonce: "7" });
  });

  it("resolves null when the player cancels a payment, or closes the popup before it is sent", async () => {
    const server = signedInSite();
    const { session, window } = await loaded(server);
    const cancelled = session.pay({ amount: 1_000_000n });
    await answer(window, { type: "error", code: "cancelled", message: "The player cancelled." });
    expect(await cancelled).toBeNull();
    const closing = session.pay({ amount: 1_000_000n });
    window.emit(envelope({ type: "ready" }));
    await until(() => window.popup!.sent.length === 2);
    window.popup!.closed = true;
    expect(await closing).toBeNull();
    expect(server.calls.some(c => c.route === "POST payment")).toBe(false);
  });

  it("keeps a payment the server did not accept on the error, and confirmPayment sends it again without a popup", async () => {
    let attempts = 0;
    const server = signedInSite({
      "POST payment": body =>
        ++attempts === 1
          ? { status: 400, body: { error: "The shop is closed for a minute." } }
          : { body: { hash: body.hash, amount: body.amount, fee: "0", result: { swords: 1 } } },
    });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    await answer(window, { type: "result", result: { version: 1, hash: HASH } });
    const error = await paying.catch(e => e);
    expect(error).toBeInstanceOf(VeraKeySessionError);
    expect(error).toMatchObject({ code: "server", message: "The shop is closed for a minute.", payment: { amount: 1_000_000n, hash: HASH } });
    expect(await session.confirmPayment(error.payment)).toEqual({ hash: HASH, amount: 1_000_000n, fee: 0n, result: { swords: 1 } });
    expect(window.opened).toHaveLength(1);
    expect(server.calls.filter(c => c.route === "POST payment").map(c => c.body)).toEqual([
      { amount: "1000000", hash: HASH },
      { amount: "1000000", hash: HASH },
    ]);
  });

  it("keeps a payment known only by its nonce on the error too", async () => {
    const server = signedInSite({ "POST payment": () => "offline" });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    window.emit(envelope({ type: "ready" }));
    await until(() => window.request);
    window.emit(envelope({ type: "progress", id: window.request.id, stage: "sending", account: PLAYER.account, nonce: "7" }));
    window.emit(envelope({ type: "error", id: window.request.id, code: "relay", message: "The relayer stopped answering." }));
    await expect(paying).rejects.toMatchObject({ code: "network", payment: { amount: 1_000_000n, nonce: 7n } });
  });

  it("goes back to signed out when the server says the session ended", async () => {
    const server = signedInSite({ "POST payment": () => ({ status: 401, body: { error: "Sign in first." } }) });
    const { session, window } = await loaded(server);
    const paying = session.pay({ amount: 1_000_000n });
    await answer(window, { type: "result", result: { version: 1, hash: HASH } });
    await expect(paying).rejects.toMatchObject({ code: "signed-out" });
    expect(session.state).toMatchObject({ status: "signed-out", player: null });
  });

  it("refuses to pay before sign-in, and signs out through the server", async () => {
    const { session } = await loaded(signedOutSite());
    await expect(session.pay({ amount: 1n })).rejects.toMatchObject({ code: "signed-out" });
    const server = signedInSite({ "POST sign-out": () => ({ body: {} }) });
    const signedIn = await loaded(server);
    await signedIn.session.signOut();
    expect(signedIn.session.state).toMatchObject({ status: "signed-out", player: null });
    expect(server.calls.at(-1)?.route).toBe("POST sign-out");
  });
});
