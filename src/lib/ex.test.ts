import { describe, expect, it } from "vitest";
import {
  CUSTOMER,
  CUSTOMER_LEAN,
  ENDOWMENT,
  MM,
  MM_LEVELS,
  advance,
  pathFor,
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
  answer: 70,
  priceMin: 1,
  priceMax: 100,
  guessPct: 20,
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
    const s = emptyState(50);
    submit(s, "a", false, 52, 5, 0);
    const { trades } = submit(s, "b", true, 55, 8, 0);
    expect(trades).toEqual([expect.objectContaining({ price: 52, qty: 5, buyer: "b", seller: "a" })]);
    expect(s.book.bids).toEqual([expect.objectContaining({ owner: "b", price: 55, qty: 3 })]);
    expect(s.accounts.b).toEqual({ cash: ENDOWMENT - 260, pos: 5 });
    expect(s.last).toBe(52);
  });

  it("uses price then time priority", () => {
    const s = emptyState(50);
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
    const s = emptyState(50);
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
  it("fair starts within guessPct of the answer and reaches it on the last step", () => {
    for (let seed = 0; seed < 50; seed++) {
      const c = cfg({ seed, answer: 63.4 });
      const th = thetaPath(c, 10);
      expect(th).toHaveLength(10);
      expect(Math.abs(th[0] - 63.4)).toBeLessThanOrEqual(20 + 4 + 1);
      expect(th[9]).toBe(63);
      for (const v of th) expect(Number.isInteger(v) && v >= 1 && v <= 100).toBe(true);
      // Closes in: each step's distance is within the shrinking error band.
      for (let k = 1; k < 10; k++) expect(Math.abs(th[k] - 63.4)).toBeLessThanOrEqual(25 * (1 - k / 9) + 0.5);
    }
  });

  it("fair stays on a wide host range and is exact with no guess error", () => {
    const wide = cfg({ priceMin: 0, priceMax: 5000, answer: 4990, guessPct: 50 });
    for (const v of thetaPath(wide, 20)) expect(v >= 0 && v <= 5000).toBe(true);
    expect(thetaPath(cfg({ guessPct: 0 }), 10)).toEqual(Array(10).fill(70));
  });

  it("customers trade both sides near fair, leaning toward paying up", () => {
    let buys = 0;
    let lean = 0;
    for (let i = 0; i < 2000; i++) {
      const o = customerOrder(cfg({ seed: 7 }), i, 50);
      const edge = o.buy ? o.price - 50 : 50 - o.price;
      expect(edge).toBeGreaterThanOrEqual(-5 + CUSTOMER_LEAN);
      expect(edge).toBeLessThanOrEqual(5 + CUSTOMER_LEAN);
      lean += edge;
      if (o.buy) buys++;
    }
    expect(buys).toBeGreaterThan(900);
    expect(buys).toBeLessThan(1100);
    expect(lean / 2000).toBeCloseTo(CUSTOMER_LEAN, 0);
  });

  it("customer prices stay inside the price range near the edges", () => {
    const c = cfg({ seed: 3, priceMin: 10, priceMax: 40 });
    for (let i = 0; i < 500; i++) {
      for (const theta of [10, 40]) {
        const { price } = customerOrder(c, i, theta);
        expect(price).toBeGreaterThanOrEqual(10);
        expect(price).toBeLessThanOrEqual(40);
      }
    }
  });

  it("market maker quotes 1000 at each level around fair but fair itself at the start", () => {
    const c = cfg({ customerRate: 0, priceMin: 0, priceMax: 1000, answer: 500 });
    const th = thetaPath(c, steps(c));
    const s = advance(emptyState(th[0]), c, 0);
    const mm = [...s.book.bids, ...s.book.asks].filter((o) => o.owner === MM);
    expect(mm).toHaveLength(2 * MM_LEVELS);
    expect(mm.every((o) => o.qty === 1000 && o.buy === o.price < th[0])).toBe(true);
    expect(s.book.bids[0].price).toBe(th[0] - 1);
    expect(s.book.asks[0].price).toBe(th[0] + 1);
  });

  it("market maker re-quotes one step late, around the previous fair", () => {
    const c = cfg({ customerRate: 0, caseSecs: 6000 });
    const th = thetaPath(c, steps(c));
    const k = th.findIndex((v, i) => i > 1 && v !== th[i - 1]);
    const s = advance(emptyState(50), c, k * c.stepSecs * 1000);
    expect(s.book.bids[0].price).toBe(th[k - 1] - 1);
    expect(s.book.asks[0].price).toBe(th[k - 1] + 1);
  });

  it("sends customer orders at the configured rate", () => {
    const s = advance(emptyState(50), cfg({ customerRate: 10 }), 5000);
    expect(s.ci).toBe(51);
    expect(s.chart).toHaveLength(6);
  });

  it("replays deterministically however it is chunked", () => {
    const c = cfg();
    const once = advance(emptyState(50), c, 125_000);
    const chunked = emptyState(50);
    for (let t = 0; t <= 125_000; t += 3_777) advance(chunked, c, t);
    advance(chunked, c, 125_000);
    expect(chunked).toEqual(once);
  });

  it("re-quotes when one side of the maker is cleaned out", () => {
    const c = cfg({ customerRate: 0, priceMin: 0, priceMax: 1000, answer: 500 });
    const th = thetaPath(c, steps(c));
    const s = advance(emptyState(th[0]), c, 0);
    submit(s, "p", true, th[0] + MM_LEVELS, 1000 * MM_LEVELS, 500);
    expect(s.book.asks.some((o) => o.owner === MM)).toBe(false);
    advance(s, c, 1000);
    expect(s.book.asks[0]).toEqual(expect.objectContaining({ owner: MM, price: th[0] + 1 }));
  });

  it("does not re-quote at a range edge where one side is empty by design", () => {
    const c = cfg({ customerRate: 0, answer: 1, guessPct: 0 });
    const s = advance(emptyState(1), c, 5000);
    expect(s.book.bids).toHaveLength(0);
    expect(s.nextId).toBe(1 + MM_LEVELS);
  });

  it("samples the final P&L at the answer", () => {
    const c = cfg({ caseSecs: 60, customerRate: 0 });
    const s = emptyState(50);
    submit(s, "x", false, 50, 10, 0);
    submit(s, "p", true, 50, 10, 0);
    advance(s, c, 60_000);
    expect(s.pnlHistory.at(-1)).toEqual([60, expect.objectContaining({ p: 10 * (70 - 50) })]);
  });

  it("ending early keeps the bots' path planned at the open", () => {
    const c = cfg({ caseSecs: 600 });
    const full = { ...emptyState(50), steps: steps(c) };
    advance(full, c, 149_999);
    const early = { ...emptyState(50), steps: steps(c) };
    advance(early, c, 100_000);
    advance(early, { ...c, caseSecs: 150 }, 149_999);
    expect(early.book).toEqual(full.book);
    expect(pathFor(early, { ...c, caseSecs: 150 })).toEqual(thetaPath(c, 10));
  });

  it("stops at the bell", () => {
    const c = cfg({ caseSecs: 60 });
    const s = advance(emptyState(50), c, 120_000);
    expect(s.t).toBe(60_000);
    expect(s.ci).toBe(600);
  });
});

describe("players", () => {
  it("marks P&L to the given price", () => {
    const s = emptyState(50);
    submit(s, MM, false, 50, 10, 0);
    submit(s, "p", true, 50, 10, 0);
    submit(s, "x", false, 55, 1, 0);
    submit(s, "y", true, 55, 1, 0);
    expect(pnl(s.accounts.p, s.last)).toBe(50);
  });

  it("enforces order size, open orders and long/short exposure", () => {
    const c = cfg({ positionLimit: 100, maxOrderSize: 60, maxOpenOrders: 2 });
    const s = emptyState(50);
    expect(checkOrder(s, c, "p", true, 0, 1)).toMatch(/whole number from 1 to 100/);
    expect(checkOrder(s, c, "p", true, 101, 1)).toMatch(/whole number/);
    expect(checkOrder(s, c, "p", true, 50, 61)).toMatch(/maximum order size/);
    submit(s, "p", true, 40, 60, 0);
    expect(checkOrder(s, c, "p", true, 41, 41)).toMatch(/risk limit/);
    expect(checkOrder(s, c, "p", false, 60, 60)).toBeNull();
    submit(s, "p", false, 60, 60, 0);
    expect(openOrders(s, "p")).toHaveLength(2);
    expect(checkOrder(s, c, "p", true, 41, 1)).toBe("Too many open orders");
  });
});
