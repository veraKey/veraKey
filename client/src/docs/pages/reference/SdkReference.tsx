import type { ReactNode } from "react";
import { A, Code, H2, H3, Table } from "../../components";
import { SDK_NPM_URL } from "../../site";

const c = (text: string) => <code>{text}</code>;
/** A name that must not break mid-word. */
const n = (text: string) => <code className="dx-nowrap">{text}</code>;
const methods = (rows: [string, string, ReactNode][]) => rows.map(([name, signature, what]) => [n(name), c(signature), what]);

export default function SdkReferencePage() {
  return (
    <>
      <p>
        Everything below is exported from <A href={SDK_NPM_URL}><code>@verakey/sdk</code></A>, except the React kit (only
        from <code>@verakey/sdk/react</code>) and <code>LinkProver</code> (only from <code>@verakey/sdk/link-prover</code>);
        each module is also
        importable on its own, for example <code>@verakey/sdk/validator</code>. The{" "}
        <A href="/docs/build/sdk">SDK guide</A> shows how the pieces fit together.
      </p>

      <H2>VeraKeyClient</H2>
      <Code lang="ts">{`
import { VeraKeyClient } from "@verakey/sdk";

const vera = new VeraKeyClient(config); // config: VeraKeyConfig
`}</Code>
      <H3>VeraKeyConfig</H3>
      <Table
        stack
        head={["Field", "Type", "Meaning"]}
        rows={[
          [n("rpId"), c("string"), "The WebAuthn relying party id, the same for every app."],
          [n("rpName"), c("string?"), 'Shown when a passkey is created (default "VeraKey").'],
          [n("chainId"), c("number"), "The chain the accounts live on."],
          [n("rpcUrl"), c("string"), "A JSON-RPC endpoint for reads (the relayer serves /api/rpc)."],
          [n("factory"), c("Address"), "The VeraKeyFactory."],
          [n("usdg"), c("Address"), "The USDG token."],
          [n("accountImplementation"), c("Address?"), "The account implementation, from /api/config. With configHash, proveSignIn computes account addresses offline."],
          [n("configHash"), c("Hex?"), "The factory's configuration hash, from /api/config. proveSignIn needs it, with accountImplementation."],
          [n("rpIdHash"), c("Hex"), "sha256 of the rpId, as the accounts store it."],
          [n("relayerUrl"), c("string"), 'Base URL of the relayer API, e.g. "/api".'],
          [n("relayerFee"), c("bigint"), "The relayer fee in USDG base units; it is signed into every action."],
          [n("appIds"), c("bigint[]"), "The app ids this client manages; used to recognize a passkey on a new device."],
          [n("loadProver"), c("() => Promise<VeraKeyProver>"), "Loads the prover lazily: bb.js and the CRS are several megabytes."],
          [n("store"), c("PasskeyStore?"), "Where passkey ids, public keys and PRF checks are kept (default LocalPasskeyStore)."],
          [n("paymentInstrument"), c("{ displayName: string; icon: string }?"), "Shown in the browser's payment sheet; the sheet needs it."],
        ]}
      />
      <H3>Passkeys and sessions</H3>
      <Table
        stack
        head={["Method", "Signature", "What it does"]}
        rows={methods([
          ["VeraKeyClient.browserSupportsPrf", "static (): Promise<boolean | undefined>", "Whether the browser reports PRF support; undefined when it cannot tell."],
          ["register", "(label: string, options?: { userName?: string; activate?: boolean; payment?: boolean }): Promise<{ passkey: StoredPasskey; session: Session | null }>", "Creates a passkey, optionally enrolled for the payment sheet. Returns a session when PRF was evaluated at creation; activate: false keeps the current session (for a backup passkey)."],
          ["unlock", "(passkey?: StoredPasskey): Promise<Session>", "One user-verified assertion that evaluates PRF. On a new device, the public key is recovered from the assertion, with a second assertion when no account of appIds tells the two candidate keys apart. A passkey this browser knows must return the same PRF secret as before, or unlock rejects at the device stage (PRF_SECRET_CHANGED)."],
          ["authenticate", "(passkey?: StoredPasskey): Promise<Session>", "The unlock ceremony without switching the active session, e.g. to learn a backup passkey's nullifier."],
          ["lock", "(): void", "Forgets the session and its PRF secret."],
          ["session", "get session(): Session | null", "The active session."],
          ["VeraKeyClient.shortCredentialId", "static (passkey: StoredPasskey): string", "A short label for UI, never used for security decisions."],
          ["VeraKeyClient.credentialIdOf", "static (bytes: Uint8Array): string", "A credential id as base64url."],
        ])}
      />
      <H3>Accounts</H3>
      <Table
        stack
        head={["Method", "Signature", "What it does"]}
        rows={methods([
          ["nullifier", "(appId: bigint, session?: Session): Promise<bigint>", "This passkey's owner id in appId."],
          ["predictAddress", "(appId: bigint, nullifier: bigint): Promise<Address>", "The account's address, deployed or not."],
          ["account", "(appId: bigint): Promise<AccountState>", "Reads the account's balance, policy, protections, scheduled changes and recovery."],
          ["ensureAccount", "(appId: bigint): Promise<Address>", "Deploys the account through the relayer; does nothing if it exists."],
          ["requestDemoFunds", "(account: Address): Promise<void>", "Asks the relayer's faucet for demo USDG (testnets)."],
          ["pendingChanges", "(account: Address): Promise<PendingChangeInfo[]>", "The scheduled changes still waiting, earliest eta first."],
          ["scheduledPayload", "(account: Address, changeId: Hex, lookbackBlocks = 100_000n): Promise<Hex | null>", "Best effort: a change's payload from its ChangeScheduled event; null when not found."],
          ["isPending", "(account: Address, changeId: Hex): Promise<boolean>", "True while the change is scheduled and not applied or cancelled."],
        ])}
      />
      <H3>Actions</H3>
      <p>
        Each action proves on this device and submits through the relayer. <code>emit</code> is optional and receives every{" "}
        <A href="#types">ProofState</A>; a failure rejects with a <code>VeraKeyError</code>. <code>authorize</code>, the
        lower-level call, emits no <code>rejected</code> state and can reject with the RPC's own error.{" "}
        <code>applyChange</code> and <code>executeRecovery</code> need no passkey and take no listener;{" "}
        <code>executeRecovery</code> rejects with the relayer's <code>RelayerError</code>, and a network failure in either
        rejects with the underlying error.
      </p>
      <Table
        stack
        head={["Method", "Signature", "What it does"]}
        rows={methods([
          ["pay", "(appId: bigint, to: Address, amount: bigint, emit?, options?: { secureConfirmation?: boolean }): Promise<TransactionReceipt>", "Pays amount USDG. With secureConfirmation, an enrolled passkey confirms in the payment sheet; an account that requires the sheet always uses it."],
          ["scheduleChange", "(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit?): Promise<TrackedChange>", "Schedules a timelocked change."],
          ["restrict", "(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit?): Promise<{ account: Address; restrictionId: Hex }>", "Applies a tightening change at once; the account refuses anything else (NotRestrictive)."],
          ["freeze", "(appId: bigint, emit?): Promise<{ account: Address; restrictionId: Hex }>", "restrict with a freeze: stops every payment and cancels the scheduled changes."],
          ["cancelChange", "(appId: bigint, changeId: Hex, emit?): Promise<TransactionReceipt>", "Cancels a scheduled change."],
          ["applyChange", "(account: Address, change: TrackedChange): Promise<TransactionReceipt>", "Applies a change whose delay has passed. Needs no passkey."],
          ["cancelRecovery", "(appId: bigint, pendingNullifier: Hex, emit?): Promise<TransactionReceipt>", "Cancels a pending guardian recovery."],
          ["executeRecovery", "(account: Address): Promise<TransactionReceipt>", "Completes a recovery after its delay. Needs no passkey."],
          ["authorize", "(appId: bigint, action: { kind: number; target: Address; amount: bigint; dataHash: Hex }, emit?, options?: { secureConfirmation?: boolean })", "Lower level: signs and proves one action, and returns account, nullifier, fee, deadline, actionHash, clientDataJSON, proof, provingMs and confirmedBy, without submitting."],
        ])}
      />
      <H3>Payment sheet, guardians and disclosures</H3>
      <Table
        stack
        head={["Method", "Signature", "What it does"]}
        rows={methods([
          ["canConfirmPayments", "(session?: Session | null): Promise<boolean>", "Whether this passkey is enrolled for the payment sheet in this browser, the client has a paymentInstrument, and the browser can show the sheet."],
          ["guardianSalt", "(appId: bigint, guardian: Address, session?: Session): Promise<Hex>", "The salt that hides the guardian in this app's account, derived from the PRF secret."],
          ["guardianCard", "(appId: bigint, guardian: Address): Promise<GuardianCard>", "The card to give the guardian, with the commitment to schedule."],
          ["createDisclosure", "(request: { appIdA: bigint; appIdB: bigint; audience: string; nonce?: Hex; ttlSeconds?: number; labels?: { appA?: string; appB?: string } }, emit?): Promise<DisclosurePackage>", "Proves to audience that this passkey owns both apps' accounts. Valid for ttlSeconds (default one day). Nothing is sent anywhere."],
        ])}
      />
      <H3>Properties and lower-level classes</H3>
      <ul>
        <li><code>vera.config</code>, <code>vera.publicClient</code> (a viem public client), <code>vera.relayer</code> (a <code>RelayerClient</code>) and <code>vera.store</code> (a <code>PasskeyStore</code>).</li>
        <li><code>vera.prover(): Promise&lt;VeraKeyProver&gt;</code> and <code>vera.linkProver(): Promise&lt;LinkProver&gt;</code> load each prover once; the link prover shares the Barretenberg instance.</li>
        <li>
          <code>VeraKeyProver.create(options?)</code>, then <code>prove(input: WitnessInput): Promise&lt;VeraKeyProof&gt;</code>,{" "}
          <code>verify(proof)</code> and <code>destroy()</code>. A proof carries the six public inputs in circuit order and{" "}
          <code>provingMs</code>.
        </li>
        <li>
          <code>new RelayerClient(baseUrl)</code> with <code>createAccount(appId, nullifier)</code>,{" "}
          <code>relay(account, functionName, args)</code> and <code>faucet(account)</code>. Failures throw{" "}
          <code>RelayerError</code> with <code>status</code> and <code>revert</code>. While another transaction for the
          same account is on its way (409), <code>relay</code> asks again every second, for up to ten seconds.
        </li>
      </ul>

      <H2>Types</H2>
      <Code lang="ts" title="Account state">{`
interface AccountState {
  appId: bigint;
  nullifier: bigint;
  address: Address;
  deployed: boolean;
  balance: bigint;
  nonce: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  spentToday: bigint;
  allowlistEnabled: boolean;
  newPayeeCap: bigint;            // largest first payment to a new recipient
  frozen: boolean;
  ownerCount: bigint;
  guardianCommitment: Hex;        // the zero hash when no guardian is set
  paymentSheetRequired: boolean;
  feeRecipient: Address;
  maxFee: bigint;
  pendingChanges: PendingChangeInfo[];
  recovery: { nullifier: Hex; eta: bigint } | null;
  changeDelay: bigint;
  recoveryDelay: bigint;
}

interface PendingChangeInfo { changeId: Hex; kind: ChangeKind; payloadHash: Hex; eta: number }
interface TrackedChange { account: Address; changeId: Hex; kind: ChangeKind; payload: Hex; eta: number }
interface GuardianCard { chainId: number; account: Address; guardian: Address; salt: Hex; commitment: Hex }
`}</Code>
      <Code lang="ts" title="Progress and errors">{`
type ProofState =
  | { status: "idle" }
  | { status: "authenticating" }
  | { status: "proving"; startedAt: number }
  | { status: "relaying"; provingMs: number }
  | { status: "confirming"; provingMs: number; hash: Hex }
  | { status: "verified"; provingMs: number; hash: Hex; receipt: TransactionReceipt; publicKeyOccurrences: number }
  | { status: "rejected"; stage: RejectionStage; message: string; revert?: string };

type RejectionStage = "funds" | "authentication" | "device" | "proof" | "policy" | "relay";

class VeraKeyError extends Error {
  readonly stage: RejectionStage;
  readonly revert?: string;       // the contract error, when the account refused
}
`}</Code>
      <Code lang="ts" title="Sessions and stored passkeys">{`
interface Session { passkey: StoredPasskey; publicKey: PasskeyPublicKey; prfSecret: Uint8Array }

// What VeraKey remembers on a device: never the PRF output itself, never an assertion.
interface StoredPasskey {
  credentialId: string;           // base64url
  publicKey: { x: Hex; y: Hex };
  label: string;
  createdAt: number;
  payment?: boolean;              // enrolled for the payment sheet in this browser profile
  prfCheck?: string;              // a one-way check of the PRF secret it returned here; another is refused
}
`}</Code>
      <p>
        <code>publicKeyOccurrences</code> in the verified state counts how often the passkey's public key appears in the
        transaction's calldata. VeraKey's transactions never contain it, so it is 0. The rejection stages are explained in{" "}
        <A href="/docs/reference/errors#sdk-rejection-stages">SDK rejection stages</A>. <code>POLICY_REVERTS</code>, a{" "}
        <code>Set</code> of contract error names, lists the reverts the client reports at the <code>policy</code> stage.
        The prover throws <code>ProofGenerationError</code> (also from <code>@verakey/sdk/errors</code>) when an
        assertion does not satisfy the circuit; the client reports it at the <code>proof</code> stage.
      </p>

      <H2>Action helpers</H2>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["hashAction", "(action: Action): Hex", "The 32-byte WebAuthn challenge for an action, as the account computes it."],
          ["encodeAction", "(action: Action): Hex", "The ABI encoding that hashAction hashes."],
          ["changeDataHash", "(kind: ChangeKind, payload: Hex): Hex", "keccak256(kind ‖ payload), the dataHash of a scheduled or restricting change."],
          ["changePayload", "{ addOwner, removeOwner, setLimits, setRecipient, setAllowlist, setGuardian, setNewPayeeCap, freeze, unfreeze, setPaymentSheet }", <>Builders that return <code>{"{ kind, payload }"}</code> for each <A href="/docs/reference/contracts#change-kinds">change kind</A>.</>],
          ["guardianCommitment", "(account: Address, guardian: Address, salt: Hex): Hex", "What the account stores instead of the guardian's address."],
          ["expectedClientDataPrefix", "(challengeB64Url: string, origin: string): string", "The client data prefix a browser produces, which the account checks."],
          ["computeNullifier", "(bb: Barretenberg, publicKey: PasskeyPublicKey, prfSecret: Uint8Array, appId: bigint): Promise<bigint>", "The nullifier, exactly as the circuit computes it."],
          ["appIdFromName", "(name: string): bigint", 'A field element from an app name: keccak256("verakey.app:" + name) mod the BN254 order.'],
          ["fieldToHex", "(value: bigint): Hex", "A field element as 32-byte hex."],
          ["countPublicKeyOccurrences", "(calldata: Hex, publicKey: PasskeyPublicKey): number", "How often a public key's coordinates appear in calldata."],
        ])}
      />
      <Code lang="ts" title="Action">{`
interface Action {
  chainId: bigint | number;
  account: Address;
  nonce: bigint;
  kind: ActionKind;               // 1 Pay, 2 ScheduleChange, 3 CancelChange, 4 CancelRecovery, 5 Restrict
  target: Address;
  amount: bigint;
  dataHash: Hex;
  fee: bigint;
  deadline: bigint | number;      // at most MAX_DEADLINE_WINDOW (600 s) ahead
}
`}</Code>
      <p>
        Constants: <code>ActionKind</code>, <code>ChangeKind</code>, <code>ACTION_TYPEHASH</code>,{" "}
        <code>GUARDIAN_TYPEHASH</code>, <code>NULLIFIER_DOMAIN</code>, <code>PRF_SALT_LABEL</code>,{" "}
        <code>MAX_DEADLINE_WINDOW</code> (600), <code>USDG_DECIMALS</code> (6), <code>BN254_R</code>, <code>P256_N</code> and{" "}
        <code>ZERO_HASH</code>. The ABIs are <code>veraKeyAccountAbi</code>, <code>veraKeyFactoryAbi</code>,{" "}
        <code>honkVerifierAbi</code> and <code>erc20Abi</code>. The byte helpers of <code>@verakey/sdk/bytes</code> are{" "}
        <code>bytesToHex</code>, <code>hexToBytes</code>, <code>concatBytes</code>, <code>toFieldHex</code> (a field
        element as 32-byte hex), <code>limbs</code>, <code>bigintToBytes32</code>, <code>bytesToBigint</code>,{" "}
        <code>base64UrlEncode</code>, <code>base64UrlDecode</code>, <code>asBytes</code> and <code>sha256</code>.
      </p>

      <H2>WebAuthn helpers</H2>
      <p>Browser-only functions that talk to the passkey, and pure helpers that check what it returned.</p>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["createPasskey", "(options: CreatePasskeyOptions): Promise<RegisteredPasskey>", "Creates a discoverable ES256 passkey with PRF enabled; payment: true also enrolls it for the payment sheet."],
          ["getAssertion", "(options: GetAssertionOptions): Promise<PasskeyAssertion>", "A user-verified assertion. withPrf evaluates PRF (unlock only: signing assertions must keep 37 bytes of authenticator data)."],
          ["getSpcAssertion", "(options: SpcAssertionOptions): Promise<PasskeyAssertion>", "Asks the browser's payment sheet to show payee and total; the passkey signs them."],
          ["spcAvailability", "(): Promise<string>", '"available" when the browser can show the payment sheet (Chromium on macOS, Windows, Android).'],
          ["formatSpcTotal", "(units: bigint): string", "The payment sheet total for USDG base units, byte for byte what the account expects."],
          ["webauthnDigest", "(authenticatorData: Uint8Array, clientDataJSON: Uint8Array): Promise<Uint8Array>", "sha256(authenticatorData ‖ sha256(clientDataJSON)), the digest a passkey signs."],
          ["verifyPasskeySignature", "(publicKey: PasskeyPublicKey, digest: Uint8Array, signature: Uint8Array): boolean", "Checks a P-256 signature."],
          ["recoverPublicKeys", "(digest: Uint8Array, signature: Uint8Array): PasskeyPublicKey[]", "The (at most two) public keys that could have made a signature."],
          ["publicKeyFromSpki", "(spki: Uint8Array): PasskeyPublicKey", "Coordinates from a SubjectPublicKeyInfo; only uncompressed P-256 keys."],
          ["derToLowS, normalizeLowS", "(signature: Uint8Array): Uint8Array", "From a DER signature (derToLowS) or a raw r ‖ s (normalizeLowS), a 64-byte r ‖ s with low s, which the circuit requires."],
          ["prfSalt, randomChallenge", "(): Promise<Uint8Array>, (): Uint8Array", "The fixed PRF input VeraKey evaluates, and a random 32-byte challenge."],
        ])}
      />
      <p>
        <code>AUTHENTICATOR_DATA_LENGTH</code> is 37. The errors <code>PrfUnsupportedError</code> and{" "}
        <code>UnsupportedAuthenticatorError</code> become the <code>device</code> stage in the client. Passkey ids and public
        keys are kept by a <code>PasskeyStore</code> (<code>list</code>, <code>get</code>, <code>save</code>,{" "}
        <code>remove</code>): <code>LocalPasskeyStore</code> in a browser, <code>MemoryPasskeyStore</code> in tests and Node.{" "}
        <code>credentialIdBytes(passkey)</code> and <code>publicKeyOf(passkey)</code>, from <code>@verakey/sdk/store</code>,
        turn a <code>StoredPasskey</code>'s id and public key back into bytes, for example for <code>getAssertion</code>.
      </p>

      <H2>Disclosure helpers</H2>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["verifyDisclosure", "(pkg: DisclosurePackage, options: VerifyDisclosureOptions): Promise<DisclosureVerdict>", "Checks a disclosure end to end and returns each check with a verdict."],
          ["linkDisclosureChallenge", "(statement: LinkStatement): Hex", "The WebAuthn challenge the passkey signs for a statement."],
          ["LINK_DISCLOSURE_TYPEHASH", "Hex", "keccak256 of the statement's type string, the first word of the signed encoding."],
          ["MAX_DISCLOSURE_TTL_SECONDS", "number", "7 days: the longest validity a verifier accepts by default."],
        ])}
      />
      <Table
        stack
        head={["VerifyDisclosureOptions", "Type", "Meaning"]}
        rows={[
          [n("publicClient"), c("PublicClient"), "Reads the accounts, and calls the on-chain verifier."],
          [c("chainId, factory, rpIdHash, origin"), c("number, Address, Hex, string"), "The deployment the disclosure must belong to."],
          [n("audience"), c("string"), "Who is verifying, exactly as the disclosure must name them."],
          [n("nonce"), c("Hex?"), "The nonce the verifier asked for, if any."],
          [n("maxTtlSeconds"), c("number?"), "Refuse disclosures valid longer than this from now (default 7 days)."],
          [n("linkVerifier"), c("Address?"), "Verify the proof with the on-chain LinkHonkVerifier (eth_call, no transaction)."],
          [n("linkProver"), c("LinkProver?"), "Verify the proof locally with bb.js, alone or together with linkVerifier (then both checks run)."],
          [n("now"), c("number?"), "Unix seconds; defaults to now."],
        ]}
      />
      <Code lang="ts" title="Disclosure types">{`
interface LinkStatement {
  chainId: number;
  factory: Address;
  appIdA: Hex; nullifierA: Hex;
  appIdB: Hex; nullifierB: Hex;
  audience: string;               // hashed into the challenge
  nonce: Hex;
  expiresAt: number;              // Unix seconds
}

interface DisclosurePackage {
  kind: "verakey-link-disclosure";
  version: 1;
  statement: LinkStatement;
  labels?: { appA?: string; appB?: string };   // for people only, never verified
  origin: string;
  clientDataJSON: Hex;
  proof: Hex;
  publicInputs: Hex[];
}

interface DisclosureVerdict {
  valid: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  accounts: { a: DisclosedAccount; b: DisclosedAccount } | null;
}

interface DisclosedAccount {
  appId: Hex; nullifier: Hex; address: Address; deployed: boolean;
  ownedByNullifier: boolean | null;   // null while the account is not deployed
}
`}</Code>
      <p>
        <code>LinkProver</code> is in <code>@verakey/sdk/link-prover</code>, loaded on first use:{" "}
        <code>prove(input: LinkWitnessInput): Promise&lt;LinkProof&gt;</code> and <code>verify(proof)</code>. See{" "}
        <A href="/docs/build/disclosures">Disclosures</A>.
      </p>

      <H2>Validator helpers</H2>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["validatorInstallData", "(appId: Hex, nullifier: Hex): Hex", "The module's onInstall data: abi.encode(appId, nullifier)."],
          ["validatorSignature", "(proof: Hex, clientDataJSON: Hex): Hex", "A user operation or ERC-1271 signature: abi.encode(proof, clientDataJSON)."],
          ["validatorErc1271Challenge", "(account: Address, hash: Hex, chainId: number | bigint): Hex", "What the passkey signs for an ERC-1271 signature: bound to the chain and the account."],
          ["VALIDATOR_ERC1271_TYPEHASH", "Hex", 'keccak256("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)").'],
          ["VALIDATOR_VERIFICATION_GAS", "bigint", "850,000: set verificationGasLimit to at least this, plus the account's own overhead."],
        ])}
      />
      <p>
        See <A href="/docs/build/erc-7579">ERC-7579 validator</A> for installing the module and signing user operations.
      </p>

      <H2>Kernel plugin</H2>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["toVeraKeyKernelValidator", "({ validator, chainId, appId, nullifier, prove, supportedKernelVersions? }): VeraKeyKernelValidator", "A ZeroDev Kernel v3 validator plugin backed by VeraKeyValidator: installs the owner's nullifier, and has the passkey prove each userOpHash."],
          ["ENTRY_POINT_07", "Address", "EntryPoint v0.7, whose user operations VeraKeyValidator validates."],
          ["VERAKEY_PROOF_BYTES", "number", "8768, the size of a proof: the plugin's stub signature has it, for gas estimates."],
        ])}
      />
      <p>
        From <code>@verakey/sdk/kernel</code>. See <A href="/docs/build/erc-7579">ERC-7579 validator</A> for an example
        with <code>createKernelAccount</code>.
      </p>
      <H2>Integration kit</H2>
      <p>
        Sign in with VeraKey and payments for React sites with a Node server: <code>@verakey/sdk/server</code> on the
        server, <code>@verakey/sdk/react</code> or <code>@verakey/sdk/session</code> in the page. See{" "}
        <A href="/docs/build/sign-in#use-the-kit">Use the kit</A>.
      </p>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["createVeraKeyServer", "({ origin, deployment, secret, merchant?, rpcUrl?, publicClient?, sessionTtlSeconds?, ownerCheckSeconds?, store?, onSignIn?, onPayment? }): VeraKeyServer", "The kit's routes: session, nonce, sign-in, sign-out and payment. secret (at least 32 bytes) signs the session cookie; sessionTtlSeconds defaults to 7 days. ownerCheckSeconds (default 600) is how often a session checks on-chain that its passkey still owns the account, one check per session at a time; a chain that fails or takes more than two seconds keeps the session and is asked again a minute later. Signing out ends the session for every copy of its cookie when the store has has(); a store that cannot answer keeps the session. One payment check runs at a time per player. onSignIn and onPayment refuse by throwing. Throws at once on a malformed origin, secret, merchant, deployment or duration."],
          ["VeraKeyServer.handle", "(request: Request): Promise<Response>", "Answers the route named by the last segment of the request's path: for Next.js route handlers, Hono and any Fetch API server."],
          ["VeraKeyServer.getPlayer", "(request): Promise<{ id, account } | null>", "The signed-in player of a request, from its session cookie; takes a Fetch Request or an Express request. It asks the store whether the session was signed out and, every ownerCheckSeconds, the chain."],
          ["toExpress", "(server: VeraKeyServer): middleware", 'Mounts the kit in Express: app.use("/api/verakey", toExpress(verakey)).'],
          ["memoryStore", "(): VeraKeyStore", "The default store: each nonce and payment is accepted once per process, and a signed-out session stays revoked there. Pass your own { claim, release, has? } in production; without has(), signing out only clears the cookie in that browser."],
          ["ARBITRUM_SEPOLIA", "VeraKeyDeployment", "The Arbitrum Sepolia deployment, from @verakey/sdk/deployments: name, chainId, rpcUrl, origin, rpIdHash, factory, honkVerifier, usdg. A deployment you write yourself needs the same fields."],
          ["VeraKeySession", "new VeraKeySession({ server?, fetch?, host? })", "The kit in the page: load(), signIn(), signOut(), pay({ amount }) and confirmPayment(payment), with state and subscribe(listener). signIn and pay resolve null when the player cancels; confirmPayment asks the server again about a payment already sent, without a popup."],
          ["VeraKeySessionError", "{ code, message, status?, checks?, payment?, cause? }", "Why a request failed: a popup code, server (with the server's checks), network or signed-out. payment: a payment that left the player's account but the server has not accepted; pass it to confirmPayment."],
          ["VeraKeyProvider", "({ server?, children })", "One VeraKeySession for the React tree below it; server defaults to /api/verakey."],
          ["useVeraKey", "(): { status, player, paying, error, signIn, signOut, pay, confirmPayment }", "The session's state and actions, in a component."],
          ["SignInWithVeraKey", "({ theme?, className?, style?, onSignIn?, onError? })", "The button: signs in, shows the player's shortened ID and signs out; theme is dark or light."],
        ])}
      />
      <H2>Sign-in helpers</H2>
      <p>For sites that use <A href="/docs/build/sign-in">Sign in with VeraKey</A>: <code>@verakey/sdk/connect</code> in the page, <code>@verakey/sdk/signin</code> on the server.</p>
      <Table
        stack
        head={["Export", "Signature", "What it does"]}
        rows={methods([
          ["VeraKeyConnect", "new VeraKeyConnect({ url })", "Opens VeraKey's popup for one request at a time."],
          ["VeraKeyConnect.signIn", "({ nonce: Hex | (() => Promise<Hex>) }): Promise<SignInResult>", "Signs the player in; call it from a click."],
          ["VeraKeyConnect.pay", "({ to: Address; amount: bigint; account?: Address }): Promise<PaymentResult>", "Asks the player to pay; call it from a click. With account, the popup refuses to pay from any other account."],
          ["VeraKeyConnectError", "{ code, message, revert?, hash?, pending?, cause? }", "Why a request failed. hash: the payment was sent. pending: it may have been sent; find it with findPayment. cause: what the site's own nonce callback threw (code request)."],
          ["verifySignIn", "(result, { origin, nonce, publicClient, deployment, prover?, skipOnChainProof?, now?, maxTtlSeconds?, clockSkewSeconds? }): Promise<{ valid, checks, playerId, account }>", "Checks a sign-in on the site's server and returns the checks it ran: a malformed result stops at Format or Well-formed fields, and once a check that needs no chain fails, it stops before reading the chain. prover also verifies the proof locally with bb.js; skipOnChainProof, with a prover, skips the on-chain check. now (seconds) replaces the clock; maxTtlSeconds (default 300) and clockSkewSeconds (default 60) bound the expiry."],
          ["verifyPayment", "(hash, { publicClient, account, to, amount, timeoutMs? }): Promise<{ valid, checks, fee }>", "Checks that a transaction paid this amount from this account to this recipient; waits for one that is sent but not yet in a block. Accept the payment only when valid is true."],
          ["findPayment", "({ publicClient, account, nonce, fromBlock?, timeoutMs? }): Promise<Hex | null>", "Finds a payment by the paying account and its action nonce, from VeraKeyConnectError.pending."],
          ["appIdFromOrigin", "(origin: string): bigint", "The app id a site gets, derived from its origin."],
          ["accountAddressOf", "({ factory, accountImplementation, configHash }, appId: bigint, nullifier: bigint): Address", "An account's address, computed offline. accountImplementation and configHash come from /api/config; ARBITRUM_SEPOLIA does not carry them."],
          ["signInChallenge", "(statement): Hex", "What the passkey signs for a sign-in."],
          ["VeraKeyClient.proveSignIn", "(appId, { nonce, origin, now? }, emit?): Promise<SignInResult>", "The popup's side: signs and proves a sign-in. Needs accountImplementation and configHash in the client's config."],
        ])}
      />
    </>
  );
}
