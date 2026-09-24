import { A, Code, H2, Table } from "../../components";

export default function SignInPage() {
  return (
    <>
      <H2>How sign-in works</H2>
      <p>
        Sign in with VeraKey lets a game or an app on its own domain sign players in with their VeraKey passkey, and take
        USDG payments from them. Your page opens VeraKey's popup, the player approves with Face ID or Touch ID, and your
        page gets back a result that your server verifies itself.
      </p>
      <ul>
        <li><strong>A player ID only your site knows.</strong> Your app id is derived from your origin, so the popup only ever gives you the player's ID for your site, never their ID anywhere else.</li>
        <li><strong>A proof, not a promise.</strong> The result carries a zero-knowledge proof that the player's passkey approved this sign-in, for your origin and your nonce. Your server checks it on-chain with a free call, or locally.</li>
        <li><strong>Private by default.</strong> The proof is made in the player's browser. During a sign-in, no request to VeraKey carries the player ID, your app id or your nonce.</li>
        <li><strong>Payments with the account's protections.</strong> The popup shows your real domain, the recipient and the amount, and pays from the player's account for your site, within its caps.</li>
      </ul>
      <Code lang="text" title="One sign-in">{`
your page ── signIn({ nonce }) ──▶ VeraKey popup: "Requested by https://your.game"
                                   the player approves; the browser proves
your page ◀── result ───────────── { playerId, account, statement, proof }
your server: verifySignIn(result) ── eth_call ──▶ HonkVerifier on Arbitrum
`}</Code>

      <H2>Add the button</H2>
      <p>Create one client with VeraKey's address, and call <code>signIn</code> from a click, so the browser allows the popup:</p>
      <Code lang="ts" title="game.ts">{`
import { VeraKeyConnect, VeraKeyConnectError } from "@verakey/sdk/connect";

const verakey = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });
const newNonce = async () => (await (await fetch("/api/nonce", { method: "POST" })).json()).nonce;

button.onclick = async () => {
  try {
    // The popup opens at once; the nonce arrives from your server while it loads.
    const result = await verakey.signIn({ nonce: newNonce });
    await fetch("/api/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    });
  } catch (error) {
    if (error instanceof VeraKeyConnectError) console.log(error.code); // "cancelled", "closed", …
  }
};
`}</Code>
      <p>
        The first time, the player creates their VeraKey passkey right in the popup. After that, a sign-in takes two
        passkey prompts: one unlocks the passkey, one approves the sign-in.
      </p>

      <H2>Verify on your server</H2>
      <p>Issue a random 32-byte nonce for each sign-in, accept it once, and verify the result against the VeraKey deployment you pinned:</p>
      <Code lang="ts" title="server.ts">{`
import { verifySignIn } from "@verakey/sdk/signin";

const verdict = await verifySignIn(result, {
  origin: "https://your.game", // your own origin
  nonce,                       // the nonce you issued for this sign-in
  publicClient,                // a viem client for Arbitrum
  deployment: {                // pinned in your configuration
    chainId, factory, rpIdHash, honkVerifier,
    origin: "https://verakey.mdloglabs.org",
  },
});
if (verdict.valid) startSession(verdict.playerId, verdict.account);
`}</Code>
      <p>
        Take the deployment's values from <A href="/docs/reference/deployments">Deployments</A> and keep them in your
        server's configuration; never read them from a result. <code>verifySignIn</code> returns every check:
      </p>
      <Table
        stack
        head={["Check", "What it confirms"]}
        rows={[
          ["This deployment", "The chain and the factory are the ones you pinned."],
          ["Made for this site, App id of this site", "The sign-in names your origin, and the app id derived from it."],
          ["Carries the nonce you issued", "The nonce is yours; accept each one once."],
          ["Not expired, Short-lived", "It is valid for at most five minutes, with a minute of tolerance for the player's device clock."],
          ["Passkey signed this sign-in, Signed on VeraKey", "The passkey signed exactly this statement, on VeraKey's origin."],
          ["Proof commits to this sign-in, Proof verifies", "The proof's public inputs are this sign-in's, and the verifier accepts it."],
          ["Account of this player, Player still owns the account", "The account is the player's for your site, and still theirs."],
        ]}
      />

      <H2>Take a payment</H2>
      <Code lang="ts">{`
// in the page, from a click
const payment = await verakey.pay({ to: MERCHANT, amount: 1_000_000n }); // 1 USDG

// on your server, for the signed-in player
const paid = await verifyPayment(payment.hash, {
  publicClient, account: session.account, to: MERCHANT, amount: 1_000_000n,
});
`}</Code>
      <ul>
        <li>The popup shows your domain, the recipient, the amount plus the relayer fee, and the balance.</li>
        <li>The player pays from the account VeraKey keeps for your site. A new account needs USDG first; the popup shows its address, and on the testnet a faucet.</li>
        <li>Every account protection applies: the caps, the cap on a first payment to a new recipient (2 USDG on Arbitrum Sepolia), the allowlist, a freeze, and the payment sheet when the player requires it.</li>
        <li>VeraKey's relayer submits the payment, so it sees the transaction, which is public on-chain anyway.</li>
        <li>Accept each transaction hash once, so one payment never buys twice.</li>
      </ul>

      <H2>Security checklist</H2>
      <ul>
        <li>Verify every sign-in on your server with <code>verifySignIn</code>, never in the page.</li>
        <li>Use a fresh random nonce for each sign-in, accept it once, and let it expire.</li>
        <li>Pin the deployment (chain, factory, verifier and VeraKey's origin) in your server's configuration.</li>
        <li>Serve your site over https. The popup answers only https sites, and localhost while you develop.</li>
        <li>Send <code>Referrer-Policy: no-referrer</code>, so VeraKey's server does not learn your domain when the popup loads.</li>
        <li>Do not send <code>Cross-Origin-Opener-Policy: same-origin</code> from the page that opens the popup: it cuts the popup off. Send <code>same-origin-allow-popups</code> if you need isolation.</li>
      </ul>

      <H2>Errors and limits</H2>
      <Table
        stack
        head={["code", "What happened"]}
        rows={[
          [<code key="1">blocked</code>, "The browser blocked the popup: call signIn and pay from a click."],
          [<code key="2">unavailable</code>, "The popup never answered, usually because the page sends Cross-Origin-Opener-Policy: same-origin."],
          [<code key="3">closed</code>, "The player closed the popup. If error.hash is set, the payment was already sent: verify it before asking again."],
          [<code key="4">busy</code>, "Another request from this page is still open."],
          [<code key="5">origin</code>, "The page is not on https, or localhost."],
          [<code key="6">request</code>, "A malformed request, such as a nonce that is not 32 bytes."],
          [<code key="7">cancelled</code>, "The player cancelled."],
          [<code key="8">funds, policy, device, proof, relay</code>, <>The same stages as the SDK: see <A href="/docs/reference/errors">Errors</A>.</>],
        ]}
      />
      <ul>
        <li>A sign-in takes two passkey prompts, because the popup keeps nothing between visits.</li>
        <li>Chrome proves on several threads. Safari and Firefox prove on one thread, so their sign-ins and payments take a few seconds longer; proving on iPhone has not been measured yet.</li>
        <li>Each passkey is its own player: a backup passkey, or a new passkey after a guardian recovery, gets a new player ID on your site.</li>
        <li>A phishing site gets its own origin shown in the popup, never yours; players still need to read it.</li>
      </ul>
    </>
  );
}
