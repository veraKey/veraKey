import { type Address, type Hex } from "viem";
import { getUserOperationHash, type UserOperation } from "viem/account-abstraction";
import { toAccount, type LocalAccount } from "viem/accounts";
import { validatorInstallData, validatorSignature } from "./validator";

/**
 * VeraKey passkeys for ZeroDev Kernel v3 accounts: a validator plugin, in the shape ZeroDev's
 * `createKernelAccount(client, { plugins: { sudo } })` takes, backed by `VeraKeyValidator` (ERC-7579).
 *
 * The account installs the validator with the owner's per-app nullifier. Each user operation is
 * authorized by an UltraHonk proof that the passkey signed its userOpHash, so the chain never sees the
 * passkey's public key or signature. It depends on viem only: ZeroDev's SDK builds and sends the account,
 * and `prove` is where the passkey signs and the browser proves.
 */

/** EntryPoint v0.7, the version whose `PackedUserOperation` VeraKeyValidator validates. */
export const ENTRY_POINT_07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** The size of a VeraKey UltraHonk proof (bb 5.2.0, EVM transcript). */
export const VERAKEY_PROOF_BYTES = 8768;

/**
 * Signs `challenge` with the passkey and proves the assertion: the proof and the browser's clientDataJSON.
 * In a browser: `getAssertion` with the challenge, then the VeraKey prover (see the Validator docs).
 */
export type VeraKeyChallengeProver = (challenge: Hex) => Promise<{ proof: Hex; clientDataJSON: Hex }>;

export type VeraKeyKernelValidatorParams = {
  /** The VeraKeyValidator deployed for your relying party (`contracts.veraKeyValidator` in the deployment). */
  validator: Address;
  /** The chain the account lives on, for the userOpHash when an operation does not name one. */
  chainId: number;
  /** The app's id and the owner's nullifier in it, as field elements (32-byte hex). */
  appId: Hex;
  nullifier: Hex;
  prove: VeraKeyChallengeProver;
  /** ZeroDev's Kernel version range this plugin serves. */
  supportedKernelVersions?: string;
};

/** A ZeroDev `KernelValidator`: viem's LocalAccount plus the plugin hooks Kernel's SDK calls. */
export type VeraKeyKernelValidator = LocalAccount<"VeraKeyValidator"> & {
  validatorType: "SECONDARY";
  supportedKernelVersions: string;
  getIdentifier(): Hex;
  getEnableData(accountAddress?: Address): Promise<Hex>;
  getNonceKey(accountAddress?: Address, customNonceKey?: bigint): Promise<bigint>;
  getStubSignature(userOperation?: UserOperation<"0.7">): Promise<Hex>;
  signUserOperation(userOperation: UserOperation<"0.7"> & { chainId?: number }): Promise<Hex>;
  isEnabled(accountAddress: Address, selector: Hex): Promise<boolean>;
};

/** A signature of the real size, for gas estimates made before the passkey signs. */
const STUB_SIGNATURE = validatorSignature(`0x${"00".repeat(VERAKEY_PROOF_BYTES)}`, `0x${"00".repeat(160)}`);

export function toVeraKeyKernelValidator(params: VeraKeyKernelValidatorParams): VeraKeyKernelValidator {
  const account = toAccount({
    address: params.validator,
    async signMessage() {
      // Kernel wraps a message in its own EIP-712 domain before VeraKeyValidator sees it, and the challenge
      // binds the account's address, which a plugin does not know. Sign user operations instead.
      throw new Error("VeraKey's Kernel plugin does not sign messages yet (ERC-1271): it signs user operations.");
    },
    async signTransaction() {
      throw new Error("A Kernel account moves funds through user operations, never through transactions it signs.");
    },
    async signTypedData() {
      throw new Error("VeraKey's Kernel plugin does not sign typed data yet (ERC-1271): it signs user operations.");
    },
  });
  return {
    ...account,
    source: "VeraKeyValidator",
    address: params.validator,
    validatorType: "SECONDARY",
    supportedKernelVersions: params.supportedKernelVersions ?? ">=0.3.0",
    getIdentifier: () => params.validator,
    getEnableData: async () => validatorInstallData(params.appId, params.nullifier),
    getNonceKey: async (_accountAddress, customNonceKey) => customNonceKey ?? 0n,
    getStubSignature: async () => STUB_SIGNATURE,
    async signUserOperation({ chainId, ...userOperation }) {
      const userOpHash = getUserOperationHash({
        userOperation: { ...userOperation, signature: "0x" },
        entryPointAddress: ENTRY_POINT_07,
        entryPointVersion: "0.7",
        chainId: chainId ?? params.chainId,
      });
      const { proof, clientDataJSON } = await params.prove(userOpHash);
      return validatorSignature(proof, clientDataJSON);
    },
    isEnabled: async () => false,
  };
}
