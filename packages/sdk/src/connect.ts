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
const UNAVAILABLE =
  "The VeraKey window did not answer. If this page sends Cross-Origin-Opener-Policy: same-origin, send same-origin-allow-popups instead; also check the VeraKey URL.";
const CLOSED_POLL_MS = 500;
const MAX_AMOUNT = 1n << 128n;

export type ConnectErrorCode =
  | "blocked" | "unavailable" | "closed" | "busy" | "origin" | "request"
  | "cancelled" | "funds" | "policy" | "device" | "proof" | "relay";

export type ConnectRequest =
  | { id: string; method: "signIn"; params: { nonce: Hex } }
  | { id: string; method: "pay"; params: { to: Address; amount: string; account?: Address } };

/** A payment the popup was sending when the request ended: find it with `findPayment` before asking again. */
export interface PendingPayment {
  account: Address;
  /** The account's action nonce the payment uses; its `Paid` event is indexed by it. */
  nonce: bigint;
}

type Envelope = { protocol: typeof CONNECT_PROTOCOL; version: typeof CONNECT_VERSION };

export type PopupMessage = Envelope &
  (
    | { type: "ready" }
    | { type: "progress"; id: string; stage: "sending"; account: Address; nonce: string }
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
    const { to, amount, account } = params;
    if (typeof to !== "string" || !isAddress(to) || typeof amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(amount)) return null;
    if (account !== undefined && (typeof account !== "string" || !isAddress(account))) return null;
    if (BigInt(amount) >= MAX_AMOUNT) return null;
    return { id, method, params: account === undefined ? { to, amount } : { to, amount, account } };
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
  /** The contract error, when the account refused. */
  readonly revert?: string;
  /** Set when the popup had already sent the payment: verify it before asking again. */
  readonly hash?: Hex;
  /** Set when the request ended while the payment was being sent: find it with `findPayment` before asking again. */
  readonly pending?: PendingPayment;

  constructor(
    readonly code: ConnectErrorCode,
    message: string,
    details: { revert?: string; hash?: Hex; pending?: PendingPayment; cause?: unknown } = {}
  ) {
    // `cause` keeps what the site's own `nonce` callback threw, so a page can tell its errors from VeraKey's.
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "VeraKeyConnectError";
    this.revert = details.revert;
    this.hash = details.hash;
    this.pending = details.pending;
  }
}

export interface ConnectPopup {
  closed: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
  close?(): void;
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
    return this.request("signIn", async () => {
      const value: unknown = typeof nonce === "function" ? await nonce() : nonce;
      // VeraKey's window would refuse it too, but only once it loads: refusing it here closes the window at once.
      if (typeof value !== "string" || !isHex(value) || value.length !== 66) {
        const shown = typeof value === "string" ? JSON.stringify(value.slice(0, 80)) : String(value);
        throw new Error(`The nonce must be 32 bytes of hex (0x and 64 hex digits), not ${shown}.`);
      }
      return { nonce: value };
    }) as Promise<SignInResult>;
  }

  /**
   * Asks the player to pay `amount` USDG base units to `to`; check it with `verifyPayment`. Call it from a click.
   * `account`, the signed-in player's account, makes the popup refuse to pay from any other.
   */
  pay(params: { to: Address; amount: bigint; account?: Address }): Promise<PaymentResult> {
    const { to, amount, account } = params;
    return this.request("pay", async () => ({ to, amount: amount.toString(), ...(account ? { account } : {}) })) as Promise<PaymentResult>;
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
    values.catch(() => {}); // handled below, as soon as it fails
    return new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      let sent: Hex | undefined;
      let sending: PendingPayment | undefined;
      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      let closedPoll: ReturnType<typeof setInterval> | undefined;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        clearInterval(closedPoll);
        this.host.removeEventListener("message", onMessage);
        this.pending = false;
        done();
      };
      // Without a hash, a payment the popup was sending may still land: the site gets what it needs to find it.
      const fail = (code: ConnectErrorCode, message: string, extra: { revert?: string; cause?: unknown } = {}) =>
        settle(() =>
          reject(new VeraKeyConnectError(code, message, {
            ...extra,
            hash: sent,
            pending: sent || !["closed", "relay"].includes(code) ? undefined : sending,
          }))
        );
      // The site's own `nonce` callback failed: close VeraKey's window rather than leave it waiting for a request.
      // Not once the request has ended, though: a retry may already be using the same window.
      values.catch(error => {
        if (settled) return;
        fail("request", error instanceof Error ? error.message : String(error), { cause: error });
        try {
          popup.close?.();
        } catch {
          // the window stays; the site has its answer
        }
      });
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== this.origin || event.source !== popup || !isEnvelope(event.data)) return;
        const message = event.data as PopupMessage;
        if (message.type === "ready") {
          if (ready) return;
          ready = true;
          values.then(
            value => {
              if (!settled) popup.postMessage(envelope({ type: "request", id, method, params: value }), this.origin);
            },
            () => {} // already failed above
          );
          return;
        }
        if (message.id !== id) return;
        if (message.type === "progress") {
          if (message.stage === "submitted" && isHex(message.hash)) sent = message.hash;
          if (message.stage === "sending" && isAddress(message.account) && /^[0-9]{1,78}$/.test(message.nonce)) {
            sending = { account: message.account, nonce: BigInt(message.nonce) };
          }
        }
        else if (message.type === "result") settle(() => resolve(message.result));
        else if (message.type === "error") fail(message.code, message.message, { revert: message.revert });
      };
      this.host.addEventListener("message", onMessage);
      readyTimer = setTimeout(() => {
        if (!ready) fail("unavailable", UNAVAILABLE);
      }, READY_TIMEOUT_MS);
      closedPoll = setInterval(() => {
        // A popup that closes before it ever answered was cut off (the usual cause: this page's opener policy).
        if (popup.closed && !ready) fail("unavailable", UNAVAILABLE);
        else if (popup.closed) {
          fail("closed",
            sent ? "The VeraKey window closed after the payment was sent: verify it before asking again."
              : sending ? "The VeraKey window closed while the payment was being sent: find it with findPayment before asking again."
                : "The VeraKey window was closed.");
        }
      }, CLOSED_POLL_MS);
    });
  }
}
