# Deployment

Status: **this version is not deployed**. Staging has not been created (see `docs/FINAL_TECHNICAL_REPORT.md`, section "Staging"). Production is not validated.

## Current production (recorded on 19–20 November 2026; not verified since)

An earlier version is live at `globaltravelassi.online`:

- **Hosting:** the Vercel project `football-ai-pro-v5d9` builds production from the GitHub branch **`claude/affectionate-rubin-la5937`**, root directory `globaltravelassi`. That branch is at commit `9d5e23a` (19 November), which still has the original admin-recorded payment tracking.
- **Database:** the Supabase project `globaltravelassi`, with only `0001_init.sql` and `seed.sql` applied.
- **Consequence:** **pushing to `claude/affectionate-rubin-la5937` deploys to production.** Do not push this version there until staging has passed and migrations `0019`–`0023` and `seed_catalog.sql` are applied to production, with the owner's approval and a backup. To back up the work, push to a different branch name; Vercel normally builds other branches as preview deployments, but check the project's Git settings first.

Check the current state in Vercel → `football-ai-pro-v5d9` → Deployments before any change.

## Order

1. Create a free Supabase **staging** project. Never use the production project for staging.
2. Apply the migrations in the order in `docs/MIGRATIONS.md`, one at a time, checking the output of each.
3. Set the environment variables (`docs/ENVIRONMENT.md`) in the hosting provider. The public ones at build time.
4. Build and start: `npm ci && npm run build && npm start`. Or let the hosting provider run the same two commands.
5. Run the smoke test against the running server: `npm run test:browser`.
6. Walk through `docs/staging/STAGING_RUNBOOK.md`, sections 5 and 6.
7. Only then `docs/LAUNCH_CHECKLIST.md`, with the owner's approval.

## Rules

- Migrations are applied by hand, in order, with the owner's approval. Never edit an applied migration; add a new one.
- `NEXT_PUBLIC_SUPABASE_URL` must be set **at build time** (the content security policy uses it).
- Email delivery stays off (`EMAIL_DELIVERY_ENABLED` unset or `false`) until the SMTP check in the runbook passes.
- Do not add the Supabase `service_role` key to any environment of this project. The app does not use it.
- No DNS record is changed by this repository.

## Rollback

Migrations have rollback scripts in `docs/migrations/` (see `docs/MIGRATIONS.md`). Application rollback: redeploy the previous build. Database rollbacks are run only with the owner's approval.
