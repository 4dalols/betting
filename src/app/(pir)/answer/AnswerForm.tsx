"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions";

type Q = { id: string; prompt: string; unit: string | null };

export function AnswerForm({
  action,
  questions,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  questions: Q[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={pending} className="contents">
        {questions.map((q, i) => {
          const skip = skipped[q.id] ?? false;
          return (
            <div key={q.id} className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="pill mt-0.5 bg-white/5 font-mono text-zinc-400">{i + 1}</span>
                <p className="text-base font-medium text-zinc-100">{q.prompt}</p>
              </div>
              <input type="hidden" name={`mode_${q.id}`} value={skip ? "skip" : "answer"} />
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-40">
                  <input
                    className="input"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    name={`value_${q.id}`}
                    placeholder={skip ? "Skipped" : "Your answer"}
                    disabled={skip}
                    required={!skip}
                  />
                  {q.unit && !skip && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-500">
                      {q.unit}
                    </span>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    className="size-4 accent-rose-400"
                    checked={skip}
                    onChange={(e) => setSkipped((s) => ({ ...s, [q.id]: e.target.checked }))}
                  />
                  Prefer not to answer
                </label>
              </div>
            </div>
          );
        })}
        <button className="btn w-full" type="submit">
          {pending ? "Submitting…" : `Submit ${questions.length} answer${questions.length === 1 ? "" : "s"}`}
        </button>
      </fieldset>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <p className="text-center text-xs text-zinc-600">Submitting is final — totals can’t be un-added.</p>
    </form>
  );
}
