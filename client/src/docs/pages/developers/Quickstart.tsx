import { BookOpen, CreditCard, Server, ShieldCheck } from "lucide-react";
import { A, Callout, Card, Cards, Code, H2 } from "../../components";
import { SDK_NPM_URL } from "../../site";

export default function QuickstartPage() {
  return (
    <>
      <Callout kind="tip" title="No VeraKey deployment for your domain?">
        This Quickstart builds passkey accounts into your own app, which needs a VeraKey deployment for your domain. To
        sign players in and take USDG payments on any https site today, start with{" "}
        <A href="/docs/build/sign-in">Sign in with VeraKey</A>.
      </Callout>

      <H2>Before you begin</H2>
      <ul>
        <li>An app served over https, or from <code>http://localhost</code> while you develop: passkeys need a secure context.</li>
        <li>
          A VeraKey deployment for your app's domain. Every account is bound to one origin and one WebAuthn rpId, so each
          domain has its own deployment and relayer.
        </li>
        <li>
          For fast proving, serve your pages with cross-origin isolation, so the prover can use every CPU core:
          <code>Cross-Origin-Opener-Policy: same-origin</code> and <code>Cross-Origin-Embedder-Policy: require-corp</code>.
          This is for apps that prove in their own pages, as this Quickstart does. A page that opens the Sign in with
          VeraKey popup must not send <code>Cross-Origin-Opener-Policy: same-origin</code>: it cuts the popup off from
          the page.
        </li>
      </ul>

      <H2>1. Get the SDK</H2>
      <p>
        The SDK is the <A href={SDK_NPM_URL}><code>@verakey/sdk</code></A> package for the browser, with TypeScript
        types. Its modules load separately, so an app downloads the prover only when it proves.
      </p>
      <Code lang="bash">{`
npm install @verakey/sdk
`}</Code>
      <p>
        The prover needs a common reference string (CRS). The first proof in a browser downloads it from Aztec's CDN, a
        few megabytes, and the browser keeps it for later proofs.
      </p>

      <H2>2. Configure the client</H2>
      <p>
        The relayer's <code>GET /api/config</code> returns everything the client needs. Create one client for your app:
      </p>
      <Code lang="ts" title="vera.ts">{`
import { VeraKeyClient } from "@verakey/sdk/client";
import { appIdFromName } from "@verakey/sdk/nullifier";

const config = await (await fetch("/api/config")).json();

export const APP_ID = appIdFromName("my-app");

export const vera = new VeraKeyClient({
  rpId: config.rpId,
  chainId: config.chainId,
  rpcUrl: new URL(config.rpcUrl, location.origin).toString(), // "/api/rpc": reads go through the relayer
  factory: config.contracts.factory,
  usdg: config.contracts.usdg,
  rpIdHash: config.rpIdHash,
  relayerUrl: "/api",
  relayerFee: BigInt(config.relayer.fee), // USDG base units, signed into every action
  appIds: [APP_ID],
  loadProver: async () => {
    const { VeraKeyProver } = await import("@verakey/sdk/prover");
    return VeraKeyProver.create({
      threads: crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1,
      srsSize: 2 ** 17,
    });
  },
});
`}</Code>
      <p>
        <code>appIdFromName</code> turns your app's name into its id. Every app id gets its own accounts, so pick a
        name and keep it.
      </p>

      <H2>3. Register a passkey</H2>
      <Code lang="ts">{`
const { session } = await vera.register("Alice"); // creates a passkey with PRF
if (!session) await vera.unlock();                // some providers return PRF only on the next assertion
`}</Code>
      <p>
        Returning users call <code>vera.unlock()</code>: one passkey prompt that returns the PRF secret for the session. Then
        read the account for your app:
      </p>
      <Code lang="ts">{`
const account = await vera.account(APP_ID);
console.log(account.address, account.balance, account.deployed);
`}</Code>

      <H2>4. Fund the account</H2>
      <p>
        Every action pays the relayer's fee in USDG from the account, so a new account needs USDG before its first
        payment. Its address is fixed before it is deployed, so it can receive USDG from any wallet right away. On a
        testnet deployment, deploy it and ask the relayer's faucet instead; the faucet funds only deployed accounts, once
        each:
      </p>
      <Code lang="ts">{`
await vera.ensureAccount(APP_ID);             // deploys the account through the relayer, if needed
await vera.requestDemoFunds(account.address); // testnets only: demo USDG from the relayer's faucet
`}</Code>

      <H2>5. Make a payment</H2>
      <Code lang="ts">{`
const receipt = await vera.pay(APP_ID, merchant, 2_000_000n, state => {
  console.log(state.status); // authenticating → proving → relaying → confirming → verified
});
`}</Code>
      <p>
        Amounts are USDG base units (6 decimals): <code>2_000_000n</code> is 2 USDG. <code>pay</code> deploys the account
        first if needed. Without enough USDG, it rejects: with the <code>funds</code> stage before the passkey prompt when
        the fee alone is not covered, or later with <code>TokenTransferFailed</code> when the amount is not.
      </p>

      <H2>6. Handle the result</H2>
      <p>
        The listener receives every <A href="/docs/build/sdk#the-proof-state-machine">state</A>. If anything fails, it
        receives a <code>rejected</code> state, and the promise rejects with a <code>VeraKeyError</code> whose{" "}
        <code>stage</code> says where it failed:
      </p>
      <Code lang="ts">{`
import { VeraKeyError } from "@verakey/sdk/client";

try {
  await vera.pay(APP_ID, merchant, amount, render);
} catch (error) {
  if (!(error instanceof VeraKeyError)) throw error;
  switch (error.stage) {
    case "policy":         // the account said no: error.revert names the rule, e.g. "PerTxCapExceeded"
    case "funds":          // not enough USDG for the relayer fee (checked before the prompt)
    case "authentication": // the user cancelled or the prompt timed out
    case "device":         // the passkey lacks PRF, or the authenticator returned unexpected data
    case "proof":          // proving failed in the browser
    case "relay":          // the relayer or the network failed
      showError(error.message);
  }
}
`}</Code>

      <H2>Next steps</H2>
      <Cards>
        <Card href="/docs/build/sdk" title="SDK guide" icon={BookOpen}>Configuration, sessions, accounts and errors in depth.</Card>
        <Card href="/docs/build/policy" title="Payments and policy" icon={ShieldCheck}>Freeze, caps and scheduled changes.</Card>
        <Card href="/docs/build/payment-sheet" title="Payment sheet" icon={CreditCard}>Let the browser show the payee and total.</Card>
        <Card href="/docs/build/relayer-api" title="Relayer API" icon={Server}>The HTTP endpoints behind the SDK.</Card>
      </Cards>
    </>
  );
}
