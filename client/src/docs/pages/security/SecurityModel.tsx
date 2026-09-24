import type { ReactNode } from "react";
import { A, Callout, H2, H3, Table } from "../../components";

const INVARIANTS: [string, ReactNode, ReactNode][] = [
  [
    "No USDG leaves an account without a fresh, user-verified passkey approval of that exact action.",
    <>
      The circuit proves an ES256 signature with the UP and UV flags and the rpId hash, under a hidden key. The account
      checks that the signed challenge is this action's hash (chain, account, nonce, kind, target, amount, data hash, fee,
      deadline), from the exact origin and not cross-origin, and consumes the nonce before any transfer.
    </>,
    <>e2e: authorization binding (origin, type, other account, other chain, tampered proof, replay, deadlines)</>,
  ],
  [
    "Every movement is capped.",
    <>A payment plus its fee, and every fee a management action pays, counts against the per-payment and daily caps.</>,
    <>e2e: policy; prop: <code>a_day_never_spends_more_than_its_caps</code></>,
  ],
  [
    "Fees cannot be redirected.",
    <>
      Every fee goes to the factory's <code>feeRecipient</code> (the relayer) and is at most <code>maxFee</code> (0.25 USDG
      on Sepolia); both are bound into the account address. Whoever submits a transaction, or tricks a user into
      approving one, cannot turn the signed fee into a payment to themselves, even from a frozen account.
    </>,
    <>
      e2e: <code>any_eoa_executes_but_the_fee_goes_to_the_fee_recipient</code>, <code>fee_above_max_fee_reverts</code>,{" "}
      <code>a_frozen_account_pays_fees_only_to_the_fee_recipient_and_never_above_the_max_fee</code>
    </>,
  ],
  [
    "The first payment to a new recipient is capped separately.",
    <>
      Within the caps, a recipient neither paid before nor allowlisted receives at most <code>newPayeeCap</code>. This
      bounds what a look-alike address or a tampered page can take at once.
    </>,
    <>e2e: protections</>,
  ],
  [
    "Freezing is instant and cancels what is scheduled; unfreezing is not instant.",
    <>
      Owners freeze with a proof (<code>restrict</code>), the guardian with its salt. A frozen account makes no payments.
      A freeze cancels every scheduled change; a guardian's freeze keeps changes to the guardian itself. Unfreezing is a
      timelocked change that owners or the guardian can cancel.
    </>,
    <>
      e2e: <code>owner_freeze_stops_payments_and_cancels_scheduled_changes_until_a_timelocked_unfreeze</code>,{" "}
      <code>at_most_eight_changes_wait_and_a_freeze_cancels_them_all</code>
    </>,
  ],
  [
    "Only tightening skips the timelock.",
    <>
      <code>restrict</code> applies at once only a freeze, lower limits, enabling the allowlist, removing a recipient or
      requiring the payment sheet. Owners, the guardian, unfreezing, higher limits and dropping the payment sheet wait for
      the change delay.
    </>,
    <>
      e2e: <code>restrict_tightens_at_once_and_refuses_to_loosen</code>; prop:{" "}
      <code>restrictive_limits_never_loosen</code>, <code>control_changes_are_never_restrictive</code>
    </>,
  ],
  [
    "Scheduled changes are visible from any device.",
    <>
      At most 8 changes wait at once, listed on-chain (<code>pendingChangeIds</code>, <code>pendingChange</code>). The app
      reads them from there and flags any not scheduled from this browser.
    </>,
    <>
      e2e: <code>owner_freeze_stops_payments_and_cancels_scheduled_changes_until_a_timelocked_unfreeze</code>,{" "}
      <code>at_most_eight_changes_wait_and_a_freeze_cancels_them_all</code>
    </>,
  ],
  [
    "The key never reaches the chain.",
    <>
      Owners are nullifiers, <code>Poseidon2(domain, pk, prf, appId)</code>. The public key, the signature and the PRF
      secret are never in calldata, storage or events, and the app checks every transaction it sends for the public key
      (<code>publicKeyOccurrences</code>).
    </>,
    <>e2e: <code>pubkey_absent_from_calldata</code>; nargo</>,
  ],
  [
    "Accounts in different apps share nothing on-chain, unless their owner discloses the link.",
    <>
      The account address is CREATE2 over <code>(appId, nullifier, configHash)</code>. The guardian is stored as{" "}
      <code>keccak256(abi.encode(typehash, account, guardian, salt))</code>.
    </>,
    <>
      e2e: <code>one_passkey_three_apps_have_distinct_accounts_and_nullifiers</code>,{" "}
      <code>guardian_is_private_until_it_acts_and_freezes_with_its_salt_only</code>
    </>,
  ],
  [
    "A guardian can delay the owners, and takes over only through a recovery nobody cancels.",
    <>
      The guardian can freeze, veto scheduled changes and start a recovery. It cannot veto a change to the guardian, which
      waits the change delay plus the recovery delay, so a recovery started in time still finishes first. A recovery waits
      the recovery delay, any owner can cancel it, and executing it bumps the owner epoch, which voids every previous owner
      and scheduled change. A recovery nobody cancels makes the guardian's chosen nullifier the only owner.
    </>,
    <>
      e2e: <code>the_guardian_cannot_veto_a_change_to_the_guardian_which_waits_longer</code>,{" "}
      <code>guardian_recovery_rotates_owners_and_owner_can_cancel</code>
    </>,
  ],
  [
    "The payment sheet shows what is paid, and an owner can require it.",
    <>
      A <code>payment.get</code> client data is accepted only for <code>pay</code>, byte for byte: the same challenge,
      origin and topOrigin, <code>crossOrigin:false</code>, <code>payeeName</code> equal to the recipient in lowercase hex,{" "}
      <code>total</code> equal to amount plus fee, and <code>payment.rpId</code> hashing to the account's rpId hash. When
      the sheet is required, <code>pay</code> refuses the plain passkey prompt, and the SDK never falls back to it once the
      sheet was shown.
    </>,
    <>
      e2e: secure payment confirmation, including <code>a_required_payment_sheet_refuses_the_plain_passkey_prompt</code>;
      core unit tests; prop: <code>client_data_parsers_never_panic</code>, <code>spc_totals_round_trip</code>
    </>,
  ],
  [
    "Configuration is bound to the address.",
    <>
      The CREATE2 salt includes the configuration hash (implementation, verifier, token, rpId hash, origin, caps, delays,
      fee recipient, maximum fee), so nobody can deploy an account first with a different verifier.
    </>,
    <>e2e: <code>frontrun_with_other_verifier_gets_other_address</code></>,
  ],
  [
    "Disclosures are made by consent, for one audience, and expire for honest verifiers.",
    <>
      The link circuit proves that one hidden passkey owns both nullifiers and signed a statement naming the chain, the
      factory, both apps and nullifiers, the audience, a nonce and an expiry. <code>verifyDisclosure</code> takes the
      verifier's own audience name, checks the nonce it asked for, refuses disclosures valid for more than 7 days, and
      checks the client data and the proof. The link a disclosure reveals is permanent: whoever holds the file can show it.
    </>,
    <>e2e: linkable by consent (another audience, edited audience, missing nonce, long-lived, expired, a nullifier the passkey does not own, tampered proof, another origin, another deployment); nargo: link</>,
  ],
  [
    "ERC-7579 signatures are bound to one operation, chain and account.",
    <>
      User operations are bound by the <code>userOpHash</code>. ERC-1271 signatures are bound to the chain and the account,
      so they cannot be replayed to another account that installed the same nullifier. Malformed signatures and failed
      proofs return failure; they never revert.
    </>,
    <>forge: 36 tests with real proofs</>,
  ],
];

export default function SecurityModelPage() {
  return (
    <>
      <Callout kind="warning" title="Testnet preview">
        VeraKey runs on Arbitrum Sepolia. The circuits and contracts have not had an independent audit; do not use them with
        real funds. See <A href="/docs/security/review">Review and accepted risks</A>.
      </Callout>

      <H2>What VeraKey protects</H2>
      <ul>
        <li><strong>Your money.</strong> Only a fresh approval with your passkey moves USDG, and only for the exact action you approved. The one exception is a guardian recovery that no owner cancels in time: it hands the account to the guardian's chosen passkey.</li>
        <li><strong>Your passkey.</strong> Its public key, its signatures and its PRF secret never reach the chain, the relayer or other apps.</li>
        <li><strong>Your separate identities.</strong> Your accounts in different apps cannot be linked on-chain, unless you prove the link yourself.</li>
        <li><strong>You, from a bad approval.</strong> Even an approved action stays within the caps, the new-recipient cap, the fee limit and the timelocks.</li>
      </ul>
      <p>
        Authentication is not authorization: a valid proof only shows that an owner approved, and the account's policy then
        decides. VeraKey does not claim payment privacy, Sybil resistance, or anything about biometrics.
      </p>

      <H2>Invariants</H2>
      <p>
        These must always hold. Each names how it is enforced and the tests that exercise it: <code>e2e</code> is{" "}
        <code>packages/sdk/test/e2e</code> (real contracts on a nitro devnode, real proofs), <code>prop</code> is{" "}
        <code>contracts/stylus/core/tests/properties.rs</code> (2,000 cases each), <code>nargo</code> is the circuit tests,
        and <code>forge</code> is <code>contracts/evm/test</code>.
      </p>
      <Table
        stack
        head={["#", "Invariant", "How it is enforced", "Tests"]}
        rows={INVARIANTS.map(([invariant, how, tests], i) => [String(i + 1), <strong key="i">{invariant}</strong>, how, tests])}
      />

      <H2>Trust assumptions</H2>
      <H3>The VeraKey page code</H3>
      <p>
        Every app uses VeraKey's rpId, so the page served from the VeraKey origin sees the key, the PRF secret and the
        signature in your browser. It proves only in the browser, runs under a strict CSP with no third-party scripts, loads
        a self-hosted CRS, and is open source. A malicious page would still need a fresh passkey approval for every action,
        could not exceed the caps, the new-recipient cap, the fee limit or the timelocks, and, with the payment sheet
        required, could not pay without the browser itself showing the payee and the total.
      </p>
      <H3>The relayer</H3>
      <p>
        It cannot move funds or change what was signed. It could refuse to relay, but anyone can submit the same calldata
        instead (a third party is not paid the fee). It relays only for accounts whose code is the EIP-1167 clone of this
        deployment's implementation, caps each transaction at 2.5M gas and limits new accounts per visitor, so look-alike
        contracts cannot drain its gas. It sees request metadata (IP, timing): its rate-limit keys are a daily-rotated HMAC of
        the IP kept in memory, and it can add a random delay before broadcasting. Run it behind exactly one proxy with its
        port bound to loopback, because it trusts one <code>X-Forwarded-For</code> hop.
      </p>
      <H3>The USDG issuer</H3>
      <p>Paxos can freeze any single account. This is by design: VeraKey is unlinkable, not anonymous.</p>
      <H3>The proof system</H3>
      <p>
        Noir 1.0.0-beta.25 and Barretenberg 5.2.0 (UltraHonk, ZK flavour, optimized Solidity verifier). The verifiers are
        generated, not hand-written. UltraHonk has not been independently audited.
      </p>
      <H3>Browsers</H3>
      <p>
        Browsers serialize <code>clientDataJSON</code> as WebAuthn Level 3 specifies: <code>type</code>,{" "}
        <code>challenge</code>, <code>origin</code>, then other keys. The account checks that byte prefix instead of parsing
        JSON.
      </p>

      <H2>What still leaks</H2>
      <ul>
        <li><strong>Amounts, recipients and timing</strong> are public for each account.</li>
        <li>
          <strong>Where funds come from.</strong> Funding several app accounts from one wallet links them on-chain. Receive
          income directly into each account (see <A href="/docs/guides/fund">Fund and receive</A>); on mainnet, top up through
          an ASP-screened pool such as 0xbow Privacy Pools or Railgun on Arbitrum One. No such pool runs on Arbitrum Sepolia.
        </li>
        <li><strong>A guardian reveals itself</strong> for one account when it acts.</li>
        <li>
          <strong>A disclosure is permanent.</strong> Whoever holds the file learns that the two accounts share an owner
          and can check the proof. Only an honest verifier checking under its own name sees a forwarded one fail.
        </li>
      </ul>

      <H2>Threat model</H2>
      <p>Who can see what:</p>
      <Table
        stack
        head={["Data", "Chain and other apps", "Relayer", "VeraKey page code"]}
        rows={[
          ["Passkey public key, signature, authenticator data", "hidden", "hidden", "seen, in the browser only"],
          ["PRF secret", "hidden", "hidden", "seen, in the browser only"],
          ["Which accounts belong to one person", "hidden, unless the owner discloses it", "visible if one relayer serves them all (IP, timing)", "visible"],
          ["Guardian address", "hidden until it acts", "hidden until it acts", "seen when set"],
          ["Account address, amounts, recipients, timing", "public", "public", "public"],
        ]}
      />
      <p>What an attacker can do, and what stops them:</p>
      <Table
        stack
        head={["Attacker", "What they can do", "What stops them"]}
        rows={[
          ["Anyone who submits your signed transaction", "Execute it once, as signed", "The fee goes only to the fee recipient (3); the nonce stops a replay (1)"],
          ["A front-runner at account creation", "Deploy a contract first", "Another verifier or policy gives another address (12)"],
          ["A thief with your unlocked passkey", "Approve anything you can", "Caps (2), the new-recipient cap (4), timelocks (6); you or the guardian can freeze and cancel (5, 10)"],
          ["A tampered page on the VeraKey origin", "Ask you to approve something else", "A fresh approval per action (1), the caps (2, 4), and the payment sheet when required (11)"],
          ["An address-poisoning attacker", "Get you to pay a look-alike address", "The first payment to a new recipient is capped (4)"],
          ["A malicious guardian", "Freeze, veto changes, start a recovery, and take the account over if nobody cancels it in time", "Owners see and cancel the recovery during the recovery delay; it cannot veto changes to the guardian (10)"],
          ["The relayer", "Refuse to relay, see IP and timing", "Anyone can submit the calldata instead; it never sees the key"],
          ["An on-chain observer", "See each account's activity", "Accounts in different apps share nothing on-chain (8, 9)"],
          ["Anyone a disclosure is forwarded to", "Learn that the two accounts share an owner, and check the proof", "Nothing: the link is permanent. An honest verifier refuses a disclosure made for someone else (13)"],
        ]}
      />
      <p>The numbers refer to the invariants above.</p>
    </>
  );
}
