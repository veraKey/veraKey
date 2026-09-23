use crate::main;
use crate::test_vectors::{
    APP_ID, AUTHENTICATOR_DATA, CLIENT_DATA_HASH_HI, CLIENT_DATA_HASH_LO, NULLIFIER,
    NULLIFIER_OTHER_APP, PRF_SECRET_HI, PRF_SECRET_LO, PUB_KEY_X, PUB_KEY_Y, RP_ID_HASH_HI,
    RP_ID_HASH_LO, SIGNATURE_HIGH_S, SIGNATURE_LOW_S,
};

fn run(
    signature: [u8; 64],
    authenticator_data: [u8; 37],
    prf_secret_lo: Field,
    client_data_hash_lo: Field,
    rp_id_hash_lo: Field,
    app_id: Field,
    nullifier: Field,
) {
    main(
        PUB_KEY_X,
        PUB_KEY_Y,
        signature,
        authenticator_data,
        PRF_SECRET_HI,
        prf_secret_lo,
        CLIENT_DATA_HASH_HI,
        client_data_hash_lo,
        RP_ID_HASH_HI,
        rp_id_hash_lo,
        app_id,
        nullifier,
    );
}

#[test]
fn valid_assertion() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test]
fn same_passkey_other_app_has_other_nullifier() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID + 1,
        NULLIFIER_OTHER_APP,
    );
    assert(NULLIFIER != NULLIFIER_OTHER_APP);
}

#[test(should_fail_with = "nullifier mismatch")]
fn nullifier_of_other_app_is_rejected() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER_OTHER_APP,
    );
}

#[test(should_fail_with = "nullifier mismatch")]
fn wrong_prf_secret_is_rejected() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO + 1,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "rpIdHash mismatch")]
fn wrong_rp_id_hash_is_rejected() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO + 1,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "invalid passkey signature")]
fn tampered_client_data_hash_is_rejected() {
    run(
        SIGNATURE_LOW_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO + 1,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "invalid passkey signature")]
fn tampered_sign_count_is_rejected() {
    let mut auth = AUTHENTICATOR_DATA;
    auth[36] = auth[36] + 1;
    run(
        SIGNATURE_LOW_S,
        auth,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "user verification required")]
fn missing_user_verification_is_rejected() {
    let mut auth = AUTHENTICATOR_DATA;
    auth[32] = auth[32] & 0xFB;
    run(
        SIGNATURE_LOW_S,
        auth,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "user presence required")]
fn missing_user_presence_is_rejected() {
    let mut auth = AUTHENTICATOR_DATA;
    auth[32] = auth[32] & 0xFE;
    run(
        SIGNATURE_LOW_S,
        auth,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

#[test(should_fail_with = "attested data and extensions not supported")]
fn extension_flag_is_rejected() {
    let mut auth = AUTHENTICATOR_DATA;
    auth[32] = auth[32] | 0x80;
    run(
        SIGNATURE_LOW_S,
        auth,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}

// Documents the blackbox's malleability behaviour: the SDK always normalizes to low-s,
// so a high-s signature is never produced by VeraKey clients.
#[test(should_fail_with = "invalid passkey signature")]
fn high_s_signature_is_rejected() {
    run(
        SIGNATURE_HIGH_S,
        AUTHENTICATOR_DATA,
        PRF_SECRET_LO,
        CLIENT_DATA_HASH_LO,
        RP_ID_HASH_LO,
        APP_ID,
        NULLIFIER,
    );
}
