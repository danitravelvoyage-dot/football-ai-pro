# GLOBALTRAVELASSI recovery index

Snapshot: commit `cf6e966` on the local branch `feature/ai-marketing-command-center`, 22 November 2026. Links are relative to this folder (`globaltravelassi/docs/recovery/`). Paths starting with `/` are inside the cloud container and disappear when it is reclaimed.

## 1. Recovery documents

- [Recovery report](GLOBALTRAVELASSI_RECOVERY_REPORT.md): findings, production setup, discrepancies, next steps
- [Project inventory](GLOBALTRAVELASSI_PROJECT_INVENTORY.md): structure, modules, database, API, auth, email, WhatsApp, tests, deployment

## 2. Recovered material outside the repository

| Item | Container path | Status |
|---|---|---|
| Git bundle, all branches, complete history (1,264,466 bytes; SHA-256 `131bd18575c4bcdf94d77f378b0b2323901050721bc2e554b0d0d1b0b75d0554`) | `/tmp/claude-0/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc/scratchpad/recovery/GLOBALTRAVELASSI_football-ai-pro_all-branches_2026-11-22.bundle` | Verified; attached to the reply |
| 19 November project summary | `…/scratchpad/globaltravelassi-summary.md` and `…/scratchpad/globaltravelassi-summary.pdf` | Not sent. Names a personal admin address. |
| Session transcript (180 of your messages, 18–22 Nov) | `/root/.claude/projects/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc.jsonl` | Indexed below (section 8) |
| Screenshots pasted on 19 Nov (60) | `/tmp/claude-0/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc/images/` | Not opened or copied; they may show keys |
| Working screenshots (37) and verification logs (38) | `…/scratchpad/` and `…/scratchpad/qa/` | Historical UI states, 18–22 Nov |
| Uploaded video (19 Nov, marketing) | `/root/.claude/uploads/4cf94d32-15d6-5e59-9953-59ef414f16dc/79c5b732-WhatsApp_Video_2026-11-19_at_16.36.03.mp4` | Not source code |

## 3. Implementation reports and project documents

| Document | What it is |
|---|---|
| [docs/FINAL_TECHNICAL_REPORT.md](../FINAL_TECHNICAL_REPORT.md) | Final report of the 21 Nov launch pass |
| [PROJECT_STATUS.md](../../PROJECT_STATUS.md) | Chronological log of every phase (32 sections) |
| [docs/COMPLETION_CHECKLIST.md](../COMPLETION_CHECKLIST.md) | Built and tested versus verified live |
| [docs/LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md) | Production launch checklist |
| [README.md](../../README.md) | Overview and local commands |
| [DEPLOYMENT.md](../../DEPLOYMENT.md) | Deployment order for the new version (lacks the live setup) |
| [docs/MIGRATIONS.md](../MIGRATIONS.md) | Migration order |
| [docs/ENVIRONMENT.md](../ENVIRONMENT.md) | Environment variables |
| [docs/EMAIL_NOTIFICATIONS.md](../EMAIL_NOTIFICATIONS.md) | Email system |
| [docs/ADMIN_GUIDE.md](../ADMIN_GUIDE.md) | Current admin guide |
| [docs/PRIVACY_AND_COOKIES.md](../PRIVACY_AND_COOKIES.md) | Privacy working notes |
| [docs/staging/STAGING_RUNBOOK.md](../staging/STAGING_RUNBOOK.md) | Staging steps (not started) |
| [docs/security/CONTENT_SECURITY_POLICY.md](../security/CONTENT_SECURITY_POLICY.md), [docs/security/REDIRECT_SECURITY.md](../security/REDIRECT_SECURITY.md) | Security notes |
| [ADMIN_GUIDE.md](../../ADMIN_GUIDE.md), [PLAN.md](../../PLAN.md), [docs/staging/execution-plan.md](../staging/execution-plan.md) | Outdated or historical |
| [SCHEDULER.md](../../SCHEDULER.md), [docs/migrations/0018_backup_procedure.md](../migrations/0018_backup_procedure.md) | AI back office (deferred) |

## 4. Important source files

| Area | Files |
|---|---|
| Per-request work | [middleware.ts](../../middleware.ts), [next.config.mjs](../../next.config.mjs) |
| Settings and WhatsApp | [lib/config.ts](../../lib/config.ts) |
| Translations | [lib/i18n/ar.ts](../../lib/i18n/ar.ts), [lib/i18n/fr.ts](../../lib/i18n/fr.ts), [lib/i18n/en.ts](../../lib/i18n/en.ts) |
| Services | [lib/services-content.ts](../../lib/services-content.ts), [app/[locale]/services/[slug]/page.tsx](../../app/%5Blocale%5D/services/%5Bslug%5D/page.tsx) |
| Service request | [app/[locale]/apply/page.tsx](../../app/%5Blocale%5D/apply/page.tsx), [lib/actions/applications.ts](../../lib/actions/applications.ts) |
| Documents | [lib/actions/documents.ts](../../lib/actions/documents.ts), [lib/documents/signature.ts](../../lib/documents/signature.ts), [app/[locale]/documents/[id]/route.ts](../../app/%5Blocale%5D/documents/%5Bid%5D/route.ts) |
| Admin and CRM | [lib/actions/admin.ts](../../lib/actions/admin.ts), [lib/queries.ts](../../lib/queries.ts), [app/[locale]/admin/applications/[id]/page.tsx](../../app/%5Blocale%5D/admin/applications/%5Bid%5D/page.tsx), [app/[locale]/admin/reports/export/route.ts](../../app/%5Blocale%5D/admin/reports/export/route.ts), [lib/csv.ts](../../lib/csv.ts) |
| Lead attribution | [lib/attribution/lead-source.ts](../../lib/attribution/lead-source.ts), [lib/attribution/cookie.ts](../../lib/attribution/cookie.ts) |
| Auth | [lib/auth.ts](../../lib/auth.ts), [lib/actions/auth.ts](../../lib/actions/auth.ts), [lib/supabase/server.ts](../../lib/supabase/server.ts), [app/[locale]/auth/callback/route.ts](../../app/%5Blocale%5D/auth/callback/route.ts) |
| Email | [lib/email/kinds.ts](../../lib/email/kinds.ts), [lib/email/service.ts](../../lib/email/service.ts), [lib/email/templates.ts](../../lib/email/templates.ts), [lib/email/transport.ts](../../lib/email/transport.ts) |
| Security | [lib/security/csp.ts](../../lib/security/csp.ts), [lib/security/redirect.ts](../../lib/security/redirect.ts) |
| Domain types | [lib/domain.ts](../../lib/domain.ts), [lib/validation/schemas.ts](../../lib/validation/schemas.ts) |
| Environment template | [.env.example](../../.env.example) |

## 5. Migration files

| Files | Scope |
|---|---|
| [0001_init.sql](../../supabase/migrations/0001_init.sql), [seed.sql](../../supabase/seed.sql) | Applied in production, 19 Nov (owner report; unchanged since) |
| `0002`–`0018` in [supabase/migrations/](../../supabase/migrations/) | AI back office, applied nowhere |
| [0019_manual_payments.sql](../../supabase/migrations/0019_manual_payments.sql) | Historical payments; required by 0022 |
| [0020_customer_hardening.sql](../../supabase/migrations/0020_customer_hardening.sql) | Customer launch |
| [0021_customer_email_notifications.sql](../../supabase/migrations/0021_customer_email_notifications.sql) | Customer launch |
| [0022_remove_payment_workflow.sql](../../supabase/migrations/0022_remove_payment_workflow.sql) | Customer launch |
| [0023_crm_attribution_requests.sql](../../supabase/migrations/0023_crm_attribution_requests.sql) | Customer launch |
| [seed_catalog.sql](../../supabase/seed_catalog.sql) | Five new services |
| [docs/migrations/](../migrations/) (rollbacks 0018–0023), [manifest.json](../migrations/manifest.json) | Rollback and integrity (29/29 checksums match) |
| [supabase/templates/confirmation.html](../../supabase/templates/confirmation.html), [recovery.html](../../supabase/templates/recovery.html) | Supabase Auth emails |

## 6. Tests

There is no separate test document. Testing is described in [README.md](../../README.md) (`npm run verify`), [docs/FINAL_TECHNICAL_REPORT.md](../FINAL_TECHNICAL_REPORT.md), [PROJECT_STATUS.md](../../PROJECT_STATUS.md) and the manual checks in [docs/staging/STAGING_RUNBOOK.md](../staging/STAGING_RUNBOOK.md).

| Suite | Location |
|---|---|
| Browser smoke (30 checks) | [tests/browser/smoke.mjs](../../tests/browser/smoke.mjs) |
| Database (PGlite) | [tests/db/](../../tests/db/), e.g. [customer-sequence.test.ts](../../tests/db/customer-sequence.test.ts), [payment-removal-crm.test.ts](../../tests/db/payment-removal-crm.test.ts), [rls.test.ts](../../tests/db/rls.test.ts) |
| Actions | [tests/actions/](../../tests/actions/) |
| Email | [tests/email/](../../tests/email/) |
| Security | [tests/security/](../../tests/security/) |
| Launch checks (WhatsApp, payments removed) | [tests/launch/whatsapp-and-payments-removed.test.ts](../../tests/launch/whatsapp-and-payments-removed.test.ts) |
| Other unit tests | [tests/attribution/](../../tests/attribution/), [tests/documents/](../../tests/documents/), [tests/legal/](../../tests/legal/), [tests/services/](../../tests/services/), [tests/csv.test.ts](../../tests/csv.test.ts), [tests/i18n.test.ts](../../tests/i18n.test.ts), [tests/validation.test.ts](../../tests/validation.test.ts) |
| AI back office (deferred) | [tests/ai/](../../tests/ai/) |

Last run, 22 Nov: lint and typecheck pass; 1,361 tests passed and 3 skipped (opt-in live model); build passes; browser smoke 30/30.

## 7. Git commits

Repository `https://github.com/danitravelvoyage-dot/football-ai-pro`. "GitHub" means the commit is on GitHub; "local" means it exists only in this container and in the delivered bundle. Times are UTC.

| Commit | Date | Subject | Where |
|---|---|---|---|
| [`c8b2f74`](https://github.com/danitravelvoyage-dot/football-ai-pro/commit/c8b2f7464771b9f6b884f9074ca0559cc6962e2d) | 2026-11-18 18:33 | Add GLOBALTRAVELASSI travel and visa platform (globaltravelassi/) | GitHub |
| [`001e052`](https://github.com/danitravelvoyage-dot/football-ai-pro/commit/001e052a6e9157c98776d620d537b8c6f0e9110a) | 2026-11-19 07:36 | Document Vercel deployment branch and root directory | GitHub |
| [`f45a710`](https://github.com/danitravelvoyage-dot/football-ai-pro/commit/f45a71029ce44c59b2a2c4b537f9a4c2549b72c7) | 2026-11-19 09:01 | Replace VISORA branding with GLOBALTRAVELASSI | GitHub |
| [`9d5e23a`](https://github.com/danitravelvoyage-dot/football-ai-pro/commit/9d5e23aa91bbfde4ed5087ddeb3ae7bc039b277c) | 2026-11-19 09:13 | Redesign homepage with new brand identity (production source) | GitHub |
| `70aab94` | 2026-11-20 07:16 | Add AI command center: orchestration engine, approvals and admin dashboard | local |
| `031dcd8` | 2026-11-20 07:41 | Add phase 2 agent infrastructure: paginated task reads, event bus, shared context, knowledge base | local |
| `da99b2f` | 2026-11-20 08:09 | Validate context input with Zod and forbid event spoofing | local |
| `f3890f1` | 2026-11-20 08:29 | Add approval engine: action-class expiry, payload binding, owner-only decisions | local |
| `7f36390` | 2026-11-20 08:47 | Add quality controller and a single canonical JSON contract for approval fingerprints | local |
| `4502773` | 2026-11-20 09:16 | Add agent observability: monitoring figures, cost policy, system health and alerts | local |
| `8e89dfe` | 2026-11-20 09:29 | Add business memory: owner decisions, experiments, learning with evidence, business profile | local |
| `26ee6ec` | 2026-11-20 09:39 | Add business memory dashboard, owner thresholds, and append-only hardening | local |
| `c7c1e58` | 2026-11-20 13:15 | Fix stuck pending state on admin forms after a successful save | local |
| `6ce8492` | 2026-11-20 21:38 | Add autonomous scheduler: persistent job queue, leases and recovery | local |
| `e16272d` | 2026-11-20 21:38 | Add scheduler admin page, translations and status report | local |
| `c94c7fc` | 2026-11-20 22:48 | Connect business memory to agents and add owner notifications | local |
| `5cf4a94` | 2026-11-21 05:58 | Complete owner notifications: inbox, filters, watchdog and owner report | local |
| `e7b0b57` | 2026-11-21 06:08 | Add campaigns, content review, knowledge admin and owner summary | local |
| `a00f185` | 2026-11-21 06:50 | Add provider reliability, knowledge ranking, analytics and execution trace | local |
| `56f972d` | 2026-11-21 07:25 | Add CRM and sales pipeline (AI): leads, stages, history, scoring and follow-up approval | local |
| `b52b408` | 2026-11-21 07:35 | Add competitor intelligence phase 1 | local |
| `05ef4d3` | 2026-11-21 07:59 | Audit fixes; daily business reports and browser smoke test | local |
| `0918ee6` | 2026-11-21 08:21 | Multi-agent intelligence | local |
| `ba8780d` | 2026-11-21 09:08 | Multi-agent autonomy | local |
| `c6ecbc9` | 2026-11-21 10:25 | CEO readiness audit | local |
| `49ad3cb` | 2026-11-21 11:37 | Local AI activation (qwen2.5:0.5b) | local |
| `d8eea40` | 2026-11-21 11:45 | Local AI: JSON requests, prompt fix, live tests | local |
| `6b6aa09` | 2026-11-21 12:13 | AI quality and fact validation | local |
| `148faec` | 2026-11-21 12:39 | Owner approval center: review items | local |
| `43cfeca` | 2026-11-21 13:13 | Owner approval center: UI and source registry | local |
| `a27a042` | 2026-11-21 13:25 | Approval security hardening | local |
| `0320c8e` | 2026-11-21 13:38 | Staging readiness and audit integrity; migration manifest | local |
| `5321ec7` | 2026-11-21 14:21 | Manual payment system | local |
| `475a116` | 2026-11-21 14:28 | Manual payments: final hardening | local |
| `2293b61` | 2026-11-21 16:54 | Payment security remediation (WIP) | local |
| `6f936b8` | 2026-11-21 17:09 | Payment security remediation: verified locally | local |
| `8480909` | 2026-11-21 17:45 | Fix open redirects and add report-only CSP (phase 1) | local |
| `09702ba` | 2026-11-21 19:24 | Nonce-based script policy for CSP (phase 2) | local |
| `5f81999` | 2026-11-21 20:17 | Launch preparation: security hardening and customer email system | local |
| `cf6e966` | 2026-11-21 22:54 | Customer launch: remove payments, add CRM, attribution and service pages | local |

The other 7 commits (`49ba979`…[`95b4c55`](https://github.com/danitravelvoyage-dot/football-ai-pro/commit/95b4c55b4e59311cfdc2b0e172027aa9aafcd389), 13 Nov) belong to the football app on `main`. Commit `8b04ed1` is an unreachable duplicate of `56f972d`.

## 8. History outside the repository

| Source | Reference |
|---|---|
| GitHub repository | https://github.com/danitravelvoyage-dot/football-ai-pro (branches `main`, `claude/affectionate-rubin-la5937`) |
| Vercel project (production) | https://vercel.com/dani-782a/football-ai-pro-v5d9 |
| Supabase project (production) | https://supabase.com/dashboard/project/feknppmxasoxmwplxvpa (`globaltravelassi`); paused project `visa-ready-dz` (`pcreairqaqxistybmnnb`) |
| VISORA project files (separate project) | https://claude.ai/artifact/UKo9PcjuX9jaG6HEFV4EwT |
| VISORA prepayment poster | https://claude.ai/artifact/453iuAzUqby1k9riRV6MhQ |
| VISORA sessions | `session_01E2xEFWiF4LHy3GdjRLSAPG`, `session_01E2xEFY6WHJy4S6GzZQPjh3` |
| UI/UX skill session (unpushed commit `27a027c`) | `session_01E2xEFZWfcfTYKiCkmGBoTX` |
| This session | `session_01E2xEFax5Mtx3sekBYBDWem` |

Key instructions in the transcript (#n = order of your messages; UTC):

| # | Time | Content |
|---|---|---|
| 1 | 2026-11-18 18:11 | Original platform brief |
| 7 | 2026-11-19 05:14 | Database SQL run in Supabase ("Success. No rows returned") |
| 60–61 | 2026-11-19 08:32 | Domain `globaltravelassi.online` bought |
| 73 | 2026-11-19 08:51 | WhatsApp number `+84852462510` |
| 79 | 2026-11-19 08:59 | Remove VISORA branding |
| 84 | 2026-11-19 09:04 | Complete brand transformation |
| 86 | 2026-11-19 09:18 | Live admin URL on `globaltravelassi.online` |
| 89–90 | 2026-11-19 09:22 | Forgotten password; account email not arriving |
| 103 | 2026-11-20 06:47 | Earlier recovery request (answered 06:48) |
| 104 | 2026-11-20 06:50 | Phase 1: production names (Vercel `football-ai-pro-v5d9`, Supabase `globaltravelassi`) |
| 105–106 | 2026-11-20 06:56 | Autonomous AI company, master directive |
| 115 | 2026-11-20 08:23 | Keep branch `feature/ai-marketing-command-center`; push forbidden |
| 158 | 2026-11-21 14:11 | Manual payments (USDT, BaridiMob, RedotPay) |
| 170 | 2026-11-21 17:41 | Pre-staging security; customer scope only |
| 171 | 2026-11-21 19:17 | Nonce-based CSP |
| 172 | 2026-11-21 19:55 | Launch readiness (security hardening, email) |
| 173 | 2026-11-21 22:28 | Final launch brief: remove payments, CRM, attribution, nine services |
| 175 | 2026-11-22 13:06 | Local start; warning that Visora is a different project |
| 180 | 2026-11-22 13:21 | This recovery |

## 9. Recovery commands

Restore the full history from the bundle, on any computer:

```bash
git clone GLOBALTRAVELASSI_football-ai-pro_all-branches_2026-11-22.bundle globaltravelassi-recovered -b feature/ai-marketing-command-center
```

Show a file deleted in `cf6e966`, from the commit before it:

```bash
git show 5f81999:globaltravelassi/lib/actions/payments.ts
```

List every commit that changed a file:

```bash
git log --follow --format='%h %ad %s' --date=short -- globaltravelassi/README.md
```
