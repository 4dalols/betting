"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionState } from "@/lib/actions";
import { grantAccess, requireAccess, type GateRole } from "@/lib/game-auth";
import { hostCookie, playerCookie } from "@/lib/game-state";
import { normalizeCode, randomCode, roundWinners } from "@/lib/game";
import type { Prisma } from "@/generated/prisma/client";

function fail(e: unknown): ActionState {
  return { error: e instanceof Error ? e.message : "Something went wrong" };
}

const ANSWERED_COOKIE = "pir_answered";
const longCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 365 * 86400,
  secure: process.env.NODE_ENV === "production",
};

// ---------- Password gate ----------

export async function unlockGate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const role: GateRole = formData.get("role") === "host" ? "host" : "member";
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/answer");
  if (!(await grantAccess(role, password))) return { error: "Wrong password" };
  redirect(next.startsWith("/") ? next : "/answer");
}

// ---------- Survey (zero-knowledge: only aggregates are ever written) ----------

export async function answeredQuestionIds(): Promise<Set<string>> {
  const raw = (await cookies()).get(ANSWERED_COOKIE)?.value ?? "";
  return new Set(raw.split(",").filter(Boolean));
}

const numberField = z.coerce.number().finite().min(-1e12).max(1e12);

export async function submitAnswers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAccess("member");
    const already = await answeredQuestionIds();
    const questions = await prisma.question.findMany({ where: { active: true }, select: { id: true } });
    const updates: { id: string; value: number | null }[] = [];
    for (const q of questions) {
      if (already.has(q.id)) continue;
      const mode = formData.get(`mode_${q.id}`);
      if (mode === "skip") {
        updates.push({ id: q.id, value: null });
        continue;
      }
      const raw = formData.get(`value_${q.id}`);
      if (raw === null || String(raw).trim() === "") throw new Error("Answer every question or pick “Prefer not to answer”");
      const parsed = numberField.safeParse(String(raw).replace(/,/g, ""));
      if (!parsed.success) throw new Error("Answers must be numbers");
      updates.push({ id: q.id, value: parsed.data });
    }
    if (updates.length === 0) throw new Error("Nothing new to answer");

    // Aggregates only. No row is ever written that ties a value to a person.
    await prisma.$transaction(
      updates.map((u) =>
        prisma.question.update({
          where: { id: u.id },
          data: u.value === null ? { skipped: { increment: 1 } } : { sum: { increment: u.value }, answered: { increment: 1 } },
        }),
      ),
    );

    const jar = await cookies();
    const done = new Set([...already, ...updates.map((u) => u.id)]);
    jar.set(ANSWERED_COOKIE, [...done].join(","), longCookie);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/answer");
  revalidatePath("/host");
  return { ok: true };
}

// ---------- Questions (host) ----------

const questionSchema = z.object({
  prompt: z.string().trim().min(3).max(300),
  unit: z.string().trim().max(40).optional(),
});

export async function createQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAccess("host");
    const data = questionSchema.parse({
      prompt: formData.get("prompt"),
      unit: formData.get("unit") || undefined,
    });
    const last = await prisma.question.aggregate({ _max: { sortOrder: true } });
    await prisma.question.create({ data: { ...data, unit: data.unit || null, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/host");
  revalidatePath("/answer");
  return { ok: true };
}

export async function updateQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAccess("host");
    const id = String(formData.get("id"));
    const op = String(formData.get("op"));
    const data: Prisma.QuestionUpdateInput =
      op === "archive"
        ? { active: false }
        : op === "restore"
          ? { active: true }
          : op === "reset"
            ? { sum: 0, answered: 0, skipped: 0 }
            : (() => {
                throw new Error("Unknown operation");
              })();
    await prisma.question.update({ where: { id }, data });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/host");
  revalidatePath("/answer");
  return { ok: true };
}

export async function deleteQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAccess("host");
    const id = String(formData.get("id"));
    const used = await prisma.gameRound.count({ where: { questionId: id } });
    if (used > 0) throw new Error("Used in a game — archive it instead");
    await prisma.question.delete({ where: { id } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/host");
  revalidatePath("/answer");
  return { ok: true };
}

// ---------- Games ----------

export async function createGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("host");
    const scoring = formData.get("scoring") === "CLOSEST" ? "CLOSEST" : "CLOSEST_WITHOUT_OVER";
    const shuffle = formData.get("shuffle") === "on";
    const ids = formData.getAll("questionId").map(String);
    if (ids.length === 0) throw new Error("Pick at least one question");
    const questions = await prisma.question.findMany({ where: { id: { in: ids } }, orderBy: { sortOrder: "asc" } });
    if (questions.length === 0) throw new Error("Pick at least one question");
    const ordered = shuffle ? [...questions].sort(() => Math.random() - 0.5) : questions;

    const hostToken = randomBytes(24).toString("hex");
    let created: { code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const candidate = randomCode(4);
      if (await prisma.game.findUnique({ where: { code: candidate } })) continue;
      created = await prisma.game.create({
        data: {
          code: candidate,
          scoring,
          hostToken,
          rounds: { create: ordered.map((q, index) => ({ questionId: q.id, index })) },
        },
        select: { code: true },
      });
    }
    if (!created) throw new Error("Couldn't allocate a game code, try again");
    code = created.code;
    (await cookies()).set(hostCookie(code), hostToken, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/game/${code}`);
}

export async function joinGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let code: string;
  try {
    await requireAccess("member");
    code = normalizeCode(String(formData.get("code") ?? ""));
    const name = z.string().trim().min(1).max(30).parse(formData.get("name"));
    const game = await prisma.game.findUnique({ where: { code }, select: { id: true, status: true } });
    if (!game) throw new Error("No game with that code");
    if (game.status === "FINISHED") throw new Error("That game is over");
    const token = randomBytes(24).toString("hex");
    try {
      await prisma.gamePlayer.create({ data: { gameId: game.id, name, token } });
    } catch {
      throw new Error("That name is taken in this game");
    }
    (await cookies()).set(playerCookie(code), token, longCookie);
  } catch (e) {
    return fail(e);
  }
  redirect(`/game/${code}`);
}

export async function openGame(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter a game code" };
  const game = await prisma.game.findUnique({ where: { code }, select: { id: true } });
  if (!game) return { error: "No game with that code" };
  redirect(`/game/${code}`);
}

async function requireHost(code: string) {
  const token = (await cookies()).get(hostCookie(code))?.value;
  const game = await prisma.game.findUnique({ where: { code }, include: { rounds: { orderBy: { index: "asc" } } } });
  if (!game) throw new Error("Game not found");
  if (!token || token !== game.hostToken) throw new Error("Only the host can do that");
  return game;
}

type HostOp = "start" | "reveal" | "next" | "end";

async function revealRound(roundId: string, scoring: "CLOSEST_WITHOUT_OVER" | "CLOSEST") {
  await prisma.$transaction(async (tx) => {
    const round = await tx.gameRound.findUnique({
      where: { id: roundId },
      include: { question: true, guesses: true },
    });
    if (!round || round.revealedAt) return;
    const answer = round.question.sum;
    const winners = new Set(roundWinners(round.guesses, answer, scoring));
    await tx.gameRound.update({
      where: { id: roundId },
      data: {
        revealedAt: new Date(),
        answerSum: answer,
        answered: round.question.answered,
        skipped: round.question.skipped,
      },
    });
    if (winners.size > 0)
      await tx.guess.updateMany({ where: { roundId, playerId: { in: [...winners] } }, data: { points: 1 } });
  });
}

export async function hostAction(code: string, op: HostOp): Promise<ActionState> {
  try {
    const game = await requireHost(code);
    const current = game.rounds[game.currentRound];
    switch (op) {
      case "start":
        if (game.status !== "LOBBY") throw new Error("Already started");
        await prisma.game.update({ where: { id: game.id }, data: { status: "PLAYING", currentRound: 0 } });
        break;
      case "reveal":
        if (game.status !== "PLAYING" || !current) throw new Error("No round in progress");
        await revealRound(current.id, game.scoring);
        break;
      case "next": {
        if (game.status !== "PLAYING" || !current) throw new Error("No round in progress");
        if (!current.revealedAt) throw new Error("Reveal the answer first");
        const isLast = game.currentRound >= game.rounds.length - 1;
        await prisma.game.update({
          where: { id: game.id },
          data: isLast ? { status: "FINISHED", currentRound: game.rounds.length } : { currentRound: { increment: 1 } },
        });
        break;
      }
      case "end":
        await prisma.game.update({ where: { id: game.id }, data: { status: "FINISHED", currentRound: game.rounds.length } });
        break;
    }
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function submitGuess(code: string, value: number): Promise<ActionState> {
  try {
    const parsed = numberField.safeParse(value);
    if (!parsed.success) throw new Error("Enter a number");
    const token = (await cookies()).get(playerCookie(code))?.value;
    if (!token) throw new Error("Join the game first");
    const game = await prisma.game.findUnique({
      where: { code },
      include: { rounds: { orderBy: { index: "asc" } }, players: { select: { id: true, token: true } } },
    });
    if (!game) throw new Error("Game not found");
    const me = game.players.find((p) => p.token === token);
    if (!me) throw new Error("You're not in this game");
    const round = game.rounds[game.currentRound];
    if (game.status !== "PLAYING" || !round) throw new Error("No round in progress");
    if (round.revealedAt) throw new Error("This round is already revealed");
    await prisma.guess.upsert({
      where: { roundId_playerId: { roundId: round.id, playerId: me.id } },
      create: { roundId: round.id, playerId: me.id, value: parsed.data },
      update: { value: parsed.data },
    });
    const guessed = await prisma.guess.count({ where: { roundId: round.id } });
    if (guessed >= game.players.length) await revealRound(round.id, game.scoring);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
