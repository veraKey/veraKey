import { A, Code, H2, Table } from "../../components";

export default function ContractsPage() {
  return (
    <>
      <H2>The account</H2>
      <p>
        <code>VeraKeyAccount</code> (<code>contracts/stylus/account</code>) is a Rust program on Arbitrum Stylus. It is
        deployed once as an implementation (46.0 KB, as a multi-fragment Stylus program, which Arbitrum supports since
        ArbOS 60), and every user account is an EIP-1167 clone that delegates to it. The implementation locks itself in
        its constructor, so it cannot be initialized as an account.
      </p>
      <p>
        An account has no generic call surface: it only moves USDG, through <code>transfer</code>, to a payee and to the fee
        recipient. Its pure logic (client data parsing, spending windows, change validation) lives in{" "}
        <code>contracts/stylus/core</code>, which has 39 unit tests and 9 property tests.
      </p>

      <H2>Authorization</H2>
      <p>Every proof-authorized entry point (<code>pay</code>, <code>scheduleChange</code>, <code>restrict</code>, <code>cancelChange</code>, <code>cancelRecovery</code>) runs the same checks:</p>
      <ol>
        <li>the fee is at most <code>maxFee</code>;</li>
        <li>the deadline has not passed and is at most 10 minutes away;</li>
        <li>the nullifier is an owner in the current owner epoch;</li>
        <li>
          the client data is a <code>webauthn.get</code> assertion whose challenge is this action's hash, from exactly this
          origin and not cross-origin. For <code>pay</code> only, a <code>payment.get</code> assertion from the payment sheet
          is accepted when its payee, total and rpId match;
        </li>
        <li><code>HonkVerifier.verify</code> accepts the proof with the six public inputs the account computes;</li>
        <li>the nonce is consumed, before any token moves.</li>
      </ol>

      <H2>Policy checks</H2>
      <p>A payment then has to pass, in this order:</p>
      <Code lang="text" title="pay">{`
not frozen → amount > 0 → a valid recipient (not zero, not the account) → the allowlist, if on
→ the payment sheet, if required → amount + fee within the per-payment and daily caps
→ the new-recipient cap for a recipient neither paid before nor allowlisted → authorization (above)
→ record the spending and mark the recipient known → transfer the amount → transfer the fee
`}</Code>
      <p>
        <code>restrict</code> applies a change only when <code>is_restrictive</code> holds (it cannot raise spending or change
        control); a freeze also cancels the scheduled changes. <code>scheduleChange</code> stores a pending change (at most
        8) that <code>applyChange</code> applies after its delay. A guardian recovery bumps the owner epoch, which revokes
        every earlier owner and voids their changes. See <A href="/docs/build/policy">Payments and policy</A>.
      </p>

      <H2>Storage layout</H2>
      <p>Small fields share storage slots, so a payment updates its nonce and spending window in one slot:</p>
      <Table
        head={["Slot", "Fields"]}
        rows={[
          ["0", "initialized, factory, changeDelay (u64), frozen, allowlistEnabled, paymentSheetRequired"],
          ["1", "verifier, recoveryDelay (u64)"],
          ["2", "usdg, ownerCount (u64)"],
          ["3", "perTxCap (u128), dailyCap (u128)"],
          ["4", "newPayeeCap (u128), recoveryEta (u64), maxFee (u64)"],
          ["5", "nonce (u64), spendDay (u64), spentToday (u128): everything a payment writes"],
          ["6", "feeRecipient"],
          ["then", "appId, rpIdHash, origin, ownerEpoch, guardianCommitment, recoveryNullifier, the 8 pending change ids, and the maps of owners, allowed recipients, known recipients and pending changes"],
        ]}
      />
      <p>
        Owners are keyed by <code>keccak256(ownerEpoch ‖ nullifier)</code>, so a recovery revokes every previous owner in
        one write.
      </p>

      <H2>The factory</H2>
      <p>
        <code>VeraKeyFactory</code> (<code>contracts/stylus/factory</code>, 29.3 KB) holds one configuration and creates
        accounts with it. <code>createAccount(appId, nullifier)</code> is idempotent and anyone may call it. The address
        commits to the whole configuration:
      </p>
      <Code lang="solidity">{`
configHash = keccak256(abi.encode(implementation, verifier, usdg, rpIdHash, keccak256(origin),
                                  perTxCap, dailyCap, newPayeeCap, changeDelay, recoveryDelay,
                                  feeRecipient, maxFee))
salt       = keccak256(abi.encode(appId, nullifier, configHash))
account    = CREATE2(factory, salt, EIP-1167 creation code for the implementation)
`}</Code>
      <p>
        So nobody can deploy a user's account address first with another verifier or policy. Both Stylus programs are
        cached on-chain, which lowers their per-call cost.
      </p>

      <H2>Verifiers and the validator</H2>
      <ul>
        <li>
          <strong>HonkVerifier</strong> (16,742 bytes) and <strong>LinkHonkVerifier</strong> are generated by Barretenberg
          5.2.0 from the circuits, with the optimized generator. See <A href="/docs/architecture/circuits">Circuits</A>.
        </li>
        <li>
          <strong>VeraKeyValidator</strong> is the ERC-7579 module. See <A href="/docs/build/erc-7579">ERC-7579 validator</A>.
        </li>
      </ul>
      <p>
        All three are source-verified on Sourcify; the addresses are in <A href="/docs/reference/deployments">Deployments</A>.
      </p>
    </>
  );
}
