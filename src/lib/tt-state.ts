import { prisma } from "@/lib/db";
import type { GameStatus, Prisma, TtDistribution, TtGame, TtPhase, TtSide } from "@/generated/prisma/client";
import {
  assignRooms,
  cardMean,
  distributionInfo,
  drawCard,
  eloUpdate,
  itemLabel,
  normalize,
  ranks,
  round2,
  settleAuctions,
  shuffle,
  takerPnl,
} from "@/lib/tt";

export const ttPlayerCookie = (code: string) => `tt_player_${code}`;
export const ttHostCookie = (code: string) => `tt_host_${code}`;

export const roomInclude = {
  seats: { include: { player: { select: { id: true, name: true, elo: true } } } },
  items: { orderBy: { index: "asc" as const } },
  bids: true,
  tightens: { orderBy: { createdAt: "asc" as const } },
  markets: true,
  trades: true,
} satisfies Prisma.TtRoomInclude;

export type FullRoom = Prisma.TtRoomGetPayload<{ include: typeof roomInclude }>;
type Tx = Prisma.TransactionClient;
type RoomStep = Pick<Prisma.TtRoomUpdateInput, "phase" | "cycle" | "opensAt" | "endsAt" | "settledAt">;

export const priorMean = (game: { distribution: TtDistribution; cardsPerRound: number }) =>
  round2(cardMean(game.distribution) * game.cardsPerRound);

// ---------- Tightening state ----------

type TightenRow = { playerId: string; width: number | null; cycle: number };

/** Current best width for a cycle, and who has said "I'm out" since it was posted. */
export function tightenState(rows: TightenRow[], cycle: number) {
  let best: { playerId: string; width: number } | null = null;
  let out = new Set<string>();
  for (const r of rows) {
    if (r.cycle !== cycle) continue;
    if (r.width === null) out.add(r.playerId);
    else {
      best = { playerId: r.playerId, width: r.width };
      out = new Set();
    }
  }
  return { best, out };
}

/** Tightening is over once nobody else can or will go tighter. */
export function tightenDone(rows: TightenRow[], cycle: number, seatIds: string[]) {
  const { best, out } = tightenState(rows, cycle);
  if (best && best.width <= 0) return true;
  return seatIds.filter((id) => id !== best?.playerId).every((id) => out.has(id));
}

// ---------- Room phase machine ----------

const after = (now: number, secs: number) => new Date(now + secs * 1000);

function tightenStep(game: TtGame, cycle: number, now: number): RoomStep {
  const opens = now + game.breakSecs * 1000;
  return { phase: "TIGHTEN", cycle, opensAt: new Date(opens), endsAt: after(opens, game.decisionSecs) };
}

async function nextCycleOrSettle(tx: Tx, game: TtGame, room: FullRoom, now: number): Promise<RoomStep> {
  if (room.cycle + 1 < game.cycles) return tightenStep(game, room.cycle + 1, now);
  await settleRoom(tx, game, room);
  return { phase: "RESULTS", opensAt: new Date(now), endsAt: null, settledAt: new Date(now) };
}

async function stepRoom(tx: Tx, game: TtGame, room: FullRoom, now: number): Promise<RoomStep | null> {
  switch (room.phase) {
    case "AUCTION": {
      const awards = settleAuctions(
        room.items.length,
        room.seats.map((s) => s.playerId),
        room.bids.map((b) => ({ playerId: b.playerId, amounts: b.amounts, at: b.updatedAt.getTime() })),
      );
      for (const a of awards)
        await tx.ttInfoItem.update({
          where: { roomId_index: { roomId: room.id, index: a.index } },
          data: { winnerId: a.winnerId, price: a.winnerId ? a.price : null },
        });
      return tightenStep(game, 0, now);
    }
    case "TIGHTEN": {
      const { best } = tightenState(room.tightens, room.cycle);
      if (!best) return nextCycleOrSettle(tx, game, room, now);
      await tx.ttMarket.create({ data: { roomId: room.id, cycle: room.cycle, makerId: best.playerId, width: best.width } });
      return { phase: "QUOTE", opensAt: new Date(now), endsAt: after(now, game.decisionSecs) };
    }
    case "QUOTE": {
      const market = room.markets.find((m) => m.cycle === room.cycle);
      if (!market) return nextCycleOrSettle(tx, game, room, now);
      if (market.bid === null) {
        const bid = round2(priorMean(game) - market.width / 2);
        await tx.ttMarket.update({ where: { id: market.id }, data: { bid, ask: round2(bid + market.width), auto: true } });
      }
      return { phase: "TRADE", opensAt: new Date(now), endsAt: after(now, game.tradeSecs) };
    }
    case "TRADE":
      return nextCycleOrSettle(tx, game, room, now);
    case "RESULTS":
      return null;
  }
}

/** Score = trading PnL normalized to 0–100 within the room, minus info spend; Elo moves on the round scores. */
async function settleRoom(tx: Tx, game: TtGame, room: FullRoom) {
  const value = room.cards.reduce((s, c) => s + c, 0);
  const ids = room.seats.map((s) => s.playerId);
  const trading = new Map(ids.map((id) => [id, 0]));
  for (const m of room.markets) {
    if (m.bid === null || m.ask === null) continue;
    for (const t of room.trades.filter((t) => t.cycle === m.cycle && t.playerId !== m.makerId)) {
      const pnl = takerPnl(t.side, { bid: m.bid, ask: m.ask }, value);
      trading.set(t.playerId, (trading.get(t.playerId) ?? 0) + pnl);
      trading.set(m.makerId, (trading.get(m.makerId) ?? 0) - pnl);
    }
  }
  const pnls = ids.map((id) => round2(trading.get(id) ?? 0));
  const norm = normalize(pnls);
  const costs = ids.map((id) => round2(room.items.filter((i) => i.winnerId === id).reduce((s, i) => s + (i.price ?? 0), 0)));
  const scores = ids.map((_, i) => round2(norm[i] - costs[i]));
  const elos = eloUpdate(room.seats.map((s) => s.eloBefore), scores);
  for (let i = 0; i < ids.length; i++) {
    await tx.ttSeat.update({
      where: { id: room.seats[i].id },
      data: { tradingPnl: pnls[i], normalized: norm[i], cost: costs[i], score: scores[i], eloAfter: elos[i] },
    });
    await tx.ttPlayer.update({ where: { id: ids[i] }, data: { elo: elos[i] } });
  }
}

/**
 * Moves a room one phase forward. The row lock plus `seq` check make concurrent pollers/actions advance once;
 * with `onlyIfDue`, it re-checks the timer under the lock (a tighten may have just extended it).
 */
export async function advanceRoom(roomId: string, expectedSeq: number, onlyIfDue: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TtRoom" WHERE id = ${roomId} FOR UPDATE`;
    const room = await tx.ttRoom.findUnique({ where: { id: roomId }, include: roomInclude });
    if (!room || room.seq !== expectedSeq || room.phase === "RESULTS") return false;
    const now = Date.now();
    if (onlyIfDue && !(room.endsAt && room.endsAt.getTime() <= now)) return false;
    const game = await tx.ttGame.findUnique({ where: { id: room.gameId } });
    if (!game || game.status !== "PLAYING") return false;
    const step = await stepRoom(tx, game, room, now);
    if (!step) return false;
    await tx.ttRoom.update({ where: { id: roomId }, data: { ...step, seq: expectedSeq + 1 } });
    return true;
  });
}

// ---------- Game (between rounds) ----------

/** Seats every player: round 1 at random, later rounds by Elo (ties broken randomly), best players together. */
async function startRound(tx: Tx, game: TtGame, round: number, now: number) {
  const players = shuffle(await tx.ttPlayer.findMany({ where: { gameId: game.id } }));
  const ordered = round === 0 ? players : [...players].sort((a, b) => b.elo - a.elo);
  const rooms = assignRooms(ordered, game.roomSize);
  for (let index = 0; index < rooms.length; index++) {
    const cards = Array.from({ length: game.cardsPerRound }, () => drawCard(game.distribution));
    await tx.ttRoom.create({
      data: {
        gameId: game.id,
        round,
        index,
        cards,
        phase: "AUCTION",
        opensAt: new Date(now),
        endsAt: after(now, game.auctionSecs),
        items: { create: [...cards].sort((a, b) => b - a).map((value, i) => ({ index: i, value })) },
        seats: { create: rooms[index].map((p) => ({ playerId: p.id, eloBefore: p.elo })) },
      },
    });
  }
}

/**
 * start: lobby → round 1. tick: once every room has settled, opens the between-round break (or finishes the
 * game after the last round), then starts the next round when the break is over. skip: same, without waiting.
 */
export async function advanceGame(gameId: string, expectedSeq: number, mode: "start" | "tick" | "skip"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TtGame" WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.ttGame.findUnique({ where: { id: gameId } });
    if (!game || game.seq !== expectedSeq) return false;
    const now = Date.now();
    const bump = { seq: expectedSeq + 1 };

    if (mode === "start") {
      if (game.status !== "LOBBY") return false;
      await startRound(tx, game, 0, now);
      await tx.ttGame.update({ where: { id: gameId }, data: { ...bump, status: "PLAYING", currentRound: 0, roundBreakEndsAt: null } });
      return true;
    }
    if (game.status !== "PLAYING") return false;
    const open = await tx.ttRoom.count({ where: { gameId, round: game.currentRound, phase: { not: "RESULTS" } } });
    if (open > 0) return false;

    const last = game.currentRound + 1 >= game.totalRounds;
    if (last) {
      await tx.ttGame.update({ where: { id: gameId }, data: { ...bump, status: "FINISHED", roundBreakEndsAt: null } });
      return true;
    }
    const breakOver = game.roundBreakEndsAt !== null && game.roundBreakEndsAt.getTime() <= now;
    if (mode === "skip" || breakOver || (game.roundBreakEndsAt === null && game.roundBreakSecs === 0)) {
      await startRound(tx, game, game.currentRound + 1, now);
      await tx.ttGame.update({ where: { id: gameId }, data: { ...bump, currentRound: game.currentRound + 1, roundBreakEndsAt: null } });
      return true;
    }
    if (game.roundBreakEndsAt === null) {
      await tx.ttGame.update({ where: { id: gameId }, data: { ...bump, roundBreakEndsAt: after(now, game.roundBreakSecs) } });
      return true;
    }
    return false;
  });
}

/** Advances anything whose timer has run out. Called on every poll, so the game runs without a background worker. */
export async function tick(code: string) {
  const game = await prisma.ttGame.findUnique({
    where: { code },
    select: { id: true, seq: true, status: true, currentRound: true, roundBreakEndsAt: true },
  });
  if (!game || game.status !== "PLAYING") return;
  const now = new Date();
  const due = await prisma.ttRoom.findMany({
    where: { gameId: game.id, round: game.currentRound, phase: { not: "RESULTS" }, endsAt: { lte: now } },
    select: { id: true, seq: true },
  });
  for (const r of due) await advanceRoom(r.id, r.seq, true);
  const open = await prisma.ttRoom.count({ where: { gameId: game.id, round: game.currentRound, phase: { not: "RESULTS" } } });
  if (open === 0 && (game.roundBreakEndsAt === null || game.roundBreakEndsAt <= now)) await advanceGame(game.id, game.seq, "tick");
}

// ---------- Client view ----------

export type TtSettings = {
  totalRounds: number;
  distribution: TtDistribution;
  distributionLabel: string;
  distributionDescribe: string;
  cardMean: number;
  priorMean: number;
  cardsPerRound: number;
  roomSize: number;
  cycles: number;
  tightenPct: number;
  auctionSecs: number;
  decisionSecs: number;
  tradeSecs: number;
  breakSecs: number;
  roundBreakSecs: number;
};

export type TtItemView = {
  index: number;
  label: string;
  winnerId: string | null;
  winnerName: string | null;
  price: number | null;
  /** Visible to the winner, and to everyone after settlement. */
  value: number | null;
  mine: boolean;
};

export type TtCycleView = {
  cycle: number;
  proposals: { id: string; name: string; width: number | null }[];
  best: { playerId: string; name: string; width: number } | null;
  out: string[];
  market: { makerId: string; makerName: string; width: number; bid: number | null; ask: number | null; auto: boolean } | null;
  /** Revealed once the cycle's trading is over. */
  trades: { playerId: string; name: string; side: TtSide }[] | null;
  tradesIn: number;
  myTrade: TtSide | null;
};

export type TtResultRow = {
  playerId: string;
  name: string;
  tradingPnl: number;
  normalized: number;
  cost: number;
  score: number;
  rank: number;
  eloBefore: number;
  eloAfter: number;
};

export type TtRoomView = {
  id: string;
  index: number;
  round: number;
  phase: TtPhase;
  cycle: number;
  opensAt: number;
  endsAt: number | null;
  seq: number;
  members: { id: string; name: string; elo: number; acted: boolean }[];
  items: TtItemView[];
  myBids: number[] | null;
  bidsIn: number;
  cycles: TtCycleView[];
  cards: number[] | null;
  sum: number | null;
  results: TtResultRow[] | null;
};

export type TtView = {
  code: string;
  status: GameStatus;
  isHost: boolean;
  me: { id: string; name: string; elo: number } | null;
  serverNow: number;
  seq: number;
  settings: TtSettings;
  currentRound: number;
  roundBreakEndsAt: number | null;
  standings: { id: string; name: string; elo: number; total: number; rounds: (number | null)[] }[];
  rooms: { id: string; index: number; phase: TtPhase; cycle: number; seq: number; players: string[] }[];
  /** The viewer's room this round (or, for a host who isn't playing, the room they're watching). */
  room: TtRoomView | null;
  spectating: boolean;
};

function roomView(room: FullRoom, me: { id: string } | undefined): TtRoomView {
  const names = new Map(room.seats.map((s) => [s.playerId, s.player.name]));
  const name = (id: string) => names.get(id) ?? "?";
  const settled = room.phase === "RESULTS";
  const auctionOpen = room.phase === "AUCTION";
  const seatIds = room.seats.map((s) => s.playerId);

  const cycles: TtCycleView[] = [];
  const lastCycle = auctionOpen ? -1 : room.cycle;
  for (let c = 0; c <= lastCycle; c++) {
    const { best, out } = tightenState(room.tightens, c);
    const m = room.markets.find((x) => x.cycle === c);
    const trades = room.trades.filter((t) => t.cycle === c);
    const tradingOpen = room.phase === "TRADE" && c === room.cycle;
    cycles.push({
      cycle: c,
      proposals: room.tightens.filter((t) => t.cycle === c).map((t) => ({ id: t.id, name: name(t.playerId), width: t.width })),
      best: best ? { ...best, name: name(best.playerId) } : null,
      out: [...out],
      market: m ? { makerId: m.makerId, makerName: name(m.makerId), width: m.width, bid: m.bid, ask: m.ask, auto: m.auto } : null,
      trades: tradingOpen ? null : trades.filter((t) => t.side !== "PASS").map((t) => ({ playerId: t.playerId, name: name(t.playerId), side: t.side })),
      tradesIn: trades.length,
      myTrade: me ? (trades.find((t) => t.playerId === me.id)?.side ?? null) : null,
    });
  }

  const cur = cycles[room.cycle];
  const acted = (id: string) => {
    switch (room.phase) {
      case "AUCTION":
        return room.bids.some((b) => b.playerId === id);
      case "TIGHTEN":
        return cur?.best?.playerId === id || Boolean(cur?.out.includes(id));
      case "QUOTE":
        return cur?.market?.makerId !== id;
      case "TRADE":
        return cur?.market?.makerId === id || room.trades.some((t) => t.cycle === room.cycle && t.playerId === id);
      default:
        return false;
    }
  };

  let results: TtResultRow[] | null = null;
  if (settled) {
    const rows = room.seats.map((s) => ({
      playerId: s.playerId,
      name: s.player.name,
      tradingPnl: s.tradingPnl ?? 0,
      normalized: s.normalized ?? 0,
      cost: s.cost ?? 0,
      score: s.score ?? 0,
      eloBefore: s.eloBefore,
      eloAfter: s.eloAfter ?? s.eloBefore,
    }));
    const r = ranks(rows.map((x) => x.score));
    results = rows.map((x, i) => ({ ...x, rank: r[i] })).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }

  return {
    id: room.id,
    index: room.index,
    round: room.round,
    phase: room.phase,
    cycle: room.cycle,
    opensAt: room.opensAt.getTime(),
    endsAt: room.endsAt?.getTime() ?? null,
    seq: room.seq,
    members: room.seats
      .map((s) => ({ id: s.playerId, name: s.player.name, elo: s.player.elo, acted: acted(s.playerId) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items: room.items.map((i) => ({
      index: i.index,
      label: itemLabel(i.index),
      winnerId: auctionOpen ? null : i.winnerId,
      winnerName: auctionOpen || !i.winnerId ? null : name(i.winnerId),
      price: auctionOpen ? null : i.price,
      value: settled || (me && !auctionOpen && i.winnerId === me.id) ? i.value : null,
      mine: Boolean(me && !auctionOpen && i.winnerId === me.id),
    })),
    myBids: me ? (room.bids.find((b) => b.playerId === me.id)?.amounts ?? null) : null,
    bidsIn: room.bids.filter((b) => seatIds.includes(b.playerId)).length,
    cycles,
    cards: settled ? room.cards : null,
    sum: settled ? room.cards.reduce((s, c) => s + c, 0) : null,
    results,
  };
}

export async function getTtView(code: string, playerToken?: string, hostToken?: string, watchRoom?: number): Promise<TtView | null> {
  await tick(code);
  const game = await prisma.ttGame.findUnique({
    where: { code },
    include: {
      players: { orderBy: { joinedAt: "asc" } },
      rooms: { select: { id: true, round: true, index: true, phase: true, cycle: true, seq: true, seats: { select: { playerId: true, score: true } } } },
    },
  });
  if (!game) return null;
  const isHost = Boolean(hostToken) && game.hostToken === hostToken;
  const me = playerToken ? game.players.find((p) => p.token === playerToken) : undefined;
  const names = new Map(game.players.map((p) => [p.id, p.name]));

  const scoreIn = (pid: string, round: number) => {
    for (const r of game.rooms) if (r.round === round) for (const s of r.seats) if (s.playerId === pid && s.score !== null) return s.score;
    return null;
  };
  const standings = game.players
    .map((p) => {
      const rounds = Array.from({ length: game.totalRounds }, (_, i) => scoreIn(p.id, i));
      return { id: p.id, name: p.name, elo: p.elo, total: round2(rounds.reduce<number>((s, x) => s + (x ?? 0), 0)), rounds };
    })
    .sort((a, b) => b.total - a.total || b.elo - a.elo || a.name.localeCompare(b.name));

  const current = game.status === "LOBBY" ? [] : game.rooms.filter((r) => r.round === game.currentRound).sort((a, b) => a.index - b.index);
  const mine = me ? current.find((r) => r.seats.some((s) => s.playerId === me.id)) : undefined;
  const watched = !mine && isHost ? (current.find((r) => r.index === watchRoom) ?? current[0]) : undefined;
  const target = mine ?? watched;
  const full = target ? await prisma.ttRoom.findUnique({ where: { id: target.id }, include: roomInclude }) : null;

  return {
    code: game.code,
    status: game.status,
    isHost,
    me: me ? { id: me.id, name: me.name, elo: me.elo } : null,
    serverNow: Date.now(),
    seq: game.seq,
    settings: {
      totalRounds: game.totalRounds,
      distribution: game.distribution,
      distributionLabel: distributionInfo[game.distribution].label,
      distributionDescribe: distributionInfo[game.distribution].describe,
      cardMean: round2(cardMean(game.distribution)),
      priorMean: priorMean(game),
      cardsPerRound: game.cardsPerRound,
      roomSize: game.roomSize,
      cycles: game.cycles,
      tightenPct: game.tightenPct,
      auctionSecs: game.auctionSecs,
      decisionSecs: game.decisionSecs,
      tradeSecs: game.tradeSecs,
      breakSecs: game.breakSecs,
      roundBreakSecs: game.roundBreakSecs,
    },
    currentRound: game.currentRound,
    roundBreakEndsAt: game.roundBreakEndsAt?.getTime() ?? null,
    standings,
    rooms: current.map((r) => ({
      id: r.id,
      index: r.index,
      phase: r.phase,
      cycle: r.cycle,
      seq: r.seq,
      players: r.seats.map((s) => names.get(s.playerId) ?? "?").sort(),
    })),
    room: full ? roomView(full, mine ? me : undefined) : null,
    spectating: !mine && Boolean(watched),
  };
}
