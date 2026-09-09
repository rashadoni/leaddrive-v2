# Authentication Analysis Report

**Target:** https://v2.leaddrivecrm.org
**Date:** 2026-03-27
**Analyst:** Authentication Analysis Specialist
**Input:** `deliverables/recon_deliverable.md` + Direct source code review + Live application probing

---

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** Eight exploitable authentication vulnerabilities were identified, spanning rate-limiting bypasses, a full 2FA enforcement bypass, a cross-tenant org-context forgery vector, and critical portal session management weaknesses. The application's authentication model is undermined by a systematic pattern of trusting attacker-controlled inputs (headers, session update payloads) without sufficient server-side re-validation.
- **Purpose of this Document:** This report provides the strategic context on the application's authentication mechanisms, dominant flaw patterns, and key architectural details necessary to effectively exploit the vulnerabilities listed in the exploitation queue.

### Vulnerability Summary Table

| ID | Title | Type | Confidence | Externally Exploitable |
|---|---|---|---|---|
| AUTH-VULN-01 | Rate-Limit Bypass via x-forwarded-for Spoofing | Abuse_Defenses_Missing | High | ✅ |
| AUTH-VULN-02 | No Rate Limiting on verify-2fa / Backup Code Brute-Force | Abuse_Defenses_Missing | High | ✅ |
| AUTH-VULN-03 | No Rate Limiting on Portal Login | Abuse_Defenses_Missing | High | ✅ |
| AUTH-VULN-04 | 2FA/needsSetup2fa Enforcement Bypass via NextAuth Session Update | Login_Flow_Logic | High | ✅ |
| AUTH-VULN-05 | x-organization-id Header Forgery (Cross-Tenant Auth Context) | Session_Management_Flaw | High | ✅ |
| AUTH-VULN-06 | Weak/Hardcoded portal-token JWT Secret Fallback | Token_Management_Issue | Medium | ✅ |
| AUTH-VULN-07 | portal-token Cookie Missing `secure` Flag + No HSTS | Transport_Exposure | Medium | ✅ |
| AUTH-VULN-08 | Calendar Token Never Expires / No Revocation | Token_Management_Issue | High | ✅ |
| AUTH-VULN-09 | User Enumeration in Portal Authentication Endpoints | Login_Flow_Logic | High | ✅ |
| AUTH-VULN-10 | Unauthenticated `POST /api/v1/journeys/process` Endpoint | Authentication_Bypass | High | ✅ |

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Attacker-Controlled Inputs Trusted Without Server-Side Validation

- **Description:** The most pervasive pattern found is the application trusting attacker-controlled values — HTTP headers and client-driven session update payloads — without sufficient server-side re-validation. Two distinct manifestations exist: (a) the rate-limiter uses `x-forwarded-for` to identify IPs, allowing any attacker to rotate this header to bypass rate limits; (b) the NextAuth JWT callback unconditionally honors client-sent `{needs2fa: false, needsSetup2fa: false}` session update payloads, allowing an authenticated user to clear the 2FA enforcement gate without ever verifying a TOTP code.
- **Implication:** The rate-limit bypass enables unlimited brute-force / credential-stuffing on the login endpoint. The session update bypass allows any attacker who obtains account credentials — but lacks the TOTP secret — to bypass the mandatory 2FA setup enforcement.
- **Representative Findings:** `AUTH-VULN-01`, `AUTH-VULN-04`.

### Pattern 2: Missing Rate Limiting on Critical Unauthenticated Endpoints

- **Description:** While the middleware applies a 10-requests-per-minute rate limit to `/api/auth` (NextAuth login), several other critical unauthenticated authentication endpoints are entirely unprotected: `POST /api/v1/auth/verify-2fa`, `POST /api/v1/auth/reset-password`, and `POST /api/v1/public/portal-auth`. This last endpoint is entirely public (explicit `NextResponse.next()` shortcut in middleware) and has zero rate control.
- **Implication:** Backup TOTP codes (8 hex chars = 4 bytes ≈ 4 billion values with only 8 codes per account) can be brute-forced. Portal customer accounts can be password-sprayed with no throttling.
- **Representative Findings:** `AUTH-VULN-02`, `AUTH-VULN-03`.

### Pattern 3: Cross-Tenant Session Context Forgery

- **Description:** The Next.js middleware constructs modified headers via `new Headers(req.headers)` and calls `NextResponse.next({ headers })`. Due to the missing `request:` wrapper in the Next.js API (`NextResponse.next({ request: { headers } })` is the correct form for forwarding modified headers to the route handler), the API routes still receive the **original, unmodified** request headers. `getOrgId()` in `src/lib/api-auth.ts` reads `req.headers.get("x-organization-id")` as its fast-path and returns it immediately without cross-referencing the JWT. Any authenticated user can supply a forged `x-organization-id` header to hijack the org context for every API call.
- **Implication:** Any authenticated user can access, modify, and delete data belonging to any other tenant simply by supplying a different organization ID in the request header. This is a multi-tenant isolation collapse.
- **Representative Finding:** `AUTH-VULN-05`.

### Pattern 4: Weak/Absent Token Lifecycle Management (Portal & Calendar)

- **Description:** Two token-based authentication systems (portal JWT and calendar feed tokens) have critical lifecycle weaknesses. The portal-token signing key is now required from `NEXTAUTH_SECRET`; the historical fallback value is intentionally redacted. Calendar feed tokens are never-expiring static strings with no revocation mechanism; a once-leaked token grants permanent read access.
- **Implication:** Forged portal tokens allow impersonation of any portal customer. Permanent calendar tokens create a long-tail exposure window for any credential leak.
- **Representative Findings:** `AUTH-VULN-06`, `AUTH-VULN-08`.

---

## 3. Strategic Intelligence for Exploitation

### Authentication Methods

| Layer | Method | Cookie / Token | Expiry | Notes |
|---|---|---|---|---|
| CRM Dashboard | NextAuth JWT (A256CBC-HS512 JWE) | `__Secure-authjs.session-token` | Default NextAuth (30 days) | HttpOnly, Secure, SameSite=Lax confirmed live |
| CSRF Protection | NextAuth CSRF token | `__Host-authjs.csrf-token` | Session | HttpOnly, Secure, SameSite=Lax |
| Customer Portal | Custom HS256 JWT | `portal-token` | 7 days | **Missing `secure` flag** (code-confirmed); signing key is configured by `NEXTAUTH_SECRET` |
| Calendar Feed | Static URL token | URL path `[token]` | **Never** | `crypto.randomBytes(32).toString("base64url")` — high entropy but no TTL |

### Session Token Details

- **Main session** (`__Secure-authjs.session-token`): Encrypted JWE containing `{ role, organizationId, plan, needs2fa, needsSetup2fa }`. JWT strategy — no server-side session invalidation on logout. Proper `Secure`, `HttpOnly`, `SameSite=Lax` flags observed live.
- **Portal token** (`portal-token`): Plain HS256 JWT containing `{ contactId, organizationId, companyId, fullName, email }`. Signed with the configured `NEXTAUTH_SECRET`. Cookie lacks `secure` flag. No server-side revocation on `DELETE /api/v1/public/portal-auth`.
- **Calendar token**: Static `base64url` string stored in `User.calendarToken` column. Referenced only at `GET /api/v1/calendar/feed/[token]`. Never expires or rotates.

### Password Policy

- **Min length**: 8 chars (registration and password-reset), 6 chars (login schema — inconsistency, but not directly exploitable).
- **Complexity**: No uppercase, digit, or symbol requirements enforced server-side.
- **Common password check**: None found.
- **Hashing**: `bcrypt` with cost factor 12 (strong).

### 2FA Architecture

- **TOTP**: `otplib` library with standard RFC 6238. Backup codes: 8 codes per account, each 4 bytes (8 hex chars).
- **Enrollment gate**: `needs2fa: user.totpEnabled === true` is embedded in the JWT at login time. This creates a redundant second TOTP verification via the verify-2fa page.
- **Setup enforcement**: `needsSetup2fa: user.require2fa === true && user.totpEnabled === false` — enforced by middleware redirect to `/login/setup-2fa`.
- **CRITICAL BYPASS**: Both flags can be cleared by POSTing `{"needs2fa": false, "needsSetup2fa": false}` to `POST /api/auth/session` with a valid session cookie. The JWT callback honors these updates unconditionally. (`src/lib/auth.ts` lines 113–117)

### Rate Limiting Architecture

- **Scope**: Applied only to POST requests matching `/api/auth`, `/login`, `/register`, `/forgot-password` (UI path, not API path).
- **Config**: `RATE_LIMIT_CONFIG.public = { maxRequests: 10, windowMs: 60000 }` — 10 requests/minute.
- **Implementation**: In-memory `Map` (per-process, not distributed). Key: `auth:{x-forwarded-for}`. **Attacker-controlled key — trivially bypassable by rotating the header.**
- **Unprotected endpoints**: `/api/v1/auth/verify-2fa`, `/api/v1/auth/reset-password`, `/api/v1/public/portal-auth`, `/api/v1/public/portal-auth/register`, `/api/v1/public/portal-auth/set-password`.

### Transport Security (Live Observations)

- HTTPS enforced via nginx 301 redirect from HTTP.
- **No `Strict-Transport-Security` header** observed on any response.
- `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` present on authenticated pages ✓.
- Main session cookies use `__Secure-` and `__Host-` prefixes with proper `Secure` flags ✓.
- `portal-token` cookie: no `secure` flag (code-confirmed, not overridden by framework prefix).

---

## 4. Detailed Vulnerability Analysis

### AUTH-VULN-01: Rate-Limit Bypass via x-forwarded-for Spoofing

**Endpoint:** `POST /api/auth/callback/credentials` (NextAuth login)
**File:** `src/middleware.ts` lines 16–24
**Methodology Check:** §2 Rate limiting / CAPTCHA

The middleware applies a 10 req/min rate limit to login. However, the rate limit key is derived exclusively from the attacker-controlled `x-forwarded-for` header:

```typescript
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
const key = `auth:${ip}`
```

An attacker can cycle through arbitrary IP values in the `X-Forwarded-For` header (`X-Forwarded-For: 1.2.3.4`, `1.2.3.5`, etc.) to bypass the limit entirely. No nginx-level IP extraction or `x-real-ip` validation was observed. Additionally, the rate limiter uses an in-memory `Map`, which would not persist across process restarts or scale across multiple server instances.

**Missing Defense:** Rate-limit key must be derived from the verified network-layer source IP (e.g., `REMOTE_ADDR`/`socket.remoteAddress`), not from a spoofable application-layer header.

---

### AUTH-VULN-02: No Rate Limiting on verify-2fa / Backup Code Brute-Force

**Endpoint:** `POST /api/v1/auth/verify-2fa`
**File:** `src/app/api/v1/auth/verify-2fa/route.ts` (no rate-limiting imports or calls)
**Methodology Check:** §2 Rate limiting / CAPTCHA

The verify-2fa endpoint is neither listed in `RATE_LIMITED_PATHS` nor contains any in-route rate limiting. TOTP backup codes are 4-byte hex values (8 characters). With 8 backup codes per account and no throttle, an attacker with a stolen session (needs2fa=true) can systematically attempt all backup codes. The code path at lines 37–51 accepts 8-character hex codes case-insensitively.

Similarly, `POST /api/v1/auth/reset-password` at `src/app/api/v1/auth/reset-password/route.ts` has no rate limiting. The reset token is 64 hex characters (32 bytes), making brute-force of the token itself impractical, but token verification attempts are unlimited, and error messages differ for valid vs. expired tokens.

**Missing Defense:** Per-user or per-IP rate limiting with exponential backoff on the verify-2fa and reset-password endpoints.

---

### AUTH-VULN-03: No Rate Limiting on Portal Login

**Endpoint:** `POST /api/v1/public/portal-auth`
**File:** `src/app/api/v1/public/portal-auth/route.ts`
**Methodology Check:** §2 Rate limiting / CAPTCHA

The portal login endpoint falls under the `/api/v1/public/` prefix, which receives a blanket `NextResponse.next()` exemption from ALL middleware checks (line 43 of `src/middleware.ts`), bypassing even the weak rate limiter that applies to `/api/auth`. The endpoint accepts email + password and returns distinguishable error responses (404 for unknown emails, 403 for disabled access, 401 for wrong password), enabling both user enumeration and unlimited brute-force.

**Missing Defense:** Per-IP and per-account rate limiting and account lockout on the portal login endpoint; uniform error responses.

---

### AUTH-VULN-04: 2FA/needsSetup2fa Enforcement Bypass via NextAuth Session Update

**Endpoint:** `POST /api/auth/session` (NextAuth session update API)
**File:** `src/lib/auth.ts` lines 113–117
**Methodology Check:** §5 Session fixation / §8 Recovery & logout

The JWT callback unconditionally honors client-supplied session update data:

```typescript
if (trigger === "update") {
  if (session?.needs2fa === false) token.needs2fa = false
  if (session?.needsSetup2fa === false) token.needsSetup2fa = false
}
```

**Critical scenario — `needsSetup2fa` bypass:**
1. An admin sets `require2fa: true` on a target account (or the user hasn't yet set up TOTP).
2. Attacker obtains the account credentials (via brute-force, phishing, credential stuffing).
3. Attacker logs in → session created with `needsSetup2fa: true`, `needs2fa: false` (no TOTP to check).
4. Middleware would redirect to `/login/setup-2fa`.
5. Attacker POSTs directly to `POST /api/auth/session` with body `{"needsSetup2fa": false}` while including the session cookie.
6. JWT callback evaluates `session?.needsSetup2fa === false` → TRUE → clears the flag.
7. Attacker receives a new session token with `needsSetup2fa: false`.
8. Full access granted, mandatory 2FA setup bypassed.

**`needs2fa` scenario** (lower practical impact but still a policy bypass): A user with TOTP enabled is forced through the verify-2fa page after login. The `update({needs2fa: false})` call that the page makes after TOTP verification can be issued directly by an attacker without ever calling `/api/v1/auth/verify-2fa`, bypassing the secondary TOTP check enforced by the middleware.

**Missing Defense:** Server-side tracking of TOTP verification state (e.g., database flag set only by the verify-2fa route after successful TOTP validation); JWT callback must not honor arbitrary client-provided `needs2fa`/`needsSetup2fa` resets.

---

### AUTH-VULN-05: x-organization-id Header Forgery (Cross-Tenant Auth Context Bypass)

**Endpoints:** All `auth:orgscoped` API endpoints (≈50 routes)
**Files:** `src/middleware.ts` line 112; `src/lib/api-auth.ts` lines 19–27, 39–43
**Methodology Check:** §3 Session management

The middleware intends to inject `x-organization-id` from the authenticated session into downstream headers. However, it uses `NextResponse.next({ headers })` instead of the correct `NextResponse.next({ request: { headers } })`:

```typescript
// src/middleware.ts line 112 — INCORRECT: only sets response headers
return NextResponse.next({ headers })
// CORRECT form would be:
// return NextResponse.next({ request: { headers } })
```

In Next.js 16.x, `NextResponse.next({ headers })` modifies the **response** headers sent to the browser, NOT the **request** headers visible to route handlers. API route handlers receive the original, unmodified `req.headers`, which may contain any attacker-supplied value.

`getOrgId()` in `src/lib/api-auth.ts` treats the header as a trusted fast-path:

```typescript
export async function getOrgId(req: NextRequest): Promise<string | null> {
  const fromHeader = req.headers.get("x-organization-id")
  if (fromHeader) return fromHeader  // Returns immediately, no JWT cross-check
  // ...
}
```

`getSession()` similarly uses `fromHeader || session.user.organizationId` — the header wins over the JWT-derived value.

**Attack scenario:** An authenticated attacker with Org A credentials sends `x-organization-id: <org-b-uuid>` on any API request. All data reads and writes execute against Org B's data, while the permission check uses the attacker's own role (from their valid JWT), effectively collapsing multi-tenant isolation for any organization whose UUID can be enumerated or guessed.

**Missing Defense:** Strip and ignore any incoming `x-organization-id` headers from external clients; inject org context exclusively from the server-side JWT using `NextResponse.next({ request: { headers } })`.

---

### AUTH-VULN-06: Weak/Hardcoded portal-token JWT Secret Fallback

**Endpoint:** `POST /api/v1/public/portal-auth`, `POST /api/v1/public/portal-auth/set-password`
**File:** `src/lib/portal-auth.ts` line 12
**Methodology Check:** §4 Token/session properties

```typescript
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET)
```

The application now requires `NEXTAUTH_SECRET` for portal-token signing. Historical fallback and development-secret values are redacted from this report; production configuration must be checked and rotated if a default was ever used.

**Missing Defense:** Require a separately configured, cryptographically random `PORTAL_TOKEN_SECRET`; validate at startup that it is set and not equal to known default values.

---

### AUTH-VULN-07: portal-token Cookie Missing `secure` Flag + No HSTS

**Endpoint:** `POST /api/v1/public/portal-auth`
**File:** `src/app/api/v1/public/portal-auth/route.ts` line 70
**Methodology Check:** §1 Transport & caching; §3 Session management

```typescript
res.cookies.set("portal-token", token, {
  httpOnly: true,
  path: "/",
  maxAge: 86400 * 7,
  sameSite: "lax",
  // MISSING: secure: true
})
```

The `portal-token` cookie is set without the `secure` attribute. The main session cookies use the `__Secure-` cookie prefix (which the browser enforces as HTTPS-only), but `portal-token` has no such protection. Combined with the absence of `Strict-Transport-Security` headers (verified live), an attacker positioned as a MITM can perform SSL stripping, causing the victim's browser to send the HTTP request to the portal login page without the redirect interception having served the cookie securely.

**Missing Defense:** Add `secure: true` to the `portal-token` cookie; deploy HSTS with appropriate `max-age` and `includeSubDomains` via nginx or Next.js headers configuration.

---

### AUTH-VULN-08: Calendar Token Never Expires / No Revocation

**Endpoint:** `GET /api/v1/calendar/feed/[token]`
**File:** `src/app/api/v1/calendar/feed/[token]/route.ts` (no expiry check present)
**Methodology Check:** §4 Token/session properties

Calendar feed tokens are static strings stored in `User.calendarToken` in the database. The feed route performs a lookup by token value with no TTL check:

```typescript
const user = await prisma.user.findFirst({
  where: { calendarToken: token },
  // No expiry field queried
})
```

Tokens are generated with `crypto.randomBytes(32).toString("base64url")` (high entropy), but once issued, they never expire and cannot be revoked without direct database access. A token leaked via browser history, logs, a shared link, or a phishing email grants permanent, unauthenticated read access to the user's (and organization's) calendar/task data.

**Missing Defense:** Add a `calendarTokenExpiresAt` field with bounded TTL; provide a UI to rotate the token; log accesses.

---

### AUTH-VULN-09: User Enumeration in Portal Authentication Endpoints

**Endpoints:** `POST /api/v1/public/portal-auth`, `POST /api/v1/public/portal-auth/register`
**Files:** `src/app/api/v1/public/portal-auth/route.ts` lines 8–9; `src/app/api/v1/public/portal-auth/register/route.ts` lines 18–23
**Methodology Check:** §7 Login/signup responses

Live verification confirmed:
```
POST /api/v1/public/portal-auth {"email":"unknown@attacker.com","password":"x"}
→ 404 {"error":"Контакт не найден"}   ← reveals non-existence

POST /api/v1/public/portal-auth {"email":"existing@company.com","password":"wrong"}
→ 401 {"error":"Неверный пароль"}    ← reveals existence
```

The forgot-password endpoint (`POST /api/v1/auth/forgot-password`) for the main app correctly returns a generic success regardless of email existence, but the portal login path leaks contact existence. The registration endpoint additionally reveals whether portal access has been enabled for a contact.

**Missing Defense:** Return uniform 401 responses regardless of whether the email/contact exists.

---

### AUTH-VULN-10: Unauthenticated `POST /api/v1/journeys/process` Endpoint

**Endpoint:** `POST /api/v1/journeys/process`
**File:** `src/middleware.ts` line 43 (explicit whitelist exemption); journey process route handler
**Methodology Check:** §2 Rate limiting / §3 Session management

The middleware explicitly bypasses all authentication checks for this endpoint:

```typescript
if (pathname.startsWith("/api/v1/public/") || pathname.startsWith("/api/v1/calendar/feed/")
    || pathname.startsWith("/api/v1/webhooks/") || pathname === "/api/v1/journeys/process") {
  return NextResponse.next()
}
```

This endpoint triggers bulk email/SMS dispatches to contacts enrolled in journeys. Any unauthenticated attacker can invoke it to send bulk communications on behalf of any organization, consuming SMTP/SMS quota and spamming contacts.

**Missing Defense:** Remove from the public whitelist; require `auth:orgscoped` authentication on this endpoint.

---

## 5. Secure by Design: Validated Components

These components were analyzed and found to have adequate defenses. They are low-priority for further authentication testing.

| Component / Flow | File / Location | Defense Mechanism | Verdict |
|---|---|---|---|
| Password hashing | `src/app/api/v1/auth/register/route.ts` | `bcrypt.hash(password, 12)` — one-way, cost-factor 12 | SAFE |
| Password verification | `src/lib/auth.ts` authorize() | `bcrypt.compare()` — constant-time comparison | SAFE |
| Password reset token generation | `src/app/api/v1/auth/forgot-password/route.ts` | `crypto.randomBytes(32).toString("hex")` — 256-bit entropy | SAFE |
| Password reset token expiry | `src/app/api/v1/auth/forgot-password/route.ts` | 1-hour TTL (`resetTokenExp`) enforced server-side | SAFE |
| Password reset token single-use | `src/app/api/v1/auth/reset-password/route.ts` | Token nulled after use: `resetToken: null, resetTokenExp: null` | SAFE |
| Forgot-password email enumeration | `src/app/api/v1/auth/forgot-password/route.ts` | Always returns generic success; email existence not revealed | SAFE |
| Main session cookie flags | Live headers (`/login`) | `__Secure-authjs.session-token`: `HttpOnly; Secure; SameSite=Lax` confirmed | SAFE |
| CSRF token | Live headers | `__Host-authjs.csrf-token`: `HttpOnly; Secure; SameSite=Lax; Path=/` | SAFE |
| Cache-Control on auth pages | Live headers | `private, no-cache, no-store, max-age=0, must-revalidate` | SAFE |
| Backup code single-use | `src/app/api/v1/auth/verify-2fa/route.ts` lines 44–51 | Used backup code is spliced from array and saved to DB | SAFE |
| Portal verification token generation | `src/app/api/v1/public/portal-auth/register/route.ts` | `crypto.randomBytes(32).toString("hex")` — 256-bit entropy; 24h TTL | SAFE |
| Calendar token generation | `src/app/api/v1/calendar/generate-token/route.ts` | `crypto.randomBytes(32).toString("base64url")` — high entropy | SAFE (entropy only; expiry absent — see AUTH-VULN-08) |
| HTTP→HTTPS redirect | nginx (observed live) | 301 redirect from `http://` to `https://` | SAFE (HSTS absent — see AUTH-VULN-07) |
