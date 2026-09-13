import { prisma } from "@/lib/db";
import type { Market, MarketStatus } from "@/generated/prisma/client";

export function isBettable(m: Pick<Market, "status" | "closesAt">, now = new Date()) {
  return m.status === "OPEN" && (!m.closesAt || m.closesAt > now);
}

export function statusLabel(m: Pick<Market, "status" | "closesAt">): {
  text: string;
  tone: "open" | "closed" | "resolved" | "voided";
} {
  if (m.status === "RESOLVED") return { text: "Resolved", tone: "resolved" };
  if (m.status === "VOIDED") return { text: "Voided", tone: "voided" };
  if (m.closesAt && m.closesAt <= new Date()) return { text: "Awaiting resolution", tone: "closed" };
  return { text: "Open", tone: "open" };
}

export const statusTone: Record<MarketStatus | "closed", string> = {
  OPEN: "bg-emerald-500/15 text-emerald-300",
  closed: "bg-amber-500/15 text-amber-300",
  RESOLVED: "bg-sky-500/15 text-sky-300",
  VOIDED: "bg-zinc-500/15 text-zinc-400",
};

export const marketListInclude = {
  creator: { select: { name: true } },
  outcomes: { orderBy: { sortOrder: "asc" as const } },
  bets: { select: { outcomeId: true, userId: true, amountCents: true } },
} as const;

export type MarketListItem = Awaited<ReturnType<typeof listMarkets>>[number];

export async function listMarkets(filter: "all" | "mine" | "bet", userId: string) {
  return prisma.market.findMany({
    where:
      filter === "mine"
        ? { creatorId: userId }
        : filter === "bet"
          ? { bets: { some: { userId } } }
          : {},
    include: marketListInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export function outcomeTotals(m: { outcomes: { id: string }[]; bets: { outcomeId: string; amountCents: number }[] }) {
  const pool = m.bets.reduce((s, b) => s + b.amountCents, 0);
  const totals = new Map<string, number>();
  for (const o of m.outcomes) totals.set(o.id, 0);
  for (const b of m.bets) totals.set(b.outcomeId, (totals.get(b.outcomeId) ?? 0) + b.amountCents);
  return { pool, totals };
}
