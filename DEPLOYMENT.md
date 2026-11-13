# Deployment guide (zero budget)

Target stack: **Vercel (Hobby, free)** + **Supabase (Free)**. Both are optional: the app also runs on any Node.js host, with or without a database.

## 1. Get free API keys (optional, for LIVE data)

1. football-data.org: register at https://www.football-data.org/client/register. The key is emailed to you.
2. The Odds API: https://the-odds-api.com (free plan).
3. API-Football: https://dashboard.api-football.com/register (free plan).

Without these keys the site runs in DEMO mode, clearly labelled.

## 2. Database (Supabase free tier)

1. Create a project at https://supabase.com.
2. Go to **Project Settings → Database → Connection string**, choose **URI**, and use the *transaction pooler* (port 6543) for serverless.
3. Apply the migrations from your machine:

   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" npm run db:migrate
   ```

   Alternatively, paste `database/migrations/001_init.sql` into the Supabase SQL editor.
4. The `predictions` table is written only by the server, through `DATABASE_URL`. The migration enables Row Level Security with **no policies**, so Supabase's public REST roles cannot read or write it. The server connection, as the table owner, is not affected. Do not add public policies.

## 3. Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project**, then import the repository. The framework (Next.js) is auto-detected.
3. Under **Environment Variables**, add the values from `.env.example` that you need: `FOOTBALL_DATA_API_KEY`, `ODDS_API_KEY`, `API_FOOTBALL_KEY`, `DATABASE_URL`, and optionally `DATA_MODE`.
4. Deploy. The build command is `npm run build`.

> Without `DATABASE_URL` on Vercel, the file store writes to `/tmp`, which is **ephemeral**: tracked predictions will disappear. Use Supabase for anything you want to keep.

## 4. Other free hosts

Any Node 18+ host works (Render, Railway trial, Fly.io, a VPS):

```bash
npm ci
```

```bash
npm run build
```

```bash
PORT=3000 npm start
```

## 5. After deploying

- Open `/settings` to confirm which providers are **Configured / Active** and whether the mode is LIVE or DEMO.
- `GET /api/status` shows the same information as JSON (never the keys themselves).
- Watch your quotas. The Odds API free credits are consumed per league request (responses are cached for 30 minutes). API-Football's daily quota is small: the match page uses it only for injuries and lineups (cached for 3 hours and 10 minutes respectively).

## 6. Operational notes

- Rate limits and caches are in memory and per instance. On Vercel each serverless instance keeps its own. For heavier traffic, add a shared cache or limiter (e.g. Upstash Redis free tier) and/or Vercel's firewall rules.
- Kick-off times and "today" depend on the viewer's timezone cookie, detected automatically on first visit.
- Model changes: bump `version` in `models/engine.ts`. Tracked predictions keep the version they were made with, and the unique constraint is per model version.
