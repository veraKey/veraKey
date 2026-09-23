// End-to-end harness: a virtual platform authenticator, chain clients for the local nitro devnode,
// and helpers that build real proofs for real VeraKey contracts.
import { readFileSync } from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  hashAction,
  hexToBytes,
  normalizeLowS,
  sha256,
  toFieldHex,
  veraKeyAccountAbi,
  type Action,
  type PasskeyAssertion,
  type PasskeyPublicKey,
  type VeraKeyProver,
} from "../../src";

export const deployment = JSON.parse(
  readFileSync(new URL("../../../../deployments/local.json", import.meta.url), "utf8")
) as {
  chainId: number;
  rpcUrl: string;
  rpId: string;
  origin: string;
  rpIdHash: Hex;
  contracts: {
    honkVerifier: Address;
    accountImplementation: Address;
    factory: Address;
    factoryAlt: Address;
    usdg: Address;
  };
  policy: { perTxCap: string; dailyCap: string; changeDelay: number; recoveryDelay: number };
};

export const chain = defineChain({
  id: deployment.chainId,
  name: "nitro-devnode",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
});

export const publicClient = createPublicClient({ chain, transport: http(), pollingInterval: 200 });

/** Public nitro-devnode key (funded on every devnode). */
const DEV_KEY = "0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659";
export const devAccount = privateKeyToAccount(DEV_KEY);

export function walletFor(account: PrivateKeyAccount) {
  return createWalletClient({ chain, transport: http(), account });
}

export const USDG = (whole: number) => BigInt(Math.round(whole * 1_000_000));

interface SignOptions {
  origin?: string;
  type?: string;
  /** Appended after the standard keys, the way Chrome injects `other_keys_can_be_added_here`. */
  extraJson?: string;
  flags?: number;
}

/**
 * Emulates a synced platform passkey (iCloud Keychain / Google Password Manager): ES256 key,
 * flags UP|UV|BE|BS, signCount 0, and a per-credential PRF secret.
 */
export class VirtualPasskey {
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly publicKey: PasskeyPublicKey,
    readonly prfSecret: Uint8Array,
    readonly rpId: string
  ) {}

  static async create(rpId = deployment.rpId): Promise<VirtualPasskey> {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    return new VirtualPasskey(
      pair.privateKey,
      { x: raw.slice(1, 33), y: raw.slice(33, 65) },
      crypto.getRandomValues(new Uint8Array(32)),
      rpId
    );
  }

  async sign(challenge: Uint8Array, options: SignOptions = {}): Promise<PasskeyAssertion> {
    const rpIdHash = await sha256(new TextEncoder().encode(this.rpId));
    const authenticatorData = concatBytes(rpIdHash, new Uint8Array([options.flags ?? 0x1d]), new Uint8Array(4));
    const json =
      `{"type":"${options.type ?? "webauthn.get"}","challenge":"${base64UrlEncode(challenge)}",` +
      `"origin":"${options.origin ?? deployment.origin}","crossOrigin":false${options.extraJson ?? ""}}`;
    const clientDataJSON = new TextEncoder().encode(json);
    const signed = concatBytes(authenticatorData, await sha256(clientDataJSON));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.privateKey, signed)
    );
    return {
      credentialId: new Uint8Array(16),
      authenticatorData,
      clientDataJSON,
      signature: normalizeLowS(raw),
      prfSecret: this.prfSecret,
    };
  }
}

export interface Owner {
  passkey: VirtualPasskey;
  nullifier: bigint;
}

export interface Authorization {
  actionHash: Hex;
  clientDataJSON: Hex;
  proof: Hex;
  provingMs: number;
}

/** Signs `action` (at the account's current nonce unless overridden) and proves it. */
export async function authorize(
  prover: VeraKeyProver,
  owner: Owner,
  appId: bigint,
  account: Address,
  action: Omit<Action, "chainId" | "account" | "nonce"> & { nonce?: bigint },
  sign: SignOptions & { hashAccount?: Address; chainId?: number } = {}
): Promise<Authorization> {
  const nonce =
    action.nonce ??
    (await publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "nonce" }));
  const actionHash = hashAction({
    ...action,
    nonce,
    chainId: sign.chainId ?? deployment.chainId,
    account: sign.hashAccount ?? account,
  });
  const assertion = await owner.passkey.sign(hexToBytes(actionHash), sign);
  const proof = await prover.prove({
    publicKey: owner.passkey.publicKey,
    signature: assertion.signature,
    authenticatorData: assertion.authenticatorData,
    prfSecret: owner.passkey.prfSecret,
    clientDataJSON: assertion.clientDataJSON,
    rpIdHash: hexToBytes(deployment.rpIdHash),
    appId,
    nullifier: owner.nullifier,
  });
  return {
    actionHash,
    clientDataJSON: bytesToHex(assertion.clientDataJSON),
    proof: proof.proof,
    provingMs: proof.provingMs,
  };
}

/** Name of the custom error a failed simulation reverted with (e.g. "PerTxCapExceeded"). */
export async function revertName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BaseError) {
      const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        return revert.data?.errorName ?? revert.signature ?? "UnknownRevert";
      }
      return "Reverted";
    }
    throw error;
  }
  throw new Error("expected a revert, but the call succeeded");
}

export const fieldHex = (value: bigint) => toFieldHex(value);

/** Timestamp of the latest block; `eth_call` simulations run against it. */
export async function chainNow(): Promise<bigint> {
  return (await publicClient.getBlock()).timestamp;
}

/**
 * Waits until the chain has a block past `timestamp`. Nitro dev mode only produces blocks when
 * transactions arrive, so after the wall clock passes `timestamp` a no-op transaction mints a block.
 */
export async function waitForChainTime(timestamp: bigint): Promise<void> {
  for (;;) {
    if (BigInt(Math.floor(Date.now() / 1000)) > timestamp) {
      const hash = await walletFor(devAccount).sendTransaction({ to: devAccount.address, value: 0n });
      await publicClient.waitForTransactionReceipt({ hash });
      if ((await chainNow()) > timestamp) return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
