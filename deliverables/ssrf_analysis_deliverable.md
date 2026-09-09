# SSRF Analysis Report

## 1. Executive Summary

- **Analysis Status:** Complete
- **Target:** https://v2.leaddrivecrm.org (LeadDrive v2 CRM/ERP platform)
- **Key Outcome:** Two high-confidence, externally exploitable server-side request forgery vulnerabilities were identified. Both allow any internet-registered user to force the application server to make outbound TCP/HTTP connections to arbitrary destinations, including internal services, cloud metadata endpoints, and private network ranges. Two additional SSRF sinks were identified in dead code (never called) and are confirmed safe for exploitation purposes.
- **Purpose of this Document:** This report provides the strategic context on the application's outbound request mechanisms, dominant flaw patterns, and key architectural details necessary to effectively exploit the vulnerabilities listed in the exploitation queue.

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Unvalidated User-Supplied URL in Outbound HTTP Request

- **Description:** The workflow engine accepts a user-controlled `actionConfig.url` (and `actionConfig.method`) via the `PUT /api/v1/workflows/[id]` endpoint, stores it in the database, and later passes it directly to Node.js `fetch()` when any matching CRM event fires. There is zero sanitization, no allowlist, no IP-range check, and no protocol restriction between the user-supplied string and the outbound network call.
- **Implication:** Any authenticated user (including self-registered attackers) can force the server to make HTTP requests to arbitrary internal destinations — including the cloud metadata endpoint at `169.254.169.254`, Redis (port 6379), the internal FastAPI compute service (port 8000), or any reachable private-network service.
- **Representative Findings:** `SSRF-VULN-01`

### Pattern 2: Unvalidated Admin-Configurable SMTP Host and Port

- **Description:** SMTP connection parameters (`smtpHost`, `smtpPort`) are accepted through `PUT /api/v1/settings/smtp` and passed directly to `nodemailer.createTransport()` with `rejectUnauthorized: false`. No hostname allowlist, private-IP blacklist, or port restriction is applied at any layer. The `POST /api/v1/settings/smtp/test` endpoint immediately exercises the stored configuration, providing an on-demand SSRF trigger.
- **Implication:** Attackers can force TCP connections to arbitrary hosts and ports for network reconnaissance, service banner grabbing, and probing of internal infrastructure. The `rejectUnauthorized: false` setting additionally enables MITM credential capture.
- **Representative Finding:** `SSRF-VULN-02`

---

## 3. Strategic Intelligence for Exploitation

- **HTTP Client Libraries:**
  - **Workflow engine:** Node.js native `fetch()` (Node 18+). Follows HTTP redirects by default (up to 20). No `redirect: "manual"` option set — redirect-chain bypass is possible.
  - **SMTP transport:** `nodemailer` 7.0.13 — opens raw TCP socket to configured `host:port`. Attacker gets SMTP-level TCP channel.
- **Request Architecture:**
  - Workflow webhook actions are dispatched **synchronously within the CRM event handler** before the HTTP response is returned to the triggering user. The `catch` block only logs to server console; errors are silently suppressed from the API response. This is **blind SSRF** — response bodies are not reflected.
  - SMTP connections are made synchronously during `POST /api/v1/settings/smtp/test`. Timing side-channels (connection refused vs. timeout) reveal whether a target host:port is reachable.
- **Internal Services Reachable from App Server:**
  - `http://localhost:8000` — FastAPI compute microservice (no authentication, dev `--reload` mode)
  - `redis://localhost:6379` — Redis with no authentication (session store, potential RCE via RESP protocol on port)
  - `postgresql://localhost:5432` — PostgreSQL (credentials `leaddrive:leaddrive` in docker-compose)
  - `http://169.254.169.254` — AWS/GCP/Azure cloud metadata endpoint (credential exfiltration target)
  - `http://metadata.google.internal` — GCP metadata alternative
- **Self-Registration Available:**
  - `POST /api/v1/auth/register` is a fully public endpoint with no email verification. Any attacker can create their own organization and admin user in a single request, gaining immediate access to all authenticated SSRF vectors.
- **Authentication Bypass Backdoor:**
  - Hardcoded fallback admin credentials (values redacted; credential rotation required) authenticated as enterprise admin when the database was unreachable (`src/lib/auth.ts` lines 95–106 at the time of testing). This provided an alternative authentication path for SSRF exploitation.

---

## 4. Detailed Vulnerability Analysis

### SSRF-VULN-01: Workflow Engine Webhook Injection

**Sink:** `src/lib/workflow-engine.ts` lines 181–198

```typescript
case "webhook":
  if (config.url) {
    try {
      await fetch(config.url, {
        method: config.method || "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: `${entityType}.workflow`,
          organizationId: orgId,
          entity,               // ← full entity data sent to attacker URL
          timestamp: new Date().toISOString(),
        }),
      })
    } catch (e) {
      console.error("Webhook action failed:", e)  // silently suppressed
    }
  }
```

**Source-to-Sink Trace:**
1. Attacker registers organization: `POST /api/v1/auth/register` → receives session cookie
2. Attacker creates workflow rule: `POST /api/v1/workflows` → receives `{id}`
3. Attacker injects malicious URL: `PUT /api/v1/workflows/{id}` with body:
   ```json
   {
     "actions": [{
       "actionType": "webhook",
       "actionConfig": {
         "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
         "method": "GET"
       }
     }]
   }
   ```
   Schema: `actionConfig: z.any()` — no URL validation whatsoever.
4. Attacker creates a contact to fire the trigger: `POST /api/v1/contacts` → `executeWorkflows(orgId, "contact", "created", contact)` called at `src/app/api/v1/contacts/route.ts:63`
5. `executeWorkflows()` in `src/lib/workflow-engine.ts` queries matching rules from Prisma and calls `executeAction()` → `case "webhook"` → `fetch(config.url, ...)`

**Sanitization check:** None. `actionConfig` is stored as raw JSON (`z.any()`) and retrieved verbatim. No URL parsing, no IP range check, no protocol restriction, no post-storage mutation.

**SSRF Type:** Blind SSRF — response body is not returned to the caller. However, entity data (contact fields) is sent in the POST body to the attacker-controlled URL, enabling partial data exfiltration.

**Triggering events (all fire `executeWorkflows`):**
- `POST /api/v1/contacts` — contact creation
- `POST /api/v1/deals` — deal creation
- `POST /api/v1/leads` — lead creation
- `POST /api/v1/tasks` — task creation
- `POST /api/v1/tickets` — ticket creation

---

### SSRF-VULN-02: SMTP Host/Port Injection

**Sink:** `src/lib/email.ts` lines 53–65 (via `createTransport()`); also directly instantiated in `src/app/api/v1/settings/smtp/test/route.ts` lines 33–45.

```typescript
// src/lib/email.ts
function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,       // ← user-controlled
    port: config.smtpPort,       // ← user-controlled (range 1-65535)
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    tls: config.smtpTls ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
}
```

**Source-to-Sink Trace:**
1. Attacker registers or logs in as any authenticated user
2. `PUT /api/v1/settings/smtp` → Zod schema (`src/app/api/v1/settings/smtp/route.ts` lines 6-14):
   ```typescript
   const smtpSchema = z.object({
     smtpHost: z.string().min(1),          // any string
     smtpPort: z.number().int().min(1).max(65535),  // any port
     ...
   })
   ```
   No hostname allowlist, no IP-range check, no private-IP blacklist.
3. Config stored in `Organization.settings.smtp` via Prisma
4. `POST /api/v1/settings/smtp/test` → `getSmtpConfig(orgId)` retrieves stored config → `nodemailer.createTransport({host: config.smtpHost, port: config.smtpPort, tls: {rejectUnauthorized: false}})` → TCP connection to attacker-specified host:port
5. Same config used by ALL email-sending endpoints: campaigns send, invoice send, offer send, forgot-password, event registration

**Sanitization check:** None beyond basic type validation. `smtpHost: z.string().min(1)` accepts `127.0.0.1`, `169.254.169.254`, `redis.internal`, `10.0.0.1`, etc.

**SSRF Type:** Semi-blind SSRF — timing side-channel reveals open vs. closed ports. Error messages may include SMTP banner snippets from the target server. Not a full HTTP SSRF (TCP/SMTP protocol), but effective for port scanning and internal service fingerprinting.

**Additional risk:** `rejectUnauthorized: false` disables TLS certificate validation, enabling MITM attacks against the real SMTP server.

**On-demand trigger:** `POST /api/v1/settings/smtp/test` provides immediate SSRF trigger without waiting for CRM events.

---

## 5. Analyzed and Confirmed Not Externally Exploitable

### Dead Code: `src/lib/webhooks.ts` — `dispatchWebhook()` function

The `dispatchWebhook()` function at line 29 contains an unvalidated `fetch(webhook.url, ...)` call at line 52. However:
- The function uses an **in-memory Map store** (`webhookStore`) — not the database
- `dispatchWebhook()` is **never called** anywhere in the application codebase (confirmed by full grep of imports)
- The `registerWebhook()` function is also never called from any API route
- The `GET/POST /api/v1/webhooks` endpoint mentioned in recon does not exist as a file; the `/api/v1/webhooks/` directory only contains inbound receiver sub-routes

**Verdict:** NOT exploitable in current deployment. Dead code.

### Dead Code: `src/lib/compute.ts` — `callCompute()` function

The `callCompute()` function concatenates `COMPUTE_URL` (default `http://localhost:8000`) with a user-supplied `path` string using simple template interpolation, creating a potential URL injection vector. However:
- `callCompute()` is **never called** from any API route or application code (confirmed by full grep)
- All cost model computation happens in-process via `computeCostModel()` in `src/lib/cost-model/compute.ts`
- The compute service is internal-only (`localhost:8000`) and unreachable from the internet regardless

**Verdict:** NOT exploitable in current deployment. Dead code.

### Third-party API integrations (Facebook, Telegram, Twilio, WhatsApp)

All outbound calls to Meta Graph API, Telegram Bot API, and Twilio REST API use hardcoded base URLs with only credential/identifier fields from the database. While `rejectUnauthorized` is not always explicitly set, the target domains are hardcoded and not user-controllable. These are not SSRF vectors.

**Verdict:** SAFE from SSRF perspective.

---

## 6. Secure by Design: Validated Components

| Component/Flow | Endpoint/File Location | Defense Mechanism Implemented | Verdict |
|---|---|---|---|
| Contract File Upload | `src/app/api/v1/contracts/[id]/files/route.ts` | Files saved with randomized UUID names; MIME type whitelist enforced; no HTTP client invoked | SAFE |
| Budgeting Raw SQL | `src/app/api/budgeting/snapshot/route.ts` | Uses Prisma `$queryRaw` tagged template — values parameterized, no injection | SAFE |
| Facebook Graph API calls | `src/lib/facebook.ts` | URL hardcoded to `graph.facebook.com`; no user-controlled URL component | SAFE |
| WhatsApp Cloud API calls | `src/lib/whatsapp.ts` | URL hardcoded to `graph.facebook.com`; no user-controlled URL component | SAFE |
| Telegram Bot API calls | `src/lib/journey-engine.ts` | URL hardcoded to `api.telegram.org`; no user-controlled URL component | SAFE |
| Twilio SMS API calls | `src/lib/journey-engine.ts` | URL hardcoded to `api.twilio.com`; no user-controlled URL component | SAFE |
| Portal Chat (AI) | `src/app/api/v1/public/portal-chat/route.ts` | Passes only message text to Anthropic SDK; no user URL in transport layer | SAFE |
| `dispatchWebhook()` (lib) | `src/lib/webhooks.ts:52` | Dead code — never called from any API route | SAFE (dead) |
| `callCompute()` (lib) | `src/lib/compute.ts:7` | Dead code — never called from any API route | SAFE (dead) |
