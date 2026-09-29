import { createPublicClient, defineChain, http, isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { base64UrlDecode, base64UrlEncode, bytesToHex } from "./bytes";
import { isAllowedRequesterOrigin } from "./connect";
import type { VeraKeyDeployment } from "./deployments";
import { veraKeyAccountAbi } from "./abi";
import { hmacKey, mac, macValid, parseCookies, serializeCookie } from "./kit/cookies";
import { findPayment, verifyPayment, verifySignIn, type SignInCheck, type SignInResult, type VeraKeyPlayer } from "./signin";

/**
 * The integration kit on your server: the routes a page's VeraKeySession calls (session, nonce, sign-in, sign-out
 * and payment). Each nonce is bound to the browser that asked for it, the session lives in a signed cookie, and
 * payments are verified on-chain and accepted once. It speaks the Fetch API (Next.js route handlers, Hono, Bun,
 * Deno), and Express through toExpress.
 */

/** A payment the kit verified on-chain: from the signed-in player's account to the merchant, for `amount`. */
export interface VerifiedPayment {
  player: VeraKeyPlayer;
  hash: Hex;
  to: Address;
  amount: bigint;
  fee: bigint;
}

/** Accepts each key once: `claim` resolves true for the first caller only, and `release` undoes a claim. */
export interface VeraKeyStore {
  /** Without `ttlSeconds`, the claim is kept for good. */
  claim(key: string, ttlSeconds?: number): Promise<boolean>;
  release(key: string): Promise<void>;
  /**
   * Whether `key` is claimed now. With it, signing out ends the session for every copy of its cookie; a store without
   * it can only clear the cookie in the browser that signs out.
   */
  has?(key: string): Promise<boolean>;
}

export interface VeraKeyServerOptions {
  /** Your site's exact origin, e.g. "https://your.game": https, or http on localhost or 127.0.0.1 while developing. */
  origin: string;
  /** The VeraKey deployment you trust, e.g. ARBITRUM_SEPOLIA from @verakey/sdk/deployments. */
  deployment: VeraKeyDeployment;
  /** At least 32 bytes, known only to your server: signs the kit's cookies. Changing it signs every player out. */
  secret: string;
  /** Where payments go. Without it, the payment route answers 404. */
  merchant?: Address;
  /** An RPC endpoint for the deployment's chain; defaults to the deployment's public one. */
  rpcUrl?: string;
  /** A viem client for the chain; replaces rpcUrl. */
  publicClient?: PublicClient;
  /** How long a session lasts, in seconds; default 7 days. */
  sessionTtlSeconds?: number;
  /**
   * How often, in seconds, a session checks on-chain that its passkey still owns the account (default 600). A passkey
   * a recovery removed then stops being signed in within this time. 0 checks on every request; Infinity never. A
   * failed RPC call keeps the session and asks again on the next request.
   */
  ownerCheckSeconds?: number;
  /** Where the kit remembers used nonces and accepted payments; default in memory, for one process. */
  store?: VeraKeyStore;
  /** Runs after a sign-in verifies, before the session starts. Throw to refuse: the message reaches the page. */
  onSignIn?: (player: VeraKeyPlayer, request: Request) => void | Promise<void>;
  /** Fulfils a verified payment. Throw to refuse: the message reaches the page. The return value is sent to the page. */
  onPayment?: (payment: VerifiedPayment, request: Request) => unknown;
}

/** `handle` and `getPlayer` do not use `this`, so they can be passed around on their own. */
export interface VeraKeyServer {
  /** Answers the kit's route named by the last non-empty segment of the request's path. */
  handle(request: Request): Promise<Response>;
  /** The signed-in player of a request (a Fetch Request, or a Node or Express one), or null. */
  getPlayer(request: Request | { headers: Record<string, string | string[] | undefined> }): Promise<VeraKeyPlayer | null>;
}

/** A signed-in player's session: its random id is what signing out revokes. */
interface Session {
  player: VeraKeyPlayer;
  sid: string;
  exp: number;
}

const NONCE_TTL_SECONDS = 300;
/** A little longer than a nonce lives, so a replay within its lifetime always finds the claim. */
const NONCE_CLAIM_SECONDS = 360;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_OWNER_CHECK_SECONDS = 600;
const MAX_BODY_BYTES = 64 * 1024;
/** How often, and how far apart, the payment route asks again about a transaction its node does not know yet. */
const RECEIPT_RETRIES = 5;
const RECEIPT_RETRY_MS = 1_000;
const ROUTES = ["session", "nonce", "sign-in", "sign-out", "payment"];

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly checks?: SignInCheck[]) {
    super(message);
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A JSON answer that is never cached; bigints are written as decimal strings. */
function json(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)), { status, headers });
}

/**
 * The request body as text, read as it arrives and refused past MAX_BODY_BYTES: a chunked body has no Content-Length,
 * and these routes take requests before anyone signs in.
 */
async function readLimited(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "The request is too large.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The default store: a Map with expiries, for one process. Payments need a durable, shared store in production. */
export function memoryStore(): VeraKeyStore {
  const until = new Map<string, number>();
  return {
    async claim(key, ttlSeconds) {
      const now = Date.now();
      const expiry = until.get(key);
      if (expiry !== undefined && expiry > now) return false;
      until.set(key, ttlSeconds === undefined ? Number.POSITIVE_INFINITY : now + ttlSeconds * 1000);
      if (until.size > 10_000) for (const [k, e] of until) if (e <= now) until.delete(k);
      return true;
    },
    async release(key) {
      until.delete(key);
    },
    async has(key) {
      const expiry = until.get(key);
      return expiry !== undefined && expiry > Date.now();
    },
  };
}

function checkOptions(options: VeraKeyServerOptions): void {
  if (!isAllowedRequesterOrigin(options.origin)) {
    throw new TypeError(
      `origin must be your site's exact origin, such as https://your.game (https, or http on localhost or 127.0.0.1): got ${JSON.stringify(options.origin)}`
    );
  }
  if (typeof options.secret !== "string" || new TextEncoder().encode(options.secret).length < 32) {
    throw new TypeError("secret must be at least 32 bytes, known only to your server");
  }
  if (options.merchant !== undefined && !isAddress(options.merchant, { strict: false })) {
    throw new TypeError(`merchant is not an address: ${JSON.stringify(options.merchant)}`);
  }
  const d = options.deployment;
  const bytes32 = (value: unknown) => typeof value === "string" && isHex(value) && value.length === 66;
  const address = (value: unknown) => typeof value === "string" && isAddress(value, { strict: false });
  const deploymentOk =
    typeof d === "object" && d !== null && Number.isSafeInteger(d.chainId) && d.chainId > 0 && address(d.factory) &&
    address(d.honkVerifier) && address(d.usdg) && bytes32(d.rpIdHash) && typeof d.origin === "string" &&
    isAllowedRequesterOrigin(d.origin) && typeof d.rpcUrl === "string" && typeof d.name === "string";
  if (!deploymentOk) throw new TypeError("deployment is malformed: use ARBITRUM_SEPOLIA from @verakey/sdk/deployments, or the same fields");
  const ttl = options.sessionTtlSeconds;
  if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl <= 0)) throw new TypeError("sessionTtlSeconds must be a positive whole number");
  const every = options.ownerCheckSeconds;
  if (every !== undefined && (typeof every !== "number" || Number.isNaN(every) || every < 0)) {
    throw new TypeError("ownerCheckSeconds must be 0 or more (Infinity never checks)");
  }
}

export function createVeraKeyServer(options: VeraKeyServerOptions): VeraKeyServer {
  checkOptions(options);
  const { origin, deployment, merchant } = options;
  const secure = origin.startsWith("https:");
  // __Host- cookies must be Secure, which a plain-http localhost site cannot set.
  const NONCE_COOKIE = secure ? "__Host-verakey-nonce" : "verakey-nonce";
  const SESSION_COOKIE = secure ? "__Host-verakey-session" : "verakey-session";
  const sessionTtl = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const store = options.store ?? memoryStore();
  if (merchant && !options.store) {
    console.warn("VeraKey: payments are accepted once per process only; pass a durable store in production.");
  }
  const rpcUrl = options.rpcUrl ?? deployment.rpcUrl;
  const publicClient =
    options.publicClient ??
    (createPublicClient({
      chain: defineChain({
        id: deployment.chainId,
        name: deployment.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }),
      transport: http(rpcUrl),
    }) as PublicClient);
  const key = hmacKey(options.secret);
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const cookie = (name: string, value: string, maxAge: number, sameSite: "Strict" | "Lax") =>
    serializeCookie(name, value, { maxAge, sameSite, secure });

  async function readNonce(header: string | null): Promise<Hex | null> {
    const [nonce, expiresAt, tag] = (parseCookies(header).get(NONCE_COOKIE) ?? "").split(".");
    if (!nonce || !expiresAt || !tag || !isHex(nonce) || nonce.length !== 66 || !/^[0-9]{1,12}$/.test(expiresAt)) return null;
    if (Number(expiresAt) <= nowSeconds()) return null;
    return (await macValid(await key, `verakey-nonce|${origin}|${nonce}|${expiresAt}`, tag)) ? nonce : null;
  }

  const ownerCheck = options.ownerCheckSeconds ?? DEFAULT_OWNER_CHECK_SECONDS;
  /** When each session (by id) last saw its passkey own the account on-chain, and whether it still did. */
  const ownerSeen = new Map<string, { at: number; owner: boolean }>();
  /** Players with a payment check running: one at a time each, so nobody can pile up slow checks. */
  const paying = new Set<string>();

  /** A signed, unexpired session cookie, whether or not it was signed out or its passkey still owns the account. */
  async function decodeSession(header: string | null): Promise<Session | null> {
    const value = parseCookies(header).get(SESSION_COOKIE) ?? "";
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const payload = value.slice(0, dot);
    if (!(await macValid(await key, `verakey-session|${origin}|${payload}`, value.slice(dot + 1)))) return null;
    let data: { v?: unknown; id?: unknown; account?: unknown; sid?: unknown; exp?: unknown };
    try {
      data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    } catch {
      return null;
    }
    if (data.v !== 1 || typeof data.id !== "string" || !isHex(data.id) || data.id.length !== 66) return null;
    if (typeof data.account !== "string" || !isAddress(data.account, { strict: false })) return null;
    if (typeof data.sid !== "string" || !/^[0-9a-f]{32}$/.test(data.sid)) return null;
    if (typeof data.exp !== "number" || data.exp <= nowSeconds()) return null;
    return { player: { id: data.id as Hex, account: data.account as Address }, sid: data.sid, exp: data.exp };
  }

  /** The request's session, unless it was signed out or its passkey no longer owns the account. */
  async function readSession(header: string | null): Promise<Session | null> {
    const session = await decodeSession(header);
    if (!session) return null;
    if (store.has && (await store.has(`signout:${session.sid}`))) return null;
    return (await stillOwner(session)) ? session : null;
  }

  /**
   * Whether the session's passkey still owns the account, asked on-chain at most every `ownerCheck` seconds. A failed
   * RPC call keeps the session and asks again next time.
   */
  async function stillOwner(session: Session): Promise<boolean> {
    if (!Number.isFinite(ownerCheck)) return true;
    const now = nowSeconds();
    const seen = ownerSeen.get(session.sid);
    if (seen && (!seen.owner || now - seen.at < ownerCheck)) return seen.owner;
    let owner: boolean;
    try {
      const code = await publicClient.getCode({ address: session.player.account });
      // An account not deployed yet has had no owner changes: the passkey that signed in still owns it.
      owner = !code || code === "0x" ||
        (await publicClient.readContract({ address: session.player.account, abi: veraKeyAccountAbi, functionName: "isOwner", args: [session.player.id] })) === true;
    } catch {
      return true;
    }
    ownerSeen.set(session.sid, { at: now, owner });
    if (ownerSeen.size > 10_000) for (const [sid, entry] of ownerSeen) if (now - entry.at > sessionTtl) ownerSeen.delete(sid);
    return owner;
  }

  async function sessionCookie(player: VeraKeyPlayer): Promise<string> {
    const sid = bytesToHex(crypto.getRandomValues(new Uint8Array(16))).slice(2);
    // verifySignIn just checked on-chain that this passkey owns the account.
    ownerSeen.set(sid, { at: nowSeconds(), owner: true });
    const body = JSON.stringify({ v: 1, id: player.id, account: player.account, sid, exp: nowSeconds() + sessionTtl });
    const payload = base64UrlEncode(new TextEncoder().encode(body));
    return cookie(SESSION_COOKIE, `${payload}.${await mac(await key, `verakey-session|${origin}|${payload}`)}`, sessionTtl, "Lax");
  }

  const requireOrigin = (request: Request) => {
    const from = request.headers.get("origin");
    if (from !== origin) {
      throw new HttpError(403, from ? `Open this site at ${origin}: this request came from ${from}.` : `Requests to VeraKey's routes must come from ${origin}.`);
    }
  };

  async function readBody(request: Request): Promise<unknown> {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "The request is too large.");
    const text = await readLimited(request);
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "The request is not JSON.");
    }
  }

  const routes: Record<string, (request: Request) => Promise<Response>> = {
    "GET session": async request =>
      json(200, { verakeyUrl: deployment.origin, merchant: merchant ?? null, player: (await readSession(request.headers.get("cookie")))?.player ?? null }),

    "POST nonce": async request => {
      requireOrigin(request);
      const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const expiresAt = nowSeconds() + NONCE_TTL_SECONDS;
      const tag = await mac(await key, `verakey-nonce|${origin}|${nonce}|${expiresAt}`);
      return json(200, { nonce }, [cookie(NONCE_COOKIE, `${nonce}.${expiresAt}.${tag}`, NONCE_TTL_SECONDS, "Strict")]);
    },

    "POST sign-in": async request => {
      requireOrigin(request);
      const result = (await readBody(request)) as SignInResult | null;
      const nonce: unknown = result?.statement?.nonce;
      if (!result || typeof nonce !== "string" || !isHex(nonce) || nonce.length !== 66) throw new HttpError(400, "This is not a VeraKey sign-in.");
      const issued = await readNonce(request.headers.get("cookie"));
      if (!issued) throw new HttpError(403, "This browser has no current sign-in request: sign in again.");
      if (issued.toLowerCase() !== nonce.toLowerCase()) {
        throw new HttpError(403, "This sign-in answers an older request from this browser: sign in again.");
      }
      if (!(await store.claim(`nonce:${issued.toLowerCase()}`, NONCE_CLAIM_SECONDS))) throw new HttpError(409, "This sign-in was already used.");
      const verdict = await verifySignIn(result, { origin, nonce: issued, publicClient, deployment });
      if (!verdict.valid || !verdict.playerId || !verdict.account) throw new HttpError(401, "The sign-in did not verify.", verdict.checks);
      const player: VeraKeyPlayer = { id: verdict.playerId, account: verdict.account };
      try {
        await options.onSignIn?.(player, request);
      } catch (error) {
        throw new HttpError(400, messageOf(error));
      }
      return json(200, { player }, [await sessionCookie(player), cookie(NONCE_COOKIE, "", 0, "Strict")]);
    },

    "POST sign-out": async request => {
      requireOrigin(request);
      // Ends the session everywhere: every copy of its cookie (another tab, a leaked header) stops working, not only
      // the one this browser clears.
      const session = await decodeSession(request.headers.get("cookie"));
      if (session) await store.claim(`signout:${session.sid}`, Math.max(1, session.exp - nowSeconds()));
      return json(200, {}, [cookie(SESSION_COOKIE, "", 0, "Lax")]);
    },

    "POST payment": async request => {
      requireOrigin(request);
      const session = await readSession(request.headers.get("cookie"));
      if (!session) throw new HttpError(401, "Sign in first.");
      if (!merchant) throw new HttpError(404, "This site takes no payments.");
      const { player } = session;
      if (paying.has(player.id)) throw new HttpError(429, "A payment for this player is being checked. Try again in a moment.");
      paying.add(player.id);
      try {
        return await acceptPayment(request, player, merchant);
      } finally {
        paying.delete(player.id);
      }
    },
  };

  async function acceptPayment(request: Request, player: VeraKeyPlayer, merchant: Address): Promise<Response> {
    const { amount, hash, nonce } = ((await readBody(request)) ?? {}) as { amount?: unknown; hash?: unknown; nonce?: unknown };
    if (typeof amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(amount)) {
      throw new HttpError(400, "amount must be a whole number of USDG base units, as a string.");
    }
    let found: Hex | null;
    if (typeof hash === "string" && isHex(hash) && hash.length === 66) found = hash;
    else if (typeof nonce === "string" && /^[0-9]{1,20}$/.test(nonce)) {
      found = await findPayment({ publicClient, account: player.account, nonce: BigInt(nonce) });
    } else throw new HttpError(400, "Send the payment's hash, or the nonce of a payment the popup was sending.");
    if (!found) throw new HttpError(400, "No payment was found.");
    const verify = () => verifyPayment(found!, { publicClient, account: player.account, to: merchant, amount: BigInt(amount) });
    let verdict = await verify();
    // A node behind the one the relayer sent to may not know the transaction yet: ask again for a few seconds.
    const unknown = () => verdict.checks.length === 1 && verdict.checks[0].detail === "not found";
    for (let tries = 0; tries < RECEIPT_RETRIES && unknown(); tries++) {
      await new Promise(resolve => setTimeout(resolve, RECEIPT_RETRY_MS));
      verdict = await verify();
    }
    if (!verdict.valid) throw new HttpError(400, "The payment did not verify.", verdict.checks);
    const claim = `payment:${found.toLowerCase()}`;
    if (!(await store.claim(claim))) throw new HttpError(409, "This payment was already accepted.");
    const payment: VerifiedPayment = { player, hash: found, to: merchant, amount: BigInt(amount), fee: verdict.fee ?? 0n };
    let result: unknown;
    try {
      result = await options.onPayment?.(payment, request);
    } catch (error) {
      // The payment stays the player's: let them try again once the site is back.
      await store.release(claim);
      throw new HttpError(400, messageOf(error));
    }
    return json(200, { hash: found, amount, fee: payment.fee.toString(), result: result ?? null });
  }

  async function handle(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!ROUTES.includes(route)) return json(404, { error: `There is no VeraKey route "${route}".` });
    const answer = routes[`${request.method.toUpperCase()} ${route}`];
    if (!answer) return json(405, { error: `${request.method} is not allowed on ${route}.` });
    try {
      return await answer(request);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, error.checks ? { error: error.message, checks: error.checks } : { error: error.message });
      console.error("VeraKey: a route failed", error);
      return json(500, { error: "The VeraKey route failed." });
    }
  }

  async function getPlayer(request: Request | { headers: Record<string, string | string[] | undefined> }): Promise<VeraKeyPlayer | null> {
    const headers = request.headers as Headers | Record<string, string | string[] | undefined>;
    const header =
      typeof (headers as Headers).get === "function"
        ? (headers as Headers).get("cookie")
        : [(headers as Record<string, string | string[] | undefined>).cookie ?? []].flat().join("; ");
    return (await readSession(header || null))?.player ?? null;
  }

  return { handle, getPlayer };
}

type NodeHeaders = Record<string, string | string[] | undefined>;
interface ExpressLikeRequest extends AsyncIterable<Uint8Array | string> {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: NodeHeaders;
  body?: unknown;
  /** Set by body-parser 1.x when it parsed this request. */
  _body?: boolean;
  readableEnded?: boolean;
}
interface ExpressLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string | string[]): unknown;
  end(body?: string): unknown;
}

/** Mounts the kit in Express (or Connect): app.use("/api/verakey", toExpress(verakey)). No dependency on Express. */
export function toExpress(server: VeraKeyServer): (req: unknown, res: unknown, next: (error?: unknown) => void) => void {
  return (req, res, next) => {
    serve(server, req as ExpressLikeRequest, res as ExpressLikeResponse).catch(next);
  };
}

async function serve(server: VeraKeyServer, req: ExpressLikeRequest, res: ExpressLikeResponse): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // The body goes on as read, or as Express parsed it, so its original length no longer applies.
    if (value === undefined || name === "content-length" || name === "transfer-encoding") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const method = (req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    // A parser that skipped this request (another content type) can still leave req.body = {}: trust req.body only
    // when a parser read the stream.
    const parsed = req.body !== undefined && (req._body === true || req.readableEnded === true);
    if (parsed && typeof req.body === "string") body = req.body;
    else if (parsed && req.body instanceof Uint8Array) body = new TextDecoder().decode(req.body);
    else if (parsed && typeof req.body === "object" && req.body !== null) body = JSON.stringify(req.body);
    else {
      const read = await readStream(req);
      if (read === null) {
        res.statusCode = 413;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "The request is too large." }));
        return;
      }
      body = read;
    }
  }
  const url = new URL(req.originalUrl ?? req.url ?? "/", `http://${headers.get("host") ?? "localhost"}`);
  const response = await server.handle(new Request(url, { method, headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  res.end(await response.text());
}

/** The raw body as text, or null when it is larger than the kit accepts. */
async function readStream(req: AsyncIterable<Uint8Array | string>): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(bytes);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(all);
}
