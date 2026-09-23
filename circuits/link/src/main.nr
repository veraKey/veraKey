// VeraKey consent-to-link circuit ("linkable by consent").
//
// Proves, without revealing the passkey public key, its signature or the PRF secret, that ONE passkey
// owns two per-app nullifiers, and that it approved this disclosure just now:
//   1. a valid WebAuthn assertion (rpIdHash, UP+UV, ES256 signature) over clientDataHash, exactly as in
//      the authorization circuit; the verifier checks that clientDataJSON's challenge is the hash of
//      the disclosure statement (both apps and nullifiers, the audience, a nonce and an expiry);
//   2. nullifier_a = Poseidon2(domain, pk, prf, app_id_a) and nullifier_b = Poseidon2(domain, pk, prf,
//      app_id_b), for two different apps.
// Nothing links the two accounts on-chain unless their owner produces this proof for someone.
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
    app_id_a: pub Field,
    nullifier_a: pub Field,
    app_id_b: pub Field,
    nullifier_b: pub Field,
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

    prf_secret_hi.assert_max_bit_size::<128>();
    prf_secret_lo.assert_max_bit_size::<128>();
    assert(app_id_a != app_id_b, "two different apps");
    let computed_a = compute_nullifier(pub_key_x, pub_key_y, prf_secret_hi, prf_secret_lo, app_id_a);
    assert(computed_a == nullifier_a, "nullifier A mismatch");
    let computed_b = compute_nullifier(pub_key_x, pub_key_y, prf_secret_hi, prf_secret_lo, app_id_b);
    assert(computed_b == nullifier_b, "nullifier B mismatch");
}
