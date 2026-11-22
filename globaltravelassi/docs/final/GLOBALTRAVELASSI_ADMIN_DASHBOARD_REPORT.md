# GLOBALTRAVELASSI: admin dashboard report

Date: 22 November 2026. Verified by `npm run test:admin-browser`: 26 signed-in checks against synthetic data, all passing, in ar, fr and en, at desktop width and at 390 px.

## Design

| Requirement | Status |
|---|---|
| Dark and light themes | **New.** A switch in the admin header, remembered in a preference cookie, scoped to the admin area. Measured contrast in dark mode: 16.1:1 titles, 10.0:1 muted text. |
| Desktop, tablet, mobile | Verified at 1366 px and 390 px. **Fixed** a sideways scroll of 205–320 px on phones. |
| RTL and LTR | Verified: `dir` correct on every admin page in all three languages |
| No fake metrics | All figures come from the database. With no data they show zero. The AI pages show empty states. |
| Premium SaaS style | The existing navy and gold design system. No redesign in this pass. |

## Customer-launch modules (in scope, verified)

| Module | Features | Status |
|---|---|---|
| Overview | Total requests, new this week, customers, five status groups, counts by service, language and lead source, customers by source, newest requests | Works |
| Requests (CRM) | Search, filters (status group, status, lead source, language, category), **pagination (new)**, **priority and follow-up due (new)** | Works |
| Request detail (CRM) | **Lead qualification and next step (new)**, **document checklist (new)**, status changes with customer message, document checks, contact log with WhatsApp, internal notes, append-only activity log, lead-source correction with reason, category, other requests, timeline | Works. The contact write is verified in the browser. |
| Customers | List with request counts, activate and deactivate, **search and pagination (new)** | Works |
| Services and prices | Create and edit; an empty price means "Price on request" | Renders |
| Customer emails | Delivery log, retry of failed emails | Renders |
| Reports | By service, source and language; CSV export with formula protection | Renders |

## Brief modules compared with what exists

| Brief module | What exists | Gap |
|---|---|---|
| `command_center` | AI command-center overview, COO, approvals, tasks (deferred) | Back office not deployed |
| `agents_management` | Agents page (registry, capabilities), tasks (execution history) | No per-agent enable or disable switch verified in this pass |
| `workflow_monitor` | Tasks, events and execution trace pages | Not verified with real runs |
| `live_activity` | Events, audit, notifications pages | No free-text log search |
| `models_and_providers` | Monitor page: provider health and usage; credentials are server-side only | No provider editing in the UI (configured by environment variables) |
| `crm` | Customer requests CRM (verified) and AI CRM (deferred, separate data) | The two are not linked |
| `analytics` | Reports page; AI analytics page (deferred) | **No conversion rate by source:** the site does not count visits |
| `administration` | Audit pages, CRM activity log, scheduler and notification settings (deferred) | **No role management UI**: admins are promoted by SQL. No application settings page. |

## Changes in this pass

- `app/[locale]/admin/layout.tsx`: theme wrapper, theme switch, phone grid fix
- `app/[locale]/admin/applications/page.tsx`: priority column, pagination
- `app/[locale]/admin/applications/[id]/page.tsx`: qualification and checklist panels
- `app/[locale]/admin/customers/page.tsx`: search, pagination
- `components/admin/LeadInsights.tsx`, `Pagination.tsx`, `ThemeToggle.tsx` (new)
- `app/globals.css`, `tailwind.config.ts`: theme roles; the WhatsApp button is hidden in admin
- `lib/validation/messages.ts`: the missing "Contact recorded." message
