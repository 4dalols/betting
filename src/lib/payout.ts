export type BetLike = { userId: string; outcomeId: string; amountCents: number };

/**
 * Parimutuel payout: the whole pool is split among winning bets in proportion
 * to their stake. Integer cents; leftover rounding cents go to the largest
 * winning bet (ties: earliest in input order). Returns [] when nobody won.
 */
export function computePayouts(
  bets: BetLike[],
  winningOutcomeId: string,
): { userId: string; amountCents: number }[] {
  const pool = bets.reduce((s, b) => s + b.amountCents, 0);
  const winners = bets.filter((b) => b.outcomeId === winningOutcomeId);
  const winningTotal = winners.reduce((s, b) => s + b.amountCents, 0);
  if (winningTotal === 0) return [];

  const payouts = winners.map((b) => ({
    userId: b.userId,
    amountCents: Math.floor((pool * b.amountCents) / winningTotal),
  }));
  const paid = payouts.reduce((s, p) => s + p.amountCents, 0);
  const leftover = pool - paid;
  if (leftover > 0) {
    let idx = 0;
    for (let i = 1; i < winners.length; i++) {
      if (winners[i].amountCents > winners[idx].amountCents) idx = i;
    }
    payouts[idx].amountCents += leftover;
  }
  return payouts;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function parseDollars(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
