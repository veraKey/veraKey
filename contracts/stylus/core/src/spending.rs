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

/// Records `amount` (a fee) in the window at `now` without refusing it, whatever the caps: freezing,
/// restricting and cancelling must work even when the day's cap is spent. The account stores the day's
/// spending as a `u128`, so the total saturates there.
pub fn record(window: Window, now: u64, amount: U256) -> Window {
    let today = now / SECONDS_PER_DAY;
    let already = if window.day == today { window.spent } else { U256::ZERO };
    Window { day: today, spent: already.saturating_add(amount).min(U256::from(u128::MAX)) }
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
    fn recording_a_fee_never_refuses_it() {
        // Already over the cap: the fee is still recorded, so payments see it.
        assert_eq!(record(Window { day: 1, spent: u(25) }, DAY + 5, u(3)), Window { day: 1, spent: u(28) });
        // A new UTC day starts from zero.
        assert_eq!(record(Window { day: 1, spent: u(25) }, 2 * DAY, u(3)), Window { day: 2, spent: u(3) });
        // The account stores the day's spending as a u128: saturate there instead of overflowing.
        let full = U256::from(u128::MAX);
        assert_eq!(record(Window { day: 1, spent: full }, DAY, u(1)).spent, full);
    }

    #[test]
    fn overflow_counts_as_over_cap() {
        let w = Window { day: 1, spent: U256::MAX };
        assert_eq!(spend(U256::MAX, U256::MAX, w, DAY, u(1)), Err(SpendError::DailyCapExceeded));
    }
}
