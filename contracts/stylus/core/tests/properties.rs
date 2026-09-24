//! Property tests for the policy and parsing logic every VeraKey account relies on. They run on the
//! host (`cargo test -p verakey-core`) against thousands of random inputs per property.
use alloy_primitives::{Address, U256};
use proptest::prelude::*;
use verakey_core::{
    base64url,
    changes::{self, Limits},
    client_data::{self, Payment},
    spending::{self, Window, SECONDS_PER_DAY},
};

fn word(value: U256) -> [u8; 32] {
    value.to_be_bytes::<32>()
}

fn limits_payload(per_tx: u128, daily: u128) -> Vec<u8> {
    [word(U256::from(per_tx)), word(U256::from(daily))].concat()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    /// However payments are split, one UTC day never spends more than the daily cap, and no single
    /// payment exceeds the per-payment cap.
    #[test]
    fn a_day_never_spends_more_than_its_caps(
        per_tx in 1u64..1_000_000_000,
        extra in 0u64..5_000_000_000,
        amounts in prop::collection::vec(0u64..2_000_000_000, 1..40),
        day in 0u64..40_000,
    ) {
        let (per_tx, daily) = (U256::from(per_tx), U256::from(per_tx + extra));
        let mut window = Window::default();
        let mut spent = U256::ZERO;
        for (i, amount) in amounts.iter().enumerate() {
            let now = day * SECONDS_PER_DAY + i as u64;
            match spending::spend(per_tx, daily, window, now, U256::from(*amount)) {
                Ok(next) => {
                    prop_assert!(U256::from(*amount) <= per_tx);
                    spent += U256::from(*amount);
                    prop_assert_eq!(next.spent, spent);
                    prop_assert!(next.spent <= daily);
                    window = next;
                }
                Err(_) => prop_assert!(U256::from(*amount) > per_tx || spent + U256::from(*amount) > daily),
            }
        }
    }

    /// A new UTC day starts from zero.
    #[test]
    fn the_window_resets_on_the_next_day(per_tx in 1u64..1_000_000, spent in 0u64..1_000_000, day in 0u64..40_000) {
        let window = Window { day, spent: U256::from(spent) };
        let next = spending::spend(U256::from(per_tx), U256::from(per_tx), window, (day + 1) * SECONDS_PER_DAY, U256::from(per_tx)).unwrap();
        prop_assert_eq!(next, Window { day: day + 1, spent: U256::from(per_tx) });
    }

    /// `restrict` may only apply changes that cannot increase what the account can spend or who controls it.
    #[test]
    fn restrictive_limits_never_loosen(
        cur_per_tx in 1u128..u128::MAX / 2, cur_extra in 0u128..u128::MAX / 2, cur_new_payee in any::<u128>(),
        new_per_tx in any::<u128>(), new_daily in any::<u128>(), new_cap in any::<u128>(),
    ) {
        let current = Limits {
            per_tx_cap: U256::from(cur_per_tx),
            daily_cap: U256::from(cur_per_tx + cur_extra),
            new_payee_cap: U256::from(cur_new_payee),
        };
        if changes::is_restrictive(changes::SET_LIMITS, &limits_payload(new_per_tx, new_daily), &current) {
            prop_assert!(U256::from(new_per_tx) <= current.per_tx_cap);
            prop_assert!(U256::from(new_daily) <= current.daily_cap);
            prop_assert!(new_per_tx != 0 && new_per_tx <= new_daily);
        }
        if changes::is_restrictive(changes::SET_NEW_PAYEE_CAP, &word(U256::from(new_cap)), &current) {
            prop_assert!(U256::from(new_cap) <= current.new_payee_cap);
        }
    }

    /// Owner, guardian and unfreeze changes can never skip the timelock, whatever their payload.
    #[test]
    fn control_changes_are_never_restrictive(payload in prop::collection::vec(any::<u8>(), 0..96)) {
        let current = Limits { per_tx_cap: U256::MAX, daily_cap: U256::MAX, new_payee_cap: U256::MAX };
        for kind in [changes::ADD_OWNER, changes::REMOVE_OWNER, changes::SET_GUARDIAN, changes::UNFREEZE] {
            prop_assert!(!changes::is_restrictive(kind, &payload, &current));
        }
        // Enabling (never disabling) the allowlist, and removing (never adding) a recipient.
        if changes::is_restrictive(changes::SET_ALLOWLIST, &payload, &current) {
            prop_assert_eq!(changes::word_bool(&payload), Some(true));
        }
        if changes::is_restrictive(changes::SET_RECIPIENT, &payload, &current) {
            prop_assert_eq!(changes::word_bool(&payload[32..]), Some(false));
        }
    }

    /// Validation never panics, and a valid payload for a u128 field always fits in 128 bits.
    #[test]
    fn change_validation_never_panics(kind in any::<u8>(), payload in prop::collection::vec(any::<u8>(), 0..130)) {
        let valid = changes::is_valid(kind, &payload);
        if valid && kind == changes::SET_NEW_PAYEE_CAP {
            prop_assert!(changes::word_u128(&payload).is_some());
        }
    }

    /// The client data checks never panic on arbitrary bytes, and accept only the exact prefix.
    #[test]
    fn client_data_parsers_never_panic(json in prop::collection::vec(any::<u8>(), 0..1100), challenge in any::<[u8; 32]>(), payee in any::<[u8; 20]>(), total in any::<u128>()) {
        let origin = b"https://verakey.app";
        if client_data::verify(&json, &challenge, origin).is_ok() {
            prop_assert!(json.starts_with(br#"{"type":"webauthn.get","challenge":""#), "accepted without the webauthn.get prefix");
            prop_assert!(json.windows(43).any(|w| w == base64url::encode_32(&challenge)), "accepted without the challenge");
        }
        let payment = Payment { payee: Address::from(payee), total };
        if let Ok(rp_id) = client_data::verify_payment(&json, &challenge, origin, &payment) {
            prop_assert!(json.starts_with(client_data::SPC_PREFIX), "accepted without the payment.get prefix");
            prop_assert!(!rp_id.contains(&b'"') && !rp_id.contains(&b'\\'), "rpId with a quote or an escape");
        }
    }

    /// A genuine client data for this challenge and origin is accepted, with any appended keys, and one
    /// for any other challenge is refused.
    #[test]
    fn client_data_binds_the_challenge(challenge in any::<[u8; 32]>(), other in any::<[u8; 32]>(), extra in "[a-z_]{0,20}") {
        let origin = "https://verakey.app";
        let b64 = String::from_utf8(base64url::encode_32(&challenge).to_vec()).unwrap();
        let tail = if extra.is_empty() { String::new() } else { format!(r#","{extra}":"x""#) };
        let json = format!(r#"{{"type":"webauthn.get","challenge":"{b64}","origin":"{origin}","crossOrigin":false{tail}}}"#);
        prop_assert!(client_data::verify(json.as_bytes(), &challenge, origin.as_bytes()).is_ok());
        if other != challenge {
            prop_assert!(client_data::verify(json.as_bytes(), &other, origin.as_bytes()).is_err());
        }
    }

    /// The SPC total is a decimal string that parses back to exactly the same number of base units.
    #[test]
    fn spc_totals_round_trip(units in any::<u128>()) {
        let (buf, len) = client_data::format_total(units);
        let text = std::str::from_utf8(&buf[..len]).unwrap();
        let (whole, fraction) = text.split_once('.').unwrap();
        prop_assert!(fraction.len() >= 2 && fraction.len() <= 6);
        prop_assert!(fraction.len() == 2 || !fraction.ends_with('0'));
        let padded = format!("{fraction:0<6}");
        let parsed = whole.parse::<u128>().unwrap() * 1_000_000 + padded.parse::<u128>().unwrap();
        prop_assert_eq!(parsed, units);
    }

    /// The guardian commitment differs for every account and every salt.
    #[test]
    fn guardian_preimages_differ(a in any::<[u8; 20]>(), b in any::<[u8; 20]>(), guardian in any::<[u8; 20]>(), salt in any::<[u8; 32]>()) {
        prop_assume!(a != b);
        let one = changes::guardian_preimage(Address::from(a), Address::from(guardian), salt.into());
        let two = changes::guardian_preimage(Address::from(b), Address::from(guardian), salt.into());
        prop_assert_ne!(one, two);
    }
}
