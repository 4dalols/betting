"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { GameView } from "@/lib/game-state";
import { hostAction, joinGame, submitGuess } from "@/lib/game-actions";
import { formatNumber, scoringLabel } from "@/lib/game";
import { ActionForm } from "@/components/ActionForm";

const POLL_MS = 1500;

export function GameClient({ initial }: { initial: GameView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/${initial.code}`, { cache: "no-store" });
      if (res.ok) setView(await res.json());
    } catch {
      /* transient network error; next poll will retry */
    }
  }, [initial.code]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      await refresh();
    });

  const host = view.isHost;
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-title">Game code</p>
          <p className="font-mono text-3xl tracking-[0.3em] text-amber-300">{view.code}</p>
        </div>
        <div className="text-right text-sm text-zinc-500">
          <p>{scoringLabel[view.scoring]}</p>
          <p>
            {view.status === "LOBBY"
              ? `${view.totalRounds} questions`
              : view.status === "FINISHED"
                ? "Game over"
                : `Question ${view.currentRound + 1} of ${view.totalRounds}`}
          </p>
          {view.me && <p className="text-zinc-400">Playing as {view.me.name}{host && " · host"}</p>}
          {!view.me && host && <p className="text-zinc-400">Hosting</p>}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {view.status === "LOBBY" && (
        <div className="card space-y-4 text-center">
          <h2 className="text-xl font-semibold text-zinc-50">Waiting for players</h2>
          <p className="text-sm text-zinc-500">Share the code above. Everyone opens this site, taps Play, and enters it.</p>
          <PlayerChips players={view.players} />
          {host && !view.me && (
            <ActionForm action={joinGame} className="mx-auto flex max-w-xs gap-2">
              <input type="hidden" name="code" value={view.code} />
              <input className="input" name="name" placeholder="Join as a player too (name)" maxLength={30} required />
              <button className="btn-ghost shrink-0">Join</button>
            </ActionForm>
          )}
          {host && (
            <button
              className="btn"
              disabled={pending || view.players.length === 0}
              onClick={() => run(() => hostAction(view.code, "start"))}
            >
              Start game
            </button>
          )}
        </div>
      )}

      {view.status === "PLAYING" && view.round && (
        <RoundPanel key={view.round.id} view={view} pending={pending} run={run} />
      )}

      {view.status === "FINISHED" && (
        <div className="card space-y-4 text-center">
          <h2 className="text-2xl font-semibold text-zinc-50">Final standings</h2>
          <Standings players={standings} highlight={view.me?.id} podium />
        </div>
      )}

      {view.status !== "FINISHED" && view.players.length > 0 && (
        <section>
          <h3 className="section-title mb-2">Scoreboard</h3>
          <Standings players={standings} highlight={view.me?.id} />
        </section>
      )}

      {view.history.length > 0 && (
        <section>
          <h3 className="section-title mb-2">Previous questions</h3>
          <ul className="space-y-1 text-sm">
            {view.history.map((h) => (
              <li key={h.index} className="flex flex-wrap items-baseline gap-x-3 rounded-md px-1 py-1">
                <span className="text-zinc-300">{h.prompt}</span>
                <span className="font-mono text-amber-300">{formatNumber(h.answerSum)}</span>
                <span className="text-xs text-zinc-500">{h.winners.length ? `point: ${h.winners.join(", ")}` : "no points"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {host && view.status !== "FINISHED" && (
        <div className="text-right">
          <button className="text-xs text-zinc-600 hover:text-red-300" disabled={pending} onClick={() => run(() => hostAction(view.code, "end"))}>
            End game early
          </button>
        </div>
      )}
    </div>
  );
}

function RoundPanel({
  view,
  pending,
  run,
}: {
  view: GameView;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: boolean }>) => void;
}) {
  const round = view.round!;
  const [value, setValue] = useState("");
  const guessedCount = view.players.filter((p) => p.guessed).length;
  const isLast = view.currentRound >= view.totalRounds - 1;

  return (
    <div className="card space-y-5">
      <div className="text-center">
        <p className="section-title">Question {round.index + 1}</p>
        <h2 className="mt-1 text-2xl font-semibold text-zinc-50 sm:text-3xl">{round.prompt}</h2>
        <p className="mt-1 text-sm text-zinc-500">Guess the total across everyone in the group{round.unit ? ` (${round.unit})` : ""}.</p>
      </div>

      {!round.revealed ? (
        <>
          {view.me ? (
            round.myGuess === null ? (
              <form
                className="mx-auto flex max-w-sm gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(value.replace(/,/g, ""));
                  if (!Number.isFinite(n)) return;
                  run(() => submitGuess(view.code, n));
                }}
              >
                <input
                  className="input text-center text-xl"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="Your guess"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                  required
                />
                <button className="btn shrink-0" disabled={pending}>
                  Lock in
                </button>
              </form>
            ) : (
              <p className="text-center text-lg text-zinc-300">
                Locked in: <span className="font-mono text-amber-300">{formatNumber(round.myGuess)}</span>
                <span className="block text-sm text-zinc-500">Waiting for the others…</span>
              </p>
            )
          ) : (
            <p className="text-center text-sm text-zinc-500">Players are guessing…</p>
          )}
          <PlayerChips players={view.players} showGuessed />
          <p className="text-center text-xs text-zinc-500">
            {guessedCount}/{view.players.length} locked in · reveals automatically when everyone has answered
          </p>
          {view.isHost && (
            <div className="text-center">
              <button className="btn-ghost" disabled={pending} onClick={() => run(() => hostAction(view.code, "reveal"))}>
                Force reveal {guessedCount < view.players.length && "(skip the rest)"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-2xl bg-gradient-to-br from-amber-400/15 to-rose-500/15 p-6 text-center ring-1 ring-amber-400/30">
            <p className="section-title text-amber-200/80">The group total is</p>
            <p className="mt-1 font-mono text-5xl font-semibold tracking-tight text-amber-300 sm:text-6xl">
              {formatNumber(round.answerSum ?? 0)}
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {round.answered} answered · {round.skipped} preferred not to answer
            </p>
          </div>
          <ul className="divide-y divide-white/5 text-sm">
            {round.guesses.map((g) => {
              const over = view.scoring === "CLOSEST_WITHOUT_OVER" && g.value > (round.answerSum ?? 0);
              return (
                <li key={g.playerId} className={`flex items-center gap-3 py-2 ${g.playerId === view.me?.id ? "text-zinc-50" : "text-zinc-300"}`}>
                  <span className="flex-1">{g.name}</span>
                  <span className={`font-mono ${over ? "text-zinc-500 line-through" : ""}`}>{formatNumber(g.value)}</span>
                  <span className="w-20 text-right">
                    {g.points > 0 ? <span className="pill bg-emerald-500/15 text-emerald-300">+{g.points}</span> : over ? <span className="text-xs text-zinc-500">over</span> : null}
                  </span>
                </li>
              );
            })}
            {view.players
              .filter((p) => !round.guesses.some((g) => g.playerId === p.id))
              .map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2 text-zinc-500">
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs">no guess</span>
                  <span className="w-20" />
                </li>
              ))}
          </ul>
          {round.guesses.length > 0 && round.guesses.every((g) => g.points === 0) && (
            <p className="text-center text-sm text-zinc-500">
              {view.scoring === "CLOSEST_WITHOUT_OVER" ? "Everyone went over — no points this round." : "No points this round."}
            </p>
          )}
          {view.isHost ? (
            <div className="text-center">
              <button className="btn" disabled={pending} onClick={() => run(() => hostAction(view.code, "next"))}>
                {isLast ? "Finish game" : "Next question"}
              </button>
            </div>
          ) : (
            <p className="text-center text-xs text-zinc-500">Waiting for the host…</p>
          )}
        </>
      )}
    </div>
  );
}

function PlayerChips({ players, showGuessed }: { players: GameView["players"]; showGuessed?: boolean }) {
  if (players.length === 0) return <p className="text-sm text-zinc-500">Nobody yet.</p>;
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {players.map((p) => (
        <span
          key={p.id}
          className={`pill ${showGuessed && p.guessed ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-white/5 text-zinc-300"}`}
        >
          {showGuessed && p.guessed && <span className="mr-1">✓</span>}
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Standings({ players, highlight, podium }: { players: GameView["players"]; highlight?: string; podium?: boolean }) {
  const top = players[0]?.score ?? 0;
  return (
    <ol className="divide-y divide-white/5 text-sm">
      {players.map((p, i) => (
        <li
          key={p.id}
          className={`flex items-center gap-3 py-2 ${p.id === highlight ? "text-zinc-50" : "text-zinc-300"} ${
            podium && p.score === top && top > 0 ? "text-amber-300" : ""
          }`}
        >
          <span className="w-6 font-mono text-zinc-500">{i + 1}</span>
          <span className="flex-1">
            {p.name}
            {podium && p.score === top && top > 0 && <span className="ml-2 text-xs">winner</span>}
          </span>
          <span className="font-mono">{p.score} pt{p.score === 1 ? "" : "s"}</span>
        </li>
      ))}
    </ol>
  );
}
