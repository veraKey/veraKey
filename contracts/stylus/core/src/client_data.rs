//! Verification of WebAuthn `clientDataJSON` without a JSON parser.
//!
//! WebAuthn Level 3 §5.8.1.2 fixes the serialization order of `CollectedClientData`: `type`,
//! `challenge`, `origin`, then `crossOrigin` (and `topOrigin`), followed by any other keys. This is
//! the spec's "limited verification algorithm": relying parties may check a byte prefix instead of
//! parsing JSON. Keys a browser appends after `origin` (Chrome randomly injects
//! `other_keys_can_be_added_here`) are accepted; `"crossOrigin":true` is rejected because VeraKey
//! never authenticates from inside a cross-origin iframe.
//!
//! The account passes only `sha256(clientDataJSON)` into the zero-knowledge proof, and the proof
//! checks the passkey signature over it, so a caller cannot alter these bytes without invalidating
//! the proof. This check decides whether the signed bytes authorize *this* action for *this* origin.

use crate::base64url;

/// Upper bound that keeps hashing and scanning costs predictable.
pub const MAX_CLIENT_DATA_LEN: usize = 1024;

const TYPE_AND_CHALLENGE_KEY: &[u8] = br#"{"type":"webauthn.get","challenge":""#;
const ORIGIN_KEY: &[u8] = br#"","origin":""#;
const CROSS_ORIGIN_TRUE: &[u8] = br#","crossOrigin":true"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ClientDataError {
    TooLong = 1,
    NotAnAssertion = 2,
    ChallengeMismatch = 3,
    OriginMismatch = 4,
    Malformed = 5,
    CrossOrigin = 6,
}

fn expect(json: &[u8], pos: &mut usize, token: &[u8]) -> bool {
    let end = *pos + token.len();
    if end > json.len() || &json[*pos..end] != token {
        return false;
    }
    *pos = end;
    true
}

/// Checks that `json` is a `webauthn.get` client data whose challenge is `challenge` (as unpadded
/// base64url) and whose origin is exactly `origin`.
pub fn verify(json: &[u8], challenge: &[u8; 32], origin: &[u8]) -> Result<(), ClientDataError> {
    if json.len() > MAX_CLIENT_DATA_LEN {
        return Err(ClientDataError::TooLong);
    }
    let mut pos = 0;
    if !expect(json, &mut pos, TYPE_AND_CHALLENGE_KEY) {
        return Err(ClientDataError::NotAnAssertion);
    }
    if !expect(json, &mut pos, &base64url::encode_32(challenge)) || !expect(json, &mut pos, ORIGIN_KEY) {
        return Err(ClientDataError::ChallengeMismatch);
    }
    // The closing quote must follow immediately, so "https://a.xyz.evil" never matches "https://a.xyz".
    if !expect(json, &mut pos, origin) || !expect(json, &mut pos, b"\"") {
        return Err(ClientDataError::OriginMismatch);
    }
    match json.get(pos) {
        Some(b'}') => Ok(()),
        Some(b',') if json[pos..].starts_with(CROSS_ORIGIN_TRUE) => Err(ClientDataError::CrossOrigin),
        Some(b',') => Ok(()),
        _ => Err(ClientDataError::Malformed),
    }
}

#[cfg(test)]
mod tests {
    extern crate alloc;
    use super::*;
    use alloc::{format, string::String, vec::Vec};

    const ORIGIN: &str = "https://verakey.app";

    fn challenge() -> [u8; 32] {
        let mut c = [0u8; 32];
        for (i, b) in c.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(37).wrapping_add(11);
        }
        c
    }

    fn encoded() -> String {
        String::from_utf8(base64url::encode_32(&challenge()).to_vec()).unwrap()
    }

    fn json(body: &str) -> Vec<u8> {
        body.as_bytes().to_vec()
    }

    #[test]
    fn accepts_level3_serialization() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Ok(()));
    }

    #[test]
    fn accepts_level1_serialization_without_cross_origin() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}"}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Ok(()));
    }

    #[test]
    fn accepts_chrome_injected_keys() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Ok(()));
    }

    #[test]
    fn rejects_registration_ceremony() {
        let j = json(&format!(
            r#"{{"type":"webauthn.create","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::NotAnAssertion));
    }

    #[test]
    fn rejects_other_challenge() {
        let mut other = challenge();
        other[0] ^= 1;
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &other, ORIGIN.as_bytes()), Err(ClientDataError::ChallengeMismatch));
    }

    #[test]
    fn rejects_padded_challenge() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}=","origin":"{ORIGIN}","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::ChallengeMismatch));
    }

    #[test]
    fn rejects_foreign_origin() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://evil.example","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::OriginMismatch));
    }

    #[test]
    fn rejects_origin_with_matching_prefix() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}.evil.example","crossOrigin":false}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::OriginMismatch));
    }

    #[test]
    fn rejects_cross_origin_iframe() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":true,"topOrigin":"https://evil.example"}}"#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::CrossOrigin));
    }

    #[test]
    fn rejects_truncated_json() {
        let j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}""#,
            encoded()
        ));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::Malformed));
    }

    #[test]
    fn rejects_oversized_json() {
        let mut j = json(&format!(
            r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false,"pad":""#,
            encoded()
        ));
        j.resize(MAX_CLIENT_DATA_LEN + 1, b'a');
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::TooLong));
    }
}
