# OAuth (Google / Microsoft) on tenant subdomains — NOT SUPPORTED

**Status: not a supported flow.** Verified against production on 2026-08-03.
This document exists so the next person does not "fix" the OAuth `callbackUrl`
the way [PR #681](https://github.com/rashadrahimov/leaddrive-v2/pull/681) fixed
sign-**out**, and expect it to work.

## Verdict

Starting a Google or Microsoft sign-in from `{tenant}.leaddrivecrm.org` cannot
succeed today. It fails **before** `callbackUrl` is ever consulted, for reasons
that have nothing to do with which URL is passed to `signIn()`. Changing the
relative `callbackUrl` at the four call sites below to an absolute tenant-origin
URL would change nothing observable.

Call sites (all correct as written — see notes at each):

| File | Line | Note |
| --- | --- | --- |
| `src/app/(auth)/login/page.tsx` | 236 | `signIn("google", …)` — the **else** branch, reached only on the app host and in dev, where a relative callback already resolves to the current origin |
| `src/app/(auth)/login/page.tsx` | 269 | `signIn("microsoft-entra-id", …)` — same |
| `src/app/(dashboard)/settings/security/page.tsx` | 685 | account linking — `signIn()` POSTs to the current origin, so this does start a flow on a tenant host, and that flow dies at the callback (blocker 2) |
| `src/app/(dashboard)/settings/security/page.tsx` | 732 | same |

(Line numbers are as of this commit; the call sites carry the same warning inline.)

## Why the sign-out fix does not generalize

`signOut()` is a same-host operation: the only thing it needs to get right is
where the browser lands afterwards, so an absolute `window.location.origin` URL
plus the widened `redirect` callback is a complete fix.

`signIn()` with an OAuth provider is a **three-party, two-host** operation: the
browser leaves for the provider and comes back to whatever `redirect_uri` the
server put in the authorization URL. The per-flow crypto state lives in cookies
that must still be readable when it comes back. Both of those are pinned to the
app host, independently of `callbackUrl`.

## Blocker 1 — `redirect_uri` is pinned to the app host

`next-auth`'s `reqWithEnvURL` (`node_modules/next-auth/lib/env.js`) rewrites the
request origin to `AUTH_URL ?? NEXTAUTH_URL` before Auth.js sees it, and
`parseProviders` derives `provider.callbackUrl` (= the OAuth `redirect_uri`)
from that origin. On prod `NEXTAUTH_URL="https://app.leaddrivecrm.org"`, so the
`redirect_uri` is the app host no matter which host the user started on.

Observed — same `redirect_uri` from both hosts:

```
POST https://app.leaddrivecrm.org/api/auth/signin/google
  → 302 …&redirect_uri=https%3A%2F%2Fapp.leaddrivecrm.org%2Fapi%2Fauth%2Fcallback%2Fgoogle&…

POST https://zeytun.leaddrivecrm.org/api/auth/signin/google
  → 302 …&redirect_uri=https%3A%2F%2Fapp.leaddrivecrm.org%2Fapi%2Fauth%2Fcallback%2Fgoogle&…
```

This is also why the provider consoles only ever need the app-host redirect URI
registered, and why registering per-tenant URIs there would accomplish nothing
on its own — the app never sends them.

## Blocker 2 — the PKCE verifier cookie is host-only

`src/lib/auth.ts` overrides **only** `cookies.sessionToken`, giving it
`domain: COOKIE_DOMAIN` (`.leaddrivecrm.org`) so the session is shared across
subdomains. Every other Auth.js cookie keeps the framework default, which sets
**no `Domain` attribute** and is therefore host-only (RFC 6265 §5.4).

Both providers here run `checks: ["pkce"]` (no `state`, no `nonce` in the
authorization URLs), so the one cookie that must survive the host switch is
`__Secure-authjs.pkce.code_verifier`. Observed on the tenant host — no `Domain`:

```
set-cookie: __Secure-authjs.pkce.code_verifier=…; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax
```

So the verifier is written on `zeytun.leaddrivecrm.org` and the callback arrives
at `app.leaddrivecrm.org`, which never receives it. Observed at the callback,
with and without the cookie (dummy `code`, `iss` supplied so the request reaches
the PKCE check):

| Probe | Server-side result |
| --- | --- |
| callback **without** verifier cookie (= flow started on a tenant host) | `InvalidCheck: pkceCodeVerifier value could not be parsed` |
| callback **with** verifier cookie (= flow started on the app host) | gets past the check, fails at Google's token endpoint on the dummy code |

Both surface to the user identically, as `302 → /login?error=Configuration` on
the **app** host — the tenant user is bounced off their own subdomain with a
generic error.

`/opt/leaddrive-v2/logs/error.log` already contains four real
`InvalidCheck: pkceCodeVerifier value could not be parsed` entries from
2026-07-21 — real users, not probes. The log does not record the originating
host, so they are consistent with this scenario but do not prove it: an expired
15-minute verifier or cleared cookies produce the same error.

Note that `__Host-authjs.csrf-token` **cannot** be widened even in principle —
the `__Host-` prefix forbids a `Domain` attribute. It does not need to be: it is
written and read on the same host during the sign-in POST.

## The login page's tenant workaround is dead code

`src/app/(auth)/login/page.tsx` already detects tenant subdomains and tries to
route around blocker 1 by sending the browser to the app host (commit
`60feab04d`, 2026-04-14, "Fix OAuth for tenant subdomains: proxy through
app.leaddrivecrm.org"):

```js
window.location.href = `${protocol}//app.${baseDomain}/api/auth/signin/google?callbackUrl=${cb}`
```

That is a **GET**, and Auth.js v5 only starts a provider flow on a **POST** with
a CSRF token (`lib/index.js`: the GET branch calls `render.signin(providerId)`,
which throws when a custom `pages.signIn` is configured). Observed on prod:

```
GET https://app.leaddrivecrm.org/api/auth/signin/google              → 302 /login?error=Configuration
GET https://app.leaddrivecrm.org/api/auth/signin/google?callbackUrl=… → 302 /login?error=Configuration
GET https://app.leaddrivecrm.org/api/auth/signin                     → 302 /login?callbackUrl=…  (normal custom-page render)
```

with `[auth][error] UnknownAction: Unsupported action` in the server log. The
`callbackUrl` query param is discarded on the way (the response sets
`__Secure-authjs.callback-url=https://app.leaddrivecrm.org`).

**Consequence:** `/api/v1/settings/auth-methods` returns
`{"google":true,"microsoft":true}` on tenant hosts too, so both buttons render on
`{tenant}.leaddrivecrm.org/login` — and every click is a guaranteed
`error=Configuration`. They are dead buttons, not a degraded flow.

## Two further blockers, should the first two ever be removed

These are untested (nothing gets far enough to exercise them) but visible in the
code, and they are the reason this is a product decision and not just plumbing:

1. **The OAuth `signIn` callback resolves the org from the email, never from the
   host** (`src/lib/auth.ts`). A user whose org ≠ the subdomain would arrive with
   a valid session and immediately be kicked by the cross-tenant guard in
   `src/proxy.ts` (`[cross-tenant-block]`, shared session cookie cleared,
   `?error=cross-tenant`). Tenant-subdomain OAuth is only meaningful if the
   subdomain participates in resolving the org.
2. **An unknown email auto-provisions a brand-new organization** — same callback
   creates `{name}'s Organization` with the user as `admin`. Exposed on a tenant
   login page, that is self-serve org creation for anyone with a Google account.
   Today it is masked by the dead button; it would become reachable the moment
   the flow works. No such org exists on prod (all six slugs are hand-made).

## Usage on prod (2026-08-03)

Nothing depends on this flow:

- `accounts` holds **2** rows, both `provider = google`, both belonging to the
  same user — the owner, `rashadrahimov@gmail.com`, role `superadmin`, org
  `leaddrive` (the vendor's own org, not a tenant). Created 2026-03-19.
- **Zero** `microsoft-entra-id` rows, ever. Microsoft SSO has never been used by
  anyone, on any host.
- Zero OAuth accounts in any tenant org (`afigroup`, `atsfood`,
  `brandprotection`, `mars`, `zeytun`).

Separately and unverified: the Microsoft provider is configured with
`client: { token_endpoint_auth_method: "none" }` while `MICROSOFT_CLIENT_SECRET`
is set. If the Entra app registration is a confidential client, the token
exchange would be rejected (`AADSTS7000218`). Given zero accounts ever, Microsoft
SSO may not work on the app host either. Nobody has tried; do not assume it works.

## If this is ever to be supported

Sketch only — **not implemented, not verified.** The cheap-looking fix (adding
`domain: .leaddrivecrm.org` to the PKCE cookie) makes a per-flow crypto secret
readable by every subdomain and is not recommended. The shape that avoids
widening cookie scope:

1. On a tenant subdomain, navigate the browser to a **page** on the app host
   (top-level GET, e.g. `https://app.leaddrivecrm.org/login?returnTo=…`) instead
   of to `/api/auth/signin/{provider}`.
2. From that page — now first-party on the app host — call the ordinary
   same-origin `signIn(provider, { callbackUrl: "https://{tenant}.leaddrivecrm.org/" })`.
   Cookies, `redirect_uri` and the callback all stay on one host; the widened
   `redirect` callback from #681 already permits the cross-subdomain landing.
3. Only then do the org-resolution and auto-provisioning questions above become
   answerable, and they are product decisions.

Any such change must be verified with a **real** Google and Microsoft sign-in
against a tenant subdomain before merging. The failure modes here are invisible
to unit tests and to reasoning about the code.

## Reproducing the checks

```bash
# blocker 1 — redirect_uri is the app host from either origin
for HOST in app.leaddrivecrm.org zeytun.leaddrivecrm.org; do
  CSRF=$(curl -s -c "/tmp/jar_$HOST" "https://$HOST/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]*)".*/\1/')
  curl -s -o /dev/null -D - -b "/tmp/jar_$HOST" -c "/tmp/jar_$HOST" \
    -X POST "https://$HOST/api/auth/signin/google" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "callbackUrl=https://$HOST/" \
    | grep -iE '^(location|set-cookie)'
done

# dead workaround — GET never starts a flow
curl -s -o /dev/null -D - "https://app.leaddrivecrm.org/api/auth/signin/google" | grep -i '^location'
```
