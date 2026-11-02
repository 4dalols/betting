import { describe, expect, it } from "vitest";
import { assignRooms, cardMean, drawCard, eloUpdate, maxNextWidth, normalize, ranks, settleAuctions, takerPnl, validateWidth } from "./tt";

const bid = (playerId: string, amounts: number[], at = 0) => ({ playerId, amounts, at });

describe("settleAuctions", () => {
  it("runs sequential second-price auctions, removing each winner", () => {
    const awards = settleAuctions(4, ["a", "b", "c", "d"], [
      bid("a", [30, 20, 10, 5]),
      bid("b", [25, 22, 8, 1]),
      bid("c", [10, 15, 12, 3]),
      bid("d", [5, 5, 5, 5]),
    ]);
    expect(awards).toEqual([
      { index: 0, winnerId: "a", price: 25 }, // 4 bidders: a wins, pays b's 25
      { index: 1, winnerId: "b", price: 15 }, // b, c, d: b wins, pays c's 15
      { index: 2, winnerId: "c", price: 5 }, // c, d: c wins, pays d's 5
      { index: 3, winnerId: "d", price: 0 }, // d alone: free
    ]);
  });
  it("treats missing bids as zero and still awards every item while players remain", () => {
    expect(settleAuctions(3, ["a", "b"], [bid("a", [0, 9, 0], 1)])).toEqual([
      { index: 0, winnerId: "a", price: 0 },
      { index: 1, winnerId: "b", price: 0 },
      { index: 2, winnerId: null, price: 0 },
    ]);
  });
  it("breaks ties by earliest submission", () => {
    expect(settleAuctions(1, ["a", "b"], [bid("a", [10], 5), bid("b", [10], 2)])[0]).toEqual({ index: 0, winnerId: "b", price: 10 });
  });
});

describe("validateWidth", () => {
  it("allows any opening width", () => {
    expect(validateWidth(50, null, 10)).toBeNull();
    expect(validateWidth(-1, null, 10)).toMatch(/0 or more/);
  });
  it("requires 10% tighter: 10 → 9 → 8.1", () => {
    expect(maxNextWidth(10, 10)).toBe(9);
    expect(validateWidth(9, 10, 10)).toBeNull();
    expect(validateWidth(9.5, 10, 10)).toMatch(/at most 9/);
    expect(validateWidth(8.1, 9, 10)).toBeNull();
    expect(validateWidth(3, 9, 10)).toBeNull();
  });
  it("rejects tightening a zero spread", () => {
    expect(validateWidth(0, 0, 10)).toMatch(/zero/);
  });
});

describe("scoring", () => {
  it("taker and maker pnl", () => {
    expect(takerPnl("BUY", { bid: 100, ask: 110 }, 130)).toBe(20);
    expect(takerPnl("SELL", { bid: 100, ask: 110 }, 130)).toBe(-30);
    expect(takerPnl("PASS", { bid: 100, ask: 110 }, 130)).toBe(0);
  });
  it("normalizes to 0–100, or 50 when tied", () => {
    expect(normalize([-20, 0, 30])).toEqual([0, 40, 100]);
    expect(normalize([5, 5])).toEqual([50, 50]);
    expect(normalize([7])).toEqual([50]);
  });
  it("elo is zero-sum and rewards the winner", () => {
    const after = eloUpdate([1200, 1200, 1200], [80, 50, 20]);
    expect(after[0]).toBeGreaterThan(1200);
    expect(after[2]).toBeLessThan(1200);
    expect(after.reduce((s, x) => s + x, 0)).toBeCloseTo(3600, 1);
    expect(eloUpdate([1300], [10])).toEqual([1300]);
  });
  it("ranks ties together", () => {
    expect(ranks([10, 5, 10, -3])).toEqual([1, 3, 1, 4]);
  });
});

describe("assignRooms", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i);
  it("balances room sizes around the target", () => {
    expect(assignRooms(ids(8), 4).map((r) => r.length)).toEqual([4, 4]);
    expect(assignRooms(ids(5), 4).map((r) => r.length)).toEqual([5]);
    expect(assignRooms(ids(6), 4).map((r) => r.length)).toEqual([3, 3]);
    expect(assignRooms(ids(10), 4).map((r) => r.length)).toEqual([4, 3, 3]);
    expect(assignRooms(ids(2), 4)).toEqual([[0, 1]]);
  });
  it("keeps order so top-rated players share a room", () => {
    expect(assignRooms(ids(8), 4)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
  });
});

describe("distribution", () => {
  it("draws stay in 1..100 and means match", () => {
    for (const u of [0, 1e-9, 0.5, 0.999999]) {
      for (const d of ["SKEWED", "UNIFORM"] as const) {
        const v = drawCard(d, () => u);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    expect(cardMean("UNIFORM")).toBeCloseTo(50.5, 6);
    expect(cardMean("SKEWED")).toBeGreaterThan(33);
    expect(cardMean("SKEWED")).toBeLessThan(35);
  });
});
