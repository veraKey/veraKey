<img src="https://raw.githubusercontent.com/veraKey/veraKey/main/client/public/brand/verakey-icon-192.png" alt="" width="72" height="72">

# @verakey/sdk

One passkey, unlinkable on-chain identities, on Arbitrum. VeraKey gives a person their own account and ID in every
app, behind one passkey. Each approval is an UltraHonk proof made in the browser, so nothing on-chain links one
person's identities.

> **Developer preview on Arbitrum Sepolia (testnet).** The API may change before 1.0.

## Install

```sh
npm install @verakey/sdk
```

The package is ESM with TypeScript types. Every module is its own entry point (`@verakey/sdk/<module>`), so a
page loads the prover only when it imports it. The server helpers need Node 20 or later.

## The integration kit: React and your server

The quickest way to add Sign in with VeraKey and USDG payments to a React site with a Node server:

```ts
// lib/verakey.ts, on your server
import { createVeraKeyServer } from "@verakey/sdk/server";
import { ARBITRUM_SEPOLIA } from "@verakey/sdk/deployments";

export const verakey = createVeraKeyServer({
  origin: "https://your.game",
  deployment: ARBITRUM_SEPOLIA,
  secret: process.env.VERAKEY_SECRET!, // at least 32 random bytes
  merchant: "0xYourShopAddress",
  onPayment: ({ player, amount, hash }) => grantItem(player.id, amount, hash), // throw to refuse
});

// Next.js, in app/api/verakey/[route]/route.ts:
//   export const GET = verakey.handle;
//   export const POST = verakey.handle;
// Express: app.use("/api/verakey", toExpress(verakey))
```

```tsx
// your pages
import { SignInWithVeraKey, VeraKeyProvider, useVeraKey } from "@verakey/sdk/react";

<VeraKeyProvider>
  <SignInWithVeraKey />
</VeraKeyProvider>

const { player, pay } = useVeraKey();
await pay({ amount: 1_000_000n }); // 1 USDG to your merchant
```

The kit binds each nonce to the browser that asked for it, verifies every sign-in and payment on your server,
keeps the session in a signed cookie, and accepts each payment once (in memory by default: pass a durable
`store` in production). React is an optional peer dependency; without React, `VeraKeySession` from
`@verakey/sdk/session` does the same in any page.

## Sign in with VeraKey

Any site can sign players in through VeraKey's popup today, on its own domain. Each player gets an ID for your
site alone, and your server verifies a zero-knowledge proof of every sign-in.

In the page, from a click, so the browser allows the popup:

```ts
import { VeraKeyConnect } from "@verakey/sdk/connect";

const verakey = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });

// A fresh nonce from your server. Throw its refusal: the popup closes, and your page gets it as error.cause.
async function newNonce() {
  const response = await fetch("/api/nonce", { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body.nonce;
}

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
`verifyPayment` checks them on your server.

While you develop, the popup also answers `http://localhost` and `http://127.0.0.1`. These are different sites, with
different player IDs: verify as the exact origin in the browser's address bar. The
[Sign in with VeraKey guide](https://verakey.mdloglabs.org/docs/build/sign-in) covers payments, errors, local
development, end-to-end tests with a virtual passkey, and a security checklist.

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
| `@verakey/sdk/server` | `createVeraKeyServer`, `toExpress`: the integration kit's routes, for your server |
| `@verakey/sdk/react` | `VeraKeyProvider`, `useVeraKey`, `SignInWithVeraKey`: the integration kit for React |
| `@verakey/sdk/session` | `VeraKeySession`: the integration kit in any page, without React |
| `@verakey/sdk/deployments` | `ARBITRUM_SEPOLIA`: the deployment the kit verifies against |
| `@verakey/sdk/client` | `VeraKeyClient`: passkeys, accounts, payments and the proof state machine |
| `@verakey/sdk/prover` | `VeraKeyProver`: UltraHonk proofs of WebAuthn assertions |
| `@verakey/sdk/disclosure` | Disclosures that prove two of a person's app accounts share one passkey |
| `@verakey/sdk/webauthn` | WebAuthn, PRF and payment-sheet helpers |
| `@verakey/sdk/validator` | The ERC-7579 validator module's helpers |
| `@verakey/sdk/kernel` | `toVeraKeyKernelValidator`: a VeraKey passkey as a ZeroDev Kernel account's validator |
| `@verakey/sdk/nullifier`, `/action`, `/relayer`, `/abi`, … | Lower-level building blocks |

`@verakey/sdk` re-exports every module except `react`, so importing it never needs React.

## ZeroDev Kernel accounts

`toVeraKeyKernelValidator` makes VeraKey's ERC-7579 validator a plugin for ZeroDev's SDK: the Kernel account installs
it with the owner's per-app nullifier, and each user operation carries a proof that the passkey signed its userOpHash.

```ts
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toVeraKeyKernelValidator } from "@verakey/sdk/kernel";

const sudo = toVeraKeyKernelValidator({
  validator, // VeraKeyValidator for your relying party
  chainId,
  appId,
  nullifier,
  prove: async (userOpHash) => ({ proof, clientDataJSON }), // the passkey signs, the browser proves
});
const account = await createKernelAccount(publicClient, { entryPoint: getEntryPoint("0.7"), kernelVersion: KERNEL_V3_3, plugins: { sudo } });
```

On Arbitrum Sepolia, a Kernel v3.3 account built this way deployed and paid 1 USDG in its first user operation
([transaction](https://arbitrum-sepolia.blockscout.com/tx/0x66dbf2ed7552d9e0d563bdf9a8aee30656d1e99cfab4c9e8bade961c0d0cfc2f)). Set `verificationGasLimit` yourself (1,700,000 covered that first operation): the proof
costs about 732,000 gas in the validator. The plugin signs user operations; it does not sign ERC-1271 messages yet.

## Proving

- `VeraKeyClient` proves in your page. With cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`) it proves on every core; without it, on one thread.
- With Sign in with VeraKey, the popup proves on VeraKey's side. A page that opens it must not send
  `Cross-Origin-Opener-Policy: same-origin`, which cuts the popup off from the page.
- The first proof in a browser downloads the prover's common reference string, a few megabytes, from Aztec's
  CDN. The browser keeps it for later proofs.

## Links

- [Documentation](https://verakey.mdloglabs.org/docs)
- [SDK reference](https://verakey.mdloglabs.org/docs/reference/sdk)
- [Security model](https://verakey.mdloglabs.org/docs/security)

## License

MIT
