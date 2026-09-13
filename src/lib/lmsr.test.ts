import { describe, expect, it } from "vitest";
import { cost, liquidityB, prices, settleLiquid, sharesForSpend } from "./lmsr";

describe("lmsr", () => {
  const L = 10_00; // $10 liquidity
  const b = liquidityB(L, 2);

  it("starts at even prices", () => {
    expect(prices([0, 0], b)).toEqual([0.5, 0.5]);
    expect(prices([0, 0, 0], liquidityB(L, 3)).every((p) => Math.abs(p - 1 / 3) < 1e-12)).toBe(true);
  });

  it("buying matches the cost function and raises the price", () => {
    const q = [0, 0];
    const spend = 5_00;
    const d = sharesForSpend(q, b, 0, spend);
    const q2 = [d, 0];
    expect(cost(q2, b) - cost(q, b)).toBeCloseTo(spend, 6);
    expect(d).toBeGreaterThan(spend); // bought below $1/share
    expect(prices(q2, b)[0]).toBeGreaterThan(0.5);
  });

  it("stable for spends far larger than liquidity", () => {
    const d = sharesForSpend([0, 0], b, 0, 1_000_000_00);
    expect(Number.isFinite(d)).toBe(true);
    expect(cost([d, 0], b) - cost([0, 0], b)).toBeCloseTo(1_000_000_00, 0);
  });

  it("market maker never loses more than liquidity, and pool is conserved", () => {
    let q = [0, 0];
    const bets = [];
    const buys: [number, number][] = [
      [0, 3_00],
      [1, 2_50],
      [0, 20_00],
      [1, 1_00],
    ];
    for (const [i, s] of buys) {
      const d = sharesForSpend(q, b, i, s);
      q = q.map((x, j) => (j === i ? x + d : x));
      bets.push({ userId: `u${i}`, outcomeId: `o${i}`, amountCents: s, shares: d });
    }
    const spent = buys.reduce((s, [, x]) => s + x, 0);
    for (const win of ["o0", "o1"]) {
      const { winners, creatorCents } = settleLiquid(bets, win, L);
      const paid = winners.reduce((s, w) => s + w.amountCents, 0);
      expect(paid + creatorCents).toBe(L + spent);
      expect(creatorCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("no trades: creator gets liquidity back", () => {
    expect(settleLiquid([], "o0", L)).toEqual({ winners: [], creatorCents: L });
  });
});
