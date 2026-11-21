# Completion checklist (customer launch scope)

Snapshot after the launch-preparation pass. "Built" means the code exists and passes automated checks. "Verified live" needs a staging project, and none has been run yet.

| Area | Built | Automated checks | Verified live |
|---|---|---|---|
| Public site: home, services, privacy (ar, fr, en, RTL) | Yes | Browser smoke, 375px | No |
| Services catalogue: the 9 business services | Yes (`seed.sql` + `seed_catalog.sql`, prices empty) | PGlite | No |
| Registration, login, logout, password reset | Yes | Unit, browser (forms render) | No |
| Auth emails in ar, fr, en (Supabase templates) | Yes | Go template execution | No |
| Customer dashboard and request list | Yes | Build | No |
| Request creation (records its language) | Yes | Unit, PGlite | No |
| Document upload, list, download, removal | Yes | Unit, PGlite | No |
| Payment instructions (USDT, BaridiMob, RedotPay) | Yes, owner-entered | Unit, PGlite | No |
| Payment proof submission, then "waiting for review" | Yes | Unit, PGlite | No |
| Request timeline, localised | Yes | Build | No |
| Admin: requests, status, notes, documents, payments | Yes | Unit, PGlite, sign-in redirect | No |
| Admin: payment approval and rejection | Yes | Unit, PGlite | No |
| Admin: customers (activate, deactivate) | Yes | Unit | No |
| Admin: services and prices | Yes | Unit | No |
| Admin: reports and CSV export | Yes | Unit | No |
| Admin: customer email log and retry | Yes | Unit, PGlite | No |
| Payment audit log (append-only) | Yes (0019) | PGlite | No |
| Customer transactional emails (10 kinds) | Yes | Unit, PGlite | No (no SMTP configured) |
| CSP with per-request nonce (report-only) | Yes | Unit, browser, enforcement dry run on public pages | No |
| Open-redirect protection | Yes | Unit | No |
| RLS for customers and owner | Yes (0001, 0019, 0020, 0021) | PGlite | No |
| Disabled accounts blocked (app and database) | Yes | Unit, PGlite | No |
| AI back office | Exists, deferred | Unit, PGlite | No (out of scope) |

## Open items

1. Logged-in browser tests on staging (needs a staging project, which needs owner approval).
2. Migrations 0019, 0020 and 0021 applied nowhere.
3. SMTP not configured. No real email has been sent.
4. CSP enforcement not enabled (needs owner approval after staging).
5. Real prices and real payment instructions are owner data, not entered.
