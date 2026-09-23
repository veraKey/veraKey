# VeraKey

**Hide-My-Email for wallets: one passkey, unlinkable USDG accounts on Arbitrum.**

VeraKey gives every app its own smart account behind a single passkey. Each payment is authorized by a
zero-knowledge proof, generated in the user's browser, that the passkey signed exactly that action. The
chain receives the proof, a per-app nullifier and the browser's `clientDataJSON`. It never receives the
passkey's public key or signature, so no key material links a user's accounts across apps.

Built for the Arbitrum Open House Singapore Buildathon (HackQuest), September–October 2026.

> Testnet preview. The contracts and the circuit are unaudited. Do not use with real funds.

## How it works

```text
 Face ID / Touch ID            browser (never leaves the device)             Arbitrum
┌──────────────────┐   ┌──────────────────────────────────────────┐   ┌──────────────────────────┐
│ passkey signs the│──▶│ Noir circuit, UltraHonk (bb.js, ~3 s):    │──▶│ Stylus account (Rust)     │
│ action hash      │   │  • P-256 signature over the WebAuthn msg │   │  • parse clientDataJSON   │
│ (WebAuthn get)   │   │  • rpIdHash, UP + UV flags               │   │  • sha256 → public input  │
└──────────────────┘   │  • nullifier = Poseidon2(pk, PRF, appId) │   │  • HonkVerifier.verify    │
        ▲              └──────────────────────────────────────────┘   │  • nonce, caps, allowlist │
        │ PRF secret (unlock, once per session)                        │  • pay USDG (+ USDG fee)  │
                                                                       └──────────────────────────┘
```

1. **Action hash.** `keccak256(abi.encode(typehash, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline))` becomes the WebAuthn challenge. It binds the chain, the account, the nonce, the fee and a deadline of at most 10 minutes.
2. **Passkey.** The authenticator signs after user verification. Signing assertions request no extensions, so the authenticator data is always 37 bytes.
3. **Proof.** The circuit (`circuits/webauthn`, 81,605 gates) proves the signature, the rpId hash and the UP/UV flags under a hidden key, and derives the owner nullifier from the key, the passkey's **PRF secret** and the app id. Without the PRF secret, which never leaves the authenticator, even a leaked public key cannot link a user's accounts.
4. **Account.** A Stylus smart account (`contracts/stylus/account`) checks `clientDataJSON` (type, base64url challenge, exact origin), calls the Solidity `HonkVerifier` with six public inputs, consumes its nonce, applies its USDG policy and pays. Accounts are EIP-1167 clones of one implementation, created by a Stylus factory with `CREATE2(salt = keccak(appId, nullifier, configHash))`.
5. **Gasless.** A relayer simulates and submits the transaction; its fee is paid in USDG and is part of what the passkey signed. Anyone else may submit the same calldata.

## What is real

| Piece | Status |
|---|---|
| WebAuthn registration and PRF unlock in the browser | real (`packages/sdk/src/webauthn.ts`) |
| UltraHonk proof of a P-256 passkey signature, generated in the browser | real, ~2.3 s with 8 threads (Chrome, measured) |
| Stylus account + factory, Solidity verifier | real, deployed with `scripts/deploy.sh` |
| USDG | Paxos Global Dollar on Arbitrum Sepolia `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` (a mintable stand-in is used only on a local devnode) |
| Relayer (gasless, USDG fee) | real (`server/`) |
| Landing-page receipt and phone prompt | illustrations; the real flow is `/app` |

## Measured

| | |
|---|---|
| Circuit size | 81,605 UltraHonk gates (2^17) |
| Proof | 9,152 bytes, 6 public inputs |
| Proving, browser (Chrome, 8 threads) | 2.3 s |
| `HonkVerifier.verify` (inside `pay`) | 3,781,398 gas — 466 `modexp` inversions are 1.88M of it ([docs/GAS.md](docs/GAS.md)) |
| `pay` (proof + policy + two USDG transfers) | 4,171,302 gas, of which the Stylus account logic is ~217k |
| `createAccount` (EIP-1167 clone + init) | 80,812 gas |
| Baseline: `P256VERIFY` precompile (no privacy) | 3,450 gas |

Gas measured on a local nitro devnode at ArbOS 61. The account implementation (39.9 KB) and factory
(28.5 KB) are deployed as multi-fragment Stylus programs, which Arbitrum Sepolia and One support since
ArbOS 60.

## Security model

| Data | Chain & other apps | Relayer | VeraKey page code |
|---|---|---|---|
| Passkey public key, signature, authenticator data | hidden | hidden | seen, in-browser only |
| PRF secret | hidden | hidden | seen, in-browser only |
| Which accounts belong to one person | hidden | visible if one relayer serves them all (IP, timing) | visible |
| Account address, amounts, recipients, timing | public | public | public |

- **Authentication is not authorization.** A valid proof only shows that an owner approved. Every account enforces per-payment and daily USDG caps and an optional recipient allowlist.
- **Timelocks.** Raising caps, changing the allowlist, adding or removing an owner and setting a guardian are scheduled with a proof and applied after a delay; any owner (or the guardian) can cancel.
- **Recovery.** A guardian can replace all owners after a recovery delay; any owner can veto it with a proof. Recovery bumps an owner epoch, which also voids changes scheduled by the old owners.
- **Replay.** The nonce is consumed before any token transfer; proofs are bound to one account, one chain and one nonce.
- **Trust assumption.** All apps share VeraKey's rpId, so the page code served from the VeraKey origin is trusted. It is open source, loads no third-party scripts (strict CSP) and cannot spend beyond the on-chain policy.
- **Not claimed:** payment privacy, Sybil resistance, and anything about biometrics (the biometric match never leaves the secure enclave for any passkey wallet).

Tests: 11 circuit tests (`nargo test`), 32 Rust unit tests (`contracts/stylus/core`), and 34 end-to-end
tests that deploy the real contracts to a nitro devnode and exercise them with real proofs
(`packages/sdk/test/e2e`). 29 cover the contracts: front-running, replay, cross-account and cross-chain
proofs, tampered proofs, caps, timelocks, backup owners and guardian recovery. 5 drive the relayer over
HTTP: a relayed payment that pays its fee, an invalid proof that is never broadcast, an underpaid fee,
the one-time faucet and the rate limits.
CI (`.github/workflows/ci.yml`) rebuilds the circuit, verifier and contracts from source and runs all
of them on every push.

## Repository layout

```text
circuits/webauthn        Noir circuit + tests (test vectors generated by packages/sdk/scripts)
contracts/stylus         Rust: core (pure logic), account, factory
contracts/evm            Foundry: bb-generated HonkVerifier, deploy scripts, local test token
packages/sdk             @verakey/sdk: WebAuthn/PRF, action hashing, prover, VeraKeyClient
server                   Express relayer: /api/config, /api/accounts, /api/relay, /api/faucet, /api/rpc
client                   Vite + React app: landing page, /app (accounts, pay, policy, recovery), /docs
scripts                  build-circuit.sh, gen-abi.sh, devnode.sh (local chain), deploy.sh, build-server.mjs
deployments              addresses per network
```

## Running it

Toolchain (pinned): Node 22 + pnpm 10, Rust 1.91 + `wasm32-unknown-unknown`, cargo-stylus 0.10.9,
Foundry, Docker, nargo `1.0.0-beta.22`, bb `5.0.0-nightly.20260522`.

```bash
pnpm install
scripts/build-circuit.sh            # nargo test + compile, verification key, Solidity verifier
pnpm contracts:test                 # Rust unit tests

scripts/devnode.sh up               # nitro devnode on :8649, upgraded to ArbOS 61 (multi-fragment Stylus)
scripts/deploy.sh local             # verifier, test USDG, account implementation, factory
pnpm test:e2e                       # 34 end-to-end tests with real proofs
pnpm dev                            # relayer on :3090, app on http://localhost:5190
```

The devnode keeps no state: after `scripts/devnode.sh down` or a reboot, run `up` and `deploy.sh local`
again.

## Deploying to Arbitrum Sepolia

1. Choose the app's https domain first. The factory binds every account to that origin and rpId, so a
   new domain needs a new deployment.
2. `cp .env.example .env`, then set the keys, `VERAKEY_ORIGIN` and `VERAKEY_RP_ID`. Fund the deployer
   with at least 0.01 Arbitrum Sepolia ETH. Fund the relayer with ETH for gas and with USDG from
   https://faucet.paxos.com for the demo faucet. One key may play both roles.
3. `scripts/deploy.sh sepolia --check` lists whatever is missing without sending a transaction.
   `scripts/deploy.sh sepolia` then deploys and writes `deployments/sepolia.json`; commit that file.
4. Serve the app on the domain: `docker build -t verakey .`, then run the image behind the host's TLS
   proxy with `RELAYER_PRIVATE_KEY` set (see `Dockerfile`). Without Docker: `pnpm build && pnpm start`,
   which reads `.env`.

On Railway, `railway.json` builds the Dockerfile. Generate the service's `*.up.railway.app` domain
before step 1 and use it as the origin, then set `RELAYER_PRIVATE_KEY` in the service variables
(`VERAKEY_NETWORK` defaults to `sepolia` in the image). Without a volume, the faucet forgets which
accounts it funded on every redeploy. To keep that record, mount a volume at `/data` and set
`RAILWAY_RUN_UID=0`, because the image runs as a non-root user and Railway volumes are owned by root.

## Using the SDK

```ts
import { VeraKeyClient } from "@verakey/sdk/client";
import { appIdFromName } from "@verakey/sdk/nullifier";

const APP_ID = appIdFromName("my-app");
const vera = new VeraKeyClient({
  rpId, chainId, rpcUrl, factory, usdg, rpIdHash, // GET /api/config
  relayerUrl: "/api",
  relayerFee: 20_000n,                            // 0.02 USDG
  appIds: [APP_ID],
  loadProver: async () => (await import("@verakey/sdk/prover")).VeraKeyProver.create({ srsSize: 2 ** 17 }),
});

await vera.register("Alice");                                  // passkey + PRF
await vera.pay(APP_ID, merchant, 2_000_000n, s => console.log(s.status));
// idle → authenticating → proving → relaying → confirming → verified | rejected
```

## Limitations and next steps

- Unaudited contracts and circuit; the verifier is the bb-generated Solidity contract.
- Requires the WebAuthn PRF extension (iCloud Keychain on iOS/macOS 18.4+ / 15.4+, Google Password Manager).
- ~4.1M gas per payment is cents on Arbitrum, but far above a non-private passkey wallet.
- Next: publish the real-authenticator test-vector suite and benchmarks; an ERC-7579 validator module so ZeroDev Kernel accounts can accept VeraKey proofs.

## Disclosure

Written before the Buildathon: the landing page (`client/src/pages/Home.tsx`, its styling) and the
Vite/Express scaffold; during the Buildathon it was edited to correct its claims and link the real app.
The author's earlier public repository `adiitsuu-ui/arbitrum-nexus` (Stylus + WebAuthn P-256 + Orbit L3
+ AI verification, no ZK) is a separate prior project. Everything else — circuit, contracts, relayer,
SDK, `/app`, `/docs`, tests and deployment tooling — was produced during the Buildathon.

License: MIT.
