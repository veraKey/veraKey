# Security

**Status.**
- VeraKey is a testnet preview on Arbitrum Sepolia.
- The circuits and contracts have **not had an independent audit**.
- Two internal reviews have been done, the second a Nemesis audit of the contracts and circuits, and their findings are fixed (see "Internal review" below). They do not replace an audit.

## What must always hold

Each invariant below names where it is enforced and which tests exercise it:
- `e2e`: `packages/sdk/test/e2e`
- `prop`: `contracts/stylus/core/tests/properties.rs`
- `nargo`: the tests in `circuits/*`
- `forge`: `contracts/evm/test`

1. **No USDG leaves an account without a fresh, user-verified passkey approval of that exact action.**
   - The circuit proves a valid ES256 signature, UP+UV flags and the rpIdHash, under a hidden key.
   - The challenge is `keccak256(abi.encode(typehash, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline))`.
   - The account checks the challenge in `clientDataJSON` (`type` `webauthn.get`, exact origin, no `crossOrigin:true`) and consumes the nonce before it transfers anything.
   - Tests: `e2e` authorization binding (origin, type, other account, other chain, tampered proof, replay, deadlines).
2. **Every payment is capped, and the caps never stop the owners from defending the account.**
   - A payment plus its fee, and the fee of a scheduled change, count against the per-payment and daily caps.
   - Freezing, restricting and cancelling a change or a recovery are never refused because of the caps, so a thief who spends the day's cap cannot stop the owners. Their fee, at most `maxFee`, still counts toward the day's spending.
   - The per-payment cap never drops below `maxFee`, so every fee stays payable.
   - Tests: `e2e` policy, audit (with the day's cap spent, the owner still vetoes a waiting change and freezes; the per-payment cap can't drop below the largest fee); `prop` a_day_never_spends_more_than_its_caps.
3. **Fees cannot be redirected.**
   - Every fee goes to the factory's `feeRecipient` (the relayer) and is at most `maxFee` (0.25 USDG on Sepolia). Both are bound into the account address.
   - So whoever submits a transaction, or whoever tricks a user into approving one, cannot turn the signed fee into a payment to themselves, not even from a frozen account.
   - Tests: `e2e` any_eoa_executes_but_the_fee_goes_to_the_fee_recipient, fee_above_max_fee_reverts, a_frozen_account_pays_fees_only_to_the_fee_recipient_and_never_above_the_max_fee.
4. **The first payment to a new recipient is capped separately.**
   - Within the caps, a recipient that is neither paid before nor allowlisted receives at most `newPayeeCap`.
   - This bounds what a look-alike address (address poisoning) or a tampered page can take at once. After one payment the recipient is known and only the ordinary caps apply.
   - Tests: `e2e` protections.
5. **Freezing is instant, cancels what is scheduled, and unfreezing is not instant.**
   - Owners freeze with a proof (`restrict`). The guardian freezes with its salt. A freeze cannot be scheduled.
   - A frozen account makes no payments.
   - Freezing also cancels every scheduled change, so nothing a thief scheduled survives the emergency stop. A guardian's freeze keeps changes to the guardian itself (see 10).
   - Unfreezing is a timelocked change that owners or the guardian can cancel.
   - Tests: `e2e` owner_freeze_stops_payments_and_cancels_scheduled_changes_until_a_timelocked_unfreeze, at_most_eight_changes_wait_and_a_freeze_cancels_them_all.
6. **Only tightening skips the timelock.**
   - `restrict` applies a change at once only if it cannot increase what the account can spend or who controls it:
     - freeze;
     - lower limits;
     - enable the allowlist;
     - remove a recipient;
     - require the payment sheet.
   - Owners, the guardian, unfreezing, raised limits and dropping the payment sheet always wait for the change delay.
   - Tests: `e2e` restrict_tightens_at_once_and_refuses_to_loosen; `prop` restrictive_limits_never_loosen, control_changes_are_never_restrictive.
7. **Scheduled changes are visible from any device.**
   - At most 8 changes wait at once.
   - They are listed on-chain (`pendingChangeIds`, `pendingChange`). The app reads them from there and flags any not scheduled from this browser.
   - Tests: `e2e` owner_freeze_stops_payments_and_cancels_scheduled_changes_until_a_timelocked_unfreeze, at_most_eight_changes_wait_and_a_freeze_cancels_them_all.
8. **The key never reaches the chain.**
   - Owners are nullifiers `Poseidon2(domain, pk, prf, appId)`.
   - The passkey public key, signature and PRF secret are never in calldata, storage or events.
   - Every transaction the app sends is checked for the public key (`publicKeyOccurrences`).
   - Tests: `e2e` pubkey_absent_from_calldata; `nargo`.
9. **Accounts in different apps share nothing on-chain**, unless their owner discloses the link.
   - Account address = CREATE2 over `(appId, nullifier, configHash)`.
   - The guardian is stored as `keccak256(abi.encode(typehash, account, guardian, salt))`.
   - Tests: `e2e` one_passkey_three_apps_have_distinct_accounts_and_nullifiers, guardian_is_private_until_it_acts_and_freezes_with_its_salt_only.
10. **A guardian can delay the owners, but never hold the account.**
    - The guardian can freeze, veto scheduled changes and start a recovery.
    - It cannot veto a change to the guardian itself. Every change to the guardian waits the change delay plus the recovery delay, so a guardian recovery started in time still finishes first, and a thief cannot install a guardian quickly.
    - A change to the guardian cancels a recovery the previous guardian started, so a removed guardian keeps no way in.
    - A recovery waits for the recovery delay and any owner can cancel it. When it executes it bumps the owner epoch, which voids every previous owner and scheduled change.
    - Tests: `e2e` the_guardian_cannot_veto_a_change_to_the_guardian_which_waits_longer, guardian_recovery_rotates_owners_and_owner_can_cancel, audit (removing the guardian cancels the recovery it started just before).
11. **The payment sheet shows what is paid, and an owner can require it.**
    - A Secure Payment Confirmation (`payment.get`) client data is accepted only for `pay`, and only byte for byte:
      - same challenge, origin and topOrigin;
      - `crossOrigin:false`;
      - `payeeName` equal to the recipient in lowercase hex;
      - `total` equal to amount plus fee;
      - `payment.rpId` hashing to the account's rpIdHash.
    - Because the fee is at most `maxFee` and goes to the fee recipient (3), the payee receives at least the total shown minus `maxFee`.
    - With the payment sheet required (a tightening change), `pay` refuses ordinary passkey assertions, so a tampered page cannot pay unless the browser shows the payee and total.
    - The SDK never falls back to the plain passkey prompt once the sheet was shown.
    - Tests: `e2e` secure payment confirmation (including a_required_payment_sheet_refuses_the_plain_passkey_prompt); core unit tests; `prop` client_data_parsers_never_panic, spc_totals_round_trip.
12. **Configuration is bound to the address.** The CREATE2 salt includes the configuration hash (implementation, verifier, token, rpIdHash, origin, caps, delays, fee recipient, maximum fee), so nobody can deploy an account first with a different verifier. Tests: `e2e` frontrun_with_other_verifier_gets_other_address.
13. **Disclosures are consent, for one audience, for a while.**
    - The link circuit proves that one hidden passkey owns both nullifiers and signed a statement naming the chain, the factory, both apps and nullifiers, the audience, a nonce and an expiry.
    - `verifyDisclosure` takes the verifier's own audience name and fails for another, so a forwarded disclosure fails. It also:
      - checks the nonce when the verifier asked for one;
      - refuses disclosures valid for more than 7 days;
      - checks the client data and the proof, on-chain with `eth_call` and/or locally.
    - Tests: `e2e` linkable by consent (another audience, edited audience, missing nonce, long-lived, expired, a nullifier the passkey does not own, tampered proof, another origin, another deployment); `nargo` link.
14. **ERC-7579 validator.**
    - User operations are bound by the userOpHash.
    - ERC-1271 signatures are bound to the chain and the account (`keccak256(abi.encode(typehash, chainId, account, hash))`), so they cannot be replayed to another account that installed the same public nullifier.
    - Malformed signatures and failed proofs return failure; they never revert.
    - Tests: `forge` (36 tests with real proofs).

## Trust assumptions

- **The VeraKey origin's page code.**
  - Every app uses VeraKey's rpId, so the page can see the key, the PRF secret and the signature in the browser.
  - Mitigations: proving only in the browser, a strict CSP with no third-party scripts, a self-hosted CRS, and an open-source client.
  - What bounds a malicious page:
    - it still needs a fresh passkey approval for every action;
    - caps, the new-recipient cap, the fee limit and the timelocks limit what an approved action can do;
    - with the payment sheet required, the browser (not the page) shows payee and total, and the account checks them.
- **The relayer.**
  - It cannot move funds or change what was signed. It could refuse to relay, but anyone can submit the calldata instead (a third party is not paid the fee).
  - It relays only for accounts whose code is the EIP-1167 clone of this deployment's implementation, caps each transaction at 2.5M gas, and rate-limits new accounts per visitor, so look-alike contracts cannot drain its gas.
  - It sees request metadata (IP, timing).
  - Mitigations:
    - rate-limit keys are a daily-rotated HMAC of the IP, kept in memory only;
    - an optional random delay before broadcasting;
    - several relayers or oblivious HTTP are on the roadmap.
  - Run it behind exactly one proxy, with its port bound to loopback: it trusts one `X-Forwarded-For` hop.
- **The USDG issuer** (Paxos) can freeze any single account. This is by design: VeraKey is unlinkable, not anonymous.
- **The proof system.**
  - Toolchain: Noir 1.0.0-beta.25 and Barretenberg 5.2.0 (UltraHonk, ZK flavour, `--optimized` Solidity verifier).
  - The verifier is generated, not hand-written.
  - UltraHonk has not been independently audited.
- **Browsers** follow the WebAuthn Level 3 serialization of `clientDataJSON`: `type`, `challenge`, `origin`, then other keys.

## What still leaks (and is not claimed as private)

- **Amounts, recipients and timing** are public per account.
- **Where funds come from.**
  - Funding several app accounts from one wallet links them on-chain.
  - Receive income directly into each account (the Receive panel has the address and an EIP-681 QR).
  - On mainnet, top up through an ASP-screened pool: 0xbow Privacy Pools or Railgun on Arbitrum One. No such pool runs on Arbitrum Sepolia.
- **A guardian reveals itself for one account** when it acts.
- **A disclosure can be forwarded.** An honest verifier who checks it under its own name sees it fail, but the forwarded file still shows its contents.

## Accepted risks and known issues

- **A stolen, unlocked passkey can fight the owner.**
  - Whoever holds the passkey can approve anything the owner can, within the caps, the new-recipient cap and the timelocks.
  - Each side can cancel the other's scheduled changes and a recovery. The guardian can veto a thief's changes, and a freeze wipes them.
  - A thief cannot lift the caps or unfreeze while the owner or the guardian keeps cancelling within the change delay.
- **Fees while frozen.**
  - A thief who can make the passkey sign can still spend the account's funds on fees: up to `maxFee` per approval, within the daily cap, paid only to the relayer.
  - That is griefing, not theft.
- **After a recovery the owner cannot rebuild the old guardian card.**
  - The guardian salt comes from the old passkey's PRF.
  - The guardian must keep its card, and the owner should name a guardian again after recovering.
- **`ruint` 1.16.0 has two advisories:**
  - RUSTSEC-2026-0220: shift operations with incorrect overflow flags.
  - RUSTSEC-2025-0137: an unsound `reciprocal_mg10`.
  - The workspace pins 1.16.0 because stylus-sdk 0.9.0 fails const evaluation with ruint 1.17 or later.
  - VeraKey's code uses no `Uint` shifts and no `U256` division; the shifts it does use are on `u8` and `u32`.
  - Fix: migrate to stylus-sdk 0.10 (roadmap).
  - `cargo audit` also lists four unmaintained proc-macro crates, used at build time only.
- **npm:** `pnpm audit --prod` reports no known vulnerabilities (2026-09-24).
- **Secure Payment Confirmation:**
  - Chromium only (macOS, Windows, Android).
  - The enrollment belongs to one browser profile, so requiring the sheet limits payments to the browsers where the passkey is enrolled for it.
  - Elsewhere the app uses the ordinary passkey prompt.
- **The ERC-7579 validator enforces no spending policy.** Pair it with a policy or hook module.
- **Validator gas.** A valid proof needs about 732k gas inside the module, and bundler estimates are too low, so set `verificationGasLimit` yourself (the SDK exports `VALIDATOR_VERIFICATION_GAS`).
- **Proving on iPhone has not been measured yet.** Desktop Chrome takes 1.85 s.

## Internal review

On 2026-09-24 an adversarial review covered every change since the bb 5.2.0 upgrade:
- the Stylus account and core;
- both circuits;
- disclosure verification;
- the SDK client;
- the ERC-7579 validator;
- the relayer.

It found the issues below, and each fix has a regression test.

| Severity | Finding | Fix |
|---|---|---|
| High | Fees went to whoever submitted the transaction. A signed fee, from any action and even from a frozen account, could pay an attacker, bypassing freeze, allowlist and new-recipient cap | Fees go only to the factory's fee recipient, capped by `maxFee` (invariant 3) |
| Medium | The payment sheet was optional, and the SDK fell back to the plain prompt after the sheet was closed | Owners can require the sheet; no fallback once the sheet was shown (invariant 11) |
| Medium | A guardian could freeze and then veto every unfreeze and every attempt to remove it, forever | The guardian cannot veto changes to the guardian; they wait longer (invariant 10) |
| Medium | A freeze left changes a thief had scheduled alive, and the app listed only changes made in the same browser | Freezing cancels scheduled changes; the list is on-chain (invariants 5 and 7) |
| Low–medium | Disclosure audience and nonce were not enforced by the verifier | `verifyDisclosure` requires the audience, checks the nonce and bounds the lifetime (invariant 13) |
| Low | The relayer trusted a contract's own `config()` answer and allowed 12M gas | Clone-code check, 2.5M gas cap, per-visitor limit on new accounts |

A second internal audit the same day ran Nemesis (alternating Feynman and state-inconsistency passes until nothing new surfaced) over the Stylus contracts, the ERC-7579 validator and both circuits. Each finding was reproduced on a local Nitro devnode with real proofs, and each fix has a regression test in `packages/sdk/test/e2e/audit.e2e.test.ts`.

| Severity | Finding | Fix |
|---|---|---|
| High | Freezing, restricting and cancelling paid their fee within the same caps as payments. A thief who spent the day's cap stopped the owners from freezing or vetoing until the next UTC day, so a change the thief scheduled applied unopposed; a per-payment cap below the fee locked every relayed action | These actions are never refused because of the caps, and their fee still counts toward the day's spending; the per-payment cap never drops below `maxFee` (invariant 2) |
| Medium | A recovery survived a change to the guardian, so a guardian the owners removed could still take the account with a recovery it started just before | A change to the guardian cancels a pending recovery (invariant 10) |
| Low | The longer delay for replacing a guardian was decided when the change was scheduled | Every change to the guardian waits the change delay plus the recovery delay (invariant 10) |
| Low | A freeze scheduled through the timelock did not cancel the scheduled changes | A freeze cannot be scheduled; it is always instant (invariant 5) |
| Low | Owner changes that could never apply kept one of the eight pending slots | They are refused when they are scheduled (invariant 6) |
| Low | The factory accepted a configuration every account then rejected | The factory and the accounts check the same bounds (`verakey_core::config`) |

## Reporting

Please report vulnerabilities privately through a security advisory on the repository, not in a public issue.
