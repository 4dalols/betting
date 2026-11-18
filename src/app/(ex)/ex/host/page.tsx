import Link from "next/link";
import { prisma } from "@/lib/db";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { createExGame } from "@/lib/ex-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Host — Exchange" };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export default async function ExHostPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
  if (!(await hasAccess("host")))
    return <PasswordGate role="host" next="/ex/host" title="Host" blurb="Enter the host password to create Exchange games." />;

  const games = await prisma.exGame.findMany({
    where: { status: { not: "FINISHED" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { code: true, status: true, _count: { select: { players: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Host an Exchange</h1>
        <p className="mt-1 text-sm text-zinc-500">
          One contract against a lagging market maker and customer flow, as in Mangocore&apos;s preliminary case. Create
          the game and share the code. You start the case from the game screen; it ends itself
          at the bell.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <ActionForm action={createExGame} className="card space-y-6 md:col-span-2">
          <section className="space-y-3">
            <h2 className="section-title">Case</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Length (seconds)">
                <input className="input" name="caseSecs" type="number" min={60} max={3600} defaultValue={600} required />
              </Field>
              <Field label="Fair-value step (seconds)" hint="Fair moves by up to ±5 once per step">
                <input className="input" name="stepSecs" type="number" min={5} max={600} defaultValue={60} required />
              </Field>
              <Field label="Customer orders per second" hint="10 lots each, within 5 of fair">
                <input className="input" name="customerRate" type="number" min={0} max={20} defaultValue={10} required />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Limits</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Risk limit" hint="Long and short each, incl. open orders">
                <input className="input" name="positionLimit" type="number" min={10} max={1000000} defaultValue={1000000} required />
              </Field>
              <Field label="Max order size">
                <input className="input" name="maxOrderSize" type="number" min={1} max={1000} defaultValue={1000} required />
              </Field>
              <Field label="Max open orders">
                <input className="input" name="maxOpenOrders" type="number" min={1} max={200} defaultValue={100} required />
              </Field>
            </div>
          </section>

          <button className="btn w-full">Create game</button>
        </ActionForm>

        <div className="card h-fit space-y-3">
          <h2 className="section-title">Open games</h2>
          {games.length === 0 ? (
            <p className="text-sm text-zinc-500">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {games.map((g) => (
                <li key={g.code} className="flex items-center gap-2">
                  <Link href={`/ex/${g.code}`} className="font-mono text-sky-300 hover:underline">
                    {g.code}
                  </Link>
                  <span className="text-zinc-500">
                    {g.status === "LOBBY" ? "lobby" : "playing"} · {g._count.players} players
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
