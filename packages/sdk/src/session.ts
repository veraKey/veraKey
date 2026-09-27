import type { Address, Hex } from "viem";
import { VeraKeyConnect, VeraKeyConnectError, type ConnectErrorCode, type ConnectHost } from "./connect";
import type { PaymentResult, SignInCheck, SignInResult, VeraKeyPlayer } from "./signin";

/**
 * The integration kit in the page, without a framework: talks to the kit's routes on your server
 * (createVeraKeyServer) and to VeraKey's popup, and keeps the player's state. @verakey/sdk/react wraps it for React.
 */

export type VeraKeySessionStatus = "loading" | "signed-out" | "signing-in" | "signed-in";

export interface VeraKeySessionState {
  status: VeraKeySessionStatus;
  player: VeraKeyPlayer | null;
  /** A payment is under way. */
  paying: boolean;
  /** Why the last sign-in failed; cleared by the next attempt. */
  error: VeraKeySessionError | null;
}

/** A payment your server verified; `result` is what its onPayment returned. */
export interface VeraKeyPaymentReceipt {
  hash: Hex;
  amount: bigint;
  fee: bigint;
  result: unknown;
}

export type VeraKeySessionErrorCode = ConnectErrorCode | "server" | "network" | "signed-out";

export class VeraKeySessionError extends Error {
  readonly code: VeraKeySessionErrorCode;
  /** The HTTP status your server answered with, for code "server". */
  readonly status?: number;
  /** Why your server refused a sign-in or a payment. */
  readonly checks?: SignInCheck[];

  constructor(code: VeraKeySessionErrorCode, message: string, details: { status?: number; checks?: SignInCheck[]; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "VeraKeySessionError";
    this.code = code;
    this.status = details.status;
    this.checks = details.checks;
  }
}

function asSessionError(error: unknown): VeraKeySessionError {
  if (error instanceof VeraKeySessionError) return error;
  if (error instanceof VeraKeyConnectError) {
    // The nonce callback failed: its cause is what the page's own server answered.
    if (error.code === "request" && error.cause instanceof VeraKeySessionError) return error.cause;
    return new VeraKeySessionError(error.code, error.message, { cause: error });
  }
  return new VeraKeySessionError("server", error instanceof Error ? error.message : String(error), { cause: error });
}

/** The player cancelled, or closed the popup before anything was sent. */
const quiet = (error: unknown) => error instanceof VeraKeyConnectError && (error.code === "cancelled" || error.code === "closed");

export class VeraKeySession {
  private readonly server: string;
  private readonly send: typeof fetch;
  private readonly host?: ConnectHost;
  private connect: VeraKeyConnect | null = null;
  private merchant: Address | null = null;
  private current: VeraKeySessionState = { status: "loading", player: null, paying: false, error: null };
  private readonly listeners = new Set<() => void>();

  /** `server` is where your createVeraKeyServer routes are mounted (default /api/verakey). */
  constructor(options: { server?: string; fetch?: typeof fetch; host?: ConnectHost } = {}) {
    this.server = (options.server ?? "/api/verakey").replace(/\/+$/, "");
    // Called through a wrapper: a browser's fetch refuses to run with another `this` than window.
    this.send = options.fetch ?? (((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch);
    this.host = options.host;
  }

  get state(): VeraKeySessionState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Asks your server who is signed in; VeraKeyProvider calls it when it mounts. */
  async load(): Promise<void> {
    try {
      const session = await this.call<{ verakeyUrl: string; merchant: Address | null; player: VeraKeyPlayer | null }>("GET", "session");
      this.connect = new VeraKeyConnect({ url: session.verakeyUrl, host: this.host });
      this.merchant = session.merchant;
      this.update({ status: session.player ? "signed-in" : "signed-out", player: session.player, error: null });
    } catch (error) {
      this.update({ status: "signed-out", player: null, error: asSessionError(error) });
    }
  }

  /** Signs the player in; call it from a click. Resolves null when the player cancels. */
  signIn(): Promise<VeraKeyPlayer | null> {
    if (this.current.status !== "signed-out") {
      return Promise.reject(new VeraKeySessionError("busy", `Cannot sign in while ${this.current.status}.`));
    }
    const connect = this.connect;
    if (!connect) {
      // The popup must open inside the click, so there is no waiting for the server here: fail, and load again.
      const error = new VeraKeySessionError("network", "This site's server did not answer.");
      this.update({ error });
      void this.load();
      return Promise.reject(error);
    }
    const signingIn = connect.signIn({ nonce: async () => (await this.call<{ nonce: Hex }>("POST", "nonce")).nonce });
    this.update({ status: "signing-in", error: null });
    return this.finishSignIn(signingIn);
  }

  /** Ends the session on your server. */
  async signOut(): Promise<void> {
    await this.call("POST", "sign-out");
    this.update({ status: "signed-out", player: null, error: null });
  }

  /** Pays `amount` USDG base units to your merchant; call it from a click. Resolves null when the player cancels before it is sent. */
  pay(params: { amount: bigint }): Promise<VeraKeyPaymentReceipt | null> {
    const { status, player, paying } = this.current;
    if (status !== "signed-in" || !player) return Promise.reject(new VeraKeySessionError("signed-out", "Sign in first."));
    if (paying) return Promise.reject(new VeraKeySessionError("busy", "A payment is already under way."));
    if (!this.connect || !this.merchant) return Promise.reject(new VeraKeySessionError("server", "This site takes no payments."));
    const payment = this.connect.pay({ to: this.merchant, amount: params.amount, account: player.account });
    this.update({ paying: true });
    return this.finishPayment(payment, params.amount).finally(() => this.update({ paying: false }));
  }

  private async finishSignIn(signingIn: Promise<SignInResult>): Promise<VeraKeyPlayer | null> {
    try {
      const result = await signingIn;
      const { player } = await this.call<{ player: VeraKeyPlayer }>("POST", "sign-in", result);
      this.update({ status: "signed-in", player, error: null });
      return player;
    } catch (error) {
      if (quiet(error)) {
        this.update({ status: "signed-out", error: null });
        return null;
      }
      const failure = asSessionError(error);
      this.update({ status: "signed-out", player: null, error: failure });
      throw failure;
    }
  }

  private async finishPayment(payment: Promise<PaymentResult>, amount: bigint): Promise<VeraKeyPaymentReceipt | null> {
    let sent: { hash: Hex } | { nonce: string };
    try {
      sent = { hash: (await payment).hash };
    } catch (error) {
      // A payment sent (hash) or maybe sent (pending) before the popup stopped goes to the server to verify.
      if (error instanceof VeraKeyConnectError && error.hash) sent = { hash: error.hash };
      else if (error instanceof VeraKeyConnectError && error.pending) sent = { nonce: error.pending.nonce.toString() };
      else if (quiet(error)) return null;
      else throw asSessionError(error);
    }
    const receipt = await this.call<{ hash: Hex; amount: string; fee: string; result: unknown }>("POST", "payment", {
      amount: amount.toString(),
      ...sent,
    });
    return { hash: receipt.hash, amount: BigInt(receipt.amount), fee: BigInt(receipt.fee), result: receipt.result };
  }

  private update(patch: Partial<VeraKeySessionState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private async call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.send(`${this.server}/${route}`, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new VeraKeySessionError("network", "This site's server did not answer.", { cause: error });
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; checks?: SignInCheck[] };
    if (response.status === 401 && route !== "sign-in") {
      this.update({ status: "signed-out", player: null });
      throw new VeraKeySessionError("signed-out", data.error ?? "Sign in first.", { status: 401 });
    }
    if (!response.ok) {
      throw new VeraKeySessionError("server", data.error ?? `This site's server answered ${response.status}.`, {
        status: response.status,
        checks: data.checks,
      });
    }
    return data as T;
  }
}
