/**
 * Logarithmic Market Scoring Rule (Hanson) automated market maker.
 *
 * All money is in integer cents. A share pays 1 cent if its outcome wins, so
 * `shares` is directly the payout in cents. The liquidity parameter b is chosen
 * so the market maker's worst-case loss is exactly the liquidity they provided:
 * b = L / ln(n).
 */

export function liquidityB(liquidityCents: number, outcomeCount: number) {
  return liquidityCents / Math.log(outcomeCount);
}

/** Current price (probability) of each outcome, from outstanding shares q. */
export function prices(q: number[], b: number): number[] {
  const m = Math.max(...q);
  const e = q.map((x) => Math.exp((x - m) / b));
  const t = e.reduce((s, x) => s + x, 0);
  return e.map((x) => x / t);
}

/** Cost function C(q) = b * ln(sum exp(q_i / b)), in cents. */
export function cost(q: number[], b: number): number {
  const m = Math.max(...q);
  return m + b * Math.log(q.reduce((s, x) => s + Math.exp((x - m) / b), 0));
}

/**
 * Shares received for spending `spendCents` on outcome `i`.
 * Closed form: Δ = b * ln(1 + (e^{S/b} - 1) / p_i).
 */
export function sharesForSpend(q: number[], b: number, i: number, spendCents: number): number {
  const p = prices(q, b)[i];
  const x = spendCents / b;
  // log1p(expm1(x)/p) computed stably for large x
  const delta = x > 30 ? x - Math.log(p) : Math.log1p(Math.expm1(x) / p);
  return b * delta;
}

export type LiquidBet = { userId: string; outcomeId: string; amountCents: number; shares: number };

/**
 * Settle a liquid market. Winners receive floor(shares) cents; the creator
 * receives whatever remains of (liquidity + all spend), which LMSR guarantees
 * is non-negative. Sum of all payouts equals the total pool exactly.
 */
export function settleLiquid(
  bets: LiquidBet[],
  winningOutcomeId: string,
  liquidityCents: number,
): { winners: { userId: string; amountCents: number }[]; creatorCents: number } {
  const pool = liquidityCents + bets.reduce((s, b) => s + b.amountCents, 0);
  const winners = bets
    .filter((b) => b.outcomeId === winningOutcomeId)
    .map((b) => ({ userId: b.userId, amountCents: Math.floor(b.shares) }))
    .filter((w) => w.amountCents > 0);
  let paid = winners.reduce((s, w) => s + w.amountCents, 0);
  if (paid > pool) {
    // Float drift safety net: scale down so we never pay out more than exists.
    const scale = pool / paid;
    for (const w of winners) w.amountCents = Math.floor(w.amountCents * scale);
    paid = winners.reduce((s, w) => s + w.amountCents, 0);
  }
  return { winners, creatorCents: pool - paid };
}
