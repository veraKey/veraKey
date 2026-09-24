import { A, Code, H2, Table } from "../../components";

const c = (text: string) => <code>{text}</code>;

const PROOF_ARGS = "uint256 fee, uint64 deadline, bytes32 nullifier, bytes client_data_json, bytes proof";

export default function ContractReferencePage() {
  return (
    <>
      <p>
        The Solidity interfaces <code>IVeraKeyAccount</code> and <code>IVeraKeyFactory</code> are generated from the Stylus
        programs. Their errors are in the <A href="/docs/reference/errors">errors reference</A>,
        and their addresses in <A href="/docs/reference/deployments">Deployments</A>.
      </p>

      <H2>Account functions</H2>
      <p>
        Functions that take <code>{PROOF_ARGS}</code> need an owner's proof over their <A href="#action-kinds">action</A>.
        Anyone may submit them: the fee goes only to the fee recipient.
      </p>
      <Table
        stack
        head={["Function", "Caller", "What it does"]}
        rows={[
          [c("pay(address to, uint256 amount, …proof)"), "Owner's proof", "Pays amount USDG to to, and the fee to the fee recipient."],
          [c("scheduleChange(uint8 change_kind, bytes payload, …proof) → bytes32"), "Owner's proof", "Schedules a change; returns its id. It applies after the change delay; a change to the guardian waits the recovery delay too. A freeze, or an owner change that could never apply, is refused."],
          [c("restrict(uint8 change_kind, bytes payload, …proof) → bytes32"), "Owner's proof", "Applies a tightening change at once; a freeze also cancels the scheduled changes. Never refused because of the caps."],
          [c("applyChange(bytes32 change_id, uint8 change_kind, bytes payload)"), "Anyone", "Applies a scheduled change whose delay has passed, with the exact kind and payload scheduled."],
          [c("cancelChange(bytes32 change_id, …proof)"), "Owner's proof", "Cancels a scheduled change. Never refused because of the caps."],
          [c("cancelRecovery(…proof)"), "Owner's proof", "Cancels a pending recovery. Never refused because of the caps."],
          [c("guardianFreeze(bytes32 salt)"), "Guardian", "Freezes the account and cancels every scheduled change except changes to the guardian."],
          [c("guardianCancelChange(bytes32 change_id, bytes32 salt)"), "Guardian", "Vetoes a scheduled change, except a change to the guardian."],
          [c("initiateRecovery(bytes32 new_nullifier, bytes32 salt)"), "Guardian", "Starts replacing every owner with new_nullifier after the recovery delay."],
          [c("guardianCancelRecovery(bytes32 salt)"), "Guardian", "Withdraws the guardian's own recovery."],
          [c("executeRecovery()"), "Anyone", "Completes a recovery after its delay: cancels scheduled changes, bumps the owner epoch, makes the new nullifier the only owner."],
          [c("initialize(…)"), "Factory, once", "Sets the app id, first owner, verifier, token, rpIdHash, origin, caps, delays, fee recipient and maxFee."],
        ]}
      />
      <p>
        <code>…proof</code> stands for <code>{PROOF_ARGS}</code>. The guardian proves itself by calling from its address
        with the salt on its guardian card.
      </p>

      <H2>Account views</H2>
      <Table
        stack
        head={["View", "Returns"]}
        rows={[
          [c("actionHash(uint8 action_kind, address target, uint256 amount, bytes32 data_hash, uint256 fee, uint64 deadline) → bytes32"), "The WebAuthn challenge the next authorization must sign, at the current nonce."],
          [c("nonce() → uint256"), "The next action's nonce."],
          [c("policy() → (uint256, uint256, uint256, uint64, bool)"), "perTxCap, dailyCap, spentToday, the current UTC day number, allowlistEnabled."],
          [c("protections() → (uint256, bool, bytes32, bool)"), "newPayeeCap, frozen, guardianCommitment (zero when no guardian), paymentSheetRequired."],
          [c("fees() → (address, uint256)"), "feeRecipient, maxFee."],
          [c("pendingChangeIds() → bytes32[]"), "The ids of the scheduled changes still waiting (at most 8)."],
          [c("pendingChange(bytes32 change_id) → (uint8, bytes32, uint64, uint256)"), "changeKind, payloadHash, eta, ownerEpoch; eta is zero for an unknown id."],
          [c("recovery() → (bytes32, uint64)"), "The pending recovery's nullifier and eta; eta is zero when none is pending."],
          [c("isOwner(bytes32 nullifier) → bool"), "Whether the nullifier owns the account in the current owner epoch."],
          [c("ownerCount() → uint256"), "How many owners the account has."],
          [c("ownerEpoch() → uint256"), "Increases with every executed recovery."],
          [c("isRecipientAllowed(address) → bool"), "True when the allowlist is off or the recipient is on it."],
          [c("isKnownRecipient(address) → bool"), "Whether the account has paid the recipient before, so the new-recipient cap no longer applies."],
          [c("config() → (address, address, address, bytes32, uint64, uint64)"), "factory, verifier, usdg, rpIdHash, changeDelay, recoveryDelay."],
          [c("origin() → bytes"), "The only origin whose assertions the account accepts."],
          [c("appId() → bytes32"), "The app this account belongs to."],
          [c("initialized() → bool"), "Whether the account has been initialized."],
        ]}
      />

      <H2>Account events</H2>
      <Table
        stack
        head={["Event", "Emitted when"]}
        rows={[
          [c("Initialized(bytes32 indexed appId, bytes32 indexed ownerNullifier, address factory)"), "The factory sets up the account."],
          [c("Paid(uint256 indexed nonce, address indexed to, uint256 amount, uint256 fee, address indexed submitter)"), "A payment succeeds."],
          [c("ChangeScheduled(bytes32 indexed changeId, uint8 changeKind, bytes payload, uint64 eta)"), "A change is scheduled. The payload is only here; the account stores its hash."],
          [c("ChangeApplied(bytes32 indexed changeId, uint8 changeKind)"), "A scheduled change is applied."],
          [c("ChangeCancelled(bytes32 indexed changeId)"), "A scheduled change is cancelled by an owner, the guardian, a freeze or a recovery."],
          [c("Restricted(bytes32 indexed restrictionId, uint8 changeKind, bytes payload)"), "A tightening change applies at once."],
          [c("GuardianFroze()"), "The guardian freezes the account."],
          [c("RecoveryInitiated(bytes32 indexed newNullifier, uint64 eta)"), "The guardian starts a recovery."],
          [c("RecoveryExecuted(bytes32 indexed newNullifier, uint256 ownerEpoch)"), "A recovery completes."],
          [c("RecoveryCancelled(bytes32 indexed newNullifier)"), "An owner or the guardian cancels a recovery."],
        ]}
      />

      <H2>Factory</H2>
      <Table
        stack
        head={["Function", "What it does"]}
        rows={[
          [c("createAccount(bytes32 app_id, bytes32 nullifier) → address"), "Deploys and initializes the account, or returns it if it exists. Anyone may call it."],
          [c("accountAddress(bytes32 app_id, bytes32 nullifier) → address"), "The account's address, deployed or not."],
          [c("configHash() → bytes32"), "The hash of the configuration every account gets; part of each account's salt."],
          [c("config() → (address, address, address, bytes32, uint256, uint256, uint256, uint64, uint64, address, uint256)"), "implementation, verifier, usdg, rpIdHash, perTxCap, dailyCap, newPayeeCap, changeDelay, recoveryDelay, feeRecipient, maxFee."],
          [c("origin() → bytes"), "The origin every account accepts."],
        ]}
      />
      <p>
        How the address is derived is in <A href="/docs/architecture/contracts#the-factory">The factory</A>. The factory's
        errors are in <A href="/docs/reference/errors#factory-errors">Factory errors</A>.
      </p>

      <H2>Change kinds</H2>
      <p>
        A change is a kind and an ABI-encoded payload; the SDK builds both with <code>changePayload</code>. Every change can be
        scheduled; the ones marked instant can also go through <code>restrict</code>.
      </p>
      <Table
        stack
        head={["Kind", "Name", "Payload", "Instant through restrict"]}
        rows={[
          ["1", "AddOwner", c("bytes32 nullifier"), "No"],
          ["2", "RemoveOwner", c("bytes32 nullifier"), "No; the last owner cannot be removed"],
          ["3", "SetLimits", c("abi.encode(uint256 perTxCap, uint256 dailyCap)"), "When neither cap goes up; maxFee ≤ perTxCap ≤ dailyCap"],
          ["4", "SetRecipient", c("abi.encode(address recipient, bool allowed)"), "When removing a recipient"],
          ["5", "SetAllowlist", c("abi.encode(bool enabled)"), "When enabling"],
          ["6", "SetGuardian", c("bytes32 commitment"), "No. Zero removes the guardian. Any change to it waits the change delay plus the recovery delay, and cancels a pending recovery"],
          ["7", "SetNewPayeeCap", c("abi.encode(uint256 cap)"), "When the cap does not go up"],
          ["8", "Freeze", "empty", "Always, and only through restrict: it cannot be scheduled. It also cancels every scheduled change"],
          ["9", "Unfreeze", "empty", "No"],
          ["10", "SetPaymentSheet", c("abi.encode(bool required)"), "When requiring the sheet"],
        ]}
      />

      <H2>Action kinds</H2>
      <p>Every proof-authorized function signs one action. Its hash is the WebAuthn challenge:</p>
      <Code lang="solidity">{`
actionHash = keccak256(abi.encode(
    ACTION_TYPEHASH, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline))

ACTION_TYPEHASH = keccak256("VeraKeyAction(uint256 chainId,address account,uint256 nonce,uint8 kind,address target,uint256 amount,bytes32 dataHash,uint256 fee,uint64 deadline)")
`}</Code>
      <Table
        stack
        head={["Kind", "Name", "Function", "target, amount", "dataHash"]}
        rows={[
          ["1", "Pay", c("pay"), "the recipient, the amount", "zero"],
          ["2", "ScheduleChange", c("scheduleChange"), "zero", c("keccak256(changeKind ‖ payload)")],
          ["3", "CancelChange", c("cancelChange"), "zero", "the change id"],
          ["4", "CancelRecovery", c("cancelRecovery"), "zero", "the pending recovery's nullifier"],
          ["5", "Restrict", c("restrict"), "zero", c("keccak256(changeKind ‖ payload)")],
        ]}
      />
      <p>
        The SDK computes the same hash with <code>hashAction</code> (<A href="/docs/reference/sdk#action-helpers">Action helpers</A>).
      </p>
    </>
  );
}
