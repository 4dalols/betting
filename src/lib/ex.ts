/**
 * Exchange: a continuous limit-order book against bots, after the Traders@MIT "Mangocore" preliminary
 * single-contract case. Everything here is pure: the bots are generated from the game seed, so the server
 * replays them up to "now" on each request instead of running a background process.
 */

export const TICKER = "A";
export const PRICE_MIN = 1;
export const PRICE_MAX = 100;
export const STARTING_PRICE = 50;
export const ENDOWMENT = 100_000;
export const MM_QTY = 1000;
export const CUSTOMER_QTY = 10;
export const MM = "mm";
export const CUSTOMER = "cust";
const MAX_FILLS = 50;
const PNL_SAMPLE_SECS = 10;

export type ExConfig = {
  seed: number;
  caseSecs: number;
  /** Fair value moves once per step. */
  stepSecs: number;
  /** Customer orders per second. */
  customerRate: number;
  positionLimit: number;
  maxOrderSize: number;
  maxOpenOrders: number;
};

export type Order = { id: number; owner: string; buy: boolean; price: number; qty: number };
export type Book = { bids: Order[]; asks: Order[] };
export type Account = { cash: number; pos: number };
export type MyFill = { id: number; buy: boolean; price: number; qty: number; at: number };
/** [second, mid, last] */
export type ChartPoint = [number, number | null, number | null];

export type ExState = {
  /** Case time (ms since start) processed through. */
  t: number;
  /** Next fair-value step to process. */
  k: number;
  /** Next customer order to send. */
  ci: number;
  nextSample: number;
  nextId: number;
  nextTrade: number;
  book: Book;
  last: number;
  volume: number;
  accounts: Record<string, Account>;
  fills: Record<string, MyFill[]>;
  chart: ChartPoint[];
  /** Every PNL_SAMPLE_SECS: [second, P&L per player]. */
  pnlHistory: [number, Record<string, number>][];
};

// ---------- Seeded randomness ----------

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(...parts: number[]) {
  let h = 2166136261;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

const randint = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const clip = (p: number) => Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.round(p)));

export const steps = (cfg: Pick<ExConfig, "caseSecs" | "stepSecs">) => Math.max(1, Math.ceil(cfg.caseSecs / cfg.stepSecs));

/** Fair value θ per step: starts U{40..60}, then each step adds U{-5..5}, clipped to [1, 100]. */
export function thetaPath(seed: number, n: number): number[] {
  const rng = mulberry32(mix(seed, 0x7e7a));
  const out = [randint(rng, 40, 60)];
  for (let i = 1; i < n; i++) out.push(clip(out[i - 1] + randint(rng, -5, 5)));
  return out;
}

export function fairAt(cfg: ExConfig, theta: number[], tMs: number) {
  return theta[Math.min(theta.length - 1, Math.max(0, Math.floor(tMs / (cfg.stepSecs * 1000))))];
}

/** Customer order i: size 10 within ±5 of the current fair, buy or sell with equal odds. */
export function customerOrder(seed: number, i: number, theta: number) {
  const rng = mulberry32(mix(seed, 0xc057, i));
  const price = randint(rng, Math.max(PRICE_MIN, theta - 5), Math.min(PRICE_MAX, theta + 5));
  return { price, buy: rng() >= 0.5 };
}

// ---------- Order book ----------

const better = (o: Order, other: Order) => (o.buy ? o.price > other.price : o.price < other.price);
const isBot = (owner: string) => owner === MM || owner === CUSTOMER;

function rest(book: Book, order: Order) {
  const side = order.buy ? book.bids : book.asks;
  let lo = 0;
  let hi = side.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // Price-time priority: ahead of everything worse, behind everything at the same or better price.
    if (better(order, side[mid])) hi = mid;
    else lo = mid + 1;
  }
  const prev = side[lo - 1];
  // A bot order directly behind its own order at the same price fills identically if merged; keeps the book small.
  if (prev && isBot(order.owner) && prev.owner === order.owner && prev.price === order.price) prev.qty += order.qty;
  else side.splice(lo, 0, order);
}

export type Trade = { id: number; price: number; qty: number; buyer: string; seller: string };

export function emptyState(): ExState {
  return {
    t: 0,
    k: 0,
    ci: 0,
    nextSample: 0,
    nextId: 1,
    nextTrade: 1,
    book: { bids: [], asks: [] },
    last: STARTING_PRICE,
    volume: 0,
    accounts: {},
    fills: {},
    chart: [],
    pnlHistory: [],
  };
}

export function account(state: ExState, owner: string): Account {
  return (state.accounts[owner] ??= { cash: ENDOWMENT, pos: 0 });
}

function settle(state: ExState, trade: Trade, at: number) {
  for (const [owner, buy] of [
    [trade.buyer, true],
    [trade.seller, false],
  ] as const) {
    if (isBot(owner)) continue;
    const acc = account(state, owner);
    acc.cash += (buy ? -1 : 1) * trade.price * trade.qty;
    acc.pos += buy ? trade.qty : -trade.qty;
    const fills = (state.fills[owner] ??= []);
    fills.push({ id: trade.id, buy, price: trade.price, qty: trade.qty, at });
    if (fills.length > MAX_FILLS) fills.splice(0, fills.length - MAX_FILLS);
  }
  state.last = trade.price;
  state.volume += trade.qty;
}

/** Matches a new limit order against the book at the resting orders' prices, then rests any remainder. */
export function submit(state: ExState, owner: string, buy: boolean, price: number, qty: number, at: number): { order: Order; trades: Trade[] } {
  const book = state.book;
  const order: Order = { id: state.nextId++, owner, buy, price, qty };
  const opposite = buy ? book.asks : book.bids;
  const trades: Trade[] = [];
  while (order.qty > 0 && opposite.length > 0) {
    const top = opposite[0];
    if (buy ? top.price > price : top.price < price) break;
    const q = Math.min(order.qty, top.qty);
    const trade: Trade = { id: state.nextTrade++, price: top.price, qty: q, buyer: buy ? owner : top.owner, seller: buy ? top.owner : owner };
    order.qty -= q;
    top.qty -= q;
    if (top.qty === 0) opposite.shift();
    settle(state, trade, at);
    trades.push(trade);
  }
  if (order.qty > 0) rest(book, { ...order });
  return { order, trades };
}

export function cancelWhere(state: ExState, pred: (o: Order) => boolean): number {
  let n = 0;
  for (const side of [state.book.bids, state.book.asks]) {
    for (let i = side.length - 1; i >= 0; i--) {
      if (pred(side[i])) {
        side.splice(i, 1);
        n++;
      }
    }
  }
  return n;
}

export const openOrders = (state: ExState, owner: string) =>
  [...state.book.bids, ...state.book.asks].filter((o) => o.owner === owner).sort((a, b) => a.id - b.id);

export function mid(book: Book): number | null {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  return bid !== undefined && ask !== undefined ? (bid + ask) / 2 : null;
}

// ---------- Bots over time ----------

/** Market maker: 1000 lots at every price but the center, bids below and asks above. */
function quote(state: ExState, center: number, at: number) {
  cancelWhere(state, (o) => o.owner === MM);
  for (let p = PRICE_MIN; p <= PRICE_MAX; p++) if (p !== center) submit(state, MM, p < center, p, MM_QTY, at);
}

/**
 * Replays the bots from state.t up to toMs (capped at the end of the case):
 * - the market maker quotes around θ at the start, then each time θ changes it re-quotes around the previous θ;
 * - customers send one order every 1/customerRate seconds around the current θ;
 * - each second the chart is sampled (and the maker re-quotes at the current θ if it has been cleaned out).
 */
export function advance(state: ExState, cfg: ExConfig, toMs: number, theta = thetaPath(cfg.seed, steps(cfg))) {
  const end = cfg.caseSecs * 1000;
  const target = Math.min(toMs, end);
  const stepMs = cfg.stepSecs * 1000;
  const custMs = cfg.customerRate > 0 ? 1000 / cfg.customerRate : Infinity;

  for (;;) {
    const stepAt = state.k < theta.length ? state.k * stepMs : Infinity;
    const custAt = state.ci * custMs < end ? state.ci * custMs : Infinity;
    const sampleAt = state.nextSample * 1000;
    const at = Math.min(stepAt, custAt, sampleAt);
    if (at > target) break;
    if (at === stepAt) {
      const k = state.k++;
      if (k === 0) quote(state, theta[0], at);
      else if (theta[k] !== theta[k - 1]) quote(state, theta[k - 1], at);
    } else if (at === custAt) {
      const o = customerOrder(cfg.seed, state.ci++, fairAt(cfg, theta, at));
      submit(state, CUSTOMER, o.buy, o.price, CUSTOMER_QTY, at);
    } else {
      const sec = state.nextSample++;
      if (!state.book.bids.some((o) => o.owner === MM) && !state.book.asks.some((o) => o.owner === MM)) quote(state, fairAt(cfg, theta, at), at);
      state.chart.push([sec, mid(state.book), state.last]);
      if (sec % PNL_SAMPLE_SECS === 0 || at === end)
        state.pnlHistory.push([sec, Object.fromEntries(Object.entries(state.accounts).map(([id, a]) => [id, Math.round(pnl(a, state.last))]))]);
    }
    state.t = at;
  }
  state.t = Math.max(state.t, target);
  return state;
}

// ---------- Players ----------

/** Mangocore marks positions to the last traded price, during the case and at the bell. */
export function pnl(acc: Account | undefined, last: number) {
  return acc ? acc.cash - ENDOWMENT + acc.pos * last : 0;
}

/** Mangocore's checks: price/size bounds, open-order cap, and long and short exposure (incl. open orders) each within the limit. */
export function checkOrder(state: ExState, cfg: ExConfig, owner: string, buy: boolean, price: number, qty: number): string | null {
  if (!Number.isInteger(price) || price < PRICE_MIN || price > PRICE_MAX) return "Invalid price";
  if (!Number.isInteger(qty) || qty < 1) return "Invalid quantity";
  const mine = openOrders(state, owner);
  if (mine.length >= cfg.maxOpenOrders) return "Too many open orders";
  if (qty > cfg.maxOrderSize) return `Order size of ${qty} exceeds the maximum order size of ${cfg.maxOrderSize}`;
  const pos = state.accounts[owner]?.pos ?? 0;
  const long = pos + mine.filter((o) => o.buy).reduce((s, o) => s + o.qty, 0);
  const short = -pos + mine.filter((o) => !o.buy).reduce((s, o) => s + o.qty, 0);
  if (buy ? long + qty > cfg.positionLimit : short + qty > cfg.positionLimit) return `Potentially exceeding risk limit for ${TICKER} underlying`;
  return null;
}

export const formatMoney = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatSignedMoney = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + formatMoney(Math.abs(n));
