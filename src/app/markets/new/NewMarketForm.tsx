"use client";

import { useActionState, useState } from "react";
import { createMarket } from "@/lib/actions";

export function NewMarketForm() {
  const [state, formAction, pending] = useActionState(createMarket, {});
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"BINARY" | "MULTI">("BINARY");
  const [yesLabel, setYesLabel] = useState("Yes");
  const [noLabel, setNoLabel] = useState("No");
  const [outcomes, setOutcomes] = useState(["", "", ""]);
  const [stake, setStake] = useState("");
  const [hasDeadline, setHasDeadline] = useState(true);
  const [closesLocal, setClosesLocal] = useState("");
  const closesIso = closesLocal ? new Date(closesLocal).toISOString() : "";

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={pending} className="contents">
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Question</span>
          <input
            name="question"
            required
            className="input"
            placeholder="Will it rain on Saturday?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Details (optional)</span>
          <textarea
            name="description"
            rows={3}
            className="input"
            placeholder="How this resolves, sources, etc."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div>
          <span className="mb-1 block text-sm text-zinc-400">Type</span>
          <div className="flex gap-2">
            {(["BINARY", "MULTI"] as const).map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                  type === t ? "border-zinc-300 bg-zinc-800" : "border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={type === t}
                  onChange={() => setType(t)}
                  className="sr-only"
                />
                {t === "BINARY" ? "Yes / No (or Over / Under)" : "Multiple choice"}
              </label>
            ))}
          </div>
        </div>

        {type === "BINARY" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm text-zinc-400">First option</span>
              <input name="yesLabel" className="input" value={yesLabel} onChange={(e) => setYesLabel(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-zinc-400">Second option</span>
              <input name="noLabel" className="input" value={noLabel} onChange={(e) => setNoLabel(e.target.value)} />
            </label>
          </div>
        ) : (
          <div>
            <span className="mb-1 block text-sm text-zinc-400">Choices</span>
            <div className="space-y-2">
              {outcomes.map((value, i) => (
                <input
                  key={i}
                  name="outcomes"
                  className="input"
                  placeholder={`Choice ${i + 1}`}
                  required={i < 2}
                  value={value}
                  onChange={(e) =>
                    setOutcomes((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              ))}
            </div>
            <div className="mt-2 flex gap-2 text-sm">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOutcomes((prev) => (prev.length < 12 ? [...prev, ""] : prev))}
              >
                + Add choice
              </button>
              {outcomes.length > 2 && (
                <button type="button" className="btn-ghost" onClick={() => setOutcomes((prev) => prev.slice(0, -1))}>
                  Remove last
                </button>
              )}
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Stake per bet ($)</span>
          <input
            name="stake"
            type="number"
            min="0.01"
            step="0.01"
            required
            className="input"
            placeholder="5.00"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
          <span className="mt-1 block text-xs text-zinc-500">Everyone bets exactly this amount per choice.</span>
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} />
            Betting deadline
          </label>
          {hasDeadline && (
            <>
              <input
                type="datetime-local"
                required
                className="input mt-2"
                value={closesLocal}
                onChange={(e) => setClosesLocal(e.target.value)}
              />
              <input type="hidden" name="closesAt" value={closesIso} />
            </>
          )}
        </div>

        <button className="btn w-full">{pending ? "Creating…" : "Create market"}</button>
      </fieldset>
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}
    </form>
  );
}
