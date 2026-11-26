# GLOBALTRAVELASSI recovery report

Date: 22 November 2026. Snapshot: commit `cf6e966` on the local branch `feature/ai-marketing-command-center`.

**Status: PARTIAL_DISCOVERY.** Every location this cloud session can reach was searched and is inventoried below. Some material is outside its reach: your Mac, the Vercel dashboard, the live website (blocked by this container's network proxy) and the production database (not read, because production access was not authorized). Section 13 lists what is missing and who can get it.

This was a read-only operation. No application code, database, deployment, Git branch or Git history was changed. The only new files are these three documents in `docs/recovery/`, which are not committed. Personal email addresses are deliberately not written in these files. Where one matters, the text says where to find it.

Each fact carries an evidence tag, such as [E4]. The tags are defined in section 15.

## Key findings

1. **The application root is `/home/user/football-ai-pro/globaltravelassi/`** [E1]. It is the `globaltravelassi/` folder inside the Git repository `danitravelvoyage-dot/football-ai-pro`, which is the "Football AI" folder. The repository holds a second, unrelated app at its root: FOOTBALL AI PRO.
2. **Most of the work exists only in this container.** 36 of the 40 GLOBALTRAVELASSI commits (20–21 November) are on the local branch `feature/ai-marketing-command-center`, which has no copy on GitHub [E2][E3]. If this container is reclaimed, they are lost. A verified Git bundle of all branches was created and is attached to the reply that accompanies these documents [E19]. Nothing was pushed.
3. **Production is live from an older version.** On 19 November, `globaltravelassi.online` was set up from the pushed branch `claude/affectionate-rubin-la5937` (commit `9d5e23a`). It uses Vercel project `football-ai-pro-v5d9` and Supabase project `globaltravelassi` [E5][E6]. That version still has the original admin-recorded payment tracking. The deployment mapping is **no longer written anywhere at HEAD**: the README line was removed in `cf6e966`, and `DEPLOYMENT.md` says "not deployed" [E12].
4. **Pushing to `claude/affectionate-rubin-la5937` would deploy to production.** Vercel builds production from that branch [E5][E6], and the new code needs migrations `0019`–`0023`, which production does not have. This cloud environment also names that branch as its default development branch. Any backup push must go to a different branch, and only with your approval.
5. **VISORA is a different, earlier project, not GLOBALTRAVELASSI** [E8][E9]. VISORA was built on 11–12 November with a `src/` layout and a package named `visora`. It was delivered as `visora.zip` and run from `~/Downloads/visora` on your Mac. GLOBALTRAVELASSI was built from scratch in this repository on 18 November. Its first version carried the VISORA brand name, which was removed on 19 November.
6. **Migrations applied in production are unchanged.** `0001_init.sql` and `seed.sql` at HEAD are byte-identical to the pushed version [E13]. All 29 entries in `docs/migrations/manifest.json` match their files [E14].
7. **No secret matched the patterns scanned for in the Git history** [E15]; this is a pattern scan, not proof that none exists. The only `.env` files ever committed are `.env.example` templates.

## 1. Discovered locations

### 1.1 This cloud container

| Location | What it is | Relevance |
|---|---|---|
| `/home/user/football-ai-pro/` | Git repository `danitravelvoyage-dot/football-ai-pro` ("Football AI") | Holds both apps |
| `/home/user/football-ai-pro/globaltravelassi/` | **GLOBALTRAVELASSI application root**, 447 tracked files | Confirmed (section 2) |
| `/home/user/football-ai-pro/` (root files) | FOOTBALL AI PRO, 94 tracked files | Unrelated app |
| `/home/user/football-ai-pro/.claude/` | Empty folder, not tracked | None |
| `/root/.claude/projects/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc.jsonl` | This session's transcript, 18–22 November, with 180 of your messages | Main history source [E4] |
| `…/4cf94d32-…/subagents/agent-a2815e7a8de86cd05.jsonl` | A 21 November web-lookup task on Supabase pricing; it recorded no final result | Background only |
| `…/4cf94d32-…/tool-results/` | Saved tool outputs: a copy of migration 0019's text, and this recovery's own lookups | No unique content |
| `/root/.claude/uploads/4cf94d32-…/79c5b732-WhatsApp_Video_2026-11-19_at_16.36.03.mp4` | Video you uploaded on 19 November for a marketing-video prompt (#95) | Marketing material, not source |
| `/tmp/claude-0/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc/images/` (60 `.webp` files) | Screenshots you pasted on 19 November, 05:09–09:39 UTC, during Supabase, Vercel and domain setup | Not opened or copied: dashboard screenshots can show keys |
| `/tmp/claude-0/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc/scratchpad/` | Working files: the **19 November project summary** (`globaltravelassi-summary.md`, `.pdf`), 37 screenshots (18–22 November, including 18 QA captures from 20 November), 38 verification logs | Summary recovered (section 6) |
| `/root`, `/home/claude`, `/home/ubuntu`, `/opt` | Tool and account configuration; credential files exist there and were not read | No project copies |
| `/mnt/user-data/{uploads,outputs,working}`, `/mnt/attach`, `/old_root`, `/srv`, `/media`, `/var/backups`, `/var/tmp` | Empty | None |
| `/root/.claude/backups/`, `/root/.claude/rm-guard/`, `/tmp/0gQfycW-…`, `/tmp/DaRmSag…` | Tool configuration backups, command-guard logs, Next.js build caches | Not project material |

### 1.2 Outside the container, read-only

| Source | Result |
|---|---|
| GitHub `danitravelvoyage-dot/football-ai-pro` | Two branches: `main` (`95b4c55`) and `claude/affectionate-rubin-la5937` (`9d5e23a`). No tags, pull requests or issues [E3]. |
| Other GitHub repositories visible to this session | Three, none related to GLOBALTRAVELASSI |
| Claude Code sessions (24 visible) | Relevant: this session; two "Visora AI travel platform" sessions (11–12 November) [E9]; "UI/UX Pro Max Skill installation" (21 November) [E10]. The rest are unrelated. |
| Claude artifacts (42 visible) | Relevant: "VISORA Project Files" (12 November) [E8]; a VISORA-branded prepayment poster titled "إعلان سياسة الدفع المسبق" (17 November) [E11]. The rest are unrelated. |
| Supabase (project metadata only) | Organisation `fclvdimxarlyrigktgmu`. `globaltravelassi`: ref `feknppmxasoxmwplxvpa`, eu-west-1, ACTIVE_HEALTHY, created 19 November 00:40 UTC, Postgres 17. `visa-ready-dz`: ref `pcreairqaqxistybmnnb`, eu-west-3, INACTIVE, created 31 October [E7]. |
| Google Drive, Notion | Searches for "globaltravelassi", "GLOBALTRAVELASSI" and "visora" returned nothing [E18] |
| Live site `https://globaltravelassi.online` | Blocked by this container's network proxy [E17]. Not verified. |

### 1.3 Not accessible, or deliberately not searched

- **Your Mac**, including `~/Downloads/visora`: no computer was attached to this session.
- **Vercel dashboard**: no connector. The deployment state and environment variable values are there.
- **Production database contents**: not read. Production access was not authorized.
- **Spaceship**, the domain registrar: holds the DNS records.
- **The archived "UI/UX Pro Max" session's container**: its commit `27a027c` was never pushed [E10].
- **Gmail and Slack**: not searched. They hold communications, not project storage. Ask if you want them searched.

## 2. Confirmed application root

`/home/user/football-ai-pro/globaltravelassi/` is GLOBALTRAVELASSI. Evidence:

- `globaltravelassi/package.json` has name `globaltravelassi` and description "GLOBALTRAVELASSI travel & visa consulting platform (Arabic / French / English)" [E1].
- The heading of `globaltravelassi/README.md` is "GLOBALTRAVELASSI". `globaltravelassi/app/layout.tsx` sets `applicationName: "GLOBALTRAVELASSI"`.
- In `globaltravelassi/.env.example`, `NEXT_PUBLIC_SITE_URL=https://globaltravelassi.online`.
- 40 of the repository's 47 commits change only `globaltravelassi/` [E2].
- Your instruction #104 (20 November 06:50 UTC) gives "Project directory: globaltravelassi/" [E4].
- On 22 November the app started locally, the home page rendered "GLOBALTRAVELASSI" in ar, fr and en, and the full test suite passed [E16].

These are **not** GLOBALTRAVELASSI:

- The repository root app: `package.json` is named `football-ai-pro`, "FOOTBALL AI PRO — football analytics & betting intelligence". Its 7 commits are from 13 November.
- VISORA: section 11.

## 3. Repository and branches

Remote: `https://github.com/danitravelvoyage-dot/football-ai-pro`.

| Ref | Commit | Date | Where it exists | Contents |
|---|---|---|---|---|
| `main` | `95b4c55` | 13 Nov | Local and GitHub | Football app only. No `globaltravelassi/` folder. |
| `claude/affectionate-rubin-la5937` | `9d5e23a` | 19 Nov | Local and GitHub | First 4 GLOBALTRAVELASSI commits, 94 files. **Production deploy source** per the 19–20 November records [E5][E6]. |
| `feature/ai-marketing-command-center` (current) | `cf6e966` | 21 Nov | **Local only**, no upstream | All 40 GLOBALTRAVELASSI commits, 447 files |
| Unreachable object `8b04ed1` | — | 21 Nov | Local object store | Copy of `56f972d` from before an amend. Same file tree, so nothing was lost. |

Tags 0, stashes 0, worktrees 1, submodules none. All 47 commits are reachable from HEAD. The working tree was clean before these documents were added.

`feature/ai-marketing-command-center` is 40 commits ahead of `main` and 36 ahead of `claude/affectionate-rubin-la5937`, and behind neither. Between `9d5e23a` and HEAD, 394 files in `globaltravelassi/` changed (+45,707, −659 lines).

## 4. Commit history summary

Instruction numbers (#n) count your messages in this session's transcript in order, starting with #1 on 18 November 18:11 UTC [E4].

| Period | Commits | What happened | Your instructions |
|---|---|---|---|
| 13 Nov | `49ba979`…`95b4c55` (7) | FOOTBALL AI PRO, at the repository root. Unrelated. | (earlier sessions) |
| 18 Nov | `c8b2f74` | GLOBALTRAVELASSI first build: 91 files, Supabase schema `0001`, ar/fr/en. 12 files carried the VISORA brand name. | #1 |
| 19 Nov | `001e052`, `f45a710`, `9d5e23a` (pushed) | Vercel deployment note; VISORA replaced by GLOBALTRAVELASSI; homepage redesign. Production set up the same day (section 5). | #60–#102 (#79 rebrand, #84 brand transformation) |
| 20 Nov | `70aab94`…`c94c7fc` (12) | Branch `feature/ai-marketing-command-center` created. AI command center and "autonomous AI company" back office. | #103 (recovery report), #104–#134 |
| 21 Nov | `5cf4a94`…`0320c8e` (16) | AI back office continued: notifications, campaigns, AI CRM pipeline, competitors, multi-agent, local AI, quality checks, owner approval center, staging readiness | #135–#157 |
| 21 Nov | `5321ec7`, `475a116`, `2293b61`, `6f936b8` | Manual payments (USDT, BaridiMob, RedotPay) and their security remediation | #158–#166 |
| 21 Nov | `8480909`, `09702ba`, `5f81999` | Open-redirect fix and report-only CSP; nonce-based CSP; security hardening and the customer email system | #170, #171, #172 |
| 21 Nov | `cf6e966` | Final customer launch pass: payments removed, CRM essentials, lead attribution, nine service pages, legal pages | #173 |
| 22 Nov | none | Reports, local start and full verification, then this recovery | #174–#180 |

Totals: 47 commits. 40 are GLOBALTRAVELASSI, of which 4 are on GitHub and 36 are local only. The per-commit list with links is in `GLOBALTRAVELASSI_RECOVERY_INDEX.md`.

## 5. Production configuration on record (not verified live)

Sources: the 19 November project summary [E5], the 19 November setup steps in the transcript [E4], and the 20 November technical report [E6].

| Item | Recorded value |
|---|---|
| Domain | `globaltravelassi.online`, bought at Spaceship. DNS: `A @ → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`. |
| Hosting | Vercel team `dani-782a`, project **`football-ai-pro-v5d9`**, production branch **`claude/affectionate-rubin-la5937`**, root directory `globaltravelassi`. A second Vercel project, `football-ai-pro`, deploys `main` (the football app). |
| Vercel environment (Production) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://globaltravelassi.online`, `NEXT_PUBLIC_WHATSAPP_NUMBER=84852462510`. Key values are not recorded anywhere in this session. |
| Database | Supabase project `globaltravelassi` (ref `feknppmxasoxmwplxvpa`). You ran `0001_init.sql` and `seed.sql` in the SQL editor on 19 November (#7, "Success. No rows returned"). |
| Auth | Email sign-in, email confirmation on, Supabase's default email sender. One account promoted to admin by SQL. |
| Data entered | Services and prices in DZD, set in the admin dashboard |
| Reported problems (19 Nov) | A forgotten password (#89) and account emails not arriving (#90). No production fix is recorded. |

Verified on 22 November: the Supabase project exists and is ACTIVE_HEALTHY [E7], and the two files production ran are unchanged at HEAD [E13]. **Not verified:** which commit Vercel currently serves, the production database contents, and the DNS records.

## 6. Recovered artifacts

| Artifact | Original location | What was done |
|---|---|---|
| Git bundle of all branches: `GLOBALTRAVELASSI_football-ai-pro_all-branches_2026-11-22.bundle` (1,264,466 bytes, SHA-256 `131bd18575c4bcdf94d77f378b0b2323901050721bc2e554b0d0d1b0b75d0554`) | Created from `/home/user/football-ai-pro/.git`, saved in `…/scratchpad/recovery/` | `git bundle verify`: "complete history". Holds `main`, `claude/affectionate-rubin-la5937`, `feature/ai-marketing-command-center` and the two remote-tracking refs. Attached to the reply. Restore with `git clone <bundle> -b feature/ai-marketing-command-center`. |
| 19 November project summary (`globaltravelassi-summary.md` and `.pdf`) | `…/scratchpad/` | Not sent. Kept in the scratchpad: it is partly outdated and names a personal admin address. |
| 20 November technical report (production mapping) | Transcript, assistant message of 20 November 06:48 UTC | Its findings are reproduced in section 5 |
| Your decision record (briefs #1, #104, #158, #170, #173) | Transcript | Summarised in section 10, with exact timestamps in the index |
| 13 files deleted in `cf6e966` (payment workflow and its tests) | Git history | Not restored, because the removal was intentional (decision D-1). They can be recovered on demand: `git show 5f81999:<path>`. |

## 7. Existing documentation (19 Markdown files, 6 rollback scripts, 1 manifest)

| File | Last changed | State |
|---|---|---|
| `README.md` | `cf6e966` | Current. States "Ten transactional customer emails", which is wrong (discrepancy X-6). |
| `DEPLOYMENT.md` | `cf6e966` | Current for the new version, but says "not deployed" and omits the live production setup (X-2) |
| `PROJECT_STATUS.md` (94 KB) | `cf6e966` | Chronological log of every phase. Mentions 15 payment files deleted since (historical). |
| `docs/FINAL_TECHNICAL_REPORT.md` | `cf6e966` | Current: final report of the launch pass |
| `docs/COMPLETION_CHECKLIST.md` | `cf6e966` | Current. Email count wrong (X-6). |
| `docs/LAUNCH_CHECKLIST.md` | `cf6e966` | Current |
| `docs/MIGRATIONS.md` | `cf6e966` | Current: customer launch order |
| `docs/ENVIRONMENT.md` | `cf6e966` | Current |
| `docs/EMAIL_NOTIFICATIONS.md` | `cf6e966` | Current. Correct: 7 app emails plus 2 Supabase emails. |
| `docs/ADMIN_GUIDE.md` | `cf6e966` | Current admin guide |
| `docs/PRIVACY_AND_COOKIES.md` | `cf6e966` | Current: working notes, owner review pending |
| `docs/staging/STAGING_RUNBOOK.md` | `cf6e966` | Current: staging steps, not started |
| `docs/security/CONTENT_SECURITY_POLICY.md` | `09702ba` | Current |
| `docs/security/REDIRECT_SECURITY.md` | `8480909` | Current |
| `docs/migrations/0018_backup_procedure.md` | `a27a042` | AI back office (deferred) |
| `docs/migrations/0018_rollback.sql` … `0023_rollback.sql`, `manifest.json` | `a27a042`…`cf6e966` | Current. Manifest verified 29/29. |
| `ADMIN_GUIDE.md` (repository root of the app) | `f45a710`, 19 Nov | **Outdated**: describes the original payment tracking. Superseded by `docs/ADMIN_GUIDE.md`. |
| `PLAN.md` | `f45a710`, 19 Nov | **Historical**: the original development plan, including payments |
| `docs/staging/execution-plan.md` | `6f936b8`, 21 Nov | **Superseded** by `docs/staging/STAGING_RUNBOOK.md`. Plans migrations 0002–0019, including payments, and links a deleted file. |
| `SCHEDULER.md` | `e7b0b57` | AI back office (deferred) |

## 8. Existing specifications

There is no separate API or architecture specification file. The specifications are:

- **Your briefs** in the transcript [E4]:
  - #1, the original platform specification (18 November)
  - #84, the brand transformation
  - #104–#106, the AI marketing team and "autonomous AI company"
  - #158, manual payments, later reversed
  - #170, pre-staging security, customer scope only
  - #173, the final launch specification and the current source of truth
  - #180, this recovery
- **In the repository:** `PLAN.md` (historical), `docs/FINAL_TECHNICAL_REPORT.md`, `docs/COMPLETION_CHECKLIST.md`, `docs/LAUNCH_CHECKLIST.md`, `docs/EMAIL_NOTIFICATIONS.md`, `docs/MIGRATIONS.md`, `docs/ENVIRONMENT.md`, `docs/PRIVACY_AND_COOKIES.md`, `docs/security/*`, and `SCHEDULER.md` (AI).
- **The API surface:** server actions plus five route handlers, listed in `GLOBALTRAVELASSI_PROJECT_INVENTORY.md`, section 8.

## 9. Database migrations

| File | Purpose | Where applied |
|---|---|---|
| `0001_init.sql` | Base schema: profiles, services, applications, documents, payments, notes, events; private bucket `customer-documents` | **Production**, 19 Nov, by the owner. Unchanged since [E13]. |
| `seed.sql` | Six starter services, empty prices | **Production**, 19 Nov. Unchanged since. |
| `0002`–`0018` | AI back office | Nowhere. Deferred; not part of the launch. |
| `0019_manual_payments.sql` | Payment tables, views and functions | Nowhere. Kept in the sequence because `0022` depends on it. |
| `0020_customer_hardening.sql` | Column grants, disabled accounts, document rules, request locale | Nowhere |
| `0021_customer_email_notifications.sql` | Email log, enqueue, delivery record, retry | Nowhere |
| `0022_remove_payment_workflow.sql` | Forward-only payment removal; history preserved | Nowhere |
| `0023_crm_attribution_requests.sql` | Lead source, CRM fields, activity log, rate limits; deactivates 2 services | Nowhere |
| `seed_catalog.sql` | Five new services, empty prices | Nowhere |

Rollback scripts for `0018`–`0023` are in `docs/migrations/`. The launch order is in `docs/MIGRATIONS.md`. Production already has `0001` and `seed.sql`, so it needs `0019`, `0020`, `0021`, `0022`, `0023` and `seed_catalog.sql`, with your approval and after a backup.

The production entries in this table come from your 19 November messages and the summary. They were not checked in the database.

## 10. Your confirmed business decisions, checked against the repository

| Decision (brief #180, confirmed in #173) | Repository evidence | State |
|---|---|---|
| Remove payment functionality from workflows | `cf6e966` deleted 13 payment files. `supabase/migrations/0022_remove_payment_workflow.sql`. `tests/launch/whatsapp-and-payments-removed.test.ts`. | Done locally. **Production still has payment tracking** (X-3). |
| Preserve historical records and migration history | `0022` is forward-only; `0019` is kept; `tests/db/payment-removal-crm.test.ts` checks data survives | Done locally |
| Service request form and WhatsApp for conversion | `app/[locale]/apply/page.tsx`, `lib/actions/applications.ts`, `lib/config.ts` (`whatsappLink`) | Done locally |
| Display "Price on request" | `lib/i18n/*` (`priceOnRequest`); `seed.sql` and `seed_catalog.sql` have empty prices | Done locally. **Production has DZD prices entered** (X-4). |
| Arabic, French and English | `lib/i18n/ar.ts`, `fr.ts`, `en.ts`; RTL; 30/30 browser checks | Done |
| Email notifications | `lib/email/*`, `0021`; 7 app emails plus 2 Supabase emails | Built. Delivery off until SMTP is configured. |
| WhatsApp manual only | `wa.me` links only; no WhatsApp API anywhere in the code | Done |
| CRM essentials | `lib/actions/admin.ts`, `0023` (`crm_activity`, lead source, category, last contact) | Done locally |
| Lead source attribution | `lib/attribution/*`, `middleware.ts`, `0023` | Done locally |
| Free Supabase staging only | `docs/staging/STAGING_RUNBOOK.md` | Blocked by the free-plan project limit (X-8) |
| Never modify production without authorization | No production change is recorded after 19 November | Respected |

The nine services in your brief map to these service pages:

| Your brief | Repository slug and English title |
|---|---|
| France visa appointment assistance | `france-visa-appointment` "France visa appointment assistance" |
| Other country visa appointments | `appointment-assistance` "Visa appointment assistance" (X-7) |
| Visa consultation | `visa-consulting` "Visa consulting" |
| Visa application file assistance | `visa-file-assistance` "Visa application file assistance" |
| Electronic visas | `e-visa` "E-visa services" |
| Flight bookings | `flight-booking` "Flight bookings" |
| Hotel bookings | `hotel-booking` "Hotel bookings" |
| Travel itineraries | `travel-itinerary` "Travel itineraries" |
| Transit and stopover programs | `transit-airport` "Transit & airport consulting" (X-7) |

The contact email in `globaltravelassi/.env.example` matches the official email in your brief.

The admin email in your brief is not in the repository. Admin rights are a database role (`profiles.role = 'admin'`), not an email setting.

## 11. VISORA: related, but a separate project

| | VISORA | GLOBALTRAVELASSI |
|---|---|---|
| Built | 11–12 Nov, in two "Visora AI travel platform" sessions [E9] | From 18 Nov, in this session [E4] |
| Delivered | Artifact "VISORA Project Files" with `visora.zip`: 102 files, all dated 11 Nov [E8] | This Git repository |
| Package | `visora` 1.0.0, `src/` layout; uses the Anthropic SDK, jsPDF and html2canvas | `globaltravelassi` 1.0.0, root `app/` layout |
| Admin pages | consultations, orders, assessments, roles, messages, services, customers, content | applications, customers, services, reports, emails (plus the deferred AI command center) |
| Database | Its own `supabase/schema.sql`; project not identified | `supabase/migrations/0001`–`0023`; project `globaltravelassi` |
| Run | `cd ~/Downloads/visora && npm run dev`, on your Mac (12 Nov) | This repository's `globaltravelassi/` folder |
| WhatsApp | An Algerian (+213) number ending in 585, set in `~/Downloads/visora/.env.local` | See X-1 |

Conclusion: `~/Downloads/visora` is VISORA, not GLOBALTRAVELASSI. Your 22 November warning (#175) was right. The only link between the two is the brand name, which appeared in GLOBALTRAVELASSI's first commit (`c8b2f74`, 12 files) and was removed in `f45a710`. The VISORA-branded prepayment poster of 17 November [E11] is marketing material for the old brand.

## 12. Completed features

Built and verified locally on 22 November: lint, typecheck, 1,361 tests passing with 3 opt-in tests skipped, production build, and 30 of 30 browser checks [E16]. Not live; see section 13.

- **Public site:** home page, services list, nine service pages, and privacy, terms and cookie pages, all in ar, fr and en with RTL. Includes SEO metadata, Open Graph, language alternates, sitemap and robots.
- **Accounts:** sign-up, sign-in, sign-out, password reset and profile, on Supabase Auth. Sessions refresh in `middleware.ts`.
- **Service request:**
  - server validation, honeypot, database rate limits, a one-time submission token
  - consent notice
  - a random reference in the form `GTA-YYMM-XXXXXXXXXX`
  - confirmation page and the "request received" email
- **Customer area:** request list, detail and timeline; document upload and removal; WhatsApp contact.
- **Documents:** private bucket `customer-documents` (10 MB; PDF, JPEG, PNG), a file-signature check, and a 120-second signed download link.
- **Admin:**
  - overview statistics
  - request list with filters
  - request detail with status changes, internal notes and document checks
  - customers (activate and deactivate)
  - services and prices
  - reports with a formula-safe CSV export
  - customer email log with retry
- **CRM:** lead source correction with a reason, customer category, contact log, last contact, an append-only activity log, and the customer's other requests.
- **Lead attribution:** a first-visit cookie set from UTM tags or the referrer, never invented, saved on each request.
- **Email:** seven app emails plus two Supabase templates, in three languages. Duplicate-safe, logged and retryable; off by default.
- **Security:**
  - nonce-based CSP in report-only mode
  - open-redirect protection
  - Row Level Security and column grants
  - append-only guards
  - disabled accounts blocked
- **Payments:** removed from the code, with migration `0022`.

## 13. Incomplete work, missing material and limits

### 13.1 Incomplete features and phases

1. **Not deployed.** The new version exists only locally. Production runs, per the records, the 19 November version.
2. **Migrations `0019`–`0023` and `seed_catalog.sql` are applied nowhere.**
3. **Staging not created.** Supabase refused because the free-plan member is at its limit of two active free projects (X-8).
4. **Email delivery not configured.** No SMTP, and no real email has been sent. Production account emails were reported missing on 19 November (X-9).
5. **WhatsApp number unconfirmed** (X-1).
6. **Legal texts and retention periods** await your review.
7. **CSP** is report-only; enforcement is not decided.
8. **Dependency advisories** for `next` 15 (bundled postcss) and `zod` 3 need major upgrades, which were not done.
9. **The AI back office is deferred:**
   - 134 files in `lib/ai/`
   - 25 admin files under `app/[locale]/admin/command-center/`
   - 11 AI action files
   - 2 `/api/ai/scheduler` routes
   - 64 tests
   - migrations `0002`–`0018`, never applied anywhere
10. **An unknown service URL** returns HTTP 200 with a "not found" page.
11. **No conversion rate by lead source:** the site does not count visits.
12. **No CI workflow** in the repository. Tests are run by hand.

### 13.2 Missing files and materials

| Missing | Where it is, or how to get it |
|---|---|
| Production deployment mapping at HEAD | Only in Git history (`001e052` README), the 19 November summary and the transcript. Now in section 5 of this report. |
| `.env.local` and real environment values | By design not in the repository. The values are in Vercel → project settings → Environment Variables, and in Supabase → Project Settings → API. |
| Vercel configuration (`vercel.json`) | Not used. The settings exist only in the Vercel dashboard. |
| Production database backup or export | None found anywhere accessible. You need to export it from the Supabase dashboard. |
| The 60 setup screenshots and the 19 November summary | Only in this container's temporary folders. The summary was not sent, and neither were the screenshots, because they may show keys. |
| `~/Downloads/visora` | On your Mac. It is VISORA, not needed for GLOBALTRAVELASSI. |
| Commit `27a027c`, adding `.claude/skills/ui-ux-pro-max/` on branch `claude/gallant-cerf-eo12rh` | In the archived "UI/UX Pro Max" session. Its push failed with HTTP 403. Not recoverable from here, and not application code [E10]. |
| Which Supabase project VISORA used; the origin of `visa-ready-dz` | Unknown. `visa-ready-dz` is paused, predates both projects (31 October), and is not referenced by GLOBALTRAVELASSI. |
| 13 payment files and `docs/staging/concurrency-evidence.md` | Deleted on purpose in `cf6e966`. Recoverable from commit `5f81999`. |

### 13.3 Duplicate or outdated copies

| Copy | Status |
|---|---|
| Branch `claude/affectionate-rubin-la5937` (`9d5e23a`, 94 files) | Older version, 36 commits behind. Production deploy source. Do not delete. |
| Branch `main` | Football app only |
| `globaltravelassi/ADMIN_GUIDE.md`, `globaltravelassi/PLAN.md` | Outdated (19 November); describe payments |
| `docs/staging/execution-plan.md` | Superseded by `docs/staging/STAGING_RUNBOOK.md` |
| Unreachable commit `8b04ed1` | Duplicate of `56f972d` (same tree) |
| VISORA zip and `~/Downloads/visora` | Separate predecessor project, not a copy |
| 19 November summary | Partly outdated: calls the brand VISORA; DZD prices; payments era |
| Scratchpad screenshots of 18–19 November | Show the pre-rebrand and pre-redesign interface |

## 14. Unresolved discrepancies

| # | Discrepancy | Evidence | Who decides |
|---|---|---|---|
| X-1 | **Three different WhatsApp numbers.** VISORA (12 Nov): Algerian `+213…585`. Production Vercel variable (19 Nov): `84852462510`. Repository and your 21–22 November briefs: `8485462510`. The two `+84` (Vietnam) numbers differ by one digit. | [E9], #73, [E5], `globaltravelassi/.env.example` line 8 | You |
| X-2 | `DEPLOYMENT.md` says "not deployed" and no document at HEAD records the live Vercel/Supabase setup | `DEPLOYMENT.md`; `git log -S"Vercel builds this project"` shows the line removed in `cf6e966` | Documentation fix (needs your approval to edit) |
| X-3 | Production, per the records, still runs payment tracking (`9d5e23a`), although payments are removed in the code | `git grep payment 9d5e23a`, e.g. `app/[locale]/admin/applications/[id]/page.tsx` | Resolved by deploying, after the migrations |
| X-4 | DZD prices were entered in production, but the decision is "Price on request". The code shows a price whenever one is set. | [E5]; `lib/i18n/en.ts` ("leave empty for Price on request") | You: clear or confirm prices in Admin → Services |
| X-5 | The admin account promoted in production (19 Nov) is recorded with a personal address that differs from the admin email in your 22 November brief. Not verified in the database. | [E5] (the summary, "Still to check") | You |
| X-6 | Email count. Code: 7 app emails (`lib/email/kinds.ts`) plus 2 Supabase emails = 9, exactly the 9 flows in brief #173. `README.md` says "Ten". `docs/COMPLETION_CHECKLIST.md` says "nine flows plus two auth flows". Chat reports on 21–22 November repeated that overcount. | [E20] | Documentation fix |
| X-7 | Two service names differ from your brief. "Other country visa appointments" is "Visa appointment assistance" (generic consulate or visa-centre wording). "Transit and stopover programs" is "Transit & airport consulting" (about transit rules; nothing on stopover programs). The 18 November services "Organized European trips" and "Travel consultation" are deactivated, not deleted, by `0023`, and stay active in production until then. | `lib/services-content.ts`, `0023` lines 122–123 | You: wording or new content |
| X-8 | The staging refusal says the limit of two active free projects is reached, but only one active project is visible in this organisation. *Inference, not verified:* another active free project exists in an organisation this session cannot see. | Previous run's refusal; [E7] | You |
| X-9 | Account emails were reported not arriving in production on 19 November. Production uses Supabase's default sender, which is heavily rate-limited. No fix has been deployed. | #90; [E5] | You: custom SMTP in Supabase |
| X-10 | Supabase project `visa-ready-dz` is paused and of unknown origin. *Inference only:* the name resembles VISORA's visa-readiness features. | [E7] | You: keep, restore or delete |
| X-11 | Stale references to deleted files: `PROJECT_STATUS.md` (15 mentions, historical), `docs/staging/execution-plan.md` (1) | Link scan of all `.md` files | Documentation clean-up |
| X-12 | Naming: the GitHub repository (`football-ai-pro`) and the Vercel project (`football-ai-pro-v5d9`) carry the football app's name but serve GLOBALTRAVELASSI. The 19 November summary suggested renaming the Vercel project. | [E5][E6] | You, optional |

## 15. Evidence register

| Tag | Evidence | Path or command |
|---|---|---|
| E1 | Application identity | `globaltravelassi/package.json`, `globaltravelassi/README.md`, `globaltravelassi/app/layout.tsx` |
| E2 | Local branches, commits, reflog, unreachable objects | `git branch -a -vv`, `git log --all`, `git reflog`, `git fsck --unreachable --no-reflogs` in `/home/user/football-ai-pro` |
| E3 | GitHub state | `git ls-remote origin` (2 branches); GitHub API: 0 pull requests, 0 issues |
| E4 | Your instructions, 18–22 November | `/root/.claude/projects/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc.jsonl`. Key timestamps are in the index. |
| E5 | 19 November project summary | `/tmp/claude-0/-home-user-football-ai-pro/4cf94d32-15d6-5e59-9953-59ef414f16dc/scratchpad/globaltravelassi-summary.md` and `.pdf` |
| E6 | 20 November technical report: Vercel projects, Supabase projects | Transcript [E4], assistant message at 2026-11-20 06:48:36 UTC |
| E7 | Supabase projects | Supabase `list_projects`, read-only, 22 November |
| E8 | VISORA project files | Artifact https://claude.ai/artifact/UKo9PcjuX9jaG6HEFV4EwT. Zip listed without extracting: 102 files, package `visora`. |
| E9 | VISORA sessions | Claude Code sessions `session_01E2xEFWiF4LHy3GdjRLSAPG` (11–12 Nov) and `session_01E2xEFY6WHJy4S6GzZQPjh3` (11 Nov) |
| E10 | Unpushed UI/UX skill commit | Session `session_01E2xEFZWfcfTYKiCkmGBoTX` (21 Nov): commit `27a027c`, push refused with HTTP 403 |
| E11 | VISORA prepayment poster | Artifact https://claude.ai/artifact/453iuAzUqby1k9riRV6MhQ (Design canvas, 17 November) |
| E12 | Removal of the Vercel note | `git show 001e052 -- globaltravelassi/README.md`; `git log -S"Vercel builds this project" -- globaltravelassi/README.md` |
| E13 | Production files unchanged | `git rev-parse 9d5e23a:globaltravelassi/supabase/migrations/0001_init.sql` equals HEAD's; the same for `seed.sql` |
| E14 | Manifest check | SHA-256 of each file against `globaltravelassi/docs/migrations/manifest.json`: 29 of 29 match |
| E15 | Secret scan | `git grep` over all 47 commits for JWT, Supabase key, Anthropic key, SMTP password and database-URL patterns. Only placeholder URLs (`postgres.<ref>`, `<region>`) in the football app's `.env.example` and `DEPLOYMENT.md`. |
| E16 | Local verification, 22 November | `npm run lint` 0, `npm run typecheck` 0, `vitest` 103 files passed and 1 skipped (`tests/local/live-inference.test.ts`, opt-in); 1,361 tests passed, 3 skipped; `npm run build` 0; `npm run test:browser` 30/30 |
| E17 | Live site check | `curl -I https://globaltravelassi.online/` fails with "CONNECT tunnel failed, response 403" (container proxy) |
| E18 | Drive and Notion | Drive full-text and title search; Notion search. Both empty. |
| E19 | Git bundle | `git bundle verify`, `git bundle list-heads`, `sha256sum`; see section 6 |
| E20 | Email kinds | `globaltravelassi/lib/email/kinds.ts` (7 kinds); brief #173 `phase_6.allowed_email_flows` (9, including signup confirmation and password reset) |

## 16. Recommended next steps, in order

1. **Preserve the 36 local-only commits.** Keep the delivered bundle somewhere safe. Also consider approving a push of `feature/ai-marketing-command-center` to GitHub under that same name, never to `claude/affectionate-rubin-la5937`. Vercel normally builds other branches as preview deployments, which do not replace the production site. Check the project's Git settings first.
2. **Confirm the production state in Vercel:** project `football-ai-pro-v5d9` → Deployments shows which commit is live (expected `9d5e23a`).
3. **Decide X-1, X-4 and X-5:** the WhatsApp number, the DZD prices, and which account is admin.
4. **Free a Supabase slot or choose another staging route** (X-8), then follow `docs/staging/STAGING_RUNBOOK.md`.
5. **Approve a small documentation fix** for X-2, X-6 and X-11, and mark `globaltravelassi/ADMIN_GUIDE.md`, `globaltravelassi/PLAN.md` and `docs/staging/execution-plan.md` as outdated or historical.
6. **Deploy to production only after staging passes,** with a database backup and your approval: migrations `0019`–`0023` and `seed_catalog.sql`, then the new code.
