# Customer email notifications

Status: **implemented and tested locally. Not live.** Needs migrations 0020 and 0021 applied (owner approval), SMTP settings on the server, and `EMAIL_DELIVERY_ENABLED=true`. Until then, nothing is sent and every email is recorded as skipped.

## Flows

| Email | Trigger | Sent by | Language |
|---|---|---|---|
| Registration confirmation | Sign-up | Supabase Auth (`supabase/templates/confirmation.html`) | `locale` saved at sign-up; all three languages if missing |
| Password reset | "Forgot password" | Supabase Auth (`supabase/templates/recovery.html`) | Same |
| Request received | Customer submits a request | App, `createApplicationAction` | Language of the request |
| Status updated | Owner sets in review, submitted, completed or cancelled | App, `updateStatusAction` | Language of the request |
| Additional documents requested | Owner sets "documents required" | Same | Same |
| Request approved | Owner sets "approved" | Same | Same |
| Request rejected | Owner sets "rejected" | Same | Same |
| Payment proof received | Customer submits a proof | App, `submitPaymentEvidenceAction` | Same |
| Payment approved | Owner confirms funds received | App, `decidePaymentAction` | Same |
| Payment rejected | Owner rejects a proof | Same | Same |
| Document upload confirmed | Customer uploads a document | App, `registerDocumentAction` | Same |
| Document review result | Owner marks a document checked or unchecked | App, `setDocumentVerifiedAction` | Same |

No email is sent when the owner sets "payment pending" by hand: that is now refused, because only a proof submission sets it.

## How it works

1. The action finishes its own work first. The email is then queued after the response (`after()` in `lib/email/notify.ts`), so the visitor never waits for the mail server, and an email problem never undoes the action.
2. `enqueue_customer_email(kind, record id)` (migration 0021) runs in the database. It:
   - checks who may send it: the request's owner (active account) for customer-triggered kinds, the business owner for the rest;
   - computes the dedupe key from the kind and the record (for document reviews, also the checked state). A second trigger returns nothing, so **an email is never sent twice**;
   - takes the recipient from `profiles.email` (the sign-in account), never from the caller or the request form;
   - builds the template data from customer-visible fields only. Internal notes, the owner's internal payment reason, file paths and the owner's identity are never copied.
3. `lib/email/service.ts` checks the recipient, renders the email, sends it through `lib/email/transport.ts` (nodemailer, SMTP), and records `sent` or `failed` with a short error code (`auth_failed`, `timeout`, `connection_failed`, `recipient_rejected`, `temporary_failure`, `send_failed`). Provider messages are never stored, because they can contain addresses or server details.
4. If delivery is off or SMTP is incomplete, the email is recorded as `skipped` / `not_configured`. Nothing is ever recorded as sent without a successful SMTP send.

### Failures and retries

- **Failed** emails can be retried by the owner on **Admin → Customer emails**. That's at most five attempts each. The claim is atomic, so two retries at the same time send once.
- A **pending** email that stays pending has an unknown outcome: the process stopped between sending and recording. It is not retried automatically, because it may already have been delivered. The page explains this.
- **Skipped** emails (delivery off, or no valid account address) are not retried.

### Templates

- `lib/email/copy.ts` holds the wording in Arabic, French and English. `lib/email/templates.ts` builds the subject, the HTML and the plain text.
- The HTML is a single 600px column that shrinks on phones, with inline styles only, no images and no tracking. Arabic is laid out right to left (`dir="rtl"`, right-aligned).
- Every value is HTML-escaped. Subjects are reduced to one line, so no header can be injected.
- A proof email says it is **not yet a confirmation**. Only the owner's decision confirms a payment.

## Configuration

Server-only environment variables. The names are in `.env.example`; values are never logged or shown. The admin page shows only "on" or "off".

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_DELIVERY_ENABLED` | yes | Exactly `true` to send. Anything else means off. Keep it off on development and staging. |
| `SMTP_HOST` | yes | The provider's SMTP host |
| `SMTP_PORT` | no | `587` (default; STARTTLS is required) or `465` (implicit TLS) |
| `SMTP_SECURE` | no | `true` for port 465 |
| `SMTP_USER`, `SMTP_PASSWORD` | yes | SMTP login. Use an app password where the provider offers one. |
| `EMAIL_FROM` | yes | e.g. `GLOBALTRAVELASSI <no-reply@your-domain>` |
| `EMAIL_REPLY_TO` | no | A monitored inbox |

### SMTP setup ($0)

Any SMTP server works. Free options exist (a mailbox provider's SMTP with an app password, or a transactional provider's free tier). Check the provider's current daily limits and terms yourself before choosing; they change. To set it up:

1. Create or choose the sending mailbox. If you own a domain, use an address on it.
2. If the provider offers it, create an **app password** for SMTP. Don't use the main account password.
3. On your domain, add the provider's **SPF** record and enable **DKIM**. Add a **DMARC** record. Without these, many emails land in spam.
4. Set the variables above in the hosting environment, not in a file in the repository.
5. Send one email to an address you own. On staging, use a throwaway customer account whose email is yours, and confirm the row in **Admin → Customer emails** shows "Sent".
6. Only then set `EMAIL_DELIVERY_ENABLED=true` in production.

### Supabase Auth emails

Supabase sends the confirmation and reset emails itself.

1. **Authentication → Email Templates**: paste `supabase/templates/confirmation.html` into "Confirm signup" and `recovery.html` into "Reset password". Suggested subjects, since one subject serves all languages: `Confirm your email · Confirmez votre e-mail · أكّد بريدك الإلكتروني` and `Reset your password · Réinitialisez votre mot de passe · إعادة تعيين كلمة المرور`.
2. **Authentication → SMTP Settings**: enter the same SMTP account. Supabase's built-in sender is meant for testing and is heavily rate-limited.
3. **URL Configuration**: the site URL and the redirect URLs must include `https://<your-domain>/*/auth/callback`.

The templates were executed with Go's `html/template`, the engine Supabase uses, for ar, fr, en, a missing locale and empty metadata. Re-run with `go run scripts/auth-templates/check.go supabase/templates`.

## Tests

- `tests/email/templates.test.ts`: every kind in every language, escaping, header safety, no internal fields, links, wording parity.
- `tests/email/service.test.ts`: duplicates, invalid recipient, delivery off, failure codes, a throwing transport, a database outage, concurrent retries, the five-attempt cap.
- `tests/email/config-transport.test.ts`: off by default, missing variables reported by name only, TLS settings, error codes without provider text.
- `tests/db/customer-hardening-emails.test.ts`: the SQL rules on PGlite (recipient, language, dedupe, permissions, customer-visible content only, append-only log, retry claim, deleted requests).
- `tests/actions/customer-email-wiring.test.ts` and `tests/actions/payments-actions.test.ts`: which action queues which email.

## Not done or not verified

- **No real email has been sent.** No SMTP account was configured, and none should be until you choose a provider. Delivery to real inboxes, spam placement and rendering in Gmail and Outlook are not verified.
- The SQL functions ran on PGlite, not on a Supabase project.
- No scheduled automatic retry. Retries are manual, from the admin page.
- Customers cannot opt out of these emails. They are transactional, about their own requests, but check the rules for your market.
