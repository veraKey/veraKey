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
        account. Choose someone you would trust with the account itself: a guardian can take it over through a recovery
        that nobody cancels (see below). Enter the guardian's address and select <strong>Set</strong>. The account never
        stores the address; it stores a salted hash of it:
      </p>
      <Code lang="solidity" title="Guardian commitment">{`
keccak256(abi.encode(GUARDIAN_TYPEHASH, account, guardian, salt))
`}</Code>
      <p>
        The salt is derived from your passkey's PRF secret, separately for each app. So nobody can tell who your guardian
        is until it acts, and one guardian used by several of your apps leaves nothing on-chain that links them.
      </p>
      <Callout kind="warning" title="Set only schedules the guardian">
        Naming a guardian is a loosening change, so it waits the change delay (2 minutes on Arbitrum Sepolia; replacing a
        guardian waits the recovery delay too). When the countdown ends, select <strong>Apply</strong> under{" "}
        <strong>Scheduled changes</strong> on the Policy page. Until the change is applied, the guardian cannot act.
      </Callout>

      <H2>The guardian card</H2>
      <p>
        After you select <strong>Set</strong>, the app shows a guardian card. Download it and give it to the guardian only:
        a guardian needs the salt to act, once the change is applied. The card is a JSON file with:
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
        <li>
          Create a new passkey and give your guardian its nullifier in this app: the full value, <code>0x</code> followed by
          64 hex digits. The Accounts page shows it shortened; hold the pointer over it to read the full value, because
          the app cannot copy it yet. If it shows fewer than 64 digits, add zeros after <code>0x</code>. A developer gets it
          with <code>toFieldHex(await vera.nullifier(appId))</code>.
        </li>
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
      <Callout kind="warning" title="What the app cannot do yet">
        After a recovery the new passkey owns the original account on-chain, but the app cannot yet operate it: the app
        opens the account derived from the passkey you unlock with, which is a different address. A recovery also does
        not unfreeze a frozen account; unfreezing is a separate scheduled change.
      </Callout>

      <H2>What a guardian can and cannot do</H2>
      <Table
        head={["A guardian can", "A guardian cannot"]}
        rows={[
          ["Freeze the account at once. This also cancels scheduled changes, except changes to the guardian.", "Pay or move funds directly. It can take control only through a recovery that nobody cancels."],
          ["Veto any scheduled change, except a change to the guardian.", "Block its own replacement or removal. That change waits the change delay plus the recovery delay."],
          ["Start a recovery that replaces every owner after the recovery delay. If nobody cancels it in time, whoever holds the new passkey controls the account and its funds.", "Finish a recovery that an owner cancelled."],
        ]}
      />
      <p>
        So a guardian can delay you, and it can take the account over only through a recovery that nobody cancels within
        the recovery delay: 5 minutes on Arbitrum Sepolia, a demo value. Nothing notifies you; the Recovery page shows{" "}
        <strong>Recovery in progress</strong>. After a recovery, name your guardian again: the old card cannot be rebuilt,
        because its salt came from the lost passkey. See{" "}
        <A href="/docs/security#invariants">the invariants</A> for the exact rules.
      </p>
    </>
  );
}
