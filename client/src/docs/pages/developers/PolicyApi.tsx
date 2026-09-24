import { A, Callout, Code, H2, Table } from "../../components";

export default function PolicyApiPage() {
  return (
    <>
      <H2>Paying</H2>
      <Code lang="ts">{`
pay(appId: bigint, to: Address, amount: bigint, emit?: (state: ProofState) => void,
    options?: { secureConfirmation?: boolean }): Promise<TransactionReceipt>
`}</Code>
      <p>
        <code>amount</code> is in USDG base units. The client adds the relayer fee to what the passkey signs; both count
        against the caps. The account refuses the payment if it breaks any rule: the caps, the new-recipient cap, the
        allowlist, a freeze, or a required payment sheet. With <code>secureConfirmation</code>, see{" "}
        <A href="/docs/build/payment-sheet">Payment sheet</A>.
      </p>

      <H2>Tightening at once</H2>
      <Code lang="ts">{`
restrict(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit?): Promise<{ account: Address; restrictionId: Hex }>
freeze(appId: bigint, emit?)   // = restrict(appId, changePayload.freeze(), emit)
`}</Code>
      <p>
        <code>restrict</code> applies a change immediately, but only if it cannot increase what the account can spend or
        change who controls it. Anything else is refused with <code>NotRestrictive</code>; schedule it instead. A freeze
        also cancels every scheduled change.
      </p>
      <Code lang="ts">{`
import { changePayload } from "@verakey/sdk/action";

await vera.restrict(APP_ID, changePayload.setLimits(5_000_000n, 10_000_000n)); // lower both caps now
await vera.restrict(APP_ID, changePayload.setNewPayeeCap(1_000_000n));         // first payments: 1 USDG
await vera.freeze(APP_ID);                                                     // stop every payment
`}</Code>

      <H2>Scheduling a change</H2>
      <Code lang="ts">{`
scheduleChange(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit?): Promise<TrackedChange>

interface TrackedChange { account: Address; changeId: Hex; kind: ChangeKind; payload: Hex; eta: number }
`}</Code>
      <p>
        A scheduled change waits out the account's change delay (<code>eta</code> is in Unix seconds). A change that
        replaces or removes a guardian waits the change delay plus the recovery delay. At most 8 changes wait at once;
        a ninth is refused with <code>TooManyPendingChanges</code>.
      </p>

      <H2>Applying and cancelling</H2>
      <Code lang="ts">{`
applyChange(account: Address, change: TrackedChange): Promise<TransactionReceipt> // no passkey: anyone may apply
cancelChange(appId: bigint, changeId: Hex, emit?): Promise<TransactionReceipt>    // needs an owner's approval
pendingChanges(account: Address): Promise<PendingChangeInfo[]>                    // from the chain, oldest first
scheduledPayload(account: Address, changeId: Hex): Promise<Hex | null>            // best effort, from recent logs
isPending(account: Address, changeId: Hex): Promise<boolean>
`}</Code>
      <p>
        The account stores only the hash of each change's payload, so <code>applyChange</code> needs the payload you
        scheduled. <code>pendingChanges</code> lists every waiting change, including ones scheduled from another device.
        Show them to your users, flag the ones your app did not schedule, and let them cancel.
      </p>
      <Callout kind="security">
        A change nobody expected is the signal of a stolen, unlocked device. The VeraKey app marks such changes "Not
        scheduled from this browser". A freeze cancels all of them at once.
      </Callout>

      <H2>Change payloads</H2>
      <p>
        <code>changePayload</code> builds each change. The last column says whether <code>restrict</code> accepts it
        (instant) or it must be scheduled.
      </p>
      <Table
        head={["Helper", "Kind", "Instant with restrict?"]}
        rows={[
          [<code key="1">addOwner(nullifier)</code>, "1", "Never"],
          [<code key="2">removeOwner(nullifier)</code>, "2", "Never. The last owner cannot be removed (LastOwner)."],
          [<code key="3">setLimits(perTxCap, dailyCap)</code>, "3", "When both are at most the current caps"],
          [<code key="4">setRecipient(recipient, allowed)</code>, "4", "When allowed is false (removing a recipient)"],
          [<code key="5">setAllowlist(enabled)</code>, "5", "When enabled is true"],
          [<code key="6">setGuardian(commitment)</code>, "6", "Never. The zero hash removes the guardian."],
          [<code key="7">setNewPayeeCap(cap)</code>, "7", "When it is at most the current cap"],
          [<code key="8">freeze()</code>, "8", "Always. Also cancels every scheduled change."],
          [<code key="9">unfreeze()</code>, "9", "Never"],
          [<code key="10">setPaymentSheet(required)</code>, "10", "When required is true"],
        ]}
      />
      <p>
        For a guardian, build the commitment with <code>vera.guardianCard(appId, guardian)</code>, which returns the card
        to hand over and the <code>commitment</code> to schedule. See <A href="/docs/guides/recovery">Recovery and guardians</A>.
      </p>

      <H2>Reading the policy</H2>
      <p>
        <code>vera.account(appId)</code> returns the whole policy in one call: caps, spending today, the new-recipient cap,
        the allowlist switch, freeze, the payment sheet requirement, the delays, the fee limit and the pending changes. To
        read an account directly, use the views in the <A href="/docs/reference/contracts#account-views">contract
        reference</A>, such as <code>policy()</code>, <code>protections()</code>, <code>fees()</code> and{" "}
        <code>pendingChangeIds()</code>.
      </p>
    </>
  );
}
