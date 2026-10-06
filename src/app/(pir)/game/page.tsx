import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { openGame } from "@/lib/game-actions";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Play — Price Is Right" };

export default async function GameIndexPage() {
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the game.</p>;
  if (!(await hasAccess("member")))
    return <PasswordGate role="member" next="/game" title="Join a game" blurb="Enter the group password to play." />;
  return (
    <div className="card mx-auto mt-10 max-w-sm space-y-4 p-8 text-center sm:mt-20">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Join a game</h1>
      <p className="text-sm text-zinc-400">Ask the host for the 4-letter code.</p>
      <ActionForm action={openGame} className="space-y-3">
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
  );
}
