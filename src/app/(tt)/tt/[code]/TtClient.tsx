"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { TtSubView, TtView } from "@/lib/tt-state";
import { placeBid, postQuote, submitTrade, ttHostAction, joinTtGame, type TtHostOp } from "@/lib/tt-actions";
import { formatMoney, formatPrice, formatSigned, maxNextSpread, spreadOf } from "@/lib/tt";
import { ActionForm } from "@/components/ActionForm";

const POLL_MS = 1000;
type Run = (fn: () => Promise<{ error?: string; ok?: boolean }>) => void;

export function TtClient({ initial }: { initial: TtView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [offset, setOffset] = useState(() => initial.serverNow - Date.now());
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tt/${initial.code}`, { cache: "no-store" });
      if (!res.ok) return;
      const v: TtView = await res.json();
      setOffset(v.serverNow - Date.now());
      setView(v);
    } catch {
      /* transient network error; next poll will retry */
    }
  }, [initial.code]);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 250);
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
  const host = (op: TtHostOp) => run(() => ttHostAction(view.code, op, view.seq));

  const secsLeft = view.phaseEndsAt ? Math.max(0, Math.ceil((view.phaseEndsAt - (now + offset)) / 1000)) : null;
  const s = view.settings;
  const standings = [...view.players].sort((a, b) => b.totalPnl - a.totalPnl || a.name.localeCompare(b.name));
  const myInfo = view.round?.items.filter((i) => i.mine) ?? [];

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
                : `Round ${view.currentRound + 1} of ${s.totalRounds} · ${phaseLabel(view)}`}
          </p>
          {view.me && (
            <p className="text-zinc-400">
              Playing as {view.me.name}
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
            {view.players.length === 0 && <p className="text-sm text-zinc-500">Nobody yet.</p>}
            {view.players.map((p) => (
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
            <button className="btn" disabled={pending || view.players.length < 2} onClick={() => host("start")}>
              Start game {view.players.length < 2 && "(need 2+ players)"}
            </button>
          )}
        </div>
      )}

      {view.status === "PLAYING" && view.round && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <PhasePanel view={view} secsLeft={secsLeft} pending={pending} run={run} />
            {view.isHost && view.phase !== "RESULTS" && (
              <div className="text-right">
                <button className="btn-ghost px-2.5 py-1 text-xs" disabled={pending} onClick={() => host("skip")}>
                  Skip timer →
                </button>
              </div>
            )}
            {view.isHost && view.phase === "RESULTS" && (
              <div className="text-center">
                <button className="btn" disabled={pending} onClick={() => host("next")}>
                  {view.currentRound + 1 < s.totalRounds ? "Next round" : "Finish game"}
                </button>
              </div>
            )}
            {!view.isHost && view.phase === "RESULTS" && (
              <p className="text-center text-xs text-zinc-500">Waiting for the host to start the next round…</p>
            )}
            {view.round.subs.filter((sub) => sub.trades !== null).length > 0 && view.phase !== "RESULTS" && (
              <section className="card space-y-3">
                <h3 className="section-title">Earlier this round</h3>
                {view.round.subs
                  .filter((sub) => sub.trades !== null)
                  .map((sub) => (
                    <SubSummary key={sub.subRound} sub={sub} />
                  ))}
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className="card space-y-3">
              <h3 className="section-title">Your info</h3>
              {!view.me ? (
                <p className="text-sm text-zinc-500">You&apos;re hosting, not playing.</p>
              ) : myInfo.length === 0 ? (
                <p className="text-sm text-zinc-500">You haven&apos;t bought any numbers this round.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {myInfo.map((i) => (
                    <li key={i.index} className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400">{i.label}</span>
                      <span className="font-mono text-lg text-sky-300">{i.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              {view.me && (
                <p className="border-t border-white/5 pt-2 text-xs text-zinc-500">
                  Bankroll left: {formatMoney(view.players.find((p) => p.id === view.me!.id)?.bankrollLeft ?? 0)}
                  {s.resetBankroll ? " (resets each round)" : " (whole game)"}
                </p>
              )}
            </section>

            {s.itemsPerRound > 0 && (
              <section className="card space-y-2">
                <h3 className="section-title">Info sold</h3>
                <ul className="space-y-1 text-sm">
                  {view.round.items.map((i) => (
                    <li key={i.index} className="flex items-center justify-between gap-2">
                      <span className={i.closed ? "text-zinc-300" : "text-zinc-500"}>{i.label}</span>
                      <span className="text-right text-xs text-zinc-400">
                        {!i.closed
                          ? view.phase === "AUCTION" && i.index === view.itemIndex
                            ? "bidding…"
                            : "—"
                          : i.winnerName
                            ? `${i.winnerName} · ${formatMoney(i.price ?? 0)}`
                            : "unsold"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Leaderboard players={standings} me={view.me?.id} />
            <Rules view={view} />
          </aside>
        </div>
      )}

      {view.status === "FINISHED" && (
        <div className="card space-y-4">
          <h2 className="text-center text-2xl font-semibold text-zinc-50">Final standings</h2>
          <FinalTable view={view} />
        </div>
      )}

      {view.history.length > 0 && view.status !== "FINISHED" && (
        <section>
          <h3 className="section-title mb-2">Previous rounds</h3>
          <ul className="space-y-1 text-sm">
            {view.history.map((h) => (
              <li key={h.index} className="flex flex-wrap items-baseline gap-x-3 rounded-md px-1 py-1">
                <span className="text-zinc-400">Round {h.index + 1}</span>
                <span className="font-mono text-sky-300">{h.sum}</span>
                <span className="font-mono text-xs text-zinc-500">({h.cards.join(" + ")})</span>
                <span className="text-xs text-zinc-500">
                  top: {h.results.filter((r) => r.rank === 1).map((r) => `${r.name} ${formatSigned(r.pnl)}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.isHost && view.status !== "FINISHED" && (
        <div className="text-right">
          <button className="text-xs text-zinc-600 hover:text-red-300" disabled={pending} onClick={() => host("end")}>
            End game early
          </button>
        </div>
      )}
    </div>
  );
}

function phaseLabel(view: TtView) {
  switch (view.phase) {
    case "AUCTION":
      return `Info auction ${view.itemIndex + 1}/${view.settings.itemsPerRound}`;
    case "QUOTE":
      return `Tighten ${view.subRound + 1}/${view.settings.subRounds}`;
    case "TRADE":
      return `Trade ${view.subRound + 1}/${view.settings.subRounds}`;
    case "RESULTS":
      return "Results";
  }
}

function Timer({ secs }: { secs: number | null }) {
  if (secs === null) return null;
  return (
    <span className={`font-mono text-3xl tabular-nums ${secs <= 5 ? "text-red-300" : "text-zinc-100"}`}>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

function PanelHeader({ kicker, title, secs, children }: { kicker: string; title: string; secs: number | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="section-title">{kicker}</p>
        <h2 className="mt-1 text-2xl font-semibold text-zinc-50">{title}</h2>
        {children}
      </div>
      <Timer secs={secs} />
    </div>
  );
}

function PhasePanel({ view, secsLeft, pending, run }: { view: TtView; secsLeft: number | null; pending: boolean; run: Run }) {
  const round = view.round!;
  switch (view.phase) {
    case "AUCTION":
      return <AuctionPanel key={`a${round.index}-${view.itemIndex}`} view={view} secs={secsLeft} pending={pending} run={run} />;
    case "QUOTE":
      return <QuotePanel key={`q${round.index}-${view.subRound}`} view={view} secs={secsLeft} pending={pending} run={run} />;
    case "TRADE":
      return <TradePanel view={view} secs={secsLeft} pending={pending} run={run} />;
    case "RESULTS":
      return <ResultsPanel view={view} />;
  }
}

function AuctionPanel({ view, secs, pending, run }: { view: TtView; secs: number | null; pending: boolean; run: Run }) {
  const round = view.round!;
  const item = round.items[view.itemIndex];
  const [amount, setAmount] = useState("");
  const left = view.players.find((p) => p.id === view.me?.id)?.bankrollLeft ?? 0;
  const acted = view.players.filter((p) => p.acted).length;
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Info auction · ${view.itemIndex + 1} of ${round.items.length}`} title={item?.label ?? "Info"} secs={secs}>
        <p className="mt-1 text-sm text-zinc-500">
          Sealed bid, {view.settings.auctionType === "FIRST_PRICE" ? "first price (winner pays their bid)" : "second price (winner pays the runner-up's bid)"}.
          Winner sees the value privately.
        </p>
      </PanelHeader>
      {view.me ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount);
            if (Number.isFinite(n)) run(() => placeBid(view.code, n));
          }}
        >
          <span className="text-zinc-400">$</span>
          <input
            className="input w-36 text-lg"
            type="number"
            step="any"
            min={0}
            max={left}
            inputMode="decimal"
            placeholder="Your bid"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <button className="btn" disabled={pending || amount === ""}>
            {round.myBid === null ? "Bid" : "Change bid"}
          </button>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => placeBid(view.code, 0))}>
            Pass
          </button>
          <span className="w-full text-xs text-zinc-500">
            {round.myBid === null ? "No bid yet." : round.myBid === 0 ? "You passed." : `Your bid: ${formatMoney(round.myBid)}.`} You have{" "}
            {formatMoney(left)} to spend.
          </span>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">Players are bidding…</p>
      )}
      <ActedChips view={view} />
      <p className="text-xs text-zinc-500">
        {acted}/{view.players.length} in · closes early when everyone has bid or passed
      </p>
    </div>
  );
}

function QuotePanel({ view, secs, pending, run }: { view: TtView; secs: number | null; pending: boolean; run: Run }) {
  const sub = view.round!.subs[view.subRound];
  const best = sub.quotes.length ? sub.quotes[sub.quotes.length - 1] : null;
  const limit = maxNextSpread(best, view.settings.tightenPct, view.settings.maxSpread);
  const [bid, setBid] = useState("");
  const [ask, setAsk] = useState("");
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Tighten · ${view.subRound + 1} of ${view.settings.subRounds}`} title="Make a market" secs={secs}>
        <p className="mt-1 text-sm text-zinc-500">
          Quote bid @ ask on the sum. Each quote must be at least {view.settings.tightenPct}% tighter than the current best. Tightest
          at the buzzer makes the market.
        </p>
      </PanelHeader>
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/10 to-violet-500/10 p-5 text-center ring-1 ring-sky-400/20">
        {best ? (
          <>
            <p className="font-mono text-4xl font-semibold text-zinc-50">
              {formatPrice(best.bid)} <span className="text-zinc-500">@</span> {formatPrice(best.ask)}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {best.name} · spread {formatPrice(spreadOf(best))}
            </p>
          </>
        ) : (
          <p className="text-zinc-400">No market yet — be the first to quote.</p>
        )}
      </div>
      {view.me && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const b = Number(bid);
            const a = Number(ask);
            if (bid !== "" && ask !== "" && Number.isFinite(b) && Number.isFinite(a))
              run(async () => {
                const r = await postQuote(view.code, b, a);
                if (r.ok) {
                  setBid("");
                  setAsk("");
                }
                return r;
              });
          }}
        >
          <input className="input w-28 text-lg" type="number" step="any" inputMode="decimal" placeholder="Bid" value={bid} onChange={(e) => setBid(e.target.value)} autoFocus />
          <span className="text-zinc-500">@</span>
          <input className="input w-28 text-lg" type="number" step="any" inputMode="decimal" placeholder="Ask" value={ask} onChange={(e) => setAsk(e.target.value)} />
          <button className="btn" disabled={pending}>
            Quote
          </button>
          <span className="w-full text-xs text-zinc-500">
            {limit === null ? "Any spread for the opening quote." : `Your spread must be ≤ ${formatPrice(limit)}.`}
          </span>
        </form>
      )}
      {sub.quotes.length > 0 && (
        <ol className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
          {[...sub.quotes].reverse().map((q, i) => (
            <li key={q.id} className={`flex justify-between font-mono ${i === 0 ? "text-zinc-100" : "text-zinc-500"}`}>
              <span className="font-sans">{q.name}</span>
              <span>
                {formatPrice(q.bid)} @ {formatPrice(q.ask)} <span className="text-xs">({formatPrice(spreadOf(q))})</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TradePanel({ view, secs, pending, run }: { view: TtView; secs: number | null; pending: boolean; run: Run }) {
  const sub = view.round!.subs[view.subRound];
  const m = sub.market!;
  const isMaker = view.me?.id === m.makerId;
  const acted = view.players.filter((p) => p.acted).length;
  return (
    <div className="card space-y-5">
      <PanelHeader kicker={`Trade · ${view.subRound + 1} of ${view.settings.subRounds}`} title="Trade" secs={secs}>
        <p className="mt-1 text-sm text-zinc-500">
          Buy at the ask, sell at the bid, or pass — one lot. Choices are revealed when time&apos;s up.
        </p>
      </PanelHeader>
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/10 to-violet-500/10 p-5 text-center ring-1 ring-sky-400/20">
        <p className="font-mono text-4xl font-semibold text-zinc-50">
          {formatPrice(m.bid)} <span className="text-zinc-500">@</span> {formatPrice(m.ask)}
        </p>
        <p className="mt-1 text-sm text-zinc-400">market by {isMaker ? "you" : m.makerName}</p>
      </div>
      {view.me &&
        (isMaker ? (
          <p className="text-center text-sm text-zinc-400">You&apos;re the market maker — everyone else trades against you.</p>
        ) : sub.myTrade ? (
          <p className="text-center text-sm text-zinc-300">
            You chose{" "}
            <span className="font-semibold text-sky-300">
              {sub.myTrade === "BUY" ? `buy @ ${formatPrice(m.ask)}` : sub.myTrade === "SELL" ? `sell @ ${formatPrice(m.bid)}` : "pass"}
            </span>
            .
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn bg-emerald-400 hover:bg-emerald-300" disabled={pending} onClick={() => run(() => submitTrade(view.code, "BUY"))}>
              Buy @ {formatPrice(m.ask)}
            </button>
            <button className="btn bg-rose-400 hover:bg-rose-300" disabled={pending} onClick={() => run(() => submitTrade(view.code, "SELL"))}>
              Sell @ {formatPrice(m.bid)}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => run(() => submitTrade(view.code, "PASS"))}>
              Pass
            </button>
          </div>
        ))}
      <ActedChips view={view} />
      <p className="text-xs text-zinc-500">
        {acted}/{view.players.length} in · closes early when everyone has chosen
      </p>
    </div>
  );
}

function SubSummary({ sub }: { sub: TtSubView }) {
  if (!sub.market) return <p className="text-sm text-zinc-500">T-or-T {sub.subRound + 1}: nobody quoted — no market.</p>;
  const buys = sub.trades?.filter((t) => t.side === "BUY") ?? [];
  const sells = sub.trades?.filter((t) => t.side === "SELL") ?? [];
  return (
    <div className="text-sm">
      <p className="text-zinc-300">
        T-or-T {sub.subRound + 1}: <span className="font-mono">{formatPrice(sub.market.bid)} @ {formatPrice(sub.market.ask)}</span>{" "}
        <span className="text-zinc-500">by {sub.market.makerName}</span>
      </p>
      <p className="text-xs text-zinc-500">
        <span className="text-emerald-300">Bought:</span> {buys.map((t) => t.name).join(", ") || "nobody"} ·{" "}
        <span className="text-rose-300">Sold:</span> {sells.map((t) => t.name).join(", ") || "nobody"}
      </p>
    </div>
  );
}

function ResultsPanel({ view }: { view: TtView }) {
  const round = view.round!;
  return (
    <div className="card space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-sky-400/15 to-violet-500/15 p-6 text-center ring-1 ring-sky-400/30">
        <p className="section-title text-sky-200/80">Round {round.index + 1} settles at</p>
        <p className="mt-1 font-mono text-5xl font-semibold tracking-tight text-sky-300 sm:text-6xl">{round.sum}</p>
        <p className="mt-2 font-mono text-sm text-zinc-400">{round.cards?.join(" + ")}</p>
      </div>
      <div className="space-y-2">
        {round.subs.map((sub) => (
          <SubSummary key={sub.subRound} sub={sub} />
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1 font-medium">#</th>
            <th className="font-medium">Player</th>
            <th className="text-right font-medium">Trading</th>
            <th className="text-right font-medium">Info spend</th>
            <th className="text-right font-medium">Round PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {round.results?.map((r) => (
            <tr key={r.playerId} className={r.playerId === view.me?.id ? "text-zinc-50" : "text-zinc-300"}>
              <td className="py-1.5 font-mono text-zinc-500">{r.rank}</td>
              <td>{r.name}</td>
              <td className="text-right font-mono">{formatSigned(r.tradingPnl)}</td>
              <td className="text-right font-mono text-zinc-500">{r.spend ? `-${formatMoney(r.spend)}` : "—"}</td>
              <td className={`text-right font-mono ${r.pnl > 0 ? "text-emerald-300" : r.pnl < 0 ? "text-rose-300" : ""}`}>{formatSigned(r.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActedChips({ view }: { view: TtView }) {
  return (
    <div className="flex flex-wrap gap-2">
      {view.players.map((p) => (
        <span key={p.id} className={`pill ${p.acted ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-white/5 text-zinc-400"}`}>
          {p.acted && <span className="mr-1">✓</span>}
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Leaderboard({ players, me }: { players: TtView["players"]; me?: string }) {
  return (
    <section className="card space-y-2">
      <h3 className="section-title">Total PnL</h3>
      <ol className="divide-y divide-white/5 text-sm">
        {players.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-3 py-1.5 ${p.id === me ? "text-zinc-50" : "text-zinc-300"}`}>
            <span className="w-5 font-mono text-zinc-500">{i + 1}</span>
            <span className="flex-1">{p.name}</span>
            <span className={`font-mono ${p.totalPnl > 0 ? "text-emerald-300" : p.totalPnl < 0 ? "text-rose-300" : ""}`}>{formatSigned(p.totalPnl)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinalTable({ view }: { view: TtView }) {
  const rows = [...view.players].sort((a, b) => b.totalPnl - a.totalPnl || a.name.localeCompare(b.name));
  const top = rows[0]?.totalPnl;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1 font-medium">Player</th>
            {view.history.map((h) => (
              <th key={h.index} className="text-right font-medium">
                R{h.index + 1} <span className="font-mono text-zinc-600">({h.sum})</span>
              </th>
            ))}
            <th className="text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((p) => (
            <tr key={p.id} className={p.totalPnl === top && rows.length > 0 ? "text-sky-300" : p.id === view.me?.id ? "text-zinc-50" : "text-zinc-300"}>
              <td className="py-1.5">
                {p.name}
                {p.totalPnl === top && <span className="ml-2 text-xs">winner</span>}
              </td>
              {view.history.map((h) => {
                const r = h.results.find((x) => x.playerId === p.id);
                return (
                  <td key={h.index} className="text-right font-mono">
                    {r ? `${formatSigned(r.pnl)}` : "—"}
                    {r && <span className="ml-1 text-xs text-zinc-500">#{r.rank}</span>}
                  </td>
                );
              })}
              <td className="text-right font-mono">{formatSigned(p.totalPnl)}</td>
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
          {formatPrice(s.cardMean * s.cardsPerRound)}).
        </li>
        {s.itemsPerRound > 0 && (
          <li>
            {s.itemsPerRound} numbers are auctioned {s.sortedInfo ? "largest first" : "in random order"}, sealed{" "}
            {s.auctionType === "FIRST_PRICE" ? "first" : "second"}-price, {s.auctionSecs}s each. Bankroll {formatMoney(s.bankroll)}
            {s.resetBankroll ? " per round" : " for the whole game"}.
          </li>
        )}
        <li>
          {s.subRounds} trade-or-tighten round{s.subRounds === 1 ? "" : "s"}: {s.quoteSecs}s to quote (each quote ≥ {s.tightenPct}% tighter
          {s.maxSpread !== null ? `, opening spread ≤ ${formatPrice(s.maxSpread)}` : ""}), then {s.tradeSecs}s to buy, sell or pass one
          lot against the tightest market.
        </li>
        <li>Round PnL = trading PnL − info spend. Total PnL decides the winner.</li>
      </ul>
    </details>
  );
}
