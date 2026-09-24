import { isAddress, isHex, type Address, type Hex } from "viem";
import type { PaymentResult, SignInResult } from "./signin";

/**
 * The messages between a site and the "Sign in with VeraKey" popup, and the site's side of them. The site opens
 * VeraKey's /connect page, which answers only the window that opened it; the browser tells the popup that window's
 * origin, and the popup shows it to the player.
 */

export const CONNECT_PROTOCOL = "verakey-connect";
export const CONNECT_VERSION = 1;
/** Every request uses one named window, so a site never stacks VeraKey popups. */
export const CONNECT_WINDOW = "verakey-connect";
const READY_TIMEOUT_MS = 30_000;
const CLOSED_POLL_MS = 500;
const MAX_AMOUNT = 1n << 128n;

export type ConnectErrorCode =
  | "blocked" | "unavailable" | "closed" | "busy" | "origin" | "request"
  | "cancelled" | "funds" | "policy" | "device" | "proof" | "relay";

export type ConnectRequest =
  | { id: string; method: "signIn"; params: { nonce: Hex } }
  | { id: string; method: "pay"; params: { to: Address; amount: string } };

type Envelope = { protocol: typeof CONNECT_PROTOCOL; version: typeof CONNECT_VERSION };

export type PopupMessage = Envelope &
  (
    | { type: "ready" }
    | { type: "progress"; id: string; stage: "submitted"; hash: Hex }
    | { type: "result"; id: string; result: SignInResult | PaymentResult }
    | { type: "error"; id: string; code: ConnectErrorCode; message: string; revert?: string }
  );

export function envelope<T extends object>(body: T): Envelope & T {
  return { protocol: CONNECT_PROTOCOL, version: CONNECT_VERSION, ...body };
}

function isEnvelope(data: unknown): data is Envelope & { type: string; id?: unknown } {
  const value = data as (Partial<Envelope> & { type?: unknown }) | null;
  return typeof value === "object" && value !== null && value.protocol === CONNECT_PROTOCOL &&
    value.version === CONNECT_VERSION && typeof value.type === "string";
}

/** Sites the popup answers: https, and plain http only on this computer, for development. */
export function isAllowedRequesterOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
}

function parseRequest(data: Record<string, unknown>): ConnectRequest | null {
  const { id, method, params } = data as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (typeof id !== "string" || id.length === 0 || id.length > 64 || typeof params !== "object" || params === null) return null;
  if (method === "signIn") {
    const { nonce } = params;
    return typeof nonce === "string" && isHex(nonce) && nonce.length === 66 ? { id, method, params: { nonce } } : null;
  }
  if (method === "pay") {
    const { to, amount } = params;
    if (typeof to !== "string" || !isAddress(to) || typeof amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(amount)) return null;
    return BigInt(amount) < MAX_AMOUNT ? { id, method, params: { to, amount } } : null;
  }
  return null;
}

export type RequestVerdict =
  | { kind: "ignore" }
  | { kind: "reject"; origin: string; id: string; code: "origin" | "busy" | "request"; message: string }
  | { kind: "accept"; origin: string; request: ConnectRequest };

/**
 * The popup's gate: it listens only to the window that opened it, speaks only this protocol, answers only allowed
 * origins, takes one request per window, and only a well-formed one.
 */
export function acceptRequest(
  event: { source: unknown; origin: string; data: unknown },
  state: { opener: unknown; handled: boolean }
): RequestVerdict {
  if (!state.opener || event.source !== state.opener || !isEnvelope(event.data) || event.data.type !== "request") return { kind: "ignore" };
  const id = typeof event.data.id === "string" ? event.data.id : "";
  const reject = (code: "origin" | "busy" | "request", message: string): RequestVerdict => ({ kind: "reject", origin: event.origin, id, code, message });
  if (!isAllowedRequesterOrigin(event.origin)) {
    return reject("origin", `VeraKey answers https sites, and localhost while developing, not ${event.origin}.`);
  }
  if (state.handled) return reject("busy", "This VeraKey window already has a request.");
  const request = parseRequest(event.data as Record<string, unknown>);
  return request ? { kind: "accept", origin: event.origin, request } : reject("request", "The request is malformed.");
}

export class VeraKeyConnectError extends Error {
  constructor(
    readonly code: ConnectErrorCode,
    message: string,
    readonly revert?: string,
    /** Set when the popup had already sent the payment: verify it before asking again. */
    readonly hash?: Hex
  ) {
    super(message);
    this.name = "VeraKeyConnectError";
  }
}

export interface ConnectPopup {
  closed: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
}

/** The browser pieces VeraKeyConnect uses: `window`, or a stand-in in tests. */
export interface ConnectHost {
  open(url: string, target: string, features: string): ConnectPopup | null;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** "Sign in with VeraKey" for a site: opens VeraKey's popup, sends one request, and returns its answer. */
export class VeraKeyConnect {
  private readonly origin: string;
  private readonly host: ConnectHost;
  private pending = false;

  constructor(options: { url: string; host?: ConnectHost }) {
    this.origin = new URL(options.url).origin;
    this.host = options.host ?? (globalThis as unknown as ConnectHost);
  }

  /**
   * Signs the player in; the site's server checks the result with `verifySignIn`. Call it from a click: the popup
   * opens at once, and `nonce` may be a function that fetches one from the site's server meanwhile.
   */
  signIn(params: { nonce: Hex | (() => Promise<Hex>) }): Promise<SignInResult> {
    const { nonce } = params;
    return this.request("signIn", async () => ({ nonce: typeof nonce === "function" ? await nonce() : nonce })) as Promise<SignInResult>;
  }

  /** Asks the player to pay `amount` USDG base units to `to`; check it with `verifyPayment`. Call it from a click. */
  pay(params: { to: Address; amount: bigint }): Promise<PaymentResult> {
    return this.request("pay", async () => ({ to: params.to, amount: params.amount.toString() })) as Promise<PaymentResult>;
  }

  private request(
    method: ConnectRequest["method"],
    params: () => Promise<Record<string, string>>
  ): Promise<SignInResult | PaymentResult> {
    if (this.pending) return Promise.reject(new VeraKeyConnectError("busy", "Another VeraKey request is still open."));
    const popup = this.host.open(`${this.origin}/connect`, CONNECT_WINDOW, "popup,width=420,height=680");
    if (!popup) {
      return Promise.reject(new VeraKeyConnectError("blocked", "The browser blocked the VeraKey window. Call signIn() and pay() from a click."));
    }
    this.pending = true;
    const id = crypto.randomUUID();
    const values = params();
    values.catch(() => {}); // handled once the popup is ready
    return new Promise((resolve, reject) => {
      let ready = false;
      let sent: Hex | undefined;
      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      let closedPoll: ReturnType<typeof setInterval> | undefined;
      const settle = (done: () => void) => {
        clearTimeout(readyTimer);
        clearInterval(closedPoll);
        this.host.removeEventListener("message", onMessage);
        this.pending = false;
        done();
      };
      const fail = (code: ConnectErrorCode, message: string, revert?: string) =>
        settle(() => reject(new VeraKeyConnectError(code, message, revert, sent)));
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== this.origin || event.source !== popup || !isEnvelope(event.data)) return;
        const message = event.data as PopupMessage;
        if (message.type === "ready") {
          if (ready) return;
          ready = true;
          values.then(
            value => popup.postMessage(envelope({ type: "request", id, method, params: value }), this.origin),
            error => fail("request", error instanceof Error ? error.message : String(error))
          );
          return;
        }
        if (message.id !== id) return;
        if (message.type === "progress") sent = message.hash;
        else if (message.type === "result") settle(() => resolve(message.result));
        else if (message.type === "error") fail(message.code, message.message, message.revert);
      };
      this.host.addEventListener("message", onMessage);
      readyTimer = setTimeout(() => {
        if (!ready) {
          fail("unavailable",
            "The VeraKey window did not answer. If this page sends Cross-Origin-Opener-Policy: same-origin, send same-origin-allow-popups instead.");
        }
      }, READY_TIMEOUT_MS);
      closedPoll = setInterval(() => {
        if (popup.closed) {
          fail("closed", sent ? "The VeraKey window closed after the payment was sent: verify it before asking again." : "The VeraKey window was closed.");
        }
      }, CLOSED_POLL_MS);
    });
  }
}
