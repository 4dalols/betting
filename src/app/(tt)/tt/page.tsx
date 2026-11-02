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
        <p>Each round the contract is worth the sum of a few hidden random numbers.</p>
        <p>
          <span className="text-zinc-200">Auction:</span> the numbers are sold one at a time in sealed-bid auctions. Win
          one and you privately see its value.
        </p>
        <p>
          <span className="text-zinc-200">Tighten:</span> anyone can quote a market (bid @ ask). Every new quote has to be
          tighter than the last; the tightest one at the buzzer makes the market.
        </p>
        <p>
          <span className="text-zinc-200">Trade:</span> everyone else buys at the ask, sells at the bid, or passes.
        </p>
        <p>At the end of the round the numbers are revealed. PnL = trading profit − what you spent on info.</p>
        <p className="pt-2 text-xs">
          Hosting? <Link href="/tt/host" className="text-sky-300 hover:underline">Create a game</Link>.
        </p>
      </div>
    </div>
  );
}
