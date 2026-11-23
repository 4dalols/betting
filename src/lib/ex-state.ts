import type { ExGame, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ENDOWMENT,
  MAX_FILLS,
  TICKER,
  advance,
  cancelWhere,
  checkOrder,
  emptyState,
  mid,
  openOrders,
  pathFor,
  pnl,
  steps,
  submit,
  thetaPath,
  type Account,
  type ChartPoint,
  type ExConfig,
  type ExState,
  type MyFill,
} from "@/lib/ex";

export const exPlayerCookie = (code: string) => `ex_player_${code}`;
export const exHostCookie = (code: string) => `ex_host_${code}`;

/** Per-player action budget, as in Mangocore. */
export const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 1000;
/** Pollers only advance the bots if the state is at least this stale; actions always advance. */
const POLL_ADVANCE_MS = 400;

type Stored = ExState & { rl?: Record<string, number[]> };
/** What's saved in ExGame.state: fills, chart and P&L history live in their own append-only columns. */
type Core = Omit<Stored, "fills" | "chart" | "pnlHistory">;
type Tx = Prisma.TransactionClient;
/** The columns the engine never needs. */
const lean = { snap: true, chart: true, pnlHistory: true } as const;
type GameRow = Omit<ExGame, keyof typeof lean>;

/** Shared screen data, written with each state so a poll reads this instead of the whole book. */
type Snap = {
  t: number;
  last: number;
  mid: number | null;
  volume: number;
  steps?: number;
  /** [price, qty], best first, as many levels as the ladder can show. */
  bids: [number, number][];
  asks: [number, number][];
  accounts: Record<string, Account>;
};
const SNAP_LEVELS = 15;

function snapOf(state: Core): Snap {
  const side = (orders: ExState["book"]["bids"]) => levels(orders).slice(0, SNAP_LEVELS).map((l) => [l.price, l.qty] as [number, number]);
  return {
    t: state.t,
    last: state.last,
    mid: mid(state.book),
    volume: state.volume,
    steps: state.steps,
    bids: side(state.book.bids),
    asks: side(state.book.asks),
    accounts: state.accounts,
  };
}

const loadState = (game: GameRow): Stored => ({ ...(game.state as Core), fills: {}, chart: [], pnlHistory: [] });

/** Saves the state and its snapshot, and appends what advancing it produced. */
async function write(tx: Tx, gameId: string, state: Stored, data: Prisma.ExGameUpdateInput) {
  const { fills, chart, pnlHistory, ...core } = state;
  await tx.exGame.update({
    where: { id: gameId },
    data: { ...data, state: core as unknown as Prisma.InputJsonValue, snap: snapOf(core) as unknown as Prisma.InputJsonValue },
  });
  if (chart.length || pnlHistory.length)
    await tx.$executeRaw`UPDATE "ExGame" SET "chart" = "chart" || ${JSON.stringify(chart)}::jsonb, "pnlHistory" = "pnlHistory" || ${JSON.stringify(pnlHistory)}::jsonb WHERE id = ${gameId}`;
  const keep = `$[last - ${MAX_FILLS - 1} to last]`;
  for (const [playerId, f] of Object.entries(fills))
    if (f.length)
      await tx.$executeRaw`UPDATE "ExPlayer" SET "fills" = jsonb_path_query_array("fills" || ${JSON.stringify(f)}::jsonb, ${keep}::jsonpath) WHERE id = ${playerId}`;
}

type ConfigCols = "seed" | "answer" | "priceMin" | "priceMax" | "guessPct" | "startPrice" | "caseSecs" | "stepSecs" | "customerRate" | "positionLimit" | "maxOrderSize" | "maxOpenOrders";

export function exConfig(game: Pick<ExGame, ConfigCols>): ExConfig {
  return {
    seed: game.seed,
    answer: game.answer,
    priceMin: game.priceMin,
    priceMax: game.priceMax,
    guessPct: game.guessPct,
    startPrice: game.startPrice,
    caseSecs: game.caseSecs,
    stepSecs: game.stepSecs,
    customerRate: game.customerRate,
    positionLimit: game.positionLimit,
    maxOrderSize: game.maxOrderSize,
    maxOpenOrders: game.maxOpenOrders,
  };
}

/** Brings the state up to `now`, finishing the game at the bell. Caller holds the row lock. */
async function catchUp(tx: Tx, game: GameRow, now: number): Promise<{ state: Stored; finished: boolean }> {
  const cfg = exConfig(game);
  const state = loadState(game);
  advance(state, cfg, now - game.startedAt!.getTime());
  const finished = now >= game.endsAt!.getTime();
  if (finished) {
    const players = await tx.exPlayer.findMany({ where: { gameId: game.id }, select: { id: true } });
    for (const p of players) await tx.exPlayer.update({ where: { id: p.id }, data: { pnl: pnl(state.accounts[p.id], cfg.answer) } });
  }
  return { state, finished };
}

async function save(tx: Tx, game: GameRow, state: Stored, finished: boolean, now: number) {
  await write(tx, game.id, state, {
    advancedAt: new Date(now),
    seq: { increment: 1 },
    ...(finished ? { status: "FINISHED" as const } : {}),
  });
}

/** Called on every poll. Skips if someone else holds the lock — they're advancing it anyway. */
export async function tick(code: string) {
  const head = await prisma.exGame.findUnique({ where: { code }, select: { id: true, status: true, advancedAt: true } });
  if (!head || head.status !== "PLAYING") return;
  if (head.advancedAt && Date.now() - head.advancedAt.getTime() < POLL_ADVANCE_MS) return;
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ExGame" WHERE id = ${head.id} FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return;
    const game = await tx.exGame.findUnique({ where: { id: head.id }, omit: lean });
    if (!game || game.status !== "PLAYING") return;
    const now = Date.now();
    if (game.advancedAt && now - game.advancedAt.getTime() < POLL_ADVANCE_MS) return;
    const { state, finished } = await catchUp(tx, game, now);
    await save(tx, game, state, finished, now);
  });
}

export async function startGame(gameId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ExGame" WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.exGame.findUnique({ where: { id: gameId }, omit: lean });
    if (!game || game.status !== "LOBBY") throw new Error("Game already started");
    const now = Date.now();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const cfg = { ...exConfig(game), seed };
    const n = steps(cfg);
    const state = advance({ ...emptyState(thetaPath(cfg, n)[0]), steps: n }, cfg, 0);
    await write(tx, gameId, state, {
      seed,
      status: "PLAYING",
      startedAt: new Date(now),
      endsAt: new Date(now + game.caseSecs * 1000),
      advancedAt: new Date(now),
      seq: { increment: 1 },
    });
  });
}

/** Ends the case now: positions settle at the answer, as at the bell. */
export async function endGame(gameId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ExGame" WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.exGame.findUnique({ where: { id: gameId }, omit: lean });
    if (!game) return;
    if (game.status === "LOBBY") {
      await tx.exGame.update({ where: { id: gameId }, data: { status: "FINISHED", seq: { increment: 1 } } });
      return;
    }
    if (game.status !== "PLAYING") return;
    const now = Date.now();
    if (now >= game.endsAt!.getTime()) {
      const { state } = await catchUp(tx, game, now);
      await save(tx, game, state, true, now);
      return;
    }
    const elapsed = now - game.startedAt!.getTime();
    // Shorten the case to what has been played so settlement and the revealed path match.
    const caseSecs = Math.max(1, Math.ceil(elapsed / 1000));
    const shortened = { ...game, caseSecs, endsAt: new Date(now) };
    const { state } = await catchUp(tx, shortened, now);
    await tx.exGame.update({ where: { id: gameId }, data: { caseSecs, endsAt: new Date(now) } });
    await save(tx, shortened, state, true, now);
  });
}

export type PlayerOp =
  | { kind: "order"; buy: boolean; price: number; qty: number }
  | { kind: "cancel"; id: number }
  | { kind: "cancelAll" };

export type OpResult = { error?: string; filled?: number };

/** Serialized under the game's row lock: catch the bots up to now, rate-limit, then apply the player's action. */
export async function applyOp(gameId: string, playerId: string, op: PlayerOp): Promise<OpResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "ExGame" WHERE id = ${gameId} FOR UPDATE`;
      const game = await tx.exGame.findUnique({ where: { id: gameId }, omit: lean });
      if (!game || game.status !== "PLAYING") return { error: "The market is closed" };
      const now = Date.now();
      const { state, finished } = await catchUp(tx, game, now);
      if (finished) {
        await save(tx, game, state, true, now);
        return { error: "The market is closed" };
      }
      const rl = (state.rl ??= {});
      const recent = (rl[playerId] ?? []).filter((t) => now - t < RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT) return { error: `Slow down — at most ${RATE_LIMIT} actions per second` };
      recent.push(now);
      rl[playerId] = recent;
      for (const id of Object.keys(rl)) if (rl[id].every((t) => now - t >= RATE_WINDOW_MS)) delete rl[id];

      const cfg = exConfig(game);
      const at = now - game.startedAt!.getTime();
      let result: OpResult = {};
      if (op.kind === "order") {
        const err = checkOrder(state, cfg, playerId, op.buy, op.price, op.qty);
        if (err) return { error: err };
        const { trades } = submit(state, playerId, op.buy, op.price, op.qty, at);
        result = { filled: trades.reduce((s, t) => s + t.qty, 0) };
      } else if (op.kind === "cancel") {
        if (cancelWhere(state, (o) => o.id === op.id && o.owner === playerId) === 0) return { error: "Order already filled or cancelled" };
      } else {
        cancelWhere(state, (o) => o.owner === playerId);
      }
      await save(tx, game, state, false, now);
      return result;
    },
    { timeout: 10000, maxWait: 10000 },
  );
}

// ---------- Client view ----------

/** Aggregated book level: total size and how much of it is mine. */
export type ExLevel = { price: number; qty: number; mine: number };
export type ExStanding = { name: string; pnl: number; position: number; cash: number; me: boolean };
export type ExView = {
  code: string;
  status: "LOBBY" | "PLAYING" | "FINISHED";
  ticker: string;
  question: string;
  settings: {
    priceMin: number;
    priceMax: number;
    caseSecs: number;
    stepSecs: number;
    customerRate: number;
    positionLimit: number;
    maxOrderSize: number;
    maxOpenOrders: number;
  };
  isHost: boolean;
  seq: number;
  serverNow: number;
  startedAt: number | null;
  endsAt: number | null;
  /** Case time the state reflects. */
  asOf: number;
  /** Best first. */
  bids: ExLevel[];
  asks: ExLevel[];
  last: number;
  mid: number | null;
  volume: number;
  /** Only the points after the poll's `since.chart`; the client appends them. */
  chart: ChartPoint[];
  me: {
    name: string;
    cash: number;
    pos: number;
    pnl: number;
    orders: { id: number; buy: boolean; price: number; qty: number }[];
    fills: MyFill[];
  } | null;
  players: string[];
  /** Host always; everyone once finished. */
  standings: ExStanding[] | null;
  /** Host only: P&L per player over time, points after `since.pnl` only. A row has no value for players who joined later. */
  pnlHistory: { names: string[]; points: [number, ...number[]][] } | null;
  /** Revealed to everyone, host included, only once finished (the host screen is often shared). */
  answer: number | null;
  /** Revealed at the end: the bots' fair value per step. */
  fairPath: number[] | null;
};

function levels(orders: ExState["book"]["bids"], me?: string): ExLevel[] {
  const out: ExLevel[] = [];
  for (const o of orders) {
    let l = out[out.length - 1];
    if (!l || l.price !== o.price) out.push((l = { price: o.price, qty: 0, mine: 0 }));
    l.qty += o.qty;
    if (me && o.owner === me) l.mine += o.qty;
  }
  return out;
}

/** Last chart / P&L-history second the client already has. */
export type ExSince = { chart?: number; pnl?: number };

type ViewRow = {
  snap: Snap | null;
  accounts: Record<string, Account> | null;
  mine: Account | null;
  chart: ChartPoint[];
  pnlHistory: [number, Record<string, number>][] | null;
  orders: ExState["book"]["bids"] | null;
  legacy: boolean;
};

export async function getExView(code: string, playerToken?: string, hostToken?: string, since: ExSince = {}): Promise<ExView | null> {
  await tick(code);
  const game = await prisma.exGame.findUnique({
    where: { code },
    omit: { state: true, ...lean },
    include: { players: { select: { id: true, name: true, pnl: true }, orderBy: { joinedAt: "asc" } } },
  });
  if (!game) return null;
  const isHost = Boolean(hostToken) && hostToken === game.hostToken;
  const meRow = playerToken
    ? await prisma.exPlayer.findFirst({ where: { gameId: game.id, token: playerToken }, select: { id: true, name: true, pnl: true, fills: true } })
    : null;
  const cfg = exConfig(game);
  const finished = game.status === "FINISHED" && game.startedAt !== null;
  const everyone = isHost || game.status === "FINISHED";
  const meId = meRow?.id ?? "";
  // Only the parts this viewer needs leave the database.
  const [row] = await prisma.$queryRaw<ViewRow[]>`
    SELECT "snap" - 'accounts' AS snap,
      CASE WHEN ${everyone}::boolean THEN "snap"->'accounts' END AS accounts,
      "snap"->'accounts'->${meId}::text AS mine,
      jsonb_path_query_array("chart", 'strict $[*] ? (@[0] > $s)', jsonb_build_object('s', ${since.chart ?? -1}::int)) AS chart,
      CASE WHEN ${isHost}::boolean THEN jsonb_path_query_array("pnlHistory", 'strict $[*] ? (@[0] > $s)', jsonb_build_object('s', ${since.pnl ?? -1}::int)) END AS "pnlHistory",
      jsonb_path_query_array("state"->'book', 'strict $.*[*] ? (@.owner == $me)', jsonb_build_object('me', ${meId}::text)) AS orders,
      ("snap" IS NULL AND "state" IS NOT NULL) AS legacy
    FROM "ExGame" WHERE id = ${game.id}`;
  let snap = row.snap;
  let accounts = row.accounts ?? {};
  let mine = row.mine;
  let orders = row.orders ?? [];
  if (row.legacy) {
    // Saved before snapshots existed (e.g. finished before this deploy).
    const { state } = await prisma.exGame.findUniqueOrThrow({ where: { id: game.id }, select: { state: true } });
    const core = state as Core;
    snap = snapOf(core);
    accounts = everyone ? core.accounts : {};
    mine = core.accounts[meId] ?? null;
    orders = openOrders({ ...core, fills: {}, chart: [], pnlHistory: [] }, meId);
  }
  const s = snap ?? snapOf(emptyState(Math.round((cfg.priceMin + cfg.priceMax) / 2)));
  orders.sort((a, b) => a.id - b.id);
  const theta = game.startedAt ? pathFor(s, cfg) : [];
  const pnlOf = (p: { pnl: number | null }, acc: Account | null | undefined) => (finished && p.pnl !== null ? p.pnl : pnl(acc ?? undefined, s.last));

  const standings = everyone
    ? game.players
        .map((p) => ({
          name: p.name,
          pnl: pnlOf(p, accounts[p.id]),
          position: accounts[p.id]?.pos ?? 0,
          cash: accounts[p.id]?.cash ?? ENDOWMENT,
          me: p.id === meRow?.id,
        }))
        .sort((a, b) => b.pnl - a.pnl)
    : null;

  const ladder = (side: [number, number][], buy: boolean): ExLevel[] =>
    side.map(([price, qty]) => ({ price, qty, mine: orders.reduce((n, o) => (o.buy === buy && o.price === price ? n + o.qty : n), 0) }));
  return {
    code: game.code,
    status: game.status,
    ticker: TICKER,
    question: game.question,
    settings: {
      priceMin: cfg.priceMin,
      priceMax: cfg.priceMax,
      caseSecs: cfg.caseSecs,
      stepSecs: cfg.stepSecs,
      customerRate: cfg.customerRate,
      positionLimit: cfg.positionLimit,
      maxOrderSize: cfg.maxOrderSize,
      maxOpenOrders: cfg.maxOpenOrders,
    },
    isHost,
    seq: game.seq,
    serverNow: Date.now(),
    startedAt: game.startedAt?.getTime() ?? null,
    endsAt: game.endsAt?.getTime() ?? null,
    asOf: s.t,
    bids: ladder(s.bids, true),
    asks: ladder(s.asks, false),
    last: s.last,
    mid: s.mid,
    volume: s.volume,
    chart: row.chart,
    me: meRow
      ? {
          name: meRow.name,
          cash: mine?.cash ?? ENDOWMENT,
          pos: mine?.pos ?? 0,
          pnl: pnlOf(meRow, mine),
          orders: orders.map(({ id, buy, price, qty }) => ({ id, buy, price, qty })),
          fills: [...(meRow.fills as MyFill[])].reverse(),
        }
      : null,
    players: game.players.map((p) => p.name),
    standings,
    pnlHistory:
      isHost && row.pnlHistory
        ? {
            names: game.players.map((p) => p.name),
            points: row.pnlHistory.map(([sec, byId]) => [sec, ...game.players.map((p) => byId[p.id] ?? 0)] as [number, ...number[]]),
          }
        : null,
    answer: finished ? cfg.answer : null,
    fairPath: finished ? theta.slice(0, steps(cfg)) : null,
  };
}
