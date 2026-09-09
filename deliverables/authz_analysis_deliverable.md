# Authorization Analysis Report

**Date:** 2026-03-27
**Target:** https://v2.leaddrivecrm.org
**Analyst:** Authorization Analysis Specialist
**Input:** `deliverables/recon_deliverable.md` + Full source code analysis

---

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** 17 confirmed authorization vulnerabilities identified across horizontal, vertical, and context/workflow categories. The application has a **systemic authorization architecture failure**: a complete RBAC permission matrix is defined in `src/lib/permissions.ts` but enforced on only **1 of ~167 API endpoints** (`/api/v1/projects`). All other endpoints rely on `getOrgId()` which validates org membership only and performs zero role-based permission checks. This means every authenticated user — regardless of role — has functionally equivalent access to all CRM operations.
- **Purpose of this Document:** This report provides strategic context, dominant vulnerability patterns, and architectural intelligence to effectively exploit the vulnerabilities listed in the companion exploitation queue. It is intended to be read alongside `authz_exploitation_queue.json`.

**Critical Highlights:**
- Any authenticated user can escalate to `admin` via `PUT /api/v1/users/[id]` — the role field has no guard whatsoever
- Any authenticated user can rewrite the entire RBAC permission matrix via `PUT /api/v1/settings/permissions`
- `POST /api/v1/journeys/process` requires **zero authentication** and sends bulk email/SMS/WhatsApp for all organizations on the platform
- The calendar feed endpoint issues non-expiring tokens that expose all organization tasks
- Any authenticated user can retrieve all third-party API credentials (WhatsApp, Telegram, SMS) from the channels endpoint

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Systemic RBAC Non-Enforcement (Vertical | Applies to ~166 endpoints)
- **Description:** All endpoints except `/api/v1/projects` use `getOrgId()` instead of `requireAuth()`. The `getOrgId()` function returns the organization ID but performs zero role or permission checks. The `requireAuth()` function exists and integrates with the RBAC permission matrix (`src/lib/permissions.ts`) but is ignored.
- **Implication:** A `viewer` (read-only) user has the same write/delete access as an `admin`. A `sales` user can access financial reports they're not supposed to. Any role can perform any action on any module.
- **Root Cause:** `src/lib/api-auth.ts:41-48` — `getOrgId()` strips all role context; `src/app/api/v1/projects/route.ts` is the only file that correctly calls `requireAuth()`.
- **Representative:** AUTHZ-VULN-02, AUTHZ-VULN-03, AUTHZ-VULN-04, AUTHZ-VULN-05, AUTHZ-VULN-06, AUTHZ-VULN-08, AUTHZ-VULN-09, AUTHZ-VULN-11, AUTHZ-VULN-12

### Pattern 2: Admin-Only Settings Endpoints Fully Open to All Roles (Vertical)
- **Description:** The settings API routes (`/api/v1/settings/*`) have UI-level protection in middleware (redirects non-admins at the browser level) but zero API-level protection. The middleware check at `src/middleware.ts:84-86` only redirects non-admins from the `/settings/*` UI routes — it does NOT restrict `/api/v1/settings/*` API routes.
- **Implication:** Any authenticated user can directly call the settings API endpoints to reconfigure SMTP, modify RBAC roles, rewrite the permission matrix, and change invoice/banking details.
- **Representative:** AUTHZ-VULN-03, AUTHZ-VULN-04, AUTHZ-VULN-05, AUTHZ-VULN-17

### Pattern 3: Unauthenticated and Improperly Guarded Workflow Triggers (Context)
- **Description:** Several workflow endpoints that trigger side effects (emails, SMS, WhatsApp) either lack authentication entirely or lack state validation. The journey processor is explicitly whitelisted in middleware as a public endpoint.
- **Implication:** Anyone on the internet can trigger the journey processor to send bulk communications across all tenants. Authenticated users with any role can trigger mass email campaigns, send invoices to arbitrary recipients, and enroll contacts in messaging workflows.
- **Representative:** AUTHZ-VULN-10, AUTHZ-VULN-11, AUTHZ-VULN-12, AUTHZ-VULN-14

### Pattern 4: Missing Cross-Tenant Isolation in Task Mutation Queries (Horizontal)
- **Description:** The `PATCH /api/v1/tasks/[id]` handler calls `prisma.task.update({ where: { id } })` — the `organizationId` is absent from the WHERE clause. There is no prior ownership check (no `findFirst` with orgId before the update).
- **Implication:** Any authenticated user knowing a task ID can modify that task regardless of which organization it belongs to.
- **Representative:** AUTHZ-VULN-01

---

## 3. Strategic Intelligence for Exploitation

### Session Management Architecture
- Sessions use NextAuth v5 (beta) JWT stored in `__Secure-authjs.session-token` cookie (A256CBC-HS512 JWE, httpOnly, secure, sameSite=lax)
- User ID, organizationId, role, and plan are embedded in the JWT token claims at login time
- **Role is NOT re-fetched per request** — role changes only take effect when the user logs out and back in (or the session expires at 30 days)
- Middleware injects `x-organization-id`, `x-user-id`, `x-user-role` headers from the validated session. These headers are SET (not appended), so client-supplied values are properly overridden by the middleware. Header injection is **NOT exploitable** externally.
- The `getOrgId()` function trusts the middleware-injected `x-organization-id` header as a "fast path" — this is safe because the middleware properly sets it from the session

### Role/Permission Model
- Five roles: `viewer` (1), `sales` (2), `support` (2), `manager` (4), `admin` (10)
- Role is stored in `User.role` database column and embedded in JWT at login
- **Critical Finding:** The RBAC matrix defined in `src/lib/permissions.ts` is never consulted by API routes (except projects). All roles have functionally identical API access — only org membership is enforced.
- **Critical Finding:** `PUT /api/v1/users/[id]` with `{ role: "admin" }` self-escalates without any check. The role field passes through the Zod schema (`z.enum(["admin", "manager", "agent", "viewer"])`) and is applied at `src/app/api/v1/users/[id]/route.ts:68` with no caller role validation.
- Since registration at `/register` is open, any external attacker can create an account (initially `admin` for their own new org), then use all vertical privileges within that org.

### Resource Access Patterns
- Almost all authenticated endpoints accept resource IDs via URL path parameters (e.g., `/api/v1/tasks/[id]`)
- The dominant safe pattern uses `prisma.findFirst({ where: { id, organizationId: orgId } })` — this is org-scoped and prevents cross-tenant access for most entities
- **Critical Deviation:** `PATCH /api/v1/tasks/[id]` skips the ownership `findFirst` entirely and calls `prisma.task.update({ where: { id } })` directly — the only pure cross-tenant write vulnerability confirmed
- The Prisma client in `src/lib/prisma.ts` exports a base `prisma` client with NO middleware. A `tenantPrisma()` helper exists with auto org-scoping, but it is **never used** by any API route. All org-scoping is done manually by individual routes.
- `findUnique` is explicitly NOT scoped in the `tenantPrisma()` middleware (`src/lib/prisma.ts:46-48`) — it passes args through unmodified. This is a code quality issue but not directly exploitable since routes don't use `tenantPrisma()`.

### Workflow Implementation
- The journey processor (`POST /api/v1/journeys/process`) is a cron-style endpoint called every 60 seconds internally (`src/instrumentation.ts:17-30`). It was designed as an internal endpoint but is publicly accessible with no authentication.
- Campaign sends have no status state machine — campaigns in `sent`, `cancelled`, or `failed` state can be "re-sent"
- Invoice sends have no status check — draft, rejected, and overdue invoices can all be sent to arbitrary recipient emails
- Calendar tokens (`calendarToken` field in `User` table) are generated once and never expire — there is no expiry field in the schema

### Multi-Tenancy Architecture
- Org isolation is primarily enforced via manual `organizationId` inclusion in Prisma WHERE clauses
- For ~95% of endpoints, org isolation IS correctly implemented (findFirst/updateMany/deleteMany all include orgId)
- The exceptions are: tasks PATCH (no orgId in update), and a few secondary operations on invoices/payments where the `update` follows a validated `findFirst` (safe in practice but poor defense-in-depth)
- Portal-tier isolation (customer portal) is strong — `portal-token` JWT binds `contactId + organizationId`, and all portal ticket queries verify both values

---

## 4. Vectors Analyzed and Confirmed Secure

These authorization checks were traced and confirmed to have robust, properly-placed guards.

| **Endpoint** | **Guard Location** | **Defense Mechanism** | **Verdict** |
|---|---|---|---|
| `GET/POST/PATCH /api/v1/public/portal-tickets/[id]` | portal-tickets/[id]/route.ts:11-16, 74-76, 119-121 | JWT portal-token verifies contactId AND organizationId in every DB query | SAFE |
| `GET /api/v1/public/portal-tickets` | portal-tickets/route.ts | JWT portal-token with orgId scoping | SAFE |
| `DELETE /api/v1/invoices/[id]/payments/[paymentId]` | payments/[paymentId]/route.ts:12-14 | findFirst with id+invoiceId+organizationId gates all subsequent operations | SAFE (org-scoped) |
| `GET/DELETE /api/v1/contacts/[id]` | contacts/[id]/route.ts:26, 66-67 | findFirst and deleteMany both include organizationId | SAFE (org-scoped) |
| `GET/PUT/DELETE /api/v1/deals/[id]` | deals/[id]/route.ts:40-42, 112-113, 195-196 | findFirst and updateMany/deleteMany all include organizationId | SAFE (org-scoped) |
| `DELETE /api/v1/contracts/[id]/files/[fileId]` | contracts/[id]/files/[fileId]/route.ts:16-19 | findFirst with fileId+contractId+organizationId — triple ownership check | SAFE |
| `GET /api/v1/ai-sessions/[id]` | ai-sessions/[id]/route.ts:15-16 | findFirst with id+organizationId | SAFE (read-only, org-scoped) |
| `GET/POST/PUT/DELETE /api/v1/projects/*` | projects/route.ts:23-26 | requireAuth() — the one correctly implemented endpoint | SAFE |
| `x-organization-id` header | src/middleware.ts:63-68 | Middleware uses `new Headers(req.headers)` then `.set()` to OVERRIDE any client-supplied value with session-derived orgId | SAFE (not injectable) |

---

## 5. Vulnerability Deep-Dives

### AUTHZ-VULN-01: Cross-Tenant Task Modification
**File:** `src/app/api/v1/tasks/[id]/route.ts` (PATCH handler, ~line 47)

The PATCH handler lacks an ownership check before modifying the task. Unlike DELETE (which has a `findFirst` with orgId gating), PATCH calls `prisma.task.update({ where: { id }, data })` directly without verifying the task belongs to the authenticated user's organization. Any authenticated user who knows a task ID (CUID) can modify its title, description, status, due date, or assignment.

```typescript
// VULNERABLE: No prior ownership check, no organizationId in WHERE
const task = await prisma.task.update({
  where: { id },  // orgId absent
  data,
})
```

### AUTHZ-VULN-02: Privilege Escalation via User Role Update
**File:** `src/app/api/v1/users/[id]/route.ts` (line 68)

The PUT handler authenticates via `getOrgId()` (org membership only) and then applies all parsed fields including `role` directly to the database with no caller role check. The updateUserSchema accepts `role: z.enum(["admin", "manager", "agent", "viewer"])`. A viewer-role user can `PUT /api/v1/users/[their-id]` with `{ role: "admin" }` to escalate themselves.

```typescript
// VULNERABLE: role field applied with no admin check
if (parsed.data.role !== undefined) updateData.role = parsed.data.role
// ...
const user = await prisma.user.update({ where: { id }, data: updateData })
```

Comments in the code say "Admin can reset user's 2FA" and "Admin can toggle require2fa" but there is **no actual admin check** enforcing these comments.

### AUTHZ-VULN-03: RBAC Matrix Takeover via Settings Permissions
**File:** `src/app/api/v1/settings/permissions/route.ts` (line 69)

The PUT handler accepts a full permission matrix payload and writes it directly to `Organization.settings.permissions` with only `getOrgId()` for authentication. The only constraint applied is `body.admin.settings = "full"` — all other role permissions are freely settable. Any authenticated user can grant `viewer` full admin access to all modules.

### AUTHZ-VULN-04: Custom Role Creation and Permission Assignment
**File:** `src/app/api/v1/settings/roles/route.ts`

All four HTTP methods (GET, POST, PUT, DELETE) use only `getOrgId()` with no role check. Any authenticated user can create a new role, assign it arbitrary permissions including full settings access, and then have an admin user re-assigned to it (or assign it to themselves via AUTHZ-VULN-02 chain).

### AUTHZ-VULN-10: Unauthenticated Journey Processor (Mass Messaging)
**File:** `src/app/api/v1/journeys/process/route.ts` + `src/middleware.ts:27`

The endpoint is explicitly whitelisted in middleware:
```typescript
pathname === "/api/v1/journeys/process"
```
No authentication check exists in the route handler. A `POST` to this endpoint triggers `processEnrollmentStep()` for all pending journey enrollments across **all organizations simultaneously** (no org filter on the enrollments query). Each processed step may trigger emails (via organization SMTP), SMS (via Twilio), WhatsApp (via Meta Graph API), Telegram messages, task creation, or lead field updates. The response leaks enrollment IDs, contact IDs, lead IDs, and message content.

---

## 6. Analysis Constraints and Blind Spots

- **Session Expiry Side-Effect:** Because roles are embedded in JWT at login and not re-fetched per request, role changes (including AUTHZ-VULN-02 self-escalation) only become effective in the JWT session after logout/re-login. However, the JWT session can be immediately invalidated by the application and a new one issued (depends on NextAuth session configuration).
- **CUID Guessing for Cross-Tenant Tasks:** AUTHZ-VULN-01 requires knowing a task ID from another org. CUIDs are random (25 chars, ~128 bits entropy) — guessing is infeasible. Exploitation requires prior knowledge of cross-tenant IDs through some secondary information leak.
- **FastAPI Compute Service:** The internal Python FastAPI service (port 8000) was not analyzed as it is not directly accessible from the internet. Any authorization flaws in it would require chaining through the Next.js application.
- **Journey Processor Cross-Org Impact:** AUTHZ-VULN-10 processes enrollments for all organizations without an org filter, but each enrollment carries its own `organizationId` which is passed to `processEnrollmentStep()`. The attacker cannot target a specific org's data through this endpoint — they can only trigger processing of whatever happens to be pending.
- **Registration Open by Design:** All "authenticated" vulnerabilities assume the attacker can register an account. Since registration is publicly available at `/register`, external attackers can trivially obtain valid sessions and exploit all authenticated vulnerabilities within their own org context.

---

## 7. Vulnerability Index

| ID | Type | Endpoint | Guard Evidence | Confidence | Externally Exploitable |
|---|---|---|---|---|---|
| AUTHZ-VULN-01 | Horizontal | PATCH /api/v1/tasks/[id] | No ownership check, no orgId in update WHERE | High | Yes |
| AUTHZ-VULN-02 | Vertical | PUT /api/v1/users/[id] | No role check on role field assignment | High | Yes |
| AUTHZ-VULN-03 | Vertical | PUT /api/v1/settings/permissions | No role check, full RBAC matrix writable | High | Yes |
| AUTHZ-VULN-04 | Vertical | POST/PUT /api/v1/settings/roles | No role check, roles/permissions fully writable | High | Yes |
| AUTHZ-VULN-05 | Vertical | PUT /api/v1/settings/smtp | No role check, SMTP host/port freely configurable | High | Yes |
| AUTHZ-VULN-06 | Vertical | POST /api/v1/users | No role check on creator, role field accepted | High | Yes |
| AUTHZ-VULN-07 | Vertical | PUT /api/v1/users/[id] | No role check on resetTotp/require2fa fields | High | Yes |
| AUTHZ-VULN-08 | Vertical | GET /api/v1/channels | No role check, full API secrets returned | High | Yes |
| AUTHZ-VULN-09 | Vertical | GET /api/v1/audit-log | No role check, admin-only data exposed | High | Yes |
| AUTHZ-VULN-10 | Context | POST /api/v1/journeys/process | No authentication at all (public whitelist) | High | Yes |
| AUTHZ-VULN-11 | Context | POST /api/v1/campaigns/[id]/send | No role check, no campaign status validation | High | Yes |
| AUTHZ-VULN-12 | Context | POST /api/v1/invoices/[id]/send | No invoice status validation, arbitrary recipient | High | Yes |
| AUTHZ-VULN-13 | Context | GET /api/v1/calendar/feed/[token] | Tokens never expire, expose all org tasks | Med | Yes |
| AUTHZ-VULN-14 | Context | POST /api/v1/journeys/enroll | No role check for journey write operations | High | Yes |
| AUTHZ-VULN-15 | Context | POST /api/v1/recurring-invoices/generate | No role check, any user triggers batch generation | Med | Yes |
| AUTHZ-VULN-16 | Context | POST /api/v1/segments/preview | No role check, contact enumeration via segments | Med | Yes |
| AUTHZ-VULN-17 | Vertical | PUT /api/v1/settings/invoice | No role check, bank account details modifiable | High | Yes |
