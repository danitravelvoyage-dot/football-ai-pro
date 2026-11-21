# Redirect security

Status: fixed in Phase 1 (pre-staging). Code: `lib/security/redirect.ts`.

## Rule

Any redirect whose target comes from the request must pass `sameOriginPath()` (or `safeNext()`, which calls it). A destination is accepted only if all of these hold:

1. It is non-empty.
2. It contains no C0 control character, no space, no DEL and no backslash.
3. It starts with `/` and not with `//`.
4. Resolved against the site origin, it keeps the same origin.

Anything else falls back to a safe local page: the locale dashboard for sign-in and callbacks, or the sign-in page for expired links.

## Why the character rules come first

The WHATWG URL parser removes tabs and newlines anywhere in the input and treats a backslash as a slash in special schemes. So a string that does not begin with `//` can still become a protocol-relative URL to another host:

| Input | Old check result | Resolved host (old) |
|---|---|---|
| `/\evil.example/x` | accepted | `evil.example` |
| `/<TAB>/evil.example` | accepted | `evil.example` |
| `/<LF>/evil.example` | accepted | `evil.example` |

These were confirmed against the old logic (Node URL parser). The old callback check was `startsWith("/") && !startsWith("//")`. `safeNext` also missed tabs and newlines.

## Where it is used

| Call site | Base | Fallback |
|---|---|---|
| `app/[locale]/auth/callback/route.ts` (email confirmation, password reset) | request origin | `/<locale>/dashboard`, or `/<locale>/auth/login?error=expired` on failure |
| `lib/actions/helpers.ts` `safeNext` (sign-in, sign-up) | fixed non-routable base, origin compared | locale dashboard or admin page |

## Regression tests

`tests/security/safe-redirect.test.ts` (59 tests):

- 20 rejected inputs, including protocol-relative, backslash, tab, newline, carriage return, NUL, DEL, absolute `https` and `http`, `javascript:`, `data:`, bare hosts, empty and whitespace.
- Accepted plain paths with query and hash.
- `safeNext` against the same rejected list.
- The callback route end to end: the `Location` header must stay on the site host for every bypass string, expired links go to sign-in, and missing `next` goes to the locale dashboard.
