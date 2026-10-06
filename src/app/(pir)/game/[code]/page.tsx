import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { getGameView, hostCookie, playerCookie } from "@/lib/game-state";
import { joinGame } from "@/lib/game-actions";
import { normalizeCode } from "@/lib/game";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";
import { GameClient } from "./GameClient";

export default async function GamePage({ params }: PageProps<"/game/[code]">) {
  const code = normalizeCode((await params).code);
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the game.</p>;
  if (!(await hasAccess("member")))
    return <PasswordGate role="member" next={`/game/${code}`} title={`Game ${code}`} blurb="Enter the group password to play." />;

  const jar = await cookies();
  const view = await getGameView(code, jar.get(playerCookie(code))?.value, jar.get(hostCookie(code))?.value);
  if (!view) notFound();

  if (!view.me && !view.isHost) {
    if (view.status === "FINISHED")
      return <p className="card mx-auto max-w-sm text-center text-sm text-zinc-400">This game is over.</p>;
    return (
      <div className="card mx-auto mt-10 max-w-sm space-y-4 p-8 text-center sm:mt-20">
        <p className="section-title">Game</p>
        <p className="font-mono text-4xl tracking-[0.3em] text-amber-300">{code}</p>
        <p className="text-sm text-zinc-400">
          {view.players.length === 0 ? "Be the first to join." : `${view.players.length} already in: ${view.players.map((p) => p.name).join(", ")}`}
        </p>
        <ActionForm action={joinGame} className="space-y-3">
          <input type="hidden" name="code" value={code} />
          <input className="input text-center" name="name" placeholder="Your name" maxLength={30} autoFocus required />
          <button className="btn w-full">Join</button>
        </ActionForm>
      </div>
    );
  }

  return <GameClient initial={view} />;
}
