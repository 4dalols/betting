import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addComment, placeBet, resolveMarket, voidMarket } from "@/lib/actions";
import { isBettable, liquidPrices, outcomeTotals, statusLabel, statusTone, typeLabel } from "@/lib/markets";
import { formatCents } from "@/lib/payout";
import { ActionForm } from "@/components/ActionForm";
import { BuyShares } from "@/components/BuyShares";

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
      comments: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!market) notFound();

  const { pool: spent, totals } = outcomeTotals(market);
  const isLiquid = market.type === "LIQUID";
  const isFlip = market.type === "FLIP";
  const pool = spent + (isLiquid ? (market.liquidityCents ?? 0) : 0);
  const { b, price } = isLiquid ? liquidPrices(market) : { b: 0, price: new Map<string, number>() };
  const q = market.outcomes.map((o) => o.shares);
  const s = statusLabel(market);
  const isAdmin = user.role === "ADMIN";
  const isCreator = market.creator.id === user.id;
  const myBets = market.bets.filter((b) => b.userId === user.id);
  const myOutcomeIds = new Set(myBets.map((b) => b.outcomeId));
  const bettable = isBettable(market);
  const flipFilled = isFlip && market.bets.length >= 2;
  const canBetMore =
    bettable &&
    !isLiquid &&
    myBets.length + 1 < market.outcomes.length &&
    (!isFlip || (!isCreator && !flipFilled));
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
          <span>{typeLabel[market.type]}</span>
          {isLiquid ? (
            <span>liquidity {formatCents(market.liquidityCents ?? 0)}</span>
          ) : (
            <span>stake {formatCents(market.stakeCents)}</span>
          )}
          <span>{isLiquid ? "volume" : "pool"} {formatCents(spent)}</span>
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
          const p = price.get(o.id) ?? 0;
          return (
            <div key={o.id} className={`card ${won ? "border-sky-500" : mine ? "border-zinc-500" : ""}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">
                  {o.label} {won && <span className="text-sky-300">· winner</span>}
                </h3>
                <span className="font-mono text-sm text-zinc-300">
                  {isLiquid ? `${Math.round(p * 100)}%` : formatCents(t)}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {isLiquid ? (
                  <>
                    {formatCents(o.shares)} in shares held · {formatCents(t)} spent
                  </>
                ) : (
                  <>
                    {bettors.length} bet{bettors.length === 1 ? "" : "s"}
                    {t > 0 && ` · pays ${(pool / t).toFixed(2)}x if it wins`}
                    {t === 0 && pool > 0 && ` · would take the whole pool`}
                  </>
                )}
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
                    {isLiquid && ` · ${formatCents(Math.floor(b.shares))}`}
                  </li>
                ))}
              </ul>
              {canBetMore && !mine && (
                <ActionForm action={placeBet} className="mt-3">
                  <input type="hidden" name="marketId" value={market.id} />
                  <input type="hidden" name="outcomeId" value={o.id} />
                  <button className="btn w-full">
                    {isFlip ? "Take" : "Bet"} {formatCents(market.stakeCents)} on {o.label}
                  </button>
                </ActionForm>
              )}
              {isLiquid && bettable && (
                <BuyShares
                  marketId={market.id}
                  outcomeId={o.id}
                  outcomeIndex={market.outcomes.indexOf(o)}
                  label={o.label}
                  q={q}
                  b={b}
                />
              )}
              {mine && !isLiquid && <p className="mt-3 text-xs text-zinc-400">You bet {formatCents(market.stakeCents)} here.</p>}
              {mine && isLiquid && (
                <p className="mt-2 text-xs text-zinc-400">
                  You hold {formatCents(Math.floor(myBets.find((x) => x.outcomeId === o.id)?.shares ?? 0))} in shares here
                  (spent {formatCents(myBets.find((x) => x.outcomeId === o.id)?.amountCents ?? 0)}).
                </p>
              )}
            </div>
          );
        })}
      </section>

      {bettable && !isLiquid && !isFlip && !canBetMore && myBets.length > 0 && (
        <p className="text-sm text-zinc-500">You&apos;ve bet on as many outcomes as allowed for this market.</p>
      )}
      {isFlip && !flipFilled && (
        <p className="text-sm text-zinc-500">
          {isCreator ? "Waiting for someone to take the other side." : "Only one person can take this flip."}
          {" "}If nobody does before it resolves, the stake is refunded.
        </p>
      )}
      {isLiquid && (
        <p className="text-sm text-zinc-500">
          Each share pays $1 if its outcome wins. Prices move as people buy; there&apos;s no selling. The market maker
          funded {formatCents(market.liquidityCents ?? 0)} of liquidity and gets back whatever isn&apos;t paid out.
        </p>
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

      <section className="space-y-3">
        <h2 className="font-medium">Clarifications</h2>
        <p className="text-xs text-zinc-500">
          Ask how edge cases will be resolved before you bet. Answers from the market maker are highlighted.
        </p>
        {market.comments.length > 0 && (
          <ul className="space-y-2">
            {market.comments.map((c) => {
              const fromMaker = c.userId === market.creator.id;
              return (
                <li key={c.id} className={`card py-2 ${fromMaker ? "border-amber-500/60" : ""}`}>
                  <div className="flex items-baseline gap-2 text-xs text-zinc-500">
                    <span className={fromMaker ? "font-medium text-amber-300" : "text-zinc-300"}>
                      {c.user.name ?? "?"}
                      {fromMaker && " · market maker"}
                    </span>
                    <span>{c.createdAt.toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{c.body}</p>
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={addComment} className="flex flex-col gap-2">
          <input type="hidden" name="marketId" value={market.id} />
          <textarea
            name="body"
            className="input min-h-20"
            placeholder={isCreator ? "Clarify how this market resolves…" : "Ask a clarifying question…"}
            maxLength={1000}
            required
          />
          <button className="btn self-end">Post</button>
        </ActionForm>
      </section>
    </div>
  );
}
