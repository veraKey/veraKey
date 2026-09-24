import { A, Callout, H2, Step, Steps, Table } from "../../components";

export default function CreateAccountGuide() {
  return (
    <>
      <H2>What you need</H2>
      <p>A passkey provider that supports the WebAuthn PRF extension, and a browser that can use it:</p>
      <Table
        head={["Provider", "Where it works"]}
        rows={[
          ["iCloud Keychain", "iOS 18.4 or later and macOS 15.4 or later, in Safari or Chrome"],
          ["Google Password Manager", "Chrome"],
        ]}
      />
      <p>
        PRF lets your passkey return a secret that keeps your accounts unlinkable. VeraKey refuses to create accounts
        with a passkey that does not support it, because without PRF your public key alone would identify you in every
        app. In Chrome on macOS, Windows and Android, the passkey can also be enrolled for the browser's{" "}
        <A href="/docs/guides/pay#confirm-in-the-payment-sheet">payment sheet</A>.
      </p>
      <p>Before you start, the app checks your browser and shows the result of each check:</p>
      <ul>
        <li><strong>Passkeys (WebAuthn):</strong> Face ID, Touch ID, Windows Hello or a security key.</li>
        <li><strong>PRF extension:</strong> supported, or checked on first use.</li>
        <li><strong>Secure context:</strong> passkeys only work over HTTPS or on localhost.</li>
        <li><strong>Origin:</strong> your accounts are bound on-chain to this exact site.</li>
        <li><strong>Multi-threaded proving:</strong> cross-origin isolation lets the prover use every CPU core.</li>
      </ul>

      <H2>Create your passkey</H2>
      <Steps>
        <Step title="Open the app">
          <p>
            Go to <A href="https://verakey.mdloglabs.org/app">verakey.mdloglabs.org/app</A>. The app runs on Arbitrum
            Sepolia, a test network: nothing you do there uses real money.
          </p>
        </Step>
        <Step title="Create passkey">
          <p>
            Select <strong>Create passkey</strong>. Your device asks twice: once to create the passkey, and once to
            unlock it. The second prompt returns the PRF secret that keeps your accounts unlinkable.
          </p>
        </Step>
        <Step title="See your accounts">
          <p>
            The Accounts page opens with your accounts. Nothing was sent to a server: your accounts are derived from the
            passkey in your browser.
          </p>
        </Step>
      </Steps>

      <H2>Unlock on another device</H2>
      <p>
        Your passkey provider syncs the passkey to your other devices. On a new device, open the app and select{" "}
        <strong>I already have a VeraKey passkey on another device</strong>, or <strong>Unlock with passkey</strong>. Your
        accounts are derived again on that device: they are the same accounts, with the same addresses.
      </p>
      <p>
        Unlocking asks your passkey for its PRF secret once per session. The secret stays in the browser's memory and is
        forgotten when you lock the app or close the tab. Select <strong>Lock</strong> in the top bar to end a session.
      </p>

      <H2>One account per app</H2>
      <p>
        Each app gets its own account, owned by its own nullifier. The demo's main app is <strong>Pay</strong>. The
        Accounts page also shows the account the same passkey gets in a second app, <strong>Shop</strong>: a different
        address and a different nullifier, with nothing on-chain that connects them.
      </p>
      <p>
        An account's address is known before the account exists, because the factory derives it from the app id, your
        nullifier and the deployment's configuration. You can receive USDG at that address right away.
      </p>

      <H2>When an account is deployed</H2>
      <p>
        An account is deployed the first time it is needed: when you select <strong>Deploy</strong>, ask for{" "}
        <strong>Demo USDG</strong>, or approve your first action. The relayer deploys it and pays the gas. The card shows{" "}
        <strong>Deployed</strong> or <strong>Not deployed</strong>.
      </p>
      <Callout kind="tip">
        Next: <A href="/docs/guides/fund">fund the account</A>, then <A href="/docs/guides/pay">make a payment</A>.
      </Callout>
    </>
  );
}
