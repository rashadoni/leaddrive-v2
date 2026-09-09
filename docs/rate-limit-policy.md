# Rate-Limit Policy

Single source of truth for which endpoints are rate-limited, by what key,
with what threshold, and where the enforcement lives. Review this before
adding a new public or bypass-auth endpoint.

## Defaults (`src/lib/rate-limit.ts`)

| Config key | Threshold | Window | Purpose |
|---|---|---|---|
| `public`  | 10 req/min  | 60s | Unauthenticated user-facing POST (login, forms) |
| `authPrincipal` | 10 req/min | 60s | CRM credentials attempts per hashed email + tenant |
| `api`     | 100 req/min | 60s | Unauthenticated GET (enumeration protection) |
| `ai`      | 20 req/min  | 60s | AI-backed endpoints (per-user cost ceiling) |
| `apiKey`  | 300 req/min | 60s | `Authorization: Bearer ld_...` machine clients |
| `webhook` | 600 req/min | 60s | Webhook source endpoints (per source IP) |

Store is in-memory sliding-window (`requestStore: Map<string, number[]>`),
evicts oldest entries once `MAX_KEYS = 10_000`, periodic 60s cleanup.
For multi-instance deployments this needs to migrate to Redis — current
single-PM2-process topology makes the in-memory store acceptable.

## Enforcement map (`src/middleware.ts`)

Middleware runs before every request. Listed in execution order.

| # | Matcher | Method | Key | Config |
|---|---|---|---|---|
| 1 | `RATE_LIMITED_PATHS` (auth) | POST | `auth:<ip>` | `public` |
| 2 | `/api/v1/public/*` (not portal-chat) | POST | `public:<ip>` | `public` |
| 3 | `/api/v1/public/*/portal-chat` | POST | `chat:<ip>` | `ai` |
| 4 | `/api/v1/public/*` | GET | `pub-get:<ip>` | `api` |
| 5 | `/api/v1/webhooks/*` (not `/manage`) | any | `webhook:<namespace>:<ip>` | `webhook` |
| 6 | `/api/v1/calls/webhook*` | any | `webhook:calls:<ip>` | `webhook` |
| 7 | `/api/v1/calendar/feed/*` | any | `webhook:calendar:<ip>` | `webhook` |
| 8 | `Bearer ld_...` API-key requests | any | `apikey:<sha256(key)[:16]>` | `apiKey` |

The public POST/GET rows are evaluated before the public-path early return, so
public endpoints cannot bypass the limiter by matching `publicPaths`.

`<ip>` = `x-real-ip` header (set by nginx) ⇢ last `x-forwarded-for` hop
⇢ `"unknown"`.

`<namespace>` = path segment after `/api/v1/webhooks/`
(e.g. `telegram`, `whatsapp`, `meta-social`).

`<sha256(key)[:16]>` = first 16 hex chars of SHA-256 over the raw key —
avoids storing raw keys in the rate-limit Map while keeping keys distinct
at scale.

## Per-route reinforcements

Some routes apply an additional in-route rate-limit on top of middleware:

| Route | Extra limit | Key | Rationale |
|---|---|---|---|
| `src/app/api/v1/ai/route.ts` | `ai` | per-org | Expensive AI provider calls |
| `src/app/api/v1/ai/chat/route.ts` | `ai` | per-org | Same |
| `src/app/api/v1/admin/tenants/route.ts` | `api` | per-superadmin | Enumeration |
| `src/app/api/v1/auth/sms-otp/send/route.ts` | custom | per-phone | SMS cost / abuse |
| `src/app/api/v1/public/portal-auth` | 5/min | hashed tenant+email principal | Password brute-force protection; middleware also applies per-IP `public` bucket |
| `src/app/api/v1/public/web-chat/*` | `public` | per-session | Keyed by session in handler |
| `src/app/api/v1/public/surveys/[slug]/route.ts` | `public` | per-slug | Per-survey-slug |
| `src/app/api/v1/uploads/[...path]/route.ts` (GET) | 300/min | per-userId | Auth'd disk read; gallery pages fan out to 30-50 image requests per render, so headroom is set high. Throttles a logged-in scraper guessing filenames. |
| `src/app/api/v1/mtm/photos/route.ts` (POST) | 30/min | per-agentId | Field upload bucket. Caps a compromised JWT or runaway loop from filling disk + saturating HEIC conversion. |
| `src/app/api/v1/email-templates/upload-image/route.ts` (POST) | 30/min | per-userId | Admin-only (campaigns:write); honest editing is low-frequency. |
| `src/app/api/v1/users/assignable/route.ts` (GET) | 120/min | per-userId | Auth'd (`tasks:read`). Fires on TaskForm open + every entity-detail page mount. Headroom for power users; throttles a compromised JWT enumerating the directory. |

These are layered on top of the middleware limits — if the middleware
bucket is empty, the request never reaches the per-route check. If the
per-route bucket is empty, the middleware has already accepted the
request but the handler will return 429.

## Intentionally not rate-limited

| Endpoint | Reason |
|---|---|
| `/api/v1/mtm/*` (except `mtm/photos` POST) | Mobile JWT auth handled in `getOrgId` — tenant-scoped, low abuse vector. `mtm/photos` POST has its own per-agent reinforcement above because uploads have disk + HEIC-conversion cost. |
| `/api/cron/*`, `/api/v1/social/cron/*` | Bearer `CRON_SECRET` required — not reachable without the secret |
| `/api/v1/journeys/process` | Same — Bearer `CRON_SECRET` |
| `/api/health` | Health probe (nginx + PM2 needs it unthrottled) |
| `/api/v1/webhooks/manage`, `/api/v1/webhooks/manage/*` | User CRUD (`getOrgId`), not a webhook receiver |

If a cron secret ever leaks, `apiKey` will NOT backstop it — cron routes
take a different auth path. Rotate `CRON_SECRET` if suspected.

## Known gaps (to be addressed separately)

These are tracked here so new work doesn't recreate them; fixing is out
of scope for the rate-limit commits.

1. **`/api/v1/webhooks/vkontakte`** — no signature or secret verification.
   Trusts `group_id` from request body. A determined attacker who knows
   a tenant's VK group ID can inject fake inbound messages. Mitigation
   today: webhook rate-limit caps flood rate; per-message org isolation
   prevents cross-tenant damage.

2. **`/api/v1/webhooks/sms-inbound`** — identifies organization via
   `?orgId=<uuid>` query param. No shared secret — anyone who knows or
   guesses an org UUID can inject fake inbound SMS.

3. **`/api/v1/calls/webhook`** — no signature verification on the
   Twilio status callback. Trusts `CallSid` from form data. Real Twilio
   validation requires `X-Twilio-Signature` header verification using
   the auth-token. *Note (2026-05-14): SMS on prod is ATL (memory:
   `reference_sms_provider_atl.md`), and voip channel_configs on
   LeadDrive use 3CX. Twilio is dead-code-paths for this deployment.
   Re-prioritize if a future tenant onboards Twilio voip.*

4. **~~`/api/v1/calls/webhook/threecx`~~** — *closed 2026-05-14, commit
   pending*. `?secret=` query param now compared via
   `crypto.timingSafeEqual` with explicit length-mismatch reject. Was
   `!==` before; not a real network-latency attack vector but the fix
   was one helper call.

5. **In-memory rate-limit store** — resets on PM2 restart, doesn't
   share state across multiple Node processes. Migrate to Redis if the
   deployment topology grows beyond single-process PM2.

6. **Auth'd-write upload routes not yet rate-limited** —
   `contracts/[id]/files` POST, `admin/upload-logo` POST,
   `deals/[id]/send-email` POST. Low-frequency admin endpoints in
   normal use; not yet rate-limited because the surface is small and
   abuse vector is limited to authenticated org-staff. Sweep these
   together when adding the next batch — same per-user key shape as
   the May 14 batch (uploads GET / mtm-photos POST / email-templates
   upload).

7. **mtm/photos POST tenancy gap** — the route trusts
   `formData.agentId` on the write (`mtmPhoto.create:131` region)
   without verifying `agent.organizationId === orgId`. Independent of
   rate-limit; the May 14 fix sources the rate-limit key from JWT to
   stop attackers from evading the cap, but the write-path tenancy
   check still needs to land.

## Adding a new rate-limited endpoint

1. Pick the config that matches the threat model. If none fits, add a
   new entry to `RATE_LIMIT_CONFIG` with a commented justification for
   the threshold.
2. Derive the rate-limit key so two unrelated clients don't share a
   bucket. Prefer `<domain>:<caller-identity>:<ip-or-path>`.
3. If the endpoint bypasses the middleware auth flow, add the limit in
   `src/middleware.ts` before the bypass. Otherwise call
   `checkRateLimit` inside the handler.
4. Update the "Enforcement map" table above.
5. Write a test that exercises both the allow-path and the 429 path.

## References

- Implementation: [src/lib/rate-limit.ts](../src/lib/rate-limit.ts)
- Enforcement: [src/middleware.ts](../src/middleware.ts)
- Tests: [src/__tests__/rate-limit.test.ts](../src/__tests__/rate-limit.test.ts),
  [src/__tests__/lib-middleware.test.ts](../src/__tests__/lib-middleware.test.ts)
- Related commits: `b05ef00c` (API-key), `c08ef018` (webhooks)
