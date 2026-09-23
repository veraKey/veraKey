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
//!
//! Payments may instead be confirmed with Secure Payment Confirmation (W3C SPC), where the browser
//! itself shows the payee and total and signs them into a `payment.get` client data. `verify_payment`
//! checks that what the browser showed is exactly what the account is about to do.

use alloy_primitives::Address;

use crate::base64url;

/// Upper bound that keeps hashing and scanning costs predictable.
pub const MAX_CLIENT_DATA_LEN: usize = 1024;

const TYPE_AND_CHALLENGE_KEY: &[u8] = br#"{"type":"webauthn.get","challenge":""#;
const ORIGIN_KEY: &[u8] = br#"","origin":""#;
const CROSS_ORIGIN_TRUE: &[u8] = br#","crossOrigin":true"#;

/// First bytes of a Secure Payment Confirmation assertion's client data.
pub const SPC_PREFIX: &[u8] = br#"{"type":"payment.get","challenge":""#;
const SPC_RP_ID_KEY: &[u8] = br#"","crossOrigin":false,"payment":{"rpId":""#;
const SPC_TOP_ORIGIN_KEY: &[u8] = br#"","topOrigin":""#;
const SPC_PAYEE_NAME_KEY: &[u8] = br#"","payeeName":""#;
const SPC_AFTER_PAYEE: &[u8] = br#"","#;
const SPC_LOGOS: &[u8] = br#""paymentEntitiesLogos":[],"#;
const SPC_TOTAL_KEY: &[u8] = br#""total":{"value":""#;
const SPC_CURRENCY_AND_INSTRUMENT: &[u8] = br#"","currency":"USD"},"instrument":{"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ClientDataError {
    TooLong = 1,
    NotAnAssertion = 2,
    ChallengeMismatch = 3,
    OriginMismatch = 4,
    Malformed = 5,
    CrossOrigin = 6,
    /// SPC client data whose payee or total differs from the payment being authorized.
    PaymentMismatch = 7,
    /// SPC client data whose rpId does not hash to the account's rpIdHash (checked by the account).
    RpIdMismatch = 8,
}

/// The payment an SPC assertion must show: `payee` receives, `total` (USDG base units, 6 decimals)
/// is everything that leaves the account (amount plus relayer fee).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Payment {
    pub payee: Address,
    pub total: u128,
}

/// `0x` + 40 lowercase hex digits: how the payee is passed to SPC as `payeeName`.
pub fn payee_name(payee: Address) -> [u8; 42] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = [0u8; 42];
    out[0] = b'0';
    out[1] = b'x';
    for (i, byte) in payee.as_slice().iter().enumerate() {
        out[2 + 2 * i] = HEX[(byte >> 4) as usize];
        out[3 + 2 * i] = HEX[(byte & 0x0f) as usize];
    }
    out
}

/// The SPC `total.value` for `units` (6 decimals): at least two decimals, trailing zeros trimmed
/// beyond that. 2_000_000 -> "2.00", 12_500_000 -> "12.50", 1_234_567 -> "1.234567", 1_000 -> "0.001".
/// Returns the buffer and the length used.
pub fn format_total(units: u128) -> ([u8; 48], usize) {
    let mut out = [0u8; 48];
    let whole = units / 1_000_000;
    let mut frac = (units % 1_000_000) as u32;
    // Whole part, most significant digit first.
    let mut digits = [0u8; 40];
    let mut n = 0;
    let mut w = whole;
    loop {
        digits[n] = b'0' + (w % 10) as u8;
        n += 1;
        w /= 10;
        if w == 0 {
            break;
        }
    }
    let mut len = 0;
    for i in (0..n).rev() {
        out[len] = digits[i];
        len += 1;
    }
    out[len] = b'.';
    len += 1;
    let mut decimals = [0u8; 6];
    for i in (0..6).rev() {
        decimals[i] = b'0' + (frac % 10) as u8;
        frac /= 10;
    }
    let mut keep = 6;
    while keep > 2 && decimals[keep - 1] == b'0' {
        keep -= 1;
    }
    out[len..len + keep].copy_from_slice(&decimals[..keep]);
    (out, len + keep)
}

fn expect(json: &[u8], pos: &mut usize, token: &[u8]) -> bool {
    let end = *pos + token.len();
    if end > json.len() || &json[*pos..end] != token {
        return false;
    }
    *pos = end;
    true
}

/// Checks an SPC `payment.get` client data: same challenge and origin rules as `verify`, plus the
/// browser-shown payee and total must equal `payment`. Returns the signed `payment.rpId`, which the
/// caller must hash and compare with its rpIdHash. Everything after `"instrument":{` (icon, display
/// name, keys a browser appends) is informational and ignored.
pub fn verify_payment<'a>(
    json: &'a [u8],
    challenge: &[u8; 32],
    origin: &[u8],
    payment: &Payment,
) -> Result<&'a [u8], ClientDataError> {
    if json.len() > MAX_CLIENT_DATA_LEN {
        return Err(ClientDataError::TooLong);
    }
    let mut pos = 0;
    if !expect(json, &mut pos, SPC_PREFIX) {
        return Err(ClientDataError::NotAnAssertion);
    }
    if !expect(json, &mut pos, &base64url::encode_32(challenge)) || !expect(json, &mut pos, ORIGIN_KEY) {
        return Err(ClientDataError::ChallengeMismatch);
    }
    if !expect(json, &mut pos, origin) {
        return Err(ClientDataError::OriginMismatch);
    }
    // `"crossOrigin":false` is required, so a cross-origin iframe never passes here either.
    if !expect(json, &mut pos, SPC_RP_ID_KEY) {
        return Err(ClientDataError::Malformed);
    }
    let rp_start = pos;
    while pos < json.len() && json[pos] != b'"' {
        if json[pos] == b'\\' {
            return Err(ClientDataError::Malformed);
        }
        pos += 1;
    }
    if pos == json.len() || pos == rp_start {
        return Err(ClientDataError::Malformed);
    }
    let rp_id = &json[rp_start..pos];
    if !expect(json, &mut pos, SPC_TOP_ORIGIN_KEY) || !expect(json, &mut pos, origin) {
        return Err(ClientDataError::OriginMismatch);
    }
    if !expect(json, &mut pos, SPC_PAYEE_NAME_KEY)
        || !expect(json, &mut pos, &payee_name(payment.payee))
        || !expect(json, &mut pos, SPC_AFTER_PAYEE)
    {
        return Err(ClientDataError::PaymentMismatch);
    }
    let _ = expect(json, &mut pos, SPC_LOGOS);
    let (total, total_len) = format_total(payment.total);
    if !expect(json, &mut pos, SPC_TOTAL_KEY)
        || !expect(json, &mut pos, &total[..total_len])
        || !expect(json, &mut pos, SPC_CURRENCY_AND_INSTRUMENT)
    {
        return Err(ClientDataError::PaymentMismatch);
    }
    Ok(rp_id)
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

    const PAYEE: Address = Address::new([0x71, 0xc7, 0x65, 0x6e, 0xc7, 0xab, 0x88, 0xb0, 0x98, 0xde, 0xfb, 0x75, 0x1b, 0x74, 0x01, 0xb5, 0xf6, 0xd8, 0x97, 0x6f]);

    fn spc(rp: &str, payee: &str, total: &str, logos: bool) -> Vec<u8> {
        json(&format!(
            r#"{{"type":"payment.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false,"payment":{{"rpId":"{rp}","topOrigin":"{ORIGIN}","payeeName":"{payee}",{}"total":{{"value":"{total}","currency":"USD"}},"instrument":{{"icon":"{ORIGIN}/icon.png","displayName":"VeraKey USDG"}}}}}}"#,
            encoded(),
            if logos { r#""paymentEntitiesLogos":[],"# } else { "" }
        ))
    }

    const PAYEE_HEX: &str = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";

    #[test]
    fn formats_totals_like_the_frontend() {
        let f = |u: u128| {
            let (b, n) = format_total(u);
            String::from_utf8(b[..n].to_vec()).unwrap()
        };
        assert_eq!(f(2_000_000), "2.00");
        assert_eq!(f(2_020_000), "2.02");
        assert_eq!(f(12_500_000), "12.50");
        assert_eq!(f(1_234_567), "1.234567");
        assert_eq!(f(1_000), "0.001");
        assert_eq!(f(0), "0.00");
        assert_eq!(f(u128::MAX), "340282366920938463463374607431768.211455");
        assert_eq!(&payee_name(PAYEE), PAYEE_HEX.as_bytes());
    }

    #[test]
    fn accepts_spc_payment_with_matching_payee_and_total() {
        let payment = Payment { payee: PAYEE, total: 2_020_000 };
        for logos in [true, false] {
            let j = spc("verakey.app", PAYEE_HEX, "2.02", logos);
            assert_eq!(verify_payment(&j, &challenge(), ORIGIN.as_bytes(), &payment), Ok(&b"verakey.app"[..]));
        }
    }

    #[test]
    fn rejects_spc_payment_that_shows_something_else() {
        let payment = Payment { payee: PAYEE, total: 2_020_000 };
        let other_payee = "0x71c7656ec7ab88b098defb751b7401b5f6d8976e";
        assert_eq!(verify_payment(&spc("verakey.app", other_payee, "2.02", true), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::PaymentMismatch));
        // A checksummed payee is refused too: one canonical spelling, byte for byte.
        let checksummed = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
        assert_eq!(verify_payment(&spc("verakey.app", checksummed, "2.02", true), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::PaymentMismatch));
        for total in ["2.2", "2.020", "20.20", "2.01"] {
            assert_eq!(verify_payment(&spc("verakey.app", PAYEE_HEX, total, true), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::PaymentMismatch), "{total}");
        }
        let other_currency = spc("verakey.app", PAYEE_HEX, "2.02", true).iter().map(|b| *b).collect::<Vec<u8>>();
        let other_currency = String::from_utf8(other_currency).unwrap().replace(r#""currency":"USD""#, r#""currency":"EUR""#);
        assert_eq!(verify_payment(other_currency.as_bytes(), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::PaymentMismatch));
    }

    #[test]
    fn spc_keeps_challenge_origin_and_cross_origin_rules() {
        let payment = Payment { payee: PAYEE, total: 2_020_000 };
        let j = spc("verakey.app", PAYEE_HEX, "2.02", true);
        let mut other = challenge();
        other[0] ^= 1;
        assert_eq!(verify_payment(&j, &other, ORIGIN.as_bytes(), &payment), Err(ClientDataError::ChallengeMismatch));
        assert_eq!(verify_payment(&j, &challenge(), b"https://evil.example", &payment), Err(ClientDataError::OriginMismatch));
        let crossed = String::from_utf8(j.clone()).unwrap().replace(r#""crossOrigin":false"#, r#""crossOrigin":true"#);
        assert_eq!(verify_payment(crossed.as_bytes(), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::Malformed));
        let top = String::from_utf8(j.clone()).unwrap().replace(&format!(r#""topOrigin":"{ORIGIN}""#), r#""topOrigin":"https://evil.example""#);
        assert_eq!(verify_payment(top.as_bytes(), &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::OriginMismatch));
        let escaped = spc("verakey.app\\u0022", PAYEE_HEX, "2.02", true);
        assert_eq!(verify_payment(&escaped, &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::Malformed));
        // A webauthn.get client data is not a payment confirmation, and vice versa.
        let plain = json(&format!(r#"{{"type":"webauthn.get","challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#, encoded()));
        assert_eq!(verify_payment(&plain, &challenge(), ORIGIN.as_bytes(), &payment), Err(ClientDataError::NotAnAssertion));
        assert_eq!(verify(&j, &challenge(), ORIGIN.as_bytes()), Err(ClientDataError::NotAnAssertion));
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
