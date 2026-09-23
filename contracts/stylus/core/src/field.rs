//! BN254 scalar-field helpers for the proof's public inputs.

use alloy_primitives::{B256, U256};

/// The BN254 scalar field modulus (the field UltraHonk public inputs live in).
pub const BN254_R: U256 = U256::from_limbs([
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
]);

/// True when `value` is a canonical BN254 scalar field element.
pub fn is_field_element(value: B256) -> bool {
    U256::from_be_bytes(value.0) < BN254_R
}

/// Splits a 32-byte hash into two public inputs holding its high and low 16 bytes. Each limb is
/// right-aligned in a 32-byte word, so both are below 2^128 and always canonical field elements.
pub fn split_limbs(hash: &[u8; 32]) -> (B256, B256) {
    let mut hi = [0u8; 32];
    let mut lo = [0u8; 32];
    hi[16..].copy_from_slice(&hash[..16]);
    lo[16..].copy_from_slice(&hash[16..]);
    (B256::from(hi), B256::from(lo))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modulus_is_bn254_r() {
        assert_eq!(
            BN254_R,
            "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001"
                .parse::<U256>()
                .unwrap()
        );
    }

    #[test]
    fn rejects_non_canonical_values() {
        assert!(is_field_element(B256::from(BN254_R - U256::from(1))));
        assert!(!is_field_element(B256::from(BN254_R)));
        assert!(!is_field_element(B256::repeat_byte(0xff)));
    }

    #[test]
    fn splits_into_right_aligned_limbs() {
        let mut h = [0u8; 32];
        for (i, b) in h.iter_mut().enumerate() {
            *b = i as u8 + 1;
        }
        let (hi, lo) = split_limbs(&h);
        assert_eq!(&hi[..16], &[0u8; 16]);
        assert_eq!(&hi[16..], &h[..16]);
        assert_eq!(&lo[..16], &[0u8; 16]);
        assert_eq!(&lo[16..], &h[16..]);
    }
}
