# Friends Market

Paper-money parimutuel betting for a group of friends. Next.js 16 + Prisma 7 + Postgres + Auth.js (Google).

## How it works

- **Markets** are yes/no (any two labels, e.g. Over/Under) or multiple choice. Each has a fixed stake `$x`.
- **Bets** are exactly `$x` per outcome. You may bet on more than one outcome but not all of them. Bets cannot be changed or cancelled.
- **Resolution**: the market maker (or an admin) picks the winning outcome. The whole pool is split among winners in proportion to stake: with `$y` on the winner out of a `$(y+n)` pool, each winner gets `(y+n) * x / y`. Rounding cents go to the largest winning bet. If nobody picked the winner, all stakes are refunded.
- **Admin override**: admins can re-resolve (reverses the earlier payouts) or void (refund everyone) any market.
- **Money**: all balances are paper money tracked in an append-only ledger. Users file deposit/withdrawal requests (Zelle/Venmo/cash) and the admin approves them; the admin can also adjust any balance directly.

## Price Is Right (group question game)

A second, login-free system lives at `/answer`, `/game` and `/host`, gated by a shared password (`GAME_PASSWORD`;
`GAME_HOST_PASSWORD` optionally protects `/host`).

- **Answers are zero-knowledge.** `/answer` asks numeric questions ("How many siblings do you have?") with a
  *Prefer not to answer* option. Submitting only increments per-question aggregates (`sum`, `answered`, `skipped`);
  no individual answer is ever written anywhere. A cookie remembers which questions this browser already answered.
- **Hosting.** `/host` adds/archives questions (showing how many answered, never the totals) and creates a game from a
  set of questions, yielding a 4-letter code.
- **Playing.** Players open `/game`, enter the code and a name. Each round shows a question; everyone locks in a guess
  for the group total. The answer reveals automatically when everyone has guessed, or when the host force-reveals.
  Scoring is *closest without going over* (Price Is Right rules) or *closest wins*, one point per round.
- Live updates are polled from `GET /api/game/[code]` every 1.5s, so it works on Vercel without websockets.

## Trade or Tighten (market-making game)

A third login-free game lives at `/tt` (join) and `/tt/host` (create), behind the same `GAME_PASSWORD` /
`GAME_HOST_PASSWORD` gate.

- **Rooms.** Players are split into rooms (default 4) at the start of each round: random in round 1, then by
  per-game Elo (start 1200, updated from round scores within the room) so the strongest players sit together.
- **Contract.** Each room's contract is the sum of N hidden numbers (default 4) drawn from a public distribution:
  skewed `⌈100·U²⌉` (mean ≈ 34) or uniform 1–100. Numbers are never sent to clients until the room settles.
- **Info auction.** Once per round, everyone submits bids (0–100) for the largest, 2nd, 3rd and 4th largest number at
  once. Settled largest first, second-price among eligible players; a winner and their remaining bids drop out, so each
  player wins at most one and the last player left gets theirs free.
- **Trade or tighten × N cycles** (default 2). Players propose a spread *width*; each must be at least X% (default
  10%) tighter. The decision timer restarts on every tighten and the phase ends early once everyone else says
  "I'm out". The tightest player posts `bid @ bid+width` (auto-centered on the prior mean if they time out); everyone
  else buys at the ask, sells at the bid, or passes one lot, revealed when trading ends. No proposals → no market.
- **Scoring.** Trading PnL is normalized to 0–100 within the room (max = 100, min = 0, all equal = 50), then info cost
  is subtracted. Round scores add up across rounds (default 4).
- Timers are enforced server-side: the state endpoint `GET /api/tt/[code]` (polled every second) advances any expired
  room phase or between-round break. Each room has its own `seq` + row lock so concurrent pollers advance once. The
  host can watch any room, skip timers or end the game. Rules live in `src/lib/tt.ts`, the phase machine and views in
  `src/lib/tt-state.ts`.

Admins can wipe all betting data (markets, bets, ledger, payments; balances zeroed) from the **Danger zone** on `/admin`.

## Local development

```bash
cp .env.example .env            # fill in the values
docker run -d --name betting-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=betting -p 5432:5432 postgres:16
npm install
npx prisma migrate dev          # creates tables
npx prisma db seed              # optional demo users/markets
npm run dev
```

Set `DEV_LOGIN_ENABLED="true"` in `.env` to sign in without Google at
`http://localhost:3000/api/dev-login?email=alice@example.com` (development only; the route 404s in production).

## Google sign-in

1. Create an OAuth client at <https://console.cloud.google.com/apis/credentials> (type: Web application).
2. Add redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://<your-domain>/api/auth/callback/google`.
3. Put the client id/secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and `npx auth secret` for `AUTH_SECRET`.
4. Put your email in `ADMIN_EMAILS` — you become admin on first sign-in.

## Deploy (Vercel + Neon)

1. Create a Postgres DB on Neon (or Supabase) and copy the connection string.
2. Import the repo into Vercel, set the env vars from `.env.example`. On Neon, set `DATABASE_URL` to the
   pooled connection string and `DIRECT_DATABASE_URL` to the unpooled one (same URL without `-pooler`) so
   `prisma migrate deploy` doesn't time out acquiring its advisory lock. If it still times out (P1002 — a stale
   session holding the lock, or the Neon compute waking up), also set `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1`;
   Vercel runs one production build at a time, so the lock isn't needed there.
3. Set the build command to `prisma migrate deploy && next build` (or run `npm run db:migrate` once by hand).

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm test` — payout math tests
- `npm run lint`, `npm run typecheck`
- `npm run db:migrate` — apply migrations in production
