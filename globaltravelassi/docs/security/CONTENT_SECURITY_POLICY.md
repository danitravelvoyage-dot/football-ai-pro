# Content-Security-Policy

Status: **report-only, nonce-based script policy** (Phase 2). Not enforced. Enforcement is a separate decision, after the open items in "Before enforcement" are closed.

## How it is delivered

- Built per request in `middleware.ts` from `lib/security/csp.ts`.
- Each request gets a new 128-bit nonce from the Web Crypto API.
- The policy is sent as `Content-Security-Policy-Report-Only` on every response the middleware handles (pages, redirects, the scheduler trigger). Static assets (`/_next/static`, images, `robots.txt`, `sitemap.xml`, the OG image) are excluded by the middleware matcher and carry no policy. They contain no inline scripts.
- The same policy is also set on the request as `Content-Security-Policy`. Next.js reads the nonce from the `script-src` directive and applies it to every inline script it renders.
- `next.config.mjs` no longer sets a CSP. A static header there would conflict with the per-request one.
- Every HTML route is rendered on demand (`force-dynamic`), so no page can be served with a stale nonce. The build output confirms it: all HTML routes are dynamic.

## Policy served

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Baseline: same origin only. |
| `script-src` | `'self' 'nonce-<per request>' 'strict-dynamic'` (+ `'unsafe-eval'` outside production) | Scripts run only with the request's nonce, or when loaded by such a script. **No `'unsafe-inline'`.** |
| `style-src` | `'self' 'unsafe-inline'` | React `style` props and the Next.js runtime emit inline styles. See "Known weakness". |
| `img-src` | `'self' data: blob:` + Supabase project origin | Data-URI icons; signed image links from storage. |
| `font-src` | `'self' data:` | Fonts are self-hosted at build time by `next/font`. No runtime font CDN. |
| `connect-src` | `'self'` + Supabase project origin and its `wss:` origin | Supabase auth, database and realtime calls from the browser. |
| `media-src` | `'self' blob:` | |
| `object-src` | `'none'` | No plugins. |
| `frame-src` | `'none'` | The site embeds no frames. |
| `worker-src` | `'self' blob:` | |
| `manifest-src` | `'self'` | |
| `base-uri` | `'self'` | Stops `<base>` injection. |
| `form-action` | `'self'` | Forms post to this site only. |
| `frame-ancestors` | `'none'` | Clickjacking protection, matching `X-Frame-Options: DENY`. |

The Supabase origin is derived from the public `NEXT_PUBLIC_SUPABASE_URL` (origin only, no keys). If the variable is unset, the policy falls back to `https://*.supabase.co`. That is looser. Staging and production builds must set the variable.

## External origins the policy allows

| Origin | Directive | Used for |
|---|---|---|
| Supabase project (`https://<project>.supabase.co`) | `connect-src`, `img-src` | Authentication, database, storage (signed document and proof links). |
| Supabase project websocket (`wss://<project>.supabase.co`) | `connect-src` | Realtime, if used. |

No other external origin is needed. The WhatsApp link is a plain navigation link and is not governed by CSP. Fonts are downloaded at build time, not by the browser. The site loads no third-party script, analytics, tag manager or embed.

## Verified (local, production build)

- The policy is served on real responses, including the 404 page.
- Every inline script in the HTML carries the nonce of its own response, across seven routes: public pages, login, register, forgot password, and an unknown path. JSON-LD blocks are data and excluded.
- Two requests get different nonces.
- No CSP violation on public and auth pages in English, French and Arabic, under the report-only header.
- **Enforcement dry run:** the same pages were loaded with the policy enforced instead of reported (the browser test rewrites the header on the document response). In English, French and Arabic they hydrate, with no violation and no page error. Hydration is shown by the Next.js payload being present, which only happens when its inline scripts run.
- **Negative control (page code):** under the enforced policy, an inline `onerror` handler and a string passed to `setTimeout` were both blocked. The listener recorded `script-src-attr inline` and `script-src eval`.
- Unit tests (`tests/security/csp-nonce.test.ts`): nonce uniqueness and format, the policy parsed by Next.js's own nonce parser, no `'unsafe-inline'` in `script-src`, `'unsafe-eval'` only in development, Supabase origins, the per-request nonce on the response and on the forwarded request, and a client-supplied policy being replaced.

### A note on test controls

Scripts injected with Playwright's `page.evaluate` are **not** a valid negative control: they run through the DevTools protocol and are not blocked by the page's policy. Negative controls must be created by page code, as above.

## Not verified

- Logged-in pages (dashboard, applications, document upload, payment panel, admin). They need a Supabase project, which does not exist for this phase. Their Supabase calls are allowed by `connect-src`, but no browser run has confirmed it.
- Server-action form submissions, which are same-origin POSTs. Not exercised in a browser.
- Document and proof downloads through signed links. Navigation, not affected by `img-src` or `connect-src`. Image rendering from signed links is not verified.

## Known weakness

- **`style-src` allows `'unsafe-inline'`.** Injected inline styles can change page layout or hide content, but cannot run script. Removing it needs style hashes or nonces for every inline style, which React and Next.js do not provide out of the box. This is accepted for now and is the next hardening item after enforcement.
- **Development uses `'unsafe-eval'`** for hot reload. It is excluded in production builds.

## Before enforcement

1. Run the logged-in flows on a staging Supabase project under the report-only header, and clear every reported violation. (Needs owner approval for the staging project.)
2. Confirm the staging and production builds set `NEXT_PUBLIC_SUPABASE_URL`, so the exact origin is used instead of the wildcard.
3. Decide whether a violation-collection endpoint is wanted. None exists. Adding one is a new server surface and is deferred.
4. Switch the header name from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `middleware.ts`, then repeat the smoke test's enforcement check on staging.

## Changes from Phase 1

- Phase 1 served a static report-only policy from `next.config.mjs` with `'unsafe-inline'` in `script-src`.
- Phase 2 builds the policy per request in middleware with a nonce, removes `'unsafe-inline'` from `script-src`, and keeps `style-src` unchanged.
