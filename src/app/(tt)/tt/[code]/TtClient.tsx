"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { TtCycleView, TtRoomView, TtView } from "@/lib/tt-state";
import { joinTtGame, placeBids, postMarket, proposeWidth, submitTrade, ttHostAction, type TtHostOp } from "@/lib/tt-actions";
import { MAX_BID, formatNum, formatSigned, maxNextWidth } from "@/lib/tt";
import { ActionForm } from "@/components/ActionForm";

const POLL_MS = 1000;
type Run = (fn: () => Promise<{ error?: string; ok?: boolean }>) => void;
type Ctx = { view: TtView; room: TtRoomView; now: number; pending: boolean; run: Run };

const phaseName: Record<TtRoomView["phase"], string> = {
  AUCTION: "Info auction",
  TIGHTEN: "Trade or tighten",
  QUOTE: "Market maker quotes",
  TRADE: "Trading",
  RESULTS: "Settled",
};

export function TtClient({ initial }: { initial: TtView }) {
  const [view, setView] = useState(initial);
  const [watch, setWatch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [offset, setOffset] = useState(() => initial.serverNow - Date.now());
  const [clock, setClock] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tt/${initial.code}?room=${watch}`, { cache: "no-store" });
      if (!res.ok) return;
      const v: TtView = await res.json();
      setOffset(v.serverNow - Date.now());
      setView(v);
    } catch {
      /* transient network error; next poll will retry */
    }
  }, [initial.code, watch]);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setClock(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const run: Run = (fn) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      await refresh();
    });
  const host = (op: TtHostOp) => run(() => ttHostAction(view.code, op, view.seq, view.rooms.map((r) => ({ id: r.id, seq: r.seq }))));

  const now = clock + offset;
  const s = view.settings;
  const room = view.room;
  const roundOver = view.rooms.length > 0 && view.rooms.every((r) => r.phase === "RESULTS");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-title">Game code</p>
          <p className="font-mono text-3xl tracking-[0.3em] text-sky-300">{view.code}</p>
        </div>
        <div className="text-right text-sm text-zinc-500">
          <p>
            {view.status === "LOBBY"
              ? `${s.totalRounds} rounds`
              : view.status === "FINISHED"
                ? "Game over"
                : `Round ${view.currentRound + 1} of ${s.totalRounds}${room ? ` · Room ${room.index + 1} · ${phaseName[room.phase]}` : ""}`}
          </p>
          {view.me && (
            <p className="text-zinc-400">
              Playing as {view.me.name} · Elo {Math.round(view.me.elo)}
              {view.isHost && " · host"}
            </p>
          )}
          {!view.me && view.isHost && <p className="text-zinc-400">Hosting</p>}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {view.status === "LOBBY" && (
        <div className="card space-y-4 text-center">
          <h2 className="text-xl font-semibold text-zinc-50">Waiting for players</h2>
          <p className="text-sm text-zinc-500">Share the code above. Everyone opens /tt and enters it.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {view.standings.length === 0 && <p className="text-sm text-zinc-500">Nobody yet.</p>}
            {view.standings.map((p) => (
              <span key={p.id} className="pill bg-white/5 text-zinc-300">
                {p.name}
              </span>
            ))}
          </div>
          {view.isHost && !view.me && (
            <ActionForm action={joinTtGame} className="mx-auto flex max-w-xs gap-2">
              <input type="hidden" name="code" value={view.code} />
              <input className="input" name="name" placeholder="Join as a player too (name)" maxLength={30} required />
              <button className="btn-ghost shrink-0">Join</button>
            </ActionForm>
          )}
          {view.isHost && (
            <button className="btn" disabled={pending || view.standings.length < 2} onClick={() => host("start")}>
              Start game {view.standings.length < 2 && "(need 2+ players)"}
            </button>
          )}
        </div>
      )}

      {view.status === "PLAYING" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {view.spectating && view.rooms.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {view.rooms.map((r) => (
                  <button key={r.id} className={r.index === room?.index ? "btn px-3 py-1 text-xs" : "btn-ghost px-3 py-1 text-xs"} onClick={() => setWatch(r.index)}>
                    Room {r.index + 1}
                  </button>
                ))}
              </div>
            )}
            {view.spectating && <p className="text-xs text-zinc-500">Watching — private info is hidden.</p>}
            {room ? (
              <PhasePanel view={view} room={room} now={now} pending={pending} run={run} />
            ) : (
              <div className="card text-center text-sm text-zinc-400">You joined mid-round — you&apos;ll be seated when the next round starts.</div>
            )}
            {roundOver && (
              <p className="text-center text-sm text-zinc-400">
                {view.roundBreakEndsAt
                  ? `Next round (new rooms by Elo) in ${secsUntil(view.roundBreakEndsAt, now)}s`
                  : "Wrapping up the round…"}
              </p>
            )}
            {room && !roundOver && room.phase === "RESULTS" && (
              <p className="text-center text-xs text-zinc-500">Waiting for the other rooms to finish…</p>
            )}
            {view.isHost && (
              <div className="flex justify-end gap-2">
                <button className="btn-ghost px-2.5 py-1 text-xs" disabled={pending} onClick={() => host("skip")}>
                  {roundOver ? "Start next round now →" : "Skip timer (all rooms) →"}
                </button>
                <button className="btn-ghost px-2.5 py-1 text-xs text-rose-300" disabled={pending} onClick={() => confirm("End the game now?") && host("end")}>
                  End game
                </button>
              </div>
            )}
            {room && room.phase !== "RESULTS" && room.cycles.some((c) => c.trades !== null && c.market?.bid != null) && (
              <section className="card space-y-3">
                <h3 className="section-title">Earlier this round</h3>
                {room.cycles
                  .filter((c) => c.trades !== null && (c.cycle < room.cycle || room.phase === "TIGHTEN"))
                  .map((c) => (
                    <CycleSummary key={c.cycle} c={c} />
                  ))}
              </section>
            )}
          </div>

          <aside className="space-y-6">
            {room && <InfoCard room={room} />}
            {room && <MembersCard room={room} me={view.me?.id} />}
            <Standings view={view} />
            {view.rooms.length > 1 && !view.spectating && <RoomsCard view={view} />}
            <Rules view={view} />
          </aside>
        </div>
      )}

      {view.status === "FINISHED" && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <h2 className="text-xl font-semibold text-zinc-50">Final standings</h2>
            <FinalTable view={view} />
          </div>
          {room?.results && <ResultsPanel room={room} me={view.me?.id} />}
        </div>
      )}
    </div>
  );
}

const secsUntil = (t: number, now: number) => Math.max(0, Math.ceil((t - now) / 1000));

function PhasePanel(ctx: Ctx) {
  const { room, now } = ctx;
  if (room.phase === "RESULTS") return <ResultsPanel room={room} me={ctx.view.me?.id} />;
  if (now < room.opensAt) {
    const label = room.phase === "TIGHTEN" ? `Trade or tighten ${room.cycle + 1} of ${ctx.view.settings.cycles}` : phaseName[room.phase];
    const prev = room.phase === "TIGHTEN" && room.cycle > 0 ? room.cycles[room.cycle - 1] : null;
    return (
      <div className="card space-y-4 text-center">
        <p className="section-title">Up next</p>
        <p className="text-2xl font-semibold text-zinc-50">{label}</p>
        <p className="font-mono text-4xl text-sky-300">{secsUntil(room.opensAt, now)}</p>
        {room.phase === "TIGHTEN" && room.cycle === 0 && <AuctionOutcome room={room} />}
        {prev && <CycleSummary c={prev} />}
      </div>
    );
  }
  switch (room.phase) {
    case "AUCTION":
      return <AuctionPanel {...ctx} />;
    case "TIGHTEN":
      return <TightenPanel {...ctx} />;
    case "QUOTE":
      return <QuotePanel {...ctx} />;
    case "TRADE":
      return <TradePanel {...ctx} />;
  }
}

function PanelHeader({ kicker, title, secs, children }: { kicker: string; title: string; secs: number | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="section-title">{kicker}</p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-50">{title}</h2>
        {children}
      </div>
      {secs !== null && (
        <div className={`font-mono text-4xl tabular-nums ${secs <= 5 ? "text-rose-300" : "text-zinc-200"}`}>{secs}</div>
      )}
    </div>
  );
}

const endSecs = (room: TtRoomView, now: number) => (room.endsAt ? secsUntil(room.endsAt, now) : null);

function AuctionPanel({ view, room, now, pending, run }: Ctx) {
  const [amounts, setAmounts] = useState<string[]>(() => room.items.map((_, i) => (room.myBids ? String(room.myBids[i] ?? 0) : "")));
  return (
    <div className="card space-y-5">
      <PanelHeader kicker="Info auction" title="Bid for information" secs={endSecs(room, now)}>
        <p className="mt-1 text-sm text-zinc-500">
          Bid on each piece at once (0–{MAX_BID}). Settled largest first, second-price: the top bid wins and pays the next
          bid among players still eligible. Win one and you&apos;re out of the rest — the last player left gets theirs free.
          Cost comes straight off your round score.
        </p>
      </PanelHeader>
      {view.me ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => placeBids(view.code, amounts.map((a) => (a === "" ? 0 : Number(a)))));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            {room.items.map((item, i) => (
              <label key={item.index} className="block space-y-1">
                <span className="text-xs font-medium text-zinc-400">{item.label}</span>
                <input
                  className="input text-lg"
                  type="number"
                  step="any"
                  min={0}
                  max={MAX_BID}
                  inputMode="decimal"
                  placeholder="0"
                  value={amounts[i] ?? ""}
                  onChange={(e) => setAmounts((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn" disabled={pending}>
              {room.myBids ? "Update bids" : "Submit bids"}
            </button>
            <span className="text-xs text-zinc-500">
              {room.myBids ? `Submitted: ${room.myBids.map(formatNum).join(" / ")}` : "Blank = 0."} You can change them until it closes.
            </span>
          </div>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">Players are bidding…</p>
      )}
      <ActedChips room={room} />
      <p className="text-xs text-zinc-500">
        {room.bidsIn}/{room.members.length} in · closes early when everyone has bid
      </p>
    </div>
  );
}

function TightenPanel({ view, room, now, pending, run }: Ctx) {
  const c = room.cycles[room.cycle];
  const [width, setWidth] = useState("");
  const limit = maxNextWidth(c.best?.width ?? null, view.settings.tightenPct);
  const mine = c.best?.playerId === view.me?.id;
  const iAmOut = view.me ? c.out.includes(view.me.id) : false;
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Trade or tighten · ${room.cycle + 1} of ${view.settings.cycles}`} title="Tighten the spread" secs={endSecs(room, now)}>
        <p className="mt-1 text-sm text-zinc-500">
          Propose a spread width. Each one must be at least {view.settings.tightenPct}% tighter. The clock restarts on every
          tighten; when nobody goes tighter, the tightest player makes the market at that width.
        </p>
      </PanelHeader>
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/10 to-violet-500/10 p-5 text-center ring-1 ring-sky-400/20">
        {c.best ? (
          <>
            <p className="font-mono text-4xl font-semibold text-zinc-50">{formatNum(c.best.width)}</p>
            <p className="mt-1 text-sm text-zinc-400">tightest: {mine ? "you" : c.best.name}</p>
          </>
        ) : (
          <p className="text-zinc-400">No spread yet — open with any width.</p>
        )}
      </div>
      {view.me &&
        (mine ? (
          <p className="text-center text-sm text-zinc-300">You have the tightest spread. Waiting to see if anyone beats it…</p>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const w = Number(width);
              if (width !== "" && Number.isFinite(w))
                run(async () => {
                  const r = await proposeWidth(view.code, w);
                  if (r.ok) setWidth("");
                  return r;
                });
            }}
          >
            <input
              className="input w-32 text-lg"
              type="number"
              step="any"
              min={0}
              max={limit ?? undefined}
              inputMode="decimal"
              placeholder="Width"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              autoFocus
            />
            <button className="btn" disabled={pending || width === ""}>
              Tighten
            </button>
            <button type="button" className="btn-ghost" disabled={pending || iAmOut} onClick={() => run(() => proposeWidth(view.code, null))}>
              {iAmOut ? "You're out" : "I'm out"}
            </button>
            <span className="w-full text-xs text-zinc-500">
              {limit === null ? "Any width to open." : `Width must be ≤ ${formatNum(limit)}.`}
              {iAmOut && " You can still jump back in by tightening."}
            </span>
          </form>
        ))}
      {c.proposals.some((p) => p.width !== null) && (
        <ol className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
          {[...c.proposals]
            .filter((p) => p.width !== null)
            .reverse()
            .map((p, i) => (
              <li key={p.id} className={`flex justify-between ${i === 0 ? "text-zinc-100" : "text-zinc-500"}`}>
                <span>{p.name}</span>
                <span className="font-mono">{formatNum(p.width!)}</span>
              </li>
            ))}
        </ol>
      )}
      <ActedChips room={room} />
      <p className="text-xs text-zinc-500">✓ = tightest or out · ends early once everyone else is out</p>
    </div>
  );
}

function QuotePanel({ view, room, now, pending, run }: Ctx) {
  const m = room.cycles[room.cycle].market!;
  const [bid, setBid] = useState(() => String(Math.round((view.settings.priorMean - m.width / 2) * 100) / 100));
  const isMaker = view.me?.id === m.makerId;
  const b = Number(bid);
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Trade or tighten · ${room.cycle + 1} of ${view.settings.cycles}`} title={isMaker ? "You're the market maker" : `${m.makerName} is making the market`} secs={endSecs(room, now)}>
        <p className="mt-1 text-sm text-zinc-500">
          Width {formatNum(m.width)}. {isMaker ? "Set your bid; the ask is bid + width." : "Waiting for their quote…"} If no quote
          comes in time, it&apos;s centered on the prior mean ({formatNum(view.settings.priorMean)}).
        </p>
      </PanelHeader>
      {isMaker && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (bid !== "" && Number.isFinite(b)) run(() => postMarket(view.code, b));
          }}
        >
          <input className="input w-32 text-lg" type="number" step="any" inputMode="decimal" placeholder="Bid" value={bid} onChange={(e) => setBid(e.target.value)} autoFocus />
          <span className="text-zinc-500">@</span>
          <span className="font-mono text-lg text-zinc-200">{bid !== "" && Number.isFinite(b) ? formatNum(b + m.width) : "—"}</span>
          <button className="btn" disabled={pending}>
            Post market
          </button>
        </form>
      )}
    </div>
  );
}

function TradePanel({ view, room, now, pending, run }: Ctx) {
  const c = room.cycles[room.cycle];
  const m = c.market!;
  const isMaker = view.me?.id === m.makerId;
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Trading · ${room.cycle + 1} of ${view.settings.cycles}`} title="Trade" secs={endSecs(room, now)}>
        <p className="mt-1 text-sm text-zinc-500">Buy at the ask, sell at the bid, or pass — one lot. Choices are revealed when time&apos;s up.</p>
      </PanelHeader>
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/10 to-violet-500/10 p-5 text-center ring-1 ring-sky-400/20">
        <p className="font-mono text-4xl font-semibold text-zinc-50">
          {formatNum(m.bid!)} <span className="text-zinc-500">@</span> {formatNum(m.ask!)}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          market by {isMaker ? "you" : m.makerName}
          {m.auto && " (auto-centered)"}
        </p>
      </div>
      {view.me &&
        (isMaker ? (
          <p className="text-center text-sm text-zinc-400">You&apos;re the market maker — everyone else trades against you.</p>
        ) : c.myTrade ? (
          <p className="text-center text-sm text-zinc-300">
            You chose{" "}
            <span className="font-semibold text-sky-300">
              {c.myTrade === "BUY" ? `buy @ ${formatNum(m.ask!)}` : c.myTrade === "SELL" ? `sell @ ${formatNum(m.bid!)}` : "pass"}
            </span>
            .
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn bg-emerald-400 hover:bg-emerald-300" disabled={pending} onClick={() => run(() => submitTrade(view.code, "BUY"))}>
              Buy @ {formatNum(m.ask!)}
            </button>
            <button className="btn bg-rose-400 hover:bg-rose-300" disabled={pending} onClick={() => run(() => submitTrade(view.code, "SELL"))}>
              Sell @ {formatNum(m.bid!)}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => run(() => submitTrade(view.code, "PASS"))}>
              Pass
            </button>
          </div>
        ))}
      <ActedChips room={room} />
      <p className="text-xs text-zinc-500">
        {c.tradesIn}/{room.members.length - 1} in · closes early when everyone has chosen
      </p>
    </div>
  );
}

function AuctionOutcome({ room }: { room: TtRoomView }) {
  return (
    <ul className="mx-auto max-w-sm space-y-1 text-left text-sm">
      {room.items.map((i) => (
        <li key={i.index} className="flex justify-between gap-3">
          <span className="text-zinc-400">{i.label}</span>
          <span className={i.mine ? "text-sky-300" : "text-zinc-300"}>
            {i.winnerName ? `${i.mine ? "you" : i.winnerName} · paid ${formatNum(i.price ?? 0)}` : "unsold"}
            {i.value !== null && <span className="ml-2 font-mono">= {i.value}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CycleSummary({ c }: { c: TtCycleView }) {
  if (!c.market || c.market.bid === null)
    return <p className="text-sm text-zinc-500">Cycle {c.cycle + 1}: nobody proposed a spread — no market.</p>;
  const buys = c.trades?.filter((t) => t.side === "BUY") ?? [];
  const sells = c.trades?.filter((t) => t.side === "SELL") ?? [];
  return (
    <div className="text-sm">
      <p className="text-zinc-300">
        Cycle {c.cycle + 1}: <span className="font-mono">{formatNum(c.market.bid)} @ {formatNum(c.market.ask!)}</span>{" "}
        <span className="text-zinc-500">
          by {c.market.makerName} (width {formatNum(c.market.width)}
          {c.market.auto ? ", auto" : ""})
        </span>
      </p>
      {c.trades && (
        <p className="text-xs text-zinc-500">
          <span className="text-emerald-300">Bought:</span> {buys.map((t) => t.name).join(", ") || "nobody"} ·{" "}
          <span className="text-rose-300">Sold:</span> {sells.map((t) => t.name).join(", ") || "nobody"}
        </p>
      )}
    </div>
  );
}

function ResultsPanel({ room, me }: { room: TtRoomView; me?: string }) {
  return (
    <div className="card space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/15 to-violet-500/15 p-6 text-center ring-1 ring-sky-400/30">
        <p className="section-title text-sky-200/80">
          Round {room.round + 1} · Room {room.index + 1} settles at
        </p>
        <p className="mt-1 font-mono text-5xl font-semibold tracking-tight text-sky-300 sm:text-6xl">{room.sum}</p>
        <p className="mt-2 font-mono text-sm text-zinc-400">{room.cards?.join(" + ")}</p>
      </div>
      <AuctionOutcome room={room} />
      <div className="space-y-2">
        {room.cycles.map((c) => (
          <CycleSummary key={c.cycle} c={c} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="py-1 font-medium">#</th>
              <th className="font-medium">Player</th>
              <th className="text-right font-medium">Trading PnL</th>
              <th className="text-right font-medium">Normalized</th>
              <th className="text-right font-medium">Info cost</th>
              <th className="text-right font-medium">Score</th>
              <th className="text-right font-medium">Elo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {room.results?.map((r) => (
              <tr key={r.playerId} className={r.playerId === me ? "text-zinc-50" : "text-zinc-300"}>
                <td className="py-1.5 font-mono text-zinc-500">{r.rank}</td>
                <td>{r.name}</td>
                <td className="text-right font-mono">{formatSigned(r.tradingPnl)}</td>
                <td className="text-right font-mono">{formatNum(r.normalized)}</td>
                <td className="text-right font-mono text-zinc-500">{r.cost ? `−${formatNum(r.cost)}` : "—"}</td>
                <td className="text-right font-mono font-semibold">{formatNum(r.score)}</td>
                <td className="text-right font-mono text-xs text-zinc-400">
                  {Math.round(r.eloAfter)} <span className={r.eloAfter >= r.eloBefore ? "text-emerald-300" : "text-rose-300"}>({formatSigned(Math.round(r.eloAfter - r.eloBefore))})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoCard({ room }: { room: TtRoomView }) {
  if (room.phase === "AUCTION") return null;
  const mine = room.items.filter((i) => i.mine);
  return (
    <section className="card space-y-2">
      <h3 className="section-title">Your info</h3>
      {mine.length === 0 ? (
        <p className="text-sm text-zinc-500">You didn&apos;t win any info this round.</p>
      ) : (
        mine.map((i) => (
          <p key={i.index} className="text-sm text-zinc-300">
            {i.label}: <span className="font-mono text-xl text-sky-300">{i.value}</span>
          </p>
        ))
      )}
      <ul className="space-y-0.5 pt-1 text-xs text-zinc-500">
        {room.items.map((i) => (
          <li key={i.index}>
            {i.label}: {i.winnerName ? `${i.winnerName} paid ${formatNum(i.price ?? 0)}` : "unsold"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MembersCard({ room, me }: { room: TtRoomView; me?: string }) {
  return (
    <section className="card space-y-2">
      <h3 className="section-title">Room {room.index + 1}</h3>
      <ul className="space-y-0.5 text-sm">
        {room.members.map((m) => (
          <li key={m.id} className={`flex justify-between ${m.id === me ? "text-zinc-50" : "text-zinc-300"}`}>
            <span>{m.name}</span>
            <span className="font-mono text-xs text-zinc-500">Elo {Math.round(m.elo)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActedChips({ room }: { room: TtRoomView }) {
  return (
    <div className="flex flex-wrap gap-2">
      {room.members.map((p) => (
        <span key={p.id} className={`pill ${p.acted ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-white/5 text-zinc-400"}`}>
          {p.acted && <span className="mr-1">✓</span>}
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Standings({ view }: { view: TtView }) {
  return (
    <section className="card space-y-2">
      <h3 className="section-title">Total score</h3>
      <ol className="divide-y divide-white/5 text-sm">
        {view.standings.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-3 py-1.5 ${p.id === view.me?.id ? "text-zinc-50" : "text-zinc-300"}`}>
            <span className="w-5 font-mono text-zinc-500">{i + 1}</span>
            <span className="flex-1">{p.name}</span>
            <span className="font-mono text-xs text-zinc-500">{Math.round(p.elo)}</span>
            <span className="w-16 text-right font-mono">{formatNum(p.total)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RoomsCard({ view }: { view: TtView }) {
  return (
    <section className="card space-y-2">
      <h3 className="section-title">Rooms</h3>
      <ul className="space-y-1 text-xs text-zinc-400">
        {view.rooms.map((r) => (
          <li key={r.id}>
            <span className="text-zinc-200">Room {r.index + 1}</span> · {phaseName[r.phase]} · {r.players.join(", ")}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FinalTable({ view }: { view: TtView }) {
  const top = view.standings[0]?.total;
  const played = Array.from({ length: view.settings.totalRounds }, (_, i) => i).filter((i) => view.standings.some((p) => p.rounds[i] !== null));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1 font-medium">Player</th>
            {played.map((i) => (
              <th key={i} className="text-right font-medium">
                R{i + 1}
              </th>
            ))}
            <th className="text-right font-medium">Total</th>
            <th className="text-right font-medium">Elo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {view.standings.map((p) => (
            <tr key={p.id} className={p.total === top ? "text-sky-300" : p.id === view.me?.id ? "text-zinc-50" : "text-zinc-300"}>
              <td className="py-1.5">
                {p.name}
                {p.total === top && <span className="ml-2 text-xs">winner</span>}
              </td>
              {played.map((i) => (
                <td key={i} className="text-right font-mono">
                  {p.rounds[i] === null ? "—" : formatNum(p.rounds[i]!)}
                </td>
              ))}
              <td className="text-right font-mono">{formatNum(p.total)}</td>
              <td className="text-right font-mono text-zinc-500">{Math.round(p.elo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rules({ view }: { view: TtView }) {
  const s = view.settings;
  return (
    <details className="card text-sm text-zinc-400">
      <summary className="cursor-pointer section-title">Rules</summary>
      <ul className="mt-3 list-disc space-y-1 pl-4">
        <li>
          Contract = sum of {s.cardsPerRound} numbers; {s.distributionDescribe} (mean ≈ {s.cardMean} each, so the sum averages ≈{" "}
          {formatNum(s.priorMean)}).
        </li>
        <li>Rooms of ~{s.roomSize}: random in round 1, then by Elo.</li>
        <li>
          Info auction ({s.auctionSecs}s): bid on every number at once; settled largest first, second-price, one win per player.
        </li>
        <li>
          {s.cycles} × trade or tighten: propose widths ≥ {s.tightenPct}% tighter ({s.decisionSecs}s clock, restarts on each tighten); the
          tightest posts bid @ ask at that width; others buy, sell or pass one lot ({s.tradeSecs}s).
        </li>
        <li>Score = trading PnL scaled 0–100 within the room − info cost. Total score wins.</li>
      </ul>
    </details>
  );
}
