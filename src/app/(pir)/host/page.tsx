import { prisma } from "@/lib/db";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { createGame, createQuestion, deleteQuestion, updateQuestion } from "@/lib/game-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";
import Link from "next/link";

export const metadata = { title: "Host — Price Is Right" };

export default async function HostPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the game.</p>;
  if (!(await hasAccess("host")))
    return (
      <PasswordGate
        role="host"
        next="/host"
        title="Host"
        blurb="Enter the host password to manage questions and start games."
      />
    );

  const [questions, games] = await Promise.all([
    prisma.question.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }] }),
    prisma.game.findMany({
      where: { status: { not: "FINISHED" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { code: true, status: true, createdAt: true, _count: { select: { players: true, rounds: true } } },
    }),
  ]);
  const active = questions.filter((q) => q.active);
  const archived = questions.filter((q) => !q.active);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="page-title">Host</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage questions and run games. You can see how many people answered each question, but never the totals —
          those are only revealed during a game.
        </p>
      </div>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="section-title">New question</h2>
          <ActionForm action={createQuestion} className="space-y-3" successMessage="Added.">
            <input className="input" name="prompt" placeholder="How many siblings do you have?" required minLength={3} maxLength={300} />
            <input className="input" name="unit" placeholder="Unit (optional, e.g. siblings, $, miles)" maxLength={40} />
            <button className="btn">Add question</button>
          </ActionForm>
          <p className="text-xs text-zinc-500">Answers must be numbers — they’re summed across everyone who answers.</p>
        </div>

        <div className="card space-y-3">
          <h2 className="section-title">Start a game</h2>
          {active.length === 0 ? (
            <p className="text-sm text-zinc-500">Add a question first.</p>
          ) : (
            <ActionForm action={createGame} className="space-y-3">
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
                {active.map((q) => (
                  <li key={q.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-white/5">
                      <input type="checkbox" name="questionId" value={q.id} defaultChecked={q.answered > 0} className="mt-1 size-4 accent-rose-400" />
                      <span className="flex-1 text-zinc-200">{q.prompt}</span>
                      <span className="pill shrink-0 bg-white/5 font-mono text-zinc-400">{q.answered} ans</span>
                    </label>
                  </li>
                ))}
              </ul>
              <select name="scoring" className="input">
                <option value="CLOSEST_WITHOUT_OVER">Closest without going over (Price Is Right rules)</option>
                <option value="CLOSEST">Closest guess wins</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" name="shuffle" className="size-4 accent-rose-400" /> Shuffle question order
              </label>
              <button className="btn w-full">Create game</button>
            </ActionForm>
          )}
          {games.length > 0 && (
            <div className="border-t border-white/5 pt-3">
              <p className="section-title mb-2">Open games</p>
              <ul className="space-y-1 text-sm">
                {games.map((g) => (
                  <li key={g.code} className="flex items-center gap-2">
                    <Link href={`/game/${g.code}`} className="font-mono text-amber-300 hover:underline">
                      {g.code}
                    </Link>
                    <span className="text-zinc-500">
                      {g.status === "LOBBY" ? "lobby" : "playing"} · {g._count.players} players · {g._count.rounds} questions
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">Questions ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-zinc-500">None yet.</p>}
        <ul className="space-y-2">
          {active.map((q) => (
            <QuestionRow key={q.id} q={q} />
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Archived ({archived.length})</h2>
          <ul className="space-y-2">
            {archived.map((q) => (
              <QuestionRow key={q.id} q={q} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuestionRow({ q }: { q: { id: string; prompt: string; unit: string | null; active: boolean; answered: number; skipped: number } }) {
  return (
    <li className={`card flex flex-wrap items-center gap-3 text-sm ${q.active ? "" : "opacity-60"}`}>
      <div className="flex-1">
        <p className="font-medium text-zinc-100">{q.prompt}</p>
        <p className="text-xs text-zinc-500">
          {q.unit && <span className="mr-2">unit: {q.unit}</span>}
          {q.answered} answered · {q.skipped} preferred not to answer
        </p>
      </div>
      <ActionForm action={updateQuestion} className="contents">
        <input type="hidden" name="id" value={q.id} />
        <button className="btn-ghost px-2.5 py-1 text-xs" name="op" value={q.active ? "archive" : "restore"}>
          {q.active ? "Archive" : "Restore"}
        </button>
        <button className="btn-ghost px-2.5 py-1 text-xs text-amber-300" name="op" value="reset">
          Reset totals
        </button>
      </ActionForm>
      <ActionForm action={deleteQuestion} className="contents">
        <input type="hidden" name="id" value={q.id} />
        <button className="btn-ghost px-2.5 py-1 text-xs text-red-300">Delete</button>
      </ActionForm>
    </li>
  );
}
