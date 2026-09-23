import {
  createPublicClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, veraKeyAccountAbi, veraKeyFactoryAbi } from "./abi";
import { ZERO_HASH, changeDataHash, hashAction } from "./action";
import { base64UrlEncode, bytesToHex, hexToBytes, toFieldHex } from "./bytes";
import { ActionKind, MAX_DEADLINE_WINDOW, type ChangeKind } from "./constants";
import { computeNullifier } from "./nullifier";
import { countPublicKeyOccurrences } from "./privacy";
import { ProofGenerationError } from "./errors";
import type { VeraKeyProver } from "./prover";
import { RelayerClient, RelayerError, type RelayableFunction } from "./relayer";
import {
  LocalPasskeyStore,
  credentialIdBytes,
  publicKeyOf,
  toStoredPasskey,
  type PasskeyStore,
  type StoredPasskey,
} from "./store";
import {
  AUTHENTICATOR_DATA_LENGTH,
  PrfUnsupportedError,
  UnsupportedAuthenticatorError,
  createPasskey,
  getAssertion,
  randomChallenge,
  recoverPublicKeys,
  webauthnDigest,
  type PasskeyPublicKey,
} from "./webauthn";

export interface VeraKeyConfig {
  rpId: string;
  rpName?: string;
  chainId: number;
  rpcUrl: string;
  factory: Address;
  usdg: Address;
  rpIdHash: Hex;
  /** Base URL of the gasless relayer API, e.g. "/api". */
  relayerUrl: string;
  /** Relayer fee in USDG base units; it is part of every signed action. */
  relayerFee: bigint;
  /** App ids this client manages; used to recognise a passkey on a new device. */
  appIds: bigint[];
  /** Loads the prover lazily: bb.js and the CRS are several megabytes. */
  loadProver: () => Promise<VeraKeyProver>;
  store?: PasskeyStore;
}

/** An unlocked passkey. The PRF secret lives only in memory for the page's lifetime. */
export interface Session {
  passkey: StoredPasskey;
  publicKey: PasskeyPublicKey;
  prfSecret: Uint8Array;
}

/** The developer-docs state machine, extended with relay stages. */
export type ProofState =
  | { status: "idle" }
  | { status: "authenticating" }
  | { status: "proving"; startedAt: number }
  | { status: "relaying"; provingMs: number }
  | { status: "confirming"; provingMs: number; hash: Hex }
  | { status: "verified"; provingMs: number; hash: Hex; receipt: TransactionReceipt; publicKeyOccurrences: number }
  | { status: "rejected"; stage: RejectionStage; message: string; revert?: string };

export type RejectionStage = "authentication" | "device" | "proof" | "policy" | "relay";

export class VeraKeyError extends Error {
  constructor(
    readonly stage: RejectionStage,
    message: string,
    readonly revert?: string
  ) {
    super(message);
    this.name = "VeraKeyError";
  }
}

/** Contract errors that mean "valid proof, but the account's policy says no". */
export const POLICY_REVERTS = new Set([
  "PerTxCapExceeded",
  "DailyCapExceeded",
  "RecipientNotAllowed",
  "InvalidRecipient",
  "InvalidAmount",
  "NotOwner",
  "ChangeNotReady",
  "UnknownChange",
  "LastOwner",
  "AlreadyOwner",
  "RecoveryNotReady",
  "NoRecovery",
]);

export interface AccountState {
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
  ownerCount: bigint;
  guardian: Address;
  recovery: { nullifier: Hex; eta: bigint } | null;
  changeDelay: bigint;
  recoveryDelay: bigint;
}

export interface TrackedChange {
  account: Address;
  changeId: Hex;
  kind: ChangeKind;
  payload: Hex;
  eta: number;
}

type Listener = (state: ProofState) => void;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function describeWebAuthnError(error: unknown): VeraKeyError {
  if (error instanceof PrfUnsupportedError || error instanceof UnsupportedAuthenticatorError) {
    return new VeraKeyError("device", error.message);
  }
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return new VeraKeyError("authentication", "Passkey confirmation was cancelled or timed out.");
  }
  return new VeraKeyError("authentication", error instanceof Error ? error.message : String(error));
}

/**
 * VeraKey for applications: passkey registration, unlock, per-app accounts and ZK-authorized
 * actions submitted through a gasless relayer. Proving happens on this device only.
 */
export class VeraKeyClient {
  readonly publicClient;
  readonly relayer: RelayerClient;
  readonly store: PasskeyStore;
  private proverPromise?: Promise<VeraKeyProver>;
  private currentSession: Session | null = null;
  private readonly nullifiers = new Map<bigint, bigint>();

  constructor(readonly config: VeraKeyConfig) {
    const chain = defineChain({
      id: config.chainId,
      name: `chain-${config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.publicClient = createPublicClient({ chain, transport: http(), pollingInterval: 1_000 });
    this.relayer = new RelayerClient(config.relayerUrl);
    this.store = config.store ?? new LocalPasskeyStore();
  }

  /** `true`/`false` when the browser reports PRF support, `undefined` when it cannot tell. */
  static async browserSupportsPrf(): Promise<boolean | undefined> {
    const pkc = globalThis.PublicKeyCredential as unknown as
      | { getClientCapabilities?: () => Promise<Record<string, boolean>> }
      | undefined;
    if (!pkc) return false;
    try {
      const capabilities = await pkc.getClientCapabilities?.();
      return capabilities ? capabilities["extension:prf"] : undefined;
    } catch {
      return undefined;
    }
  }

  prover(): Promise<VeraKeyProver> {
    this.proverPromise ??= this.config.loadProver();
    return this.proverPromise;
  }

  get session(): Session | null {
    return this.currentSession;
  }

  lock(): void {
    this.currentSession = null;
    this.nullifiers.clear();
  }

  /**
   * Creates a passkey. Returns its session when the authenticator evaluated PRF at creation; with
   * `activate: false` (e.g. a backup passkey) the current session stays active.
   */
  async register(
    label: string,
    { userName = label, activate = true }: { userName?: string; activate?: boolean } = {}
  ): Promise<{ passkey: StoredPasskey; session: Session | null }> {
    let created;
    try {
      created = await createPasskey({ rpId: this.config.rpId, rpName: this.config.rpName ?? "VeraKey", userName });
    } catch (error) {
      throw describeWebAuthnError(error);
    }
    const passkey = toStoredPasskey(created.credentialId, created.publicKey, label);
    this.store.save(passkey);
    if (!created.prfSecret) return { passkey, session: null };
    const session = { passkey, publicKey: created.publicKey, prfSecret: created.prfSecret };
    return { passkey, session: activate ? this.startSession(session) : session };
  }

  /**
   * Unlocks a passkey with one user-verified assertion that evaluates PRF. On a device that has not
   * seen this passkey, the public key is recovered from the assertion itself.
   */
  async unlock(passkey?: StoredPasskey): Promise<Session> {
    return this.startSession(await this.authenticate(passkey));
  }

  /**
   * Runs the unlock ceremony without switching the active session, e.g. to learn a backup passkey's
   * nullifier before the current owner schedules it as an additional owner.
   */
  async authenticate(passkey?: StoredPasskey): Promise<Session> {
    let assertion;
    try {
      assertion = await getAssertion({
        rpId: this.config.rpId,
        challenge: randomChallenge(),
        credentialIds: passkey ? [credentialIdBytes(passkey)] : undefined,
        withPrf: true,
      });
    } catch (error) {
      throw describeWebAuthnError(error);
    }
    const prfSecret = assertion.prfSecret!;
    let stored = this.store.get(assertion.credentialId);
    if (!stored) {
      const publicKey = await this.recoverPublicKey(
        await webauthnDigest(assertion.authenticatorData, assertion.clientDataJSON),
        assertion.signature,
        prfSecret,
        assertion.credentialId
      );
      stored = toStoredPasskey(assertion.credentialId, publicKey, "Passkey on this device");
      this.store.save(stored);
    }
    return { passkey: stored, publicKey: publicKeyOf(stored), prfSecret };
  }

  private startSession(session: Session): Session {
    this.nullifiers.clear();
    this.currentSession = session;
    return session;
  }

  /**
   * ECDSA yields up to two candidate keys per signature. A candidate that owns an existing VeraKey
   * account wins; otherwise a second assertion narrows the candidates to one.
   */
  private async recoverPublicKey(
    digest: Uint8Array,
    signature: Uint8Array,
    prfSecret: Uint8Array,
    credentialId: Uint8Array
  ): Promise<PasskeyPublicKey> {
    const candidates = recoverPublicKeys(digest, signature);
    if (candidates.length === 1) return candidates[0];
    const prover = await this.prover();
    for (const candidate of candidates) {
      for (const appId of this.config.appIds) {
        const nullifier = await computeNullifier(prover.barretenberg, candidate, prfSecret, appId);
        const address = await this.predictAddress(appId, nullifier);
        const code = await this.publicClient.getCode({ address });
        if (code && code !== "0x") return candidate;
      }
    }
    const second = await getAssertion({
      rpId: this.config.rpId,
      challenge: randomChallenge(),
      credentialIds: [credentialId],
    });
    const again = recoverPublicKeys(
      await webauthnDigest(second.authenticatorData, second.clientDataJSON),
      second.signature
    );
    const match = candidates.find(c => again.some(a => bytesToHex(a.x) === bytesToHex(c.x) && bytesToHex(a.y) === bytesToHex(c.y)));
    if (!match) throw new VeraKeyError("device", "Could not recover this passkey's public key.");
    return match;
  }

  private requireSession(): Session {
    if (!this.currentSession) throw new VeraKeyError("authentication", "Unlock a passkey first.");
    return this.currentSession;
  }

  /** The unlinkable owner id of this session's passkey in `appId`. */
  async nullifier(appId: bigint, session = this.requireSession()): Promise<bigint> {
    const cached = session === this.currentSession ? this.nullifiers.get(appId) : undefined;
    if (cached !== undefined) return cached;
    const prover = await this.prover();
    const value = await computeNullifier(prover.barretenberg, session.publicKey, session.prfSecret, appId);
    if (session === this.currentSession) this.nullifiers.set(appId, value);
    return value;
  }

  predictAddress(appId: bigint, nullifier: bigint): Promise<Address> {
    return this.publicClient.readContract({
      address: this.config.factory,
      abi: veraKeyFactoryAbi,
      functionName: "accountAddress",
      args: [toFieldHex(appId), toFieldHex(nullifier)],
    });
  }

  async account(appId: bigint): Promise<AccountState> {
    const nullifier = await this.nullifier(appId);
    const address = await this.predictAddress(appId, nullifier);
    const [code, balance] = await Promise.all([
      this.publicClient.getCode({ address }),
      this.publicClient.readContract({ address: this.config.usdg, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    ]);
    const base = { appId, nullifier, address, balance };
    if (!code || code === "0x") {
      return {
        ...base, deployed: false, nonce: 0n, perTxCap: 0n, dailyCap: 0n, spentToday: 0n,
        allowlistEnabled: false, ownerCount: 1n, guardian: ZERO_ADDRESS, recovery: null, changeDelay: 0n, recoveryDelay: 0n,
      };
    }
    const read = <F extends "nonce" | "policy" | "ownerCount" | "guardian" | "recovery" | "config">(functionName: F) =>
      this.publicClient.readContract({ address, abi: veraKeyAccountAbi, functionName } as never) as Promise<unknown>;
    const [nonce, policy, ownerCount, guardian, recovery, config] = (await Promise.all([
      read("nonce"), read("policy"), read("ownerCount"), read("guardian"), read("recovery"), read("config"),
    ])) as [bigint, readonly [bigint, bigint, bigint, bigint, boolean], bigint, Address, readonly [Hex, bigint], readonly unknown[]];
    return {
      ...base,
      deployed: true,
      nonce,
      perTxCap: policy[0],
      dailyCap: policy[1],
      spentToday: policy[2],
      allowlistEnabled: policy[4],
      ownerCount,
      guardian,
      recovery: recovery[1] === 0n ? null : { nullifier: recovery[0], eta: recovery[1] },
      changeDelay: config[4] as bigint,
      recoveryDelay: config[5] as bigint,
    };
  }

  /** Deploys the account for `appId` through the relayer (idempotent). */
  async ensureAccount(appId: bigint): Promise<Address> {
    const nullifier = await this.nullifier(appId);
    const { hash, account } = await this.relayer.createAccount(toFieldHex(appId), toFieldHex(nullifier));
    if (hash) await this.publicClient.waitForTransactionReceipt({ hash });
    return account;
  }

  /** Asks the relayer's faucet for demo USDG (testnets only). */
  async requestDemoFunds(account: Address): Promise<void> {
    const { hash } = await this.relayer.faucet(account);
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Signs `action` with the session's passkey (no extensions, so authenticatorData stays 37 bytes)
   * and proves the assertion. Returns the calldata pieces every authorized entry point takes.
   */
  async authorize(
    appId: bigint,
    action: { kind: number; target: Address; amount: bigint; dataHash: Hex },
    emit: Listener = () => {}
  ) {
    const session = this.requireSession();
    const nullifier = await this.nullifier(appId);
    const account = await this.predictAddress(appId, nullifier);
    const code = await this.publicClient.getCode({ address: account });
    const nonce =
      code && code !== "0x"
        ? await this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "nonce" })
        : 0n;
    const fee = this.config.relayerFee;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + MAX_DEADLINE_WINDOW / 2);
    const actionHash = hashAction({
      chainId: this.config.chainId, account, nonce, kind: action.kind as never, target: action.target,
      amount: action.amount, dataHash: action.dataHash, fee, deadline,
    });
    const proverReady = this.prover();

    emit({ status: "authenticating" });
    let assertion;
    try {
      assertion = await getAssertion({
        rpId: this.config.rpId,
        challenge: hexToBytes(actionHash),
        credentialIds: [credentialIdBytes(session.passkey)],
      });
    } catch (error) {
      throw describeWebAuthnError(error);
    }
    if (assertion.authenticatorData.length !== AUTHENTICATOR_DATA_LENGTH) {
      throw new VeraKeyError(
        "device",
        `This authenticator returned ${assertion.authenticatorData.length} bytes of authenticator data; VeraKey needs ${AUTHENTICATOR_DATA_LENGTH}.`
      );
    }

    const startedAt = Date.now();
    emit({ status: "proving", startedAt });
    let proof;
    try {
      proof = await (await proverReady).prove({
        publicKey: session.publicKey,
        signature: assertion.signature,
        authenticatorData: assertion.authenticatorData,
        prfSecret: session.prfSecret,
        clientDataJSON: assertion.clientDataJSON,
        rpIdHash: hexToBytes(this.config.rpIdHash),
        appId,
        nullifier,
      });
    } catch (error) {
      throw new VeraKeyError("proof", error instanceof ProofGenerationError ? error.message : "Proof generation failed.");
    }
    return {
      account,
      nullifier: toFieldHex(nullifier),
      fee,
      deadline,
      actionHash,
      clientDataJSON: bytesToHex(assertion.clientDataJSON),
      proof: proof.proof,
      provingMs: proof.provingMs,
    };
  }

  private async submit(
    account: Address,
    functionName: RelayableFunction,
    args: readonly unknown[],
    provingMs: number,
    emit: Listener
  ): Promise<TransactionReceipt> {
    emit({ status: "relaying", provingMs });
    let hash: Hex;
    try {
      ({ hash } = await this.relayer.relay(account, functionName, args));
    } catch (error) {
      if (error instanceof RelayerError) {
        const stage = error.revert && POLICY_REVERTS.has(error.revert) ? "policy" : "relay";
        throw new VeraKeyError(stage, error.message, error.revert);
      }
      throw new VeraKeyError("relay", "The relayer could not be reached.");
    }
    emit({ status: "confirming", provingMs, hash });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new VeraKeyError("relay", "The transaction reverted on-chain.");
    const tx = await this.publicClient.getTransaction({ hash });
    emit({
      status: "verified",
      provingMs,
      hash,
      receipt,
      publicKeyOccurrences: countPublicKeyOccurrences(tx.input, this.requireSession().publicKey),
    });
    return receipt;
  }

  private async run<T>(emit: Listener, job: () => Promise<T>): Promise<T> {
    try {
      return await job();
    } catch (error) {
      const failure =
        error instanceof VeraKeyError ? error : new VeraKeyError("relay", error instanceof Error ? error.message : String(error));
      emit({ status: "rejected", stage: failure.stage, message: failure.message, revert: failure.revert });
      throw failure;
    }
  }

  /** Pays `amount` USDG from the `appId` account to `to`. */
  pay(appId: bigint, to: Address, amount: bigint, emit: Listener = () => {}): Promise<TransactionReceipt> {
    return this.run(emit, async () => {
      await this.ensureAccount(appId);
      const auth = await this.authorize(appId, { kind: ActionKind.Pay, target: to, amount, dataHash: ZERO_HASH }, emit);
      return this.submit(
        auth.account, "pay",
        [to, amount, auth.fee, auth.deadline, auth.nullifier, auth.clientDataJSON, auth.proof],
        auth.provingMs, emit
      );
    });
  }

  /** Schedules a timelocked configuration change and returns its id. */
  scheduleChange(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit: Listener = () => {}): Promise<TrackedChange> {
    return this.run(emit, async () => {
      await this.ensureAccount(appId);
      const auth = await this.authorize(
        appId,
        { kind: ActionKind.ScheduleChange, target: ZERO_ADDRESS, amount: 0n, dataHash: changeDataHash(change.kind, change.payload) },
        emit
      );
      const receipt = await this.submit(
        auth.account, "scheduleChange",
        [change.kind, change.payload, auth.fee, auth.deadline, auth.nullifier, auth.clientDataJSON, auth.proof],
        auth.provingMs, emit
      );
      const [event] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "ChangeScheduled", logs: receipt.logs });
      return { account: auth.account, changeId: event.args.changeId, kind: change.kind, payload: change.payload, eta: Number(event.args.eta) };
    });
  }

  cancelChange(appId: bigint, changeId: Hex, emit: Listener = () => {}): Promise<TransactionReceipt> {
    return this.run(emit, async () => {
      const auth = await this.authorize(appId, { kind: ActionKind.CancelChange, target: ZERO_ADDRESS, amount: 0n, dataHash: changeId }, emit);
      return this.submit(
        auth.account, "cancelChange",
        [changeId, auth.fee, auth.deadline, auth.nullifier, auth.clientDataJSON, auth.proof],
        auth.provingMs, emit
      );
    });
  }

  /** Applies a change whose timelock has passed. Needs no passkey: anyone may apply. */
  async applyChange(account: Address, change: TrackedChange): Promise<TransactionReceipt> {
    const { hash } = await this.relayer.relay(account, "applyChange", [change.changeId, change.kind, change.payload]).catch(error => {
      if (error instanceof RelayerError) throw new VeraKeyError(error.revert && POLICY_REVERTS.has(error.revert) ? "policy" : "relay", error.message, error.revert);
      throw error;
    });
    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  cancelRecovery(appId: bigint, pendingNullifier: Hex, emit: Listener = () => {}): Promise<TransactionReceipt> {
    return this.run(emit, async () => {
      const auth = await this.authorize(
        appId, { kind: ActionKind.CancelRecovery, target: ZERO_ADDRESS, amount: 0n, dataHash: pendingNullifier }, emit
      );
      return this.submit(
        auth.account, "cancelRecovery",
        [auth.fee, auth.deadline, auth.nullifier, auth.clientDataJSON, auth.proof],
        auth.provingMs, emit
      );
    });
  }

  async executeRecovery(account: Address): Promise<TransactionReceipt> {
    const { hash } = await this.relayer.relay(account, "executeRecovery", []);
    return this.publicClient.waitForTransactionReceipt({ hash });
  }

  /** `true` while `changeId` is scheduled and not yet applied or cancelled. */
  async isPending(account: Address, changeId: Hex): Promise<boolean> {
    const [, , eta] = await this.publicClient.readContract({
      address: account, abi: veraKeyAccountAbi, functionName: "pendingChange", args: [changeId],
    });
    return eta !== 0n;
  }

  /** Short, stable label for UI (never used for security decisions). */
  static shortCredentialId(passkey: StoredPasskey): string {
    return passkey.credentialId.slice(0, 8);
  }

  static credentialIdOf(bytes: Uint8Array): string {
    return base64UrlEncode(bytes);
  }
}
