//! USDG spending limits: a per-transaction cap and a daily cap over UTC-day windows.

use alloy_primitives::U256;

pub const SECONDS_PER_DAY: u64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpendError {
    PerTxCapExceeded,
    DailyCapExceeded,
}

/// Amount spent inside one UTC day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Window {
    pub day: u64,
    pub spent: U256,
}

/// Returns the window after spending `amount` at `now`, or the cap it would break.
pub fn spend(
    per_tx_cap: U256,
    daily_cap: U256,
    window: Window,
    now: u64,
    amount: U256,
) -> Result<Window, SpendError> {
    if amount > per_tx_cap {
        return Err(SpendError::PerTxCapExceeded);
    }
    let today = now / SECONDS_PER_DAY;
    let already = if window.day == today { window.spent } else { U256::ZERO };
    match already.checked_add(amount) {
        Some(total) if total <= daily_cap => Ok(Window { day: today, spent: total }),
        _ => Err(SpendError::DailyCapExceeded),
    }
}

/// Charges a safety action's fee at `now`. Freezing, restricting and cancelling must work even when the day's
/// cap is spent, so they are never refused; instead, the part of `fee` past `daily_cap` is waived. A day's
/// spending, fees included, therefore never passes the daily cap, and a stolen passkey cannot burn the balance
/// on fees. Returns the new window and the part of `fee` to pay (possibly zero).
pub fn charge_fee(daily_cap: U256, window: Window, now: u64, fee: U256) -> (Window, U256) {
    let today = now / SECONDS_PER_DAY;
    let already = if window.day == today { window.spent } else { U256::ZERO };
    let charged = fee.min(daily_cap.saturating_sub(already));
    (Window { day: today, spent: already + charged }, charged)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = SECONDS_PER_DAY;

    fn u(v: u64) -> U256 {
        U256::from(v)
    }

    #[test]
    fn accumulates_within_a_day() {
        let w = spend(u(10), u(25), Window::default(), 5 * DAY, u(10)).unwrap();
        let w = spend(u(10), u(25), w, 5 * DAY + 60, u(10)).unwrap();
        assert_eq!(w, Window { day: 5, spent: u(20) });
    }

    #[test]
    fn rejects_amount_above_per_tx_cap() {
        assert_eq!(
            spend(u(10), u(100), Window::default(), DAY, u(11)),
            Err(SpendError::PerTxCapExceeded)
        );
    }

    #[test]
    fn rejects_amount_above_daily_cap() {
        let w = spend(u(10), u(15), Window::default(), DAY, u(10)).unwrap();
        assert_eq!(spend(u(10), u(15), w, DAY + 1, u(6)), Err(SpendError::DailyCapExceeded));
    }

    #[test]
    fn resets_on_the_next_utc_day() {
        let w = spend(u(10), u(10), Window::default(), 2 * DAY - 1, u(10)).unwrap();
        let w = spend(u(10), u(10), w, 2 * DAY, u(10)).unwrap();
        assert_eq!(w, Window { day: 2, spent: u(10) });
    }

    #[test]
    fn a_safety_fee_within_the_cap_is_charged_in_full() {
        let (w, charged) = charge_fee(u(25), Window { day: 1, spent: u(10) }, DAY + 5, u(3));
        assert_eq!((w, charged), (Window { day: 1, spent: u(13) }, u(3)));
    }

    #[test]
    fn a_safety_fee_is_charged_only_up_to_the_cap() {
        // 2 left today: only 2 of the 3 are charged, and the day stops at its cap.
        let (w, charged) = charge_fee(u(25), Window { day: 1, spent: u(23) }, DAY + 5, u(3));
        assert_eq!((w, charged), (Window { day: 1, spent: u(25) }, u(2)));
    }

    #[test]
    fn a_safety_fee_past_the_cap_is_waived_not_refused() {
        // The cap is spent: the action still goes through, and it charges nothing.
        let (w, charged) = charge_fee(u(25), Window { day: 1, spent: u(25) }, DAY + 5, u(3));
        assert_eq!((w, charged), (Window { day: 1, spent: u(25) }, u(0)));
        // A cap lowered below today's spending waives it too, without lowering what was spent.
        let (w, charged) = charge_fee(u(10), Window { day: 1, spent: u(25) }, DAY + 5, u(3));
        assert_eq!((w, charged), (Window { day: 1, spent: u(25) }, u(0)));
    }

    #[test]
    fn a_safety_fee_on_a_new_day_starts_from_zero() {
        let (w, charged) = charge_fee(u(25), Window { day: 1, spent: u(25) }, 2 * DAY, u(3));
        assert_eq!((w, charged), (Window { day: 2, spent: u(3) }, u(3)));
    }

    #[test]
    fn overflow_counts_as_over_cap() {
        let w = Window { day: 1, spent: U256::MAX };
        assert_eq!(spend(U256::MAX, U256::MAX, w, DAY, u(1)), Err(SpendError::DailyCapExceeded));
    }
}
