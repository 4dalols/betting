import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { openExGame } from "@/lib/ex-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Play — Exchange" };

export default async function ExIndexPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
  if (!(await hasAccess("member")))
    return <PasswordGate role="member" next="/ex" title="Exchange" blurb="Enter the group password to play." />;
  return (
    <div className="mx-auto mt-6 max-w-md space-y-6 sm:mt-14">
      <div className="card space-y-4 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Join a game</h1>
        <p className="text-sm text-zinc-400">Ask the host for the 4-letter code.</p>
        <ActionForm action={openExGame} className="space-y-3">
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
        <p>
          A live exchange for one contract, A, priced 1–100. A hidden fair value starts between 40 and 60 and moves by up
          to ±5 every step (a minute by default).
        </p>
        <p>
          <span className="text-zinc-200">Bots:</span> a market maker quotes 1,000 lots at every price around its view of
          fair, but only catches up one step late. Customers send 10-lot orders within 5 of fair, ten a second. Work out
          where fair is from the flow and trade ahead of the maker.
        </p>
        <p>
          <span className="text-zinc-200">Orders:</span> limit orders, matched by price then time at the resting
          order&apos;s price. Click a ladder row for a quick order, or use the Buy/Sell button to trade at that level.
          Your long and short exposure, including open orders, are each capped.
        </p>
        <p>
          <span className="text-zinc-200">Scoring:</span> you start with 100,000 cash. P&amp;L marks your position to the
          last traded price, during the case and at the bell.
        </p>
      </div>
    </div>
  );
}
