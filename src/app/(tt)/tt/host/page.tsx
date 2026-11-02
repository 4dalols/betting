import Link from "next/link";
import { prisma } from "@/lib/db";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { createTtGame } from "@/lib/tt-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Host — Trade or Tighten" };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export default async function TtHostPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
  if (!(await hasAccess("host")))
    return <PasswordGate role="host" next="/tt/host" title="Host" blurb="Enter the host password to create Trade or Tighten games." />;

  const games = await prisma.ttGame.findMany({
    where: { status: { not: "FINISHED" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { code: true, status: true, totalRounds: true, _count: { select: { players: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Host Trade or Tighten</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Pick the rules, create the game, and share the code. Timers run themselves; you can skip ahead or end the game
          from the game screen.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <ActionForm action={createTtGame} className="card space-y-6 md:col-span-2">
          <section className="space-y-3">
            <h2 className="section-title">Game</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Rounds">
                <input className="input" name="totalRounds" type="number" min={1} max={20} defaultValue={4} required />
              </Field>
              <Field label="Players per room" hint="Rooms are re-drawn by Elo each round">
                <input className="input" name="roomSize" type="number" min={2} max={12} defaultValue={4} required />
              </Field>
              <Field label="Tighten → trade cycles">
                <input className="input" name="cycles" type="number" min={1} max={10} defaultValue={2} required />
              </Field>
              <Field label="Numbers per contract">
                <input className="input" name="cardsPerRound" type="number" min={1} max={10} defaultValue={4} required />
              </Field>
              <Field label="Distribution">
                <select className="input" name="distribution" defaultValue="SKEWED">
                  <option value="SKEWED">Skewed ⌈100·U²⌉ (mean ≈ 34)</option>
                  <option value="UNIFORM">Uniform 1–100 (mean 50.5)</option>
                </select>
              </Field>
              <Field label="Tighten by at least (%)">
                <input className="input" name="tightenPct" type="number" min={0} max={90} defaultValue={10} required />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Timers (seconds)</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Info auction">
                <input className="input" name="auctionSecs" type="number" min={10} max={600} defaultValue={60} required />
              </Field>
              <Field label="Tighten decision" hint="Restarts on every tighten; also the market maker’s time to quote">
                <input className="input" name="decisionSecs" type="number" min={5} max={300} defaultValue={15} required />
              </Field>
              <Field label="Trading">
                <input className="input" name="tradeSecs" type="number" min={5} max={600} defaultValue={30} required />
              </Field>
              <Field label="Between phases">
                <input className="input" name="breakSecs" type="number" min={0} max={60} defaultValue={5} required />
              </Field>
              <Field label="Between rounds">
                <input className="input" name="roundBreakSecs" type="number" min={0} max={600} defaultValue={20} required />
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
                  <Link href={`/tt/${g.code}`} className="font-mono text-sky-300 hover:underline">
                    {g.code}
                  </Link>
                  <span className="text-zinc-500">
                    {g.status === "LOBBY" ? "lobby" : "playing"} · {g._count.players} players · {g.totalRounds} rounds
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
