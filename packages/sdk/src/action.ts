import { concat, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { ACTION_TYPEHASH, GUARDIAN_TYPEHASH, type ActionKind, type ChangeKind, ChangeKind as Change } from "./constants";

/** Everything a passkey authorizes; hashed into the WebAuthn challenge. Mirrors `verakey_core::action`. */
export interface Action {
  chainId: bigint | number;
  account: Address;
  nonce: bigint;
  kind: ActionKind;
  target: Address;
  amount: bigint;
  dataHash: Hex;
  fee: bigint;
  deadline: bigint | number;
}

const ACTION_LAYOUT = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
  { type: "uint256" },
  { type: "uint8" },
  { type: "address" },
  { type: "uint256" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "uint64" },
] as const;

export function encodeAction(action: Action): Hex {
  return encodeAbiParameters(ACTION_LAYOUT, [
    ACTION_TYPEHASH,
    BigInt(action.chainId),
    action.account,
    action.nonce,
    action.kind,
    action.target,
    action.amount,
    action.dataHash,
    action.fee,
    BigInt(action.deadline),
  ]);
}

/** The 32-byte WebAuthn challenge for `action`. */
export function hashAction(action: Action): Hex {
  return keccak256(encodeAction(action));
}

export const ZERO_HASH = `0x${"00".repeat(32)}` as const satisfies Hex;

/** `keccak256(changeKind ‖ payload)`, the dataHash of a ScheduleChange action. */
export function changeDataHash(kind: ChangeKind, payload: Hex): Hex {
  return keccak256(concat([toHex(kind, { size: 1 }), payload]));
}

/**
 * ABI payloads for configuration changes (see `verakey_core::changes`). Loosening changes go through
 * `scheduleChange` (timelocked); tightening ones (freeze, lower limits, enable the allowlist, remove a
 * recipient) may go through `restrict` and apply at once.
 */
export const changePayload = {
  addOwner: (nullifier: Hex) => ({ kind: Change.AddOwner, payload: nullifier }),
  removeOwner: (nullifier: Hex) => ({ kind: Change.RemoveOwner, payload: nullifier }),
  setLimits: (perTxCap: bigint, dailyCap: bigint) => ({
    kind: Change.SetLimits,
    payload: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [perTxCap, dailyCap]),
  }),
  setRecipient: (recipient: Address, allowed: boolean) => ({
    kind: Change.SetRecipient,
    payload: encodeAbiParameters([{ type: "address" }, { type: "bool" }], [recipient, allowed]),
  }),
  setAllowlist: (enabled: boolean) => ({
    kind: Change.SetAllowlist,
    payload: encodeAbiParameters([{ type: "bool" }], [enabled]),
  }),
  /** `commitment` from `guardianCommitment`; the zero hash removes the guardian. */
  setGuardian: (commitment: Hex) => ({ kind: Change.SetGuardian, payload: commitment }),
  setNewPayeeCap: (cap: bigint) => ({
    kind: Change.SetNewPayeeCap,
    payload: encodeAbiParameters([{ type: "uint256" }], [cap]),
  }),
  freeze: () => ({ kind: Change.Freeze, payload: "0x" as Hex }),
  unfreeze: () => ({ kind: Change.Unfreeze, payload: "0x" as Hex }),
} as const;

/**
 * The commitment an account stores instead of its guardian's address:
 * `keccak256(abi.encode(GUARDIAN_TYPEHASH, account, guardian, salt))`. The guardian proves itself by
 * calling from `guardian` with `salt`, which reveals it for this account only.
 */
export function guardianCommitment(account: Address, guardian: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      [GUARDIAN_TYPEHASH, account, guardian, salt]
    )
  );
}

/** WebAuthn L3 `clientDataJSON` serialization a browser produces for `challenge` at `origin`. */
export function expectedClientDataPrefix(challengeB64Url: string, origin: string): string {
  return `{"type":"webauthn.get","challenge":"${challengeB64Url}","origin":"${origin}"`;
}
