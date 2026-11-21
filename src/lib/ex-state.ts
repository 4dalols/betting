import type { ExGame, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ENDOWMENT,
  TICKER,
  advance,
  cancelWhere,
  checkOrder,
  emptyState,
  fairAt,
  mid,
  openOrders,
  pnl,
  steps,
  submit,
  thetaPath,
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
type Tx = Prisma.TransactionClient;

type ConfigCols = "seed" | "answer" | "priceMin" | "priceMax" | "guessPct" | "caseSecs" | "stepSecs" | "customerRate" | "positionLimit" | "maxOrderSize" | "maxOpenOrders";

export function exConfig(game: Pick<ExGame, ConfigCols>): ExConfig {
  return {
    seed: game.seed,
    answer: game.answer,
    priceMin: game.priceMin,
    priceMax: game.priceMax,
    guessPct: game.guessPct,
    caseSecs: game.caseSecs,
    stepSecs: game.stepSecs,
    customerRate: game.customerRate,
    positionLimit: game.positionLimit,
    maxOrderSize: game.maxOrderSize,
    maxOpenOrders: game.maxOpenOrders,
  };
}

/** Brings the state up to `now`, finishing the game at the bell. Caller holds the row lock. */
async function catchUp(tx: Tx, game: ExGame, now: number): Promise<{ state: Stored; finished: boolean }> {
  const cfg = exConfig(game);
  const state = game.state as Stored;
  advance(state, cfg, now - game.startedAt!.getTime());
  const finished = now >= game.endsAt!.getTime();
  if (finished) {
    const players = await tx.exPlayer.findMany({ where: { gameId: game.id }, select: { id: true } });
    for (const p of players) await tx.exPlayer.update({ where: { id: p.id }, data: { pnl: pnl(state.accounts[p.id], cfg.answer) } });
  }
  return { state, finished };
}

async function save(tx: Tx, game: ExGame, state: Stored, finished: boolean, now: number) {
  await tx.exGame.update({
    where: { id: game.id },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      advancedAt: new Date(now),
      seq: { increment: 1 },
      ...(finished ? { status: "FINISHED" as const } : {}),
    },
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
    const game = await tx.exGame.findUnique({ where: { id: head.id } });
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
    const game = await tx.exGame.findUnique({ where: { id: gameId } });
    if (!game || game.status !== "LOBBY") throw new Error("Game already started");
    const now = Date.now();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const cfg = { ...exConfig(game), seed };
    const state = advance(emptyState(thetaPath(cfg, steps(cfg))[0]), cfg, 0);
    await tx.exGame.update({
      where: { id: gameId },
      data: {
        seed,
        status: "PLAYING",
        startedAt: new Date(now),
        endsAt: new Date(now + game.caseSecs * 1000),
        state: state as unknown as Prisma.InputJsonValue,
        advancedAt: new Date(now),
        seq: { increment: 1 },
      },
    });
  });
}

/** Ends the case now: positions settle at the answer, as at the bell. */
export async function endGame(gameId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ExGame" WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.exGame.findUnique({ where: { id: gameId } });
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
      const game = await tx.exGame.findUnique({ where: { id: gameId } });
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
  /** Host only: P&L per player over time. */
  pnlHistory: { names: string[]; points: [number, ...number[]][] } | null;
  /** Host always; everyone once finished. */
  answer: number | null;
  /** Host while playing: the bots' fair value in effect now. */
  fairNow: number | null;
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

export async function getExView(code: string, playerToken?: string, hostToken?: string): Promise<ExView | null> {
  await tick(code);
  const game = await prisma.exGame.findUnique({
    where: { code },
    include: { players: { select: { id: true, name: true, token: true, pnl: true }, orderBy: { joinedAt: "asc" } } },
  });
  if (!game) return null;
  const isHost = Boolean(hostToken) && hostToken === game.hostToken;
  const meRow = playerToken ? game.players.find((p) => p.token === playerToken) : undefined;
  const cfg = exConfig(game);
  const state = (game.state as Stored | null) ?? emptyState(Math.round((cfg.priceMin + cfg.priceMax) / 2));
  const finished = game.status === "FINISHED" && game.startedAt !== null;
  const theta = game.startedAt ? thetaPath(cfg, steps(cfg)) : [];
  const pnlOf = (p: { id: string; pnl: number | null }) => (finished && p.pnl !== null ? p.pnl : pnl(state.accounts[p.id], state.last));

  const standings =
    isHost || game.status === "FINISHED"
      ? game.players
          .map((p) => ({
            name: p.name,
            pnl: pnlOf(p),
            position: state.accounts[p.id]?.pos ?? 0,
            cash: state.accounts[p.id]?.cash ?? ENDOWMENT,
            me: p.id === meRow?.id,
          }))
          .sort((a, b) => b.pnl - a.pnl)
      : null;

  const acc = meRow ? state.accounts[meRow.id] : undefined;
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
    asOf: state.t,
    bids: levels(state.book.bids, meRow?.id),
    asks: levels(state.book.asks, meRow?.id),
    last: state.last,
    mid: mid(state.book),
    volume: state.volume,
    chart: state.chart,
    me: meRow
      ? {
          name: meRow.name,
          cash: acc?.cash ?? ENDOWMENT,
          pos: acc?.pos ?? 0,
          pnl: pnlOf(meRow),
          orders: openOrders(state, meRow.id).map(({ id, buy, price, qty }) => ({ id, buy, price, qty })),
          fills: [...(state.fills[meRow.id] ?? [])].reverse(),
        }
      : null,
    players: game.players.map((p) => p.name),
    standings,
    pnlHistory: isHost
      ? {
          names: game.players.map((p) => p.name),
          points: state.pnlHistory.map(([sec, byId]) => [sec, ...game.players.map((p) => byId[p.id] ?? 0)] as [number, ...number[]]),
        }
      : null,
    answer: isHost || finished ? cfg.answer : null,
    fairNow: isHost && game.status === "PLAYING" ? fairAt(cfg, theta, state.t) : null,
    fairPath: finished ? theta : null,
  };
}
