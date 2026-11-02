"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionState } from "@/lib/actions";
import { requireAccess } from "@/lib/game-auth";
import { normalizeCode, randomCode } from "@/lib/game";
import { MAX_BID, round2, validateWidth } from "@/lib/tt";
import { advanceGame, advanceRoom, roomInclude, tick, tightenDone, tightenState, ttHostCookie, ttPlayerCookie } from "@/lib/tt-state";

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

const settingsSchema = z.object({
  totalRounds: int(1, 20),
  distribution: z.enum(["SKEWED", "UNIFORM"]),
  cardsPerRound: int(1, 10),
  roomSize: int(2, 12),
  cycles: int(1, 10),
  tightenPct: int(0, 90),
  auctionSecs: int(10, 600),
  decisionSecs: int(5, 300),
  tradeSecs: int(5, 600),
  breakSecs: int(0, 60),
  roundBreakSecs: int(0, 600),
});

export async function createTtGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("host");
    const settings = settingsSchema.parse(Object.fromEntries(Object.keys(settingsSchema.shape).map((k) => [k, formData.get(k)])));
    const hostToken = randomBytes(24).toString("hex");
    let created: { code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const candidate = randomCode(4);
      if (await prisma.ttGame.findUnique({ where: { code: candidate } })) continue;
      created = await prisma.ttGame.create({ data: { ...settings, code: candidate, hostToken }, select: { code: true } });
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

/** The caller's seat for the current round, with the phase window checked. */
async function loadSeat(code: string) {
  await requireAccess("member");
  await tick(code);
  const token = (await cookies()).get(ttPlayerCookie(code))?.value;
  if (!token) throw new Error("Join the game first");
  const me = await prisma.ttPlayer.findUnique({ where: { token }, include: { game: true } });
  if (!me || me.game.code !== code) throw new Error("You're not in this game");
  const game = me.game;
  if (game.status !== "PLAYING") throw new Error("The game isn't running");
  const room = await prisma.ttRoom.findFirst({
    where: { gameId: game.id, round: game.currentRound, seats: { some: { playerId: me.id } } },
    include: roomInclude,
  });
  if (!room) throw new Error("You'll be seated next round");
  checkWindow(room);
  return { game, me, room };
}

function checkWindow(room: { opensAt: Date; endsAt: Date | null }) {
  const now = Date.now();
  if (now < room.opensAt.getTime()) throw new Error("Hang on — this phase hasn't opened yet");
  if (room.endsAt && room.endsAt.getTime() <= now) throw new Error("Time's up");
}

const price = z.coerce.number().finite().min(-1_000_000).max(1_000_000);

export async function placeBids(code: string, amounts: number[]): Promise<ActionState> {
  try {
    const { me, room } = await loadSeat(code);
    if (room.phase !== "AUCTION") throw new Error("The auction is closed");
    if (!Array.isArray(amounts) || amounts.length !== room.items.length) throw new Error(`Enter ${room.items.length} bids`);
    const clean = amounts.map((a) => round2(z.coerce.number().finite().min(0).max(MAX_BID).parse(a)));
    await prisma.ttBid.upsert({
      where: { roomId_playerId: { roomId: room.id, playerId: me.id } },
      create: { roomId: room.id, playerId: me.id, amounts: clean },
      update: { amounts: clean },
    });
    const bids = await prisma.ttBid.count({ where: { roomId: room.id } });
    if (bids >= room.seats.length) await advanceRoom(room.id, room.seq, false);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/** Propose a tighter spread width, or pass `null` to say you won't tighten further. */
export async function proposeWidth(code: string, width: number | null): Promise<ActionState> {
  try {
    const { game, me, room } = await loadSeat(code);
    if (room.phase !== "TIGHTEN") throw new Error("Tightening is closed");
    const w = width === null ? null : round2(z.coerce.number().finite().min(0).max(1_000_000).parse(width));
    const done = await prisma.$transaction(async (tx) => {
      // Serialize proposals (and timer-driven advances) on this room so two can't both beat the same best.
      await tx.$executeRaw`SELECT 1 FROM "TtRoom" WHERE id = ${room.id} FOR UPDATE`;
      const fresh = await tx.ttRoom.findUnique({ where: { id: room.id }, include: { tightens: { orderBy: { createdAt: "asc" } } } });
      if (!fresh || fresh.seq !== room.seq || fresh.phase !== "TIGHTEN") throw new Error("Tightening is closed");
      checkWindow(fresh);
      const { best, out } = tightenState(fresh.tightens, fresh.cycle);
      if (best?.playerId === me.id) throw new Error("You already have the tightest spread");
      if (w === null) {
        if (!out.has(me.id)) await tx.ttTighten.create({ data: { roomId: room.id, cycle: fresh.cycle, playerId: me.id, width: null } });
      } else {
        const problem = validateWidth(w, best?.width ?? null, game.tightenPct);
        if (problem) throw new Error(problem);
        await tx.ttTighten.create({ data: { roomId: room.id, cycle: fresh.cycle, playerId: me.id, width: w } });
        await tx.ttRoom.update({ where: { id: room.id }, data: { endsAt: new Date(Date.now() + game.decisionSecs * 1000) } });
      }
      const rows = await tx.ttTighten.findMany({ where: { roomId: room.id, cycle: fresh.cycle }, orderBy: { createdAt: "asc" } });
      return tightenDone(rows, fresh.cycle, room.seats.map((s) => s.playerId));
    });
    if (done) await advanceRoom(room.id, room.seq, false);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/** The market maker sets the bid; the ask is bid + the winning width. */
export async function postMarket(code: string, bid: number): Promise<ActionState> {
  try {
    const { me, room } = await loadSeat(code);
    if (room.phase !== "QUOTE") throw new Error("Not quoting right now");
    const market = room.markets.find((m) => m.cycle === room.cycle);
    if (!market || market.makerId !== me.id) throw new Error("Only the market maker quotes");
    const b = round2(price.parse(bid));
    const updated = await prisma.ttMarket.updateMany({
      where: { id: market.id, bid: null },
      data: { bid: b, ask: round2(b + market.width) },
    });
    if (updated.count === 0) throw new Error("Your market is already up");
    await advanceRoom(room.id, room.seq, false);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function submitTrade(code: string, side: "BUY" | "SELL" | "PASS"): Promise<ActionState> {
  try {
    const { me, room } = await loadSeat(code);
    if (room.phase !== "TRADE") throw new Error("Trading is closed");
    if (!["BUY", "SELL", "PASS"].includes(side)) throw new Error("Pick buy, sell or pass");
    const market = room.markets.find((m) => m.cycle === room.cycle);
    if (!market || market.bid === null) throw new Error("There's no market");
    if (market.makerId === me.id) throw new Error("You made this market — you can't trade against yourself");
    try {
      await prisma.ttTrade.create({ data: { roomId: room.id, cycle: room.cycle, playerId: me.id, side } });
    } catch {
      throw new Error("You already traded this cycle");
    }
    const traded = await prisma.ttTrade.count({ where: { roomId: room.id, cycle: room.cycle } });
    if (traded >= room.seats.length - 1) await advanceRoom(room.id, room.seq, false);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export type TtHostOp = "start" | "skip" | "end";

/** `rooms` carries the room seqs the host saw, so a double click can't skip two phases. */
export async function ttHostAction(code: string, op: TtHostOp, seq: number, rooms: { id: string; seq: number }[] = []): Promise<ActionState> {
  try {
    const token = (await cookies()).get(ttHostCookie(code))?.value;
    const game = await prisma.ttGame.findUnique({ where: { code }, include: { _count: { select: { players: true } } } });
    if (!game) throw new Error("Game not found");
    if (!token || token !== game.hostToken) throw new Error("Only the host can do that");
    if (seq !== game.seq) return { ok: true };
    switch (op) {
      case "start":
        if (game.status !== "LOBBY") throw new Error("Already started");
        if (game._count.players < 2) throw new Error("Need at least 2 players");
        await advanceGame(game.id, seq, "start");
        break;
      case "skip": {
        if (game.status !== "PLAYING") throw new Error("Nothing to skip");
        const open = await prisma.ttRoom.findMany({
          where: { gameId: game.id, round: game.currentRound, phase: { not: "RESULTS" } },
          select: { id: true, seq: true },
        });
        if (open.length === 0) await advanceGame(game.id, seq, "skip");
        else for (const r of open) if (rooms.some((x) => x.id === r.id && x.seq === r.seq)) await advanceRoom(r.id, r.seq, false);
        break;
      }
      case "end":
        await prisma.ttGame.update({ where: { id: game.id }, data: { status: "FINISHED", roundBreakEndsAt: null, seq: { increment: 1 } } });
        break;
    }
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
