import { prisma } from "@/lib/db";
import type { GameStatus, Prisma, TtAuctionType, TtDistribution, TtPhase, TtSide } from "@/generated/prisma/client";
import { cardMean, distributionInfo, itemLabel, ranks, resolveAuction, round2, takerPnl, type Market } from "@/lib/tt";

export const ttPlayerCookie = (code: string) => `tt_player_${code}`;
export const ttHostCookie = (code: string) => `tt_host_${code}`;

const gameInclude = {
  players: { orderBy: { joinedAt: "asc" as const } },
  rounds: {
    orderBy: { index: "asc" as const },
    include: {
      items: { orderBy: { index: "asc" as const }, include: { bids: true } },
      quotes: { orderBy: { createdAt: "asc" as const } },
      trades: true,
    },
  },
} satisfies Prisma.TtGameInclude;

type FullGame = Prisma.TtGameGetPayload<{ include: typeof gameInclude }>;
type FullRound = FullGame["rounds"][number];
type Tx = Prisma.TransactionClient;

// ---------- Phase machine ----------

/** The market for a sub-round is its last (tightest) quote. */
function marketFor(round: { quotes: { subRound: number; bid: number; ask: number; playerId: string }[] }, sub: number) {
  const qs = round.quotes.filter((q) => q.subRound === sub);
  return qs.length ? qs[qs.length - 1] : null;
}

const after = (secs: number) => new Date(Date.now() + secs * 1000);

type Step = { phase: TtPhase; itemIndex: number; subRound: number; phaseEndsAt: Date | null; status?: GameStatus; currentRound?: number };

/** First phase of round `index`. */
function roundStart(game: { itemsPerRound: number; auctionSecs: number; quoteSecs: number }, index: number): Step {
  return game.itemsPerRound > 0
    ? { phase: "AUCTION", itemIndex: 0, subRound: 0, phaseEndsAt: after(game.auctionSecs), currentRound: index }
    : { phase: "QUOTE", itemIndex: 0, subRound: 0, phaseEndsAt: after(game.quoteSecs), currentRound: index };
}

function quoteOrResults(game: FullGame, sub: number): Step {
  return sub < game.subRounds
    ? { phase: "QUOTE", itemIndex: game.itemIndex, subRound: sub, phaseEndsAt: after(game.quoteSecs) }
    : { phase: "RESULTS", itemIndex: game.itemIndex, subRound: game.subRounds - 1, phaseEndsAt: null };
}

/**
 * Moves the game one step forward, closing whatever was open. Uses `seq` as an optimistic lock so concurrent
 * pollers/actions only advance once. Returns false if someone else already advanced.
 */
async function advance(gameId: string, expectedSeq: number): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const game = await tx.ttGame.findUnique({ where: { id: gameId }, include: gameInclude });
    if (!game || game.seq !== expectedSeq || game.status !== "PLAYING") return false;
    const round = game.rounds[game.currentRound];
    if (!round) return false;

    let step: Step;
    switch (game.phase) {
      case "AUCTION": {
        await closeItem(tx, round, game.itemIndex, game.auctionType);
        step =
          game.itemIndex + 1 < round.items.length
            ? { phase: "AUCTION", itemIndex: game.itemIndex + 1, subRound: 0, phaseEndsAt: after(game.auctionSecs) }
            : { phase: "QUOTE", itemIndex: game.itemIndex, subRound: 0, phaseEndsAt: after(game.quoteSecs) };
        break;
      }
      case "QUOTE":
        step = marketFor(round, game.subRound)
          ? { phase: "TRADE", itemIndex: game.itemIndex, subRound: game.subRound, phaseEndsAt: after(game.tradeSecs) }
          : quoteOrResults(game, game.subRound + 1);
        break;
      case "TRADE":
        step = quoteOrResults(game, game.subRound + 1);
        break;
      case "RESULTS":
        step =
          game.currentRound + 1 < game.rounds.length
            ? roundStart(game, game.currentRound + 1)
            : { phase: "RESULTS", itemIndex: game.itemIndex, subRound: game.subRound, phaseEndsAt: null, status: "FINISHED" };
        break;
    }
    if (step.phase === "RESULTS" && game.phase !== "RESULTS")
      await tx.ttRound.update({ where: { id: round.id }, data: { settledAt: new Date() } });

    const claimed = await tx.ttGame.updateMany({ where: { id: gameId, seq: expectedSeq }, data: { ...step, seq: expectedSeq + 1 } });
    return claimed.count === 1;
  });
}

async function closeItem(tx: Tx, round: FullRound, index: number, type: TtAuctionType) {
  const item = round.items[index];
  if (!item || item.closedAt) return;
  const result = resolveAuction(
    item.bids.map((b) => ({ playerId: b.playerId, amount: b.amount, at: b.updatedAt.getTime() })),
    type,
  );
  await tx.ttInfoItem.update({
    where: { id: item.id },
    data: { closedAt: new Date(), winnerId: result?.winnerId ?? null, price: result?.price ?? null },
  });
}

/** Advances past an expired timer (one step per call, so nobody misses a phase while everyone was away). */
export async function advanceIfDue(code: string) {
  const g = await prisma.ttGame.findUnique({ where: { code }, select: { id: true, seq: true, status: true, phaseEndsAt: true } });
  if (g && g.status === "PLAYING" && g.phaseEndsAt && g.phaseEndsAt.getTime() <= Date.now()) await advance(g.id, g.seq);
}

export async function advanceNow(gameId: string, seq: number) {
  return advance(gameId, seq);
}

export async function startGame(gameId: string, seq: number) {
  const game = await prisma.ttGame.findUnique({ where: { id: gameId } });
  if (!game || game.seq !== seq || game.status !== "LOBBY") return false;
  const claimed = await prisma.ttGame.updateMany({
    where: { id: gameId, seq },
    data: { ...roundStart(game, 0), status: "PLAYING", seq: seq + 1 },
  });
  return claimed.count === 1;
}

// ---------- Money ----------

/** Auction spend counted against the bankroll available in round `roundIndex`. */
export function spentBefore(game: { resetBankroll: boolean; rounds: FullRound[] }, playerId: string, roundIndex: number) {
  return round2(
    game.rounds
      .filter((r) => (game.resetBankroll ? r.index === roundIndex : r.index <= roundIndex))
      .flatMap((r) => r.items)
      .filter((i) => i.winnerId === playerId && i.price !== null)
      .reduce((s, i) => s + (i.price ?? 0), 0),
  );
}

type RoundResult = { playerId: string; name: string; tradingPnl: number; spend: number; pnl: number; rank: number };

function settleRound(game: FullGame, round: FullRound): RoundResult[] {
  const value = round.cards.reduce((s, c) => s + c, 0);
  const trading = new Map(game.players.map((p) => [p.id, 0]));
  for (let sub = 0; sub < game.subRounds; sub++) {
    const m = marketFor(round, sub);
    if (!m) continue;
    for (const t of round.trades.filter((t) => t.subRound === sub && t.playerId !== m.playerId)) {
      const pnl = takerPnl(t.side, m, value);
      trading.set(t.playerId, (trading.get(t.playerId) ?? 0) + pnl);
      trading.set(m.playerId, (trading.get(m.playerId) ?? 0) - pnl);
    }
  }
  const rows = game.players.map((p) => {
    const spend = round.items.filter((i) => i.winnerId === p.id).reduce((s, i) => s + (i.price ?? 0), 0);
    const tradingPnl = round2(trading.get(p.id) ?? 0);
    return { playerId: p.id, name: p.name, tradingPnl, spend: round2(spend), pnl: round2(tradingPnl - spend) };
  });
  const r = ranks(rows.map((x) => x.pnl));
  return rows.map((x, i) => ({ ...x, rank: r[i] })).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// ---------- Client view ----------

export type TtSettings = {
  totalRounds: number;
  distribution: TtDistribution;
  distributionLabel: string;
  distributionDescribe: string;
  cardMean: number;
  cardsPerRound: number;
  itemsPerRound: number;
  sortedInfo: boolean;
  auctionType: TtAuctionType;
  bankroll: number;
  resetBankroll: boolean;
  subRounds: number;
  tightenPct: number;
  maxSpread: number | null;
  auctionSecs: number;
  quoteSecs: number;
  tradeSecs: number;
};

export type TtItemView = {
  index: number;
  label: string;
  closed: boolean;
  winnerName: string | null;
  price: number | null;
  /** Visible to the buyer, and to everyone after settlement. */
  value: number | null;
  mine: boolean;
};

export type TtSubView = {
  subRound: number;
  quotes: { id: string; name: string; playerId: string; bid: number; ask: number }[];
  market: (Market & { makerId: string; makerName: string }) | null;
  /** Revealed once the trade phase for this sub-round is over. */
  trades: { playerId: string; name: string; side: TtSide }[] | null;
  tradesIn: number;
  myTrade: TtSide | null;
};

export type TtView = {
  code: string;
  status: GameStatus;
  isHost: boolean;
  me: { id: string; name: string } | null;
  serverNow: number;
  seq: number;
  settings: TtSettings;
  currentRound: number;
  phase: TtPhase;
  itemIndex: number;
  subRound: number;
  phaseEndsAt: number | null;
  players: { id: string; name: string; totalPnl: number; bankrollLeft: number; acted: boolean }[];
  round: {
    index: number;
    items: TtItemView[];
    myBid: number | null;
    bidsIn: number;
    subs: TtSubView[];
    settled: boolean;
    cards: number[] | null;
    sum: number | null;
    results: RoundResult[] | null;
  } | null;
  history: { index: number; sum: number; cards: number[]; results: RoundResult[] }[];
};

export async function getTtView(code: string, playerToken?: string, hostToken?: string): Promise<TtView | null> {
  await advanceIfDue(code);
  const game = await prisma.ttGame.findUnique({ where: { code }, include: gameInclude });
  if (!game) return null;
  const isHost = Boolean(hostToken) && game.hostToken === hostToken;
  const me = playerToken ? game.players.find((p) => p.token === playerToken) : undefined;
  const playing = game.status !== "LOBBY";
  const current = playing ? game.rounds[game.currentRound] : undefined;
  const names = new Map(game.players.map((p) => [p.id, p.name]));

  const settledRounds = game.rounds.filter((r) => r.settledAt);
  const results = new Map(settledRounds.map((r) => [r.id, settleRound(game, r)]));
  const total = (pid: string) =>
    round2([...results.values()].reduce((s, rows) => s + (rows.find((x) => x.playerId === pid)?.pnl ?? 0), 0));

  const curItem = current && game.phase === "AUCTION" ? current.items[game.itemIndex] : undefined;
  const curMarket = current && game.phase === "TRADE" ? marketFor(current, game.subRound) : null;

  const players = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    totalPnl: total(p.id),
    bankrollLeft: round2(game.bankroll - spentBefore(game, p.id, current?.index ?? 0)),
    acted: curItem
      ? curItem.bids.some((b) => b.playerId === p.id)
      : curMarket
        ? p.id === curMarket.playerId || current!.trades.some((t) => t.subRound === game.subRound && t.playerId === p.id)
        : false,
  }));

  let round: TtView["round"] = null;
  if (current) {
    const settled = Boolean(current.settledAt);
    const lastSub = game.phase === "AUCTION" ? -1 : game.subRound;
    const subs: TtSubView[] = [];
    for (let s = 0; s <= lastSub; s++) {
      const m = marketFor(current, s);
      const subTrades = current.trades.filter((t) => t.subRound === s);
      const tradingOpen = game.phase === "TRADE" && s === game.subRound;
      const quoteOpen = game.phase === "QUOTE" && s === game.subRound;
      subs.push({
        subRound: s,
        quotes: current.quotes
          .filter((q) => q.subRound === s)
          .map((q) => ({ id: q.id, name: names.get(q.playerId) ?? "?", playerId: q.playerId, bid: q.bid, ask: q.ask })),
        market: m && !quoteOpen ? { bid: m.bid, ask: m.ask, makerId: m.playerId, makerName: names.get(m.playerId) ?? "?" } : null,
        trades:
          tradingOpen || quoteOpen
            ? null
            : subTrades
                .filter((t) => t.side !== "PASS")
                .map((t) => ({ playerId: t.playerId, name: names.get(t.playerId) ?? "?", side: t.side })),
        tradesIn: subTrades.length,
        myTrade: me ? (subTrades.find((t) => t.playerId === me.id)?.side ?? null) : null,
      });
    }
    round = {
      index: current.index,
      items: current.items.map((i) => ({
        index: i.index,
        label: itemLabel(i.index, game.sortedInfo),
        closed: Boolean(i.closedAt),
        winnerName: i.winnerId ? (names.get(i.winnerId) ?? "?") : null,
        price: i.closedAt ? i.price : null,
        value: settled || (me && i.winnerId === me.id) ? i.value : null,
        mine: Boolean(me && i.winnerId === me.id),
      })),
      myBid: curItem && me ? (curItem.bids.find((b) => b.playerId === me.id)?.amount ?? null) : null,
      bidsIn: curItem?.bids.length ?? 0,
      subs,
      settled,
      cards: settled ? current.cards : null,
      sum: settled ? current.cards.reduce((s, c) => s + c, 0) : null,
      results: settled ? (results.get(current.id) ?? null) : null,
    };
  }

  return {
    code: game.code,
    status: game.status,
    isHost,
    me: me ? { id: me.id, name: me.name } : null,
    serverNow: Date.now(),
    seq: game.seq,
    settings: {
      totalRounds: game.rounds.length,
      distribution: game.distribution,
      distributionLabel: distributionInfo[game.distribution].label,
      distributionDescribe: distributionInfo[game.distribution].describe,
      cardMean: round2(cardMean(game.distribution)),
      cardsPerRound: game.cardsPerRound,
      itemsPerRound: game.itemsPerRound,
      sortedInfo: game.sortedInfo,
      auctionType: game.auctionType,
      bankroll: game.bankroll,
      resetBankroll: game.resetBankroll,
      subRounds: game.subRounds,
      tightenPct: game.tightenPct,
      maxSpread: game.maxSpread,
      auctionSecs: game.auctionSecs,
      quoteSecs: game.quoteSecs,
      tradeSecs: game.tradeSecs,
    },
    currentRound: game.currentRound,
    phase: game.phase,
    itemIndex: game.itemIndex,
    subRound: game.subRound,
    phaseEndsAt: game.phaseEndsAt?.getTime() ?? null,
    players,
    round,
    history: settledRounds
      .filter((r) => r.index < game.currentRound || game.status === "FINISHED")
      .map((r) => ({ index: r.index, sum: r.cards.reduce((s, c) => s + c, 0), cards: r.cards, results: results.get(r.id)! })),
  };
}
