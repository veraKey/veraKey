/** What the account may still spend today. Never negative: a cap lowered below today's spending leaves nothing. */
export function leftToday(dailyCap: bigint, spentToday: bigint): bigint {
  return dailyCap > spentToday ? dailyCap - spentToday : 0n;
}
