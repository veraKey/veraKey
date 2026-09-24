import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  CONNECT_WINDOW,
  VeraKeyConnect,
  VeraKeyConnectError,
  acceptRequest,
  envelope,
  isAllowedRequesterOrigin,
  type ConnectHost,
} from "../src/connect";

const VERAKEY = "https://verakey.example";
const NONCE: Hex = `0x${"11".repeat(32)}`;
const MERCHANT = "0x00000000000000000000000000000000000000cc";
const PLAYER = "0x00000000000000000000000000000000000000aa";

class FakePopup {
  closed = false;
  sent: { message: any; target: string }[] = [];
  postMessage(message: unknown, target: string) {
    this.sent.push({ message, target });
  }
}

/** Stands in for the site's `window`: records the popup it opens and delivers the popup's messages. */
class FakeWindow implements ConnectHost {
  popup: FakePopup | null = new FakePopup();
  opened: { url: string; target: string }[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();
  open(url: string, target: string) {
    this.opened.push({ url, target });
    return this.popup;
  }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }
  emit(data: unknown, { origin = VERAKEY, source = this.popup as unknown } = {}) {
    for (const listener of [...this.listeners]) listener({ data, origin, source } as MessageEvent);
  }
  get request() {
    return this.popup!.sent.at(-1)?.message;
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("VeraKeyConnect", () => {
  it("opens VeraKey's popup, sends the request once it is ready, and returns the result", async () => {
    const window = new FakeWindow();
    const signingIn = new VeraKeyConnect({ url: `${VERAKEY}/anything`, host: window }).signIn({ nonce: NONCE });
    expect(window.opened).toEqual([{ url: `${VERAKEY}/connect`, target: CONNECT_WINDOW }]);
    window.emit(envelope({ type: "ready" }));
    await tick();
    expect(window.popup!.sent).toHaveLength(1);
    expect(window.popup!.sent[0].target).toBe(VERAKEY);
    expect(window.request).toMatchObject({ protocol: "verakey-connect", version: 1, type: "request", method: "signIn", params: { nonce: NONCE } });
    const result = { version: 1, playerId: "0x01" };
    window.emit(envelope({ type: "result", id: window.request.id, result }));
    await expect(signingIn).resolves.toEqual(result);
  });

  it("opens the popup before the nonce arrives, so the click still counts", async () => {
    const window = new FakeWindow();
    let give!: (nonce: Hex) => void;
    const signingIn = new VeraKeyConnect({ url: VERAKEY, host: window }).signIn({ nonce: () => new Promise<Hex>(resolve => (give = resolve)) });
    expect(window.opened).toHaveLength(1);
    window.emit(envelope({ type: "ready" }));
    await tick();
    expect(window.popup!.sent).toHaveLength(0);
    give(NONCE);
    await tick();
    expect(window.request.params.nonce).toBe(NONCE);
    window.emit(envelope({ type: "result", id: window.request.id, result: { ok: true } }));
    await signingIn;
  });

  it("sends a payment's amount as a decimal string", async () => {
    const window = new FakeWindow();
    const paying = new VeraKeyConnect({ url: VERAKEY, host: window }).pay({ to: MERCHANT, amount: 1_000_000n });
    window.emit(envelope({ type: "ready" }));
    await tick();
    expect(window.request).toMatchObject({ method: "pay", params: { to: MERCHANT, amount: "1000000" } });
    window.emit(envelope({ type: "result", id: window.request.id, result: { hash: "0xab" } }));
    await paying;
  });

  it("says 'blocked' when the browser blocks the popup", async () => {
    const window = new FakeWindow();
    window.popup = null;
    await expect(new VeraKeyConnect({ url: VERAKEY, host: window }).signIn({ nonce: NONCE })).rejects.toMatchObject({ code: "blocked" });
  });

  it("says 'busy' for a second request while one is open, without opening another window", async () => {
    const window = new FakeWindow();
    const connect = new VeraKeyConnect({ url: VERAKEY, host: window });
    const first = connect.signIn({ nonce: NONCE });
    await expect(connect.pay({ to: MERCHANT, amount: 1n })).rejects.toMatchObject({ code: "busy" });
    expect(window.opened).toHaveLength(1);
    window.emit(envelope({ type: "ready" }));
    await tick();
    window.emit(envelope({ type: "error", id: window.request.id, code: "cancelled", message: "Cancelled." }));
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
  });

  it("says 'unavailable' when the popup never answers, and names the opener policy", async () => {
    vi.useFakeTimers();
    const window = new FakeWindow();
    const signingIn = new VeraKeyConnect({ url: VERAKEY, host: window }).signIn({ nonce: NONCE });
    const outcome = expect(signingIn).rejects.toMatchObject({ code: "unavailable", message: expect.stringContaining("Cross-Origin-Opener-Policy") });
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
  });

  it("says 'closed' when the player closes the popup, keeping a payment's hash if it was already sent", async () => {
    vi.useFakeTimers();
    const window = new FakeWindow();
    const paying = new VeraKeyConnect({ url: VERAKEY, host: window }).pay({ to: MERCHANT, amount: 1n });
    window.emit(envelope({ type: "ready" }));
    await vi.advanceTimersByTimeAsync(0);
    window.emit(envelope({ type: "progress", id: window.request.id, stage: "submitted", hash: "0xfeed" }));
    window.popup!.closed = true;
    const outcome = expect(paying).rejects.toMatchObject({ code: "closed", hash: "0xfeed" });
    await vi.advanceTimersByTimeAsync(500);
    await outcome;
  });

  it("says a payment may have been sent when the popup closes while sending it, and how to find it", async () => {
    vi.useFakeTimers();
    const window = new FakeWindow();
    const paying = new VeraKeyConnect({ url: VERAKEY, host: window }).pay({ to: MERCHANT, amount: 1n });
    window.emit(envelope({ type: "ready" }));
    await vi.advanceTimersByTimeAsync(0);
    window.emit(envelope({ type: "progress", id: window.request.id, stage: "sending", account: PLAYER, nonce: "7" }));
    window.popup!.closed = true;
    const error = paying.catch(e => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await error).toMatchObject({ code: "closed", pending: { account: PLAYER, nonce: 7n } });
    expect((await error).hash).toBeUndefined();
  });

  it("names the signed-in player's account in a payment request", async () => {
    const window = new FakeWindow();
    const paying = new VeraKeyConnect({ url: VERAKEY, host: window }).pay({ to: MERCHANT, amount: 1_000_000n, account: PLAYER });
    window.emit(envelope({ type: "ready" }));
    await tick();
    expect(window.request.params).toEqual({ to: MERCHANT, amount: "1000000", account: PLAYER });
    window.emit(envelope({ type: "result", id: window.request.id, result: { hash: "0xab" } }));
    await paying;
  });

  it("passes on the popup's error with the contract error", async () => {
    const window = new FakeWindow();
    const paying = new VeraKeyConnect({ url: VERAKEY, host: window }).pay({ to: MERCHANT, amount: 1n });
    window.emit(envelope({ type: "ready" }));
    await tick();
    window.emit(envelope({ type: "error", id: window.request.id, code: "policy", message: "Over the cap.", revert: "PerTxCapExceeded" }));
    const error = await paying.catch(e => e);
    expect(error).toBeInstanceOf(VeraKeyConnectError);
    expect(error).toMatchObject({ code: "policy", revert: "PerTxCapExceeded" });
  });

  it("ignores messages from other origins, other windows, other requests and other protocols", async () => {
    const window = new FakeWindow();
    const signingIn = new VeraKeyConnect({ url: VERAKEY, host: window }).signIn({ nonce: NONCE });
    window.emit(envelope({ type: "ready" }), { origin: "https://evil.example" });
    window.emit(envelope({ type: "ready" }), { source: {} });
    window.emit({ protocol: "other", version: 1, type: "ready" });
    await tick();
    expect(window.popup!.sent).toHaveLength(0);
    window.emit(envelope({ type: "ready" }));
    await tick();
    const { id } = window.request;
    window.emit(envelope({ type: "result", id: "someone-else", result: { wrong: true } }));
    window.emit(envelope({ type: "result", id, result: { wrong: true } }), { origin: "https://evil.example" });
    window.emit(envelope({ type: "result", id, result: { right: true } }));
    await expect(signingIn).resolves.toEqual({ right: true });
  });
});

describe("acceptRequest (the popup's gate)", () => {
  const opener = {};
  const request = (body: object) => envelope({ type: "request", id: "req-1", ...body });
  const gate = (data: unknown, { origin = "https://game.example", source = opener as unknown, handled = false } = {}) =>
    acceptRequest({ source, origin, data }, { opener, handled });

  it("accepts a well-formed sign-in or payment from the window that opened it", () => {
    expect(gate(request({ method: "signIn", params: { nonce: NONCE } }))).toEqual({
      kind: "accept",
      origin: "https://game.example",
      request: { id: "req-1", method: "signIn", params: { nonce: NONCE } },
    });
    expect(gate(request({ method: "pay", params: { to: MERCHANT, amount: "1000000" } }))).toMatchObject({ kind: "accept", request: { method: "pay" } });
  });
  it("ignores other windows, other protocols and other message types", () => {
    expect(gate(request({ method: "signIn", params: { nonce: NONCE } }), { source: {} })).toEqual({ kind: "ignore" });
    expect(gate({ protocol: "other", version: 1, type: "request" })).toEqual({ kind: "ignore" });
    expect(gate(envelope({ type: "ready" }))).toEqual({ kind: "ignore" });
    expect(acceptRequest({ source: null, origin: "https://game.example", data: request({}) }, { opener: null, handled: false })).toEqual({ kind: "ignore" });
  });
  it("answers only https sites, and localhost while developing", () => {
    for (const origin of ["https://game.example", "http://localhost:5191", "http://127.0.0.1:8080"]) expect(isAllowedRequesterOrigin(origin)).toBe(true);
    for (const origin of ["http://game.example", "http://192.168.1.2:5191", "https://game.example/", "null", "file://", "ftp://game.example"]) {
      expect(isAllowedRequesterOrigin(origin)).toBe(false);
    }
    expect(gate(request({ method: "signIn", params: { nonce: NONCE } }), { origin: "http://game.example" })).toMatchObject({
      kind: "reject",
      code: "origin",
      id: "req-1",
    });
  });
  it("takes one request per window", () => {
    expect(gate(request({ method: "signIn", params: { nonce: NONCE } }), { handled: true })).toMatchObject({ kind: "reject", code: "busy" });
  });
  it("accepts a payment request that names the player's account, and refuses a malformed account", () => {
    expect(gate(request({ method: "pay", params: { to: MERCHANT, amount: "1", account: PLAYER } }))).toMatchObject({
      kind: "accept",
      request: { params: { to: MERCHANT, amount: "1", account: PLAYER } },
    });
    expect(gate(request({ method: "pay", params: { to: MERCHANT, amount: "1", account: "0x1234" } }))).toMatchObject({ kind: "reject", code: "request" });
  });
  it("refuses malformed requests", () => {
    const bad = [
      { method: "signIn", params: { nonce: "0x1234" } },
      { method: "signIn", params: { nonce: `0x${"zz".repeat(32)}` } },
      { method: "pay", params: { to: MERCHANT, amount: "0" } },
      { method: "pay", params: { to: MERCHANT, amount: "-1" } },
      { method: "pay", params: { to: MERCHANT, amount: "1.5" } },
      { method: "pay", params: { to: MERCHANT, amount: (1n << 128n).toString() } },
      { method: "pay", params: { to: "0x1234", amount: "1" } },
      { method: "transfer", params: {} },
    ];
    for (const body of bad) expect(gate(request(body))).toMatchObject({ kind: "reject", code: "request" });
    expect(gate(envelope({ type: "request", id: "x".repeat(65), method: "signIn", params: { nonce: NONCE } }))).toMatchObject({ kind: "reject", code: "request" });
  });
});
