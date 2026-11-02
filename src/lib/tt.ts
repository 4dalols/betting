import type { TtDistribution, TtSide } from "@/generated/prisma/client";

/** Trade or Tighten: pure game rules (no I/O), shared by the server and the client. */

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatNum(n: number): string {
  return round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatSigned(n: number): string {
  const v = round2(n);
  return v > 0 ? `+${formatNum(v)}` : formatNum(v);
}

export const ELO_START = 1200;
export const MAX_BID = 100;

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

export function itemLabel(index: number): string {
  if (index === 0) return "Largest";
  const n = index + 1;
  return `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} largest`;
}

// ---------- Info auction ----------

export type SealedBids = { playerId: string; amounts: number[]; at: number };
export type Award = { index: number; winnerId: string | null; price: number };

/**
 * Settles the info items largest first. Each item is a second-price auction among players who haven't won yet:
 * the highest bid wins (earliest submission, then id, on ties) and pays the next-highest eligible bid, or 0 if
 * they're the only one left. A winner drops out of the later auctions, so everyone wins at most one item.
 * Players missing from `bids` bid 0 on everything.
 */
export function settleAuctions(itemCount: number, playerIds: string[], bids: SealedBids[]): Award[] {
  const byPlayer = new Map(bids.map((b) => [b.playerId, b]));
  let eligible = [...playerIds];
  const awards: Award[] = [];
  for (let i = 0; i < itemCount; i++) {
    const ranked = eligible
      .map((id) => ({ id, amount: byPlayer.get(id)?.amounts[i] ?? 0, at: byPlayer.get(id)?.at ?? Infinity }))
      .sort((a, b) => b.amount - a.amount || a.at - b.at || a.id.localeCompare(b.id));
    if (ranked.length === 0) {
      awards.push({ index: i, winnerId: null, price: 0 });
      continue;
    }
    awards.push({ index: i, winnerId: ranked[0].id, price: round2(ranked[1]?.amount ?? 0) });
    eligible = eligible.filter((id) => id !== ranked[0].id);
  }
  return awards;
}

// ---------- Trade or tighten ----------

/** Widest spread the next proposal may have, or null if any width is allowed. */
export function maxNextWidth(best: number | null, tightenPct: number): number | null {
  return best === null ? null : round2(best * (1 - tightenPct / 100));
}

/** Returns an error message, or null if `width` is a valid tightening of `best`. */
export function validateWidth(width: number, best: number | null, tightenPct: number): string | null {
  if (!Number.isFinite(width) || width < 0) return "Enter a spread width of 0 or more";
  if (best === null) return null;
  if (best <= 0) return "The spread is already zero — it can't get tighter";
  const limit = maxNextWidth(best, tightenPct)!;
  if (width > limit + 1e-9 || width >= best) return `Width must be at most ${formatNum(limit)} (${tightenPct}% tighter than ${formatNum(best)})`;
  return null;
}

/** PnL for the taker of one lot; the market maker gets the opposite. */
export function takerPnl(side: TtSide, market: { bid: number; ask: number }, value: number): number {
  if (side === "BUY") return round2(value - market.ask);
  if (side === "SELL") return round2(market.bid - value);
  return 0;
}

// ---------- Scoring ----------

/** Rescales a room's trading PnL to 0–100 (best = 100, worst = 0); everyone gets 50 if all are equal. */
export function normalize(pnls: number[]): number[] {
  const lo = Math.min(...pnls);
  const hi = Math.max(...pnls);
  if (!(hi - lo > 1e-9)) return pnls.map(() => 50);
  return pnls.map((p) => round2((100 * (p - lo)) / (hi - lo)));
}

/** Multiplayer Elo: every pair in the room is a game decided by round score; changes are scaled by 1/(n−1). */
export function eloUpdate(ratings: number[], scores: number[], k = 32): number[] {
  const n = ratings.length;
  if (n < 2) return [...ratings];
  return ratings.map((r, i) => {
    let delta = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const expected = 1 / (1 + 10 ** ((ratings[j] - r) / 400));
      const actual = Math.abs(scores[i] - scores[j]) < 1e-9 ? 0.5 : scores[i] > scores[j] ? 1 : 0;
      delta += actual - expected;
    }
    return round2(r + (k * delta) / (n - 1));
  });
}

/**
 * Splits players (already ordered, e.g. by Elo descending) into contiguous rooms of about `roomSize`,
 * as evenly as possible: 5 players at size 4 → one room of 5, 6 → 3 + 3, 10 → 4 + 3 + 3.
 */
export function assignRooms<T>(ordered: T[], roomSize: number): T[][] {
  if (ordered.length === 0) return [];
  const rooms = Math.max(1, Math.round(ordered.length / roomSize));
  const base = Math.floor(ordered.length / rooms);
  const extra = ordered.length % rooms;
  const out: T[][] = [];
  let at = 0;
  for (let r = 0; r < rooms; r++) {
    const size = base + (r < extra ? 1 : 0);
    out.push(ordered.slice(at, at + size));
    at += size;
  }
  return out;
}

export function shuffle<T>(xs: T[], rand: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Standard competition ranking (1, 1, 3) by descending score. */
export function ranks(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s + 1e-9).length);
}
