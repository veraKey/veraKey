//! Configuration changes: kinds, payload layouts, validation, and which changes may apply at once.
//!
//! Loosening a change (more spending, a new owner, another guardian, unfreezing) is scheduled with a
//! passkey proof and applied after the account's change delay, so a stolen-but-unlocked device cannot
//! silently raise limits, add owners or swap the guardian. Tightening a change (freezing, lowering a
//! limit, enabling the allowlist, removing a recipient, requiring the payment sheet) may apply
//! immediately: it can only reduce what the account can spend, which is what an owner wants the
//! moment a device goes missing.

use alloy_primitives::{Address, B256, U256};

use crate::field;

/// `bytes32 nullifier`
pub const ADD_OWNER: u8 = 1;
/// `bytes32 nullifier`
pub const REMOVE_OWNER: u8 = 2;
/// `uint256 perTxCap, uint256 dailyCap` (each at most `2^128 - 1`)
pub const SET_LIMITS: u8 = 3;
/// `address recipient, bool allowed`
pub const SET_RECIPIENT: u8 = 4;
/// `bool enabled`
pub const SET_ALLOWLIST: u8 = 5;
/// `bytes32 guardianCommitment` (see [`guardian_preimage`]; zero removes the guardian)
pub const SET_GUARDIAN: u8 = 6;
/// `uint256 newPayeeCap` (at most `2^128 - 1`): the largest first payment to an unknown recipient
pub const SET_NEW_PAYEE_CAP: u8 = 7;
/// empty payload: stop all payments
pub const FREEZE: u8 = 8;
/// empty payload: allow payments again (always timelocked)
pub const UNFREEZE: u8 = 9;
/// `bool required`: when set, `pay` accepts only Secure Payment Confirmation client data, so every
/// payment is confirmed in the browser's own sheet showing the payee and the total
pub const SET_PAYMENT_SHEET: u8 = 10;

/// `keccak256("VeraKeyGuardian(address account,address guardian,bytes32 salt)")`
pub const GUARDIAN_TYPEHASH: [u8; 32] = [
    0xf3, 0x3d, 0x40, 0x55, 0xd6, 0xc5, 0xcd, 0x8c, 0xf1, 0xe8, 0x58, 0x4e, 0x76, 0x25, 0xa8, 0xe7,
    0x78, 0xa2, 0xe5, 0xab, 0xf8, 0x16, 0x8e, 0xd8, 0xb7, 0xf8, 0x8c, 0x28, 0xdb, 0xf6, 0xc8, 0xe8,
];

/// `abi.encode(GUARDIAN_TYPEHASH, account, guardian, salt)`. The account stores only the keccak256 of
/// this, so the guardian's address stays private until the guardian acts, and one guardian used by
/// several accounts yields unrelated commitments (each account and salt differs).
pub fn guardian_preimage(account: Address, guardian: Address, salt: B256) -> [u8; 128] {
    let mut out = [0u8; 128];
    out[..32].copy_from_slice(&GUARDIAN_TYPEHASH);
    out[44..64].copy_from_slice(account.as_slice());
    out[76..96].copy_from_slice(guardian.as_slice());
    out[96..].copy_from_slice(salt.as_slice());
    out
}

/// Decodes an ABI `address` word, rejecting dirty high bytes.
pub fn word_address(word: &[u8]) -> Option<Address> {
    if word.len() != 32 || word[..12].iter().any(|b| *b != 0) {
        return None;
    }
    Some(Address::from_slice(&word[12..]))
}

/// Decodes an ABI `bool` word, rejecting anything but 0 or 1.
pub fn word_bool(word: &[u8]) -> Option<bool> {
    if word.len() != 32 || word[..31].iter().any(|b| *b != 0) {
        return None;
    }
    match word[31] {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

/// Decodes an ABI `uint256` word that must fit in 128 bits (the account stores limits as `u128`).
pub fn word_u128(word: &[u8]) -> Option<u128> {
    if word.len() != 32 || word[..16].iter().any(|b| *b != 0) {
        return None;
    }
    let mut low = [0u8; 16];
    low.copy_from_slice(&word[16..]);
    Some(u128::from_be_bytes(low))
}

/// Checks a change payload before it is scheduled, so a scheduled change can always be applied.
pub fn is_valid(kind: u8, payload: &[u8]) -> bool {
    match kind {
        ADD_OWNER | REMOVE_OWNER => {
            payload.len() == 32 && {
                let nullifier = B256::from_slice(payload);
                nullifier != B256::ZERO && field::is_field_element(nullifier)
            }
        }
        SET_LIMITS => {
            payload.len() == 64
                && match (word_u128(&payload[..32]), word_u128(&payload[32..])) {
                    (Some(per_tx), Some(daily)) => per_tx != 0 && per_tx <= daily,
                    _ => false,
                }
        }
        SET_RECIPIENT => {
            payload.len() == 64
                && word_address(&payload[..32]).is_some_and(|a| a != Address::ZERO)
                && word_bool(&payload[32..]).is_some()
        }
        SET_ALLOWLIST | SET_PAYMENT_SHEET => word_bool(payload).is_some(),
        SET_GUARDIAN => payload.len() == 32,
        SET_NEW_PAYEE_CAP => word_u128(payload).is_some(),
        FREEZE | UNFREEZE => payload.is_empty(),
        _ => false,
    }
}

/// Whether a change keeps every fee payable: a limits change may not lower the per-payment cap below the
/// account's largest fee, or the owners could no longer pay for any action through the relayer.
pub fn keeps_fees_payable(kind: u8, payload: &[u8], max_fee: U256) -> bool {
    kind != SET_LIMITS || (payload.len() == 64 && U256::from_be_slice(&payload[..32]) >= max_fee)
}

/// The limits a tightening change is compared against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub per_tx_cap: U256,
    pub daily_cap: U256,
    pub new_payee_cap: U256,
}

/// Whether a valid change only reduces what the account can do, so it may apply without a delay.
pub fn is_restrictive(kind: u8, payload: &[u8], current: &Limits) -> bool {
    if !is_valid(kind, payload) {
        return false;
    }
    match kind {
        SET_LIMITS => {
            U256::from_be_slice(&payload[..32]) <= current.per_tx_cap
                && U256::from_be_slice(&payload[32..]) <= current.daily_cap
        }
        SET_NEW_PAYEE_CAP => U256::from_be_slice(payload) <= current.new_payee_cap,
        SET_ALLOWLIST | SET_PAYMENT_SHEET => word_bool(payload) == Some(true),
        SET_RECIPIENT => word_bool(&payload[32..]) == Some(false),
        FREEZE => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{address, keccak256};

    fn word(b: u8) -> [u8; 32] {
        let mut w = [0u8; 32];
        w[31] = b;
        w
    }

    fn u(v: u64) -> U256 {
        U256::from(v)
    }

    fn limits_payload(per_tx: u64, daily: u64) -> [u8; 64] {
        let mut p = [0u8; 64];
        p[..32].copy_from_slice(&u(per_tx).to_be_bytes::<32>());
        p[32..].copy_from_slice(&u(daily).to_be_bytes::<32>());
        p
    }

    const CURRENT: Limits = Limits {
        per_tx_cap: U256::from_limbs([10, 0, 0, 0]),
        daily_cap: U256::from_limbs([25, 0, 0, 0]),
        new_payee_cap: U256::from_limbs([2, 0, 0, 0]),
    };

    #[test]
    fn guardian_typehash_matches_signature_string() {
        let expected = keccak256("VeraKeyGuardian(address account,address guardian,bytes32 salt)");
        assert_eq!(expected.0, GUARDIAN_TYPEHASH);
    }

    #[test]
    fn guardian_preimage_is_abi_encoded() {
        let account = address!("00000000000000000000000000000000000000aa");
        let guardian = address!("00000000000000000000000000000000000000bb");
        let salt = B256::repeat_byte(0x11);
        let pre = guardian_preimage(account, guardian, salt);
        assert_eq!(&pre[..32], &GUARDIAN_TYPEHASH);
        assert_eq!(pre[63], 0xaa);
        assert!(pre[32..63].iter().all(|b| *b == 0));
        assert_eq!(pre[95], 0xbb);
        assert!(pre[64..95].iter().all(|b| *b == 0));
        assert_eq!(&pre[96..], salt.as_slice());
        // The same guardian gives unrelated commitments for two accounts.
        let other = guardian_preimage(address!("00000000000000000000000000000000000000cc"), guardian, salt);
        assert_ne!(keccak256(pre), keccak256(other));
    }

    #[test]
    fn owner_changes_need_a_canonical_nonzero_nullifier() {
        assert!(is_valid(ADD_OWNER, &word(7)));
        assert!(is_valid(REMOVE_OWNER, &word(7)));
        assert!(!is_valid(ADD_OWNER, &[0u8; 32]));
        assert!(!is_valid(ADD_OWNER, &[0xffu8; 32]));
        assert!(!is_valid(ADD_OWNER, &[1u8; 31]));
    }

    #[test]
    fn limits_need_per_tx_at_most_daily_and_128_bits() {
        assert!(is_valid(SET_LIMITS, &limits_payload(5, 10)));
        assert!(!is_valid(SET_LIMITS, &limits_payload(11, 10)));
        assert!(!is_valid(SET_LIMITS, &limits_payload(0, 10)));
        let mut too_big = limits_payload(5, 10);
        too_big[32 + 15] = 1; // daily cap = 2^128 + 10
        assert!(!is_valid(SET_LIMITS, &too_big));
    }

    #[test]
    fn recipient_words_must_be_clean() {
        let mut recipient = [0u8; 64];
        recipient[31] = 0xaa;
        recipient[63] = 1;
        assert!(is_valid(SET_RECIPIENT, &recipient));
        recipient[0] = 1;
        assert!(!is_valid(SET_RECIPIENT, &recipient));
        let mut zero_recipient = [0u8; 64];
        zero_recipient[63] = 1;
        assert!(!is_valid(SET_RECIPIENT, &zero_recipient));
    }

    #[test]
    fn bool_guardian_new_payee_and_freeze_payloads() {
        assert!(is_valid(SET_ALLOWLIST, &word(1)));
        assert!(!is_valid(SET_ALLOWLIST, &word(2)));
        assert!(is_valid(SET_GUARDIAN, &[0u8; 32]));
        assert!(is_valid(SET_GUARDIAN, &[0xabu8; 32]));
        assert!(!is_valid(SET_GUARDIAN, &[0u8; 20]));
        assert!(is_valid(SET_NEW_PAYEE_CAP, &word(0)));
        assert!(!is_valid(SET_NEW_PAYEE_CAP, &[0xffu8; 32]));
        assert!(is_valid(FREEZE, &[]));
        assert!(is_valid(UNFREEZE, &[]));
        assert!(!is_valid(FREEZE, &word(1)));
        assert!(is_valid(SET_PAYMENT_SHEET, &word(1)));
        assert!(is_valid(SET_PAYMENT_SHEET, &word(0)));
        assert!(!is_valid(SET_PAYMENT_SHEET, &word(2)));
        assert!(!is_valid(SET_PAYMENT_SHEET, &[]));
        assert!(!is_valid(99, &word(1)));
    }

    #[test]
    fn limits_never_drop_below_the_largest_fee() {
        assert!(keeps_fees_payable(SET_LIMITS, &limits_payload(5, 10), u(5)));
        assert!(!keeps_fees_payable(SET_LIMITS, &limits_payload(4, 10), u(5)));
        // Other kinds are unaffected.
        assert!(keeps_fees_payable(SET_NEW_PAYEE_CAP, &word(0), u(5)));
        assert!(keeps_fees_payable(FREEZE, &[], u(5)));
    }

    #[test]
    fn only_tightening_changes_are_restrictive() {
        assert!(is_restrictive(SET_LIMITS, &limits_payload(5, 20), &CURRENT));
        assert!(is_restrictive(SET_LIMITS, &limits_payload(10, 25), &CURRENT));
        assert!(!is_restrictive(SET_LIMITS, &limits_payload(11, 25), &CURRENT));
        assert!(!is_restrictive(SET_LIMITS, &limits_payload(5, 26), &CURRENT));
        assert!(is_restrictive(SET_NEW_PAYEE_CAP, &word(1), &CURRENT));
        assert!(!is_restrictive(SET_NEW_PAYEE_CAP, &word(3), &CURRENT));
        assert!(is_restrictive(SET_ALLOWLIST, &word(1), &CURRENT));
        assert!(!is_restrictive(SET_ALLOWLIST, &word(0), &CURRENT));
        let mut remove = [0u8; 64];
        remove[31] = 0xaa;
        assert!(is_restrictive(SET_RECIPIENT, &remove, &CURRENT));
        remove[63] = 1;
        assert!(!is_restrictive(SET_RECIPIENT, &remove, &CURRENT));
        assert!(is_restrictive(FREEZE, &[], &CURRENT));
        assert!(!is_restrictive(UNFREEZE, &[], &CURRENT));
        assert!(is_restrictive(SET_PAYMENT_SHEET, &word(1), &CURRENT));
        assert!(!is_restrictive(SET_PAYMENT_SHEET, &word(0), &CURRENT));
        assert!(!is_restrictive(ADD_OWNER, &word(7), &CURRENT));
        assert!(!is_restrictive(REMOVE_OWNER, &word(7), &CURRENT));
        assert!(!is_restrictive(SET_GUARDIAN, &[0u8; 32], &CURRENT));
        // Invalid payloads are never restrictive.
        assert!(!is_restrictive(SET_LIMITS, &limits_payload(0, 0), &CURRENT));
    }
}
