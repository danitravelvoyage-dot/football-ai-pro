# Content-Security-Policy

Status: **report-only** (Phase 1, pre-staging). Source: `next.config.mjs`, header `Content-Security-Policy-Report-Only`.

## Policy served

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Baseline: same origin only. |
| `script-src` | `'self' 'unsafe-inline'` (+ `'unsafe-eval'` outside production) | Next.js App Router inlines its bootstrap scripts without a nonce. See "Known weakness". |
| `style-src` | `'self' 'unsafe-inline'` | React `style` props and the Next.js runtime. |
| `img-src` | `'self' data: blob:` + Supabase project origin | Data-URL icons; signed image links from storage. |
| `font-src` | `'self' data:` | Fonts are self-hosted at build time by `next/font`. No external font CDN. |
| `connect-src` | `'self'` + Supabase project origin and its `wss:` origin | Supabase auth, database and realtime calls from the browser. |
| `media-src` | `'self' blob:` | |
| `object-src` | `'none'` | No plugins. |
| `frame-src` | `'none'` | The site embeds no frames. |
| `worker-src` | `'self' blob:` | |
| `manifest-src` | `'self'` | |
| `base-uri` | `'self'` | Stops `<base>` injection. |
| `form-action` | `'self'` | Forms post to this site only. |
| `frame-ancestors` | `'none'` | Clickjacking protection, matching `X-Frame-Options: DENY`. |

The Supabase origin is read from the public `NEXT_PUBLIC_SUPABASE_URL` at build time, and only its origin is used. If the variable is missing, the policy falls back to `https://*.supabase.co`. That fallback is looser, so builds for staging and production must set the variable.

## What was verified (local, production build)

- The header is served on real responses (`tests/browser/smoke.mjs`, check "CSP report-only header is served").
- No CSP violation on the public home page, the login, register and forgot-password pages, in English, French and Arabic (check "no CSP violations on public and auth pages"). Violations are read from the browser's `securitypolicyviolation` event, which also fires in report-only mode.
- The listener was confirmed to catch a deliberate violation (a blocked image source), so the zero-violation result is not vacuous.
- Full `npm run verify` and the browser smoke test pass with the header in place.

## Not verified

- Logged-in pages: dashboard, application, document upload, payment panel, admin screens. They need a Supabase project, which does not exist for this phase. Their Supabase calls are allowed by `connect-src`, but no browser run has confirmed this.
- Server actions: they are same-origin POSTs and are allowed by `form-action 'self'` and `default-src`, but no browser run has submitted a form.

## Known weakness

`script-src` allows `'unsafe-inline'`. Any injected inline script would run, so the policy currently gives limited protection against cross-site scripting. The main defence remains the React escaping and the input validation in the server actions.

## Path to enforcement

1. Add a per-request nonce in middleware and pass it to Next.js, or move to hashes. Confirm Next.js App Router output carries the nonce on every inline script.
2. Remove `'unsafe-inline'` from `script-src` and keep `'strict-dynamic'` if needed.
3. Run the logged-in browser flows on staging and clear every reported violation.
4. Switch the header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.

No violation-collection endpoint exists. Adding one would be a new server surface and is deferred to the staging phase.
