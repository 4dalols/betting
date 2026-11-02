import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { openTtGame } from "@/lib/tt-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";
import Link from "next/link";

export const metadata = { title: "Play — Trade or Tighten" };

export default async function TtIndexPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
  if (!(await hasAccess("member")))
    return <PasswordGate role="member" next="/tt" title="Trade or Tighten" blurb="Enter the group password to play." />;
  return (
    <div className="mx-auto mt-6 max-w-md space-y-6 sm:mt-14">
      <div className="card space-y-4 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Join a game</h1>
        <p className="text-sm text-zinc-400">Ask the host for the 4-letter code.</p>
        <ActionForm action={openTtGame} className="space-y-3">
          <input
            className="input text-center font-mono text-2xl uppercase tracking-[0.4em]"
            name="code"
            placeholder="ABCD"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
          <button className="btn w-full">Continue</button>
        </ActionForm>
      </div>
      <div className="card space-y-2 text-sm text-zinc-400">
        <h2 className="section-title">How it works</h2>
        <p>Each round you&apos;re put in a room (about 4 players). The contract is worth the sum of four hidden random numbers.</p>
        <p>
          <span className="text-zinc-200">Info auction:</span> bid for the largest, 2nd, 3rd and 4th largest number all at
          once. They&apos;re settled largest first, second-price; each player wins at most one, so the last one left gets
          theirs free. Your number is private.
        </p>
        <p>
          <span className="text-zinc-200">Trade or tighten:</span> propose a spread width; each one must be at least 10%
          tighter. Whoever is tightest when everyone stops becomes the market maker and posts bid @ ask at that width.
        </p>
        <p>
          <span className="text-zinc-200">Trade:</span> everyone else buys at the ask, sells at the bid, or passes. Then
          tighten again.
        </p>
        <p>
          At the end of the round the sum is revealed. Trading PnL is scaled 0–100 within the room (best = 100, worst = 0),
          minus what you paid for info. Rooms are reshuffled by Elo every round.
        </p>
        <p className="pt-2 text-xs">
          Hosting? <Link href="/tt/host" className="text-sky-300 hover:underline">Create a game</Link>.
        </p>
      </div>
    </div>
  );
}
