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
| Guardian address | hidden until it acts (salted commitment) | hidden until it acts | seen when set |
| Shared funding source | public: links accounts | public | public |
| A disclosure the owner makes | only to whoever gets it | not involved | seen when made |

Every app uses VeraKey's rpId. That is what lets one enrollment serve many apps, and it makes the page
code served from the VeraKey origin a trusted party. Mitigations: proving only in the browser (no
server-side proving, no assertion logging), no third-party scripts (strict CSP), an open-source client,
and on-chain caps, a new-recipient cap and timelocks that bound what any valid proof can spend. The
invariants, trust assumptions and accepted risks are listed in `SECURITY.md`.

Not claimed: payment privacy, Sybil resistance, or anything about biometrics. The biometric match never
leaves the secure enclave in any passkey wallet.

## Architecture

1. **Passkey (browser).** `navigator.credentials.create` with the PRF extension; `get` with PRF once per
   session to unlock; `get` without extensions for every action, so authenticator data is 37 bytes.
2. **Prover (browser).** A Noir circuit, proven with UltraHonk by bb.js (1.85 s in desktop Chrome). It
   proves a valid P-256 signature over `sha256(authenticatorData || sha256(clientDataJSON))`, the rpId
   hash, the UP and UV flags, and `nullifier = Poseidon2(domain, pk, prfSecret, appId)`. The public key,
   signature and PRF secret are private inputs.
3. **Relayer.** Receives only the finished proof and the public call data, simulates the call, submits
   it and is paid a USDG fee that the user signed. It cannot alter the action; anyone may submit instead.
4. **Stylus account (Arbitrum).** A Rust smart account parses `clientDataJSON` (type `webauthn.get`,
   base64url challenge equal to the action hash, exact origin), hashes it, calls the bb-generated Solidity
   `HonkVerifier` with six public inputs, consumes its nonce, applies its USDG policy and pays. For
   payments it also accepts Secure Payment Confirmation client data (type `payment.get`), whose payee
   and total it checks byte for byte against the payment.

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

Changes that loosen the policy are timelocked; changes that tighten it apply at once:

```typescript
import { changePayload } from "@verakey/sdk/action";

const change = await vera.scheduleChange(APP_ID, changePayload.setLimits(10_000_000n, 25_000_000n));
// after the account's change delay, anyone can apply it:
await vera.applyChange(account.address, change);

await vera.freeze(APP_ID);                                            // instant: no payments
await vera.restrict(APP_ID, changePayload.setNewPayeeCap(1_000_000n)); // instant: lower is tighter
await vera.scheduleChange(APP_ID, changePayload.unfreeze());          // timelocked, cancellable
```

`restrict` refuses (`NotRestrictive`) any change that could raise what the account can spend or change
who controls it.

## Account protections

- **Caps.** A per-payment and a daily USDG cap; relayer fees count against both.
- **Fees.** Every fee goes to the factory's fee recipient (the relayer) and is at most `maxFee` (0.25 USDG
  on Sepolia), both bound into the account address: whoever submits a transaction cannot pocket the fee.
- **New-recipient cap.** The first payment to a recipient the account has never paid, and that is not
  allowlisted, may be at most `newPayeeCap` (2 USDG on Sepolia). It bounds what an address-poisoning
  look-alike or a tampered page can take in one approval.
- **Freeze.** An owner freezes with one proof (`restrict`); the guardian freezes with its salt. A frozen
  account makes no payments until a timelocked unfreeze is applied. Freezing also cancels every scheduled
  change (a guardian's freeze keeps changes to the guardian).
- **Scheduled changes.** At most 8 wait at once, listed on-chain (`pendingChangeIds`, `pendingChange`);
  `vera.account(appId).pendingChanges` reads them, so a change made on another device shows everywhere.
- **Private guardian.** The account stores `keccak256(abi.encode(GUARDIAN_TYPEHASH, account, guardian,
  salt))`. The salt is derived from the passkey's PRF secret per app (`vera.guardianCard`), so the owner
  can rebuild it and one guardian used by several apps leaves nothing that links them. The guardian
  reveals itself for one account when it acts.
- **Recovery.** The guardian can replace all owners after the recovery delay; any owner can cancel.
  Executing it bumps the owner epoch, which voids old owners and their pending changes. The guardian
  cannot veto a change to the guardian, which waits the change delay plus the recovery delay: a guardian
  can delay the owners but never hold the account.
- **Payment sheet.** `vera.pay(appId, to, amount, emit, { secureConfirmation: true })` uses the browser's
  Secure Payment Confirmation sheet where available (Chrome on macOS, Windows, Android; the passkey must
  be registered with `register(label, { payment: true })`). The sheet shows the payee and the total; the
  account checks that the signed client data names exactly this recipient and amount plus fee. With
  `restrict(appId, changePayload.setPaymentSheet(true))` the account refuses payments approved any other
  way; the SDK never falls back to the plain prompt once the sheet was shown.

## Linkable by consent

Nothing on-chain links a user's accounts. When the user wants to prove to someone that two accounts are
theirs, `createDisclosure` asks the passkey to approve a statement (chain, factory, both app ids and
nullifiers, audience, nonce, expiry) and proves with a second circuit (`circuits/link`) that one hidden
passkey owns both nullifiers and signed it:

```typescript
import { verifyDisclosure } from "@verakey/sdk/disclosure";

const pkg = await vera.createDisclosure({ appIdA, appIdB, audience: "auditor@example.com", ttlSeconds: 86_400 });

const verdict = await verifyDisclosure(pkg, {
  publicClient, chainId, factory, rpIdHash, origin,
  audience: "auditor@example.com", // who is verifying: a disclosure made for someone else fails
  linkVerifier, // the on-chain LinkHonkVerifier, called with eth_call; or pass linkProver to verify locally
});
```

The audience checks every field, the client data, the proof, and the two account addresses from the
factory. A disclosure cannot move funds. The verifier passes its own audience name (and, if it asked for
one, its nonce), so a forwarded disclosure fails; disclosures valid for more than 7 days are refused.

## ERC-7579 validator

`contracts/evm/src/modules/VeraKeyValidator.sol` lets ERC-7579 accounts (ZeroDev Kernel, Biconomy Nexus)
use VeraKey proofs:

- install with `validatorInstallData(appId, nullifier)`;
- sign a user operation by proving an assertion whose challenge is the `userOpHash`, and pass
  `validatorSignature(proof, clientDataJSON)`;
- ERC-1271 signatures prove an assertion over `validatorErc1271Challenge(account, hash, chainId)`, so a
  signature cannot be replayed to another account with the same nullifier;
- set `verificationGasLimit` to at least `VALIDATOR_VERIFICATION_GAS` (850k) plus the account's own
  overhead: bundler estimates made with a dummy signature come out far too low.

The module enforces no spending policy; pair it with a policy or hook module.

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
- Keep the relayer's key separate from the deployer's; the relayer's key lives on an internet-facing
  server.
- Tell users which passkey providers support PRF (iCloud Keychain on iOS/macOS 18.4+ / 15.4+, Google
  Password Manager in Chrome); VeraKey refuses to create accounts without PRF.

## Costs (measured on a nitro devnode, ArbOS 61)

| Operation | Gas |
|---|---|
| `HonkVerifier.verify` (inside `pay`), bb 5.2.0 optimized ZK verifier | 712,554 |
| `pay`, first payment to a new recipient (proof + policy + two USDG transfers) | 1,043,768 |
| `pay`, a recipient paid before | 988,934 |
| `restrict` (lower the caps) | 979,007 |
| `createAccount` (clone + storage init, programs cached) | 383,296 |
| `P256VERIFY` precompile, for comparison (no privacy) | 3,450 |

## Threat model and implementation limits

VeraKey limits cross-app correlation through key material. It does not make a compromised device safe,
hide payments, or protect against a malicious VeraKey origin (it bounds one, with caps, the
new-recipient cap, timelocks and the browser's payment sheet). Open items before production: an
independent audit of the circuits and contracts, a published real-authenticator test-vector suite,
relayer redundancy, and funding paths that do not link accounts (on Arbitrum One: 0xbow Privacy Pools or
Railgun; neither runs on Arbitrum Sepolia).

## References

- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [W3C Secure Payment Confirmation](https://www.w3.org/TR/secure-payment-confirmation/)
- [ERC-7579: Minimal Modular Smart Accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [Arbitrum Stylus](https://docs.arbitrum.io/stylus/gentle-introduction)
- [Noir](https://noir-lang.org/) and [Barretenberg](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg)
- [Paxos USDG test networks](https://docs.paxos.com/guides/stablecoin/usdg/testnet)
