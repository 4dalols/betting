import type { TtAuctionType, TtDistribution, TtSide } from "@/generated/prisma/client";

/** Trade or Tighten: pure game rules (no I/O), shared by the server and the client. */

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatMoney(n: number): string {
  const v = round2(n);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "-" : ""}$${abs}`;
}

export function formatPrice(n: number): string {
  return round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatSigned(n: number): string {
  const v = round2(n);
  return v > 0 ? `+${formatMoney(v)}` : formatMoney(v);
}

// ---------- Contract distribution ----------

/** Probability of each card value 1..100. */
function pmf(dist: TtDistribution): number[] {
  const p: number[] = [];
  for (let k = 1; k <= 100; k++) p.push(dist === "UNIFORM" ? 0.01 : Math.sqrt(k / 100) - Math.sqrt((k - 1) / 100));
  return p;
}

export function drawCard(dist: TtDistribution, rand: () => number = Math.random): number {
  const u = rand();
  if (dist === "UNIFORM") return 1 + Math.min(99, Math.floor(u * 100));
  return Math.min(100, Math.max(1, Math.ceil(100 * u * u)));
}

export function cardMean(dist: TtDistribution): number {
  return pmf(dist).reduce((s, p, i) => s + p * (i + 1), 0);
}

export const distributionInfo: Record<TtDistribution, { label: string; describe: string }> = {
  SKEWED: { label: "Skewed (mostly small)", describe: "each number is ⌈100·U²⌉ with U uniform on (0,1): 1–100, skewed toward small values" },
  UNIFORM: { label: "Uniform 1–100", describe: "each number is uniform on 1–100" },
};

/** Info items for a round: the card values in auction order (largest first when sorted, else a random subset). */
export function infoOrder(cards: number[], count: number, sorted: boolean, rand: () => number = Math.random): number[] {
  const vals = [...cards];
  if (sorted) vals.sort((a, b) => b - a);
  else
    for (let i = vals.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [vals[i], vals[j]] = [vals[j], vals[i]];
    }
  return vals.slice(0, count);
}

export function itemLabel(index: number, sorted: boolean): string {
  if (!sorted) return `A random number (#${index + 1})`;
  if (index === 0) return "The largest number";
  const n = index + 1;
  const suffix = n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `The ${n}${suffix} largest number`;
}

// ---------- Info auction ----------

export type SealedBid = { playerId: string; amount: number; at: number };

/** Sealed-bid auction. Highest positive bid wins (earliest on ties); second price pays the runner-up's bid (0 if none). */
export function resolveAuction(bids: SealedBid[], type: TtAuctionType): { winnerId: string; price: number } | null {
  const ranked = bids.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount || a.at - b.at);
  if (ranked.length === 0) return null;
  const price = type === "FIRST_PRICE" ? ranked[0].amount : (ranked[1]?.amount ?? 0);
  return { winnerId: ranked[0].playerId, price: round2(price) };
}

// ---------- Tightening ----------

export type Market = { bid: number; ask: number };

export const spreadOf = (m: Market) => round2(m.ask - m.bid);

/** Widest spread allowed for the next quote, or null if any spread is allowed. */
export function maxNextSpread(best: Market | null, tightenPct: number, maxSpread: number | null): number | null {
  if (!best) return maxSpread;
  return round2(spreadOf(best) * (1 - tightenPct / 100));
}

/** Returns an error message, or null if the quote is a valid tightening. */
export function validateQuote(q: Market, best: Market | null, tightenPct: number, maxSpread: number | null): string | null {
  if (!Number.isFinite(q.bid) || !Number.isFinite(q.ask)) return "Enter a bid and an ask";
  if (q.ask < q.bid) return "Ask must be at least the bid";
  const spread = spreadOf(q);
  if (best) {
    const bestSpread = spreadOf(best);
    if (bestSpread <= 0) return "The market is already zero-width — it can't get tighter";
    const limit = maxNextSpread(best, tightenPct, maxSpread)!;
    if (spread > limit + 1e-9 || (tightenPct === 0 && spread >= bestSpread))
      return `Spread must be at most ${formatPrice(limit)} (${tightenPct}% tighter than ${formatPrice(bestSpread)})`;
  } else if (maxSpread !== null && spread > maxSpread + 1e-9) {
    return `Opening spread must be at most ${formatPrice(maxSpread)}`;
  }
  return null;
}

// ---------- Settlement ----------

/** PnL for the taker of one lot; the market maker gets the opposite. */
export function takerPnl(side: TtSide, market: Market, value: number): number {
  if (side === "BUY") return round2(value - market.ask);
  if (side === "SELL") return round2(market.bid - value);
  return 0;
}

/** Standard competition ranking (1, 1, 3) by descending score. */
export function ranks(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s + 1e-9).length);
}
