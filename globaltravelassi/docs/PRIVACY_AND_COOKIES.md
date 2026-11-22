# Privacy and cookies: working notes

This file is for the team. The public text is in `lib/legal/content.ts` (privacy notice, terms of use, cookie notice) and is shown at `/<locale>/privacy`, `/terms` and `/cookies`. The owner reviews the public text before launch.

## Personal data held

| Data | Where | Who can read it | Why |
|---|---|---|---|
| Account: name, email, WhatsApp, role, active flag | `profiles` (Supabase Auth) | the account itself; administrators | sign-in, the request |
| Request: nationality, residence, destination, travel date, employment, travel history, free text | `applications` | the request's account; administrators | preparing the request |
| Documents (PDF, JPEG, PNG) | private storage bucket `customer-documents` | the account; administrators, through signed links that expire | the file |
| Lead source and campaign tag | `applications.lead_source`, `lead_source_detail` | administrators | knowing which channels bring requests |
| Internal notes, activity, contact log | `application_notes`, `crm_activity`, `applications.last_contact*` | administrators only | running the service |
| Email log: kind, recipient, status, error code | `customer_email_notifications` | administrators | delivery |
| Rate-limit counters: hashes only | `rate_limit_hits` | nobody (server function only) | blocking automated submissions |

## Cookies the site sets

| Name | Purpose | Lifetime | Personal data? |
|---|---|---|---|
| Supabase session cookies | sign-in | until sign-out or expiry | the session token; needed |
| `gta_lead_source` | records the channel of the first visit (`tiktok`, `instagram`, `facebook`, `google`, `whatsapp`, `direct`, `other`) and a campaign tag if one was given | 30 days, httpOnly, SameSite=Lax | no |
| `gta_admin_theme` | remembers an administrator's light or dark choice in the admin dashboard; set only when a team member uses the theme switch, never for visitors | 1 year, SameSite=Lax | no |

No advertising cookie, no third-party analytics and no tracking pixel is used.

## Lead source rules (implemented in `lib/attribution/lead-source.ts`)

- A campaign tag (`utm_source`) wins over the referring site.
- A referring site is matched to a channel by its domain. An unknown site is `other`, never guessed.
- No referrer and no tag: `direct`.
- The first source of a visit is kept. A later visit does not overwrite it.
- Only the channel name and a plain campaign label (letters, digits, `._-`, up to 100 characters) are stored. No full URL, no IP address, no user agent.
- If the cookie is blocked or missing, the request is recorded as `other`.

## Other protections that touch personal data

- Request form: honeypot field, rate limits per account and per hashed address (the address is hashed with SHA-256 before storage; the raw address is not stored), one-time submission token.
- Documents: the file's first bytes are checked against the declared type. A file that does not match is deleted and not stored.
- The CSV export neutralises spreadsheet formulas.

## Retention

No automatic deletion is implemented. Retention periods must be decided by the owner and then implemented. Until then, the owner deletes a request by hand (the delete action keeps any request with protected records).

## Open items

- Retention periods: decision needed.
- Deletion or export on a customer's request: handled manually for now.
- Confirm the public text with the owner and, if applicable, a lawyer before launch.
