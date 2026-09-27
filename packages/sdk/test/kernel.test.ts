import { describe, expect, it } from "vitest";
import { decodeAbiParameters, type Address, type Hex } from "viem";
import { getUserOperationHash, type UserOperation } from "viem/account-abstraction";
import { toFieldHex } from "../src/bytes";
import { ENTRY_POINT_07, VERAKEY_PROOF_BYTES, toVeraKeyKernelValidator } from "../src/kernel";
import { appIdFromName } from "../src/nullifier";
import { validatorInstallData, validatorSignature } from "../src/validator";

const VALIDATOR: Address = "0xcc96c0C520Fc6E8a068f5e2A74aBa7cAab8d9b6C";
const appId = toFieldHex(appIdFromName("pay"));
const nullifier = toFieldHex(12_345n);
const operation: UserOperation<"0.7"> = {
  sender: "0x1111111111111111111111111111111111111111",
  nonce: 0n,
  factory: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9",
  factoryData: "0x1234",
  callData: "0xabcdef",
  callGasLimit: 150_000n,
  verificationGasLimit: 1_400_000n,
  preVerificationGas: 100_000n,
  maxFeePerGas: 100_000_000n,
  maxPriorityFeePerGas: 0n,
  signature: "0x",
};
const userOpHash = (chainId: number) =>
  getUserOperationHash({ userOperation: { ...operation, signature: "0x" }, entryPointAddress: ENTRY_POINT_07, entryPointVersion: "0.7", chainId });

/** A passkey that records what it was asked to prove. */
function recordingPasskey() {
  const challenges: Hex[] = [];
  return {
    challenges,
    prove: async (challenge: Hex) => {
      challenges.push(challenge);
      return { proof: "0xaaaa" as Hex, clientDataJSON: "0xbbbb" as Hex };
    },
  };
}

describe("toVeraKeyKernelValidator", () => {
  it("installs the owner's per-app nullifier, as VeraKeyValidator's onInstall expects", async () => {
    const validator = toVeraKeyKernelValidator({ validator: VALIDATOR, chainId: 421614, appId, nullifier, prove: recordingPasskey().prove });
    expect(await validator.getEnableData()).toBe(validatorInstallData(appId, nullifier));
    expect(validator.getIdentifier()).toBe(VALIDATOR);
    expect(validator.address).toBe(VALIDATOR);
    expect(validator.validatorType).toBe("SECONDARY");
    expect(await validator.getNonceKey()).toBe(0n);
    expect(await validator.getNonceKey(undefined, 7n)).toBe(7n);
  });

  it("has the passkey prove exactly the EntryPoint v0.7 userOpHash, and signs with the proof and its client data", async () => {
    const passkey = recordingPasskey();
    const validator = toVeraKeyKernelValidator({ validator: VALIDATOR, chainId: 421614, appId, nullifier, prove: passkey.prove });
    // A signature already on the operation (e.g. the stub used for gas estimation) is not part of the hash.
    const signature = await validator.signUserOperation({ ...operation, signature: "0xdeadbeef" });
    expect(passkey.challenges).toEqual([userOpHash(421614)]);
    expect(signature).toBe(validatorSignature("0xaaaa", "0xbbbb"));
  });

  it("proves for the chain the operation names, when it names one", async () => {
    const passkey = recordingPasskey();
    const validator = toVeraKeyKernelValidator({ validator: VALIDATOR, chainId: 421614, appId, nullifier, prove: passkey.prove });
    await validator.signUserOperation({ ...operation, chainId: 42161 });
    expect(passkey.challenges).toEqual([userOpHash(42161)]);
  });

  it("estimates gas with a stub signature the size of a real one", async () => {
    const validator = toVeraKeyKernelValidator({ validator: VALIDATOR, chainId: 421614, appId, nullifier, prove: recordingPasskey().prove });
    const [proof, clientDataJSON] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], await validator.getStubSignature(operation));
    expect((proof.length - 2) / 2).toBe(VERAKEY_PROOF_BYTES);
    expect((clientDataJSON.length - 2) / 2).toBeGreaterThanOrEqual(128);
  });

  it("refuses to sign messages or transactions rather than sign something the account cannot verify", async () => {
    const validator = toVeraKeyKernelValidator({ validator: VALIDATOR, chainId: 421614, appId, nullifier, prove: recordingPasskey().prove });
    await expect(validator.signMessage({ message: "hello" })).rejects.toThrow(/ERC-1271/);
    await expect(validator.signTransaction({ to: VALIDATOR })).rejects.toThrow(/user operations/);
  });
});
