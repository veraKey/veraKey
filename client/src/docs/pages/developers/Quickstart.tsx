import { BookOpen, CreditCard, Server, ShieldCheck } from "lucide-react";
import { A, Callout, Card, Cards, Code, H2 } from "../../components";

export default function QuickstartPage() {
  return (
    <>
      <H2>Before you begin</H2>
      <ul>
        <li>Node 22 and pnpm 10.</li>
        <li>An app served over https, or from <code>http://localhost</code> while you develop: passkeys need a secure context.</li>
        <li>
          A VeraKey deployment bound to your app's origin. The factory binds every account to one origin and one WebAuthn
          rpId, so each domain needs its own deployment and relayer. See <A href="/docs/build/deploy">Run locally and deploy</A>.
        </li>
        <li>
          For fast proving, serve your pages with cross-origin isolation, so the prover can use every CPU core:
          <code>Cross-Origin-Opener-Policy: same-origin</code> and <code>Cross-Origin-Embedder-Policy: require-corp</code>.
        </li>
      </ul>

      <H2>1. Get the SDK</H2>
      <Callout kind="note" title="Not on npm yet">
        <code>@verakey/sdk</code> is not published to npm. It lives in <code>packages/sdk</code> of the VeraKey repository and
        is used as a workspace package.
      </Callout>
      <p>Inside the VeraKey workspace, depend on the SDK and install:</p>
      <Code lang="json" title="package.json">{`
{
  "dependencies": {
    "@verakey/sdk": "workspace:*"
  }
}
`}</Code>
      <Code lang="bash">{`
pnpm install
`}</Code>
      <p>
        The prover downloads a common reference string (CRS). VeraKey serves it from its own origin: copy{" "}
        <code>client/public/crs/</code> into your public folder. The workspace applies a small patch to bb.js
        (<code>patches/@aztec__bb.js@5.2.0.patch</code>) that lets you point it at that folder.
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
    (globalThis as { __BB_CRS_HOST__?: string }).__BB_CRS_HOST__ = \`\${location.origin}/crs\`;
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

      <H2>4. Make a payment</H2>
      <Code lang="ts">{`
const receipt = await vera.pay(APP_ID, merchant, 2_000_000n, state => {
  console.log(state.status); // authenticating → proving → relaying → confirming → verified
});
`}</Code>
      <p>
        Amounts are USDG base units (6 decimals): <code>2_000_000n</code> is 2 USDG. <code>pay</code> deploys the account
        first if needed. On a testnet deployment, <code>vera.requestDemoFunds(account.address)</code> asks the relayer's
        faucet for demo USDG.
      </p>

      <H2>5. Handle the result</H2>
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
