use crate::main;
use crate::test_vectors::{
    APP_ID, AUTHENTICATOR_DATA, CLIENT_DATA_HASH_HI, CLIENT_DATA_HASH_LO, NULLIFIER,
    NULLIFIER_OTHER_APP, PRF_SECRET_HI, PRF_SECRET_LO, PUB_KEY_X, PUB_KEY_Y, RP_ID_HASH_HI,
    RP_ID_HASH_LO, SIGNATURE_LOW_S,
};

fn run(
    prf_secret_lo: Field,
    client_data_hash_lo: Field,
    rp_id_hash_lo: Field,
    app_id_a: Field,
    nullifier_a: Field,
    app_id_b: Field,
    nullifier_b: Field,
) {
    main(
        PUB_KEY_X,
        PUB_KEY_Y,
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_HI,
        prf_secret_lo,
        CLIENT_DATA_HASH_HI,
        client_data_hash_lo,
        RP_ID_HASH_HI,
        rp_id_hash_lo,
        app_id_a,
        nullifier_a,
        app_id_b,
        nullifier_b,
    );
}

#[test]
fn one_passkey_links_its_two_apps() {
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO, APP_ID, NULLIFIER, APP_ID + 1, NULLIFIER_OTHER_APP);
}

#[test]
fn either_order_links() {
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO, APP_ID + 1, NULLIFIER_OTHER_APP, APP_ID, NULLIFIER);
}

#[test(should_fail_with = "nullifier B mismatch")]
fn someone_elses_nullifier_is_rejected() {
    // A nullifier this passkey does not own (here: app A's nullifier claimed for app B).
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO, APP_ID, NULLIFIER, APP_ID + 1, NULLIFIER);
}

#[test(should_fail_with = "two different apps")]
fn the_same_app_twice_is_rejected() {
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO, APP_ID, NULLIFIER, APP_ID, NULLIFIER);
}

#[test(should_fail_with = "nullifier A mismatch")]
fn wrong_prf_secret_is_rejected() {
    run(PRF_SECRET_LO + 1, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO, APP_ID, NULLIFIER, APP_ID + 1, NULLIFIER_OTHER_APP);
}

#[test(should_fail_with = "invalid passkey signature")]
fn consent_over_another_statement_is_rejected() {
    // The signature covers clientDataHash, which commits to the disclosure statement.
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO + 1, RP_ID_HASH_LO, APP_ID, NULLIFIER, APP_ID + 1, NULLIFIER_OTHER_APP);
}

#[test(should_fail_with = "rpIdHash mismatch")]
fn another_relying_party_is_rejected() {
    run(PRF_SECRET_LO, CLIENT_DATA_HASH_LO, RP_ID_HASH_LO + 1, APP_ID, NULLIFIER, APP_ID + 1, NULLIFIER_OTHER_APP);
}
