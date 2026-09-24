import { A, Code, H2, Table } from "../../components";
import { SDK_NPM_URL } from "../../site";

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
        <li><strong>A player ID for your site alone.</strong> Your app id is derived from your origin, so the popup only ever gives you the player's ID for your site. Other sites get different IDs, and nobody can link them.</li>
        <li><strong>A proof, not a promise.</strong> The result carries a zero-knowledge proof that the player's passkey approved this sign-in, for your origin and your nonce. Your server checks it on-chain with a free call, or locally.</li>
        <li><strong>Private by default.</strong> The proof is made in the player's browser. During a sign-in, no request to VeraKey carries the player ID, your app id or your nonce.</li>
        <li><strong>Payments from an account for your site.</strong> The popup shows your real domain, the recipient and the amount, and pays from the account VeraKey keeps for the player on your site, within its caps.</li>
      </ul>
      <Code lang="text" title="One sign-in">{`
your page ── signIn({ nonce }) ──▶ VeraKey popup: "Requested by https://your.game"
                                   the player approves; the browser proves
your page ◀── result ───────────── { playerId, account, statement, proof }
your server: verifySignIn(result) ── eth_call ──▶ HonkVerifier on Arbitrum
`}</Code>

      <H2>Add the button</H2>
      <p>
        Install <A href={SDK_NPM_URL}>the SDK</A> with <code>npm install @verakey/sdk</code>. Create one client with
        VeraKey's address, and call <code>signIn</code> from a click, so the browser allows the popup:
      </p>
      <Code lang="ts" title="game.ts">{`
import { VeraKeyConnect, VeraKeyConnectError } from "@verakey/sdk/connect";

const verakey = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });

// A fresh nonce from your server. Throw its refusal: the popup closes, and your page gets it as error.cause.
async function newNonce() {
  const response = await fetch("/api/nonce", { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body.nonce;
}

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
    // error.cause: what your own nonce callback threw. error.code: why VeraKey stopped, e.g. "cancelled".
    if (error instanceof VeraKeyConnectError) console.log(error.cause ?? error.code);
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
        server's configuration; never read them from a result. <code>verifySignIn</code> returns every check, and the{" "}
        <code>detail</code> of a failed one says why. A malformed result is a refusal, never an exception:
      </p>
      <Table
        stack
        head={["Check", "What it confirms"]}
        rows={[
          ["Format, Well-formed fields", "The result is a version 1 sign-in, and every field has the right shape and range."],
          ["This deployment", "The chain and the factory are the ones you pinned."],
          ["Made for this site, App id of this site", "The sign-in names your origin, and the app id derived from it."],
          ["Carries the nonce you issued", "The nonce is yours; accept each one once."],
          ["Not expired, Short-lived", "It is valid for at most five minutes, with a minute of tolerance for the player's device clock."],
          ["Passkey signed this sign-in, Signed on VeraKey", "The passkey signed exactly this statement, on VeraKey's origin."],
          ["Proof commits to this sign-in, Proof verifies", "The proof's public inputs are this sign-in's, and the verifier accepts it."],
          ["Account of this player, Player still owns the account", "The account is the player's for your site, and still theirs. An account that is not deployed yet passes: it is created for this player on first use."],
        ]}
      />
      <p>
        The player ID names a player; it is not a secret. Once the player's account is used on-chain, anyone can read
        it, so never accept a player ID as proof of who someone is: only a verified sign-in shows that, and your own
        session carries it from there.
      </p>

      <H2>Take a payment</H2>
      <Code lang="ts">{`
// in the page, from a click
try {
  const payment = await verakey.pay({ to: MERCHANT, amount: 1_000_000n, account: session.account }); // 1 USDG
  await confirmOnServer({ hash: payment.hash });
} catch (error) {
  // The popup closed after sending the payment, or while sending it: check before asking again.
  if (error instanceof VeraKeyConnectError && error.hash) await confirmOnServer({ hash: error.hash });
  else if (error instanceof VeraKeyConnectError && error.pending) await confirmOnServer({ nonce: error.pending.nonce.toString() });
}

// on your server, for the signed-in player
const hash = body.hash ?? (await findPayment({ publicClient, account: session.account, nonce: BigInt(body.nonce) }));
const paid = hash && (await verifyPayment(hash, {
  publicClient, account: session.account, to: MERCHANT, amount: 1_000_000n,
}));
`}</Code>
      <ul>
        <li>The popup shows your domain, the recipient, the amount plus the relayer fee, and the balance.</li>
        <li>Pass <code>account</code>, the signed-in player's account: the popup then refuses to pay from any other, for example when the player unlocks a different passkey.</li>
        <li>The player pays from the account VeraKey keeps for your site. A new account needs USDG first; the popup shows its address, and on the testnet a faucet.</li>
        <li>
          The account for your site has the default protections: the per-payment and daily caps, and a cap on the first
          payment to a new recipient (2 USDG on Arbitrum Sepolia). Players cannot yet manage these accounts in the VeraKey
          app, change their protections or withdraw from them, so ask players to top up only what they plan to spend.
        </li>
        <li>
          Once the payment starts, the popup cannot be cancelled, and it asks before it is closed. If it closes anyway,{" "}
          <code>error.hash</code> means the payment was sent: verify it. <code>error.pending</code> means it may have been
          sent: find it with <code>findPayment</code>, which waits for it, then verify it.
        </li>
        <li><code>verifyPayment</code> waits for a payment that is sent but not yet in a block.</li>
        <li>VeraKey's relayer submits the payment, so it sees the transaction, which is public on-chain anyway.</li>
        <li>Accept each transaction hash once, so one payment never buys twice.</li>
      </ul>

      <H2>Develop locally</H2>
      <p>
        The popup answers https sites, and plain http on <code>localhost</code> and <code>127.0.0.1</code> while you
        develop. A site is its exact origin: scheme, host and port together.
      </p>
      <ul>
        <li>
          <code>http://localhost:5173</code> and <code>http://127.0.0.1:5173</code> are different sites. Each gets its own
          player IDs and accounts, and <code>verifySignIn</code> refuses a sign-in made on one when your server verifies
          as the other: the "Made for this site" check fails, and its detail names both origins.
        </li>
        <li>
          Behind a development proxy, such as Vite's <code>server.proxy</code>, verify as the page's origin, the one in the
          address bar, not as your API server's.
        </li>
        <li>
          Keep the origin in your server's configuration, and check the <code>Origin</code> header when you issue a nonce.
          If they differ, refuse with the address to open: the popup closes, and your page gets your message as{" "}
          <code>error.cause</code>.
        </li>
      </ul>

      <H2>Test your integration</H2>
      <p>
        Your end-to-end tests can sign players in for real, in headless Chromium: give VeraKey's popup a virtual passkey
        authenticator with PRF through the Chrome DevTools Protocol, and drive the popup by its test ids. A sign-in takes
        about ten seconds. With Playwright:
      </p>
      <Code lang="ts" title="sign-in.spec.ts">{`
import { expect, test, type Page } from "@playwright/test";

/** A passkey authenticator with PRF for VeraKey's popup, like a phone's or a password manager's. */
async function addPasskeyAuthenticator(popup: Page) {
  const cdp = await popup.context().newCDPSession(popup);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true, // VeraKey needs the PRF extension
    },
  });
}

test("a player signs in with a new VeraKey passkey", async ({ page }) => {
  await page.goto("http://localhost:5173/");
  const popupOpens = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in with VeraKey" }).click(); // your page's button
  const popup = await popupOpens;
  await addPasskeyAuthenticator(popup);

  await expect(popup.getByTestId("connect-requester")).toHaveText("http://localhost:5173");
  await popup.getByTestId("connect-create-passkey").click();
  await popup.getByTestId("connect-sign-in").click();
  // The popup proves the sign-in and closes itself; then your server verifies it.
  await expect(page.getByText("Signed in")).toBeVisible({ timeout: 120_000 });
});
`}</Code>
      <ul>
        <li>
          The authenticator lives in the popup's window, so add one to every popup your test opens. A new one holds no
          passkey: create one in each popup, and each is a new player.
        </li>
        <li>Every control a test drives has a <code>data-testid</code>. The labels may change; the test ids stay.</li>
      </ul>
      <Table
        stack
        head={["Test id", "What it is"]}
        rows={[
          [<code key="1">connect-waiting</code>, "Shown until your page's request arrives."],
          [<code key="2">connect-requester</code>, "The origin the popup names as the requester: your page's."],
          [<code key="3">connect-create-passkey</code>, "Creates a VeraKey passkey."],
          [<code key="4">connect-unlock</code>, "Unlocks a passkey the player already has."],
          [<code key="5">connect-sign-in</code>, "Approves the sign-in."],
          [<code key="6">connect-top-up</code>, "Asks for demo USDG, on the testnet."],
          [<code key="7">connect-check-balance</code>, "Reads the account's balance again."],
          [<code key="8">connect-pay</code>, "Approves the payment."],
          [<code key="9">connect-other-player</code>, "The passkey unlocked is not the player whose account your page named."],
          [<code key="10">connect-cancel</code>, "Cancels the request; the popup closes."],
          [<code key="11">connect-done</code>, "The request succeeded. The popup closes itself right after, so wait for it to close rather than for this."],
          [<code key="12">connect-error</code>, "Why a step failed, such as the request or a top-up; the popup stays open."],
          [<code key="13">connect-close</code>, "Closes the popup: after a failure or a refused request, or when your page's request never arrives."],
          [<code key="14">connect-rejected</code>, "The popup refused your page's request, for example from a site on plain http."],
        ]}
      />

      <H2>Security checklist</H2>
      <ul>
        <li>Verify every sign-in on your server with <code>verifySignIn</code>, never in the page.</li>
        <li>
          Use a fresh random nonce for each sign-in, bind it to the browser session that asked for it (for example with a
          cookie), accept it once, and let it expire. Otherwise an attacker could sign someone else's browser in as
          themselves.
        </li>
        <li>Pin the deployment (chain, factory, verifier and VeraKey's origin) in your server's configuration.</li>
        <li>Serve your site over https. The popup answers only https sites, and localhost or 127.0.0.1 while you develop.</li>
        <li>Send <code>Referrer-Policy: no-referrer</code>, so VeraKey's server does not learn your domain when the popup loads.</li>
        <li>
          Keep the popup's link to your page: do not send <code>Cross-Origin-Opener-Policy: same-origin</code> from the
          page that opens it. Send <code>same-origin-allow-popups</code>, or no such header. If your page needs
          cross-origin isolation, use <code>Document-Isolation-Policy</code>, as VeraKey's popup does.
        </li>
        <li>
          Choose your origin for good. Player IDs and accounts belong to the exact origin, so moving to another domain, or
          from game.example to www.game.example, starts every player over with a new ID and an empty account.
        </li>
      </ul>

      <H2>Errors and limits</H2>
      <Table
        stack
        head={["code", "What happened"]}
        rows={[
          [<code key="1">blocked</code>, "The browser blocked the popup: call signIn and pay from a click."],
          [<code key="2">unavailable</code>, "The popup never answered: the page sends Cross-Origin-Opener-Policy: same-origin, the VeraKey URL is wrong, or VeraKey cannot be reached."],
          [<code key="3">closed</code>, "The player closed the popup. With error.hash, the payment was sent: verify it. With error.pending, it may have been sent: find it with findPayment first."],
          [<code key="4">busy</code>, "Another request from this page is still open."],
          [<code key="5">origin</code>, "The page is not on https, localhost or 127.0.0.1."],
          [<code key="6">request</code>, "A malformed request, such as a nonce that is not 32 bytes, or your own nonce callback threw. The popup then closes at once, and error.cause says why: what your callback threw, so your page can show your server's message."],
          [<code key="7">cancelled</code>, "The player cancelled before approving."],
          [<code key="8">funds, policy, device, proof, relay</code>, <>The same stages as the SDK: see <A href="/docs/reference/errors">Errors</A>. A relay error can carry error.pending too.</>],
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
