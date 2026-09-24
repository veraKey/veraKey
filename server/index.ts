import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiError } from "../shared/api";
import { loadConfig } from "./config";
import { RateLimiter, VisitorKeys } from "./rate-limit";
import { RelayError, Relayer } from "./relayer";

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

const visitors = new VisitorKeys();
const perIp = new RateLimiter(Number(process.env.API_REQUESTS_PER_IP_PER_MINUTE ?? 30), 60_000);
const rpcPerIp = new RateLimiter(900, 60_000);

/** Read-only JSON-RPC methods the browser may use through /api/rpc. */
const RPC_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode", "eth_getBalance", "eth_getBlockByNumber",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_estimateGas",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs", "net_version",
]);
const upstreamRpc = config.upstreamRpcUrl;
const perAccount = new RateLimiter(12, 60_000);
// Creating an account costs the relayer gas and takes no proof: cap it per visitor, not only per
// (attacker-chosen) nullifier.
const accountsPerIp = new RateLimiter(Number(process.env.ACCOUNTS_PER_IP_PER_DAY ?? 10), 24 * 60 * 60_000);
// FAUCET_ACCOUNTS_PER_IP only exists so automated end-to-end runs against a local devnode can fund more
// than three accounts a day; the public deployment keeps the default.
const faucetPerIp = new RateLimiter(Number(process.env.FAUCET_ACCOUNTS_PER_IP ?? 3), 24 * 60 * 60_000);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Cross-origin isolation (multi-threaded proving) and a strict CSP. bb.js needs 'wasm-unsafe-eval'.
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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
  if (!rpcPerIp.take(`rpc:${visitors.key(req.ip)}`)) return void res.status(429).json({ error: "Too many requests." });
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (calls.length > 20 || calls.some(c => !c || typeof c.method !== "string" || !RPC_METHODS.has(c.method))) {
    return void res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not allowed" } });
  }
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
    res.json({ hash: await relayer.faucet(req.body?.account) });
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
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

// Behind a tunnel or proxy on the same machine, HOST=127.0.0.1 keeps the port private: a direct
// client could otherwise forge the X-Forwarded-For address the rate limits key on.
createServer(app).listen(config.port, process.env.HOST, () => {
  console.log(`VeraKey relayer (${config.network.network}) on http://localhost:${config.port} — relayer ${relayer.address}`);
  // Accounts only accept passkeys used on the origin the factory was deployed with.
  console.log(`Passkeys and accounts are bound to ${config.network.origin}: serve the app there.`);
});
