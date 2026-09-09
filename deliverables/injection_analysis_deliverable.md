# Injection Analysis Report (SQLi & Command Injection)

**Date:** 2026-03-27
**Target:** https://v2.leaddrivecrm.org
**Analyst:** Injection Analysis Specialist
**Input:** `deliverables/recon_deliverable.md` + white-box source code analysis

---

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** **Zero SQLi or Command Injection vulnerabilities** were identified in the LeadDrive v2 CRM codebase. All database access is mediated exclusively through Prisma ORM parameterized queries. No shell execution (`exec`, `spawn`, `child_process`) exists in any network-accessible code path. The application's ORM layer provides a consistent, effective defense against classical injection attacks across all 239+ API route handlers.
- **Secondary Findings:** Two confirmed **Server-Side Request Forgery (SSRF)** vulnerabilities and multiple **Stored XSS** sinks were identified. These are out of scope for this specialist's queue but are fully documented below for hand-off to the appropriate specialists. Additionally, a critical **mass-assignment logic flaw** in the journey engine was discovered. An SSRF analysis deliverable was already produced separately (`ssrf_analysis_deliverable.md`).
- **Purpose of this Document:** This report provides the complete source-to-sink analysis record for all injection vectors surveyed, documents why the ORM layer defeats classical injection universally, and flags the out-of-scope findings that require further exploitation testing by the correct specialists.

---

## 2. Dominant Vulnerability Patterns

### Pattern A: Universal Prisma ORM Parameterization

- **Description:** 100% of database access in the codebase uses Prisma ORM structured query methods (`findMany`, `findFirst`, `findUnique`, `create`, `update`, `delete`, `count`, `aggregate`, `groupBy`). The sole exception — the `$queryRaw` call in `src/app/api/budgeting/snapshot/route.ts` — uses Prisma's **tagged template literal** form (`prisma.$queryRaw\`...\``), which is also fully parameterized (dynamic slots become `$1`, `$2`, `$3` PostgreSQL bound parameters, not string-concatenated SQL). No `$queryRawUnsafe` or `$executeRawUnsafe` calls exist anywhere.
- **Implication:** Classical SQL injection is structurally impossible against the main application. User input can only influence the *values* bound to queries, never the SQL text structure itself.
- **Representative:** All endpoints surveyed; best illustrated by `src/app/api/budgeting/snapshot/route.ts` lines 24–32 (the only raw SQL usage in the codebase).

### Pattern B: Missing Input Schema Validation on GET Parameters

- **Description:** While POST endpoints frequently use Zod schema validation on request bodies, GET endpoints almost universally read query parameters with no type, length, or format validation. Parameters like `status`, `stage`, `category`, `dateFrom`, `dateTo` are passed raw strings directly to Prisma ORM filter values.
- **Implication:** No SQL injection is possible (Prisma parameterizes all values), but logic-level authorization bypasses exist. Examples: `?category=partner` reveals partner-category companies that the default filter intentionally hides; `?status=converted` reveals converted leads that the default filter excludes. These are authorization/logic findings, not injection.
- **Representative:** `src/app/api/v1/companies/route.ts` line 35 (`category` bypass), `src/app/api/v1/leads/route.ts` line 42 (`status` bypass).

### Pattern C: HTML Template String Interpolation Without Escaping (Stored XSS, Not SSTI)

- **Description:** Invoice HTML generation (`src/lib/invoice-html.ts`) and the PDF/act document routes construct HTML documents using JavaScript template literals with direct `${}` interpolation of user-controlled database values (invoice item names, descriptions, signer info, terms, footer notes, company names). No HTML encoding (e.g., via `DOMPurify`, `he.encode()`, or a safe template engine) is applied before interpolation.
- **Implication:** This is **stored XSS** targeting browsers that open the invoice HTML, not server-side template injection (SSTI). No expression evaluation, `eval()`, or code execution engine is involved server-side. The attack is purely client-side.
- **Representative:** `src/lib/invoice-html.ts` lines 199 (`item.name`, `item.description`), 233–234 (`signerName`, `signerTitle`), 241–242 (`termsAndConditions`, `footerNote`).

### Pattern D: Unvalidated Webhook/SMTP Configuration (SSRF)

- **Description:** Two admin-configurable parameters — webhook `url` (stored via `POST /api/v1/webhooks`, dispatched via `src/lib/webhooks.ts:52`) and SMTP `smtpHost`/`smtpPort` (stored via `PUT /api/v1/settings/smtp`, used in `src/lib/email.ts`) — are passed directly to `fetch()` and `nodemailer.createTransport()` respectively with no IP allowlist, hostname blocklist, or scheme restriction.
- **Implication:** Authenticated attackers can reach internal services (compute service at `localhost:8000`, cloud metadata at `169.254.169.254`, Redis at `localhost:6379`, PostgreSQL at `localhost:5432`). The SMTP test endpoint (`POST /api/v1/settings/smtp/test`) provides an active error-response oracle for banner grabbing.
- **Representative:** Webhook SSRF fully documented in `ssrf_analysis_deliverable.md` and below in Section 5.

---

## 3. Strategic Intelligence for Exploitation

### SQL & Command Injection: None to Exploit

The application's consistent use of Prisma ORM as a data access layer eliminates all traditional SQLi and command injection attack surface. No exploitation queue entries exist for these vulnerability classes. Penetration testing resources should **not** be allocated to SQLi/CMDi attempts against this application.

### SSRF (Out-of-scope for this specialist, refer to SSRF specialist)

Two externally reachable SSRF chains exist for authenticated attackers:

1. **Webhook SSRF** (`src/lib/webhooks.ts:52`): `fetch(webhook.url)` with no URL validation. Attack chain: `POST /api/v1/webhooks` (store arbitrary URL) → any CRM event (contact/deal/lead create/update) triggers `dispatchWebhook()` → server makes outbound request to the stored URL.
   - Reachable internal targets: `http://localhost:8000` (compute service, no auth), `http://localhost:6379` (Redis, no auth), `http://169.254.169.254/latest/meta-data/` (cloud metadata).
   - **Oracle**: Indirect — requires out-of-band target to capture the response.

2. **SMTP SSRF** (`src/lib/email.ts`, `src/app/api/v1/settings/smtp/`): `nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort })` with no validation. Attack chain: `PUT /api/v1/settings/smtp` (store arbitrary host/port) → `POST /api/v1/settings/smtp/test` → nodemailer opens TCP connection → error message (including server banner) returned in HTTP response body.
   - **Oracle**: Active — error messages returned directly to caller provide a reliable channel for port scanning and banner grabbing.
   - TLS: `rejectUnauthorized: false` — certificate validation disabled, enabling MitM.

### Stored XSS (Out-of-scope for this specialist, refer to XSS specialist)

The invoice HTML template generation and act document generation contain high-severity stored XSS via unescaped field interpolation. Key vectors:
- `termsAndConditions`, `footerNote`, `item.description` — free-text fields stored via `POST /api/v1/invoices`, rendered via `GET /api/v1/invoices/[id]/pdf` and `POST /api/v1/invoices/[id]/act` as `Content-Type: text/html`.
- `companyLogoUrl` in `<img src="...">` attribute — stored in org settings, attribute injection enables `onerror` XSS handler.
- Campaign `htmlBody` — stored by authenticated users, rendered in outbound emails.

### Journey Engine Mass-Assignment (Logic Vulnerability)

A critical logic-level mass-assignment flaw exists in `src/lib/journey-engine.ts`:

```typescript
// lines 383-394
case "update_field": {
  const field = config.field || ""
  const newValue = config.value || ""
  if (leadId && field) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { [field]: newValue },  // no field whitelist!
    })
  }
}
```

`config.field` and `config.value` come from `JourneyStep.config` (a JSONB column). An authenticated user can set these to any values via `PUT /api/v1/journeys/[id]` (no Zod validation on `config`). When the journey runs (either triggered normally or via the **unauthenticated** `POST /api/v1/journeys/process`), the attacker-chosen `field` is used as a computed property key in `prisma.lead.update()`. This allows writing arbitrary values to any Prisma `Lead` model field, including `organizationId` (cross-tenant data manipulation).

---

## 4. Vectors Analyzed and Confirmed Secure

All vectors below were fully traced from source to sink. All are confirmed safe from SQL injection, command injection, LFI, SSTI, and deserialization attacks.

| **Source (Parameter/Key)** | **Endpoint/File Location** | **Defense Mechanism Implemented** | **Verdict** |
|---|---|---|---|
| `planId` (query param) | `GET /api/budgeting/snapshot` — `src/app/api/budgeting/snapshot/route.ts:28` | Prisma `$queryRaw` tagged template literal (parameterized) | SAFE |
| `at` / `atDate` (query param) | `GET /api/budgeting/snapshot` — `src/app/api/budgeting/snapshot/route.ts:30` | `new Date(at)` → Date object → Prisma bound param | SAFE (Invalid Date error possible, not SQLi) |
| `search` (query param) | `GET /api/v1/contacts` — `contacts/route.ts:31` | Prisma `contains` ORM filter | SAFE |
| `companyId` (query param) | `GET /api/v1/contacts` — `contacts/route.ts:32` | Prisma equality ORM filter | SAFE |
| `search` (query param) | `GET /api/v1/deals` — `deals/route.ts:36` | Prisma `contains` ORM filter | SAFE |
| `stage` (query param) | `GET /api/v1/deals` — `deals/route.ts:37` | Prisma equality ORM filter (value bound) | SAFE (no whitelist, logic bypass possible) |
| `search` (query param) | `GET /api/v1/companies` — `companies/route.ts:34` | Prisma `contains` ORM filter | SAFE |
| `category` (query param) | `GET /api/v1/companies` — `companies/route.ts:35` | Prisma equality ORM filter (value bound) | SAFE (no whitelist, `?category=partner` bypasses default exclusion) |
| `search` (query param) | `GET /api/v1/leads` — `leads/route.ts:37-40` | Prisma `contains` multi-field OR ORM filter | SAFE |
| `status` (query param) | `GET /api/v1/leads` — `leads/route.ts:42` | Prisma equality ORM filter | SAFE (no whitelist, `?status=converted` bypasses default exclusion) |
| `includeConverted` (query param) | `GET /api/v1/leads` — `leads/route.ts:30` | Boolean coercion via string comparison | SAFE |
| `search` (query param) | `GET /api/v1/invoices` — `invoices/route.ts:71` | Prisma `contains` ORM filter | SAFE |
| `status` (query param) | `GET /api/v1/invoices` — `invoices/route.ts:72` | Prisma equality ORM filter | SAFE |
| `dateFrom` (query param) | `GET /api/v1/invoices` — `invoices/route.ts:77` | `new Date(dateFrom)` → Date object → Prisma bound param | SAFE (Invalid Date propagates, error string may be returned) |
| `dateTo` (query param) | `GET /api/v1/invoices` — `invoices/route.ts:79` | `new Date(dateTo)` → Date object → Prisma bound param | SAFE |
| `status` (query param) | `GET /api/v1/tickets` — `tickets/route.ts:30` | Prisma equality ORM filter | SAFE (no whitelist) |
| `q` (query param) | `GET /api/v1/search` — `search/route.ts` | Prisma `contains` ORM filter across 5 models | SAFE |
| `conditions` body (all fields) | `POST /api/v1/segments/preview` — `segments/preview/route.ts` + `src/lib/segment-conditions.ts` | All fields mapped to Prisma ORM value positions | SAFE |
| `search`, `page`, `limit` (query params) | `GET /api/v1/segments` — `segments/route.ts` | Prisma `contains`; `parseInt()` for page/limit | SAFE |
| `body` (POST) | `POST /api/v1/segments` — `segments/route.ts` | Zod schema + Prisma ORM create | SAFE |
| `email` (body) | `POST /api/v1/public/portal-auth` — `portal-auth/route.ts` | Prisma `findFirst` ORM filter (no Zod — Prisma operator injection risk) | SAFE from SQLi (minor operator injection concern) |
| `password` (body) | `POST /api/v1/public/portal-auth` — `portal-auth/route.ts` | bcrypt.compare() | SAFE |
| `message`, `sessionId` (body) | `POST /api/v1/public/portal-chat` — `portal-chat/route.ts` | Prisma ORM; JWT-scoped query | SAFE |
| `subject`, `description`, `category`, `priority` (body) | `POST /api/v1/public/portal-tickets` — `portal-tickets/route.ts` | Prisma ORM create (no enum validation) | SAFE from SQLi |
| `name`, `email`, `phone`, `company`, `message`, `org_slug` (body) | `POST /api/v1/public/leads` — `public/leads/route.ts` | Zod schema + Prisma ORM | SAFE |
| Journey step `config.field/value` (via process endpoint) | `POST /api/v1/journeys/process` (unauthenticated) → `journey-engine.ts:383-394` | Prisma ORM update (values parameterized) | SAFE from SQLi; **mass-assignment logic flaw** |
| WhatsApp webhook body (`waId`, `text`, `senderName`) | `POST /api/v1/webhooks/whatsapp` — `webhooks/whatsapp/route.ts` | Prisma ORM filters (all parameterized) | SAFE from SQLi |
| Facebook webhook body (`pageId`, `senderId`, `text`, `mediaUrl`) | `POST /api/v1/webhooks/facebook` — `webhooks/facebook/route.ts` | Prisma ORM | SAFE from SQLi |
| Telegram webhook body (`chatId`, `text`, `senderName`) | `POST /api/v1/webhooks/telegram` — `webhooks/telegram/route.ts` | Prisma ORM | SAFE from SQLi |
| VKontakte webhook body (`group_id`, `from_id`, `text`) | `POST /api/v1/webhooks/vkontakte` — `webhooks/vkontakte/route.ts` | Prisma ORM | SAFE from SQLi |
| `planId` (query param) | `GET /api/budgeting/export` — `budgeting/export/route.ts` | Prisma ORM `findFirst`/`findMany` | SAFE |
| CSV row fields (all) | `POST /api/budgeting/import-csv` — `budgeting/import-csv/route.ts` | Prisma ORM `create` | SAFE |
| `entityType`, `entityId`, `page`, `limit` (query params) | `GET /api/v1/audit-log` — `audit-log/route.ts` | Prisma ORM equality; `parseInt()` for pagination | SAFE |
| `message`, `context`, `history` (body) | `POST /api/v1/ai/chat` — `ai/chat/route.ts` | Prisma ORM for all DB calls; passed to Anthropic API | SAFE from SQLi (prompt injection risk) |
| `name`, `email`, `phone` (body) | `POST /api/v1/public/events/[id]/register` — `events/[id]/register/route.ts` | Prisma ORM create | SAFE |
| `htmlBody` (campaign template) + `contact.fullName` | `src/lib/email.ts` `renderTemplate()` lines 173–179 | Simple regex string substitution (no eval) | NOT SSTI — stored XSS in email content |
| `termsAndConditions`, `footerNote`, `item.name`, `item.description` (invoice fields) | `src/lib/invoice-html.ts` lines 199, 233–234, 241–242 | None — direct `${}` interpolation into HTML string | NOT SSTI — stored XSS in HTML response |
| `companyLogoUrl` (org settings) | `src/app/api/v1/invoices/[id]/act/route.ts` line 120 | None — injected into `<img src="...">` attribute | NOT SSRF (no server-side fetch) — stored XSS attribute injection |
| Contract file upload (`file.name`, MIME type) | `POST /api/v1/contracts/[id]/files` — `contracts/[id]/files/route.ts:68-75` | `crypto.randomBytes(16)` hex + `path.extname()` for filename; MIME type from client (not verified against file magic bytes) | NOT exploitable path traversal; minor MIME bypass |

---

## 5. Analysis Constraints and Blind Spots

### SSRF Findings — Not In This Specialist's Queue

Two confirmed externally-exploitable SSRF vulnerabilities were identified. Per the vulnerability type scope for this analysis phase (`SQLi | CommandInjection | LFI | RFI | SSTI | PathTraversal | InsecureDeserialization`), SSRF is outside this specialist's queue. Both findings are documented for hand-off:

**SSRF-1 — Webhook URL Dispatch**
- **Source:** `webhook.url` — stored via `POST /api/v1/webhooks`, accessible to all authenticated users
- **Sink:** `src/lib/webhooks.ts:52` — `await fetch(webhook.url, { method: "POST", ... })`
- **Sanitization:** None — no IP allowlist, no hostname blocklist, no scheme restriction
- **Trigger:** Any CRM event (contact/deal/lead create, update, delete) fires `dispatchWebhook()` asynchronously
- **Exploitable:** YES (authenticated) — any authenticated org member can set a webhook URL to internal services
- **Severity:** HIGH

**SSRF-2 — SMTP Host/Port**
- **Source:** `smtpHost`, `smtpPort` — stored via `PUT /api/v1/settings/smtp`
- **Sink:** `src/lib/email.ts:54` — `nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort })`
- **Sanitization:** Zod schema `z.string().min(1)` for host — no IP/hostname blocklist; `z.number().int().min(1).max(65535)` for port — all ports allowed
- **Oracle:** `POST /api/v1/settings/smtp/test` returns raw `e.message` from nodemailer errors, enabling banner grabbing
- **Exploitable:** YES (authenticated) — full TCP scan of internal network with active response oracle
- **Severity:** HIGH

### Stored XSS Findings — Not In This Specialist's Queue

Multiple stored XSS sinks were identified via unescaped HTML interpolation in invoice and campaign templates. All require authenticated write access to the CRM but affect browser-rendered output. These are flagged for the XSS/Web specialist.

### Journey Engine Mass-Assignment — Logic Vulnerability (Not SQLi)

The `update_field` journey step in `src/lib/journey-engine.ts:383-394` uses `data: { [config.field]: config.value }` with no field whitelist. An authenticated user can craft journey steps (via `PUT /api/v1/journeys/[id]` with no step config validation) that write arbitrary values to any `Lead` model field. This is a Prisma mass-assignment flaw, not SQL injection (values remain parameterized). Exploitable by authenticated users; the unauthenticated `POST /api/v1/journeys/process` provides timing control for triggering the malicious step without additional authentication.

### Prisma Operator Injection in Portal Auth — Low Impact

`POST /api/v1/public/portal-auth` passes the `email` field from the request body without Zod/type validation directly to `prisma.contact.findFirst({ where: { email } })`. Sending `{"email": {"not": ""}}` would be interpreted as `WHERE email != ''`, returning the first contact with any non-empty email. The bcrypt password check immediately following prevents full authentication bypass, but the "contact not found" gate is bypassed. Impact is low given the bcrypt protection but the pattern should be fixed.

### Compute Service (`src/lib/compute.ts`) — Latent Path Traversal

`callCompute(path, body)` builds the request URL as `` `${COMPUTE_URL}${path}` `` with no sanitization. Currently, this function has **no call sites** — it is exported but never invoked. It represents a latent SSRF/path-traversal vector against the internal FastAPI compute service (`http://localhost:8000`) if user input is ever passed as `path` in future code.
