//! Timelocked configuration changes: kinds, payload layouts and validation.
//!
//! A change is scheduled with a passkey proof and applied after the account's change delay, so a
//! stolen-but-unlocked device cannot silently raise limits, add owners or swap the guardian.

use alloy_primitives::{Address, B256, U256};

use crate::field;

/// `bytes32 nullifier`
pub const ADD_OWNER: u8 = 1;
/// `bytes32 nullifier`
pub const REMOVE_OWNER: u8 = 2;
/// `uint256 perTxCap, uint256 dailyCap`
pub const SET_LIMITS: u8 = 3;
/// `address recipient, bool allowed`
pub const SET_RECIPIENT: u8 = 4;
/// `bool enabled`
pub const SET_ALLOWLIST: u8 = 5;
/// `address guardian` (zero removes the guardian)
pub const SET_GUARDIAN: u8 = 6;

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
            payload.len() == 64 && {
                let per_tx = U256::from_be_slice(&payload[..32]);
                let daily = U256::from_be_slice(&payload[32..]);
                !per_tx.is_zero() && per_tx <= daily
            }
        }
        SET_RECIPIENT => {
            payload.len() == 64
                && word_address(&payload[..32]).is_some_and(|a| a != Address::ZERO)
                && word_bool(&payload[32..]).is_some()
        }
        SET_ALLOWLIST => word_bool(payload).is_some(),
        SET_GUARDIAN => word_address(payload).is_some(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(b: u8) -> [u8; 32] {
        let mut w = [0u8; 32];
        w[31] = b;
        w
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
    fn limits_need_per_tx_at_most_daily() {
        let mut limits = [0u8; 64];
        limits[31] = 5;
        limits[63] = 10;
        assert!(is_valid(SET_LIMITS, &limits));
        limits[31] = 11;
        assert!(!is_valid(SET_LIMITS, &limits));
        limits[31] = 0;
        assert!(!is_valid(SET_LIMITS, &limits));
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
    fn bool_and_guardian_words() {
        assert!(is_valid(SET_ALLOWLIST, &word(1)));
        assert!(!is_valid(SET_ALLOWLIST, &word(2)));
        assert!(is_valid(SET_GUARDIAN, &[0u8; 32]));
        let mut dirty = [0u8; 32];
        dirty[0] = 1;
        assert!(!is_valid(SET_GUARDIAN, &dirty));
        assert!(!is_valid(99, &word(1)));
    }
}
