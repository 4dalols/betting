import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { placeBet, resolveMarket, voidMarket } from "@/lib/actions";
import { isBettable, outcomeTotals, statusLabel, statusTone } from "@/lib/markets";
import { formatCents } from "@/lib/payout";
import { ActionForm } from "@/components/ActionForm";

export default async function MarketPage({ params }: PageProps<"/markets/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const market = await prisma.market.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true } },
      resolvedBy: { select: { name: true } },
      outcomes: { orderBy: { sortOrder: "asc" } },
      bets: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!market) notFound();

  const { pool, totals } = outcomeTotals(market);
  const s = statusLabel(market);
  const isAdmin = user.role === "ADMIN";
  const isCreator = market.creator.id === user.id;
  const myBets = market.bets.filter((b) => b.userId === user.id);
  const myOutcomeIds = new Set(myBets.map((b) => b.outcomeId));
  const bettable = isBettable(market);
  const canBetMore = bettable && myBets.length + 1 < market.outcomes.length;
  const canResolve = (isCreator && market.status === "OPEN") || isAdmin;
  const canVoid = (isCreator && market.status === "OPEN") || (isAdmin && market.status !== "VOIDED");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start gap-3">
          <h1 className="flex-1 text-2xl font-semibold">{market.question}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[s.tone === "closed" ? "closed" : market.status]}`}>
            {s.text}
          </span>
        </div>
        {market.description && <p className="mt-2 whitespace-pre-wrap text-zinc-400">{market.description}</p>}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
          <span>by {market.creator.name ?? "someone"}</span>
          <span>stake {formatCents(market.stakeCents)}</span>
          <span>pool {formatCents(pool)}</span>
          <span>{market.closesAt ? `closes ${market.closesAt.toLocaleString()}` : "no deadline"}</span>
          {market.status === "RESOLVED" && (
            <span>
              resolved by {market.resolvedBy?.name ?? "?"} on {market.resolvedAt?.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {market.outcomes.map((o) => {
          const t = totals.get(o.id) ?? 0;
          const won = market.resolvedOutcomeId === o.id;
          const mine = myOutcomeIds.has(o.id);
          const bettors = market.bets.filter((b) => b.outcomeId === o.id);
          return (
            <div key={o.id} className={`card ${won ? "border-sky-500" : mine ? "border-zinc-500" : ""}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">
                  {o.label} {won && <span className="text-sky-300">· winner</span>}
                </h3>
                <span className="font-mono text-sm text-zinc-300">{formatCents(t)}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {bettors.length} bet{bettors.length === 1 ? "" : "s"}
                {t > 0 && ` · pays ${(pool / t).toFixed(2)}x if it wins`}
                {t === 0 && pool > 0 && ` · would take the whole pool`}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1">
                {bettors.map((b) => (
                  <li
                    key={b.id}
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      b.userId === user.id ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {b.user.name ?? "?"}
                  </li>
                ))}
              </ul>
              {canBetMore && !mine && (
                <ActionForm action={placeBet} className="mt-3">
                  <input type="hidden" name="marketId" value={market.id} />
                  <input type="hidden" name="outcomeId" value={o.id} />
                  <button className="btn w-full">Bet {formatCents(market.stakeCents)} on {o.label}</button>
                </ActionForm>
              )}
              {mine && <p className="mt-3 text-xs text-zinc-400">You bet {formatCents(market.stakeCents)} here.</p>}
            </div>
          );
        })}
      </section>

      {bettable && !canBetMore && myBets.length > 0 && (
        <p className="text-sm text-zinc-500">You&apos;ve bet on as many outcomes as allowed for this market.</p>
      )}

      {(canResolve || canVoid) && (
        <section className="card space-y-3">
          <h2 className="font-medium">
            {isAdmin && !isCreator ? "Admin controls" : "Market maker controls"}
          </h2>
          {market.status === "RESOLVED" && isAdmin && (
            <p className="text-xs text-amber-300">
              Re-resolving reverses the previous payouts and pays out for the new outcome.
            </p>
          )}
          {canResolve && (
            <ActionForm action={resolveMarket} className="flex flex-wrap items-end gap-2" successMessage="Resolved and paid out.">
              <input type="hidden" name="marketId" value={market.id} />
              <label className="flex-1">
                <span className="mb-1 block text-xs text-zinc-400">Winning outcome</span>
                <select name="outcomeId" className="input" defaultValue={market.resolvedOutcomeId ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {market.outcomes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn">{market.status === "RESOLVED" ? "Override outcome" : "Resolve"}</button>
            </ActionForm>
          )}
          {canVoid && (
            <ActionForm action={voidMarket} successMessage="Voided; all stakes refunded.">
              <input type="hidden" name="marketId" value={market.id} />
              <button className="btn-ghost">Void market (refund everyone)</button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
