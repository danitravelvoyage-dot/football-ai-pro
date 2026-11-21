# Environment variables

Set these in the hosting provider, or in a local `.env.local` that is never committed. `.env.example` lists the names with empty or placeholder values. No real value belongs in git.

## Public (sent to every browser; build time)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes (production) | `https://<project>.supabase.co` | Also sets the exact origin in the content security policy. Unset falls back to a wildcard. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | the project's anon public key | Public by design. Row Level Security protects the data. |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://globaltravelassi.online` | No trailing slash. Used in links, the sitemap and emails. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | yes | the official business address | Shown on the legal pages and in the footer. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | yes | `8485462510` (see note) | Digits only, with the country code. Used for all WhatsApp links. |

Note on the WhatsApp number: the owner gave `+8485462510`. The country code `84` is Vietnam's. Confirm the number and its country code before launch. A wrong code sends customers to the wrong person.

## Server only (never prefix with `NEXT_PUBLIC_`)

| Variable | Required | Notes |
|---|---|---|
| `AI_SCHEDULER_SECRET` | only for the AI scheduler | At least 32 random characters. Not needed for the customer launch. |
| `AI_WORKER_EMAIL`, `AI_WORKER_PASSWORD` | only for the AI scheduler | Operator account credentials. Not needed for the customer launch. |

## Email (server only)

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_DELIVERY_ENABLED` | yes to send | Exactly `true` to send. Anything else: emails are recorded as skipped. |
| `SMTP_HOST` | when enabled | The provider's SMTP host |
| `SMTP_PORT` | when enabled | `587` (STARTTLS, required by the app) or `465` (implicit TLS) |
| `SMTP_SECURE` | when enabled | `true` for port 465 |
| `SMTP_USER` | when enabled | SMTP login |
| `SMTP_PASSWORD` | when enabled | SMTP password or app password. Secret. |
| `EMAIL_FROM` | when enabled | For example `GLOBALTRAVELASSI <no-reply@your-domain>` |
| `EMAIL_REPLY_TO` | no | A monitored inbox |

The app reports only the **names** of missing variables, never values.

## Secrets rule

Secret values (`SMTP_PASSWORD`, `AI_SCHEDULER_SECRET`, `AI_WORKER_PASSWORD`) are entered only in the hosting provider's secret store. Never paste them into chat, a commit, a document or a log.
