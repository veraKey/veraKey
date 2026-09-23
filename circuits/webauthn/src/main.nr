// VeraKey WebAuthn circuit.
//
// Proves, without revealing the passkey public key, its signature or the PRF secret:
//   1. authenticatorData.rpIdHash equals the public rpIdHash;
//   2. the user-present (UP) and user-verified (UV) flags are set;
//   3. the signature is a valid ES256 (P-256) signature over
//      sha256(authenticatorData || clientDataHash) under the hidden public key;
//   4. nullifier = Poseidon2(domain, pk_x, pk_y, prf_secret, app_id), all as 128-bit limbs.
//
// clientDataJSON itself stays public: the Stylus account parses it, checks that its challenge is
// the action hash, and passes sha256(clientDataJSON) in as `client_data_hash_{hi,lo}`.
mod test_vectors;
mod tests;

use poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256r1::verify_signature;
use std::hash::sha256_compression;

global SHA256_IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

// "VERAKEY_NULLIFIER_V1" as a big-endian field element.
global NULLIFIER_DOMAIN: Field = 0x564552414b45595f4e554c4c49464945525f5631;

global FLAG_USER_PRESENT: u8 = 0x01;
global FLAG_USER_VERIFIED: u8 = 0x04;
// Attested credential data (AT) and extension data (ED) would make authenticatorData longer
// than 37 bytes; assertions produced without extensions never set them.
global FLAGS_VARIABLE_LENGTH: u8 = 0xC0;

fn be_word(b0: u8, b1: u8, b2: u8, b3: u8) -> u32 {
    ((b0 as u32) << 24) | ((b1 as u32) << 16) | ((b2 as u32) << 8) | (b3 as u32)
}

// Splits into big-endian 16-byte limbs; each limb is range-checked to 128 bits.
fn bytes32_from_limbs(hi: Field, lo: Field) -> [u8; 32] {
    let h: [u8; 16] = hi.to_be_bytes();
    let l: [u8; 16] = lo.to_be_bytes();
    let mut out = [0 as u8; 32];
    for i in 0..16 {
        out[i] = h[i];
        out[16 + i] = l[i];
    }
    out
}

fn limbs_from_bytes32(b: [u8; 32]) -> (Field, Field) {
    let mut hi: Field = 0;
    let mut lo: Field = 0;
    for i in 0..16 {
        hi = hi * 256 + b[i] as Field;
        lo = lo * 256 + b[16 + i] as Field;
    }
    (hi, lo)
}

// SHA-256 of the 69-byte WebAuthn signing input (37 + 32 bytes): two compression rounds.
pub fn webauthn_message_hash(auth: [u8; 37], client_data_hash: [u8; 32]) -> [u8; 32] {
    let mut msg = [0 as u8; 128];
    for i in 0..37 {
        msg[i] = auth[i];
    }
    for i in 0..32 {
        msg[37 + i] = client_data_hash[i];
    }
    msg[69] = 0x80;
    // Message length in bits: 69 * 8 = 552 = 0x0228.
    msg[126] = 0x02;
    msg[127] = 0x28;
    let mut block1 = [0 as u32; 16];
    let mut block2 = [0 as u32; 16];
    for i in 0..16 {
        block1[i] = be_word(msg[4 * i], msg[4 * i + 1], msg[4 * i + 2], msg[4 * i + 3]);
        block2[i] = be_word(
            msg[64 + 4 * i],
            msg[64 + 4 * i + 1],
            msg[64 + 4 * i + 2],
            msg[64 + 4 * i + 3],
        );
    }
    let state = sha256_compression(block2, sha256_compression(block1, SHA256_IV));
    let mut out = [0 as u8; 32];
    for i in 0..8 {
        let w = state[i];
        out[4 * i] = (w >> 24) as u8;
        out[4 * i + 1] = (w >> 16) as u8;
        out[4 * i + 2] = (w >> 8) as u8;
        out[4 * i + 3] = w as u8;
    }
    out
}

pub fn compute_nullifier(
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    prf_secret_hi: Field,
    prf_secret_lo: Field,
    app_id: Field,
) -> Field {
    let (x_hi, x_lo) = limbs_from_bytes32(pub_key_x);
    let (y_hi, y_lo) = limbs_from_bytes32(pub_key_y);
    Poseidon2::hash(
        [NULLIFIER_DOMAIN, x_hi, x_lo, y_hi, y_lo, prf_secret_hi, prf_secret_lo, app_id],
        8,
    )
}

fn main(
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    authenticator_data: [u8; 37],
    prf_secret_hi: Field,
    prf_secret_lo: Field,
    client_data_hash_hi: pub Field,
    client_data_hash_lo: pub Field,
    rp_id_hash_hi: pub Field,
    rp_id_hash_lo: pub Field,
    app_id: pub Field,
    nullifier: pub Field,
) {
    let rp_id_hash = bytes32_from_limbs(rp_id_hash_hi, rp_id_hash_lo);
    for i in 0..32 {
        assert(authenticator_data[i] == rp_id_hash[i], "rpIdHash mismatch");
    }

    let flags = authenticator_data[32];
    assert(flags & FLAG_USER_PRESENT == FLAG_USER_PRESENT, "user presence required");
    assert(flags & FLAG_USER_VERIFIED == FLAG_USER_VERIFIED, "user verification required");
    assert(flags & FLAGS_VARIABLE_LENGTH == 0, "attested data and extensions not supported");

    let client_data_hash = bytes32_from_limbs(client_data_hash_hi, client_data_hash_lo);
    let message_hash = webauthn_message_hash(authenticator_data, client_data_hash);
    assert(
        verify_signature(pub_key_x, pub_key_y, signature, message_hash),
        "invalid passkey signature",
    );

    // Canonical 128-bit limbs keep the nullifier a function of the 32-byte PRF output alone.
    prf_secret_hi.assert_max_bit_size::<128>();
    prf_secret_lo.assert_max_bit_size::<128>();
    let computed = compute_nullifier(pub_key_x, pub_key_y, prf_secret_hi, prf_secret_lo, app_id);
    assert(computed == nullifier, "nullifier mismatch");
}
