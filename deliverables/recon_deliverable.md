# Reconnaissance Deliverable: LeadDrive v2 CRM

## 0) HOW TO READ THIS

This reconnaissance report provides a comprehensive map of the application's attack surface, with special emphasis on authorization and privilege escalation opportunities for the Authorization Analysis Specialist.

**Key Sections for Authorization Analysis:**
- **Section 4 (API Endpoint Inventory):** Contains authorization details for each endpoint — focus on "Required Role" and "Object ID Parameters" columns to identify IDOR candidates.
- **Section 6.4 (Guards Directory):** Catalog of authorization controls — understand what each guard means before analyzing vulnerabilities.
- **Section 7 (Role & Privilege Architecture):** Complete role hierarchy and privilege mapping — use this to understand the privilege lattice and identify escalation targets.
- **Section 8 (Authorization Vulnerability Candidates):** Pre-prioritized lists of endpoints for horizontal, vertical, and context-based authorization testing.

**How to Use the Network Mapping (Section 6):** The entity/flow mapping shows system boundaries and data sensitivity levels. Pay special attention to flows marked with authorization guards and entities handling PII/sensitive data.

**Priority Order for Testing:** Start with Section 8's High-priority horizontal candidates, then vertical escalation endpoints for each role level, finally context-based workflow bypasses.

---

## 1. Executive Summary

LeadDrive v2 is a multi-tenant CRM platform serving Azerbaijani businesses. Written in **Next.js 16.1.7 (App Router) + React 19** with a **Python FastAPI sidecar** for analytics computation, it offers modules for lead management, invoicing, budgeting, knowledge base, customer portal, WhatsApp/Telegram/Facebook communication, and AI-powered features via Anthropic Claude integration.

The application is deployed on a single Hetzner VDS (`[REDACTED]`) behind Nginx (HTTP only — no TLS at proxy level) and fronted by Cloudflare. The attack surface is extensive: **150+ authenticated API endpoints**, **~20 unauthenticated API endpoints**, and a **publicly-accessible Python FastAPI service on port 8000** with zero authentication.

**Core Technology Stack:**
- **Frontend:** Next.js 16.1.7 (App Router), React 19.2.3, TypeScript, shadcn/ui, Tailwind CSS
- **Backend:** Node.js 20 Alpine, NextAuth v5 beta (JWT), Prisma 6.x ORM
- **Database:** PostgreSQL 16 (via Prisma), Redis 7 (referenced but in-memory rate limiter used)
- **Compute Sidecar:** Python 3.12 + FastAPI + uvicorn (`--reload` in production)
- **Auth:** NextAuth v5.0.0-beta.30 (credentials-only, no OAuth/OIDC), TOTP 2FA via otplib
- **AI:** Anthropic Claude SDK (claude-haiku-4-5 / claude-sonnet-4)
- **i18n:** next-intl, three locales (az, ru, en)

**Critical intelligence for downstream analysts:**
1. `NEXTAUTH_SECRET` was using a weak default value — JWT forgery enables full impersonation of any user (FIXED: strong secret now set on production)
2. Cross-tenant bypass via `x-organization-id` header on endpoints using `getOrgId()` — any authenticated user can access another org's data
3. FastAPI compute sidecar exposed on `0.0.0.0:8000` with zero authentication
4. Real client PII/financial data (IBANs, SWIFT codes, tax IDs) accessible unauthenticated at `/data/company_details.json`
5. Default admin credentials are set via ADMIN_PASSWORD env var (previously hardcoded — FIXED)

---

## 2. Technology & Service Map

- **Frontend:** Next.js 16.1.7 App Router, React 19.2.3, shadcn/ui, Tailwind CSS, next-intl (i18n: az/ru/en), Recharts, exceljs
- **Backend:** Node.js 20 Alpine, NextAuth v5.0.0-beta.30 (credentials provider), Prisma 6.x ORM, bcryptjs (cost 12), jose (HS256 portal JWT), otplib (TOTP), nodemailer, isomorphic-dompurify, zod
- **AI:** @anthropic-ai/sdk (Claude haiku/sonnet models)
- **Infrastructure:** Hetzner VDS `[REDACTED]`, Nginx HTTP proxy (no TLS), Docker + docker-compose, Next.js container + Python FastAPI container + PostgreSQL container + Redis container; Cloudflare CDN fronting the domain
- **Identified Subdomains:**
  - `v2.leaddrivecrm.org` — primary target (this engagement)
  - `app.leaddrivecrm.org` — referenced in landing page as "production dashboard" (separate V1 instance, out of scope)
- **Open Ports & Services:**
  - `:80` — Nginx HTTP reverse proxy (proxies to Next.js :3001/3000)
  - `:443` — HTTPS via Cloudflare CDN
  - `:8000` — Python FastAPI compute sidecar (**exposed on `0.0.0.0:8000`** — unauthenticated, potentially reachable externally depending on firewall)
  - `:5432` — PostgreSQL (exposed on host port 5432 via docker-compose)
  - `:6379` — Redis (no password, exposed on host port 6379 via docker-compose)

---

## 3. Authentication & Session Management Flow

- **Entry Points:**
  - `/login` — Main app credentials form
  - `/register` — Org + admin user creation
  - `/forgot-password` — Email-based password reset
  - `/login/verify-2fa` — TOTP verification (post-login)
  - `/login/setup-2fa` — Forced 2FA enrollment
  - `/portal/login` — Customer portal login
  - `/portal/register` — Portal self-registration

- **Mechanism (Step-by-Step):**
  1. User submits `{email, password, totpCode?}` to `POST /api/auth/[...nextauth]`
  2. `src/lib/auth.ts` credentials provider: bcrypt.compare (cost 12), TOTP/backup-code verification if `user.totpEnabled`
  3. If TOTP enabled and no code: throws `"2FA_REQUIRED"` error; frontend redirects to `/login/verify-2fa`
  4. On success: NextAuth issues JWT signed with `NEXTAUTH_SECRET` (HS256), stored as `authjs.session-token` httpOnly cookie (sameSite=lax)
  5. JWT payload: `{sub, email, name, role, organizationId, organizationName, plan, needs2fa, needsSetup2fa}`
  6. Middleware (`src/middleware.ts`) validates JWT on every request, enforces 2FA completion via redirect, injects `x-organization-id`/`x-user-id`/`x-user-role` headers from JWT
  7. API routes use `getOrgId()` or `requireAuth()` from `src/lib/api-auth.ts`

- **Code Pointers:**
  - `src/lib/auth.ts` — NextAuth config, JWT callback, credentials provider
  - `src/middleware.ts` — Middleware enforcement, 2FA redirect, header injection
  - `src/lib/api-auth.ts` — `getOrgId()`, `requireAuth()`, `getSession()`
  - `src/app/api/auth/[...nextauth]/route.ts` — NextAuth handler

### 3.1 Role Assignment Process

- **Role Determination:** First user of a new org gets `"admin"` (hardcoded in registration). Subsequent users are assigned a role by org admin via `PUT /api/v1/users/[id]`.
- **Default Role:** `"admin"` for org registrants. No other role selectable at registration.
- **Role Upgrade Path:** Admin-only via `PUT /api/v1/users/[id]` (requires `requireAuth(req, "settings", "write")`). No self-service. No external IdP.
- **Code Implementation:** `src/app/api/v1/auth/register/route.ts` line 68; `src/app/api/v1/users/[id]/route.ts` lines 41-101

### 3.2 Privilege Storage & Validation

- **Storage Location:** JWT claims (stateless). Role persisted in `User.role` in PostgreSQL. JWT refreshed by NextAuth JWT callback.
- **Validation Points:**
  - Middleware: role check for `/settings/*` pages (not API — redirect only)
  - `requireAuth(req, module, action)`: calls `checkPermission(role, module, action)` against static RBAC matrix
  - **GAP:** Many routes use only `getOrgId()` (org-isolation only, NO RBAC check) — settings, pipeline stages, cost model, budgeting, and other endpoints
  - Pipeline stages POST reads `x-user-role` header (not JWT session) — bypassable if middleware is circumvented
- **Cache/Session Persistence:** Stateless JWT. Plan defaults to `"enterprise"` if JWT `plan` claim is missing (`src/middleware.ts` line 105).
- **Code Pointers:** `src/lib/permissions.ts` (RBAC matrix), `src/lib/api-auth.ts` (enforcement functions), `src/lib/plan-config.ts` (plan gating)

### 3.3 Role Switching & Impersonation

- **Impersonation Features:** None implemented.
- **Role Switching:** No sudo mode or temporary elevation.
- **Audit Trail:** `AuditLog` table records actions per org. Portal audit entries silently fail (schema mismatch). No dedicated role-change audit.
- **Code Implementation:** N/A.

---

## 4. API Endpoint Inventory

**Network Surface Focus:** Only network-accessible endpoints are listed below.

| Method | Endpoint Path | Required Role | Object ID Parameters | Authorization Mechanism | Description & Code Pointer |
|--------|--------------|---------------|---------------------|------------------------|---------------------------|
| POST | `/api/auth/[...nextauth]` | anon | None | None | NextAuth sign-in (credentials). `src/app/api/auth/[...nextauth]/route.ts` |
| GET | `/api/auth/[...nextauth]` | anon | None | None | NextAuth session/CSRF/providers. Same file. |
| POST | `/api/v1/auth/register` | anon | None | None | Register org + admin user. `src/app/api/v1/auth/register/route.ts` |
| POST | `/api/v1/auth/forgot-password` | anon | None | None | Request password reset email. `src/app/api/v1/auth/forgot-password/route.ts` |
| POST | `/api/v1/auth/reset-password` | anon | None | None | Consume reset token, set new password. `src/app/api/v1/auth/reset-password/route.ts` |
| GET/POST | `/api/v1/auth/2fa` | user | None | Session (auth()) | 2FA status/setup/verify/disable. `src/app/api/v1/auth/2fa/route.ts` |
| POST | `/api/v1/auth/verify-2fa` | user (partial) | None | Session (auth()) | Verify TOTP post-login. `src/app/api/v1/auth/verify-2fa/route.ts` |
| POST | `/api/v1/auth/totp/setup` | user | None | Session | Generate TOTP QR + secret. `src/app/api/v1/auth/totp/setup/route.ts` |
| POST | `/api/v1/auth/totp/verify` | user | None | Session | Activate TOTP + backup codes. `src/app/api/v1/auth/totp/verify/route.ts` |
| POST | `/api/v1/auth/totp/disable` | user | None | Session + password | Disable TOTP. `src/app/api/v1/auth/totp/disable/route.ts` |
| GET | `/api/v1/auth/totp/status` | user | None | Session | TOTP enrollment status. `src/app/api/v1/auth/totp/status/route.ts` |
| POST | `/api/v1/public/leads` | anon | None | None (CORS: *) | Web-to-lead form. `src/app/api/v1/public/leads/route.ts` |
| POST | `/api/v1/public/portal-auth` | anon | None | None | Portal login. `src/app/api/v1/public/portal-auth/route.ts` |
| DELETE | `/api/v1/public/portal-auth` | anon | None | None | Portal logout. Same file. |
| POST | `/api/v1/public/portal-auth/register` | anon | None | None | Portal self-registration. `src/app/api/v1/public/portal-auth/register/route.ts` |
| GET/POST | `/api/v1/public/portal-auth/set-password` | anon | None | Invite token | Portal password setup. `src/app/api/v1/public/portal-auth/set-password/route.ts` |
| GET/POST | `/api/v1/public/portal-tickets` | portal_user | contactId | portal-token cookie | Portal ticket CRUD. `src/app/api/v1/public/portal-tickets/route.ts` |
| GET/PUT/DELETE/POST | `/api/v1/public/portal-tickets/[id]` | portal_user | ticket_id | portal-token cookie | Individual ticket operations. `src/app/api/v1/public/portal-tickets/[id]/route.ts` |
| GET/POST | `/api/v1/public/portal-chat` | portal_user | None | portal-token cookie | AI chat for portal. `src/app/api/v1/public/portal-chat/route.ts` |
| GET | `/api/v1/public/portal-kb` | portal_user | None | portal-token cookie | Knowledge base. `src/app/api/v1/public/portal-kb/route.ts` |
| GET/POST | `/api/v1/public/events/[id]/register` | anon | event_id | None | Event self-registration. `src/app/api/v1/public/events/[id]/register/route.ts` |
| GET | `/api/v1/calendar/feed/[token]` | anon | calendar_token | Token in URL | iCal feed (org-wide scope). `src/app/api/v1/calendar/feed/[token]/route.ts` |
| POST | `/api/v1/journeys/process` | service | None | Bearer CRON_SECRET | Journey cron processor. `src/app/api/v1/journeys/process/route.ts` |
| POST | `/api/v1/webhooks/whatsapp` | anon | None | No HMAC sig verification | WhatsApp message webhook. `src/app/api/v1/webhooks/whatsapp/route.ts` |
| GET | `/api/v1/webhooks/whatsapp` | anon | None | Token query param | WhatsApp webhook verification. Same file. |
| POST | `/api/v1/webhooks/facebook` | anon | None | No HMAC sig verification | Facebook message webhook. `src/app/api/v1/webhooks/facebook/route.ts` |
| GET | `/api/v1/webhooks/facebook` | anon | None | Token query param | Facebook webhook verification. Same file. |
| POST | `/api/v1/webhooks/telegram` | anon | None | Token in URL query | Telegram webhook. `src/app/api/v1/webhooks/telegram/route.ts` |
| POST | `/api/v1/webhooks/vkontakte` | anon | None | group_id match | VK webhook. `src/app/api/v1/webhooks/vkontakte/route.ts` |
| GET | `/api/v1/users` | user | None | getOrgId() only — **NO RBAC** | List org users. `src/app/api/v1/users/route.ts` |
| GET | `/api/v1/users/[id]` | user | user_id | getOrgId() only — **NO RBAC** | Get user details. `src/app/api/v1/users/[id]/route.ts` lines 19-39 |
| PUT | `/api/v1/users/[id]` | manager+ | user_id | requireAuth("settings","write") | Update user (role, 2FA, password). `src/app/api/v1/users/[id]/route.ts` lines 41-101 |
| DELETE | `/api/v1/users/[id]` | admin | user_id | requireAuth("settings","delete") | Delete user. `src/app/api/v1/users/[id]/route.ts` lines 103-120 |
| GET | `/api/v1/contacts` | user | None | getOrgId() | List contacts. `src/app/api/v1/contacts/route.ts` |
| POST | `/api/v1/contacts` | user | None | getOrgId() | Create contact. Same file. |
| GET | `/api/v1/contacts/[id]` | user | contact_id | getOrgId() | Get contact + activities. `src/app/api/v1/contacts/[id]/route.ts` |
| PUT | `/api/v1/contacts/[id]` | user | contact_id | getOrgId() | Update contact. Same file. |
| DELETE | `/api/v1/contacts/[id]` | user | contact_id | getOrgId() | Delete contact. Same file. |
| POST | `/api/v1/contacts/bulk-delete` | user | contact_ids[] | getOrgId() | Bulk delete contacts. `src/app/api/v1/contacts/bulk-delete/route.ts` |
| GET | `/api/v1/contacts/[id]/engagement` | user | contact_id | getOrgId() | Contact engagement metrics. |
| GET | `/api/v1/companies` | user | None | getOrgId() | List companies. `src/app/api/v1/companies/route.ts` |
| POST | `/api/v1/companies` | user | None | getOrgId() | Create company. Same file. |
| GET | `/api/v1/companies/[id]` | user | company_id | getOrgId() | Get company + relations. `src/app/api/v1/companies/[id]/route.ts` |
| PUT | `/api/v1/companies/[id]` | user | company_id | getOrgId() | Update company. Same file. |
| DELETE | `/api/v1/companies/[id]` | user | company_id | getOrgId() | Delete company. Same file. |
| GET | `/api/v1/companies/[id]/timeline` | user | company_id | getOrgId() | Company timeline. |
| GET | `/api/v1/deals` | user | None | getOrgId() | List deals. `src/app/api/v1/deals/route.ts` |
| POST | `/api/v1/deals` | user | None | getOrgId() | Create deal. Same file. |
| GET | `/api/v1/deals/[id]` | user | deal_id | getOrgId() | Get deal. `src/app/api/v1/deals/[id]/route.ts` |
| PUT | `/api/v1/deals/[id]` | user | deal_id | getOrgId() | Update deal. Same file. |
| DELETE | `/api/v1/deals/[id]` | user | deal_id | getOrgId() | Delete deal. Same file. |
| GET/POST | `/api/v1/deals/[id]/products` | user | deal_id | getOrgId() | Deal products. |
| GET/POST | `/api/v1/deals/[id]/offers` | user | deal_id | getOrgId() | Deal offers. |
| GET/POST/PUT/DELETE | `/api/v1/deals/[id]/team` | user | deal_id | getOrgId() | Deal team members. |
| GET/POST/DELETE | `/api/v1/deals/[id]/contact-roles` | user | deal_id | getOrgId() | Deal contact roles. |
| GET/POST/PUT | `/api/v1/deals/[id]/next-steps` | user | deal_id | getOrgId() | Deal next steps. |
| POST | `/api/v1/deals/[id]/add-to-pricing` | user | deal_id | getOrgId() | Add deal to pricing. |
| GET | `/api/v1/leads` | user | None | getOrgId() | List leads. `src/app/api/v1/leads/route.ts` |
| POST | `/api/v1/leads` | user | None | getOrgId() | Create lead. Same file. |
| GET | `/api/v1/leads/[id]` | user | lead_id | getOrgId() | Get lead. `src/app/api/v1/leads/[id]/route.ts` |
| PUT | `/api/v1/leads/[id]` | user | lead_id | getOrgId() | Update lead. Same file. |
| DELETE | `/api/v1/leads/[id]` | user | lead_id | getOrgId() | Delete lead. Same file. |
| POST | `/api/v1/leads/[id]/convert` | user | lead_id | getOrgId() | Convert lead to contact/deal. |
| GET | `/api/v1/invoices` | user | None | getOrgId() | List invoices. `src/app/api/v1/invoices/route.ts` |
| POST | `/api/v1/invoices` | user | None | getOrgId() | Create invoice. Same file. |
| GET | `/api/v1/invoices/[id]` | user | invoice_id | getOrgId() | Get invoice. `src/app/api/v1/invoices/[id]/route.ts` |
| PUT | `/api/v1/invoices/[id]` | user | invoice_id | getOrgId() | Update invoice. Same file. |
| DELETE | `/api/v1/invoices/[id]` | user | invoice_id | getOrgId() | Delete invoice. Same file. |
| POST | `/api/v1/invoices/[id]/send` | user | invoice_id | getOrgId() | Send invoice via email (XSS sink). `src/app/api/v1/invoices/[id]/send/route.ts` |
| GET | `/api/v1/invoices/[id]/pdf` | user | invoice_id | getOrgId() | Generate invoice PDF (XSS sink). `src/app/api/v1/invoices/[id]/pdf/route.ts` |
| GET/POST | `/api/v1/invoices/[id]/act` | user | invoice_id | getOrgId() | Completion act HTML (XSS sink). `src/app/api/v1/invoices/[id]/act/route.ts` |
| GET/POST | `/api/v1/invoices/[id]/payments` | user | invoice_id | getOrgId() | Invoice payments. |
| GET/PUT/DELETE | `/api/v1/invoices/[id]/payments/[paymentId]` | user | invoice_id, payment_id | getOrgId() | Individual payment. |
| POST | `/api/v1/invoices/[id]/duplicate` | user | invoice_id | getOrgId() | Duplicate invoice. |
| GET | `/api/v1/invoices/[id]/chain` | user | invoice_id | getOrgId() | Invoice chain/history. |
| POST | `/api/v1/invoices/from-offer` | user | None | getOrgId() | Create invoice from offer. |
| GET | `/api/v1/invoices/next-number` | user | None | getOrgId() | Get next invoice number. |
| GET | `/api/v1/invoices/overdue` | user | None | getOrgId() | List overdue invoices. |
| GET | `/api/v1/invoices/stats` | user | None | getOrgId() | Invoice statistics. |
| GET | `/api/v1/contracts` | user | None | getOrgId() | List contracts. `src/app/api/v1/contracts/route.ts` |
| POST | `/api/v1/contracts` | user | None | getOrgId() | Create contract. Same file. |
| GET | `/api/v1/contracts/[id]` | user | contract_id | getOrgId() | Get contract + history. `src/app/api/v1/contracts/[id]/route.ts` |
| PUT | `/api/v1/contracts/[id]` | user | contract_id | getOrgId() | Update contract. Same file. |
| DELETE | `/api/v1/contracts/[id]` | user | contract_id | getOrgId() | Delete contract. Same file. |
| GET/POST | `/api/v1/contracts/[id]/files` | user | contract_id | getOrgId() | List/upload contract files. `src/app/api/v1/contracts/[id]/files/route.ts` |
| GET/DELETE | `/api/v1/contracts/[id]/files/[fileId]` | user | contract_id, file_id | getOrgId() | Download/delete file. Same file. |
| GET | `/api/v1/tickets` | user | None | getOrgId() | List tickets. `src/app/api/v1/tickets/route.ts` |
| POST | `/api/v1/tickets` | user | None | getOrgId() | Create ticket. Same file. |
| GET/PUT/DELETE | `/api/v1/tickets/[id]` | user | ticket_id | getOrgId() | Ticket CRUD. `src/app/api/v1/tickets/[id]/route.ts` |
| GET/POST | `/api/v1/tickets/[id]/comments` | user | ticket_id | getOrgId() | Ticket comments. |
| POST | `/api/v1/tickets/ai` | user | None | getOrgId() | AI ticket analysis. `src/app/api/v1/tickets/ai/route.ts` |
| GET | `/api/v1/offers` | user | None | getOrgId() | List offers. `src/app/api/v1/offers/route.ts` |
| POST | `/api/v1/offers` | user | None | getOrgId() | Create offer. Same file. |
| GET/PUT/DELETE | `/api/v1/offers/[id]` | user | offer_id | getOrgId() | Offer CRUD. `src/app/api/v1/offers/[id]/route.ts` |
| POST | `/api/v1/offers/[id]/send` | user | offer_id | getOrgId() | Send offer via email (XSS sink). `src/app/api/v1/offers/[id]/send/route.ts` |
| GET | `/api/v1/tasks` | user | None | getOrgId() | List tasks. `src/app/api/v1/tasks/route.ts` |
| POST | `/api/v1/tasks` | user | None | getOrgId() | Create task. Same file. |
| GET/PUT/DELETE | `/api/v1/tasks/[id]` | user | task_id | getOrgId() | Task CRUD. `src/app/api/v1/tasks/[id]/route.ts` |
| GET | `/api/v1/tasks/calendar` | user | None | getOrgId() | Calendar view of tasks. |
| GET/POST | `/api/v1/inbox` | user | None | getOrgId() | Inbox/email send (XSS in body). `src/app/api/v1/inbox/route.ts` |
| PATCH/DELETE | `/api/v1/inbox` | user | message_ids[] | getOrgId() | Bulk mark/delete messages. Same file. |
| GET/POST | `/api/v1/inbox/conversations` | user | None | getOrgId() | Conversations. |
| GET/PUT/DELETE | `/api/v1/inbox/conversations/[id]` | user | conversation_id | getOrgId() | Conversation CRUD. |
| GET/POST | `/api/v1/inbox/conversations/[id]/messages` | user | conversation_id | getOrgId() | Messages. |
| GET | `/api/v1/email-log` | user | None | getOrgId() | Email send log (contains reset URLs). `src/app/api/v1/email-log/route.ts` |
| GET/POST | `/api/v1/email-templates` | user | None | getOrgId() | Email templates (raw HTML storage). `src/app/api/v1/email-templates/route.ts` |
| GET/PUT/DELETE | `/api/v1/email-templates/[id]` | user | template_id | getOrgId() | Template CRUD. |
| GET | `/api/v1/settings/smtp` | user | None | getOrgId() only — **NO RBAC** | Get SMTP config. `src/app/api/v1/settings/smtp/route.ts` |
| PUT | `/api/v1/settings/smtp` | user | None | getOrgId() only — **NO RBAC** | Update SMTP config (SSRF vector). Same file. |
| POST | `/api/v1/settings/smtp/test` | user | None | getOrgId() | Test SMTP (SSRF, no isPrivateHost check). `src/app/api/v1/settings/smtp/test/route.ts` |
| GET | `/api/v1/settings/roles` | user | None | getOrgId() only — **NO RBAC** | List roles + permissions. `src/app/api/v1/settings/roles/route.ts` |
| POST | `/api/v1/settings/roles` | user | None | getOrgId() only — **NO RBAC** | Create custom role. Same file. |
| PUT | `/api/v1/settings/roles` | user | None | getOrgId() only — **NO RBAC** | Update roles/permissions. Same file. |
| DELETE | `/api/v1/settings/roles` | user | None | getOrgId() only — **NO RBAC** | Delete custom role. Same file. |
| GET/PUT | `/api/v1/settings/permissions` | user | None | getOrgId() only — **NO RBAC** | Permission matrix management. `src/app/api/v1/settings/permissions/route.ts` |
| GET/PUT | `/api/v1/settings/invoice` | user | None | getOrgId() | Invoice settings. |
| GET | `/api/v1/organization/plan` | user | None | getOrgId() | Org subscription plan. `src/app/api/v1/organization/plan/route.ts` |
| GET | `/api/v1/channels` | user | None | getOrgId() | List channels (tokens excluded). `src/app/api/v1/channels/route.ts` |
| POST | `/api/v1/channels` | user | None | getOrgId() | Create channel (SSRF: webhookUrl). Same file. |
| GET | `/api/v1/channels/[id]` | user | channel_id | getOrgId() | Get channel **with full bot tokens/API keys**. `src/app/api/v1/channels/[id]/route.ts` |
| PUT/DELETE | `/api/v1/channels/[id]` | user | channel_id | getOrgId() | Update/delete channel. Same file. |
| POST | `/api/v1/whatsapp/send` | user | None | getOrgId() | Send WhatsApp message. `src/app/api/v1/whatsapp/send/route.ts` |
| POST | `/api/v1/whatsapp/test` | user | None | getOrgId() | Test WhatsApp connection. |
| GET/POST | `/api/v1/campaigns` | user | None | getOrgId() | Campaign CRUD. `src/app/api/v1/campaigns/route.ts` |
| GET/PUT/DELETE | `/api/v1/campaigns/[id]` | user | campaign_id | getOrgId() | Campaign detail. |
| POST | `/api/v1/campaigns/[id]/send` | user | campaign_id | getOrgId() | Send campaign emails. |
| GET | `/api/v1/campaign-roi` | user | None | getOrgId() | Campaign ROI metrics. |
| GET/POST | `/api/v1/workflows` | user | None | getOrgId() | Workflow CRUD. `src/app/api/v1/workflows/route.ts` |
| GET/PUT/DELETE | `/api/v1/workflows/[id]` | user | workflow_id | getOrgId() | Workflow detail. |
| GET/POST | `/api/v1/journeys` | user | None | getOrgId() | Journey automation CRUD. `src/app/api/v1/journeys/route.ts` |
| GET/PUT/DELETE | `/api/v1/journeys/[id]` | user | journey_id | getOrgId() | Journey detail. |
| POST | `/api/v1/journeys/enroll` | user | None | getOrgId() | Enroll contact in journey. |
| GET/POST | `/api/v1/segments` | user | None | getOrgId() | Segment CRUD. `src/app/api/v1/segments/route.ts` |
| GET/PUT/DELETE | `/api/v1/segments/[id]` | user | segment_id | getOrgId() | Segment detail. |
| POST | `/api/v1/segments/preview` | user | None | getOrgId() | Preview segment. |
| GET/POST | `/api/v1/kb` | user | None | getOrgId() | Knowledge base articles. `src/app/api/v1/kb/route.ts` |
| GET/PUT/DELETE | `/api/v1/kb/[id]` | user | article_id | getOrgId() | KB article CRUD. |
| GET/POST | `/api/v1/products` | user | None | getOrgId() | Product catalog. `src/app/api/v1/products/route.ts` |
| GET/PUT/DELETE | `/api/v1/products/[id]` | user | product_id | getOrgId() | Product detail. |
| GET/POST | `/api/v1/events` | user | None | getOrgId() | Events. `src/app/api/v1/events/route.ts` |
| GET/PUT/DELETE | `/api/v1/events/[id]` | user | event_id | getOrgId() | Event detail. |
| GET/POST | `/api/v1/events/[id]/participants` | user | event_id | getOrgId() | Event participants. |
| GET/POST | `/api/v1/projects` | user | None | getOrgId() | Projects. `src/app/api/v1/projects/route.ts` |
| GET/PUT/DELETE | `/api/v1/projects/[id]` | user | project_id | getOrgId() | Project detail. |
| GET/POST | `/api/v1/projects/[id]/members` | user | project_id | getOrgId() | Project members. |
| GET/POST | `/api/v1/projects/[id]/tasks` | user | project_id | getOrgId() | Project tasks. |
| GET/POST | `/api/v1/ai-configs` | user | None | getOrgId() | AI configurations. `src/app/api/v1/ai-configs/route.ts` |
| GET/PUT/DELETE | `/api/v1/ai-configs/[id]` | user | config_id | getOrgId() | AI config detail. |
| GET/POST/PUT | `/api/v1/ai-guardrails` | user | None | getOrgId() | AI safety guardrails. |
| GET | `/api/v1/ai-alerts` | user | None | getOrgId() | AI alerts. |
| GET | `/api/v1/ai-interaction-logs` | user | None | getOrgId() | AI interaction logs (token costs). |
| GET/POST | `/api/v1/ai-sessions` | user | None | getOrgId() | AI sessions. |
| GET/PUT/DELETE | `/api/v1/ai-sessions/[id]` | user | session_id | getOrgId() | AI session detail. |
| GET | `/api/v1/ai-sessions/stats` | user | None | getOrgId() | AI usage statistics. |
| POST | `/api/v1/ai` | user | None | getOrgId() | AI actions (sentiment, tasks, text). `src/app/api/v1/ai/route.ts` |
| POST | `/api/v1/ai/chat` | user | None | getOrgId() | AI chat. `src/app/api/v1/ai/chat/route.ts` |
| POST | `/api/v1/ai/recommend` | user | None | getOrgId() | AI recommendations. |
| GET/POST | `/api/v1/ai-observations` | user | None | getOrgId() | AI observations. |
| GET/POST | `/api/v1/recurring-invoices` | user | None | getOrgId() | Recurring invoices. |
| GET/PUT/DELETE | `/api/v1/recurring-invoices/[id]` | user | recurring_id | getOrgId() | Recurring invoice detail. |
| POST | `/api/v1/recurring-invoices/generate` | user | None | getOrgId() | Generate from recurring. |
| GET/POST | `/api/v1/pricing/profiles` | user | None | getOrgId() | Pricing profiles. |
| GET/PUT/DELETE | `/api/v1/pricing/profiles/[id]` | user | profile_id | getOrgId() | Pricing profile detail. |
| GET/POST | `/api/v1/pricing/profiles/[id]/services` | user | profile_id | getOrgId() | Profile services. |
| GET/POST | `/api/v1/pricing/categories` | user | None | getOrgId() | Pricing categories. |
| GET | `/api/v1/pricing/company/[code]` | user | company_code | getOrgId() | Company pricing. |
| GET | `/api/v1/pricing/data` | user | None | getOrgId() | Pricing data export. |
| GET | `/api/v1/pricing/export` | user | None | getOrgId() | Export pricing. |
| GET/POST | `/api/v1/pricing/groups` | user | None | getOrgId() | Pricing groups. |
| GET | `/api/v1/pricing/unit-types` | user | None | getOrgId() | Pricing unit types. |
| GET/POST | `/api/v1/pricing/additional-sales` | user | None | getOrgId() | Additional sales. |
| GET/PUT/DELETE | `/api/v1/pricing/additional-sales/[id]` | user | sale_id | getOrgId() | Additional sale detail. |
| GET/POST | `/api/v1/price-changes` | user | None | getOrgId() | Price changes. |
| POST | `/api/v1/price-changes/batch` | user | None | getOrgId() | Batch price changes. |
| GET | `/api/v1/search` | user | None | getOrgId() | Global search. `src/app/api/v1/search/route.ts` |
| GET | `/api/v1/dashboard` | user | None | getOrgId() | Dashboard data. |
| GET | `/api/v1/dashboard/executive` | user | None | getOrgId() | Executive dashboard. |
| GET/PUT | `/api/v1/dashboard/layout` | user | None | getOrgId() | Dashboard layout config. |
| GET/PUT | `/api/v1/dashboard/widget-config` | user | None | getOrgId() | Widget configuration. |
| GET | `/api/v1/reports` | user | None | getOrgId() | Reports. |
| POST | `/api/v1/reports` | user | None | getOrgId() | Create report. |
| GET | `/api/v1/audit-log` | user | None | getOrgId() | Audit trail. `src/app/api/v1/audit-log/route.ts` |
| GET/POST | `/api/v1/activities` | user | None | getOrgId() | Activities. |
| GET/POST | `/api/v1/custom-fields` | user | None | getOrgId() | Custom fields. |
| GET/PUT/DELETE | `/api/v1/custom-fields/[id]` | user | field_id | getOrgId() | Custom field detail. |
| GET/POST | `/api/v1/currencies` | user | None | getOrgId() | Currencies. |
| GET/PUT/DELETE | `/api/v1/currencies/[id]` | user | currency_id | getOrgId() | Currency detail. |
| GET/POST | `/api/v1/lead-scoring` | user | None | getOrgId() | Lead scoring rules. |
| GET/POST | `/api/v1/sla-policies` | user | None | getOrgId() | SLA policies. |
| GET/PUT/DELETE | `/api/v1/sla-policies/[id]` | user | policy_id | getOrgId() | SLA policy detail. |
| GET/POST | `/api/v1/pipeline-stages` | user | None | getOrgId() (admin check via x-user-role header — bypassable) | Pipeline stages. `src/app/api/v1/pipeline-stages/route.ts` |
| GET | `/api/v1/portal-users` | user | None | getOrgId() | Portal user management. |
| POST | `/api/v1/portal-users` | user | None | getOrgId() | Create portal user. |
| GET | `/api/v1/notifications` | user | None | getOrgId() | User notifications. |
| GET/POST | `/api/v1/plan-requests` | user | None | getOrgId() | Plan upgrade requests (HTML injection in email). `src/app/api/v1/plan-requests/route.ts` |
| GET | `/api/v1/calendar/token` | user | None | Session (header fallback — bypassable) | Calendar token. `src/app/api/v1/calendar/token/route.ts` |
| POST | `/api/v1/calendar/generate-token` | user | None | Session (header fallback — bypassable) | Generate calendar token. |
| GET/POST | `/api/v1/calendar/agent` | user | None | getOrgId() | Calendar agent. |
| GET | `/api/v1/cost-model` | user | None | getOrgId() only — **NO RBAC** | Cost model overview (sensitive financial data). `src/app/api/v1/cost-model/route.ts` |
| GET | `/api/v1/cost-model/clients` | user | None | getOrgId() | Client cost data. |
| GET/POST | `/api/cost-model/employees` | user | None | getOrgId() | Employee cost records. `src/app/api/cost-model/employees/route.ts` |
| GET/PUT/DELETE | `/api/cost-model/employees/[id]` | user | employee_id | getOrgId() | Employee record. |
| GET/POST | `/api/cost-model/overhead` | user | None | getOrgId() | Overhead costs. |
| GET/PUT/DELETE | `/api/cost-model/overhead/[id]` | user | overhead_id | getOrgId() | Overhead item. |
| GET/PUT | `/api/cost-model/parameters` | user | None | getOrgId() | Cost model parameters. |
| GET | `/api/cost-model/analytics` | user | None | getOrgId() | Cost analytics. |
| GET | `/api/cost-model/ai-analysis` | user | None | getOrgId() | AI cost analysis. |
| GET | `/api/cost-model/client-costs` | user | None | getOrgId() | Client-by-client costs. |
| GET | `/api/cost-model/client-analytics/[id]` | user | client_id | getOrgId() | Single client analytics. |
| GET | `/api/cost-model/client-services/[id]` | user | client_id | getOrgId() | Client services. |
| GET/POST | `/api/cost-model/snapshots` | user | None | getOrgId() | Cost snapshots. |
| GET | `/api/cost-model/snapshots/[month]` | user | month | getOrgId() | Monthly snapshot (YYYY-MM format). |
| POST | `/api/cost-model/sync-pricing-services` | user | None | getOrgId() | Sync pricing services. |
| GET | `/api/budgeting/plans` | user | None | getOrgId() | Budget plans. `src/app/api/budgeting/plans/route.ts` |
| POST | `/api/budgeting/plans` | user | None | getOrgId() | Create budget plan. Same file. |
| GET/PUT/DELETE | `/api/budgeting/plans/[id]` | user | plan_id | getOrgId() + approver logic | Budget plan detail. `src/app/api/budgeting/plans/[id]/route.ts` |
| GET/POST | `/api/budgeting/plans/[id]/versions` | user | plan_id | getOrgId() | Plan versioning. |
| GET/POST/DELETE | `/api/budgeting/plans/[id]/comments` | user | plan_id | getOrgId() | Plan comments. |
| GET | `/api/budgeting/plans/[id]/diff` | user | plan_id | getOrgId() | Plan version diff. |
| POST | `/api/budgeting/plans/[id]/apply-templates` | user | plan_id | getOrgId() | Apply templates to plan. |
| GET | `/api/budgeting/lines` | user | None | getOrgId() | Budget lines. |
| GET/PUT | `/api/budgeting/lines/[id]` | user | line_id | getOrgId() | Budget line detail. |
| GET/POST | `/api/budgeting/actuals` | user | None | getOrgId() | Budget actuals. |
| GET/PUT/DELETE | `/api/budgeting/actuals/[id]` | user | actual_id | getOrgId() | Actual record. |
| GET/POST | `/api/budgeting/sections` | user | None | getOrgId() | Budget sections. |
| GET/PUT/DELETE | `/api/budgeting/sections/[id]` | user | section_id | getOrgId() | Section detail. |
| GET/POST | `/api/budgeting/departments` | user | None | getOrgId() | Departments. |
| GET/POST | `/api/budgeting/cost-types` | user | None | getOrgId() | Cost types. |
| GET/POST | `/api/budgeting/templates` | user | None | getOrgId() | Budget templates. |
| GET/PUT/DELETE | `/api/budgeting/templates/[id]` | user | template_id | getOrgId() | Template detail. |
| POST | `/api/budgeting/templates/seed` | user | None | getOrgId() | Seed default templates. |
| GET | `/api/budgeting/cash-flow` | user | None | getOrgId() | Cash flow analysis. |
| POST | `/api/budgeting/cash-flow/generate` | user | None | getOrgId() | Generate cash flow report. |
| GET | `/api/budgeting/cash-flow/plan-fact` | user | None | getOrgId() | Plan vs fact comparison. |
| GET | `/api/budgeting/analytics` | user | None | getOrgId() | Budget analytics. |
| GET | `/api/budgeting/ai-narrative` | user | None | getOrgId() | AI-generated narrative. |
| GET/POST | `/api/budgeting/sales-forecast` | user | None | getOrgId() | Sales forecast. |
| POST | `/api/budgeting/sales-forecast/import` | user | None | getOrgId() | Import forecast from CSV. |
| GET | `/api/budgeting/sales-forecast/export` | user | None | getOrgId() | Export forecast. |
| GET/POST | `/api/budgeting/rolling` | user | None | getOrgId() | Rolling forecasts. |
| POST | `/api/budgeting/rolling/auto-forecast` | user | None | getOrgId() | Auto-generate rolling forecast. |
| POST | `/api/budgeting/import-csv` | user | None | getOrgId() | Import budget from CSV. |
| GET | `/api/budgeting/export` | user | None | getOrgId() | Export budget. |
| GET/POST | `/api/budgeting/exchange-rates` | user | None | getOrgId() | Exchange rates. |
| GET | `/api/budgeting/snapshot` | user | None | getOrgId() | Budget snapshot (raw SQL). `src/app/api/budgeting/snapshot/route.ts` |
| GET | `/api/budgeting/snapshot-actuals` | user | None | getOrgId() | Actuals snapshot. |
| POST | `/api/budgeting/sync-actuals` | user | None | getOrgId() | Sync actuals. |
| POST | `/api/budgeting/resolve-costs` | user | None | getOrgId() | Resolve cost model. |
| GET | `/api/finance/dashboard` | user | None | getOrgId() | Finance dashboard. |
| GET/POST | `/api/finance/funds` | user | None | getOrgId() | Funds management. |
| GET/PUT/DELETE | `/api/finance/funds/[id]` | user | fund_id | getOrgId() | Fund detail. |
| GET/POST | `/api/finance/funds/[id]/rules` | user | fund_id | getOrgId() | Fund rules. |
| GET/POST | `/api/finance/funds/[id]/transactions` | user | fund_id | getOrgId() | Fund transactions. |
| GET/POST | `/api/finance/payables` | user | None | getOrgId() | Payables. |
| GET/PUT/DELETE | `/api/finance/payables/[id]` | user | payable_id | getOrgId() | Payable detail. |
| GET/POST | `/api/finance/payables/[id]/payments` | user | payable_id | getOrgId() | Payable payments. |
| GET | `/api/finance/payables/stats` | user | None | getOrgId() | Payables statistics. |
| GET | `/api/finance/receivables` | user | None | getOrgId() | Receivables. |

---
