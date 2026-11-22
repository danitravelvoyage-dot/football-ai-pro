# GLOBALTRAVELASSI: staging and launch guide

Date: 22 November 2026. **Production deployment requires the owner's explicit approval.** Nothing in this guide has been done yet beyond local runs.

## 1. Run locally

```bash
cd globaltravelassi
npm install
npm run dev
```

Open `http://localhost:3000`. It redirects to `/ar`; `/fr` and `/en` are the other languages.

- **Without `.env.local`:** the site uses its built-in service content, and sign-in, requests and admin are unavailable. This is how it was verified in this pass.
- **With a Supabase project:** copy `.env.example` to `.env.local`, fill in the public values, and never commit the file. The variables are described in `docs/ENVIRONMENT.md`.

Production build on your machine:

```bash
npm run build
npm start
```

Checks:

```bash
npm run verify
npm run test:browser
npm run test:admin-browser
```

The live model test is optional. It needs Ollama running with `qwen2.5:0.5b`:

```bash
LOCAL_AI_LIVE=1 npx vitest run tests/local
```

## 2. Staging (blocked: owner decision)

The Supabase free plan allows two active projects for the owner account, and the limit is reached. Free a slot or choose another route. Then follow `docs/staging/STAGING_RUNBOOK.md`:

1. Create a **new free** project. Never use `globaltravelassi`, which is production.
2. Apply, one at a time, checking each SHA-256 against `docs/migrations/manifest.json`: `0001`, `seed.sql`, `0019`, `0020`, `0021`, `0022`, `0023`, `seed_catalog.sql`.
3. Create a throwaway owner account and promote it by SQL (runbook, section 2).
4. Set the public environment variables on the staging host. Leave email off.
5. Run the logged-in checks in runbook section 5, in ar, fr and en, at desktop and phone width. Add these new checks:
   - the request list paginates and shows a priority on each row
   - the request page shows the qualification and the document checklist
   - recording a WhatsApp contact updates "Last contact" and the activity log
   - the theme switch works and is remembered
   - an unknown service URL answers 404
6. Email on staging, with a test mailbox only (runbook, section 6).

## 3. Before production (owner approval at each step)

1. **Back up the production database**, and test a restore.
2. In Vercel → `football-ai-pro-v5d9` → Deployments, record which commit is live (expected `9d5e23a`).
3. Apply `0019`–`0023` and `seed_catalog.sql` to production, in order.
4. Decide the open items:
   - the WhatsApp number (three values in the records)
   - the DZD prices or "Price on request"
   - which account is admin
   - the legal texts and retention periods
   - SMTP
5. **Only then** bring the new code to the production branch.
   - Vercel builds production from `claude/affectionate-rubin-la5937`, so **any push there deploys**.
   - Push backups to a different branch name.

## 4. First week after launch

As in `docs/LAUNCH_CHECKLIST.md`:
- check the customer email log daily
- check the hosting logs
- check new requests, their priorities and their sources

## Environment template

`.env.example` is unchanged in this pass. No new variable is needed. `NEXT_DIST_DIR` is used only by the admin browser test and must stay unset in real environments.
