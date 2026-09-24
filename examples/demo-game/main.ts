import { VeraKeyConnect, VeraKeyConnectError } from "@verakey/sdk/connect";
import type { Address, Hex } from "viem";

const element = (id: string) => document.getElementById(id) as HTMLElement;
const config = (await (await fetch("/game-api/config")).json()) as { verakeyUrl: string; merchant: Address; price: string };
const verakey = new VeraKeyConnect({ url: config.verakeyUrl });
let session: string | null = null;

const describe = (error: unknown) => (error instanceof VeraKeyConnectError ? `${error.code}: ${error.message}` : String(error));
const post = async (url: string, body?: unknown) =>
  (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

element("sign-in").addEventListener("click", async () => {
  const status = element("status");
  status.textContent = "Waiting for VeraKey…";
  try {
    const result = await verakey.signIn({ nonce: async () => (await post("/game-api/nonce")).nonce as Hex });
    const verdict = await post("/game-api/sign-in", result);
    if (!verdict.ok) throw new Error(`the game's server refused the sign-in: ${JSON.stringify(verdict.checks ?? verdict.error)}`);
    session = verdict.session;
    Object.assign(status.dataset, { playerId: verdict.playerId, appId: verdict.appId, nonce: result.statement.nonce, account: verdict.account });
    status.textContent = `Signed in. Player ID ${verdict.playerId.slice(0, 10)}…, account ${verdict.account.slice(0, 10)}… (verified by the game's server)`;
    element("shop").hidden = false;
  } catch (error) {
    status.textContent = `Not signed in (${describe(error)})`;
  }
});

element("buy").addEventListener("click", async () => {
  const receipt = element("receipt");
  receipt.textContent = "Waiting for VeraKey…";
  try {
    const payment = await verakey.pay({ to: config.merchant, amount: BigInt(config.price) });
    const verdict = await post("/game-api/verify-payment", { session, hash: payment.hash });
    if (!verdict.ok) throw new Error(`the game's server refused the payment: ${JSON.stringify(verdict.checks ?? verdict.error)}`);
    receipt.textContent = `Payment verified: ${payment.hash.slice(0, 12)}… The sword is yours.`;
  } catch (error) {
    receipt.textContent = `No payment (${describe(error)})`;
  }
});

// The buttons stay disabled until their handlers exist.
for (const id of ["sign-in", "buy"]) (element(id) as HTMLButtonElement).disabled = false;
