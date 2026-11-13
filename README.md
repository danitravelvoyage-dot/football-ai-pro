# FOOTBALL AI PRO

**Statistical football analytics and betting-market intelligence, built on transparent models and real data sources. Arabic (default, RTL) and English (LTR).**

> ⚠️ Probabilities are model estimates. Nothing on this platform is guaranteed. Positive expected value depends on the model being right and never guarantees profit. 18+. Bet responsibly.

---

## What it does

| Page | What you get |
|---|---|
| **Dashboard** (`/`) | Today's, tomorrow's, live (when the provider supports it) and upcoming matches with model 1X2 bars, KPIs, the best positive-EV selections and competition shortcuts |
| **Today's Matches** (`/matches`) | Date picker, previous/next day, league, country, status and team search filters (plain GET form, works without JavaScript) |
| **Match Analysis** (`/matches/[id]`) | 1X2 (always totals exactly 100%), model xG, model vs bookmaker market, goals markets (O/U 0.5–4.5), BTTS, correct-score heat-map, first half, team goals, double chance, Asian handicap, corners and cards (only if the provider supplies stats), advanced stats, form, H2H, team intelligence, data-grounded AI report, prediction tracking |
| **Betting Markets** (`/markets`) | Full market breakdown with fair odds for upcoming matches |
| **Value Bets** (`/value`) | EV / margin-removal / Kelly calculator and a model-vs-market scanner |
| **Team Statistics** (`/teams`, `/teams/[id]`) | Team lists per competition, form, home/away splits, goals trend, xG (when available), squad, upcoming fixtures |
| **League Statistics** (`/leagues/[code]`) | Standings (total/home/away), scoring patterns, a walk-forward model backtest and a calibration chart |
| **Prediction History** (`/history`) | Immutable tracked predictions, auto-settlement, accuracy, per-market hit rate, Brier score, log loss, ROI and CLV |
| **Methodology** (`/methodology`) | How every number is produced, and its limitations |
| **Settings** (`/settings`) | Language, timezone, default Kelly fraction and bankroll, provider status |

## Quick start

Requirements: Node.js 18.18+ (20+ recommended).

```bash
npm install
```

```bash
cp .env.example .env.local   # optional — without keys you get DEMO mode
```

```bash
npm run dev
```

Open http://localhost:3000. The interface opens in Arabic; use the language button to switch to English.

### Verify everything (lint, type check, tests, production build)

```bash
npm run verify
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint (Next.js rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (probability engine, betting maths, metrics, demo data) |
| `npm run db:migrate` | Apply SQL migrations to `DATABASE_URL` |

## Data sources (all free tiers)

| Provider | Used for | Env var | Notes |
|---|---|---|---|
| [football-data.org](https://www.football-data.org) v4 | Fixtures, results, half-time scores, standings, H2H, squads | `FOOTBALL_DATA_API_KEY` | Free tier covers PL, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, World Cup, Euros (and a few others) at ≈10 requests/minute. **No odds, xG, injuries, corners or cards.** The Europa League is not in the free tier. |
| [The Odds API](https://the-odds-api.com) v4 | Bookmaker 1X2 and over/under 2.5 odds | `ODDS_API_KEY` | Monthly credit quota. One request per league, cached for 30 minutes. |
| [API-Football](https://www.api-football.com) v3 | Injuries, suspensions, official lineups | `API_FOOTBALL_KEY` | Small daily quota. The free plan may restrict seasons; restrictions show as "unavailable". |
| Understat | xG | — | **Not integrated.** No official public API, and we do not scrape. |
| Sofascore | Live stats | — | **Not integrated.** No officially permitted public API. |

> **Check the limits yourself:** provider free-tier terms change. The integrations follow each provider's published v3/v4 API. The development sandbox for this project could not reach the provider websites, so the limits above could not be re-confirmed during the build. Check each provider's pricing page before you rely on them.

**Rules the code enforces**

- API keys are read only on the server (`lib/env.ts` imports `server-only`). They are never sent to the browser, and `/api/status` reports only whether each key is configured.
- Every provider response carries a provenance envelope (provider, fetch time, cached/live, DEMO flag), shown next to the data.
- Missing capabilities return an explicit `Unavailable` value with a translated reason. They are never filled with estimates.
- Outbound token-bucket rate limiting per provider, in-memory TTL caching, de-duplication of in-flight requests, and stale-cache fallback when an upstream call fails.
- **DEMO mode** (no keys, or `DATA_MODE=demo`): a deterministic simulated dataset with real club names. It is labelled DEMO on every page, every source badge and every report. DEMO never shows matches as in play. Fixtures more than 2 hours past kick-off get a deterministic simulated result so the tracker can be demonstrated.

## Prediction engine

`models/` (pure TypeScript, unit-tested):

1. **Ratings** (`models/ratings.ts`): a time-weighted multiplicative Poisson model (Maher / Dixon–Coles), solved by iterative proportional fitting. It produces attack and defence ratings per team, an estimated home advantage, shrinkage toward the league average, exponential form decay (120-day half-life), and a 60/40 xG/goals blend when xG exists. Only matches **before** the prediction time are used.
2. **Goal model** (`models/poisson.ts`): Poisson score matrix (0–10 goals) with a Dixon–Coles low-score correction (ρ = −0.06), renormalised to sum to 1.
3. **Markets** (`models/engine.ts`): 1X2, double chance, totals, BTTS, correct score, team goals, first half (the half-time share of goals is estimated from data, otherwise a flagged prior), Asian handicap (whole, half and quarter lines with push; hidden when data quality is LOW), and corners/cards (only when the provider supplies stats for at least 5 matches per team).
4. **Head-to-head**: a low-weight feature capped at ±5% on expected goals, used only with 3 or more meetings.
5. **Data quality score** (0–100%): based on sample sizes and xG availability. It gates value labels and Asian handicap lines.
6. **Extensibility**: `PredictionModel` interface + `registerModel()`, so a machine-learning model can be added, given a version string, and evaluated by the same tracker and backtest.

Displayed 1X2 percentages use largest-remainder rounding, so they **always total exactly 100.0%** (tested).

### Value bets

- `EV = (model probability × decimal odds) − 1`
- Bookmaker margin removal: power method (default) and proportional.
- **Value label rule:** EV must stay positive **after subtracting one standard error** from the model probability, i.e. `(p − SE) × odds − 1 > 0`, **and** data quality ≥ 45% **and** the model is no more than 10 percentage points above the margin-free market (larger gaps are flagged as "likely model error / missing information"). Both the spec's EV and the conservative EV are displayed.
- **Why:** walk-forward simulation showed the model's probability error (RMSE against true probabilities) is about 9.4 points at 5 matches per team and about 7.7–7.9 points at 10–16 matches. That is larger than a bookmaker's margin, so a plain `EV > 0` rule labelled about 40% of selections as "value", and all of them had negative true EV against a well-informed market. The uncertainty is modelled as `SE(n) = 0.05 + 0.10/√n`.
- Kelly: `f* = (b·p − q)/b`, offered only as fractional Kelly (10/25/50%) and hard-capped at 5% of bankroll.

### AI match report

`services/report.ts` builds the report from deterministic bilingual templates filled **only** with the retrieved and computed numbers shown on the page. It covers each side's case, draw factors, statistical advantages, missing players, tactical context (possession, shots, rest days, congestion), goal expectations, market interpretation, and uncertainty. No LLM invents facts and no psychological claims are made. An LLM summariser could be added later on top of the same structured evidence.

## Prediction tracker and database

- `POST /api/predictions { matchId, market, odds? }`: probabilities are **recomputed on the server** at record time. The client cannot submit probabilities. Recording is rejected once kick-off has passed, and duplicates (match + market + model version) are rejected.
- Settlement happens automatically on `GET /api/predictions` or when the History page loads. Only result columns are written.
- **PostgreSQL** (`database/migrations/001_init.sql`): `predictions` table with CHECK constraints, a unique constraint, and a **trigger that raises on any change to prediction columns**. Closing odds can only be written before kick-off. There is also an optional `provider_cache` table.
- Without `DATABASE_URL`: a JSON file store at `.data/predictions.json`, with the same rules enforced in code. It is for development only.

Metrics: 1X2 accuracy (argmax), hit rate per market, multi-class Brier score, log loss, ROI on unit stakes, and closing-line value (when closing odds were captured).

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/matches?from&to&tz&league&country&q&status&predictions=1` | Matches (range ≤ 10 days), optionally with model 1X2 |
| GET | `/api/matches/:id` | Full analysis: model, markets, stats, context, odds and sources |
| GET | `/api/predictions` | History and summary metrics (settles finished matches) |
| POST | `/api/predictions` | Track a prediction (`{ matchId, market, odds? }`) |
| POST | `/api/value` | EV / margin removal / Kelly calculator |
| GET | `/api/backtest/:code` | Walk-forward backtest for a competition |
| GET | `/api/status` | Provider configuration (no secrets), cache and quota state |

All inputs are validated with Zod. `/api/*` is rate-limited per IP in `middleware.ts` (120 reads and 20 writes per minute) and write bodies are capped at 10 KB. Security headers are set in `next.config.mjs`.

## Project structure

```
app/            Next.js App Router pages and API routes
components/     UI (client) components, charts (Recharts), i18n provider
lib/            i18n (ar/en dictionaries), betting maths, metrics, cache, rate limiting, env, dates
models/         Poisson / Dixon–Coles engine, team ratings (pure, tested)
services/       Analysis orchestration, report generator, backtest, providers (football-data, odds, api-football, DEMO)
database/       Prediction store (PostgreSQL or file) and SQL migrations
types/          Shared domain types
tests/          Vitest unit tests
scripts/        Migration runner
```

## Internationalisation

- Arabic is the default (`<html lang="ar" dir="rtl">`); English is LTR. The choice is stored in a cookie and the switcher appears on every page.
- `lib/i18n/ar.ts` is typed against `en.ts`, so a missing translation is a compile error.
- Layout uses logical CSS properties (`ms-`, `pe-`, `start-`…). Numbers use Latin digits wrapped in Unicode LTR isolates inside Arabic sentences. Charts always render LTR.
- The viewer's timezone is detected on first visit (cookie) and can be changed in Settings. It decides what "today" means.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) (Vercel + Supabase, both free tiers).

## Limitations

- The model does not see weather, referees, tactics, travel, or team news the providers do not report.
- On the football-data.org free tier there is no xG, shot or corner data, so those sections show "not supplied".
- In-memory caches and rate limits are per server instance. For multi-instance deployments, put a shared store (e.g. Redis) or the platform firewall in front.
- Football is highly random: even a 70% favourite fails to win about 3 times in 10.
