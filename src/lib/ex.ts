/**
 * Exchange: a continuous limit-order book on the answer to a question, against bots, after the Traders@MIT
 * "Mangocore" preliminary single-contract case. The contract settles at the true answer. Everything here is pure:
 * the bots are generated from the game seed, so the server replays them up to "now" on each request instead of
 * running a background process.
 */

export const TICKER = "A";
export const ENDOWMENT = 100_000;
export const MM_QTY = 1000;
export const CUSTOMER_QTY = 25;
/** Customers lean toward paying up: buys are drawn from θ−3..θ+7 and sells from θ−7..θ+3, so more of them trade into resting player orders. */
export const CUSTOMER_LEAN = 2;
/** The market maker quotes this many levels each side of its center. */
export const MM_LEVELS = 30;
export const MM = "mm";
export const CUSTOMER = "cust";
const MAX_FILLS = 50;
const PNL_SAMPLE_SECS = 10;

export type ExConfig = {
  seed: number;
  /** True answer the contract settles at. */
  answer: number;
  /** Integer price grid. */
  priceMin: number;
  priceMax: number;
  /** How far off the bots' first guess can be, as a percentage of the price range. */
  guessPct: number;
  caseSecs: number;
  /** The bots' fair value moves once per step. */
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
  /** Center of the market maker's current quotes. */
  mm: number;
  last: number;
  volume: number;
  accounts: Record<string, Account>;
  fills: Record<string, MyFill[]>;
  chart: ChartPoint[];
  /** Every PNL_SAMPLE_SECS: [second, P&L per player]. */
  pnlHistory: [number, Record<string, number>][];
  /** Fair-value steps planned at the open; fixed so ending the case early doesn't reshape the bots' path. */
  steps?: number;
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
type Grid = Pick<ExConfig, "priceMin" | "priceMax">;
export const clip = (g: Grid, p: number) => Math.max(g.priceMin, Math.min(g.priceMax, Math.round(p)));

export const steps = (cfg: Pick<ExConfig, "caseSecs" | "stepSecs">) => Math.max(1, Math.ceil(cfg.caseSecs / cfg.stepSecs));

/**
 * The bots' fair value θ per step. It starts at a guess up to guessPct of the range away from the answer and
 * closes in linearly, with jitter that shrinks alongside, reaching the answer on the last step.
 */
export function thetaPath(cfg: Grid & Pick<ExConfig, "seed" | "answer" | "guessPct">, n: number): number[] {
  const rng = mulberry32(mix(cfg.seed, 0x7e7a));
  const err = Math.round(((cfg.priceMax - cfg.priceMin) * cfg.guessPct) / 100);
  const guess = clip(cfg, cfg.answer + randint(rng, -err, err));
  const jitter = err > 0 ? Math.max(1, Math.round(err / 5)) : 0;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const w = n > 1 ? 1 - k / (n - 1) : 1;
    out.push(clip(cfg, cfg.answer + (guess - cfg.answer) * w + randint(rng, -jitter, jitter) * w));
  }
  return out;
}

/** The bots' fair value per step for this game, over the case length planned at the open. */
export const pathFor = (state: Pick<ExState, "steps">, cfg: ExConfig) => thetaPath(cfg, state.steps ?? steps(cfg));

export function fairAt(cfg: ExConfig, theta: number[], tMs: number) {
  return theta[Math.min(theta.length - 1, Math.max(0, Math.floor(tMs / (cfg.stepSecs * 1000))))];
}

/** Customer order i: buy or sell with equal odds, priced within ±5 of the current fair and then leaned CUSTOMER_LEAN toward crossing. */
export function customerOrder(cfg: Grid & Pick<ExConfig, "seed">, i: number, theta: number) {
  const rng = mulberry32(mix(cfg.seed, 0xc057, i));
  const base = randint(rng, theta - 5, theta + 5);
  const buy = rng() >= 0.5;
  return { price: clip(cfg, base + (buy ? CUSTOMER_LEAN : -CUSTOMER_LEAN)), buy };
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

export function emptyState(last: number): ExState {
  return {
    t: 0,
    k: 0,
    ci: 0,
    nextSample: 0,
    nextId: 1,
    nextTrade: 1,
    book: { bids: [], asks: [] },
    mm: last,
    last,
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

/** Market maker: 1000 lots at each of MM_LEVELS prices either side of the center, bids below and asks above. */
function quote(state: ExState, g: Grid, center: number, at: number) {
  cancelWhere(state, (o) => o.owner === MM);
  state.mm = center;
  for (let p = Math.max(g.priceMin, center - MM_LEVELS); p <= Math.min(g.priceMax, center + MM_LEVELS); p++)
    if (p !== center) submit(state, MM, p < center, p, MM_QTY, at);
}

/**
 * Replays the bots from state.t up to toMs (capped at the end of the case):
 * - the market maker quotes around θ at the start, then each time θ changes it re-quotes around the previous θ;
 * - customers send one order every 1/customerRate seconds around the current θ;
 * - each second the chart is sampled (and the maker re-quotes at the current θ if either side has been cleaned out).
 * P&L is sampled marked to the last trade, and at the bell to the answer.
 */
export function advance(state: ExState, cfg: ExConfig, toMs: number, theta = pathFor(state, cfg)) {
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
      if (k === 0) quote(state, cfg, theta[0], at);
      else if (theta[k] !== theta[k - 1]) quote(state, cfg, theta[k - 1], at);
    } else if (at === custAt) {
      const o = customerOrder(cfg, state.ci++, fairAt(cfg, theta, at));
      submit(state, CUSTOMER, o.buy, o.price, CUSTOMER_QTY, at);
    } else {
      const sec = state.nextSample++;
      const fair = fairAt(cfg, theta, at);
      const quoting = (side: Order[]) => side.some((o) => o.owner === MM);
      // Centered on a range edge, the maker has no orders on that side by design.
      const cleaned = (!quoting(state.book.bids) && state.mm > cfg.priceMin) || (!quoting(state.book.asks) && state.mm < cfg.priceMax);
      if (cleaned) quote(state, cfg, fair, at);
      state.chart.push([sec, mid(state.book), state.last]);
      if (sec % PNL_SAMPLE_SECS === 0 || at === end) {
        const mark = at === end ? cfg.answer : state.last;
        state.pnlHistory.push([sec, Object.fromEntries(Object.entries(state.accounts).map(([id, a]) => [id, Math.round(pnl(a, mark))]))]);
      }
    }
    state.t = at;
  }
  state.t = Math.max(state.t, target);
  return state;
}

// ---------- Players ----------

/** P&L with the position marked at `mark`: the last trade during the case, the answer at the bell. */
export function pnl(acc: Account | undefined, mark: number) {
  return acc ? acc.cash - ENDOWMENT + acc.pos * mark : 0;
}

/** Mangocore's checks: price/size bounds, open-order cap, and long and short exposure (incl. open orders) each within the limit. */
export function checkOrder(state: ExState, cfg: ExConfig, owner: string, buy: boolean, price: number, qty: number): string | null {
  if (!Number.isInteger(price) || price < cfg.priceMin || price > cfg.priceMax) return `Price must be a whole number from ${cfg.priceMin} to ${cfg.priceMax}`;
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
