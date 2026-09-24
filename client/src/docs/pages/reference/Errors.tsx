import type { ReactNode } from "react";
import { A, Callout, H2, H3, Table } from "../../components";

const c = (text: string) => <code className="dx-nowrap">{text}</code>;

const ACCOUNT_ERRORS: [string, ReactNode, ReactNode][] = [
  ["AccountFrozen()", "The account is frozen: it makes no payments.", <>Unfreeze with a scheduled change (<code>changePayload.unfreeze()</code>), which waits the change delay.</>],
  ["AlreadyInitialized()", "initialize was called on an account that is already set up, or on the implementation, which locks itself.", "Nothing to do: the factory initializes each account once."],
  ["AlreadyOwner()", "An AddOwner change names a nullifier that is already an owner.", "Nothing to do; that passkey already controls the account."],
  ["CannotVetoGuardianChange()", "The guardian tried to cancel a change to the guardian itself.", "By design: such a change waits the change delay plus the recovery delay instead."],
  ["ChangeNotReady(uint64 eta)", "applyChange came before the change's timelock ended.", <>Apply it at or after <code>eta</code> (Unix seconds).</>],
  ["DailyCapExceeded()", "Today's spending plus this amount and fee is above the daily cap. Days are UTC days.", "Wait for the next UTC day, or raise the cap with a scheduled change."],
  ["DeadlineExpired()", "The authorization's deadline passed before the transaction was mined.", "Approve the action again. The SDK signs deadlines 5 minutes ahead."],
  ["DeadlineTooFar()", "The deadline is more than 10 minutes away.", <>Use a deadline within <code>MAX_DEADLINE_WINDOW</code> (600 seconds).</>],
  ["FeeTooHigh(uint256 maxFee)", <>The signed fee is above the account's <code>maxFee</code>.</>, "Sign a lower fee. A relayer that asks more than maxFee cannot serve this account."],
  ["InvalidAmount()", "The amount is zero, or amount plus fee overflows.", "Pay a positive amount."],
  ["InvalidChange()", "The change kind is unknown or its payload is malformed; or a recovery names a zero or out-of-field nullifier.", <>Build payloads with <code>changePayload</code>.</>],
  ["InvalidClientData(uint8 code)", "The signed client data does not authorize this action at this origin.", <>See <A href="#client-data-error-codes">the codes below</A>.</>],
  ["InvalidConfig()", "initialize got an invalid configuration: an app id or owner nullifier outside the field, a zero address, an empty or over-long origin, a per-payment cap of zero or above the daily cap, or a delay over 30 days.", "Deploy the factory with a valid configuration."],
  ["InvalidProof()", "The verifier rejected the proof for the public inputs the account computed.", "Prove again. Check that the rpId, the app id and the nullifier match this account."],
  ["InvalidRecipient()", "The recipient is the zero address or the account itself.", "Pay another address."],
  ["LastOwner()", "A RemoveOwner change would remove the only owner.", "Add another owner first."],
  ["NewPayeeCapExceeded(uint256 cap)", <>A first payment to a recipient that was never paid and is not allowlisted is above <code>cap</code>.</>, "Send at most cap first, or allowlist the recipient or raise the cap with a scheduled change."],
  ["NoRecovery()", "executeRecovery or a cancel found no pending recovery.", "Nothing to do."],
  ["NotGuardian()", "The caller and salt do not match the stored guardian commitment, or no guardian is set.", "Call from the guardian's address with the salt on its guardian card."],
  ["NotInitialized()", "The contract at this address was never initialized as an account.", <>Create accounts through the factory (<code>createAccount</code>).</>],
  ["NotOwner()", "The nullifier is not an owner in the current owner epoch (a removed passkey, an owner replaced by a recovery, or another app's passkey); or a RemoveOwner change names a non-owner.", "Unlock with a passkey that owns this account."],
  ["NotRestrictive()", "restrict got a change that would loosen the account.", <>Use <code>scheduleChange</code>; only tightening changes skip the timelock.</>],
  ["PaymentSheetRequired()", "The account requires the payment sheet, and the client data is a plain passkey assertion.", "Pay from a browser where the passkey is enrolled for the payment sheet, or drop the requirement with a scheduled change."],
  ["PerTxCapExceeded()", "The amount plus fee is above the per-payment cap.", "Pay less, or raise the cap with a scheduled change."],
  ["RecipientNotAllowed()", "The allowlist is on, and the recipient is not on it.", "Pay an allowed recipient, or allow this one with a scheduled change."],
  ["RecoveryNotReady(uint64 eta)", "executeRecovery came before the recovery delay ended.", <>Execute it at or after <code>eta</code>.</>],
  ["TokenTransferFailed()", "The USDG transfer failed, usually because the balance is below the amount plus the fee.", "Fund the account."],
  ["TooManyPendingChanges()", "8 changes are already scheduled.", "Apply or cancel one first."],
  ["UnknownChange()", "The change id is not pending, or the kind and payload differ from what was scheduled, or it was scheduled before a recovery.", <>Read <code>pendingChangeIds</code> and pass the exact kind and payload that were scheduled.</>],
];

const FACTORY_ERRORS: [string, string][] = [
  ["InvalidConfig()", "The factory was deployed with an invalid configuration."],
  ["InvalidIdentifier()", "createAccount got an app id or nullifier that is not a BN254 field element, or a zero nullifier."],
  ["DeploymentFailed()", "The CREATE2 deployment of the clone failed."],
  ["InitializationFailed()", "The new account's initialize call reverted."],
];

export default function ErrorsPage() {
  return (
    <>
      <p>
        When a call reverts in simulation, the relayer answers 422 and names the contract error in <code>revert</code>, and
        the SDK passes it on as <code>VeraKeyError.revert</code>. Nothing is sent to the chain.
      </p>

      <H2>Account errors</H2>
      <p>
        The custom errors of <code>VeraKeyAccount</code>, as declared in its <code>IVeraKeyAccount</code> interface. The SDK treats
        the ones in <code>POLICY_REVERTS</code> as the <code>policy</code> stage.
      </p>
      <Table
        stack
        head={["Error", "Meaning", "What to do"]}
        rows={ACCOUNT_ERRORS.map(([name, meaning, fix]) => [c(name), meaning, fix])}
      />
      <H3>Factory errors</H3>
      <Table stack head={["Error", "Meaning"]} rows={FACTORY_ERRORS.map(([name, meaning]) => [c(name), meaning])} />

      <H2>Client data error codes</H2>
      <p>
        <code>InvalidClientData(code)</code> says which check of the signed <code>clientDataJSON</code> failed. The account
        compares a byte prefix instead of parsing JSON: see <A href="/docs/architecture/contracts#authorization">Authorization</A>.
      </p>
      <Table
        stack
        head={["Code", "Name", "Meaning"]}
        rows={[
          ["0", "(precompile)", "The SHA-256 precompile call failed."],
          ["1", c("TooLong"), "The client data is longer than 1,024 bytes."],
          ["2", c("NotAnAssertion"), <>It does not start with <code>{'{"type":"webauthn.get","challenge":"'}</code>, or it is a payment-sheet assertion for an action other than a payment.</>],
          ["3", c("ChallengeMismatch"), "The challenge is not this action's hash. Often the nonce moved on between signing and submitting: approve again."],
          ["4", c("OriginMismatch"), "The origin (or, for the payment sheet, the top origin) is not exactly the account's origin."],
          ["5", c("Malformed"), "Unexpected bytes follow the origin, or a payment-sheet field is malformed."],
          ["6", c("CrossOrigin"), <>The client data says <code>"crossOrigin":true</code>: the prompt ran in a cross-origin iframe.</>],
          ["7", c("PaymentMismatch"), "The payment sheet showed another payee or total than the payment."],
          ["8", c("RpIdMismatch"), "The payment sheet's rpId does not hash to the account's rpIdHash."],
        ]}
      />

      <H2>Relayer errors</H2>
      <p>
        The relayer answers <code>{'{ "error": "…", "revert"?: "…" }'}</code> with one of these statuses. See{" "}
        <A href="/docs/build/relayer-api">Relayer API</A>.
      </p>
      <Table
        stack
        head={["Status", "When", "What to do"]}
        rows={[
          ["400", "An unsupported function, arguments that do not match the ABI, an app id or nullifier outside the field, a contract that is not a VeraKey account, or an account of another deployment. /api/rpc answers 400 for a method it does not proxy.", "Fix the request; relay only to accounts of this deployment."],
          ["402", "The signed fee is below the relayer's fee.", <>Sign at least <code>relayer.fee</code> from <code>/api/config</code>.</>],
          ["404", "The account is not deployed.", <>Create it first: <code>POST /api/accounts</code> or <code>ensureAccount</code>.</>],
          ["409", "The faucet already funded this account.", "Nothing to do."],
          ["413", "A bytes argument is larger than 16 KiB.", "Send a real proof and client data."],
          ["422", <>The call reverts in simulation (<code>revert</code> names the error), or it needs more than 2.5M gas.</>, <>See <A href="#account-errors">Account errors</A>.</>],
          ["429", "A rate limit: requests per visitor per minute, requests per account, new accounts per visitor per day, or faucet grants per visitor per day.", "Wait and try again."],
          ["500", "An unexpected relayer error.", "Try again; check the relayer's logs."],
          ["502", "The RPC endpoint could not simulate the call, or is unavailable.", "Try again later."],
          ["503", "The demo faucet is out of USDG.", "Try again later."],
        ]}
      />

      <H2>SDK rejection stages</H2>
      <p>
        Every failed SDK action rejects with a <code>VeraKeyError</code> and emits <code>{'{ status: "rejected", stage, message, revert? }'}</code>.
        The stage says where it failed:
      </p>
      <Table
        stack
        head={["Stage", "When", "What to do"]}
        rows={[
          [c("funds"), "The account cannot pay the relayer fee. Checked before the passkey prompt.", "Fund the account."],
          [c("authentication"), "The passkey prompt was cancelled or timed out, or the payment sheet was closed.", "Try again. Nothing was sent."],
          [c("device"), "The passkey provider does not support PRF, the passkey is not ES256, or the authenticator returned authenticator data that is not 37 bytes.", "Use a passkey from iCloud Keychain or Google Password Manager."],
          [c("proof"), "Proving failed, for example because the assertion does not satisfy the circuit.", "Try again; check that the prover and its CRS loaded."],
          [c("policy"), <>The account refused a valid proof; <code>revert</code> names the error. The SDK also refuses early with <code>FeeTooHigh</code> or <code>PaymentSheetRequired</code> when it can tell in advance.</>, <>See <A href="#account-errors">Account errors</A>.</>],
          [c("relay"), "The relayer refused or could not be reached, simulation reverted with an error outside POLICY_REVERTS (such as TokenTransferFailed), or the transaction reverted on-chain.", <>See <A href="#relayer-errors">Relayer errors</A>.</>],
        ]}
      />
      <Callout kind="tip">
        The <A href="/docs/guides/faq">FAQ</A> explains the messages people see most in the app.
      </Callout>
    </>
  );
}
