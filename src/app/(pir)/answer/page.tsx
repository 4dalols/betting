import { prisma } from "@/lib/db";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { answeredQuestionIds, submitAnswers } from "@/lib/game-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { AnswerForm } from "./AnswerForm";

export const metadata = { title: "Answer the questions — Price Is Right" };

export default async function AnswerPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the game.</p>;
  if (!(await hasAccess("member")))
    return (
      <PasswordGate
        role="member"
        next="/answer"
        title="Group questions"
        blurb="Enter the group password to answer. Your individual answers are never stored — only running totals."
      />
    );

  const [questions, done] = await Promise.all([
    prisma.question.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, prompt: true, unit: true } }),
    answeredQuestionIds(),
  ]);
  const pending = questions.filter((q) => !done.has(q.id));
  const answeredCount = questions.length - pending.length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">Answer the questions</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Answers are summed across the whole group and revealed in the game. Nobody — not even the host — can see what you
          personally said. Choose “Prefer not to answer” to skip a question; we only count that someone skipped.
        </p>
      </div>
      {pending.length === 0 ? (
        <div className="card text-center">
          <p className="text-lg font-medium text-zinc-100">You’re all caught up</p>
          <p className="mt-1 text-sm text-zinc-500">
            {questions.length === 0 ? "No questions yet — check back later." : `You’ve answered all ${questions.length} questions. Come back if new ones are added.`}
          </p>
        </div>
      ) : (
        <>
          {answeredCount > 0 && (
            <p className="text-sm text-zinc-500">
              {pending.length} new question{pending.length === 1 ? "" : "s"} since you last answered.
            </p>
          )}
          <AnswerForm action={submitAnswers} questions={pending} />
        </>
      )}
    </div>
  );
}
