// The React quickstart: Sign in with VeraKey and a 1 USDG purchase with the SDK's integration kit. The integration is
// the block marked below; the rest serves the page. Locally: `pnpm dev` (VeraKey on :5190 against a devnode) and
// `pnpm demo:react` (this site on :5192). Against Arbitrum Sepolia: `VERAKEY_NETWORK=sepolia pnpm demo:react`.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import express from "express";
import { createServer as createVite } from "vite";
import { ARBITRUM_SEPOLIA, type VeraKeyDeployment } from "@verakey/sdk/deployments";
import { createVeraKeyServer, toExpress } from "@verakey/sdk/server";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = Number(process.env.REACT_QUICKSTART_PORT ?? 5192);
const ORIGIN = `http://localhost:${PORT}`;
const MERCHANT = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe";
const PRICE = 1_000_000n; // 1 USDG

/** The devnode deployment by default, ARBITRUM_SEPOLIA with VERAKEY_NETWORK=sepolia. */
function deployment(): VeraKeyDeployment {
  if (process.env.VERAKEY_NETWORK === "sepolia") return ARBITRUM_SEPOLIA;
  const local = JSON.parse(readFileSync(path.join(ROOT, "deployments/local.json"), "utf8"));
  return {
    name: "local",
    chainId: local.chainId,
    rpcUrl: local.rpcUrl,
    origin: process.env.VERAKEY_URL ?? local.origin,
    rpIdHash: local.rpIdHash,
    factory: local.contracts.factory,
    honkVerifier: local.contracts.honkVerifier,
    usdg: local.contracts.usdg,
  };
}

const swords = new Map<string, number>(); // player ID → swords bought

// ── The integration ─────────────────────────────────────────────────────────
const verakey = createVeraKeyServer({
  origin: ORIGIN,
  deployment: deployment(),
  secret: process.env.VERAKEY_SECRET ?? randomBytes(32).toString("hex"),
  merchant: MERCHANT,
  onPayment: ({ player, amount }) => {
    if (amount !== PRICE) throw new Error("A sword costs 1 USDG.");
    swords.set(player.id, (swords.get(player.id) ?? 0) + 1);
    return { swords: swords.get(player.id) };
  },
});
const app = express();
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use("/api/verakey", toExpress(verakey));
// ────────────────────────────────────────────────────────────────────────────

app.get("/api/swords", async (req, res) => {
  const player = await verakey.getPlayer(req);
  res.json({ swords: player ? (swords.get(player.id) ?? 0) : null });
});

// Its own dependency cache, and one React for the page and the SDK's React module.
const vite = await createVite({
  root: import.meta.dirname,
  configFile: false,
  appType: "spa",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  cacheDir: path.join(ROOT, "node_modules/.vite-react-quickstart"),
  server: { middlewareMode: true, hmr: false },
});
app.use(vite.middlewares);
app.listen(PORT, "localhost", () => console.log(`React quickstart on ${ORIGIN} (VeraKey at ${deployment().origin})`));
