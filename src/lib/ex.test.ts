import { describe, expect, it } from "vitest";
import {
  CUSTOMER,
  ENDOWMENT,
  MM,
  advance,
  checkOrder,
  customerOrder,
  emptyState,
  openOrders,
  pnl,
  steps,
  submit,
  thetaPath,
  type ExConfig,
} from "./ex";

const cfg = (over: Partial<ExConfig> = {}): ExConfig => ({
  seed: 42,
  caseSecs: 600,
  stepSecs: 60,
  customerRate: 10,
  positionLimit: 1_000_000,
  maxOrderSize: 1000,
  maxOpenOrders: 100,
  ...over,
});

describe("order book", () => {
  it("fills at the resting price and rests the remainder", () => {
    const s = emptyState();
    submit(s, "a", false, 52, 5, 0);
    const { trades } = submit(s, "b", true, 55, 8, 0);
    expect(trades).toEqual([expect.objectContaining({ price: 52, qty: 5, buyer: "b", seller: "a" })]);
    expect(s.book.bids).toEqual([expect.objectContaining({ owner: "b", price: 55, qty: 3 })]);
    expect(s.accounts.b).toEqual({ cash: ENDOWMENT - 260, pos: 5 });
    expect(s.last).toBe(52);
  });

  it("uses price then time priority", () => {
    const s = emptyState();
    submit(s, "a", false, 51, 5, 0);
    submit(s, "b", false, 50, 5, 0);
    submit(s, "c", false, 50, 5, 0);
    const { trades } = submit(s, "d", true, 51, 12, 0);
    expect(trades.map((t) => [t.seller, t.price, t.qty])).toEqual([
      ["b", 50, 5],
      ["c", 50, 5],
      ["a", 51, 2],
    ]);
  });

  it("merges a bot's back-to-back orders at a level without changing who fills first", () => {
    const s = emptyState();
    submit(s, CUSTOMER, true, 40, 10, 0);
    submit(s, CUSTOMER, true, 40, 10, 0);
    submit(s, "p", true, 40, 5, 0);
    submit(s, CUSTOMER, true, 40, 10, 0);
    expect(s.book.bids.map((o) => [o.owner, o.qty])).toEqual([
      [CUSTOMER, 20],
      ["p", 5],
      [CUSTOMER, 10],
    ]);
  });
});

describe("bots", () => {
  it("fair starts in 40..60 and steps by at most 5 within 1..100", () => {
    for (let seed = 0; seed < 50; seed++) {
      const th = thetaPath(seed, 200);
      expect(th[0]).toBeGreaterThanOrEqual(40);
      expect(th[0]).toBeLessThanOrEqual(60);
      for (let i = 1; i < th.length; i++) {
        expect(Math.abs(th[i] - th[i - 1])).toBeLessThanOrEqual(5);
        expect(th[i]).toBeGreaterThanOrEqual(1);
        expect(th[i]).toBeLessThanOrEqual(100);
      }
    }
  });

  it("customers send orders within 5 of fair, both sides", () => {
    let buys = 0;
    for (let i = 0; i < 2000; i++) {
      const o = customerOrder(7, i, 50);
      expect(Math.abs(o.price - 50)).toBeLessThanOrEqual(5);
      if (o.buy) buys++;
    }
    expect(buys).toBeGreaterThan(900);
    expect(buys).toBeLessThan(1100);
  });

  it("market maker quotes 1000 at every price but fair at the start", () => {
    const c = cfg({ customerRate: 0 });
    const s = advance(emptyState(), c, 0);
    const th = thetaPath(c.seed, steps(c));
    const mm = [...s.book.bids, ...s.book.asks].filter((o) => o.owner === MM);
    expect(mm).toHaveLength(99);
    expect(mm.every((o) => o.qty === 1000 && o.buy === o.price < th[0])).toBe(true);
    expect(s.book.bids[0].price).toBe(th[0] - 1);
    expect(s.book.asks[0].price).toBe(th[0] + 1);
  });

  it("market maker re-quotes one step late, around the previous fair", () => {
    const c = cfg({ customerRate: 0, caseSecs: 6000 });
    const th = thetaPath(c.seed, steps(c));
    const k = th.findIndex((v, i) => i > 1 && v !== th[i - 1]);
    const s = advance(emptyState(), c, k * c.stepSecs * 1000);
    expect(s.book.bids[0].price).toBe(th[k - 1] - 1);
    expect(s.book.asks[0].price).toBe(th[k - 1] + 1);
  });

  it("sends customer orders at the configured rate", () => {
    const s = advance(emptyState(), cfg({ customerRate: 10 }), 5000);
    expect(s.ci).toBe(51);
    expect(s.chart).toHaveLength(6);
  });

  it("replays deterministically however it is chunked", () => {
    const c = cfg();
    const once = advance(emptyState(), c, 125_000);
    const chunked = emptyState();
    for (let t = 0; t <= 125_000; t += 3_777) advance(chunked, c, t);
    advance(chunked, c, 125_000);
    expect(chunked).toEqual(once);
  });

  it("stops at the bell", () => {
    const c = cfg({ caseSecs: 60 });
    const s = advance(emptyState(), c, 120_000);
    expect(s.t).toBe(60_000);
    expect(s.ci).toBe(600);
  });
});

describe("players", () => {
  it("marks P&L to the last traded price", () => {
    const s = emptyState();
    submit(s, MM, false, 50, 10, 0);
    submit(s, "p", true, 50, 10, 0);
    submit(s, "x", false, 55, 1, 0);
    submit(s, "y", true, 55, 1, 0);
    expect(pnl(s.accounts.p, s.last)).toBe(50);
  });

  it("enforces order size, open orders and long/short exposure", () => {
    const c = cfg({ positionLimit: 100, maxOrderSize: 60, maxOpenOrders: 2 });
    const s = emptyState();
    expect(checkOrder(s, c, "p", true, 0, 1)).toBe("Invalid price");
    expect(checkOrder(s, c, "p", true, 50, 61)).toMatch(/maximum order size/);
    submit(s, "p", true, 40, 60, 0);
    expect(checkOrder(s, c, "p", true, 41, 41)).toMatch(/risk limit/);
    expect(checkOrder(s, c, "p", false, 60, 60)).toBeNull();
    submit(s, "p", false, 60, 60, 0);
    expect(openOrders(s, "p")).toHaveLength(2);
    expect(checkOrder(s, c, "p", true, 41, 1)).toBe("Too many open orders");
  });
});
