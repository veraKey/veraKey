import { A, Callout, Code, H2, Table } from "../../components";
import { SDK_NPM_URL } from "../../site";

export default function SdkGuidePage() {
  return (
    <>
      <H2>Modules</H2>
      <p>
        Install <A href={SDK_NPM_URL}><code>@verakey/sdk</code></A> from npm with <code>npm install @verakey/sdk</code>,
        then import from subpaths, so bundlers load only what you use. The prover and link prover pull in bb.js and its
        WASM: load them lazily.
      </p>
      <Table
        head={["Import", "What it gives you"]}
        rows={[
          [<code key="1">@verakey/sdk/client</code>, "VeraKeyClient, VeraKeyError, POLICY_REVERTS and the AccountState, ProofState, PendingChangeInfo, GuardianCard and TrackedChange types"],
          [<code key="14">@verakey/sdk/connect</code>, "VeraKeyConnect, VeraKeyConnectError: Sign in with VeraKey in a site's pages"],
          [<code key="15">@verakey/sdk/signin</code>, "verifySignIn, verifyPayment, findPayment, appIdFromOrigin, accountAddressOf: for a site's server"],
          [<code key="17">@verakey/sdk/server</code>, "createVeraKeyServer, toExpress, memoryStore: the integration kit's routes, session cookie and payment checks, on your server"],
          [<code key="18">@verakey/sdk/react</code>, "VeraKeyProvider, useVeraKey, SignInWithVeraKey: the integration kit for React (React is an optional peer dependency)"],
          [<code key="19">@verakey/sdk/session</code>, "VeraKeySession, VeraKeySessionError: the integration kit in any page, without a framework"],
          [<code key="20">@verakey/sdk/deployments</code>, "ARBITRUM_SEPOLIA and the VeraKeyDeployment type"],
          [<code key="2">@verakey/sdk/action</code>, "hashAction, encodeAction, changePayload, changeDataHash, guardianCommitment, ZERO_HASH"],
          [<code key="3">@verakey/sdk/constants</code>, "ActionKind, ChangeKind, ACTION_TYPEHASH, GUARDIAN_TYPEHASH, MAX_DEADLINE_WINDOW, USDG_DECIMALS"],
          [<code key="4">@verakey/sdk/nullifier</code>, "appIdFromName, computeNullifier"],
          [<code key="5">@verakey/sdk/webauthn</code>, "createPasskey, getAssertion, getSpcAssertion, spcAvailability, formatSpcTotal and helpers"],
          [<code key="6">@verakey/sdk/prover</code>, "VeraKeyProver: the authorization circuit's prover (bb.js)"],
          [<code key="7">@verakey/sdk/link-prover</code>, "LinkProver: the consent-to-link circuit's prover and verifier"],
          [<code key="8">@verakey/sdk/disclosure</code>, "linkDisclosureChallenge, verifyDisclosure and the disclosure types"],
          [<code key="9">@verakey/sdk/validator</code>, "Helpers for the ERC-7579 VeraKeyValidator module"],
          [<code key="16">@verakey/sdk/kernel</code>, "toVeraKeyKernelValidator: a VeraKey passkey as a ZeroDev Kernel account's validator"],
          [<code key="10">@verakey/sdk/relayer</code>, "RelayerClient, RelayerError"],
          [<code key="11">@verakey/sdk/store</code>, "LocalPasskeyStore, MemoryPasskeyStore"],
          [<code key="12">@verakey/sdk/abi</code>, "veraKeyAccountAbi, veraKeyFactoryAbi, honkVerifierAbi, erc20Abi"],
          [<code key="13">@verakey/sdk/privacy</code>, "countPublicKeyOccurrences: check calldata for a public key"],
          [<code key="21">@verakey/sdk/bytes</code>, "concatBytes, toFieldHex, limbs, sha256, base64UrlEncode, base64UrlDecode and other byte helpers"],
          [<code key="22">@verakey/sdk/errors</code>, "ProofGenerationError"],
        ]}
      />

      <H2>Configuration</H2>
      <p><code>new VeraKeyClient(config)</code> takes:</p>
      <Table
        stack
        head={["Field", "Type", "Meaning"]}
        rows={[
          [<code key="1">rpId</code>, "string", "The WebAuthn relying party id, the same for every app (verakey.xyz on Arbitrum Sepolia). From /api/config."],
          [<code key="2">rpName</code>, "string?", "Shown when a passkey is created. Default \"VeraKey\"."],
          [<code key="3">chainId</code>, "number", "The chain id."],
          [<code key="4">rpcUrl</code>, "string", "A JSON-RPC URL for reads, usually the relayer's /api/rpc."],
          [<code key="5">factory</code>, "Address", "The VeraKeyFactory."],
          [<code key="6">usdg</code>, "Address", "The USDG token."],
          [<code key="14">accountImplementation</code>, "Address?", "The account implementation, from /api/config. With configHash, proveSignIn computes account addresses offline."],
          [<code key="15">configHash</code>, "Hex?", "The factory's configuration hash, from /api/config. proveSignIn needs it, with accountImplementation."],
          [<code key="7">rpIdHash</code>, "Hex", "sha256 of the rpId, as the accounts store it."],
          [<code key="8">relayerUrl</code>, "string", "The relayer API base URL, e.g. \"/api\"."],
          [<code key="9">relayerFee</code>, "bigint", "The fee the relayer expects, in USDG base units. It is signed into every action."],
          [<code key="10">appIds</code>, "bigint[]", "The app ids this client manages."],
          [<code key="11">loadProver</code>, "() => Promise<VeraKeyProver>", "Loads the prover lazily; bb.js and the CRS are several megabytes."],
          [<code key="12">store</code>, "PasskeyStore?", "Where passkey references are kept. Default: LocalPasskeyStore (localStorage)."],
          [<code key="13">paymentInstrument</code>, "{ displayName, icon }?", "Shown in the payment sheet. Required to use it."],
        ]}
      />

      <H2>Sessions</H2>
      <p>
        A session is an unlocked passkey, and it holds the PRF secret in memory. <code>register</code> and{" "}
        <code>unlock</code> return that <code>Session</code> to your code, so treat it like a key: keep it in memory, never
        persist, log or send it, and call <code>vera.lock()</code> when you are done. With the PRF secret and the public key,
        anyone can link your user's accounts across apps.
      </p>
      <ul>
        <li>
          <code>register(label, {"{ userName?, activate?, payment? }"})</code> creates a passkey and returns{" "}
          <code>{"{ passkey, session }"}</code>. <code>session</code> is <code>null</code> when the provider did not return PRF
          at creation; call <code>unlock()</code> then. <code>payment: true</code> enrolls it for the{" "}
          <A href="/docs/build/payment-sheet">payment sheet</A>.
        </li>
        <li><code>unlock(passkey?)</code> runs one assertion with PRF and makes it the current session. On a new device it recovers the public key from the assertion, and asks for a second assertion when no account of <code>appIds</code> tells the two candidate keys apart. A passkey this browser knows must return the same PRF secret as before, or the unlock is refused.</li>
        <li><code>authenticate(passkey?)</code> does the same without switching the current session, e.g. for a backup passkey.</li>
        <li><code>lock()</code> forgets the session and its PRF secret. <code>session</code> returns the current one, or <code>null</code>.</li>
      </ul>
      <p>
        The passkey store keeps the credential id, the public key, a label, when it was added, whether it is enrolled for
        the payment sheet, and a one-way check of its PRF secret (in <code>localStorage</code> under{" "}
        <code>verakey.passkeys.v1</code>); never the secret itself.
      </p>

      <H2>Accounts</H2>
      <p>
        <code>account(appId)</code> returns the current session's account in that app, whether it is deployed or not:
      </p>
      <Table
        head={["Field", "Meaning"]}
        rows={[
          [<code key="1">address, deployed, balance, nonce</code>, "The account, whether it exists yet, its USDG balance and next nonce."],
          [<code key="2">appId, nullifier</code>, "The app and this passkey's owner id in it."],
          [<code key="3">perTxCap, dailyCap, spentToday</code>, "Caps and today's spending, in USDG base units."],
          [<code key="4">newPayeeCap, allowlistEnabled, frozen, paymentSheetRequired</code>, "The other protections."],
          [<code key="5">ownerCount, guardianCommitment, recovery</code>, "Owners, the guardian's commitment (zero hash when none) and a pending recovery."],
          [<code key="6">changeDelay, recoveryDelay</code>, "The timelocks, in seconds."],
          [<code key="7">feeRecipient, maxFee</code>, "Where fees go, and the largest fee an action may carry."],
          [<code key="8">pendingChanges</code>, "Scheduled changes still waiting, read from the chain."],
        ]}
      />
      <p>
        Other helpers: <code>nullifier(appId)</code>, <code>predictAddress(appId, nullifier)</code>,{" "}
        <code>ensureAccount(appId)</code> (deploys through the relayer, idempotent) and{" "}
        <code>requestDemoFunds(address)</code> (testnets).
      </p>
      <Callout kind="warning" title="Accounts follow the unlocked passkey">
        Every method that takes an app id, such as <code>pay</code> or <code>account</code>, derives the account address
        from the session's nullifier, except <code>predictAddress</code>, which derives it from the nullifier you pass.
        A backup owner, or the new owner after a recovery, derives a different address, so the SDK cannot yet approve
        actions on an account it did not derive. Only the methods that need no passkey, such as{" "}
        <code>executeRecovery</code>, take an account address.
      </Callout>

      <H2>The proof state machine</H2>
      <p>
        Every action method except <code>applyChange</code> and <code>executeRecovery</code> takes a listener. Actions that
        send a transaction report authenticating, proving, relaying, confirming and verified, in that order.{" "}
        <code>createDisclosure</code> and <code>proveSignIn</code> report authenticating, proving and then idle once the
        proof is ready. Any of them reports rejected when it fails.
      </p>
      <Code lang="ts" title="ProofState">{`
type ProofState =
  | { status: "idle" }
  | { status: "authenticating" }
  | { status: "proving"; startedAt: number }
  | { status: "relaying"; provingMs: number }
  | { status: "confirming"; provingMs: number; hash: Hex }
  | { status: "verified"; provingMs: number; hash: Hex; receipt: TransactionReceipt; publicKeyOccurrences: number }
  | { status: "rejected"; stage: RejectionStage; message: string; revert?: string };
`}</Code>
      <p>
        <code>publicKeyOccurrences</code> counts how often the passkey's public key appears in the transaction's calldata.
        It is 0; show it to your users.
      </p>

      <H2>Errors</H2>
      <p>
        Action failures reject with a <code>VeraKeyError</code>. <code>executeRecovery</code>, <code>ensureAccount</code>{" "}
        and <code>requestDemoFunds</code> call the relayer directly and reject with its <code>RelayerError</code>.{" "}
        <code>unlock</code> and <code>authenticate</code> reject with a <code>VeraKeyError</code> at the{" "}
        <code>authentication</code> or <code>device</code> stage, except on a new device: there, a cancelled second prompt
        rejects with the browser's <code>DOMException</code>, and a failed prover load or chain read with its own error.
      </p>
      <Table
        head={["stage", "Meaning"]}
        rows={[
          [<code key="1">policy</code>, "The account's policy refused the action; revert holds the contract error, e.g. NewPayeeCapExceeded. The SDK also refuses early, before the passkey prompt, with FeeTooHigh or PaymentSheetRequired when it can tell in advance. createDisclosure also refuses the same app id twice at this stage, with no revert."],
          [<code key="2">funds</code>, "The account cannot cover the relayer fee. Checked before the passkey prompt."],
          [<code key="3">authentication</code>, "The user cancelled, the prompt timed out, or the payment sheet was closed."],
          [<code key="4">device</code>, "The passkey has no PRF, or the authenticator returned unexpected data."],
          [<code key="5">proof</code>, "Proving failed."],
          [<code key="6">relay</code>, "The relayer refused or failed, or the transaction reverted. A payment whose amount plus fee is more than the balance lands here, with the revert TokenTransferFailed."],
        ]}
      />
      <p>
        <code>POLICY_REVERTS</code> lists the contract errors that map to <code>policy</code>. The{" "}
        <A href="/docs/reference/errors">errors reference</A> explains each one.
      </p>

      <H2>Proving performance</H2>
      <ul>
        <li>
          Proving takes about 2 seconds (1.85 s median) in desktop Chrome with 8 threads; browsers that prove on one
          thread take a few seconds longer. Proving on iPhone has not been measured yet.
        </li>
        <li>Threads need cross-origin isolation (COOP and COEP headers); without it, bb.js proves on one thread.</li>
        <li>
          Pass <code>srsSize: 2 ** 17</code>: the circuit needs 2^16 points, but bb.js 5.2.0 reads the CRS in 4 MiB chunks,
          so 2^17 is the smallest size that works. The two CRS files are then 4 MiB each. Without it, bb.js loads 2^19
          points (2^18 on iOS), a larger download.
        </li>
        <li>Call <code>vera.prover()</code> early, for example after unlocking, so the first approval does not wait for the download.</li>
      </ul>
    </>
  );
}
