//! Unpadded base64url (RFC 4648 §5), the encoding WebAuthn uses for the challenge in
//! `clientDataJSON`.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Length of an unpadded base64url encoding of 32 bytes.
pub const ENCODED_32_LEN: usize = 43;

/// Encodes a 32-byte challenge as 43 unpadded base64url characters.
pub fn encode_32(input: &[u8; 32]) -> [u8; ENCODED_32_LEN] {
    let mut out = [0u8; ENCODED_32_LEN];
    let mut o = 0;
    // 10 full 3-byte groups (30 bytes) -> 40 characters.
    let mut i = 0;
    while i < 30 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | input[i + 2] as u32;
        out[o] = ALPHABET[(n >> 18) as usize & 63];
        out[o + 1] = ALPHABET[(n >> 12) as usize & 63];
        out[o + 2] = ALPHABET[(n >> 6) as usize & 63];
        out[o + 3] = ALPHABET[n as usize & 63];
        i += 3;
        o += 4;
    }
    // Remaining 2 bytes -> 3 characters, no padding.
    let n = ((input[30] as u32) << 16) | ((input[31] as u32) << 8);
    out[40] = ALPHABET[(n >> 18) as usize & 63];
    out[41] = ALPHABET[(n >> 12) as usize & 63];
    out[42] = ALPHABET[(n >> 6) as usize & 63];
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_zero_challenge() {
        assert_eq!(
            &encode_32(&[0u8; 32]),
            b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
    }

    #[test]
    fn encodes_all_ones_with_url_safe_alphabet() {
        // 0xff.. uses the last alphabet characters ('_'), never '/' or '+'.
        assert_eq!(
            &encode_32(&[0xffu8; 32]),
            b"__________________________________________8"
        );
    }

    #[test]
    fn matches_known_vector() {
        // sha256("abc"), base64url without padding.
        let digest: [u8; 32] = [
            0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
            0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
            0xf2, 0x00, 0x15, 0xad,
        ];
        assert_eq!(
            &encode_32(&digest),
            b"ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
    }
}
