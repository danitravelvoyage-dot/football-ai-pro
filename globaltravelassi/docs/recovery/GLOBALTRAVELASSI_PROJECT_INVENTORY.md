# GLOBALTRAVELASSI project inventory

Snapshot: commit `cf6e966` on the local branch `feature/ai-marketing-command-center`, 22 November 2026. It covers the 447 files Git tracks under `globaltravelassi/`; `node_modules/` and `.next/` are excluded. Paths are relative to `/home/user/football-ai-pro/globaltravelassi/` unless they start with `/`.

Scope labels:
- **Launch**: part of the customer website, customer area and admin dashboard.
- **Deferred**: the AI back office. Its code is present, but its migrations `0002`–`0018` are applied nowhere, and it is not part of the launch.

## 1. Directory structure

Generated from `git ls-files`. Three deferred AI folders are shown as file counts.

```text
globaltravelassi/
├── app/
│   ├── [locale]/
│   │   ├── admin/
│   │   │   ├── applications/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── command-center/
│   │   │   │   └── … 25 files (AI back-office admin pages (deferred))
│   │   │   ├── customers/
│   │   │   │   └── page.tsx
│   │   │   ├── emails/
│   │   │   │   └── page.tsx
│   │   │   ├── reports/
│   │   │   │   ├── export/
│   │   │   │   │   └── route.ts
│   │   │   │   └── page.tsx
│   │   │   ├── services/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── new/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── apply/
│   │   │   └── page.tsx
│   │   ├── auth/
│   │   │   ├── callback/
│   │   │   │   └── route.ts
│   │   │   ├── forgot/
│   │   │   │   └── page.tsx
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── register/
│   │   │   │   └── page.tsx
│   │   │   ├── update-password/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx
│   │   ├── cookies/
│   │   │   └── page.tsx
│   │   ├── dashboard/
│   │   │   ├── profile/
│   │   │   │   └── page.tsx
│   │   │   ├── requests/
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── documents/
│   │   │   └── [id]/
│   │   │       └── route.ts
│   │   ├── privacy/
│   │   │   └── page.tsx
│   │   ├── services/
│   │   │   ├── [slug]/
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── terms/
│   │   │   └── page.tsx
│   │   ├── error.tsx
│   │   ├── layout.tsx
│   │   ├── loading.tsx
│   │   ├── not-found.tsx
│   │   └── page.tsx
│   ├── api/
│   │   └── ai/
│   │       └── scheduler/
│   │           ├── watchdog/
│   │           │   └── route.ts
│   │           └── route.ts
│   ├── globals.css
│   ├── layout.tsx
│   ├── opengraph-image.tsx
│   ├── robots.ts
│   └── sitemap.ts
├── components/
│   ├── admin/
│   │   ├── command-center/
│   │   │   ├── Parts.tsx
│   │   │   └── SubNav.tsx
│   │   ├── AdminUI.tsx
│   │   └── ServiceForm.tsx
│   ├── forms/
│   │   ├── ActionForm.tsx
│   │   └── Fields.tsx
│   ├── site/
│   │   ├── CinematicBackdrop.tsx
│   │   ├── LanguageSwitcher.tsx
│   │   ├── LegalPage.tsx
│   │   ├── ServiceCard.tsx
│   │   ├── SiteFooter.tsx
│   │   ├── SiteHeader.tsx
│   │   └── WhatsAppFloat.tsx
│   ├── DocumentUploader.tsx
│   ├── Reveal.tsx
│   ├── StatusBadge.tsx
│   └── ui.tsx
├── docs/
│   ├── migrations/
│   │   ├── 0018_backup_procedure.md
│   │   ├── 0018_rollback.sql
│   │   ├── 0019_rollback.sql
│   │   ├── 0020_rollback.sql
│   │   ├── 0021_rollback.sql
│   │   ├── 0022_rollback.sql
│   │   ├── 0023_rollback.sql
│   │   └── manifest.json
│   ├── recovery/                      (these three documents, not committed)
│   ├── security/
│   │   ├── CONTENT_SECURITY_POLICY.md
│   │   └── REDIRECT_SECURITY.md
│   ├── staging/
│   │   ├── execution-plan.md
│   │   └── STAGING_RUNBOOK.md
│   ├── ADMIN_GUIDE.md
│   ├── COMPLETION_CHECKLIST.md
│   ├── EMAIL_NOTIFICATIONS.md
│   ├── ENVIRONMENT.md
│   ├── FINAL_TECHNICAL_REPORT.md
│   ├── LAUNCH_CHECKLIST.md
│   ├── MIGRATIONS.md
│   └── PRIVACY_AND_COOKIES.md
├── lib/
│   ├── actions/
│   │   ├── admin-session.ts
│   │   ├── admin.ts
│   │   ├── ai.ts
│   │   ├── applications.ts
│   │   ├── auth.ts
│   │   ├── business.ts
│   │   ├── campaigns.ts
│   │   ├── collaboration.ts
│   │   ├── crm.ts
│   │   ├── customer-session.ts
│   │   ├── documents.ts
│   │   ├── helpers.ts
│   │   ├── knowledge.ts
│   │   ├── memory.ts
│   │   ├── notifications.ts
│   │   ├── review.ts
│   │   ├── scheduler.ts
│   │   ├── sources.ts
│   │   └── types.ts
│   ├── ai/
│   │   └── … 134 files (deferred AI back office)
│   ├── attribution/
│   │   ├── cookie.ts
│   │   └── lead-source.ts
│   ├── documents/
│   │   └── signature.ts
│   ├── email/
│   │   ├── config.ts
│   │   ├── copy.ts
│   │   ├── kinds.ts
│   │   ├── notify.ts
│   │   ├── service.ts
│   │   ├── templates.ts
│   │   └── transport.ts
│   ├── i18n/
│   │   ├── ar.ts
│   │   ├── config.ts
│   │   ├── en.ts
│   │   ├── fr.ts
│   │   └── index.ts
│   ├── legal/
│   │   ├── content.ts
│   │   └── meta.ts
│   ├── security/
│   │   ├── csp.ts
│   │   └── redirect.ts
│   ├── supabase/
│   │   ├── browser.ts
│   │   ├── middleware.ts
│   │   └── server.ts
│   ├── validation/
│   │   ├── messages.ts
│   │   └── schemas.ts
│   ├── auth.ts
│   ├── catalog.ts
│   ├── config.ts
│   ├── countries.ts
│   ├── csv.ts
│   ├── destinations.ts
│   ├── domain.ts
│   ├── queries.ts
│   └── services-content.ts
├── public/
│   └── icon.svg
├── scripts/
│   ├── auth-templates/
│   │   └── check.go
│   ├── migration-files.mjs
│   └── migration-manifest.mjs
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql
│   │   ├── 0002_ai_company.sql
│   │   ├── 0003_agent_seed.sql
│   │   ├── 0004_event_bus.sql
│   │   ├── 0005_shared_context.sql
│   │   ├── 0006_knowledge_base.sql
│   │   ├── 0007_approval_controls.sql
│   │   ├── 0008_quality_reviews.sql
│   │   ├── 0009_business_memory.sql
│   │   ├── 0010_append_only_hardening.sql
│   │   ├── 0011_scheduler.sql
│   │   ├── 0012_owner_notifications.sql
│   │   ├── 0013_campaigns_content_knowledge.sql
│   │   ├── 0014_usage_token_split.sql
│   │   ├── 0015_crm_sales.sql
│   │   ├── 0016_competitor_intelligence.sql
│   │   ├── 0017_collaboration.sql
│   │   ├── 0018_owner_approval_center.sql
│   │   ├── 0019_manual_payments.sql
│   │   ├── 0020_customer_hardening.sql
│   │   ├── 0021_customer_email_notifications.sql
│   │   ├── 0022_remove_payment_workflow.sql
│   │   └── 0023_crm_attribution_requests.sql
│   ├── templates/
│   │   ├── confirmation.html
│   │   └── recovery.html
│   ├── seed.sql
│   └── seed_catalog.sql
├── tests/
│   ├── actions/
│   │   ├── approval-actions.test.ts
│   │   ├── crm-actions.test.ts
│   │   ├── customer-email-wiring.test.ts
│   │   └── request-protection.test.ts
│   ├── ai/
│   │   └── … 64 files (AI back-office tests)
│   ├── attribution/
│   │   └── lead-source.test.ts
│   ├── browser/
│   │   └── smoke.mjs
│   ├── db/
│   │   ├── ai-company.test.ts
│   │   ├── approval-controls.test.ts
│   │   ├── audit-integrity.test.ts
│   │   ├── business-memory.test.ts
│   │   ├── campaigns-content.test.ts
│   │   ├── canonical-parity.test.ts
│   │   ├── collaboration.test.ts
│   │   ├── competitors.test.ts
│   │   ├── crm.test.ts
│   │   ├── customer-hardening-emails.test.ts
│   │   ├── customer-sequence.test.ts
│   │   ├── helpers.ts
│   │   ├── migration-chain.test.ts
│   │   ├── migration-dependencies.test.ts
│   │   ├── migration-validation.test.ts
│   │   ├── notifications.test.ts
│   │   ├── owner-approval.test.ts
│   │   ├── payment-removal-crm.test.ts
│   │   ├── platform-migrations.test.ts
│   │   ├── quality-reviews.test.ts
│   │   ├── rls.test.ts
│   │   ├── rollback-0019.test.ts
│   │   ├── rollback-verification.test.ts
│   │   ├── scheduler.test.ts
│   │   ├── security-audit.test.ts
│   │   └── supabase-stubs.sql
│   ├── documents/
│   │   └── signature.test.ts
│   ├── email/
│   │   ├── config-transport.test.ts
│   │   ├── service.test.ts
│   │   └── templates.test.ts
│   ├── fixtures/
│   │   └── canonical-vectors.ts
│   ├── launch/
│   │   └── whatsapp-and-payments-removed.test.ts
│   ├── legal/
│   │   └── content.test.ts
│   ├── local/
│   │   └── live-inference.test.ts
│   ├── security/
│   │   ├── csp-nonce.test.ts
│   │   ├── safe-redirect.test.ts
│   │   └── session-refresh.test.ts
│   ├── services/
│   │   └── content.test.ts
│   ├── csv.test.ts
│   ├── i18n.test.ts
│   └── validation.test.ts
├── .env.example
├── .gitignore
├── ADMIN_GUIDE.md
├── DEPLOYMENT.md
├── eslint.config.mjs
├── middleware.ts
├── next.config.mjs
├── package-lock.json
├── package.json
├── PLAN.md
├── postcss.config.mjs
├── PROJECT_STATUS.md
├── README.md
├── SCHEDULER.md
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.mts
```

Counts:
- **By folder:** `lib/` 186, `tests/` 111, `app/` 65, `supabase/` 27, `docs/` 20, `components/` 17, `scripts/` 3.
- **By type:** 304 `.ts`, 74 `.tsx`, 32 `.sql`, 19 `.md`.

The repository root (`/home/user/football-ai-pro/`) also holds the unrelated FOOTBALL AI PRO app (94 tracked files).

## 2. Important file locations

| Purpose | File |
|---|---|
| Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `verify`, `test:browser`, `test:local-model` | `package.json` |
| Per-request work: session refresh, CSP header with nonce, first-visit lead source cookie | `middleware.ts` |
| Static security headers | `next.config.mjs` |
| Root and locale layouts, metadata, language alternates | `app/layout.tsx`, `app/[locale]/layout.tsx` |
| Site settings: contact email, WhatsApp link builder | `lib/config.ts` |
| Translations (ar, fr, en) | `lib/i18n/ar.ts`, `fr.ts`, `en.ts`, `config.ts`, `index.ts` |
| Service page content, 9 services × 3 languages | `lib/services-content.ts` |
| Data access: services, admin overview, lists, reports, export | `lib/queries.ts` |
| Statuses, lead sources, categories, row types | `lib/domain.ts` |
| Form validation (Zod) | `lib/validation/schemas.ts`, `lib/validation/messages.ts` |
| Access checks | `lib/auth.ts`, `lib/actions/customer-session.ts`, `lib/actions/admin-session.ts` |
| Supabase clients | `lib/supabase/browser.ts`, `server.ts`, `middleware.ts` |
| CSP and safe redirects | `lib/security/csp.ts`, `lib/security/redirect.ts` |
| Customer email system | `lib/email/*` |
| Lead attribution | `lib/attribution/lead-source.ts`, `lib/attribution/cookie.ts` |
| Upload file-type check | `lib/documents/signature.ts` |
| CSV formula protection | `lib/csv.ts` |
| Legal texts | `lib/legal/content.ts`, `lib/legal/meta.ts` |
| Database | `supabase/migrations/*.sql`, `supabase/seed.sql`, `supabase/seed_catalog.sql` |
| Supabase Auth email templates | `supabase/templates/confirmation.html`, `recovery.html` |
| Migration integrity | `docs/migrations/manifest.json`, `scripts/migration-manifest.mjs`, `scripts/migration-files.mjs` |
| Environment variable names | `.env.example`, `docs/ENVIRONMENT.md` |

## 3. Application modules

| Module | Location | Scope |
|---|---|---|
| Public website | `app/[locale]/page.tsx`, `services/`, `services/[slug]/`, `privacy/`, `terms/`, `cookies/`, `components/site/*` | Launch |
| Accounts | `app/[locale]/auth/*`, `lib/actions/auth.ts` | Launch |
| Service requests | `app/[locale]/apply/page.tsx`, `lib/actions/applications.ts` | Launch |
| Customer area | `app/[locale]/dashboard/*`, `components/DocumentUploader.tsx`, `lib/actions/documents.ts` | Launch |
| Document download | `app/[locale]/documents/[id]/route.ts` | Launch |
| Admin dashboard and CRM | `app/[locale]/admin/{page,applications,customers,services,reports,emails}`, `lib/actions/admin.ts`, `components/admin/*` | Launch |
| Email | `lib/email/*`, migration `0021` | Launch, delivery off |
| Attribution | `lib/attribution/*`, `middleware.ts`, migration `0023` | Launch |
| Security | `lib/security/*`, `middleware.ts`, `next.config.mjs` | Launch |
| AI back office | `lib/ai/` (134 files); `app/[locale]/admin/command-center/` (25 files); `app/api/ai/scheduler/*`; `lib/actions/{ai,business,campaigns,collaboration,crm,knowledge,memory,notifications,review,scheduler,sources}.ts`; migrations `0002`–`0018` | Deferred |

## 4. Customer functionality

| Route | What it does |
|---|---|
| `/` | Redirects to `/ar`, the default language |
| `/{ar,fr,en}` | Home page |
| `/{locale}/services` | Services list. Each card shows a price, or "Price on request" when none is set. |
| `/{locale}/services/[slug]` | Nine service pages: what is included, what is not promised, request button, WhatsApp button |
| `/{locale}/auth/register`, `login`, `forgot`, `update-password`, `callback` | Accounts and password reset |
| `/{locale}/apply` | Service request form, signed-in customers only |
| `/{locale}/dashboard` | The customer's requests |
| `/{locale}/dashboard/requests/[id]` | Request detail, timeline, documents, WhatsApp contact |
| `/{locale}/dashboard/profile` | Profile |
| `/{locale}/documents/[id]` | Download of the customer's own document, through a 120-second signed link |
| `/{locale}/privacy`, `terms`, `cookies` | Legal pages |

**Request protection:**
- server validation and a hidden honeypot field
- rate limits per account and per hashed address (`consume_rate_limit`)
- a one-time submission token, unique per user, so a double submit returns the first request
- a consent notice
- a random reference: `GTA-` + year and month + 10 random hexadecimal characters

**Document rules:**
- private bucket `customer-documents`, 10 MB maximum, PDF, JPEG or PNG
- the type is checked from the file's first bytes, and a mismatch is deleted
- customers upload only into their own folder, and only while the request's status is `new` or `documents_required` (insert policy in migration `0020`)

## 5. Admin functionality

| Route | What it does |
|---|---|
| `/{locale}/admin` | Overview: total requests, new this week, customers; the five status groups (new, pending, in progress, approved, rejected); counts by service, language and lead source; customers by lead source; the newest requests |
| `/{locale}/admin/applications` | Request list, with a search box and filters by status group, status, lead source (including "not recorded"), language and customer category |
| `/{locale}/admin/applications/[id]` | Request detail: status with customer message, internal notes, document checks, contact log with WhatsApp, lead source correction, customer category, other requests, timeline, delete |
| `/{locale}/admin/customers` | Customers; activate or deactivate an account |
| `/{locale}/admin/services`, `new`, `[id]` | Services and prices. An empty price means "Price on request". |
| `/{locale}/admin/reports`, `reports/export` | Reports; CSV export with spreadsheet-formula protection |
| `/{locale}/admin/emails` | Customer email log and manual retry of failed emails |
| `/{locale}/admin/command-center/*` | AI back office (deferred) |

Admin server actions (`lib/actions/admin.ts`): `updateStatusAction`, `addNoteAction`, `logContactAction`, `correctLeadSourceAction`, `setCustomerCategoryAction`, `setDocumentVerifiedAction`, `deleteApplicationAction`, `saveServiceAction`, `setCustomerActiveAction`, `retryFailedEmailsAction`.

Every exported action calls `adminClient()` in `lib/actions/admin.ts`, which checks that the signed-in user has the `admin` role and is active. The database checks again through Row Level Security and `is_admin()`.

## 6. CRM functionality (launch scope, migration `0023`)

| Feature | Where |
|---|---|
| Lead source per request: `tiktok`, `instagram`, `facebook`, `google`, `whatsapp`, `direct`, `other`, plus a detail value | `applications.lead_source`, `lead_source_detail`; `lib/attribution/lead-source.ts` |
| Source rules | First visit only, from the cookie `gta_lead_source`. A UTM tag wins over the referrer. No cookie means `other`. A recorded source cannot be overwritten without the correction path (database trigger `lead_source_guard`). |
| Admin correction | `correctLeadSourceAction`: a reason is required; records `lead_source_corrected_by` and `_at` and writes an activity entry |
| Customer category: `standard`, `priority`, `returning`, `corporate` | `applications.customer_category`; `setCustomerCategoryAction` |
| Contact log: last contact and channel | `applications.last_contacted_at`, `last_contact_channel`; `logContactAction` |
| Activity log | Table `crm_activity`, append-only even for the database owner |
| Request history | Other requests from the same customer, on the request detail page |
| Statistics and export | Counts by source on the overview; source included in filters and CSV |

A separate AI sales pipeline also exists, and is **deferred**:
- tables `ai_leads`, `ai_lead_stage_history`, `ai_lead_interactions`, `ai_follow_ups` (migration `0015`)
- code in `lib/ai/crm/` and `lib/actions/crm.ts`
- admin page `admin/command-center/crm`

It is not part of the launch.

## 7. Database structure

Tables, views and functions created by each migration (from `create` statements):

| Migration | Tables | Views | Functions | Scope |
|---|---|---|---|---|
| `0001_init.sql` | `profiles`, `services`, `applications`, `documents`, `payments`, `application_notes`, `application_events` | — | 5 (including `is_admin`) | Launch; applied in production 19 Nov |
| `0002_ai_company.sql` | 17 `ai_*` tables (operators, agents, agent runs, workflow runs, tasks, task dependencies, artifacts, approvals, messages, memory, knowledge, events, usage, settings, campaigns, metrics, sources allow-list) | — | 7 | Deferred |
| `0003`–`0018` | `ai_domain_events`, `ai_event_subscriptions`, `ai_event_deliveries`, `ai_context_entries`, `ai_context_versions`, `ai_kb_entries`, `ai_quality_reviews`, `ai_owner_decisions`, `ai_experiments`, `ai_experiment_results`, `ai_scheduler_settings`, `ai_scheduler_jobs`, `ai_worker_heartbeats`, `ai_owner_notifications`, `ai_campaign_*` (5), `ai_content_reviews`, `ai_kb_entry_versions`, `ai_leads`, `ai_lead_stage_history`, `ai_lead_interactions`, `ai_follow_ups`, `ai_competitor_sources`, `ai_competitor_observations`, `ai_review_panels`, `ai_routing_decisions`, `ai_conflicts`, `ai_review_items` | — | 28 | Deferred |
| `0019_manual_payments.sql` | `payment_method_settings`, `payment_method_history`, `payment_audit`, `proof_removals` | `customer_payments`, `customer_application_events` | 16 | Historical; required by `0022` |
| `0020_customer_hardening.sql` | — | — | 1 (`is_active_account`), plus grants and policies | Launch |
| `0021_customer_email_notifications.sql` | `customer_email_notifications` | — | 4 (`enqueue_customer_email`, `record_customer_email_delivery`, `claim_customer_email_retry`, …) | Launch |
| `0022_remove_payment_workflow.sql` | — | `customer_application_events` (recreated without payment events) | 1 (`block_payment_emails`); drops the payment functions and `customer_payments` | Launch |
| `0023_crm_attribution_requests.sql` | `crm_activity`, `rate_limit_hits` | — | 2 (`lead_source_guard`, `consume_rate_limit`) | Launch |

**Storage:** bucket `customer-documents`: private, 10,485,760 bytes, `application/pdf`, `image/jpeg`, `image/png` (`0001`).

**Seeds:**
- `seed.sql`: six services (`visa-consulting`, `appointment-assistance`, `e-visa`, `transit-airport`, `european-trips`, `travel-consultation`) with empty prices.
- `seed_catalog.sql`: five services (`france-visa-appointment`, `visa-file-assistance`, `flight-booking`, `hotel-booking`, `travel-itinerary`) with empty prices.
- `0023` deactivates `european-trips` and `travel-consultation` without deleting them.

**Customer launch order:** `0001` → `seed.sql` → `0019` → `0020` → `0021` → `0022` → `0023` → `seed_catalog.sql` (`docs/MIGRATIONS.md`). Rollbacks: `docs/migrations/0018_rollback.sql` … `0023_rollback.sql`. Integrity: `docs/migrations/manifest.json` (29 SHA-256 entries, all matching on 22 November).

## 8. API structure

There is no REST API for customers. All changes go through Next.js server actions; reads happen in server components.

**Route handlers:**

| Route | File | Access |
|---|---|---|
| `GET /{locale}/auth/callback` | `app/[locale]/auth/callback/route.ts` | Public. Exchanges the Supabase code; the redirect target must be on the same site (`lib/security/redirect.ts`). |
| `GET /{locale}/documents/[id]` | `app/[locale]/documents/[id]/route.ts` | Signed-in users. The document is read through Row Level Security, so only its owner or an admin finds it; anyone else gets 404. The route then redirects to a 120-second signed download link (`Cache-Control: private, no-store`). |
| `GET /{locale}/admin/reports/export` | `app/[locale]/admin/reports/export/route.ts` | Admin; CSV with formula protection |
| `POST /api/ai/scheduler`, `/api/ai/scheduler/watchdog` | `app/api/ai/scheduler/*` | Deferred. Bearer `AI_SCHEDULER_SECRET`; returns 503 when unset and 405 for GET. |
| `robots.txt`, `sitemap.xml`, `opengraph-image` | `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx` | Public metadata |

**Server actions (launch scope):**

| File | Actions |
|---|---|
| `lib/actions/auth.ts` | `signInAction`, `signUpAction`, `requestPasswordResetAction`, `updatePasswordAction`, `signOutAction`, `updateProfileAction` |
| `lib/actions/applications.ts` | `createApplicationAction` |
| `lib/actions/documents.ts` | `registerDocumentAction`, `deleteDocumentAction` |
| `lib/actions/admin.ts` | See section 5 |

**Database RPCs used by the app:**
- `consume_rate_limit`
- `enqueue_customer_email`
- `record_customer_email_delivery`
- `claim_customer_email_retry`

## 9. Authentication structure

| Layer | What it does |
|---|---|
| Supabase Auth | Email and password; email confirmation. Templates in `supabase/templates/` are pasted into the Supabase dashboard. |
| `@supabase/ssr` clients | `lib/supabase/browser.ts`, `server.ts` |
| Session refresh | `middleware.ts` → `lib/supabase/middleware.ts`, on every request, before headers are copied |
| Page and action guards | `lib/auth.ts`: `getCurrentUser`, `getCurrentProfile`, `requireCustomer`, `requireAdmin`, `loginPath`; `customerSession`, `adminSession` |
| Roles | `profiles.role` is `customer` or `admin`. `public.is_admin()` checks role `admin` and `is_active`. Customers cannot change their own role or active status (trigger in `0001`). |
| Disabled accounts | `profiles.is_active = false` is blocked in the app and in the database (`is_active_account()`, `0020`) |
| Row Level Security | On all customer tables. Customers see only their own rows; admins see all. Column-level grants (`0020`). |
| Making the first admin | By SQL in the Supabase editor (`docs/staging/STAGING_RUNBOOK.md`, section 2). No admin email is configured in code: there is no `ADMIN_EMAIL` setting, and no app, component or library file contains an email address. |

## 10. Email architecture

| Part | File |
|---|---|
| Kinds (7): `application_received`, `application_status_updated`, `additional_documents_requested`, `application_approved`, `application_rejected`, `document_upload_confirmed`, `document_review_result` | `lib/email/kinds.ts` |
| Supabase Auth emails (2): signup confirmation, password reset | `supabase/templates/confirmation.html`, `recovery.html` |
| Wording in ar, fr, en | `lib/email/copy.ts` |
| HTML and text rendering; Arabic right to left; escaping | `lib/email/templates.ts` |
| Queue after the response (`after()`) | `lib/email/notify.ts` |
| Dedupe, recipient taken from `profiles.email`, customer-visible fields only | `enqueue_customer_email` (`0021`) |
| Send and record sent, failed or skipped, with short error codes | `lib/email/service.ts`, `record_customer_email_delivery` |
| SMTP (nodemailer 10), TLS required | `lib/email/transport.ts`, `lib/email/config.ts` |
| Manual retry, at most 5 attempts, atomic claim | Admin → Customer emails; `claim_customer_email_retry` |
| Payment emails refused | Trigger `block_payment_emails` (`0022`) |

Environment variables: `EMAIL_DELIVERY_ENABLED` (off unless exactly `true`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. Full description: `docs/EMAIL_NOTIFICATIONS.md`.

## 11. WhatsApp integration

- **Link builder:** `lib/config.ts` → `whatsappLink(text?)` builds `https://wa.me/<digits>` with an optional prefilled message. It returns `null` when no number is configured.
- **Number:** `NEXT_PUBLIC_WHATSAPP_NUMBER`. The repository template holds `8485462510`, with a note to confirm it (see the recovery report, discrepancy X-1).
- **Placement:**
  - floating button (`components/site/WhatsAppFloat.tsx`)
  - every service page
  - the customer's request page, with the reference prefilled
  - the admin request detail, which opens a chat and lets the owner log the contact
- **Manual only.** There is no WhatsApp API, automation or automatic sending. `tests/launch/whatsapp-and-payments-removed.test.ts` covers the link builder.

## 12. Test suites

| Suite | Location | What it covers |
|---|---|---|
| Unit and integration (Vitest) | `tests/**/*.test.ts` (104 files) | Validation, i18n parity, actions, email, CSV, legal, services, security, attribution, signatures |
| Database (PGlite, in-memory Postgres) | `tests/db/*.test.ts` (24 test files), `tests/db/supabase-stubs.sql`, `tests/db/helpers.ts` | Migration chain, customer sequence, RLS, payment removal, CRM, emails, rollbacks, AI tables |
| AI back office | `tests/ai/` (64 files) | Deferred modules |
| Live local model (opt-in) | `tests/local/live-inference.test.ts` | Skipped unless a local Ollama model is running |
| Browser smoke | `tests/browser/smoke.mjs` (`npm run test:browser`) | 30 checks on a production build: pages in 3 languages, RTL, 375px layout, admin redirects, auth forms, CSP |
| Auth email templates | `scripts/auth-templates/check.go` | Runs the templates with Go's `html/template`, as Supabase does |

Last results, 22 November: lint and typecheck pass. Vitest: 103 files passed and 1 skipped (`tests/local`); 1,361 tests passed and 3 skipped. Build passes. Browser smoke 30/30.

## 13. Deployment and staging documentation

| Document | Content |
|---|---|
| `DEPLOYMENT.md` | Deployment order and rules for the new version. It does **not** describe the live production setup (see the recovery report, section 5). |
| `docs/ENVIRONMENT.md` | Every environment variable, which are public, and the WhatsApp note |
| `docs/MIGRATIONS.md` | Customer launch order, AI migrations excluded |
| `docs/staging/STAGING_RUNBOOK.md` | Staging steps, logged-in checks, email checks, exit criteria. Not started. |
| `docs/staging/execution-plan.md` | Older staging plan for `0002`–`0019`; superseded |
| `docs/LAUNCH_CHECKLIST.md` | Owner decisions, configuration, pre-launch and first-week checks |
| `docs/COMPLETION_CHECKLIST.md` | Built and tested versus verified live, per area |
| `docs/FINAL_TECHNICAL_REPORT.md` | Final report of the 21 November launch pass |
| `docs/migrations/*` | Rollbacks, the 0018 backup procedure, the manifest |
| `docs/security/*` | CSP and redirect security |
| `.env.example` | Variable names and non-secret values |

**Production as recorded on 19–20 November** (from the recovery report, section 5):
- Vercel project `football-ai-pro-v5d9` builds branch `claude/affectionate-rubin-la5937` from root directory `globaltravelassi`.
- The Supabase project is `globaltravelassi`.
- The domain `globaltravelassi.online` is registered at Spaceship.
