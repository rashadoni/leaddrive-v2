import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
// Plan gating disabled — import kept for reference
// import { canAccessModule } from "@/lib/plan-config"
import { checkRateLimit, RATE_LIMIT_CONFIG, hashForRateLimit } from "@/lib/rate-limit"
import { resolveModuleFromPath, PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import { hasModule, MODULE_REGISTRY, type ModuleId } from "@/lib/modules"
import { isMtmApiPath } from "@/lib/mtm/mobile-api-path"
import { FIELD_TENANT_CAPABILITY_IDS, isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { resolveTenantLandingPath } from "@/lib/tenant-landing"
import { clientIp } from "@/lib/request-ip"

type SessionModuleGateUser = {
  role?: string
  plan?: string
  addons?: string[]
  modules?: Record<string, boolean>
} | null | undefined

/**
 * Whether a session-cookie caller is blocked from a module (the middleware
 * paid-feature gate). Reads the JWT-materialised `modules` off the NextAuth
 * session user — Edge-safe, no DB. Returns false (allow) when: superadmin, or
 * no `modules` present (an API-key/mobile caller — gated by the route's own
 * auth + scope, not here).
 */
function sessionModuleBlocked(authUser: SessionModuleGateUser, moduleId: ModuleId): boolean {
  // No session at all → an API-key/mobile caller (req.auth is null); their
  // access is enforced by the route's own auth + scope, not here. Superadmin
  // bypasses. We do NOT blanket-allow merely because `modules` is absent on a
  // PRESENT session — that would let a stale/pre-materialisation cookie reach
  // any paid module. Instead we pass `modules` straight to hasModule, giving the
  // SAME semantics as nav: `undefined` → BASE_PLAN_MODULES fallback (base only),
  // `{}` → alwaysOn/addons only, populated → authoritative.
  if (!authUser || authUser.role === "superadmin") return false
  return !hasModule(
    { plan: authUser.plan || "enterprise", addons: authUser.addons || [], modules: authUser.modules },
    moduleId,
  )
}

/**
 * The `/api/v1/mtm/*` namespace is a compatibility container, not one runtime
 * entitlement. Admit a session only when at least one field capability is
 * enabled (a historical `mtm` grant dual-reads as both capabilities). The
 * selected route's RLS wrapper then checks Route & Field or Workforce HRM
 * before loading data; unclassified compatibility endpoints keep their legacy
 * gate until their domain ownership is decided.
 */
function sessionMtmApiBlocked(authUser: SessionModuleGateUser): boolean {
  if (!authUser || authUser.role === "superadmin") return false
  const context = {
    plan: authUser.plan || "enterprise",
    addons: authUser.addons || [],
    modules: authUser.modules,
  }
  return !FIELD_TENANT_CAPABILITY_IDS.some((capabilityId) =>
    isTenantCapabilityEnabled(capabilityId, context),
  )
}

// NOTE: /api/v1/tracking/ is PUBLIC by design — email open-pixels and SMS/link
// click redirects are loaded by unauthenticated recipients (email clients, SMS).
// Without this, the auth middleware 307→/login and open/click/attribution silently
// under-count. The routes themselves are RLS-context-wrapped (runWithRlsBypass).
const publicPaths = ["/login", "/forgot-password", "/reset-password", "/api/auth", "/api/v1/auth/forgot-password", "/api/v1/auth/reset-password", "/api/v1/auth/sms-otp", "/api/v1/public", "/api/v1/ping", "/api/v1/sign/", "/api/v1/tracking/", "/sign/", "/ticket-closure/", "/portal", "/home", "/pricing", "/plans", "/features", "/demo", "/about", "/contact", "/blog", "/legal", "/landing", "/marketing", "/embed/", "/s/", "/widget.js", "/track.js", "/offline", "/c/", "/f/"]
const publicExactPaths = new Set(["/manifest.json", "/sw.js", "/unsubscribe"])

/**
 * Match a public route on a path-segment boundary.
 *
 * A raw `startsWith` made `/contact` match the authenticated CRM route
 * `/contacts`. Besides bypassing the middleware auth context, that response
 * received `Permissions-Policy: microphone=()`, so Chrome could render the
 * global voice orb while being forbidden from opening its microphone. Keep
 * public subtrees working, including entries written with a trailing slash,
 * without letting similarly named app routes inherit the public policy.
 */
function matchesPublicPath(pathname: string, configuredPath: string): boolean {
  const path = configuredPath.endsWith("/") && configuredPath !== "/"
    ? configuredPath.slice(0, -1)
    : configuredPath
  return pathname === path || pathname.startsWith(`${path}/`)
}
const BRIGHT_DATA_WEBHOOK_PATH = "/api/v1/social/providers/bright-data/webhook"
const FACEBOOK_NATIVE_WORKER_PATHS = new Set([
  "/api/v1/social/providers/facebook-native-search/jobs",
  "/api/v1/social/providers/facebook-native-search/results",
])

/**
 * Caller lookup the 3CX PBX calls on every ringing call — no session exists on
 * that side, so it has to bypass the login redirect. Gated at the route by the
 * per-org secret in the query string.
 *
 * Exact path on purpose: the sibling `/api/v1/calls/threecx/template` and
 * `/setup` hand out that same secret and MUST stay behind a session.
 */
const THREECX_LOOKUP_PATH = "/api/v1/calls/threecx/lookup"
// The PBX has no browser session. This exact route authenticates its bearer
// token in the handler, so middleware must not redirect it to /login.
const VOICE_AGENT_RUNTIME_CONFIG_PATH = "/api/internal/voice-agent/runtime-config"
const VOICE_AGENT_CALL_RESULT_PATH = "/api/internal/voice-agent/call-result"
// Same trust boundary as the prompt endpoint above: the PBX asks it which
// channel a customer came from and authenticates with the same bearer token in
// the handler. Membership here is exact-match, so a route added under
// /api/internal/voice-agent that is not listed is silently redirected to the
// login page and the PBX gets an HTML sign-in form where it expected JSON.
const VOICE_AGENT_CALL_SOURCE_PATH = "/api/internal/voice-agent/call-source"
const ASTERISK_HUMAN_CALL_LIFECYCLE_PATH = "/api/internal/asterisk/call-lifecycle"
const ASTERISK_INBOUND_BROWSER_READY_PATH = "/api/internal/asterisk/inbound-browser-ready"
// The relay asks this one whether a browser's parking ticket is genuine; it
// authenticates with a shared secret header and never sees a session cookie.
// Omitted when the softphone shipped, and the omission is invisible from the
// outside: the relay got a 307 to the sign-in page, read it as "ticket not
// verified", and refused the browser. The station had already answered and
// parked, so a real call connected and then sat in silence in BOTH directions
// until it timed out. Measured on production 2026-08-25.
const SOFTPHONE_VERIFY_TICKET_PATH = "/api/internal/softphone/verify-ticket"
// Same omission, different feature: the PBX posts here to ask whether a call
// should be continued, and has been getting the sign-in page instead.
const VOICE_AGENT_CALL_CONTINUATION_PATH = "/api/internal/voice-agent/call-continuation"
const VOICE_AGENT_INTERNAL_PATHS = new Set([
  "/api/internal/voice-agent/control-plane-test",
  "/api/internal/voice-agent/maintenance-attestation",
  VOICE_AGENT_RUNTIME_CONFIG_PATH,
  VOICE_AGENT_CALL_RESULT_PATH,
  VOICE_AGENT_CALL_SOURCE_PATH,
  ASTERISK_HUMAN_CALL_LIFECYCLE_PATH,
  ASTERISK_INBOUND_BROWSER_READY_PATH,
  SOFTPHONE_VERIFY_TICKET_PATH,
  VOICE_AGENT_CALL_CONTINUATION_PATH,
])

// Marketing-only paths served on leaddrivecrm.org
const marketingPaths = ["/home", "/pricing", "/plans", "/features", "/demo", "/about", "/contact", "/blog", "/legal", "/landing", "/marketing"]

// Hostnames for domain-based routing (from env or defaults)
function getMarketingHosts(): string[] {
  const url = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return [host, `www.${host}`]
}
function getAppHosts(): string[] {
  const url = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return [host, `www.${host}`]
}
const MARKETING_HOSTS = getMarketingHosts()
const APP_HOSTS = getAppHosts()
// When app and marketing share the same domain, disable marketing routing (CRM-only mode)
const CRM_ONLY_MODE = MARKETING_HOSTS[0] === APP_HOSTS[0]

function isMarketingHost(host: string): boolean {
  return MARKETING_HOSTS.includes(host)
}

function isAppHost(host: string): boolean {
  return APP_HOSTS.includes(host)
}

function isMarketingPath(pathname: string): boolean {
  return marketingPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

// Tenant Builder: subdomain routing for {slug}.leaddrivecrm.org
// The helper + reserved list live in src/lib/tenant-domain.ts so the
// login form parses subdomains identically (F-36).
import { getOrgSubdomain } from "@/lib/tenant-domain"

// Paths that should be rate-limited more aggressively
const RATE_LIMITED_PATHS = ["/api/auth", "/login", "/forgot-password", "/api/v1/auth/forgot-password", "/api/v1/auth/reset-password", "/api/v1/auth/2fa", "/api/v1/auth/totp", "/api/v1/auth/verify-2fa", "/api/v1/auth/verify-sms-2fa", "/api/v1/auth/resend-sms-2fa", "/api/v1/auth/sms-otp", "/api/v1/auth/sms-2fa", "/api/v1/mtm/mobile/auth"]

// CSP policy lives in src/lib/csp.ts (unit-testable, see tests)
import { buildCsp, CSP_REPORT_URI, type FrameAncestorsMode } from "@/lib/csp"

// Paths that are allowed to be embedded in same-origin iframes (e.g. invoice preview)
const IFRAME_ALLOWED_PATHS = ["/api/v1/invoices/"]

function isIframeAllowedPath(pathname: string): boolean {
  return IFRAME_ALLOWED_PATHS.some((p) => pathname.startsWith(p) && (pathname.includes("/pdf") || pathname.includes("/act")))
}

// Paths embeddable from ANY origin (web chat widget on customer sites).
// allowedOrigins whitelist is still enforced at the API layer (session/message endpoints).
const CROSS_ORIGIN_EMBEDDABLE = ["/embed/chat/"]

function isCrossOriginEmbeddable(pathname: string): boolean {
  return CROSS_ORIGIN_EMBEDDABLE.some(p => pathname.startsWith(p))
}

// Microphone (voice control of the CRM).
//
// This used to be a one-path allowlist (`/ai/voice`) because the console lived
// on its own page. The voice orb is now mounted in the dashboard layout so it
// can follow the user across sections, which means the grant has to cover the
// whole signed-in app. That IS a widening — stated plainly rather than buried.
//
// What keeps it bounded is where the flag is set, not a path list: it is passed
// only from the final authenticated app response in this file. Marketing pages,
// /embed widgets, public routes, login and every redirect keep microphone=()
// because those branches return earlier and never pass it. A path list would
// have had to enumerate the entire (dashboard) route group and would silently
// grant any new public path that happened to match a prefix.
const MIC_DENIED_APP_PATHS = ["/embed", "/portal"]

function isMicAllowedInApp(pathname: string): boolean {
  return !MIC_DENIED_APP_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

// Apply CSP + nonce headers to any response
function withCspHeaders(response: NextResponse, nonce: string, allowSameOriginFrame = false, pathname?: string, cspReportOnly = false, micAllowed = false): NextResponse {
  response.headers.set("x-nonce", nonce)
  // XSS hardening — Phase 2 (ENFORCE, 2026-07-17). Report-Only ran 2026-07-08
  // → 07-17; the violation review + allowlist decisions are documented in
  // src/lib/csp.ts. The marketing host stays Report-Only (cspReportOnly=true)
  // until Cloudflare Email Obfuscation stops injecting a nonce-less script
  // there. report-uri stays on after enforce so regressions keep surfacing in
  // the [csp-report] log; it is a relative path so it resolves to each host's
  // own origin (app / marketing / tenant subdomains).
  const crossOriginEmbeddable = !!pathname && isCrossOriginEmbeddable(pathname)
  const frameAncestors: FrameAncestorsMode = crossOriginEmbeddable ? "omit" : allowSameOriginFrame ? "self" : "none"
  // /sw.js gets NO CSP header: a CSP delivered with a worker script governs
  // the WORKER itself, and serwist's defaultCache has a cross-origin catch-all
  // (`!sameOrigin` → NetworkFirst) that re-issues page subresource requests
  // through worker fetch(). Enforcing our connect-src on the worker would
  // silently break every cross-origin image/font the pages legitimately load
  // under img-src https:. The worker is first-party static code (built from
  // src/sw.ts, no eval / importScripts), and page policies are unaffected.
  if (pathname !== "/sw.js") {
    response.headers.set(
      cspReportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      buildCsp(nonce, frameAncestors),
    )
  }
  if (crossOriginEmbeddable) {
    // Widget iframes — no X-Frame-Options and no frame-ancestors: embeddable
    // from any origin. The allowedOrigins whitelist is enforced at the API
    // layer (session/message endpoints), not by frame policy.
  } else if (allowSameOriginFrame) {
    // Embeddable HTML (e.g. invoice preview): same-origin iframe only.
    response.headers.set("X-Frame-Options", "SAMEORIGIN")
  } else {
    response.headers.set("X-Frame-Options", "DENY")
  }
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("X-XSS-Protection", "1; mode=block")
  const cameraPolicy = pathname === "/loyalty/pos" ? "camera=(self)" : "camera=()"
  // `pathname` is optional here — 29 of the 31 call sites omit it (marketing-host
  // redirects among them), so the guard is what keeps this from throwing on
  // `undefined`, exactly like crossOriginEmbeddable above.
  // Default deny. Only the signed-in app response opts in, so every other
  // branch — marketing, public, login, redirects — stays microphone=().
  const micPolicy =
    micAllowed && !!pathname && isMicAllowedInApp(pathname) ? "microphone=(self)" : "microphone=()"
  response.headers.set("Permissions-Policy", `${cameraPolicy}, ${micPolicy}, geolocation=()`)
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  return response
}

// Structured one-line warning every time a 429 is returned. Format is grep-
// friendly so operators can tail PM2 logs and spot abuse patterns per
// category/key/path. The `key` field is already safe to log — keys are
// either IP-derived (public/auth/webhook) or SHA-256 truncated hashes
// (apikey) — never raw secrets.
function log429(category: string, key: string, pathname: string) {
  console.warn(`[rate-limit-429] category=${category} key=${key} path=${pathname}`)
}

/**
 * Build the request headers forwarded by middleware without trusting a
 * caller-supplied tenant context. `x-tenant-slug` is authoritative only when
 * it was derived from the request hostname above; app/marketing/localhost
 * requests must reach route handlers without that header at all.
 */
function trustedRequestHeaders(req: NextRequest, tenantSlug: string | null): Headers {
  const headers = new Headers(req.headers)
  // These are application-internal identity/context headers. Never forward a
  // caller's values: authenticated branches below re-inject only values derived
  // from verified server state, while API-key/public branches receive none.
  for (const name of [
    "x-request-pathname",
    "x-tenant-slug",
    "x-user-id",
    "x-user-role",
    "x-organization-id",
    "x-nonce",
  ]) headers.delete(name)
  headers.set("x-request-pathname", req.nextUrl.pathname)
  if (tenantSlug) headers.set("x-tenant-slug", tenantSlug)
  return headers
}

/** Forward sanitized headers to the route, never reflect them to the client. */
function nextWithTrustedTenant(req: NextRequest, tenantSlug: string | null): NextResponse {
  return NextResponse.next({ request: { headers: trustedRequestHeaders(req, tenantSlug) } })
}

const authMiddleware = auth(async (req) => {
  const { pathname } = req.nextUrl
  const nonce = crypto.randomUUID()
  const host = req.headers.get("host")?.replace(/:\d+$/, "").toLowerCase() || ""

  // Tenant subdomain routing: {slug}.leaddrivecrm.org → treat as app host with tenant context
  const tenantSlug = getOrgSubdomain(host)
  const isTenantSubdomain = !!tenantSlug

  // CSP is ENFORCED everywhere except the marketing host, which stays
  // Report-Only: Cloudflare Email Obfuscation parser-injects
  // /cdn-cgi/.../email-decode.min.js there without a nonce, and under
  // 'strict-dynamic' no host allowlist can permit it. Flip this once the CF
  // zone feature is disabled. (Marketing documents are only ever served via
  // the publicPaths branch below — every other branch returns redirects/JSON,
  // where the header name doesn't affect rendering.)
  const cspReportOnly = !CRM_ONLY_MODE && isMarketingHost(host)

  // Domain-based routing: leaddrivecrm.org serves marketing, app.leaddrivecrm.org serves CRM
  // In CRM_ONLY_MODE (same domain for app+marketing), skip marketing routing entirely
  if (!CRM_ONLY_MODE && isMarketingHost(host)) {
    // On marketing domain: "/" → /home
    if (pathname === "/") {
      return withCspHeaders(NextResponse.redirect(new URL(`${process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"}/home`)), nonce)
    }
    // On marketing domain: allow marketing paths + static assets + sw.js
    if (isMarketingPath(pathname) || pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname === "/sw.js" || pathname === "/manifest.json" || pathname === "/widget.js" || pathname.startsWith("/embed/") || pathname.startsWith("/s/")) {
      // Let it through — will be handled by publicPaths check below
    } else {
      // Non-marketing paths (dashboard, auth, etc.) → redirect to app subdomain
      const appUrl = new URL(`${process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"}${pathname}`)
      appUrl.search = req.nextUrl.search
      return withCspHeaders(NextResponse.redirect(appUrl), nonce)
    }
  }

  if (!CRM_ONLY_MODE && isAppHost(host)) {
    // On app domain: marketing paths → redirect to marketing domain
    if (isMarketingPath(pathname)) {
      const marketingUrl = new URL(`${process.env.NEXT_PUBLIC_MARKETING_URL || "https://leaddrivecrm.org"}${pathname}`)
      marketingUrl.search = req.nextUrl.search
      return withCspHeaders(NextResponse.redirect(marketingUrl), nonce)
    }
  }

  // Cross-tenant binding: the session cookie is shared across
  // *.leaddrivecrm.org (COOKIE_DOMAIN=.leaddrivecrm.org), so a user logged
  // into tenant X could land on tenant Y's subdomain and operate with X's
  // session, seeing their own org's data under Y's URL. Enforce that the
  // session's organizationSlug matches the subdomain slug. Runs BEFORE the
  // publicPaths bypass so tenant-domain binding is checked before any
  // intentionally public route is served.
  //
  // Exceptions:
  //   - Superadmin does NOT bypass tenant subdomain binding here. Cross-tenant
  //     inspection must happen through the admin surface on the app host, not
  //     by carrying a superadmin session onto another tenant's normal CRM URL.
  //   - Auth-related paths (login, OAuth callback, SMS-OTP etc.) must
  //     remain reachable so the user can re-authenticate after being
  //     kicked out. Without this the logout→/login redirect would loop.
  //   - Unauthenticated requests (no req.auth) fall through to the
  //     standard unauth redirect below; no cookie to clear.
  const AUTH_BYPASS_FOR_XTENANT = [
    "/login",
    "/api/auth",
    "/api/v1/auth",
    "/api/health",
    "/_next",
  ]
  const isXTenantAuthBypass = AUTH_BYPASS_FOR_XTENANT.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  )
  if (tenantSlug && req.auth && !isXTenantAuthBypass) {
    const xtSession = req.auth as any
    const xtSessionSlug = xtSession?.user?.organizationSlug as string | undefined
    if (xtSessionSlug !== tenantSlug) {
      const proto = req.headers.get("x-forwarded-proto") || "https"
      const loginUrl = new URL("/login", `${proto}://${host}`)
      loginUrl.searchParams.set("error", "cross-tenant")
      const response = NextResponse.redirect(loginUrl)
      const cookieName = process.env.NODE_ENV === "production"
        ? "__Secure-authjs.session-token"
        : "authjs.session-token"
      response.cookies.set(cookieName, "", {
        expires: new Date(0),
        path: "/",
        domain: process.env.COOKIE_DOMAIN || undefined,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        httpOnly: true,
      })
      console.warn(
        `[cross-tenant-block] session-slug=${xtSessionSlug || "(none)"} host-slug=${tenantSlug} path=${pathname} user=${xtSession?.user?.id || "?"}`,
      )
      return withCspHeaders(response, nonce)
    }
  }

  // Rate limit auth-related endpoints
  if (RATE_LIMITED_PATHS.some((p) => pathname.startsWith(p)) && req.method === "POST") {
    const ip = clientIp(req)
    const key = `auth:${ip}`
    if (!checkRateLimit(key, RATE_LIMIT_CONFIG.public)) {
      log429("auth", key, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 }),
        nonce,
      )
    }
  }

  // Public token-authed e-sign signing portal: rate-limit (the HMAC token is the
  // auth; brute-force/abuse defense) then fall through to the publicPaths bypass.
  if (pathname.startsWith("/api/v1/sign/")) {
    const ip = clientIp(req)
    const signKey = `sign:${ip}`
    if (!checkRateLimit(signKey, RATE_LIMIT_CONFIG.api)) {
      log429("sign", signKey, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 }),
        nonce,
      )
    }
  }

  // CSP violation reports: rate-limit BEFORE the publicPaths bypass below
  // (which returns early for all of /api/v1/public/*). With enforce on, every
  // full page load POSTs ~1 report (webpack's benign globalThis-shim eval), so
  // the browser-driven volume needs its own generous bucket as a flood cap.
  if (pathname === CSP_REPORT_URI && req.method === "POST") {
    const ip = clientIp(req)
    const cspReportKey = `csp-report:${ip}`
    if (!checkRateLimit(cspReportKey, RATE_LIMIT_CONFIG.api)) {
      log429("csp-report", cspReportKey, pathname)
      return withCspHeaders(new NextResponse(null, { status: 429 }), nonce)
    }
  }

  // Rate limit public API POST endpoints (these bypass auth but must not bypass
  // rate limits). This must run BEFORE the public-path early return below.
  if (pathname.startsWith("/api/v1/public/") && req.method === "POST") {
    const ip = clientIp(req)

    // Stricter limit for AI chat (expensive)
    if (pathname.includes("/portal-chat")) {
      const key = `chat:${ip}`
      if (!checkRateLimit(key, RATE_LIMIT_CONFIG.ai)) {
        log429("chat", key, pathname)
        return withCspHeaders(
          NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 }),
          nonce,
        )
      }
    } else {
      // General public endpoint limit (leads, events, demo-request, etc.)
      const key = `public:${ip}`
      if (!checkRateLimit(key, RATE_LIMIT_CONFIG.public)) {
        log429("public-post", key, pathname)
        return withCspHeaders(
          NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 }),
          nonce,
        )
      }
    }
  }

  // Rate limit public API GET endpoints before the public-path bypass below;
  // otherwise enumeration requests return early without consuming a bucket.
  if (pathname.startsWith("/api/v1/public/") && req.method === "GET") {
    const ip = clientIp(req)
    const key = `pub-get:${ip}`
    if (!checkRateLimit(key, RATE_LIMIT_CONFIG.api)) {
      log429("public-get", key, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Too many requests" }, { status: 429 }),
        nonce,
      )
    }
  }

  // Allow public paths
  if (publicExactPaths.has(pathname) || publicPaths.some((p) => matchesPublicPath(pathname, p))) {
    const requestHeaders = trustedRequestHeaders(req, tenantSlug)
    requestHeaders.set("x-nonce", nonce)
    // Inject locale for i18n on public/marketing pages
    const localeCookie = req.cookies.get("NEXT_LOCALE")?.value
    if (localeCookie) {
      requestHeaders.set("x-locale", localeCookie)
    }
    return withCspHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
      false,
      pathname,
      cspReportOnly,
    )
  }

  // Allow health check
  if (pathname === "/api/health") {
    return withCspHeaders(nextWithTrustedTenant(req, tenantSlug), nonce)
  }

  // Allow public event registration pages
  if (/^\/events\/[^/]+\/register/.test(pathname)) {
    const requestHeaders = trustedRequestHeaders(req, tenantSlug)
    requestHeaders.set("x-nonce", nonce)
    return withCspHeaders(NextResponse.next({ request: { headers: requestHeaders } }), nonce)
  }

  // Authenticated AI-cost endpoints: each call burns paid upstream
  // tokens (Whisper ~$0.018/call, Anthropic for analyze). Without
  // a per-source bucket, a compromised session can burn a budget
  // fast. IP-keyed because the session JWT isn't easily decoded at
  // middleware layer; ai bucket = 20 req/min.
  if (/^\/api\/v1\/calls\/[^/]+\/(transcribe|analyze)\b/.test(pathname) && req.method === "POST") {
    const ip = clientIp(req)
    const key = `ai-calls:${ip}`
    if (!checkRateLimit(key, RATE_LIMIT_CONFIG.ai)) {
      log429("ai-calls", key, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Too many transcription requests. Please try again later." }, { status: 429 }),
        nonce,
      )
    }
  }

  // T8 Cobrowse signaling: WebRTC ICE trickle bursts demand a
  // dedicated bucket (see RATE_LIMIT_CONFIG.cobrowseSignal). Agent
  // side keyed by the session id from the URL; customer side by
  // joinToken hash from the body (cheap parse via clone) — but
  // body access in middleware is async + complex, so for slice-2b
  // we key the customer side by IP and let the per-IP cap absorb
  // typical home/office network egress. Slice-2c can move to a
  // token-keyed bucket if necessary.
  if (/^\/api\/v1\/cobrowse\/sessions\/[^/]+\/signal$/.test(pathname) && req.method === "POST") {
    const sessionId = pathname.split("/")[5] || "unknown"
    const key = `cobrowse-sig-agent:${sessionId}`
    if (!checkRateLimit(key, RATE_LIMIT_CONFIG.cobrowseSignal)) {
      log429("cobrowse-signal", key, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Cobrowse signal rate limit exceeded." }, { status: 429 }),
        nonce,
      )
    }
  }
  if (pathname === "/api/v1/public/cobrowse/signal" && req.method === "POST") {
    const ip = clientIp(req)
    const key = `cobrowse-sig-cust:${ip}`
    if (!checkRateLimit(key, RATE_LIMIT_CONFIG.cobrowseSignal)) {
      log429("cobrowse-signal", key, pathname)
      return withCspHeaders(
        NextResponse.json({ error: "Cobrowse signal rate limit exceeded." }, { status: 429 }),
        nonce,
      )
    }
  }

  // SECURITY (FIX 4): defense-in-depth mobile-token scope guard.
  // If the Authorization header contains a Bearer token that decodes (without
  // DB verification) as a mobile JWT (has `agentId` claim), and the path is NOT
  // under an explicit versioned MTM namespace, reject immediately with 401.
  // This is a SECONDARY guard — FIX 1 (requireAuth) and FIX 2 (getOrgId) are
  // the primary enforcement. This layer catches any route that neither calls
  // requireAuth nor getOrgId but receives a raw mobile Bearer token.
  // We deliberately do NOT do a heavy DB re-check here (Edge runtime, no prisma)
  // — a best-effort JWT decode is sufficient for this defense-in-depth layer.
  //
  // EDGE SAFETY: Buffer.from(..., "base64url") is a Node.js API NOT available in
  // the Edge runtime — calling it here would throw and the catch would fail open.
  // We use atob() (available in Edge/browser globals) after converting base64url
  // to standard base64 (replace `-`→`+`, `_`→`/`, add `=` padding) instead.
  if (
    pathname.startsWith("/api/") &&
    !isMtmApiPath(pathname) &&
    !pathname.startsWith("/api/auth/") // exclude NextAuth callbacks
  ) {
    const authorizationHeader = req.headers.get("authorization")
    if (authorizationHeader?.startsWith("Bearer ") && !authorizationHeader.startsWith("Bearer ld_")) {
      // Best-effort decode — no signature verification (Edge-safe, no Node.js crypto).
      // Enough to detect the agentId claim that distinguishes mobile from web JWTs.
      try {
        const token = authorizationHeader.slice(7)
        const parts = token.split(".")
        if (parts.length === 3) {
          // Size guard: cap the base64-encoded payload segment to 8 kB to prevent
          // a crafted oversized token from causing excessive memory use in atob/JSON.parse.
          // A legitimate mobile JWT payload (agentId, userId, orgId, email, name, role)
          // is well under 1 kB when base64-encoded.
          if (parts[1].length <= 8192) {
            // Convert base64url → standard base64 (atob requires standard base64).
            const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(
              parts[1].length + (4 - (parts[1].length % 4)) % 4,
              "=",
            )
            const payloadJson = atob(b64)
            const payload = JSON.parse(payloadJson)
            // Only block if this is clearly a mobile JWT (carries agentId).
            // Web/session tokens, API keys (already excluded via ld_ prefix),
            // and other Bearer tokens do NOT have agentId → fall through normally.
            if (payload?.agentId) {
              console.warn(
                `[mobile-auth][middleware-reject] mobile JWT rejected on non-MTM path — agentId=${payload.agentId} path=${pathname}`
              )
              return withCspHeaders(
                NextResponse.json(
                  { error: "Unauthorized", message: "Mobile tokens are not permitted on this endpoint" },
                  { status: 401 },
                ),
                nonce,
              )
            }
          }
        }
      } catch {
        // Malformed JWT or decode error — let the route handler reject it.
      }
    }
  }

  // MTM API: mobile JWT + session auth are handled inside route handlers, and
  // this branch returns before the central /api/v1/* gate below. `isMtmApiPath`
  // preserves the v1 compatibility namespace and admits only reviewed v2
  // mobile handlers. Session callers need field-suite admission here; each
  // handler's capability wrapper remains the exact Route & Field / Workforce
  // boundary.
  if (isMtmApiPath(pathname)) {
    if (sessionMtmApiBlocked((req as any).auth?.user)) {
      return withCspHeaders(
        NextResponse.json(
          { error: "Forbidden", message: "No field capability is enabled for your organization." },
          { status: 403 },
        ),
        nonce,
      )
    }
    return withCspHeaders(nextWithTrustedTenant(req, tenantSlug), nonce)
  }

  // Rate-limit webhook source endpoints by client IP. Runs BEFORE signature
  // verification in the handlers — caps HMAC-verification CPU burn and naive
  // single-source flooding. Legitimate upstreams (Meta, Telegram, WhatsApp)
  // arrive from distributed IP ranges, so per-IP bucketing rarely affects
  // real traffic. The namespace per provider prevents one source's flood
  // from starving another.
  // Excludes /api/v1/webhooks/manage/* (authenticated user CRUD, not a webhook).
  const isWebhookManage =
    pathname === "/api/v1/webhooks/manage" || pathname.startsWith("/api/v1/webhooks/manage/")
  const isWebhookSource =
    (pathname.startsWith("/api/v1/webhooks/") && !isWebhookManage) ||
    pathname.startsWith("/api/v1/calls/webhook") ||
    pathname === THREECX_LOOKUP_PATH ||
    VOICE_AGENT_INTERNAL_PATHS.has(pathname) ||
    pathname.startsWith("/api/v1/calendar/feed/") ||
    pathname.startsWith("/api/v1/payment-webhooks/") ||
    pathname === BRIGHT_DATA_WEBHOOK_PATH ||
    FACEBOOK_NATIVE_WORKER_PATHS.has(pathname)
  if (isWebhookSource) {
    const ip = clientIp(req)
    let namespace = "other"
    let webhookLimit = RATE_LIMIT_CONFIG.webhook
    if (pathname.startsWith("/api/v1/webhooks/")) {
      namespace = pathname.split("/")[4] || "other"
    } else if (pathname.startsWith("/api/v1/calls/webhook") || pathname === THREECX_LOOKUP_PATH) {
      namespace = "calls"
    } else if (pathname === ASTERISK_INBOUND_BROWSER_READY_PATH) {
      namespace = "asterisk-inbound-readiness"
      webhookLimit = RATE_LIMIT_CONFIG.inboundReadiness
    } else if (VOICE_AGENT_INTERNAL_PATHS.has(pathname)) {
      namespace = "voice-agent-runtime"
    } else if (pathname.startsWith("/api/v1/calendar/feed/")) {
      namespace = "calendar"
    } else if (pathname.startsWith("/api/v1/payment-webhooks/")) {
      namespace = "payments"
    } else if (pathname === BRIGHT_DATA_WEBHOOK_PATH) {
      namespace = "bright-data"
    } else if (FACEBOOK_NATIVE_WORKER_PATHS.has(pathname)) {
      namespace = "facebook-native-worker"
    }
    const webhookKey = `webhook:${namespace}:${ip}`
    if (!checkRateLimit(webhookKey, webhookLimit)) {
      log429("webhook", webhookKey, pathname)
      return withCspHeaders(
        NextResponse.json(
          {
            error: `Webhook rate limit exceeded. Max ${webhookLimit.maxRequests} req/min per source IP.`,
          },
          { status: 429 },
        ),
        nonce,
      )
    }
  }

  // Allow public API (web-to-lead, calendar feed, journey processor, webhooks, payment webhooks).
  // Bright Data uses its route-level context-bound bearer secret; middleware
  // must let the exact callback path reach that verifier without opening the
  // surrounding social provider namespace.
  if (pathname.startsWith("/api/v1/public/") || pathname.startsWith("/api/v1/calendar/feed/") || pathname.startsWith("/api/v1/webhooks/") || pathname === "/api/v1/journeys/process" || pathname.startsWith("/api/v1/calls/webhook") || pathname === THREECX_LOOKUP_PATH || VOICE_AGENT_INTERNAL_PATHS.has(pathname) || pathname.startsWith("/api/v1/calls/twiml") || pathname.startsWith("/api/cron/") || pathname.startsWith("/api/v1/social/cron/") || pathname.startsWith("/api/v1/payment-webhooks/") || pathname === BRIGHT_DATA_WEBHOOK_PATH || FACEBOOK_NATIVE_WORKER_PATHS.has(pathname)) {
    return withCspHeaders(nextWithTrustedTenant(req, tenantSlug), nonce)
  }

  // API-key authenticated requests (Bearer ld_...) — rate-limit by hashed key BEFORE
  // bypassing session auth. Auth itself is verified in src/lib/api-auth.ts. A leaked
  // key would otherwise allow unbounded flooding until manual revocation.
  if (pathname.startsWith("/api/") && req.headers.get("authorization")?.startsWith("Bearer ld_")) {
    const apiKey = req.headers.get("authorization")!.slice("Bearer ".length)
    const keyHash = await hashForRateLimit(apiKey)
    const apiKeyLimitKey = `apikey:${keyHash}`
    if (!checkRateLimit(apiKeyLimitKey, RATE_LIMIT_CONFIG.apiKey)) {
      log429("apikey", apiKeyLimitKey, pathname)
      return withCspHeaders(
        NextResponse.json(
          { error: "API key rate limit exceeded. Max 300 req/min." },
          { status: 429 },
        ),
        nonce,
      )
    }
    return withCspHeaders(nextWithTrustedTenant(req, tenantSlug), nonce)
  }

  // Check authentication — unauthenticated users go to login
  if (!req.auth) {
    // For tenant subdomains, build redirect URL from Host header (not req.url which NextAuth
    // overrides with NEXTAUTH_URL). This keeps users on zeytunpharm.leaddrivecrm.org/login
    // instead of redirecting to app.leaddrivecrm.org/login.
    const proto = req.headers.get("x-forwarded-proto") || "https"
    const baseUrl = isTenantSubdomain ? `${proto}://${host}` : req.url

    if (pathname === "/") {
      return withCspHeaders(NextResponse.redirect(new URL("/login", baseUrl)), nonce)
    }
    const loginUrl = new URL("/login", baseUrl)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return withCspHeaders(NextResponse.redirect(loginUrl), nonce)
  }

  // 2FA enforcement — redirect to verify/setup if needed
  const session2fa = req.auth as any
  if (session2fa?.user?.needs2fa && !pathname.startsWith("/login/verify-2fa") && !pathname.startsWith("/api/")) {
    return withCspHeaders(NextResponse.redirect(new URL("/login/verify-2fa", req.url)), nonce)
  }
  if (session2fa?.user?.needsSetup2fa && !pathname.startsWith("/login/setup-2fa") && !pathname.startsWith("/api/")) {
    return withCspHeaders(NextResponse.redirect(new URL("/login/setup-2fa", req.url)), nonce)
  }

  // Redirect root to dashboard to avoid Next.js 16 standalone InvariantError on "/".
  // On tenant subdomains, req.url is normalised by NextAuth to NEXTAUTH_URL
  // (=app.leaddrivecrm.org), which would bounce authed tenant users off their
  // own subdomain onto the main app host. Rebuild the base URL from the Host
  // header so the client stays on {tenant}.leaddrivecrm.org/dashboard.
  if (pathname === "/") {
    const proto = req.headers.get("x-forwarded-proto") || "https"
    const baseUrl = isTenantSubdomain ? `${proto}://${host}` : req.url
    // Куда именно — решает стартовая страница тенанта: заданная суперадмином
    // либо первый доступный пункт меню. Жёсткий /dashboard упирался в гейт у
    // тенантов без модуля `crm` (напр. чистый соцмониторинг).
    const landing = resolveTenantLandingPath({
      plan: (req.auth as any)?.user?.plan || "enterprise",
      addons: (req.auth as any)?.user?.addons || [],
      modules: (req.auth as any)?.user?.modules,
      role: (req.auth as any)?.user?.role,
      landingPath: (req.auth as any)?.user?.landingPath,
    })
    return withCspHeaders(NextResponse.redirect(new URL(landing, baseUrl)), nonce)
  }

  // Inject organization context + nonce into headers for server components
  const session = req.auth as any
  const headers = trustedRequestHeaders(req, tenantSlug)
  headers.set("x-nonce", nonce)
  const orgId = session?.user?.organizationId
  const role = session?.user?.role
  const userId = session?.user?.id
  if (orgId) {
    headers.set("x-organization-id", String(orgId))
  }
  if (userId) {
    headers.set("x-user-id", String(userId))
  }
  if (role) {
    headers.set("x-user-role", String(role))
  }

  // Inject locale from cookie for i18n
  const localeCookie = req.cookies.get("NEXT_LOCALE")?.value
  if (localeCookie) {
    headers.set("x-locale", localeCookie)
  }

  // Admin-only settings routes (security-sensitive)
  const ADMIN_ONLY_SETTINGS = ["/settings/roles", "/settings/security", "/settings/billing"]
  if (ADMIN_ONLY_SETTINGS.some((p) => pathname === p || pathname.startsWith(p + "/")) && role !== "admin" && role !== "superadmin") {
    return withCspHeaders(NextResponse.redirect(new URL("/", req.url)), nonce)
  }

  // Module gating for API routes: block requests to a module the tenant hasn't
  // enabled. This is the CENTRAL gate that closes the leak where getSession/
  // getOrgId routes (which don't call requireAuth) skip the per-route module
  // check. Page routes are covered by the dashboard layout guard, so we gate
  // `/api/v1/*` only here. Uses the JWT's materialised modules
  // (session.user.modules) — Edge-safe, no DB. Skips: superadmin; callers with
  // no session modules (API-key/mobile — the route's own auth handles them);
  // public/webhook/auth paths already returned earlier; paths whose module can't
  // be resolved or isn't a real ModuleId (the bridge handles renamed ones).
  if (pathname.startsWith("/api/v1/")) {
    const resolved = resolveModuleFromPath(pathname)
    if (resolved) {
      const moduleId = (PERMISSION_MODULE_TO_MODULE_ID[resolved] ?? resolved) as ModuleId
      if (moduleId in MODULE_REGISTRY && sessionModuleBlocked(session?.user, moduleId)) {
        return withCspHeaders(
          NextResponse.json(
            { error: "Forbidden", message: `Module "${moduleId}" is not enabled for your organization.` },
            { status: 403 },
          ),
          nonce,
        )
      }
    }
  }

  return withCspHeaders(
    NextResponse.next({ request: { headers } }),
    nonce,
    isIframeAllowedPath(pathname),
    pathname,
    false,
    !pathname.startsWith("/api/"),
  )
}) as unknown as (req: NextRequest) => NextResponse

export default authMiddleware

export const config = {
  // Only concrete public asset namespaces and exact root assets bypass the
  // auth proxy. Never exempt an extension globally: dynamic dashboard routes
  // accept arbitrary `[id]` strings, so `/contacts/foo.png` is still a CRM
  // page and must be redirected when no session exists.
  //
  // F-41 uploads of every supported extension bypass this middleware only
  // under the exact `uploads/` root so the beforeFiles rewrite can reach the
  // authorization-aware `/api/v1/uploads/*` handler.
  // The proxy route itself requires a browser session for private paths and
  // permits anonymous reads only for its exact hardened email/logo namespace,
  // so this matcher bypass does not decide upload authorization.
  // `api/help-videos/*` is also bypassed because the route has its own filename whitelist
  // and streams local tutorial assets; otherwise mp4 Range requests are
  // redirected by auth before the video element can load metadata.
  matcher: [
    "/((?!_next/(?:static|image)(?:/|$)|api/help-videos(?:/|$)|uploads/.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|heic|pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)$|(?:icons|marketing|wallpapers|sounds|vendor)(?:/|$)|(?:favicon\\.ico|favicon\\.svg|favicon-32\\.png|apple-touch-icon\\.png|android-(?:192|512)\\.png|meta-app-icon-1024\\.png|file\\.svg|globe\\.svg|logo\\.svg|next\\.svg|vercel\\.svg|window\\.svg|leaflet\\.css|ldtrack\\.js|track\\.js|widget\\.js|robots\\.txt|sitemap\\.xml)$).*)",
  ],
}
