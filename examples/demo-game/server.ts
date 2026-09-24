// The demo game for "Sign in with VeraKey": a site on its own origin that signs players in through VeraKey's popup
// and sells a sword for 1 USDG. Its server issues nonces and verifies every sign-in and payment itself.
// Local only: run `pnpm dev` (VeraKey on :5190 against a devnode) and `pnpm demo:game` (this game on :5191).
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { createServer as createVite } from "vite";
import { findPayment, verifyPayment, verifySignIn, type SignInResult } from "@verakey/sdk/signin";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = Number(process.env.DEMO_GAME_PORT ?? 5191);
const ORIGIN = `http://localhost:${PORT}`;
const VERAKEY_URL = process.env.VERAKEY_URL ?? "http://localhost:5190";
const deployment = JSON.parse(readFileSync(path.join(ROOT, "deployments/local.json"), "utf8")) as {
  chainId: number;
  rpcUrl: string;
  origin: string;
  rpIdHash: Hex;
  contracts: { factory: Address; honkVerifier: Address };
};
/** The game's merchant address and the sword's price in USDG base units. */
const MERCHANT: Address = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe";
const PRICE = 1_000_000n;

const chain = defineChain({
  id: deployment.chainId,
  name: "nitro-devnode",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http() });
const nonces = new Map<string, number>(); // nonce → expiry (ms)
const sessions = new Map<string, { playerId: Hex; account: Address }>();
const paid = new Set<string>(); // each payment buys once

/** Express 4 does not catch errors in async handlers: answer them instead of leaving the request hanging. */
const guarded =
  (handler: (req: express.Request, res: express.Response) => Promise<void>) => (req: express.Request, res: express.Response) =>
    void handler(req, res).catch(error => res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) }));

const app = express();
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  // ?coop=same-origin shows what that header does to Sign in with VeraKey: the SDK reports "unavailable".
  if (req.query.coop === "same-origin") res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "64kb" }));

app.get("/game-api/config", (_req, res) => void res.json({ verakeyUrl: VERAKEY_URL, merchant: MERCHANT, price: PRICE.toString() }));

app.post("/game-api/nonce", (_req, res) => {
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  nonces.set(nonce, Date.now() + 5 * 60_000);
  res.json({ nonce });
});

app.post("/game-api/sign-in", guarded(async (req, res) => {
  const result = req.body as SignInResult;
  const nonce = result?.statement?.nonce?.toLowerCase();
  const expiry = nonce ? nonces.get(nonce) : undefined;
  if (!nonce || !expiry || expiry < Date.now()) return void res.status(400).json({ ok: false, error: "Unknown or expired nonce." });
  nonces.delete(nonce);
  const verdict = await verifySignIn(result, {
    origin: ORIGIN,
    nonce: nonce as Hex,
    publicClient: publicClient as never,
    deployment: {
      chainId: deployment.chainId,
      factory: deployment.contracts.factory,
      rpIdHash: deployment.rpIdHash,
      origin: deployment.origin,
      honkVerifier: deployment.contracts.honkVerifier,
    },
  });
  if (!verdict.valid) return void res.status(401).json({ ok: false, checks: verdict.checks });
  const session = randomUUID();
  sessions.set(session, { playerId: verdict.playerId!, account: verdict.account! });
  res.json({ ok: true, session, playerId: verdict.playerId, account: verdict.account, appId: result.statement.appId, checks: verdict.checks });
}));

app.post("/game-api/verify-payment", guarded(async (req, res) => {
  const { session, hash, nonce } = req.body as { session?: string; hash?: string; nonce?: string };
  const player = session ? sessions.get(session) : undefined;
  if (!player) return void res.status(401).json({ ok: false, error: "Sign in first." });
  // A popup that closed while sending the payment leaves only the account's action nonce: find the payment by it.
  const found =
    typeof hash === "string" ? (hash as Hex)
      : typeof nonce === "string" && /^[0-9]{1,20}$/.test(nonce)
        ? await findPayment({ publicClient: publicClient as never, account: player.account, nonce: BigInt(nonce) })
        : null;
  if (!found) return void res.status(400).json({ ok: false, error: "No payment found." });
  if (paid.has(found.toLowerCase())) return void res.status(409).json({ ok: false, error: "This payment already bought a sword." });
  const verdict = await verifyPayment(found, { publicClient: publicClient as never, account: player.account, to: MERCHANT, amount: PRICE });
  if (verdict.valid) paid.add(found.toLowerCase());
  res.status(verdict.valid ? 200 : 400).json({ ok: verdict.valid, hash: found, checks: verdict.checks });
}));

// Its own dependency cache: VeraKey's dev server keeps node_modules/.vite, and sharing it would reload VeraKey.
const vite = await createVite({
  root: import.meta.dirname,
  configFile: false,
  appType: "spa",
  cacheDir: path.join(ROOT, "node_modules/.vite-demo-game"),
  server: { middlewareMode: true, hmr: false },
});
app.use(vite.middlewares);
app.listen(PORT, "localhost", () => console.log(`demo game on ${ORIGIN} (VeraKey at ${VERAKEY_URL})`));
