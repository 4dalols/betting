import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requestPayment } from "@/lib/actions";
import { formatCents } from "@/lib/payout";
import { ActionForm } from "@/components/ActionForm";

const paymentMethods = ["Zelle", "Venmo", "Cash", "Other"];

export default async function AccountPage() {
  const user = await requireUser();
  const [me, ledger, requests] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    prisma.ledgerEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.paymentRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const adminHandle = process.env.ADMIN_PAYMENT_HANDLE;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{me.name}</h1>
        <p className="text-zinc-400">{me.email}</p>
        <p className="mt-4 text-4xl font-mono">{formatCents(me.balanceCents)}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        {(["DEPOSIT", "WITHDRAWAL"] as const).map((kind) => (
          <ActionForm
            key={kind}
            action={requestPayment}
            className="card space-y-3"
            successMessage="Request sent — the admin will confirm it."
          >
            <h2 className="font-medium">{kind === "DEPOSIT" ? "Deposit" : "Withdraw"}</h2>
            <p className="text-xs text-zinc-500">
              {kind === "DEPOSIT"
                ? `Send the money${adminHandle ? ` to ${adminHandle}` : " to the admin"}, then log it here. Your balance updates once confirmed.`
                : "Request a payout. The admin sends it to you and deducts it from your balance."}
            </p>
            <input type="hidden" name="kind" value={kind} />
            <div className="flex gap-2">
              <input name="amount" type="number" min="0.01" step="0.01" required className="input" placeholder="20.00" />
              <select name="method" className="input w-32">
                {paymentMethods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <input name="note" className="input" placeholder={kind === "DEPOSIT" ? "e.g. sent from @handle" : "e.g. send to @handle"} />
            <button className="btn w-full">Submit {kind === "DEPOSIT" ? "deposit" : "withdrawal"} request</button>
          </ActionForm>
        ))}
      </section>

      {requests.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Payment requests</h2>
          <ul className="divide-y divide-zinc-800 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span className="w-24 text-zinc-400">{r.kind === "DEPOSIT" ? "Deposit" : "Withdrawal"}</span>
                <span className="font-mono">{formatCents(r.amountCents)}</span>
                <span className="text-zinc-500">{r.method}{r.note ? ` · ${r.note}` : ""}</span>
                <span
                  className={`ml-auto text-xs ${
                    r.status === "PENDING" ? "text-amber-300" : r.status === "APPROVED" ? "text-emerald-300" : "text-red-400"
                  }`}
                >
                  {r.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium">History</h2>
        {ledger.length === 0 && <p className="text-sm text-zinc-500">Nothing yet.</p>}
        <ul className="divide-y divide-zinc-800 text-sm">
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-36 shrink-0 text-xs text-zinc-500">{e.createdAt.toLocaleString()}</span>
              <span className="w-28 shrink-0 text-zinc-400">{e.type.toLowerCase().replace("_", " ")}</span>
              <span className="truncate text-zinc-300">
                {e.marketId ? (
                  <Link href={`/markets/${e.marketId}`} className="hover:underline">
                    {e.note}
                  </Link>
                ) : (
                  e.note
                )}
              </span>
              <span className={`ml-auto font-mono ${e.deltaCents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {e.deltaCents >= 0 ? "+" : ""}
                {formatCents(e.deltaCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
