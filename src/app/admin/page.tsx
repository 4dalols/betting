import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adminAdjust, handlePayment } from "@/lib/actions";
import { formatCents } from "@/lib/payout";
import { ActionForm } from "@/components/ActionForm";

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");

  const [pending, users, totals] = await Promise.all([
    prisma.paymentRequest.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { name: true, email: true, balanceCents: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.user.aggregate({ _sum: { balanceCents: true } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Admin</h1>
        <p className="text-sm text-zinc-400">
          Total paper money outstanding: <span className="font-mono text-zinc-100">{formatCents(totals._sum.balanceCents ?? 0)}</span>
        </p>
      </div>

      <section>
        <h2 className="section-title mb-3">Pending payment requests ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-zinc-500">Nothing pending.</p>}
        <ul className="space-y-2">
          {pending.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center gap-3 text-sm">
              <div className="flex-1">
                <div>
                  <span className="font-medium">{r.user.name}</span>{" "}
                  <span className="text-zinc-500">({r.user.email}, balance {formatCents(r.user.balanceCents)})</span>
                </div>
                <div className="text-zinc-400">
                  {r.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"} of{" "}
                  <span className="font-mono text-zinc-100">{formatCents(r.amountCents)}</span> via {r.method}
                  {r.note && <span> · “{r.note}”</span>}
                  <span className="text-zinc-600"> · {r.createdAt.toLocaleString()}</span>
                </div>
              </div>
              <ActionForm action={handlePayment} className="flex gap-2">
                <input type="hidden" name="id" value={r.id} />
                <button name="decision" value="approve" className="btn">
                  Approve
                </button>
                <button name="decision" value="reject" className="btn-ghost">
                  Reject
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-title mb-3">Users &amp; balance adjustments</h2>
        <ul className="divide-y divide-zinc-800">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="w-56">
                <div className="font-medium">
                  {u.name} {u.role === "ADMIN" && <span className="text-xs text-amber-400">admin</span>}
                </div>
                <div className="text-xs text-zinc-500">{u.email}</div>
              </div>
              <span className={`w-24 font-mono ${u.balanceCents < 0 ? "text-red-300" : ""}`}>{formatCents(u.balanceCents)}</span>
              <ActionForm action={adminAdjust} className="flex flex-1 gap-2" successMessage="Adjusted.">
                <input type="hidden" name="userId" value={u.id} />
                <input name="amount" type="number" step="0.01" required className="input w-28" placeholder="±10.00" />
                <input name="note" className="input flex-1" placeholder="Reason" />
                <button className="btn-ghost">Apply</button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
