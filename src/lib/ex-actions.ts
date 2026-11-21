"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionState } from "@/lib/actions";
import { requireAccess } from "@/lib/game-auth";
import { normalizeCode, randomCode } from "@/lib/game";
import { applyOp, endGame, exHostCookie, exPlayerCookie, startGame, type PlayerOp } from "@/lib/ex-state";

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
    question: z.string().trim().min(1, "Enter a question").max(300),
    answer: z.coerce.number().finite(),
    priceMin: int(0, 1_000_000),
    priceMax: int(0, 1_000_000),
    guessPct: int(0, 100),
    caseSecs: int(60, 3600),
    stepSecs: int(5, 600),
    customerRate: int(0, 20),
    positionLimit: int(10, 1_000_000),
    maxOrderSize: int(1, 1000),
    maxOpenOrders: int(1, 200),
  })
  .refine((s) => s.stepSecs <= s.caseSecs, { message: "Fair-value step can't be longer than the case", path: ["stepSecs"] })
  .refine((s) => s.priceMax - s.priceMin >= 10, { message: "Price range must span at least 10", path: ["priceMax"] })
  .refine((s) => s.answer >= s.priceMin && s.answer <= s.priceMax, { message: "Answer must be inside the price range", path: ["answer"] });

const SETTINGS = ["question", "answer", "priceMin", "priceMax", "guessPct", "caseSecs", "stepSecs", "customerRate", "positionLimit", "maxOrderSize", "maxOpenOrders"];

export async function createExGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("host");
    const settings = settingsSchema.parse(Object.fromEntries(SETTINGS.map((k) => [k, formData.get(k)])));
    const hostToken = randomBytes(24).toString("hex");
    let created: { code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const candidate = randomCode(4);
      if (await prisma.exGame.findUnique({ where: { code: candidate } })) continue;
      created = await prisma.exGame.create({ data: { ...settings, code: candidate, hostToken }, select: { code: true } });
    }
    if (!created) throw new Error("Couldn't allocate a game code, try again");
    code = created.code;
    (await cookies()).set(exHostCookie(code), hostToken, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/ex/${code}`);
}

export async function joinExGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("member");
    code = normalizeCode(String(formData.get("code") ?? ""));
    const name = z.string().trim().min(1).max(30).parse(formData.get("name"));
    const game = await prisma.exGame.findUnique({ where: { code }, select: { id: true, status: true } });
    if (!game) throw new Error("No game with that code");
    if (game.status === "FINISHED") throw new Error("That game is over");
    const token = randomBytes(24).toString("hex");
    try {
      await prisma.exPlayer.create({ data: { gameId: game.id, name, token } });
    } catch {
      throw new Error("That name is taken in this game");
    }
    (await cookies()).set(exPlayerCookie(code), token, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/ex/${code}`);
}

export async function openExGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter a game code" };
  const game = await prisma.exGame.findUnique({ where: { code }, select: { id: true } });
  if (!game) return { error: "No game with that code" };
  redirect(`/ex/${code}`);
}

const opSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("order"), buy: z.boolean(), price: z.number().int(), qty: z.number().int() }),
  z.object({ kind: z.literal("cancel"), id: z.number().int() }),
  z.object({ kind: z.literal("cancelAll") }),
]);

export async function exTrade(code: string, op: PlayerOp): Promise<ActionState & { filled?: number }> {
  try {
    await requireAccess("member");
    const parsed = opSchema.parse(op);
    const token = (await cookies()).get(exPlayerCookie(normalizeCode(code)))?.value;
    if (!token) throw new Error("Join the game first");
    const me = await prisma.exPlayer.findUnique({ where: { token }, select: { id: true, gameId: true, game: { select: { code: true } } } });
    if (!me || me.game.code !== normalizeCode(code)) throw new Error("You're not in this game");
    const r = await applyOp(me.gameId, me.id, parsed);
    return r.error ? { error: r.error } : { ok: true, filled: r.filled };
  } catch (e) {
    return fail(e);
  }
}

export async function exHostAction(code: string, op: "start" | "end"): Promise<ActionState> {
  try {
    const token = (await cookies()).get(exHostCookie(normalizeCode(code)))?.value;
    const game = await prisma.exGame.findUnique({ where: { code: normalizeCode(code) }, select: { id: true, hostToken: true } });
    if (!game) throw new Error("Game not found");
    if (!token || token !== game.hostToken) throw new Error("Only the host can do that");
    if (op === "start") await startGame(game.id);
    else await endGame(game.id);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
