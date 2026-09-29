import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiError } from "../shared/api";
import { loadConfig } from "./config";
import { RateLimiter, VisitorKeys } from "./rate-limit";
import { RelayError, Relayer } from "./relayer";
import { formerHostRedirect } from "./redirect";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/index.js in production, server/index.ts under tsx in development.
const ROOT = path.resolve(here, "..");

const config = loadConfig(ROOT);
const relayer = new Relayer(config);
config.network.relayer.address = relayer.address;

// Accounts pay every fee to the deployment's fee recipient and refuse fees above its maximum.
const { maxFee, feeRecipient } = config.network.policy;
if (maxFee !== undefined && BigInt(config.network.relayer.fee) > BigInt(maxFee)) {
  throw new Error(`RELAYER_FEE_USDG_UNITS (${config.network.relayer.fee}) exceeds the accounts' maxFee (${maxFee}): every relay would revert.`);
}
if (feeRecipient && feeRecipient.toLowerCase() !== relayer.address.toLowerCase()) {
  console.warn(`Fees go to ${feeRecipient}, not to this relayer (${relayer.address}).`);
}

const DAY_MS = 24 * 60 * 60_000;
// Visitors are counted by address, an IPv6 one by its /64 (see VisitorKeys), so rotating addresses does not reset them.
const visitors = new VisitorKeys();
const perIp = new RateLimiter(Number(process.env.API_REQUESTS_PER_IP_PER_MINUTE ?? 30), 60_000);
// Weighted by the calls in a batch: this is upstream work, and the relayer sends its own transactions through the same node.
const rpcPerIp = new RateLimiter(900, 60_000);

/** Read-only JSON-RPC methods the browser may use through /api/rpc. */
const RPC_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode", "eth_getBalance", "eth_getBlockByNumber",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_estimateGas",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs", "net_version",
]);
/** The app never batches; a batch only multiplies upstream work. */
const MAX_RPC_BATCH = 10;
/** The widest log query the app makes (a scheduled change's payload, ~7 hours of Arbitrum blocks). */
const MAX_LOG_BLOCKS = 100_000n;

/** A log query must name the contracts it reads and a bounded block range, or one request could scan the chain. */
function boundedLogQuery(params: unknown): boolean {
  const filter = Array.isArray(params) ? (params[0] as Record<string, unknown> | undefined) : undefined;
  if (!filter || typeof filter !== "object") return false;
  const address = filter.address;
  if (!(typeof address === "string" || (Array.isArray(address) && address.length > 0 && address.length <= 10))) return false;
  if (typeof filter.blockHash === "string") return true;
  const block = (value: unknown) => (typeof value === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(value) ? BigInt(value) : null);
  const from = block(filter.fromBlock);
  const to = block(filter.toBlock);
  return from !== null && to !== null && to >= from && to - from <= MAX_LOG_BLOCKS;
}

function allowedRpcCall(call: unknown): boolean {
  const { method, params } = (call ?? {}) as { method?: unknown; params?: unknown };
  if (typeof method !== "string" || !RPC_METHODS.has(method)) return false;
  return method !== "eth_getLogs" || boundedLogQuery(params);
}

const upstreamRpc = config.upstreamRpcUrl;
const perAccount = new RateLimiter(12, 60_000);
// Creating an account costs the relayer gas and takes no proof: cap it per visitor, not only per
// (attacker-chosen) nullifier, and for everyone together, so no number of visitors can empty the relayer.
const accountsPerIp = new RateLimiter(Number(process.env.ACCOUNTS_PER_IP_PER_DAY ?? 10), DAY_MS);
const newAccountsPerDay = new RateLimiter(Number(process.env.NEW_ACCOUNTS_PER_DAY ?? 500), DAY_MS);
// FAUCET_ACCOUNTS_PER_IP only exists so automated end-to-end runs against a local devnode can fund more
// than three accounts a day; the public deployment keeps the default.
const faucetPerIp = new RateLimiter(Number(process.env.FAUCET_ACCOUNTS_PER_IP ?? 3), DAY_MS);
const faucetGrantsPerDay = new RateLimiter(Number(process.env.FAUCET_GRANTS_PER_DAY ?? 20), DAY_MS);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// A host VeraKey moved away from sends every request to the same path on the deployment's origin.
app.use((req, res, next) => {
  const target = formerHostRedirect(req.hostname, req.originalUrl, config.network.origin);
  if (target) return void res.redirect(308, target);
  next();
});

// Cross-origin isolation (multi-threaded proving) and a strict CSP. bb.js needs 'wasm-unsafe-eval'.
// The Sign in with VeraKey popup (/connect) must keep its link to the site that opened it, which COOP would cut,
// so it isolates itself with Document-Isolation-Policy instead.
app.use((req, res, next) => {
  if (req.path === "/connect") {
    res.setHeader("Document-Isolation-Policy", "isolate-and-require-corp");
  } else {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "publickey-credentials-get=(self), publickey-credentials-create=(self)");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      // bb.js fetches its embedded WASM from a data: URL; neither data: nor blob: reaches the network.
      "connect-src 'self' data: blob:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ")
  );
  next();
});

app.use("/api", express.json({ limit: "64kb" }));

// Browser reads go through the relayer origin: the CSP stays 'self'-only, the upstream RPC (and any
// provider key) stays server-side, and nodes without CORS headers still work.
app.post("/api/rpc", async (req, res) => {
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (calls.length === 0 || calls.length > MAX_RPC_BATCH || !calls.every(allowedRpcCall)) {
    return void res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not allowed" } });
  }
  if (!rpcPerIp.take(`rpc:${visitors.key(req.ip)}`, calls.length)) return void res.status(429).json({ error: "Too many requests." });
  try {
    const upstream = await fetch(upstreamRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });
    res.status(upstream.status).type("application/json").send(await upstream.text());
  } catch {
    res.status(502).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Upstream RPC unavailable" } });
  }
});

app.use("/api", (req, res, next) => {
  if (req.path === "/rpc") return next();
  if (!perIp.take(`ip:${visitors.key(req.ip)}`)) return void res.status(429).json({ error: "Too many requests." } satisfies ApiError);
  next();
});

const route =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

app.get("/api/config", (_req, res) => void res.json(config.network));

app.get("/api/health", route(async (_req, res) => void res.json(await relayer.health())));

app.post(
  "/api/accounts",
  route(async (req, res) => {
    const { appId, nullifier } = req.body ?? {};
    if (!perAccount.take(`create:${nullifier}`)) throw new RelayError(429, "Too many requests for this account.");
    const created = await relayer.createAccount(appId, nullifier, () => {
      if (!accountsPerIp.take(`accounts:${visitors.key(req.ip)}`)) {
        throw new RelayError(429, "Too many new accounts from this visitor today.");
      }
      if (!newAccountsPerDay.take("all")) {
        throw new RelayError(429, "The relayer has created as many accounts as it will today. Try again tomorrow.");
      }
    });
    res.json(created);
  })
);

app.post(
  "/api/relay",
  route(async (req, res) => {
    if (!perAccount.take(`relay:${req.body?.account}`)) throw new RelayError(429, "Too many requests for this account.");
    res.json({ hash: await relayer.relay(req.body) });
  })
);

app.post(
  "/api/faucet",
  route(async (req, res) => {
    if (!faucetPerIp.take(`faucet:${visitors.key(req.ip)}`)) throw new RelayError(429, `The faucet allows ${process.env.FAUCET_ACCOUNTS_PER_IP ?? 3} accounts per day per visitor.`);
    const hash = await relayer.faucet(req.body?.account, () => {
      if (!faucetGrantsPerDay.take("all")) throw new RelayError(429, "The demo faucet has given out today's USDG. Try again tomorrow.");
    });
    res.json({ hash });
  })
);

app.use("/api", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof RelayError) {
    return void res.status(error.status).json({ error: error.message, revert: error.revert } satisfies ApiError);
  }
  console.error(error);
  res.status(500).json({ error: "Relayer error." } satisfies ApiError);
});

// Static app (production build). Express static serves HTTP Range requests, which bb.js uses for the CRS.
const staticDir = path.resolve(ROOT, "dist", "public");
if (existsSync(staticDir)) {
  // The build prerenders every docs page (scripts/prerender-docs.mjs), so readers without JavaScript get its content;
  // the path allows only lowercase letters, digits and hyphens, so it stays inside docs/.
  app.get(/^\/docs(?:\/[a-z0-9-]+)*\/?$/, (req, res, next) => {
    const page = path.join(staticDir, `${req.path.replace(/\/$/, "")}.html`);
    if (!existsSync(page)) return next();
    // no-transform: a proxy that rewrites HTML, such as Cloudflare's email obfuscation, would break hydration.
    res.setHeader("Cache-Control", "public, max-age=0, no-transform");
    res.sendFile(page);
  });
  // The router knows each page by its clean path, so the prerendered files are not pages of their own.
  app.get(/^\/docs(?:\/[a-z0-9-]+)*\.html$/, (req, res) => res.redirect(301, req.path.slice(0, -".html".length)));
  // No redirect from /docs/build to /docs/build/: directories are not pages.
  app.use(express.static(staticDir, { index: false, maxAge: "1h", redirect: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

// Behind a tunnel or proxy on the same machine, HOST=127.0.0.1 keeps the port private: a direct
// client could otherwise forge the X-Forwarded-For address the rate limits key on.
createServer(app).listen(config.port, process.env.HOST, () => {
  console.log(`VeraKey relayer (${config.network.network}) on http://localhost:${config.port} — relayer ${relayer.address}`);
  // Accounts only accept passkeys used on the origin the factory was deployed with.
  console.log(`Passkeys and accounts are bound to ${config.network.origin}: serve the app there.`);
});
