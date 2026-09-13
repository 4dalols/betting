"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { computePayouts, parseDollars } from "@/lib/payout";
import type { LedgerType, PaymentKind } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";

export type ActionState = { error?: string; ok?: boolean };

type Tx = Prisma.TransactionClient;

async function credit(
  tx: Tx,
  userId: string,
  deltaCents: number,
  type: LedgerType,
  extra: { marketId?: string; note?: string } = {},
) {
  await tx.user.update({ where: { id: userId }, data: { balanceCents: { increment: deltaCents } } });
  await tx.ledgerEntry.create({ data: { userId, deltaCents, type, ...extra } });
}

/** Atomically debit; fails if the balance would go negative. */
async function debit(
  tx: Tx,
  userId: string,
  amountCents: number,
  type: LedgerType,
  extra: { marketId?: string; note?: string } = {},
) {
  const res = await tx.user.updateMany({
    where: { id: userId, balanceCents: { gte: amountCents } },
    data: { balanceCents: { decrement: amountCents } },
  });
  if (res.count !== 1) throw new Error("Insufficient balance");
  await tx.ledgerEntry.create({ data: { userId, deltaCents: -amountCents, type, ...extra } });
}

function fail(e: unknown): ActionState {
  return { error: e instanceof Error ? e.message : "Something went wrong" };
}

// ---------- Markets ----------

const createMarketSchema = z.object({
  question: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(["BINARY", "MULTI"]),
  stake: z.string(),
  closesAt: z.string().optional(),
  outcomes: z.array(z.string().trim().min(1).max(60)).min(2).max(12),
});

export async function createMarket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let marketId: string;
  try {
    const user = await requireUser();
    const raw = {
      question: formData.get("question"),
      description: formData.get("description") || undefined,
      type: formData.get("type"),
      stake: formData.get("stake"),
      closesAt: formData.get("closesAt") || undefined,
      outcomes:
        formData.get("type") === "BINARY"
          ? [formData.get("yesLabel") || "Yes", formData.get("noLabel") || "No"]
          : formData.getAll("outcomes").filter((o) => String(o).trim() !== ""),
    };
    const parsed = createMarketSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const d = parsed.data;
    const stakeCents = parseDollars(d.stake);
    if (!stakeCents) return { error: "Stake must be a positive dollar amount" };
    if (new Set(d.outcomes.map((o) => o.toLowerCase())).size !== d.outcomes.length)
      return { error: "Outcomes must be distinct" };
    const closesAt = d.closesAt ? new Date(d.closesAt) : null;
    if (closesAt && (isNaN(closesAt.getTime()) || closesAt <= new Date()))
      return { error: "Deadline must be in the future" };

    const market = await prisma.market.create({
      data: {
        question: d.question,
        description: d.description,
        type: d.type,
        stakeCents,
        closesAt,
        creatorId: user.id,
        outcomes: { create: d.outcomes.map((label, i) => ({ label, sortOrder: i })) },
      },
    });
    marketId = market.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  redirect(`/markets/${marketId}`);
}

export async function placeBet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const marketId = String(formData.get("marketId"));
    const outcomeId = String(formData.get("outcomeId"));

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true, bets: { where: { userId: user.id } } },
      });
      if (!market) throw new Error("Market not found");
      if (market.status !== "OPEN") throw new Error("Market is closed");
      if (market.closesAt && market.closesAt <= new Date()) throw new Error("Betting deadline has passed");
      if (!market.outcomes.some((o) => o.id === outcomeId)) throw new Error("Invalid outcome");
      if (market.bets.some((b) => b.outcomeId === outcomeId)) throw new Error("You already bet on this outcome");
      if (market.bets.length + 1 >= market.outcomes.length)
        throw new Error("You can't bet on every outcome");

      await debit(tx, user.id, market.stakeCents, "BET", { marketId, note: market.question });
      await tx.bet.create({
        data: { marketId, outcomeId, userId: user.id, amountCents: market.stakeCents },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  revalidatePath("/account");
  return { ok: true };
}

async function reverseMarketPayouts(tx: Tx, marketId: string) {
  const prior = await tx.ledgerEntry.findMany({
    where: { marketId, type: { in: ["PAYOUT", "REFUND"] }, reversed: false },
  });
  if (prior.length === 0) return;
  await tx.ledgerEntry.updateMany({
    where: { id: { in: prior.map((p) => p.id) } },
    data: { reversed: true },
  });
  for (const p of prior) {
    // Force the balance down even if the user has since spent it; admins can fix negatives.
    await tx.user.update({
      where: { id: p.userId },
      data: { balanceCents: { decrement: p.deltaCents } },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: p.userId,
        deltaCents: -p.deltaCents,
        type: "ADMIN_ADJUST",
        marketId,
        note: `Reversed ${p.type.toLowerCase()} after outcome override`,
      },
    });
  }
}

export async function resolveMarket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const marketId = String(formData.get("marketId"));
    const outcomeId = String(formData.get("outcomeId"));
    const isAdmin = user.role === "ADMIN";

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true, bets: true },
      });
      if (!market) throw new Error("Market not found");
      if (!isAdmin && market.creatorId !== user.id) throw new Error("Only the market maker can resolve");
      if (!isAdmin && market.status !== "OPEN") throw new Error("Market already resolved; ask the admin to override");
      const outcome = market.outcomes.find((o) => o.id === outcomeId);
      if (!outcome) throw new Error("Invalid outcome");

      if (market.status !== "OPEN") await reverseMarketPayouts(tx, marketId);

      const payouts = computePayouts(market.bets, outcomeId);
      if (payouts.length === 0) {
        // Nobody picked the winner: refund all stakes.
        for (const b of market.bets)
          await credit(tx, b.userId, b.amountCents, "REFUND", {
            marketId,
            note: `No winners: ${market.question}`,
          });
      } else {
        for (const p of payouts)
          await credit(tx, p.userId, p.amountCents, "PAYOUT", {
            marketId,
            note: `${outcome.label} — ${market.question}`,
          });
      }
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          resolvedOutcomeId: outcomeId,
          resolvedAt: new Date(),
          resolvedById: user.id,
        },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  revalidatePath("/account");
  return { ok: true };
}

export async function voidMarket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const marketId = String(formData.get("marketId"));
    const isAdmin = user.role === "ADMIN";

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({ where: { id: marketId }, include: { bets: true } });
      if (!market) throw new Error("Market not found");
      if (!isAdmin && market.creatorId !== user.id) throw new Error("Only the market maker can void");
      if (!isAdmin && market.status !== "OPEN") throw new Error("Market already resolved");
      if (market.status === "VOIDED") throw new Error("Already voided");

      if (market.status === "RESOLVED") await reverseMarketPayouts(tx, marketId);
      for (const b of market.bets)
        await credit(tx, b.userId, b.amountCents, "REFUND", {
          marketId,
          note: `Voided: ${market.question}`,
        });
      await tx.market.update({
        where: { id: marketId },
        data: { status: "VOIDED", resolvedOutcomeId: null, resolvedAt: new Date(), resolvedById: user.id },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  revalidatePath("/account");
  return { ok: true };
}

// ---------- Money ----------

export async function requestPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const kind = String(formData.get("kind")) as PaymentKind;
    if (kind !== "DEPOSIT" && kind !== "WITHDRAWAL") return { error: "Invalid kind" };
    const amountCents = parseDollars(String(formData.get("amount")));
    if (!amountCents) return { error: "Enter a positive amount" };
    const method = String(formData.get("method") || "").trim().slice(0, 40);
    if (!method) return { error: "Choose a payment method" };
    const note = String(formData.get("note") || "").trim().slice(0, 500) || null;

    if (kind === "WITHDRAWAL") {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const pending = await prisma.paymentRequest.aggregate({
        where: { userId: user.id, kind: "WITHDRAWAL", status: "PENDING" },
        _sum: { amountCents: true },
      });
      if (u.balanceCents - (pending._sum.amountCents ?? 0) < amountCents)
        return { error: "Insufficient balance (including pending withdrawals)" };
    }

    await prisma.paymentRequest.create({ data: { userId: user.id, kind, amountCents, method, note } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/account");
  revalidatePath("/admin");
  return { ok: true };
}

export async function handlePayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const admin = await requireAdmin();
    const id = String(formData.get("id"));
    const approve = formData.get("decision") === "approve";

    await prisma.$transaction(async (tx) => {
      const req = await tx.paymentRequest.findUnique({ where: { id } });
      if (!req || req.status !== "PENDING") throw new Error("Request not pending");
      if (approve) {
        const note = `${req.method}${req.note ? `: ${req.note}` : ""}`;
        if (req.kind === "DEPOSIT") await credit(tx, req.userId, req.amountCents, "DEPOSIT", { note });
        else await debit(tx, req.userId, req.amountCents, "WITHDRAWAL", { note });
      }
      await tx.paymentRequest.update({
        where: { id },
        data: { status: approve ? "APPROVED" : "REJECTED", handledById: admin.id, handledAt: new Date() },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin");
  revalidatePath("/account");
  return { ok: true };
}

export async function adminAdjust(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const userId = String(formData.get("userId"));
    const dollars = Number(formData.get("amount"));
    if (!Number.isFinite(dollars) || dollars === 0) return { error: "Enter a non-zero amount" };
    const deltaCents = Math.round(dollars * 100);
    const note = String(formData.get("note") || "").trim().slice(0, 500) || "Admin adjustment";
    await prisma.$transaction((tx) => credit(tx, userId, deltaCents, "ADMIN_ADJUST", { note }));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin");
  revalidatePath("/account");
  return { ok: true };
}
