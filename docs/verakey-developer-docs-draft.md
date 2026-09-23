# VeraKey Developer Docs

## One passkey, unlinkable accounts on Arbitrum

VeraKey is an authentication and account layer for consumer apps on Arbitrum. A user enrolls one passkey.
Each app gets its own smart account, owned by a per-app nullifier. Every action is authorized by a
zero-knowledge proof, generated in the user's browser, that the passkey signed exactly that action. The
chain receives the proof, the nullifier and `clientDataJSON`; it never receives the passkey's public key
or signature, so no key material links a user's accounts across apps.

The pitch in one line: **Hide-My-Email for wallets.**

> This page describes the system as built (see also `/docs` in the app and the repository README). The
> contracts and the circuit are unaudited; it is a testnet preview on Arbitrum Sepolia.

## What is hidden, and from whom

| Data | Chain & other apps | Relayer | VeraKey page code |
|---|---|---|---|
| Passkey public key, signature, authenticator data | hidden | hidden | seen, in-browser only |
| PRF secret (never stored) | hidden | hidden | seen, in-browser only |
| Which accounts belong to one person | hidden | visible if one relayer serves them all (IP, timing) | visible |
| Account address and history | public | public | public |
| USDG amounts, recipients, fees, timing | public | public | public |
| appId, rpIdHash, origin (`clientDataJSON` is public) | public | public | public |

Every app uses VeraKey's rpId. That is what lets one enrollment serve many apps, and it makes the page
code served from the VeraKey origin a trusted party. Mitigations: proving only in the browser (no
server-side proving, no assertion logging), no third-party scripts (strict CSP), an open-source client,
and on-chain caps and timelocks that bound what any valid proof can spend.

Not claimed: payment privacy, Sybil resistance, or anything about biometrics. The biometric match never
leaves the secure enclave in any passkey wallet.

## Architecture

1. **Passkey (browser).** `navigator.credentials.create` with the PRF extension; `get` with PRF once per
   session to unlock; `get` without extensions for every action, so authenticator data is 37 bytes.
2. **Prover (browser).** A Noir circuit, proven with UltraHonk by bb.js (about 2–3 s on a laptop). It
   proves a valid P-256 signature over `sha256(authenticatorData || sha256(clientDataJSON))`, the rpId
   hash, the UP and UV flags, and `nullifier = Poseidon2(domain, pk, prfSecret, appId)`. The public key,
   signature and PRF secret are private inputs.
3. **Relayer.** Receives only the finished proof and the public call data, simulates the call, submits
   it and is paid a USDG fee that the user signed. It cannot alter the action; anyone may submit instead.
4. **Stylus account (Arbitrum).** A Rust smart account parses `clientDataJSON` (type `webauthn.get`,
   base64url challenge equal to the action hash, exact origin), hashes it, calls the bb-generated Solidity
   `HonkVerifier` with six public inputs, consumes its nonce, applies its USDG policy and pays.

## Authorization lifecycle

```text
1. Challenge   actionHash = keccak256(typehash, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline)
2. Sign        passkey signs actionHash after Face ID / Touch ID / PIN
3. Prove       browser proves the signature under a hidden key; outputs proof + nullifier
4. Verify      Stylus account: clientDataJSON checks → verifier → nonce++ → policy → USDG transfer
```

State machine exposed by the SDK:

```typescript
type ProofState =
  | { status: "idle" }
  | { status: "authenticating" }
  | { status: "proving"; startedAt: number }
  | { status: "relaying"; provingMs: number }
  | { status: "confirming"; provingMs: number; hash: `0x${string}` }
  | { status: "verified"; provingMs: number; hash: `0x${string}`; receipt: TransactionReceipt; publicKeyOccurrences: number }
  | { status: "rejected"; stage: "authentication" | "device" | "proof" | "policy" | "relay"; message: string; revert?: string };
```

Policy rejections (`stage: "policy"`, e.g. `PerTxCapExceeded`) are reported separately from proof and
relay errors: the user authenticated correctly, but the account's rules said no.

## SDK

```typescript
import { VeraKeyClient } from "@verakey/sdk/client";
import { appIdFromName } from "@verakey/sdk/nullifier";

const APP_ID = appIdFromName("my-app");
const vera = new VeraKeyClient({
  rpId, chainId, rpcUrl, factory, usdg, rpIdHash,   // GET /api/config from the relayer
  relayerUrl: "/api",
  relayerFee: 20_000n,                              // USDG base units (6 decimals)
  appIds: [APP_ID],
  loadProver: async () => (await import("@verakey/sdk/prover")).VeraKeyProver.create({ srsSize: 2 ** 17 }),
});

await vera.register("Alice");
const account = await vera.account(APP_ID);          // address, balance, policy, owners, guardian
await vera.pay(APP_ID, recipient, 2_000_000n, state => render(state)); // 2 USDG
```

Policy changes are timelocked:

```typescript
import { changePayload } from "@verakey/sdk/action";

const change = await vera.scheduleChange(APP_ID, changePayload.setLimits(10_000_000n, 25_000_000n));
// after the account's change delay, anyone can apply it:
await vera.applyChange(account.address, change);
```

## Application-scoped nullifiers

```text
One passkey
   ├── Pay    → nullifier A → account 0x…A
   ├── Vault  → nullifier B → account 0x…B
   └── Tip    → nullifier C → account 0x…C
```

A nullifier is an owner identifier, not a proof of personhood: it mixes the public key with the
passkey's PRF secret and the app id. The same passkey always yields the same nullifier in the same app,
on any device where the passkey syncs.

## Integration checklist

- Choose the rpId (your VeraKey origin's domain) before deploying: the factory binds accounts to it.
- Every action carries a deadline of at most 10 minutes and the account's current nonce.
- Treat a proof as authorization for one action on one account on one chain.
- Offer a recovery path: a backup passkey (second owner) and/or a guardian with a recovery delay.
- Tell users which passkey providers support PRF (iCloud Keychain on iOS/macOS 18.4+ / 15.4+, Google
  Password Manager in Chrome); VeraKey refuses to create accounts without PRF.

## Costs (measured on a nitro devnode, ArbOS 61)

| Operation | Gas |
|---|---|
| `HonkVerifier.verify` (inside `pay`) | 3,781,398 |
| `pay` (proof + policy + two USDG transfers) | 4,171,302 |
| `createAccount` | 80,812 |
| `P256VERIFY` precompile, for comparison (no privacy) | 3,450 |

## Threat model and implementation limits

VeraKey limits cross-app correlation through key material. It does not make a compromised device safe,
hide payments, or protect against a malicious VeraKey origin. Open items before production: an
independent audit of the circuit and contracts, a published real-authenticator test-vector suite, and
relayer redundancy.

## References

- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [Arbitrum Stylus](https://docs.arbitrum.io/stylus/gentle-introduction)
- [Noir](https://noir-lang.org/) and [Barretenberg](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg)
- [Paxos USDG test networks](https://docs.paxos.com/guides/stablecoin/usdg/testnet)
