"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionState } from "@/lib/actions";
import { requireAccess } from "@/lib/game-auth";
import { normalizeCode, randomCode } from "@/lib/game";
import { drawCard, infoOrder, round2, validateQuote } from "@/lib/tt";
import { advanceIfDue, advanceNow, spentBefore, startGame, ttHostCookie, ttPlayerCookie } from "@/lib/tt-state";

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { error: e instanceof Error ? e.message : "Something went wrong" };
}

const longCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 86400,
  secure: process.env.NODE_ENV === "production",
};

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const settingsSchema = z
  .object({
    rounds: int(1, 20),
    distribution: z.enum(["SKEWED", "UNIFORM"]),
    cardsPerRound: int(1, 10),
    itemsPerRound: int(0, 10),
    sortedInfo: z.boolean(),
    auctionType: z.enum(["FIRST_PRICE", "SECOND_PRICE"]),
    bankroll: int(0, 1_000_000),
    resetBankroll: z.boolean(),
    subRounds: int(1, 5),
    tightenPct: int(0, 90),
    maxSpread: z.coerce.number().min(0).max(1_000_000).nullable(),
    auctionSecs: int(5, 600),
    quoteSecs: int(5, 600),
    tradeSecs: int(5, 600),
  })
  .refine((s) => s.itemsPerRound <= s.cardsPerRound, { message: "Can't auction more numbers than there are", path: ["itemsPerRound"] });

export async function createTtGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("host");
    const f = (k: string) => formData.get(k);
    const s = settingsSchema.parse({
      rounds: f("rounds"),
      distribution: f("distribution"),
      cardsPerRound: f("cardsPerRound"),
      itemsPerRound: f("itemsPerRound"),
      sortedInfo: f("infoOrder") !== "random",
      auctionType: f("auctionType"),
      bankroll: f("bankroll"),
      resetBankroll: f("resetBankroll") === "on",
      subRounds: f("subRounds"),
      tightenPct: f("tightenPct"),
      maxSpread: String(f("maxSpread") ?? "").trim() === "" ? null : f("maxSpread"),
      auctionSecs: f("auctionSecs"),
      quoteSecs: f("quoteSecs"),
      tradeSecs: f("tradeSecs"),
    });
    const { rounds, ...settings } = s;
    const hostToken = randomBytes(24).toString("hex");
    let created: { code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const candidate = randomCode(4);
      if (await prisma.ttGame.findUnique({ where: { code: candidate } })) continue;
      created = await prisma.ttGame.create({
        data: {
          ...settings,
          code: candidate,
          hostToken,
          rounds: {
            create: Array.from({ length: rounds }, (_, index) => {
              const cards = Array.from({ length: s.cardsPerRound }, () => drawCard(s.distribution));
              return {
                index,
                cards,
                items: { create: infoOrder(cards, s.itemsPerRound, s.sortedInfo).map((value, i) => ({ index: i, value })) },
              };
            }),
          },
        },
        select: { code: true },
      });
    }
    if (!created) throw new Error("Couldn't allocate a game code, try again");
    code = created.code;
    (await cookies()).set(ttHostCookie(code), hostToken, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/tt/${code}`);
}

export async function joinTtGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("member");
    code = normalizeCode(String(formData.get("code") ?? ""));
    const name = z.string().trim().min(1).max(30).parse(formData.get("name"));
    const game = await prisma.ttGame.findUnique({ where: { code }, select: { id: true, status: true } });
    if (!game) throw new Error("No game with that code");
    if (game.status === "FINISHED") throw new Error("That game is over");
    const token = randomBytes(24).toString("hex");
    try {
      await prisma.ttPlayer.create({ data: { gameId: game.id, name, token } });
    } catch {
      throw new Error("That name is taken in this game");
    }
    (await cookies()).set(ttPlayerCookie(code), token, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/tt/${code}`);
}

export async function openTtGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter a game code" };
  const game = await prisma.ttGame.findUnique({ where: { code }, select: { id: true } });
  if (!game) return { error: "No game with that code" };
  redirect(`/tt/${code}`);
}

// ---------- In-game ----------

const gameWithRounds = {
  players: { select: { id: true, token: true } },
  rounds: {
    orderBy: { index: "asc" as const },
    include: {
      items: { orderBy: { index: "asc" as const }, include: { bids: true } },
      quotes: { orderBy: { createdAt: "asc" as const } },
      trades: true,
    },
  },
};

async function loadAsPlayer(code: string) {
  await requireAccess("member");
  await advanceIfDue(code);
  const token = (await cookies()).get(ttPlayerCookie(code))?.value;
  if (!token) throw new Error("Join the game first");
  const game = await prisma.ttGame.findUnique({ where: { code }, include: gameWithRounds });
  if (!game) throw new Error("Game not found");
  const me = game.players.find((p) => p.token === token);
  if (!me) throw new Error("You're not in this game");
  if (game.status !== "PLAYING") throw new Error("The game isn't running");
  const round = game.rounds[game.currentRound];
  if (!round) throw new Error("No round in progress");
  if (game.phaseEndsAt && game.phaseEndsAt.getTime() <= Date.now()) throw new Error("Time's up");
  return { game, me, round };
}

const money = z.coerce.number().finite().min(0).max(1_000_000);
const price = z.coerce.number().finite().min(-1_000_000).max(1_000_000);

export async function placeBid(code: string, amount: number): Promise<ActionState> {
  try {
    const { game, me, round } = await loadAsPlayer(code);
    if (game.phase !== "AUCTION") throw new Error("No auction is open");
    const item = round.items[game.itemIndex];
    if (!item || item.closedAt) throw new Error("No auction is open");
    const value = round2(money.parse(amount));
    const left = round2(game.bankroll - spentBefore(game, me.id, round.index));
    if (value > left) throw new Error(`You only have $${left} left`);
    await prisma.ttBid.upsert({
      where: { itemId_playerId: { itemId: item.id, playerId: me.id } },
      create: { itemId: item.id, playerId: me.id, amount: value },
      update: { amount: value },
    });
    const bids = await prisma.ttBid.count({ where: { itemId: item.id } });
    if (bids >= game.players.length) await advanceNow(game.id, game.seq);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function postQuote(code: string, bid: number, ask: number): Promise<ActionState> {
  try {
    const { game, me, round } = await loadAsPlayer(code);
    if (game.phase !== "QUOTE") throw new Error("Quoting is closed");
    const q = { bid: round2(price.parse(bid)), ask: round2(price.parse(ask)) };
    const err = await prisma.$transaction(async (tx) => {
      // Serialize quotes on this round so two near-simultaneous quotes can't both "tighten" the same market.
      await tx.$executeRaw`SELECT 1 FROM "TtRound" WHERE id = ${round.id} FOR UPDATE`;
      const best = await tx.ttQuote.findFirst({ where: { roundId: round.id, subRound: game.subRound }, orderBy: { createdAt: "desc" } });
      const problem = validateQuote(q, best, game.tightenPct, game.maxSpread);
      if (problem) return problem;
      await tx.ttQuote.create({ data: { roundId: round.id, subRound: game.subRound, playerId: me.id, ...q } });
      return null;
    });
    if (err) throw new Error(err);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function submitTrade(code: string, side: "BUY" | "SELL" | "PASS"): Promise<ActionState> {
  try {
    const { game, me, round } = await loadAsPlayer(code);
    if (game.phase !== "TRADE") throw new Error("Trading is closed");
    if (!["BUY", "SELL", "PASS"].includes(side)) throw new Error("Pick buy, sell or pass");
    const subQuotes = round.quotes.filter((q) => q.subRound === game.subRound);
    const market = subQuotes[subQuotes.length - 1];
    if (!market) throw new Error("There's no market this round");
    if (market.playerId === me.id) throw new Error("You made this market — you can't trade against yourself");
    try {
      await prisma.ttTrade.create({ data: { roundId: round.id, subRound: game.subRound, playerId: me.id, side } });
    } catch {
      throw new Error("You already traded this round");
    }
    const traded = await prisma.ttTrade.count({ where: { roundId: round.id, subRound: game.subRound } });
    if (traded >= game.players.length - 1) await advanceNow(game.id, game.seq);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export type TtHostOp = "start" | "skip" | "next" | "end";

export async function ttHostAction(code: string, op: TtHostOp, seq: number): Promise<ActionState> {
  try {
    const token = (await cookies()).get(ttHostCookie(code))?.value;
    const game = await prisma.ttGame.findUnique({ where: { code } });
    if (!game) throw new Error("Game not found");
    if (!token || token !== game.hostToken) throw new Error("Only the host can do that");
    // `seq` guards against double clicks acting on a phase that already moved on.
    if (seq !== game.seq) return { ok: true };
    switch (op) {
      case "start":
        if (game.status !== "LOBBY") throw new Error("Already started");
        await startGame(game.id, seq);
        break;
      case "skip":
        if (game.status !== "PLAYING" || game.phase === "RESULTS") throw new Error("Nothing to skip");
        await advanceNow(game.id, seq);
        break;
      case "next":
        if (game.status !== "PLAYING" || game.phase !== "RESULTS") throw new Error("Finish the round first");
        await advanceNow(game.id, seq);
        break;
      case "end":
        await prisma.ttGame.update({ where: { id: game.id }, data: { status: "FINISHED", phaseEndsAt: null, seq: { increment: 1 } } });
        break;
    }
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
