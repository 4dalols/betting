import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/payout";

/**
 * PnL = balance + money currently in open markets − net external money
 * (deposits − withdrawals ± manual admin adjustments). Only betting results move it.
 */
const rankTone = ["text-amber-300", "text-zinc-300", "text-orange-400"];

export default async function LeaderboardPage() {
  const me = await requireUser();
  const [users, external, openBets, openLiquidity] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, balanceCents: true } }),
    prisma.ledgerEntry.groupBy({
      by: ["userId"],
      where: { OR: [{ type: { in: ["DEPOSIT", "WITHDRAWAL"] } }, { type: "ADMIN_ADJUST", marketId: null }] },
      _sum: { deltaCents: true },
    }),
    prisma.bet.groupBy({
      by: ["userId"],
      where: { market: { status: "OPEN" } },
      _sum: { amountCents: true },
    }),
    prisma.market.groupBy({
      by: ["creatorId"],
      where: { status: "OPEN", type: "LIQUID" },
      _sum: { liquidityCents: true },
    }),
  ]);

  const ext = new Map(external.map((e) => [e.userId, e._sum.deltaCents ?? 0]));
  const inPlay = new Map<string, number>();
  for (const b of openBets) inPlay.set(b.userId, (inPlay.get(b.userId) ?? 0) + (b._sum.amountCents ?? 0));
  for (const l of openLiquidity)
    inPlay.set(l.creatorId, (inPlay.get(l.creatorId) ?? 0) + (l._sum.liquidityCents ?? 0));

  const rows = users
    .map((u) => {
      const external = ext.get(u.id) ?? 0;
      const playing = inPlay.get(u.id) ?? 0;
      return { ...u, external, playing, pnl: u.balanceCents + playing - external };
    })
    .filter((r) => r.external !== 0 || r.playing !== 0 || r.balanceCents !== 0)
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Leaderboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          PnL = balance + in play − (deposits − withdrawals). Only wins and losses move it.
        </p>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="section-title border-b border-white/10 text-left">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-2 py-3">Name</th>
              <th className="px-2 py-3 text-right">PnL</th>
              <th className="px-2 py-3 text-right">Balance</th>
              <th className="px-2 py-3 text-right">In play</th>
              <th className="px-4 py-3 text-right">Deposited</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r, i) => {
              const isMe = r.id === me.id;
              return (
                <tr
                  key={r.id}
                  className={`transition hover:bg-white/[0.03] ${isMe ? "bg-accent-500/[0.06] text-zinc-50" : "text-zinc-300"}`}
                >
                  <td className={`px-4 py-3 font-mono font-semibold ${rankTone[i] ?? "text-zinc-500"}`}>{i + 1}</td>
                  <td className="px-2 py-3 font-medium">
                    {r.name ?? "?"} {isMe && <span className="ml-1 text-xs font-normal text-accent-300">you</span>}
                  </td>
                  <td
                    className={`px-2 py-3 text-right font-mono font-semibold ${
                      r.pnl > 0 ? "text-emerald-300" : r.pnl < 0 ? "text-red-400" : "text-zinc-400"
                    }`}
                  >
                    {r.pnl > 0 ? "+" : ""}
                    {formatCents(r.pnl)}
                  </td>
                  <td className="px-2 py-3 text-right font-mono">{formatCents(r.balanceCents)}</td>
                  <td className="px-2 py-3 text-right font-mono text-zinc-400">{formatCents(r.playing)}</td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-400">{formatCents(r.external)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  Nobody has deposited yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
