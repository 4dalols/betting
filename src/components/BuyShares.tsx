"use client";

import { useActionState, useState } from "react";
import { buyShares } from "@/lib/actions";
import { sharesForSpend } from "@/lib/lmsr";
import { formatCents, parseDollars } from "@/lib/payout";

type Props = {
  marketId: string;
  outcomeId: string;
  outcomeIndex: number;
  label: string;
  q: number[];
  b: number;
};

export function BuyShares({ marketId, outcomeId, outcomeIndex, label, q, b }: Props) {
  const [state, formAction, pending] = useActionState(buyShares, {});
  const [amount, setAmount] = useState("");
  const cents = parseDollars(amount);
  const shares = cents ? sharesForSpend(q, b, outcomeIndex, cents) : 0;

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="marketId" value={marketId} />
      <input type="hidden" name="outcomeId" value={outcomeId} />
      <fieldset disabled={pending} className="flex gap-2">
        <input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          placeholder="$"
          className="input w-24"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="btn flex-1">Buy {label}</button>
      </fieldset>
      {cents ? (
        <p className="mt-1 text-xs text-zinc-500">
          ≈ {formatCents(Math.floor(shares))} if {label} wins ({(shares / cents).toFixed(2)}x, avg{" "}
          {Math.round((cents / shares) * 100)}¢/share)
        </p>
      ) : null}
      {state.error && <p className="mt-1 text-xs text-red-500">{state.error}</p>}
      {state.ok && <p className="mt-1 text-xs text-emerald-500">Bought.</p>}
    </form>
  );
}
