//! Bounds on a deployment's configuration, shared by the factory (when it is deployed) and every account
//! (when it is initialized), so a factory can never be deployed with a configuration its accounts reject.

use alloy_primitives::U256;

/// Longest change or recovery delay (seconds).
pub const MAX_DELAY: u64 = 30 * 86_400;
/// Longest origin, in bytes.
pub const MAX_ORIGIN_LEN: usize = 128;

/// The policy every account of a deployment starts with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub per_tx_cap: U256,
    pub daily_cap: U256,
    pub new_payee_cap: U256,
    pub change_delay: u64,
    pub recovery_delay: u64,
    pub max_fee: U256,
    pub origin_len: usize,
}

/// Whether every account could be initialized with `policy`. The per-payment cap covers the largest fee,
/// so an action's fee always fits it.
pub fn is_valid_policy(policy: &Policy) -> bool {
    let max = U256::from(u128::MAX);
    policy.origin_len > 0
        && policy.origin_len <= MAX_ORIGIN_LEN
        && !policy.per_tx_cap.is_zero()
        && policy.per_tx_cap <= policy.daily_cap
        && policy.daily_cap <= max
        && policy.new_payee_cap <= max
        && policy.change_delay <= MAX_DELAY
        && policy.recovery_delay <= MAX_DELAY
        && policy.max_fee <= U256::from(u64::MAX)
        && policy.max_fee <= policy.per_tx_cap
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(v: u64) -> U256 {
        U256::from(v)
    }

    const SEPOLIA: Policy = Policy {
        per_tx_cap: U256::from_limbs([10_000_000, 0, 0, 0]),
        daily_cap: U256::from_limbs([25_000_000, 0, 0, 0]),
        new_payee_cap: U256::from_limbs([2_000_000, 0, 0, 0]),
        change_delay: 120,
        recovery_delay: 300,
        max_fee: U256::from_limbs([250_000, 0, 0, 0]),
        origin_len: 29,
    };

    #[test]
    fn accepts_a_sound_policy() {
        assert!(is_valid_policy(&SEPOLIA));
        assert!(is_valid_policy(&Policy { change_delay: MAX_DELAY, recovery_delay: MAX_DELAY, origin_len: MAX_ORIGIN_LEN, ..SEPOLIA }));
    }

    #[test]
    fn rejects_what_an_account_could_not_use() {
        let bad = [
            Policy { per_tx_cap: u(0), ..SEPOLIA },
            Policy { per_tx_cap: u(30_000_000), ..SEPOLIA },
            Policy { daily_cap: U256::from(u128::MAX) + u(1), ..SEPOLIA },
            Policy { new_payee_cap: U256::from(u128::MAX) + u(1), ..SEPOLIA },
            Policy { change_delay: MAX_DELAY + 1, ..SEPOLIA },
            Policy { recovery_delay: MAX_DELAY + 1, ..SEPOLIA },
            Policy { max_fee: U256::from(u64::MAX) + u(1), ..SEPOLIA },
            Policy { origin_len: 0, ..SEPOLIA },
            Policy { origin_len: MAX_ORIGIN_LEN + 1, ..SEPOLIA },
        ];
        for policy in bad {
            assert!(!is_valid_policy(&policy), "{policy:?}");
        }
    }

    #[test]
    fn every_fee_fits_the_per_payment_cap() {
        assert!(is_valid_policy(&Policy { max_fee: u(10_000_000), ..SEPOLIA }));
        assert!(!is_valid_policy(&Policy { max_fee: u(10_000_001), ..SEPOLIA }));
    }
}
