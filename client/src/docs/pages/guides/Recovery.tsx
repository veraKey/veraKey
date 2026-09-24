import { A, Callout, Code, H2, Table } from "../../components";

export default function RecoveryGuide() {
  return (
    <>
      <Callout kind="tip" title="Most people never need this">
        Synced passkeys (iCloud Keychain, Google Password Manager) already survive a lost device: sign in to your
        provider on a new device and unlock VeraKey there. Recovery is for losing the passkey itself.
      </Callout>

      <H2>Add a backup passkey</H2>
      <p>
        On the Recovery page, select <strong>Create a backup passkey and add it</strong>, or add a passkey you already
        created in this browser. The backup becomes a second owner of the account. It has its own nullifier, so the chain
        cannot tell that both passkeys belong to the same person. Adding an owner is a loosening change, so it waits out
        the change delay.
      </p>
      <Callout kind="warning" title="Current limitation">
        The app and the SDK open the account derived from the passkey you unlock with. A backup passkey, or the new
        passkey after a recovery, derives a different address, so for now it cannot operate the original account from
        the app. The account itself accepts it; using it needs the account's address, which the SDK does not accept yet.
      </Callout>

      <H2>Name a guardian</H2>
      <p>
        A guardian is someone you trust to act if you lose your passkey: a friend's wallet, a multisig or another
        account. Enter the guardian's address and select <strong>Set</strong>. The account never stores the address; it
        stores a salted hash of it:
      </p>
      <Code lang="solidity" title="Guardian commitment">{`
keccak256(abi.encode(GUARDIAN_TYPEHASH, account, guardian, salt))
`}</Code>
      <p>
        The salt is derived from your passkey's PRF secret, separately for each app. So nobody can tell who your guardian
        is until it acts, and one guardian used by several of your apps leaves nothing on-chain that links them.
      </p>

      <H2>The guardian card</H2>
      <p>
        After you set a guardian, the app shows a guardian card. Download it and give it to the guardian only: a guardian
        needs the salt to act. The card is a JSON file with:
      </p>
      <ul>
        <li><code>chainId</code>, <code>account</code> and <code>guardian</code>;</li>
        <li><code>salt</code> and <code>commitment</code>;</li>
        <li><code>howToAct</code>: the functions the guardian can call, from its own address.</li>
      </ul>
      <p>
        Lost the card? Enter the guardian's address and select <strong>Card</strong> to rebuild it from your passkey.
      </p>

      <H2>Recover an account</H2>
      <p>When you have lost your passkey and have no backup:</p>
      <ol>
        <li>Create a new passkey and tell your guardian its nullifier in this app. The Accounts page shows it.</li>
        <li>The guardian calls <code>initiateRecovery(newNullifier, salt)</code> on your account.</li>
        <li>
          The recovery waits out the recovery delay. The Recovery page shows <strong>Recovery in progress</strong> to any
          owner, with <strong>Cancel recovery</strong>, in case it was not you.
        </li>
        <li>
          After the delay, anyone may complete it (<strong>Complete recovery</strong>). The new passkey becomes the only
          owner. The old owners, and every change they scheduled, stop counting.
        </li>
      </ol>

      <H2>What a guardian can and cannot do</H2>
      <Table
        head={["A guardian can", "A guardian cannot"]}
        rows={[
          ["Freeze the account at once. This also cancels scheduled changes, except changes to the guardian.", "Move funds, or make payments."],
          ["Veto any scheduled change, except a change to the guardian.", "Block its own replacement or removal. That change waits the change delay plus the recovery delay."],
          ["Start a recovery that replaces every owner after the recovery delay.", "Finish a recovery that an owner cancelled."],
        ]}
      />
      <p>
        So a guardian can delay you, but never hold the account hostage. After a recovery, name your guardian again: the
        old card cannot be rebuilt, because its salt came from the lost passkey. See{" "}
        <A href="/docs/security#invariants">the invariants</A> for the exact rules.
      </p>
    </>
  );
}
