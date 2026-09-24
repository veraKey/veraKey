# @verakey/sdk

Passkey accounts proven in zero knowledge, on Arbitrum. VeraKey gives a person one passkey and a separate USDG
smart account for every app. Each approval is an UltraHonk proof made in the browser, so apps cannot link one
person's accounts to each other.

> **Developer preview on Arbitrum Sepolia (testnet).** The API may change before 1.0.

## Install

```sh
npm install @verakey/sdk
```

The package is ESM with TypeScript types. Every module is its own entry point (`@verakey/sdk/<module>`), so a
page loads the prover only when it imports it. The server helpers need Node 20 or later.

## Sign in with VeraKey

Any site can sign players in through VeraKey's popup today, on its own domain. Each player gets an ID for your
site alone, and your server verifies a zero-knowledge proof of every sign-in.

In the page, from a click, so the browser allows the popup:

```ts
import { VeraKeyConnect } from "@verakey/sdk/connect";

const verakey = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });
const newNonce = async () => (await (await fetch("/api/nonce", { method: "POST" })).json()).nonce;

button.onclick = async () => {
  const result = await verakey.signIn({ nonce: newNonce }); // the player approves in the popup
  await fetch("/api/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
};
```

On your server:

```ts
import { verifySignIn } from "@verakey/sdk/signin";

const verdict = await verifySignIn(result, {
  origin: "https://your.game", // your own origin
  nonce,                       // the nonce you issued for this sign-in; accept each one once
  publicClient,                // a viem client for Arbitrum
  deployment: {                // pinned in your configuration
    chainId, factory, rpIdHash, honkVerifier,
    origin: "https://verakey.mdloglabs.org",
  },
});
if (verdict.valid) startSession(verdict.playerId, verdict.account);
```

Take the deployment's values from [Deployments](https://verakey.mdloglabs.org/docs/reference/deployments) and keep
them in your configuration. `verakey.pay({ to, amount, account })` takes USDG payments in the same popup, and
`verifyPayment` checks them on your server. The
[Sign in with VeraKey guide](https://verakey.mdloglabs.org/docs/build/sign-in) covers payments, errors and a
security checklist.

## Passkey accounts in your own app

`VeraKeyClient` registers passkeys, derives each app's account, proves approvals in the browser and pays through
a relayer. Every account is bound to one origin and one WebAuthn rpId, so this path needs a VeraKey deployment
for your domain, which opens with developer access after the testnet preview. The
[Quickstart](https://verakey.mdloglabs.org/docs/build/quickstart) shows the integration.

## Modules

| Import | What it holds |
|---|---|
| `@verakey/sdk/connect` | `VeraKeyConnect`: the Sign in with VeraKey popup, for the browser |
| `@verakey/sdk/signin` | `verifySignIn`, `verifyPayment`, `findPayment`, `appIdFromOrigin`, for your server |
| `@verakey/sdk/client` | `VeraKeyClient`: passkeys, accounts, payments and the proof state machine |
| `@verakey/sdk/prover` | `VeraKeyProver`: UltraHonk proofs of WebAuthn assertions |
| `@verakey/sdk/disclosure` | Disclosures that prove two of a person's app accounts share one passkey |
| `@verakey/sdk/webauthn` | WebAuthn, PRF and payment-sheet helpers |
| `@verakey/sdk/validator` | The ERC-7579 validator module's helpers |
| `@verakey/sdk/nullifier`, `/action`, `/relayer`, `/abi`, … | Lower-level building blocks |

`@verakey/sdk` re-exports every module.

## Proving

- The prover runs in the browser. With cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`) it proves on every core; without it, on one thread.
- The first proof in a browser downloads the prover's common reference string, a few megabytes, from Aztec's
  CDN. The browser keeps it for later proofs.

## Links

- [Documentation](https://verakey.mdloglabs.org/docs)
- [SDK reference](https://verakey.mdloglabs.org/docs/reference/sdk)
- [Security model](https://verakey.mdloglabs.org/docs/security)

## License

MIT
