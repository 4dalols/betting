import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { gateConfigured, hasAccess } from "@/lib/game-auth";
import { getExView, exHostCookie, exPlayerCookie } from "@/lib/ex-state";
import { joinExGame } from "@/lib/ex-actions";
import { normalizeCode } from "@/lib/game";
import { PasswordGate } from "@/components/PasswordGate";
import { ActionForm } from "@/components/ActionForm";
import { ExClient } from "./ExClient";

export const metadata = { title: "Exchange" };

export default async function ExGamePage({ params }: PageProps<"/ex/[code]">) {
  const code = normalizeCode((await params).code);
  if (!gateConfigured())
    return <p className="card text-sm text-amber-300">Set GAME_PASSWORD in the environment to enable the games.</p>;
  if (!(await hasAccess("member")))
    return <PasswordGate role="member" next={`/ex/${code}`} title={`Game ${code}`} blurb="Enter the group password to play." />;

  const jar = await cookies();
  const view = await getExView(code, jar.get(exPlayerCookie(code))?.value, jar.get(exHostCookie(code))?.value);
  if (!view) notFound();

  if (!view.me && !view.isHost) {
    if (view.status === "FINISHED")
      return <p className="card mx-auto max-w-sm text-center text-sm text-zinc-400">This game is over.</p>;
    return (
      <div className="card mx-auto mt-10 max-w-sm space-y-4 p-8 text-center sm:mt-20">
        <p className="section-title">Exchange</p>
        <p className="font-mono text-4xl tracking-[0.3em] text-sky-300">{code}</p>
        <p className="text-sm text-zinc-400">
          {view.players.length === 0
            ? "Be the first to join."
            : `${view.players.length} already in: ${view.players.join(", ")}`}
        </p>
        <ActionForm action={joinExGame} className="space-y-3">
          <input type="hidden" name="code" value={code} />
          <input className="input text-center" name="name" placeholder="Your name" maxLength={30} autoFocus required />
          <button className="btn w-full">Join</button>
          {view.status === "PLAYING" && <p className="text-xs text-zinc-500">Market is open — you can start trading straight away.</p>}
        </ActionForm>
      </div>
    );
  }

  return <ExClient initial={view} />;
}
