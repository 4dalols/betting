import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listMarkets, outcomeTotals, statusLabel, statusTone } from "@/lib/markets";
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
      <div className="mb-6 flex items-center gap-2">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/" : `/?filter=${f.key}`}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f.key ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <Link href="/markets/new" className="btn ml-auto">
          + New market
        </Link>
      </div>

      {markets.length === 0 && (
        <p className="text-zinc-500">No markets here yet.</p>
      )}

      <ul className="space-y-3">
        {markets.map((m) => {
          const { pool, totals } = outcomeTotals(m);
          const s = statusLabel(m);
          const myOutcomes = new Set(m.bets.filter((b) => b.userId === user.id).map((b) => b.outcomeId));
          return (
            <li key={m.id} className="card hover:border-zinc-600">
              <Link href={`/markets/${m.id}`} className="block">
                <div className="flex items-start gap-3">
                  <h2 className="flex-1 font-medium">{m.question}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[s.tone === "closed" ? "closed" : m.status]}`}>
                    {s.text}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>by {m.creator.name ?? "someone"}</span>
                  <span>stake {formatCents(m.stakeCents)}</span>
                  <span>pool {formatCents(pool)}</span>
                  {m.closesAt && <span>closes {m.closesAt.toLocaleString()}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.outcomes.map((o) => {
                    const t = totals.get(o.id) ?? 0;
                    const won = m.resolvedOutcomeId === o.id;
                    return (
                      <span
                        key={o.id}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          won
                            ? "border-sky-500 text-sky-300"
                            : myOutcomes.has(o.id)
                              ? "border-zinc-400 text-zinc-100"
                              : "border-zinc-800 text-zinc-400"
                        }`}
                      >
                        {o.label} · {formatCents(t)}
                        {pool > 0 && t > 0 && <span className="text-zinc-500"> · {(pool / t).toFixed(2)}x</span>}
                      </span>
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
