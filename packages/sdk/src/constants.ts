/** "VERAKEY_NULLIFIER_V1" as a field element; must match `NULLIFIER_DOMAIN` in the circuit. */
export const NULLIFIER_DOMAIN = 0x564552414b45595f4e554c4c49464945525f5631n;

/** Order of the P-256 group; signatures are normalized to s <= n/2 because the circuit rejects high-s. */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** BN254 scalar field modulus: app ids and nullifiers must be canonical elements. */
export const BN254_R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

/**
 * `keccak256("VeraKeyAction(uint256 chainId,address account,uint256 nonce,uint8 kind,address target,uint256 amount,bytes32 dataHash,uint256 fee,uint64 deadline)")`
 */
export const ACTION_TYPEHASH =
  "0x49b7518511223ff24d5bc31d137cf0f65784f0570d50aee38dc053784e2b514d" as const;

/** The WebAuthn PRF input whose output salts every nullifier (see docs/THREAT_MODEL.md). */
export const PRF_SALT_LABEL = "VeraKey PRF nullifier salt v1";

/** Maximum lifetime of an authorization, enforced by the account (seconds). */
export const MAX_DEADLINE_WINDOW = 600;

export const ActionKind = {
  Pay: 1,
  ScheduleChange: 2,
  CancelChange: 3,
  CancelRecovery: 4,
  Restrict: 5,
} as const;
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export const ChangeKind = {
  AddOwner: 1,
  RemoveOwner: 2,
  SetLimits: 3,
  SetRecipient: 4,
  SetAllowlist: 5,
  /** payload: the guardian commitment (see `guardianCommitment`); zero removes the guardian */
  SetGuardian: 6,
  SetNewPayeeCap: 7,
  Freeze: 8,
  Unfreeze: 9,
} as const;

/** `keccak256("VeraKeyGuardian(address account,address guardian,bytes32 salt)")` */
export const GUARDIAN_TYPEHASH =
  "0xf33d4055d6c5cd8cf1e8584e7625a8e778a2e5abf8168ed8b7f88c28dbf6c8e8" as const;
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

/** USDG has 6 decimals. */
export const USDG_DECIMALS = 6;
