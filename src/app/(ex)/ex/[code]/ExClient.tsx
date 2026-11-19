"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { ExLevel, ExView } from "@/lib/ex-state";
import { exHostAction, exTrade, joinExGame } from "@/lib/ex-actions";
import { PRICE_MAX, PRICE_MIN, formatMoney, formatSignedMoney } from "@/lib/ex";
import { ActionForm } from "@/components/ActionForm";

const POLL_MS = 1000;
const MAX_LEVELS = 15;
type Result = { error?: string; ok?: boolean; filled?: number };
type Run = (fn: () => Promise<Result>) => void;

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const signedClass = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-red-300" : "text-zinc-300");
const signed = (n: number) => (n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US"));
const clampPrice = (p: number) => Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.round(p)));

export function ExClient({ initial }: { initial: ExView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [offset, setOffset] = useState(() => initial.serverNow - Date.now());
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/ex/${initial.code}`, { cache: "no-store" });
      if (!res.ok) return;
      const v: ExView = await res.json();
      setOffset(v.serverNow - Date.now());
      setView(v);
    } catch {
      /* transient network error; next poll will retry */
    }
  }, [initial.code]);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(t);
    };
  }, [refresh]);

  const run: Run = (fn) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else if (r.filled !== undefined) setNotice(r.filled > 0 ? `Filled ${r.filled.toLocaleString("en-US")}` : "Order resting");
      await refresh();
    });

  const serverNow = now + offset;

  const playing = view.status === "PLAYING";
  const errorBox = error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>;

  return (
    <div className={playing ? "flex flex-col gap-3 xl:h-[calc(100dvh-5rem)]" : "mx-auto max-w-6xl space-y-6 py-4"}>
      <StatusStrip view={view} serverNow={serverNow} />
      {!(playing && view.me) && errorBox}
      {view.status === "LOBBY" && <Lobby view={view} pending={pending} run={run} />}
      {playing && <Desk view={view} pending={pending} run={run} notice={notice} error={errorBox} />}
      {view.status === "FINISHED" && <Results view={view} />}
    </div>
  );
}

function Desk({ view, pending, run, notice, error }: { view: ExView; pending: boolean; run: Run; notice: string | null; error: React.ReactNode }) {
  const [board, setBoard] = useState(view.me === null);
  const boardToggle = view.me && (
    <button type="button" className="text-xs text-sky-300 hover:text-sky-200" onClick={() => setBoard((b) => !b)}>
      {board ? "Back to trading" : "Big scoreboard"}
    </button>
  );
  const chart = (
    <div className="panel space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{view.ticker} price</h2>
        <span className="text-xs text-zinc-500">
          <span className="text-sky-300">mid</span> · <span className="text-zinc-300">last</span> · volume{" "}
          {view.volume.toLocaleString("en-US")}
        </span>
      </div>
      <Chart points={view.chart} caseSecs={view.settings.caseSecs} className="h-40 xl:h-48" />
    </div>
  );

  if (view.isHost && board)
    return (
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)_minmax(20rem,26rem)]">
        <Trading view={view} pending={pending} run={run} notice={notice} error={error} spectate />
        <div className="order-first lg:col-span-2 xl:order-none xl:col-span-1 xl:min-h-0">
          <HostPanel view={view} pending={pending} run={run} big toggle={boardToggle} error={view.me && error} />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          {chart}
          {view.pnlHistory && (
            <div className="panel min-h-0 overflow-y-auto">
              <PnlChart history={view.pnlHistory} caseSecs={view.settings.caseSecs} className="h-56" />
            </div>
          )}
        </div>
      </div>
    );

  const cols = view.me && view.isHost ? "xl:grid-cols-[16rem_minmax(17rem,21rem)_minmax(0,1fr)_minmax(18rem,22rem)]" : "xl:grid-cols-[17rem_minmax(19rem,24rem)_minmax(0,1fr)]";
  return (
    <div className={`grid min-h-0 flex-1 gap-3 lg:grid-cols-2 ${cols}`}>
      <Trading view={view} pending={pending} run={run} notice={notice} error={error} />
      <div className="flex min-h-0 flex-col gap-3">
        {chart}
        {view.me && <Orders view={view} pending={pending} run={run} />}
      </div>
      {view.isHost && <HostPanel view={view} pending={pending} run={run} toggle={boardToggle} />}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="font-mono text-lg text-zinc-200">{children}</p>
    </div>
  );
}

function StatusStrip({ view, serverNow }: { view: ExView; serverNow: number }) {
  const me = view.me;
  return (
    <div className="panel flex flex-wrap items-center gap-x-8 gap-y-2 py-2">
      <Stat label="Game code">
        <span className="tracking-[0.25em] text-sky-300">{view.code}</span>
      </Stat>
      {view.startedAt !== null && (
        <>
          <Stat label="Case">
            {view.status === "PLAYING" && view.endsAt ? (
              <span className="text-emerald-300">Live · {clock(view.endsAt - serverNow)}</span>
            ) : (
              <span className="text-zinc-400">Closed</span>
            )}
          </Stat>
          <Stat label={view.ticker}>
            {view.last}
            <span className="ml-2 text-xs text-zinc-500">last</span>
          </Stat>
          {me && (
            <>
              <Stat label="P&L">
                <span className={signedClass(me.pnl)}>{formatSignedMoney(me.pnl)}</span>
              </Stat>
              <Stat label="Position">
                <span className={signedClass(me.pos)}>{signed(me.pos)}</span>
              </Stat>
              <Stat label="Cash">{formatMoney(me.cash)}</Stat>
              {view.status === "PLAYING" && (
                <Stat label="Open orders">
                  {me.orders.length}
                  <span className="text-xs text-zinc-500">/{view.settings.maxOpenOrders}</span>
                </Stat>
              )}
            </>
          )}
        </>
      )}
      <p className="ml-auto text-sm text-zinc-400">
        {me ? `Trading as ${me.name}${view.isHost ? " · host" : ""}` : view.isHost ? "Hosting" : null}
      </p>
    </div>
  );
}

function Lobby({ view, pending, run }: { view: ExView; pending: boolean; run: Run }) {
  const s = view.settings;
  return (
    <div className="card space-y-4 text-center">
      <h2 className="text-xl font-semibold text-zinc-50">Waiting for players</h2>
      <p className="text-sm text-zinc-500">Share the code above. Everyone opens /ex and enters it.</p>
      <p className="text-xs text-zinc-500">
        {Math.round(s.caseSecs / 60)} min case · fair moves every {s.stepSecs}s · {s.customerRate} customer orders/s · risk
        limit {s.positionLimit.toLocaleString("en-US")} · max order {s.maxOrderSize.toLocaleString("en-US")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {view.players.length === 0 && <p className="text-sm text-zinc-500">Nobody yet.</p>}
        {view.players.map((p) => (
          <span key={p} className="pill bg-white/5 text-zinc-300">
            {p}
          </span>
        ))}
      </div>
      {view.isHost && !view.me && (
        <ActionForm action={joinExGame} className="mx-auto flex max-w-xs gap-2">
          <input type="hidden" name="code" value={view.code} />
          <input className="input" name="name" placeholder="Join as a player too (name)" maxLength={30} required />
          <button className="btn-ghost shrink-0">Join</button>
        </ActionForm>
      )}
      {view.isHost && (
        <div className="flex justify-center gap-2">
          <button className="btn" disabled={pending} onClick={() => run(() => exHostAction(view.code, "start"))}>
            Open the market
          </button>
          <button className="btn-ghost" disabled={pending} onClick={() => confirm("Cancel this game?") && run(() => exHostAction(view.code, "end"))}>
            Cancel game
          </button>
        </div>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min: number; max: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <input className="input font-mono" type="number" min={min} max={max} step={1} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const validInt = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

function Trading({
  view,
  pending,
  run,
  notice,
  error,
  spectate = false,
}: {
  view: ExView;
  pending: boolean;
  run: Run;
  notice: string | null;
  error: React.ReactNode;
  spectate?: boolean;
}) {
  const canTrade = view.me !== null && !spectate;
  const maxQty = view.settings.maxOrderSize;
  const [bidQty, setBidQty] = useState("10");
  const [askQty, setAskQty] = useState("10");
  const [bidPrice, setBidPrice] = useState(() => String(view.bids[0]?.price ?? 50));
  const [askPrice, setAskPrice] = useState(() => String(view.asks[0]?.price ?? 50));
  const [edge, setEdge] = useState("0");
  const [depth, setDepth] = useState("10");

  const order = (buy: boolean, price: number | null, qty: number | null) => {
    if (price === null || qty === null) return;
    run(() => exTrade(view.code, { kind: "order", buy, price: clampPrice(price), qty }));
  };
  const bq = validInt(bidQty, 1, maxQty);
  const aq = validInt(askQty, 1, maxQty);
  const quickEdge = validInt(edge, -PRICE_MAX, PRICE_MAX) ?? 0;
  const levels = validInt(depth, 1, MAX_LEVELS) ?? 10;
  const fair = view.mid ?? view.last;

  /** Clicking a row: buy at bid + edge with the bid size, or sell at ask − edge with the ask size. */
  const quick = (l: ExLevel, rowBuy: boolean) => (rowBuy ? order(true, l.price + quickEdge, bq) : order(false, l.price - quickEdge, aq));
  /** The side button: buy at that price if it's at or below fair, else sell there. */
  const fairSide = (l: ExLevel) => (l.price <= fair ? order(true, l.price, bq) : order(false, l.price, aq));

  const row = (l: ExLevel, rowBuy: boolean) => {
    const buy = l.price <= fair;
    return (
      <div
        key={`${rowBuy ? "b" : "a"}${l.price}`}
        role={canTrade ? "button" : undefined}
        tabIndex={canTrade ? 0 : undefined}
        onClick={() => canTrade && !pending && quick(l, rowBuy)}
        onKeyDown={(e) => canTrade && e.target === e.currentTarget && e.key === "Enter" && !pending && quick(l, rowBuy)}
        className={`grid grid-cols-[4rem_1fr_1fr] items-center gap-2 px-2 py-px ${canTrade ? "cursor-pointer hover:bg-white/5" : ""} ${l.price === view.last ? "bg-white/[0.04]" : ""}`}
      >
        <button
          type="button"
          disabled={pending || !canTrade}
          onClick={(e) => {
            e.stopPropagation();
            fairSide(l);
          }}
          className={`rounded px-1 text-[11px] font-semibold uppercase ${buy ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30" : "bg-red-500/15 text-red-300 hover:bg-red-500/30"}`}
        >
          {buy ? "Buy" : "Sell"}
        </button>
        <span className={`text-center ${rowBuy ? "text-emerald-300" : "text-red-300"}`}>{l.price}</span>
        <span className="text-right text-zinc-300">
          {l.qty.toLocaleString("en-US")}
          {l.mine > 0 && <span className="ml-1 text-sky-300">[{l.mine.toLocaleString("en-US")}]</span>}
        </span>
      </div>
    );
  };

  const asks = view.asks.slice(0, levels).reverse();
  const bids = view.bids.slice(0, levels);
  const spread = view.bids[0] && view.asks[0] ? view.asks[0].price - view.bids[0].price : null;

  const settings = (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Quick-order edge" value={edge} onChange={setEdge} min={-PRICE_MAX} max={PRICE_MAX} />
      <NumberField label={`Levels (max ${MAX_LEVELS})`} value={depth} onChange={setDepth} min={1} max={MAX_LEVELS} />
    </div>
  );

  return (
    <>
      {canTrade && (
        <div className="panel flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="space-y-2">
            <h2 className="section-title">Place order</h2>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Buy qty" value={bidQty} onChange={setBidQty} min={1} max={maxQty} />
              <NumberField label="@ price" value={bidPrice} onChange={setBidPrice} min={PRICE_MIN} max={PRICE_MAX} />
            </div>
            <button type="button" className="btn btn-buy w-full" disabled={pending || bq === null || validInt(bidPrice, PRICE_MIN, PRICE_MAX) === null} onClick={() => order(true, validInt(bidPrice, PRICE_MIN, PRICE_MAX), bq)}>
              Buy
            </button>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <NumberField label="Sell qty" value={askQty} onChange={setAskQty} min={1} max={maxQty} />
              <NumberField label="@ price" value={askPrice} onChange={setAskPrice} min={PRICE_MIN} max={PRICE_MAX} />
            </div>
            <button type="button" className="btn btn-sell w-full" disabled={pending || aq === null || validInt(askPrice, PRICE_MIN, PRICE_MAX) === null} onClick={() => order(false, validInt(askPrice, PRICE_MIN, PRICE_MAX), aq)}>
              Sell
            </button>
            {notice && !pending && <p className="text-xs text-sky-300">{notice}</p>}
            {error}
          </section>
          <section className="space-y-2">
            <h2 className="section-title">Ladder</h2>
            {settings}
            <p className="text-xs text-zinc-500">
              A bid row buys at its price + edge with the buy qty; an ask row sells at its price − edge with the sell qty.
              Buy/Sell trades at that price on the fair side of the mid.
            </p>
          </section>
          <button type="button" className="btn-ghost mt-auto w-full" disabled={pending} onClick={() => run(() => exTrade(view.code, { kind: "cancelAll" }))}>
            Cancel all orders
          </button>
        </div>
      )}

      <div className="panel flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{view.ticker} ladder</h2>
          <span className="text-xs text-zinc-500">{canTrade ? "[yours] · click a row for a quick order" : "Spectating"}</span>
        </div>
        <div className="grid grid-cols-[4rem_1fr_1fr] gap-2 px-2 text-[11px] uppercase tracking-wider text-zinc-500">
          <span>Fair side</span>
          <span className="text-center">Price</span>
          <span className="text-right">Size</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/5 font-mono text-sm">
          {asks.map((l) => row(l, false))}
          <div className="border-y border-white/10 bg-white/[0.03] px-2 py-0.5 text-center text-xs text-zinc-400">
            {spread === null ? "One-sided book" : `Spread ${spread} · mid ${view.mid}`}
          </div>
          {bids.map((l) => row(l, true))}
        </div>
        {!canTrade && settings}
      </div>
    </>
  );
}

function Orders({ view, pending, run }: { view: ExView; pending: boolean; run: Run }) {
  const me = view.me!;
  return (
    <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2">
      <div className="panel flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Open orders ({me.orders.length})</h2>
          {me.orders.length > 0 && (
            <button className="text-xs text-zinc-400 hover:text-zinc-100" disabled={pending} onClick={() => run(() => exTrade(view.code, { kind: "cancelAll" }))}>
              Cancel all
            </button>
          )}
        </div>
        {me.orders.length === 0 ? (
          <p className="text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="max-h-64 min-h-0 flex-1 space-y-1 overflow-y-auto font-mono text-sm xl:max-h-none">
            {me.orders.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className={o.buy ? "text-emerald-300" : "text-red-300"}>{o.buy ? "BUY" : "SELL"}</span>
                <span className="text-zinc-300">
                  {o.qty.toLocaleString("en-US")} @ {o.price}
                </span>
                <button className="ml-auto text-xs text-zinc-500 hover:text-red-300" disabled={pending} onClick={() => run(() => exTrade(view.code, { kind: "cancel", id: o.id }))}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">
          Risk limit {view.settings.positionLimit.toLocaleString("en-US")} each way, counting open orders.
        </p>
      </div>

      <div className="panel flex min-h-0 flex-col gap-2">
        <h2 className="section-title">Fills</h2>
        {me.fills.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="max-h-64 min-h-0 flex-1 space-y-1 overflow-y-auto font-mono text-sm xl:max-h-none">
            {me.fills.map((f) => (
              <li key={`${f.id}-${f.buy}`} className="flex gap-2">
                <span className="w-10 text-zinc-500">{clock(f.at)}</span>
                <span className={f.buy ? "text-emerald-300" : "text-red-300"}>{f.buy ? "Bought" : "Sold"}</span>
                <span className="text-zinc-300">
                  {f.qty.toLocaleString("en-US")} @ {f.price}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">Most recent 50.</p>
      </div>
    </div>
  );
}

type StandingRow = NonNullable<ExView["standings"]>[number];

function Standings({ rows, detail, big = false }: { rows: StandingRow[]; detail?: { position: boolean; cash: boolean }; big?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">No players.</p>;
  const item = (r: StandingRow, i: number) => (
    <li key={r.name} className={`flex items-center gap-2 ${big ? "rounded-lg bg-white/[0.03] px-3 py-1.5" : ""} ${r.me ? "text-sky-200" : "text-zinc-300"}`}>
      <span className={`text-right ${big ? "w-7 font-semibold" : "w-5"} ${big && i < 3 ? "text-amber-300" : "text-zinc-500"}`}>{i + 1}</span>
      <span className="truncate">{r.name}</span>
      <span className="ml-auto" />
      {(detail?.position ?? true) && <span className={`font-mono text-zinc-500 ${big ? "text-sm" : "text-xs"}`}>{signed(r.position)}</span>}
      {detail?.cash && <span className={`font-mono text-zinc-500 ${big ? "text-sm" : "text-xs"}`}>{formatMoney(r.cash)}</span>}
      <span className={`text-right font-mono ${big ? "w-32" : "w-24"} ${signedClass(r.pnl)}`}>{formatSignedMoney(r.pnl)}</span>
    </li>
  );
  if (!big) return <ol className="space-y-1 text-sm">{rows.map(item)}</ol>;
  // Two columns once there are more names than fit comfortably in one, ranked down the left then the right.
  const half = rows.length > 12 ? Math.ceil(rows.length / 2) : rows.length;
  return (
    <div className={`grid gap-x-4 text-lg ${half < rows.length ? "2xl:grid-cols-2" : ""}`}>
      <ol className="space-y-1.5">{rows.slice(0, half).map(item)}</ol>
      {half < rows.length && <ol className="space-y-1.5 max-2xl:mt-1.5">{rows.slice(half).map((r, i) => item(r, i + half))}</ol>}
    </div>
  );
}

function HostPanel({
  view,
  pending,
  run,
  big = false,
  toggle,
  error,
}: {
  view: ExView;
  pending: boolean;
  run: Run;
  big?: boolean;
  toggle?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const [showPos, setShowPos] = useState(true);
  const [showCash, setShowCash] = useState(false);
  return (
    <div className={`panel flex min-h-0 flex-col gap-3 ${big ? "h-full p-5" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={big ? "text-xl font-semibold text-zinc-50" : "section-title"}>{big ? "Live scoreboard" : "Scoreboard"}</h2>
        <span className={`pill bg-amber-400/10 text-amber-300 ${big ? "text-sm" : ""}`}>Fair now: {view.fairNow ?? "—"}</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
        <label className="flex items-center gap-1">
          <input type="checkbox" className="accent-sky-400" checked={showPos} onChange={(e) => setShowPos(e.target.checked)} /> Position
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" className="accent-sky-400" checked={showCash} onChange={(e) => setShowCash(e.target.checked)} /> Cash
        </label>
        {toggle && <span className="ml-auto">{toggle}</span>}
      </div>
      {!big && view.pnlHistory && <PnlChart history={view.pnlHistory} caseSecs={view.settings.caseSecs} />}
      <div className={`min-h-0 flex-1 overflow-y-auto xl:max-h-none ${big ? "" : "max-h-96"}`}>
        {view.standings && <Standings rows={view.standings} detail={{ position: showPos, cash: showCash }} big={big} />}
      </div>
      {error}
      <button
        className="btn-ghost w-full"
        disabled={pending}
        onClick={() => confirm("End the case now? Positions are marked to the last traded price.") && run(() => exHostAction(view.code, "end"))}
      >
        End case now
      </button>
    </div>
  );
}

function Results({ view }: { view: ExView }) {
  if (view.startedAt === null) return <p className="card mx-auto max-w-sm text-center text-sm text-zinc-400">This game was cancelled.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="card space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Fair value revealed</h2>
          <span className="pill bg-amber-400/10 text-amber-300">Marked at last trade {view.last}</span>
        </div>
        <Chart points={view.chart} caseSecs={view.settings.caseSecs} fair={view.fairPath ?? undefined} stepSecs={view.settings.stepSecs} />
        <p className="text-xs text-zinc-500">
          Sky line: mid price. Amber steps: hidden fair value per step ({view.fairPath?.join(" → ")}).
        </p>
        {view.pnlHistory && <PnlChart history={view.pnlHistory} caseSecs={view.settings.caseSecs} />}
      </div>
      <div className="card h-fit space-y-3">
        <h2 className="section-title">Final standings</h2>
        {view.me && (
          <p className="text-sm text-zinc-400">
            You finished <span className={`font-mono ${signedClass(view.me.pnl)}`}>{formatSignedMoney(view.me.pnl)}</span>
          </p>
        )}
        {view.standings && <Standings rows={view.standings} />}
      </div>
    </div>
  );
}

const SERIES = ["#7dd3fc", "#fcd34d", "#86efac", "#fca5a5", "#c4b5fd", "#f9a8d4", "#5eead4", "#fdba74"];

function PnlChart({ history, caseSecs, className = "h-40" }: { history: NonNullable<ExView["pnlHistory"]>; caseSecs: number; className?: string }) {
  const W = 600;
  const H = 160;
  const values = history.points.flatMap(([, ...v]) => v);
  if (history.points.length < 2 || history.names.length === 0) return null;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const x = (sec: number) => (sec / caseSecs) * W;
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-zinc-400">P&amp;L over time</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${className}`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.12)" />
        {history.names.map((name, i) => (
          <polyline
            key={name}
            points={history.points.map((p) => `${x(p[0]).toFixed(1)},${y(p[i + 1]).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          >
            <title>{name}</title>
          </polyline>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {history.names.map((name, i) => (
          <span key={name} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Chart({
  points,
  caseSecs,
  fair,
  stepSecs,
  className = "h-[180px]",
}: {
  points: [number, number | null, number | null][];
  caseSecs: number;
  fair?: number[];
  stepSecs?: number;
  className?: string;
}) {
  const W = 600;
  const H = 180;
  const values = [...points.flatMap(([, m, l]) => [m, l].filter((v): v is number => v !== null)), ...(fair ?? [])];
  if (values.length === 0) return <div className={`grid place-items-center text-sm text-zinc-500 ${className}`}>No prices yet.</div>;
  const lo = Math.max(PRICE_MIN, Math.min(...values) - 3);
  const hi = Math.min(PRICE_MAX, Math.max(...values) + 3);
  const x = (sec: number) => (sec / caseSecs) * W;
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  const mids = points.filter((p) => p[1] !== null).map(([sec, m]) => `${x(sec).toFixed(1)},${y(m!).toFixed(1)}`);
  const lasts = points.filter((p) => p[2] !== null).map(([sec, , l]) => `${x(sec).toFixed(1)},${y(l!).toFixed(1)}`);
  const fairSteps =
    fair && stepSecs
      ? fair.flatMap((v, i) => [`${x(i * stepSecs).toFixed(1)},${y(v).toFixed(1)}`, `${x(Math.min(caseSecs, (i + 1) * stepSecs)).toFixed(1)},${y(v).toFixed(1)}`])
      : null;
  const grid = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${className}`} preserveAspectRatio="none">
      {grid.map((g) => (
        <g key={g}>
          <line x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.06)" />
          <text x={4} y={Math.min(H - 2, Math.max(10, y(g) - 2))} fontSize={10} fill="rgb(113 113 122)">
            {g}
          </text>
        </g>
      ))}
      {fairSteps && <polyline points={fairSteps.join(" ")} fill="none" stroke="rgb(252 211 77)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      <polyline points={lasts.join(" ")} fill="none" stroke="rgba(212,212,216,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polyline points={mids.join(" ")} fill="none" stroke="rgb(125 211 252)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
