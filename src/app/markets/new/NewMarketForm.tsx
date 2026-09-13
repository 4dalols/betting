"use client";

import { useActionState, useState } from "react";
import { createMarket } from "@/lib/actions";

type MarketType = "BINARY" | "MULTI" | "FLIP" | "LIQUID";

const types: { key: MarketType; label: string; hint: string }[] = [
  { key: "BINARY", label: "Yes / No", hint: "Fixed stake per bet; winners split the pool." },
  { key: "MULTI", label: "Multiple choice", hint: "Same as yes/no with more options; bet on several but not all." },
  { key: "FLIP", label: "Flip", hint: "You take one side; exactly one person can take the other. Winner takes both stakes." },
  { key: "LIQUID", label: "Liquid", hint: "You fund liquidity; people buy shares at a moving price (Manifold-style). Shares pay $1 if right." },
];

export function NewMarketForm() {
  const [state, formAction, pending] = useActionState(createMarket, {});
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<MarketType>("BINARY");
  const [yesLabel, setYesLabel] = useState("Yes");
  const [noLabel, setNoLabel] = useState("No");
  const [side, setSide] = useState<"0" | "1">("0");
  const [outcomes, setOutcomes] = useState(["", "", ""]);
  const [stake, setStake] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const twoSided = type === "BINARY" || type === "FLIP";
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
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <label
                key={t.key}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition ${
                  type === t.key ? "border-accent-500/60 bg-accent-500/10 text-zinc-50" : "border-white/10 text-zinc-300 hover:border-white/20"
                }`}
              >
                <input
                  key={`${t.key}-${type === t.key}`}
                  type="radio"
                  name="type"
                  value={t.key}
                  checked={type === t.key}
                  onChange={() => {
                    setType(t.key);
                    if (t.key === "LIQUID" && outcomes.every((o) => o === "")) setOutcomes(["Yes", "No"]);
                  }}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{types.find((t) => t.key === type)?.hint}</p>
        </div>

        {twoSided ? (
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

        {type === "FLIP" && (
          <div>
            <span className="mb-1 block text-sm text-zinc-400">Your side</span>
            <div className="flex gap-2">
              {(["0", "1"] as const).map((s) => (
                <label
                  key={s}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition ${
                    side === s ? "border-accent-500/60 bg-accent-500/10 text-zinc-50" : "border-white/10 text-zinc-300 hover:border-white/20"
                  }`}
                >
                  <input
                    key={`${s}-${side === s}`}
                    type="radio"
                    name="side"
                    value={s}
                    checked={side === s}
                    onChange={() => setSide(s)}
                    className="sr-only"
                  />
                  {s === "0" ? yesLabel || "Yes" : noLabel || "No"}
                </label>
              ))}
            </div>
          </div>
        )}

        {type === "LIQUID" ? (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">Liquidity you provide ($)</span>
            <input
              name="liquidity"
              type="number"
              min="1"
              step="0.01"
              required
              className="input"
              placeholder="20.00"
              value={liquidity}
              onChange={(e) => setLiquidity(e.target.value)}
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Taken from your balance now; it&apos;s the most you can lose. More liquidity = prices move less per trade.
              Whatever isn&apos;t paid to winners comes back to you at resolution.
            </span>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">{type === "FLIP" ? "Stake each ($)" : "Stake per bet ($)"}</span>
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
            <span className="mt-1 block text-xs text-zinc-500">
              {type === "FLIP"
                ? "Your stake is taken from your balance now; the taker matches it."
                : "Everyone bets exactly this amount per choice."}
            </span>
          </label>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input key={String(hasDeadline)} type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} />
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
