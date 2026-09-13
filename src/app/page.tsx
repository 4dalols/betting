import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { liquidPrices, listMarkets, outcomeTotals, statusLabel, statusTone, typeLabel } from "@/lib/markets";
import { formatCents } from "@/lib/payout";

const filters = [
  { key: "all", label: "All markets" },
  { key: "bet", label: "My bets" },
  { key: "mine", label: "Created by me" },
] as const;

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = filters.some((f) => f.key === sp.filter) ? (sp.filter as "all" | "bet" | "mine") : "all";
  const markets = await listMarkets(filter, user.id);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Markets</h1>
          <p className="mt-1 text-sm text-zinc-500">Paper-money predictions among friends.</p>
        </div>
        <Link href="/markets/new" className="btn">
          <span aria-hidden>+</span> New market
        </Link>
      </div>
      <div className="mb-5 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1 text-sm">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/" : `/?filter=${f.key}`}
            className={`rounded-full px-3 py-1 transition ${
              filter === f.key ? "bg-zinc-100 font-medium text-zinc-900 shadow" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {markets.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-zinc-400">No markets here yet.</p>
          <Link href="/markets/new" className="btn-ghost">
            Create the first one
          </Link>
        </div>
      )}

      <ul className="space-y-3">
        {markets.map((m) => {
          const { pool, totals } = outcomeTotals(m);
          const isLiquid = m.type === "LIQUID";
          const price = isLiquid ? liquidPrices(m).price : null;
          const s = statusLabel(m);
          const myOutcomes = new Set(m.bets.filter((b) => b.userId === user.id).map((b) => b.outcomeId));
          return (
            <li key={m.id} className="card group hover:-translate-y-0.5 hover:border-white/20 hover:bg-zinc-900/80">
              <Link href={`/markets/${m.id}`} className="block">
                <div className="flex items-start gap-3">
                  <h2 className="flex-1 text-base font-medium leading-snug text-zinc-50 group-hover:text-white sm:text-lg">
                    {m.question}
                  </h2>
                  <span className={`pill ${statusTone[s.tone === "closed" ? "closed" : m.status]}`}>
                    {s.text}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>by {m.creator.name ?? "someone"}</span>
                  <span>{typeLabel[m.type]}</span>
                  {isLiquid ? (
                    <span>volume {formatCents(pool)}</span>
                  ) : (
                    <>
                      <span>stake {formatCents(m.stakeCents)}</span>
                      <span>pool {formatCents(pool)}</span>
                    </>
                  )}
                  {m.type === "FLIP" && m.status === "OPEN" && m.bets.length < 2 && <span className="text-amber-300">needs a taker</span>}
                  {m.closesAt && <span>closes {m.closesAt.toLocaleString()}</span>}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {m.outcomes.map((o) => {
                    const t = totals.get(o.id) ?? 0;
                    const won = m.resolvedOutcomeId === o.id;
                    const mine = myOutcomes.has(o.id);
                    const share = price ? (price.get(o.id) ?? 0) : pool > 0 ? t / pool : 0;
                    return (
                      <div
                        key={o.id}
                        className={`relative overflow-hidden rounded-lg border px-3 py-1.5 text-xs ${
                          won
                            ? "border-sky-500/60 text-sky-200"
                            : mine
                              ? "border-accent-500/50 text-zinc-100"
                              : "border-white/5 text-zinc-400"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute inset-y-0 left-0 ${
                            won ? "bg-sky-500/20" : mine ? "bg-accent-500/15" : "bg-white/[0.06]"
                          }`}
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                        <span className="relative flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{o.label}</span>
                          <span className="shrink-0 font-mono">
                            {price ? `${Math.round(share * 100)}%` : formatCents(t)}
                            {!price && pool > 0 && t > 0 && <span className="text-zinc-500"> · {(pool / t).toFixed(2)}x</span>}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
