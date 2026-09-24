import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";

/**
 * VeraKey proofs for ERC-7579 smart accounts (ZeroDev Kernel, Biconomy Nexus) through
 * `contracts/evm/src/modules/VeraKeyValidator.sol`. The account installs the module with
 * `abi.encode(appId, nullifier)`; a user operation is signed by proving a passkey assertion whose
 * challenge is the userOpHash, and the signature is `abi.encode(proof, clientDataJSON)`.
 */

/** `keccak256("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)")` */
export const VALIDATOR_ERC1271_TYPEHASH = keccak256(stringToHex("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)"));

/**
 * The WebAuthn challenge for an ERC-1271 signature over `hash` by `account` on `chainId`. Wallets sign
 * this, never the raw hash: it binds the chain and the account, so a signature made for one account
 * cannot be replayed to another account that installed the same (public) nullifier.
 */
export function validatorErc1271Challenge(account: Address, hash: Hex, chainId: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [VALIDATOR_ERC1271_TYPEHASH, BigInt(chainId), account, hash]
    )
  );
}

/** `onInstall` data for an account whose owner is `nullifier` in `appId`. */
export function validatorInstallData(appId: Hex, nullifier: Hex): Hex {
  return encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [appId, nullifier]);
}

/** The user operation (or ERC-1271) signature the module decodes. */
export function validatorSignature(proof: Hex, clientDataJSON: Hex): Hex {
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [proof, clientDataJSON]);
}

/**
 * Set `verificationGasLimit` explicitly. A valid proof needs about 732k gas inside the module; with
 * less, it returns SIG_VALIDATION_FAILED instead of running out of gas, so bundler estimates made with
 * a dummy signature come out far too low. Add the account's own validation overhead on top.
 */
export const VALIDATOR_VERIFICATION_GAS = 850_000n;
