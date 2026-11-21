import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { openExGame } from "@/lib/ex-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Play — Exchange" };

export default async function ExIndexPage() {
  if (!gateConfigured())
    return <p className="card mx-auto mt-6 max-w-xl text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
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
          A live exchange for one contract, A, on the answer to a question the host sets (say, how many hurricanes hit
          the US in the past century). At the bell it settles at the true answer.
        </p>
        <p>
          <span className="text-zinc-200">Bots:</span> the bots start from a rough guess and move toward the true answer
          every step (a minute by default). A market maker quotes 1,000 lots at each price around its view of fair, but
          only catches up one step late. Customers send 25-lot orders near fair, ten a second, and lean toward
          paying up, so resting orders near fair tend to get filled at a profit. Work out where fair is from the flow and
          trade ahead of the maker.
        </p>
        <p>
          <span className="text-zinc-200">Orders:</span> limit orders, matched by price then time at the resting
          order&apos;s price. Click a ladder row for a quick order, or use the Buy/Sell button to trade at that level.
          Your long and short exposure, including open orders, are each capped.
        </p>
        <p>
          <span className="text-zinc-200">Scoring:</span> you start with 100,000 cash. during the case P&amp;L marks your
          position to the last traded price; at the bell it settles at the answer.
        </p>
      </div>
    </div>
  );
}
