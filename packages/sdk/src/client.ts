import {
  concat,
  createPublicClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, veraKeyAccountAbi, veraKeyFactoryAbi } from "./abi";
import { ZERO_HASH, changeDataHash, changePayload, guardianCommitment, hashAction } from "./action";
import { base64UrlEncode, bytesToHex, hexToBytes, toFieldHex } from "./bytes";
import { ActionKind, MAX_DEADLINE_WINDOW, type ChangeKind } from "./constants";
import { linkDisclosureChallenge, type DisclosurePackage, type LinkStatement } from "./disclosure";
import type { LinkProver } from "./link-prover";
import { computeNullifier } from "./nullifier";
import { countPublicKeyOccurrences } from "./privacy";
import { ProofGenerationError } from "./errors";
import type { VeraKeyProver } from "./prover";
import { RelayerClient, RelayerError, type RelayableFunction } from "./relayer";
import { SIGN_IN_TTL_SECONDS, accountAddressOf, signInChallenge, type SignInResult, type SignInStatement } from "./signin";
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
  getSpcAssertion,
  randomChallenge,
  recoverPublicKeys,
  spcAvailability,
  webauthnDigest,
  type PasskeyAssertion,
  type PasskeyPublicKey,
} from "./webauthn";

export interface VeraKeyConfig {
  rpId: string;
  rpName?: string;
  chainId: number;
  rpcUrl: string;
  factory: Address;
  usdg: Address;
  /** The account implementation and the factory's configuration hash: `proveSignIn` computes account addresses with them, offline. */
  accountImplementation?: Address;
  configHash?: Hex;
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
  /** Shown in the browser's Secure Payment Confirmation sheet (an https or same-origin image URL). */
  paymentInstrument?: { displayName: string; icon: string };
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

export type RejectionStage = "funds" | "authentication" | "device" | "proof" | "policy" | "relay";

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
  "NewPayeeCapExceeded",
  "AccountFrozen",
  "NotRestrictive",
  "FeeTooHigh",
  "PaymentSheetRequired",
  "TooManyPendingChanges",
  "CannotVetoGuardianChange",
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
  /** Largest first payment to a recipient that is neither known nor allowlisted. */
  newPayeeCap: bigint;
  frozen: boolean;
  ownerCount: bigint;
  /** The zero hash when no guardian is set; the guardian's address is never stored. */
  guardianCommitment: Hex;
  /** When set, payments must be confirmed in the browser's payment sheet (Secure Payment Confirmation). */
  paymentSheetRequired: boolean;
  /** Where every fee goes, and the largest fee an action may carry. */
  feeRecipient: Address;
  maxFee: bigint;
  /** Scheduled changes still waiting, read from the chain (so they show on every device). */
  pendingChanges: PendingChangeInfo[];
  recovery: { nullifier: Hex; eta: bigint } | null;
  changeDelay: bigint;
  recoveryDelay: bigint;
}

/** A scheduled change as the account stores it: the payload itself is only in the scheduling event. */
export interface PendingChangeInfo {
  changeId: Hex;
  kind: ChangeKind;
  payloadHash: Hex;
  eta: number;
}

/** What a guardian needs to act for one account; share it with the guardian, not with anyone else. */
export interface GuardianCard {
  chainId: number;
  account: Address;
  guardian: Address;
  salt: Hex;
  commitment: Hex;
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
  private linkProverPromise?: Promise<LinkProver>;
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

  /** The consent-to-link prover, loaded on first use; it shares the Barretenberg instance. */
  linkProver(): Promise<LinkProver> {
    this.linkProverPromise ??= Promise.all([this.prover(), import("./link-prover")]).then(
      ([prover, { LinkProver }]) => new LinkProver(prover.barretenberg)
    );
    return this.linkProverPromise;
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
    { userName = label, activate = true, payment = false }: { userName?: string; activate?: boolean; payment?: boolean } = {}
  ): Promise<{ passkey: StoredPasskey; session: Session | null }> {
    let created;
    try {
      created = await createPasskey({ rpId: this.config.rpId, rpName: this.config.rpName ?? "VeraKey", userName, payment });
    } catch (error) {
      throw describeWebAuthnError(error);
    }
    const passkey = toStoredPasskey(created.credentialId, created.publicKey, label, created.payment);
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
        ...base, deployed: false, nonce: 0n, perTxCap: 0n, dailyCap: 0n, spentToday: 0n, allowlistEnabled: false,
        newPayeeCap: 0n, frozen: false, ownerCount: 1n, guardianCommitment: ZERO_HASH, paymentSheetRequired: false,
        feeRecipient: ZERO_ADDRESS, maxFee: 0n, pendingChanges: [], recovery: null, changeDelay: 0n, recoveryDelay: 0n,
      };
    }
    const read = <F extends "nonce" | "policy" | "ownerCount" | "protections" | "fees" | "recovery" | "config">(functionName: F) =>
      this.publicClient.readContract({ address, abi: veraKeyAccountAbi, functionName } as never) as Promise<unknown>;
    const [nonce, policy, ownerCount, protections, fees, recovery, config, pendingChanges] = (await Promise.all([
      read("nonce"), read("policy"), read("ownerCount"), read("protections"), read("fees"), read("recovery"), read("config"),
      this.pendingChanges(address),
    ])) as [
      bigint, readonly [bigint, bigint, bigint, bigint, boolean], bigint, readonly [bigint, boolean, Hex, boolean],
      readonly [Address, bigint], readonly [Hex, bigint], readonly unknown[], PendingChangeInfo[],
    ];
    return {
      ...base,
      deployed: true,
      nonce,
      perTxCap: policy[0],
      dailyCap: policy[1],
      spentToday: policy[2],
      allowlistEnabled: policy[4],
      newPayeeCap: protections[0],
      frozen: protections[1],
      ownerCount,
      guardianCommitment: protections[2],
      paymentSheetRequired: protections[3],
      feeRecipient: fees[0],
      maxFee: fees[1],
      pendingChanges,
      recovery: recovery[1] === 0n ? null : { nullifier: recovery[0], eta: recovery[1] },
      changeDelay: config[4] as bigint,
      recoveryDelay: config[5] as bigint,
    };
  }

  /** The account's scheduled changes that are still waiting, oldest first. */
  async pendingChanges(account: Address): Promise<PendingChangeInfo[]> {
    const ids = await this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "pendingChangeIds" });
    const changes = await Promise.all(
      ids.map(async changeId => {
        const [kind, payloadHash, eta] = await this.publicClient.readContract({
          address: account, abi: veraKeyAccountAbi, functionName: "pendingChange", args: [changeId],
        });
        return { changeId, kind: kind as ChangeKind, payloadHash, eta: Number(eta) };
      })
    );
    return changes.filter(change => change.eta !== 0).sort((a, b) => a.eta - b.eta);
  }

  /**
   * Best effort: a scheduled change's payload, from its `ChangeScheduled` event in the last
   * `lookbackBlocks` blocks. The account stores only the payload's hash; `null` when not found.
   */
  async scheduledPayload(account: Address, changeId: Hex, lookbackBlocks = 100_000n): Promise<Hex | null> {
    try {
      const latest = await this.publicClient.getBlockNumber();
      const logs = await this.publicClient.getContractEvents({
        address: account, abi: veraKeyAccountAbi, eventName: "ChangeScheduled", args: { changeId },
        fromBlock: latest > lookbackBlocks ? latest - lookbackBlocks : 0n, toBlock: latest,
      });
      return (logs[0]?.args.payload as Hex | undefined) ?? null;
    } catch {
      return null;
    }
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
  /**
   * Whether payments from this session can be confirmed in the browser's Secure Payment Confirmation
   * sheet: the passkey was enrolled for it in this browser, and the browser supports it.
   */
  async canConfirmPayments(session = this.currentSession): Promise<boolean> {
    return !!session?.passkey.payment && !!this.config.paymentInstrument && (await spcAvailability()) === "available";
  }

  async authorize(
    appId: bigint,
    action: { kind: number; target: Address; amount: bigint; dataHash: Hex },
    emit: Listener = () => {},
    { secureConfirmation = false }: { secureConfirmation?: boolean } = {}
  ) {
    const session = this.requireSession();
    const nullifier = await this.nullifier(appId);
    const account = await this.predictAddress(appId, nullifier);
    const code = await this.publicClient.getCode({ address: account });
    const deployed = !!code && code !== "0x";
    const [nonce, protections, fees] = deployed
      ? await Promise.all([
          this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "nonce" }),
          this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "protections" }),
          this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "fees" }),
        ])
      : [0n, null, null];
    const fee = this.config.relayerFee;
    if (fees && fee > fees[1]) {
      throw new VeraKeyError("policy", `The relayer asks ${formatUnits(fee, 6)} USDG, above this account's ${formatUnits(fees[1], 6)} USDG fee limit.`, "FeeTooHigh");
    }
    const sheetRequired = action.kind === ActionKind.Pay && !!protections?.[3];
    // Every proof-authorized call pays the relayer fee in USDG: do not ask for the passkey when the
    // account cannot cover it. A payment's amount is left to the contract, which must still see a
    // payment above the account's caps in order to refuse it.
    const balance = await this.publicClient.readContract({ address: this.config.usdg, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    if (balance < fee) {
      throw new VeraKeyError("funds", `The account holds ${formatUnits(balance, 6)} USDG and every action pays a ${formatUnits(fee, 6)} USDG relayer fee.`);
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + MAX_DEADLINE_WINDOW / 2);
    const actionHash = hashAction({
      chainId: this.config.chainId, account, nonce, kind: action.kind as never, target: action.target,
      amount: action.amount, dataHash: action.dataHash, fee, deadline,
    });
    const proverReady = this.prover();

    emit({ status: "authenticating" });
    const request = { rpId: this.config.rpId, challenge: hexToBytes(actionHash), credentialIds: [credentialIdBytes(session.passkey)] };
    let assertion: PasskeyAssertion | undefined;
    let confirmedBy: "payment-sheet" | "passkey" = "passkey";
    const sheetAvailable = (secureConfirmation || sheetRequired) && action.kind === ActionKind.Pay && (await this.canConfirmPayments(session));
    if (sheetRequired && !sheetAvailable) {
      throw new VeraKeyError(
        "policy",
        "This account only pays through the browser's payment sheet, which this browser cannot show for this passkey.",
        "PaymentSheetRequired"
      );
    }
    if (sheetAvailable) {
      // Once the sheet was offered, there is no second chance through the plain prompt: a user who
      // closed the sheet because the payee or the total looked wrong must not be asked again.
      try {
        assertion = await getSpcAssertion({
          ...request,
          payee: action.target.toLowerCase(),
          total: action.amount + fee,
          instrument: this.config.paymentInstrument!,
        });
        confirmedBy = "payment-sheet";
      } catch (error) {
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
          throw new VeraKeyError("authentication", "The payment sheet was closed or timed out. Nothing was paid.");
        }
        throw describeWebAuthnError(error);
      }
    }
    if (!assertion) {
      try {
        assertion = await getAssertion(request);
      } catch (error) {
        throw describeWebAuthnError(error);
      }
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
      confirmedBy,
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

  /**
   * Pays `amount` USDG from the `appId` account to `to`. With `secureConfirmation`, a passkey enrolled
   * for Secure Payment Confirmation confirms in the browser's own payment sheet (payee and total
   * signed); an account that requires the sheet always uses it.
   */
  pay(appId: bigint, to: Address, amount: bigint, emit: Listener = () => {}, options: { secureConfirmation?: boolean } = {}): Promise<TransactionReceipt> {
    return this.run(emit, async () => {
      await this.ensureAccount(appId);
      const auth = await this.authorize(appId, { kind: ActionKind.Pay, target: to, amount, dataHash: ZERO_HASH }, emit, options);
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

  /**
   * Applies a tightening change at once (freeze, lower limits or new-payee cap, enable the allowlist,
   * remove a recipient). The account refuses anything that would loosen it (`NotRestrictive`).
   */
  restrict(appId: bigint, change: { kind: ChangeKind; payload: Hex }, emit: Listener = () => {}): Promise<{ account: Address; restrictionId: Hex }> {
    return this.run(emit, async () => {
      await this.ensureAccount(appId);
      const auth = await this.authorize(
        appId,
        { kind: ActionKind.Restrict, target: ZERO_ADDRESS, amount: 0n, dataHash: changeDataHash(change.kind, change.payload) },
        emit
      );
      const receipt = await this.submit(
        auth.account, "restrict",
        [change.kind, change.payload, auth.fee, auth.deadline, auth.nullifier, auth.clientDataJSON, auth.proof],
        auth.provingMs, emit
      );
      const [event] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "Restricted", logs: receipt.logs });
      return { account: auth.account, restrictionId: event.args.restrictionId };
    });
  }

  /** Stops every payment from the `appId` account at once; unfreezing is a timelocked change. */
  freeze(appId: bigint, emit: Listener = () => {}) {
    return this.restrict(appId, changePayload.freeze(), emit);
  }

  /**
   * The salt that hides `guardian` behind a commitment in the `appId` account. It is derived from the
   * passkey's PRF secret, so the owner can always rebuild the guardian card, and it differs per app, so
   * one guardian used by several apps leaves nothing on-chain that links them.
   */
  async guardianSalt(appId: bigint, guardian: Address, session = this.requireSession()): Promise<Hex> {
    return keccak256(
      concat([stringToHex("VeraKey guardian salt v1"), bytesToHex(session.prfSecret), toFieldHex(appId), guardian.toLowerCase() as Hex])
    );
  }

  /** The card to hand to `guardian`, and the commitment to schedule with `changePayload.setGuardian`. */
  async guardianCard(appId: bigint, guardian: Address): Promise<GuardianCard> {
    const account = await this.predictAddress(appId, await this.nullifier(appId));
    const salt = await this.guardianSalt(appId, guardian);
    return { chainId: this.config.chainId, account, guardian, salt, commitment: guardianCommitment(account, guardian, salt) };
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

  /**
   * "Linkable by consent": proves to `audience` that this passkey owns the accounts of `appIdA` and
   * `appIdB`, with a fresh passkey approval over a statement that expires. Nothing is sent anywhere;
   * the owner decides whom to give the returned package to. See `verifyDisclosure`.
   */
  createDisclosure(
    request: { appIdA: bigint; appIdB: bigint; audience: string; nonce?: Hex; ttlSeconds?: number; labels?: DisclosurePackage["labels"] },
    emit: Listener = () => {}
  ): Promise<DisclosurePackage> {
    return this.run(emit, async () => {
      const session = this.requireSession();
      if (request.appIdA === request.appIdB) throw new VeraKeyError("policy", "Choose two different apps.");
      const [nullifierA, nullifierB] = [await this.nullifier(request.appIdA), await this.nullifier(request.appIdB)];
      const statement: LinkStatement = {
        chainId: this.config.chainId,
        factory: this.config.factory,
        appIdA: toFieldHex(request.appIdA),
        nullifierA: toFieldHex(nullifierA),
        appIdB: toFieldHex(request.appIdB),
        nullifierB: toFieldHex(nullifierB),
        audience: request.audience.trim(),
        nonce: request.nonce ?? bytesToHex(randomChallenge()),
        expiresAt: Math.floor(Date.now() / 1000) + (request.ttlSeconds ?? 86_400),
      };
      const linkProverReady = this.linkProver();
      emit({ status: "authenticating" });
      let assertion;
      try {
        assertion = await getAssertion({
          rpId: this.config.rpId,
          challenge: hexToBytes(linkDisclosureChallenge(statement)),
          credentialIds: [credentialIdBytes(session.passkey)],
        });
      } catch (error) {
        throw describeWebAuthnError(error);
      }
      if (assertion.authenticatorData.length !== AUTHENTICATOR_DATA_LENGTH) {
        throw new VeraKeyError("device", `This authenticator returned ${assertion.authenticatorData.length} bytes of authenticator data; VeraKey needs ${AUTHENTICATOR_DATA_LENGTH}.`);
      }
      emit({ status: "proving", startedAt: Date.now() });
      let proof;
      try {
        proof = await (await linkProverReady).prove({
          publicKey: session.publicKey,
          signature: assertion.signature,
          authenticatorData: assertion.authenticatorData,
          prfSecret: session.prfSecret,
          clientDataJSON: assertion.clientDataJSON,
          rpIdHash: hexToBytes(this.config.rpIdHash),
          appIdA: request.appIdA,
          nullifierA,
          appIdB: request.appIdB,
          nullifierB,
        });
      } catch (error) {
        throw new VeraKeyError("proof", error instanceof ProofGenerationError ? error.message : "Proof generation failed.");
      }
      emit({ status: "idle" });
      return {
        kind: "verakey-link-disclosure",
        version: 1,
        statement,
        labels: request.labels,
        origin: JSON.parse(new TextDecoder().decode(assertion.clientDataJSON)).origin,
        clientDataJSON: bytesToHex(assertion.clientDataJSON),
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      };
    });
  }

  /**
   * "Sign in with VeraKey": signs a sign-in statement for `origin` with the unlocked passkey and proves it. Nothing
   * is sent anywhere, and the account address is computed offline, so no request carries the player ID.
   */
  proveSignIn(appId: bigint, request: { nonce: Hex; origin: string; now?: number }, emit: Listener = () => {}): Promise<SignInResult> {
    return this.run(emit, async () => {
      const session = this.requireSession();
      const { accountImplementation, configHash } = this.config;
      if (!accountImplementation || !configHash) throw new VeraKeyError("device", "This client cannot compute account addresses offline.");
      const nullifier = await this.nullifier(appId);
      const issuedAt = request.now ?? Math.floor(Date.now() / 1000);
      const statement: SignInStatement = {
        chainId: this.config.chainId,
        factory: this.config.factory,
        origin: request.origin,
        appId: toFieldHex(appId),
        nullifier: toFieldHex(nullifier),
        nonce: request.nonce,
        issuedAt,
        expiresAt: issuedAt + SIGN_IN_TTL_SECONDS,
      };
      const proverReady = this.prover();
      emit({ status: "authenticating" });
      let assertion;
      try {
        assertion = await getAssertion({
          rpId: this.config.rpId,
          challenge: hexToBytes(signInChallenge(statement)),
          credentialIds: [credentialIdBytes(session.passkey)],
        });
      } catch (error) {
        throw describeWebAuthnError(error);
      }
      if (assertion.authenticatorData.length !== AUTHENTICATOR_DATA_LENGTH) {
        throw new VeraKeyError("device", `This authenticator returned ${assertion.authenticatorData.length} bytes of authenticator data; VeraKey needs ${AUTHENTICATOR_DATA_LENGTH}.`);
      }
      emit({ status: "proving", startedAt: Date.now() });
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
      emit({ status: "idle" });
      return {
        version: 1,
        statement,
        playerId: statement.nullifier,
        account: accountAddressOf({ factory: this.config.factory, accountImplementation, configHash }, appId, nullifier),
        clientDataJSON: bytesToHex(assertion.clientDataJSON),
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      };
    });
  }

  /** Short, stable label for UI (never used for security decisions). */
  static shortCredentialId(passkey: StoredPasskey): string {
    return passkey.credentialId.slice(0, 8);
  }

  static credentialIdOf(bytes: Uint8Array): string {
    return base64UrlEncode(bytes);
  }
}
