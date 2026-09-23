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
// Checks 1-3 and the nullifier live in `verakey_lib`, shared with the consent-to-link circuit.
mod test_vectors;
mod tests;

use verakey_lib::{compute_nullifier, verify_assertion};

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
    verify_assertion(
        pub_key_x,
        pub_key_y,
        signature,
        authenticator_data,
        client_data_hash_hi,
        client_data_hash_lo,
        rp_id_hash_hi,
        rp_id_hash_lo,
    );

    // Canonical 128-bit limbs keep the nullifier a function of the 32-byte PRF output alone.
    prf_secret_hi.assert_max_bit_size::<128>();
    prf_secret_lo.assert_max_bit_size::<128>();
    let computed = compute_nullifier(pub_key_x, pub_key_y, prf_secret_hi, prf_secret_lo, app_id);
    assert(computed == nullifier, "nullifier mismatch");
}
