import { describe, expect, it } from "vitest";
import { cardMean, drawCard, infoOrder, maxNextSpread, ranks, resolveAuction, takerPnl, validateQuote } from "./tt";

const b = (playerId: string, amount: number, at = 0) => ({ playerId, amount, at });

describe("resolveAuction", () => {
  it("first price pays own bid", () => {
    expect(resolveAuction([b("a", 10), b("b", 15), b("c", 5)], "FIRST_PRICE")).toEqual({ winnerId: "b", price: 15 });
  });
  it("second price pays the runner-up", () => {
    expect(resolveAuction([b("a", 10), b("b", 15), b("c", 5)], "SECOND_PRICE")).toEqual({ winnerId: "b", price: 10 });
  });
  it("sole bidder pays 0 in second price", () => {
    expect(resolveAuction([b("a", 7), b("b", 0)], "SECOND_PRICE")).toEqual({ winnerId: "a", price: 0 });
  });
  it("no positive bids means no sale", () => {
    expect(resolveAuction([b("a", 0)], "FIRST_PRICE")).toBeNull();
  });
  it("earliest bid wins ties", () => {
    expect(resolveAuction([b("a", 10, 5), b("b", 10, 2)], "SECOND_PRICE")).toEqual({ winnerId: "b", price: 10 });
  });
});

describe("validateQuote", () => {
  it("allows any opening quote without a cap", () => {
    expect(validateQuote({ bid: 0, ask: 500 }, null, 10, null)).toBeNull();
  });
  it("enforces the opening cap", () => {
    expect(validateQuote({ bid: 100, ask: 160 }, null, 10, 50)).toMatch(/at most 50/);
  });
  it("requires a 10% tighter spread", () => {
    const best = { bid: 100, ask: 120 };
    expect(maxNextSpread(best, 10, null)).toBe(18);
    expect(validateQuote({ bid: 101, ask: 119 }, best, 10, null)).toBeNull();
    expect(validateQuote({ bid: 101, ask: 120 }, best, 10, null)).toMatch(/at most 18/);
  });
  it("rejects crossed and zero-width-follow-ups", () => {
    expect(validateQuote({ bid: 10, ask: 9 }, null, 10, null)).toMatch(/at least the bid/);
    expect(validateQuote({ bid: 10, ask: 10 }, { bid: 10, ask: 10 }, 10, null)).toMatch(/zero-width/);
  });
});

describe("settlement", () => {
  it("buyer and seller pnl", () => {
    const m = { bid: 100, ask: 110 };
    expect(takerPnl("BUY", m, 130)).toBe(20);
    expect(takerPnl("SELL", m, 130)).toBe(-30);
    expect(takerPnl("PASS", m, 130)).toBe(0);
  });
  it("ranks with ties", () => {
    expect(ranks([5, 10, 5, -1])).toEqual([2, 1, 2, 4]);
  });
});

describe("contract", () => {
  it("skewed cards stay in range with mean ~34", () => {
    for (let i = 0; i < 1000; i++) {
      const c = drawCard("SKEWED");
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(100);
    }
    expect(drawCard("SKEWED", () => 0)).toBe(1);
    expect(drawCard("UNIFORM", () => 0.999999)).toBe(100);
    expect(cardMean("UNIFORM")).toBeCloseTo(50.5);
    expect(cardMean("SKEWED")).toBeGreaterThan(33);
    expect(cardMean("SKEWED")).toBeLessThan(35);
  });
  it("sorted info is largest first", () => {
    expect(infoOrder([3, 40, 7, 12], 4, true)).toEqual([40, 12, 7, 3]);
    expect(infoOrder([3, 40, 7, 12], 2, true)).toEqual([40, 12]);
    expect(infoOrder([3, 40, 7, 12], 4, false).sort((a, b) => a - b)).toEqual([3, 7, 12, 40]);
  });
});
