# Completion checklist: customer launch scope

"Built" means the code exists and passes the automated checks. "Verified live" needs a staging project, which has not been created yet.

| Area | Built | Automated checks | Verified live |
|---|---|---|---|
| Public site (home, services, privacy, terms, cookies), ar / fr / en, RTL | Yes | browser smoke, 375px | no |
| Nine service pages: content, metadata, Open Graph, language alternates | Yes | unit (content), browser | no |
| Services catalogue, prices "on request" | Yes | database (PGlite) | no |
| Sign-up, sign-in, sign-out, password reset | Yes | unit, browser (forms render) | no |
| Auth emails in ar / fr / en (Supabase templates) | Yes | Go template execution | no |
| Service request form: validation, honeypot, rate limit, one-time token, consent notice | Yes | unit, database | no |
| Request reference (10 random hex characters) | Yes | database | no |
| Customer dashboard, request list and detail, timeline | Yes | build | no |
| Document upload, list, download, removal; file signature check | Yes | unit, database | no |
| Lead source attribution (first visit, cookie, UTM, referrer) | Yes | unit, database | no |
| Admin overview, statistics by status group, service, language, source | Yes | build | no |
| Admin requests: list, filters, detail, status, notes | Yes | unit | no |
| Admin CRM: lead source correction, customer category, contact log, activity | Yes | unit, database | no |
| Admin customers (activate and deactivate) | Yes | unit | no |
| Admin services and prices | Yes | unit | no |
| Admin reports and CSV export, formula-safe | Yes | unit | no |
| Admin customer email log and retry | Yes | unit, database | no |
| Customer emails (seven app flows plus two Supabase Auth flows) | Yes | unit, database | no (no SMTP configured) |
| WhatsApp: click-to-chat links, manual contact, prefilled messages | Yes | unit (link builder), browser | no (number unconfirmed) |
| Lead qualification on real requests (rules, reasons, next step, follow-up due) | Yes | unit, admin browser (fake API) | no |
| Document checklist per service (admin and customer) | Yes | unit, admin browser (fake API) | no |
| Admin pagination and customer search | Yes | unit, admin browser (fake API) | no |
| Admin dark and light themes | Yes | unit, admin browser (contrast measured) | no |
| Unknown service URLs answer 404 | Yes | browser smoke | no |
| Payment workflow | **Removed** | tests check it is gone | no |
| Content security policy (nonce, report-only) | Yes | unit, browser | no |
| Open-redirect protection | Yes | unit | no |
| Row Level Security, disabled accounts blocked (app and database) | Yes | database | no |
| AI back office | Deferred | unit | out of scope |

## Open items

1. A staging project: blocked by the organisation's free-plan project limit (owner decision).
2. Migrations 0019–0023 are applied nowhere.
3. SMTP not configured; no real email has been sent.
4. WhatsApp number country code to be confirmed.
5. Legal text and retention periods to be confirmed by the owner.
6. CSP enforcement not enabled.
