import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/payout";

/**
 * PnL = balance + money currently in open markets − net external money
 * (deposits − withdrawals ± manual admin adjustments). Only betting results move it.
 */
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-zinc-500">
          PnL = balance + in play − (deposits − withdrawals). Only wins and losses move it.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2 text-right">PnL</th>
            <th className="py-1 pr-2 text-right">Balance</th>
            <th className="py-1 pr-2 text-right">In play</th>
            <th className="py-1 text-right">Deposited</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r, i) => (
            <tr key={r.id} className={r.id === me.id ? "text-zinc-100" : "text-zinc-300"}>
              <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
              <td className="py-2 pr-2">
                {r.name ?? "?"} {r.id === me.id && <span className="text-xs text-zinc-500">(you)</span>}
              </td>
              <td
                className={`py-2 pr-2 text-right font-mono ${
                  r.pnl > 0 ? "text-emerald-300" : r.pnl < 0 ? "text-red-400" : ""
                }`}
              >
                {r.pnl > 0 ? "+" : ""}
                {formatCents(r.pnl)}
              </td>
              <td className="py-2 pr-2 text-right font-mono">{formatCents(r.balanceCents)}</td>
              <td className="py-2 pr-2 text-right font-mono">{formatCents(r.playing)}</td>
              <td className="py-2 text-right font-mono">{formatCents(r.external)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Nobody has deposited yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
