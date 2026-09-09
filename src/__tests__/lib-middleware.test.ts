import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock rate-limit before importing middleware
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (v: string) => `hash_${v.slice(0, 8)}`),
  RATE_LIMIT_CONFIG: {
    api: { maxRequests: 100, windowMs: 60000 },
    ai: { maxRequests: 20, windowMs: 60000 },
    public: { maxRequests: 10, windowMs: 60000 },
    apiKey: { maxRequests: 300, windowMs: 60000 },
    webhook: { maxRequests: 600, windowMs: 60000 },
    inboundReadiness: { maxRequests: 3600, windowMs: 60000 },
  },
}))

// Mock next-auth's `auth` wrapper — it wraps a callback that receives (req) with req.auth set.
// We simulate this by calling the callback directly.
vi.mock("@/lib/auth", () => ({
  auth: (cb: Function) => cb,
}))

import { checkRateLimit } from "@/lib/rate-limit"
import { NextRequest } from "next/server"

// We import the default export which, thanks to our mock, is the raw callback function.
import authMiddleware, { config } from "@/proxy"

/** Helper to build a NextRequest-like object that the middleware callback expects */
function makeReq(opts: {
  pathname?: string
  host?: string
  method?: string
  auth?: any
  headers?: Record<string, string>
  cookies?: Record<string, string>
}) {
  const pathname = opts.pathname ?? "/dashboard"
  const host = opts.host ?? "localhost"
  const origin = `http://${host}`
  const url = new URL(pathname, origin)

  const headersInit: Record<string, string> = {
    host,
    ...opts.headers,
  }

  const req = new NextRequest(url, {
    method: opts.method ?? "GET",
    headers: headersInit,
  })

  // Attach auth session (NextAuth middleware pattern)
  ;(req as any).auth = opts.auth ?? null

  // nextUrl is read-only on NextRequest, but it already equals `url`
  // Attach cookies helper
  if (opts.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      req.cookies.set(k, v)
    }
  }

  return req
}

/** Read a request-header override emitted by `NextResponse.next`. */
function forwardedRequestHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name.toLowerCase()}`)
}

function mobileBearer(agentId = "agent-1"): string {
  const payload = Buffer.from(JSON.stringify({ agentId }), "utf8").toString("base64url")
  return `Bearer header.${payload}.signature`
}

describe("middleware", async () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: rate limit allows
    vi.mocked(checkRateLimit).mockReturnValue(true)
    // Reset env so CRM_ONLY_MODE is effectively true for localhost tests
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://leaddrivecrm.org"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.leaddrivecrm.org"
  })

  // ─── Auth redirect ────────────────────────────────────────

  it("redirects unauthenticated users from /dashboard to /login", async () => {
    const req = makeReq({ pathname: "/dashboard", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
    expect(res.headers.get("location")).toContain("callbackUrl=%2Fdashboard")
  })

  it("redirects unauthenticated root '/' to /login", async () => {
    const req = makeReq({ pathname: "/", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  // ─── Public paths ─────────────────────────────────────────

  it("allows /login without authentication", async () => {
    const req = makeReq({ pathname: "/login", auth: null })
    const res = await authMiddleware(req)
    // Should pass through (200), not redirect
    expect(res.status).toBe(200)
    expect(forwardedRequestHeader(res, "x-request-pathname")).toBe("/login")
  })

  it("overwrites a spoofed request pathname with the actual URL path", async () => {
    const res = await authMiddleware(makeReq({
      pathname: "/portal/set-password",
      auth: null,
      headers: { "x-request-pathname": "/dashboard" },
    }))

    expect(res.status).toBe(200)
    expect(forwardedRequestHeader(res, "x-request-pathname")).toBe("/portal/set-password")
    expect(res.headers.get("x-request-pathname")).toBeNull()
  })

  it("allows /portal paths without authentication", async () => {
    const req = makeReq({ pathname: "/portal/tickets", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
  })

  it("matches public routes on segment boundaries", async () => {
    const publicContact = await authMiddleware(makeReq({ pathname: "/contact", auth: null }))
    expect(publicContact.status).toBe(200)

    // `/contact` is public marketing, but `/contacts` is the authenticated CRM
    // workspace. A loose startsWith used to make Chrome deny its microphone.
    const contacts = await authMiddleware(makeReq({ pathname: "/contacts", auth: null }))
    expect(contacts.status).toBe(307)
    expect(contacts.headers.get("location")).toContain("/login")
    expect(contacts.headers.get("location")).toContain("callbackUrl=%2Fcontacts")

    const contactLookalike = await authMiddleware(makeReq({ pathname: "/contact-us", auth: null }))
    expect(contactLookalike.status).toBe(307)
  })

  it.each([
    "/contacts/foo.png",
    "/leads/foo.svg",
    "/tickets/foo.jpg",
  ])("does not let a file-like dynamic CRM id bypass the auth matcher: %s", async (pathname) => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)
    expect(matcher.test(pathname)).toBe(true)

    const response = await authMiddleware(makeReq({ pathname, auth: null }))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/login")
  })

  it.each([
    "/marketing/crm-dashboard.png",
    "/icons/icon-192.png",
    "/wallpapers/alpine-v3.mp4",
    "/uploads/contracts/document.pdf",
    "/favicon.ico",
  ])("keeps only a concrete public asset path outside the auth matcher: %s", (pathname) => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)
    expect(matcher.test(pathname)).toBe(false)
  })

  it("allows /api/health without authentication", async () => {
    const req = makeReq({ pathname: "/api/health", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
  })

  it.each([
    ["app.leaddrivecrm.org", "/login"],
    ["localhost", "/api/health"],
  ])("strips a caller-supplied tenant slug on non-tenant host %s", async (host, pathname) => {
    const res = await authMiddleware(makeReq({
      pathname,
      host,
      auth: null,
      headers: { "x-tenant-slug": "victim-tenant" },
    }))

    expect(res.status).toBe(200)
    expect(forwardedRequestHeader(res, "x-tenant-slug")).toBeNull()
    expect(res.headers.get("x-tenant-slug")).toBeNull()
  })

  it("overwrites a spoofed tenant slug from the hostname in every forwarding branch", async () => {
    const cases: Array<{
      pathname: string
      auth: any
      extraHeaders?: Record<string, string>
    }> = [
      { pathname: "/login", auth: null },
      { pathname: "/api/health", auth: null },
      { pathname: "/events/demo/register", auth: null },
      { pathname: "/api/v1/mtm/status", auth: null },
      { pathname: "/api/v1/webhooks/whatsapp", auth: null },
      {
        pathname: "/api/v1/private",
        auth: null,
        extraHeaders: { authorization: "Bearer ld_test-key" },
      },
      {
        pathname: "/dashboard",
        auth: {
          user: {
            id: "u1",
            organizationId: "org-afi",
            organizationSlug: "afigroup",
            role: "admin",
          },
        },
      },
    ]

    for (const testCase of cases) {
      const res = await authMiddleware(makeReq({
        pathname: testCase.pathname,
        host: "afigroup.leaddrivecrm.org",
        auth: testCase.auth,
        headers: { "x-tenant-slug": "victim-tenant", ...testCase.extraHeaders },
      }))

      expect(res.status).toBe(200)
      expect(forwardedRequestHeader(res, "x-tenant-slug")).toBe("afigroup")
      expect(res.headers.get("x-tenant-slug")).toBeNull()
    }
  })

  it("forwards request overrides without reflecting credentials into response headers", async () => {
    const res = await authMiddleware(makeReq({
      pathname: "/login",
      host: "afigroup.leaddrivecrm.org",
      auth: null,
      headers: {
        authorization: "Bearer secret-token",
        cookie: "authjs.session-token=secret-cookie",
        "x-tenant-slug": "spoofed-tenant",
        "x-request-pathname": "/dashboard",
      },
    }))

    expect(res.headers.get("authorization")).toBeNull()
    expect(res.headers.get("cookie")).toBeNull()
    expect(forwardedRequestHeader(res, "authorization")).toBe("Bearer secret-token")
    expect(forwardedRequestHeader(res, "cookie")).toBe("authjs.session-token=secret-cookie")
    expect(forwardedRequestHeader(res, "x-tenant-slug")).toBe("afigroup")
    expect(forwardedRequestHeader(res, "x-request-pathname")).toBe("/login")
  })

  it.each([
    ["public", "/login", null, "Bearer route-token"],
    ["health", "/api/health", null, "Bearer route-token"],
    ["event registration", "/events/demo/register", null, "Bearer route-token"],
    ["MTM", "/api/v1/mtm/status", null, "Bearer route-token"],
    ["webhook", "/api/v1/webhooks/whatsapp", null, "Bearer route-token"],
    ["API key", "/api/v1/private", null, "Bearer ld_test-key"],
    [
      "authenticated",
      "/dashboard",
      {
        user: {
          id: "verified-user",
          organizationId: "verified-org",
          role: "admin",
        },
      },
      "Bearer route-token",
    ],
  ] as const)(
    "keeps caller headers request-only in the %s forwarding branch",
    async (_branch, pathname, auth, authorization) => {
      const callerHeaders = {
        host: "app.leaddrivecrm.org",
        "user-agent": "pentest-reflection-probe/1.0",
        "x-forwarded-for": "198.51.100.77",
        "x-pentest-reflection-probe": "must-remain-request-only",
        authorization,
        cookie: "authjs.session-token=caller-cookie",
        "x-tenant-slug": "spoofed-tenant",
        "x-request-pathname": "/spoofed",
        "x-user-id": "spoofed-user",
        "x-user-role": "superadmin",
        "x-organization-id": "spoofed-org",
        "x-nonce": "spoofed-nonce",
      }
      const res = await authMiddleware(makeReq({
        pathname,
        host: callerHeaders.host,
        auth,
        headers: callerHeaders,
      }))

      expect(res.status).toBe(200)

      // NextResponse.next must preserve ordinary caller headers for the route
      // through request overrides, never by putting them on the raw response.
      for (const name of [
        "host",
        "user-agent",
        "x-forwarded-for",
        "x-pentest-reflection-probe",
        "authorization",
        "cookie",
      ] as const) {
        expect(res.headers.get(name)).toBeNull()
        expect(forwardedRequestHeader(res, name)).toBe(callerHeaders[name])
      }

      // Caller-provided internal identity is never forwarded. The final
      // authenticated branch replaces it exclusively with verified session
      // state; unauthenticated forwarding branches receive no such identity.
      for (const name of [
        "x-tenant-slug",
        "x-user-id",
        "x-user-role",
        "x-organization-id",
      ] as const) {
        expect(res.headers.get(name)).toBeNull()
      }
      expect(forwardedRequestHeader(res, "x-tenant-slug")).toBeNull()
      expect(forwardedRequestHeader(res, "x-request-pathname")).toBe(pathname)
      if (auth) {
        expect(forwardedRequestHeader(res, "x-user-id")).toBe("verified-user")
        expect(forwardedRequestHeader(res, "x-user-role")).toBe("admin")
        expect(forwardedRequestHeader(res, "x-organization-id")).toBe("verified-org")
      } else {
        expect(forwardedRequestHeader(res, "x-user-id")).toBeNull()
        expect(forwardedRequestHeader(res, "x-user-role")).toBeNull()
        expect(forwardedRequestHeader(res, "x-organization-id")).toBeNull()
      }

      // x-nonce is a legitimate server-generated CSP header, but the caller's
      // spoofed value must survive neither request sanitization nor response.
      expect(res.headers.get("x-nonce")).not.toBe("spoofed-nonce")
      expect(forwardedRequestHeader(res, "x-nonce")).not.toBe("spoofed-nonce")
    },
  )

  it("blocks a superadmin session from operating on another tenant subdomain", async () => {
    const req = makeReq({
      pathname: "/mtm/routes",
      host: "mars.leaddrivecrm.org",
      auth: {
        user: {
          id: "superadmin-1",
          role: "superadmin",
          organizationSlug: "leaddrive",
          organizationId: "org-leaddrive",
        },
      },
    })

    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://mars.leaddrivecrm.org/login?error=cross-tenant")
    expect(res.headers.get("set-cookie")).toContain("authjs.session-token=;")
  })

  it("allows /manifest.json without authentication", async () => {
    const req = makeReq({ pathname: "/manifest.json", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
  })

  it("allows /sw.js without authentication so the service worker can update", async () => {
    const req = makeReq({ pathname: "/sw.js", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
  })

  it("does not treat manifest-like paths as public", async () => {
    const req = makeReq({ pathname: "/manifest.json.bak", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  // ─── Header injection ─────────────────────────────────────

  it("injects x-organization-id, x-user-id, x-user-role for authenticated users", async () => {
    const session = {
      user: { id: "u1", organizationId: "org-42", role: "admin" },
    }
    const req = makeReq({ pathname: "/dashboard", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(forwardedRequestHeader(res, "x-organization-id")).toBe("org-42")
    expect(forwardedRequestHeader(res, "x-user-id")).toBe("u1")
    expect(forwardedRequestHeader(res, "x-user-role")).toBe("admin")
  })

  it("injects x-nonce header", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "viewer" } }
    const req = makeReq({ pathname: "/dashboard", auth: session })
    const res = await authMiddleware(req)
    expect(forwardedRequestHeader(res, "x-nonce")).toBeTruthy()
  })

  it("allows same-origin camera access only on the loyalty POS scanner", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "superadmin" } }

    const posResponse = await authMiddleware(makeReq({ pathname: "/loyalty/pos", auth: session }))
    expect(posResponse.headers.get("permissions-policy")).toBe(
      "camera=(self), microphone=(self), geolocation=()",
    )

    const dashboardResponse = await authMiddleware(makeReq({ pathname: "/dashboard", auth: session }))
    expect(dashboardResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )
  })

  // The persistent voice orb is mounted across the authenticated dashboard,
  // so every signed-in app page needs the same microphone policy.
  it("allows the microphone across the authenticated app", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "superadmin" } }

    const voiceResponse = await authMiddleware(makeReq({ pathname: "/ai/voice", auth: session }))
    expect(voiceResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )

    // Nested paths under the console keep the grant …
    const nestedResponse = await authMiddleware(makeReq({ pathname: "/ai/voice/history", auth: session }))
    expect(nestedResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )

    // A sibling dashboard page gets the same persistent-orb grant.
    const siblingResponse = await authMiddleware(makeReq({ pathname: "/ai/voicemail", auth: session }))
    expect(siblingResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )

    // Public `/contact` must not capture the authenticated `/contacts` route.
    // A top-level load on this page defines Chrome's document permission for
    // every later SPA navigation, so this exact response must opt in.
    const contactsResponse = await authMiddleware(makeReq({ pathname: "/contacts", auth: session }))
    expect(contactsResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )

    // /inbox also hosts the same signed-in app shell.
    const inboxResponse = await authMiddleware(makeReq({ pathname: "/inbox", auth: session }))
    expect(inboxResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=()",
    )

    // API responses must never carry the grant, even under the same prefix.
    const apiResponse = await authMiddleware(makeReq({ pathname: "/api/v1/ai/voice/session", auth: session }))
    expect(apiResponse.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    )
  })

  // ─── Rate limiting ────────────────────────────────────────

  it("returns 429 when auth rate limit is exceeded on POST /login", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({ pathname: "/login", method: "POST", auth: null })
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
  })

  it("does not rate-limit GET requests on auth paths", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({ pathname: "/login", method: "GET", auth: null })
    const res = await authMiddleware(req)
    // GET on /login is a public path, should pass through (200)
    expect(res.status).toBe(200)
  })

  it("rate-limits public portal login before the public-path early return", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({
      pathname: "/api/v1/public/portal-auth",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "203.0.113.10" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe("public:203.0.113.10")
  })

  it("isolates public buckets by the client IP supplied by a trusted Cloudflare peer", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)

    for (const client of ["203.0.113.20", "203.0.113.21"]) {
      const res = await authMiddleware(makeReq({
        pathname: "/api/v1/public/portal-auth",
        method: "POST",
        auth: null,
        headers: {
          "x-real-ip": "173.245.48.10",
          "cf-connecting-ip": client,
        },
      }))
      expect(res.status).toBe(200)
    }

    expect(vi.mocked(checkRateLimit).mock.calls.map((call) => call[0])).toEqual([
      "public:203.0.113.20",
      "public:203.0.113.21",
    ])
  })

  it("rate-limits public GET endpoints before the public-path early return", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const res = await authMiddleware(makeReq({
      pathname: "/api/v1/public/catalog",
      method: "GET",
      auth: null,
      headers: { "x-real-ip": "203.0.113.30" },
    }))

    expect(res.status).toBe(429)
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe("pub-get:203.0.113.30")
  })

  it("allows unauthenticated password recovery API routes", async () => {
    const forgot = await authMiddleware(makeReq({ pathname: "/api/v1/auth/forgot-password", method: "POST", auth: null }))
    const reset = await authMiddleware(makeReq({ pathname: "/api/v1/auth/reset-password", method: "POST", auth: null }))
    expect(forgot.status).toBe(200)
    expect(reset.status).toBe(200)
  })

  // ─── 2FA enforcement ──────────────────────────────────────

  it("redirects to /login/verify-2fa when needs2fa is set", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "admin", needs2fa: true } }
    const req = makeReq({ pathname: "/dashboard", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login/verify-2fa")
  })

  it("redirects to /login/setup-2fa when needsSetup2fa is set", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "admin", needsSetup2fa: true } }
    const req = makeReq({ pathname: "/dashboard", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login/setup-2fa")
  })

  // ─── Admin-only settings ──────────────────────────────────

  it("redirects non-admin from /settings/roles to root", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "viewer" } }
    const req = makeReq({ pathname: "/settings/roles", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/\/$/)
  })

  it("allows admin to access /settings/security", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "admin" } }
    const req = makeReq({ pathname: "/settings/security", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
  })

  // ─── Authenticated root redirect ─────────────────────────

  it("redirects authenticated '/' to /dashboard", async () => {
    const session = { user: { id: "u1", organizationId: "org-1", role: "admin" } }
    const req = makeReq({ pathname: "/", auth: session })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/dashboard")
  })

  // ─── Webhook rate-limiting ───────────────────────────────

  it("allows webhook POST when rate limit is under threshold", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/webhooks/telegram",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "1.2.3.4" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
  })

  it("returns 429 when webhook rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({
      pathname: "/api/v1/webhooks/telegram",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "9.9.9.9" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
  })

  it("keys webhook rate-limit by namespace and IP", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/webhooks/whatsapp",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "1.2.3.4" },
    })
    await authMiddleware(req)
    // First arg is the composed rate-limit key
    const keyArg = vi.mocked(checkRateLimit).mock.calls[0]?.[0]
    expect(keyArg).toBe("webhook:whatsapp:1.2.3.4")
  })

  it("does not apply webhook rate-limit to /api/v1/webhooks/manage (user CRUD)", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false) // would 429 if applied
    const session = { user: { id: "u1", organizationId: "org-1", role: "admin" } }
    const req = makeReq({
      pathname: "/api/v1/webhooks/manage",
      method: "GET",
      auth: session,
    })
    const res = await authMiddleware(req)
    // Reaches authenticated branch, not the webhook 429
    expect(res.status).not.toBe(429)
  })

  it("rate-limits /api/v1/calls/webhook with namespace 'calls'", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/calls/webhook",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "5.5.5.5" },
    })
    await authMiddleware(req)
    const keyArg = vi.mocked(checkRateLimit).mock.calls[0]?.[0]
    expect(keyArg).toBe("webhook:calls:5.5.5.5")
  })

  it("lets the 3CX caller lookup through without a session", async () => {
    // The PBX calls this on every ringing call and carries no session — a login
    // redirect here silently breaks caller identification.
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/calls/threecx/lookup",
      method: "GET",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(307)
    expect(res.headers.get("location")).toBeNull()
  })

  it("keeps the 3CX template download behind a session", async () => {
    // It hands out the integration secret — must never be public.
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/calls/threecx/template",
      method: "GET",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
  })

  it("rate-limits the 3CX caller lookup with namespace 'calls'", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/calls/threecx/lookup",
      method: "GET",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    await authMiddleware(req)
    const keyArg = vi.mocked(checkRateLimit).mock.calls[0]?.[0]
    expect(keyArg).toBe("webhook:calls:7.7.7.7")
  })

  it("lets the exact PBX voice runtime route reach bearer auth without a session", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/voice-agent/runtime-config",
      method: "GET",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe(
      "webhook:voice-agent-runtime:7.7.7.7",
    )
  })

  it("keeps paths adjacent to the PBX voice runtime route behind a session", async () => {
    const req = makeReq({
      pathname: "/api/internal/voice-agent/runtime-config/debug",
      method: "GET",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("lets only the exact no-call control-plane probe reach bearer auth", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/voice-agent/control-plane-test",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe(
      "webhook:voice-agent-runtime:7.7.7.7",
    )
  })

  it("keeps paths adjacent to the no-call control-plane probe behind a session", async () => {
    const req = makeReq({
      pathname: "/api/internal/voice-agent/control-plane-test/debug",
      method: "POST",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("lets only the exact signed PBX maintenance attestation reach bearer auth", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/voice-agent/maintenance-attestation",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
  })

  it("keeps adjacent PBX maintenance paths behind a session", async () => {
    const req = makeReq({
      pathname: "/api/internal/voice-agent/maintenance-attestation/debug",
      method: "POST",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("lets the exact PBX post-call route reach bearer auth without a session", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/voice-agent/call-result",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe(
      "webhook:voice-agent-runtime:7.7.7.7",
    )
  })

  it("lets the exact ordinary Asterisk lifecycle route reach bearer auth without a session", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/asterisk/call-lifecycle",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe(
      "webhook:voice-agent-runtime:7.7.7.7",
    )
  })

  it("keeps paths adjacent to the ordinary Asterisk lifecycle route behind a session", async () => {
    const req = makeReq({
      pathname: "/api/internal/asterisk/call-lifecycle/debug",
      method: "POST",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("lets the exact inbound browser-readiness route reach bearer auth without a session", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/internal/asterisk/inbound-browser-ready",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe(
      "webhook:asterisk-inbound-readiness:7.7.7.7",
    )
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[1]).toEqual({
      maxRequests: 3600,
      windowMs: 60000,
    })
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledTimes(1)
  })

  it("keeps paths adjacent to inbound browser readiness behind a session", async () => {
    const req = makeReq({
      pathname: "/api/internal/asterisk/inbound-browser-ready/debug",
      method: "POST",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("reports the dedicated readiness limit when that bucket is exhausted", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({
      pathname: "/api/internal/asterisk/inbound-browser-ready",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })

    const res = await authMiddleware(req)

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({
      error: "Webhook rate limit exceeded. Max 3600 req/min per source IP.",
    })
  })

  it("rate-limits /api/v1/calendar/feed with namespace 'calendar'", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/calendar/feed/abc123",
      method: "GET",
      auth: null,
      headers: { "x-real-ip": "6.6.6.6" },
    })
    await authMiddleware(req)
    const keyArg = vi.mocked(checkRateLimit).mock.calls[0]?.[0]
    expect(keyArg).toBe("webhook:calendar:6.6.6.6")
  })

  it("allows the exact Bright Data callback path to reach route-level bearer auth", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/api/v1/social/providers/bright-data/webhook",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[0]).toBe("webhook:bright-data:7.7.7.7")
  })

  it("does not expose paths adjacent to the Bright Data callback", async () => {
    const req = makeReq({
      pathname: "/api/v1/social/providers/bright-data/webhook/debug",
      method: "POST",
      auth: null,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("allows only the exact Facebook native worker paths to reach bearer auth", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(true)
    for (const pathname of [
      "/api/v1/social/providers/facebook-native-search/jobs",
      "/api/v1/social/providers/facebook-native-search/results",
    ]) {
      const res = await authMiddleware(makeReq({
        pathname,
        method: pathname.endsWith("/results") ? "POST" : "GET",
        auth: null,
        headers: { "x-real-ip": "8.8.8.8" },
      }))
      expect(res.status).toBe(200)
      expect(res.headers.get("location")).toBeNull()
    }
    expect(vi.mocked(checkRateLimit).mock.calls.map(call => call[0])).toEqual([
      "webhook:facebook-native-worker:8.8.8.8",
      "webhook:facebook-native-worker:8.8.8.8",
    ])

    const adjacent = await authMiddleware(makeReq({
      pathname: "/api/v1/social/providers/facebook-native-search/results/debug",
      method: "POST",
      auth: null,
    }))
    expect(adjacent.status).toBe(307)
    expect(adjacent.headers.get("location")).toContain("/login")
  })

  // ─── 429 structured logging ──────────────────────────────

  it("logs a [rate-limit-429] warning when auth POST rate-limit fires", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({
      pathname: "/login",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "7.7.7.7" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
    expect(warnSpy).toHaveBeenCalledWith(
      "[rate-limit-429] category=auth key=auth:7.7.7.7 path=/login",
    )
    warnSpy.mockRestore()
  })

  it("logs a [rate-limit-429] warning when webhook rate-limit fires", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const req = makeReq({
      pathname: "/api/v1/webhooks/telegram",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "8.8.8.8" },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
    expect(warnSpy).toHaveBeenCalledWith(
      "[rate-limit-429] category=webhook key=webhook:telegram:8.8.8.8 path=/api/v1/webhooks/telegram",
    )
    warnSpy.mockRestore()
  })

  it("does not log anything when rate-limit passes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(checkRateLimit).mockReturnValue(true)
    const req = makeReq({
      pathname: "/login",
      method: "POST",
      auth: null,
      headers: { "x-real-ip": "9.9.9.9" },
    })
    await authMiddleware(req)
    const rlLogs = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("[rate-limit-429]"),
    )
    expect(rlLogs).toHaveLength(0)
    warnSpy.mockRestore()
  })

  // ─── Cross-tenant binding ─────────────────────────────────
  //
  // Session cookie is shared across *.leaddrivecrm.org (COOKIE_DOMAIN).
  // Middleware must not let a user whose session is for tenant X operate
  // on tenant Y's subdomain — redirect to /login?error=cross-tenant and
  // clear the shared cookie.

  it("redirects to /login?error=cross-tenant when session org differs from subdomain slug", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const session = {
      user: {
        id: "u1",
        organizationId: "org-leaddrive",
        organizationSlug: "leaddrive",
        role: "admin",
      },
    }
    const req = makeReq({
      pathname: "/dashboard",
      host: "afigroup.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    const location = res.headers.get("location") || ""
    expect(location).toContain("/login")
    expect(location).toContain("error=cross-tenant")
    // Redirect should stay on the tenant subdomain (host), not bounce to app.
    expect(location).toContain("afigroup.leaddrivecrm.org")
    // Session cookie must be cleared so the user lands on /login fresh.
    const setCookie = res.headers.get("set-cookie") || ""
    expect(setCookie).toMatch(/authjs\.session-token=;/)
    // Structured warn for ops visibility.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[cross-tenant-block\] session-slug=leaddrive host-slug=afigroup/),
    )
    warnSpy.mockRestore()
  })

  it("allows access when session org slug matches subdomain slug", async () => {
    const session = {
      user: {
        id: "u1",
        organizationId: "org-afi",
        organizationSlug: "afigroup",
        role: "admin",
      },
    }
    const req = makeReq({
      pathname: "/dashboard",
      host: "afigroup.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
    expect(forwardedRequestHeader(res, "x-tenant-slug")).toBe("afigroup")
    expect(forwardedRequestHeader(res, "x-organization-id")).toBe("org-afi")
  })

  it("blocks superadmin when session org slug does not match subdomain slug", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const session = {
      user: {
        id: "u1",
        organizationId: "org-leaddrive",
        organizationSlug: "leaddrive",
        role: "superadmin",
      },
    }
    const req = makeReq({
      pathname: "/dashboard",
      host: "afigroup.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://afigroup.leaddrivecrm.org/login?error=cross-tenant")
    const crossTenantLogs = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("[cross-tenant-block]"),
    )
    expect(crossTenantLogs).toHaveLength(1)
    warnSpy.mockRestore()
  })

  it("blocks when session has no organizationSlug at all (old token)", async () => {
    // JWTs issued before the organizationSlug field existed lack the slug.
    // These must fail closed on tenant subdomains — safer to force re-login
    // than to risk cross-tenant leakage.
    const session = {
      user: { id: "u1", organizationId: "org-leaddrive", role: "admin" },
    }
    const req = makeReq({
      pathname: "/dashboard",
      host: "zeytunpharm.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("error=cross-tenant")
  })

  it("does not run cross-tenant check on the app subdomain", async () => {
    const session = {
      user: {
        id: "u1",
        organizationId: "org-leaddrive",
        organizationSlug: "leaddrive",
        role: "admin",
      },
    }
    const req = makeReq({
      pathname: "/dashboard",
      host: "app.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    // app.* is reserved — getOrgSubdomain returns null, no tenant binding check.
    expect(res.status).toBe(200)
  })

  it("does not run cross-tenant check on public paths (/login)", async () => {
    // User lands on tenant subdomain /login with a stale cross-tenant cookie.
    // /login itself must not redirect (else infinite loop). The cross-tenant
    // check only runs on authenticated paths.
    const session = {
      user: {
        id: "u1",
        organizationId: "org-leaddrive",
        organizationSlug: "leaddrive",
        role: "admin",
      },
    }
    const req = makeReq({
      pathname: "/login",
      host: "afigroup.leaddrivecrm.org",
      auth: session,
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(200)
  })

  // ── Module gating (central paid-feature gate for /api/v1/*) ──────────────
  it("403s an API request to a module the tenant hasn't enabled", async () => {
    const req = makeReq({
      pathname: "/api/v1/invoices",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager", plan: "tier-25", addons: [], modules: { core: true } } },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(403)
  })

  it("allows an API request when the module IS enabled", async () => {
    const req = makeReq({
      pathname: "/api/v1/invoices",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager", plan: "tier-25", addons: [], modules: { core: true, invoices: true } } },
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(403)
  })

  it("superadmin bypasses module gating", async () => {
    const req = makeReq({
      pathname: "/api/v1/invoices",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "superadmin", plan: "tier-25", addons: [], modules: { core: true } } },
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(403)
  })

  // MTM early-returns before the central gate, so it has its own field-suite gate.
  it("403s MTM API when the tenant has neither Route & Field nor Workforce HRM", async () => {
    const req = makeReq({
      pathname: "/api/v1/mtm/agents",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager", plan: "tier-25", addons: [], modules: { core: true } } },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(403)
  })

  it("allows MTM API when the mtm module is enabled", async () => {
    const req = makeReq({
      pathname: "/api/v1/mtm/agents",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager", plan: "tier-25", addons: [], modules: { core: true, mtm: true } } },
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(403)
  })

  it.each([
    ["Routes-only", { core: true, "route-field": true }],
    ["HRM-only", { core: true, "workforce-hrm": true }],
    ["both split capabilities", { core: true, "route-field": true, "workforce-hrm": true }],
  ])("admits %s sessions to the MTM compatibility namespace for an exact handler gate", async (_name, modules) => {
    const req = makeReq({
      pathname: "/api/v1/mtm/routes",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager", plan: "tier-25", addons: [], modules } },
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(403)
  })

  it("blocks a legacy MTM tenant after both split capabilities are soft-disabled", async () => {
    const req = makeReq({
      pathname: "/api/v1/mtm/routes",
      host: "app.leaddrivecrm.org",
      auth: {
        user: {
          id: "u1",
          organizationId: "org-1",
          role: "manager",
          plan: "tier-25",
          addons: [],
          modules: { core: true, mtm: true, "route-field": false, "workforce-hrm": false },
        },
      },
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(403)
  })

  it("allows MTM API for a mobile/API-key caller (no session modules)", async () => {
    const req = makeReq({
      pathname: "/api/v1/mtm/agents",
      host: "app.leaddrivecrm.org",
      auth: null, // mobile JWT / API-key — gated by the route's own auth + scope
    })
    const res = await authMiddleware(req)
    expect(res.status).not.toBe(403)
  })

  it("allows a mobile JWT only on the reviewed v1/v2 MTM mobile paths", async () => {
    const authorization = mobileBearer()
    for (const pathname of ["/api/v1/mtm/mobile/sync/pull", "/api/v2/mtm/mobile/route-field/planning-targets"]) {
      const response = await authMiddleware(makeReq({
        pathname,
        host: "app.leaddrivecrm.org",
        auth: null,
        headers: { authorization },
      }))
      expect(response.status).toBe(200)
      expect(forwardedRequestHeader(response, "x-request-pathname")).toBe(pathname)
    }

    for (const pathname of [
      "/api/v2/contacts",
      "/api/v2/mtm/unknown",
      "/api/v2/mtm/mobile/unknown",
      "/api/v2/mtm/mobile/route-fieldx/planning-targets",
    ]) {
      const rejected = await authMiddleware(makeReq({
        pathname,
        host: "app.leaddrivecrm.org",
        auth: null,
        headers: { authorization },
      }))
      expect(rejected.status).toBe(401)
      expect(await rejected.json()).toMatchObject({ error: "Unauthorized" })
    }
  })

  it("P0: a PRESENT session with no `modules` claim is still blocked from a non-base paid module", async () => {
    // A stale/pre-materialisation cookie (session present but modules undefined)
    // must NOT blanket-bypass the gate. hasModule's undefined→BASE fallback
    // grants only base modules; mtm is not base → 403.
    const req = makeReq({
      pathname: "/api/v1/mtm/agents",
      host: "app.leaddrivecrm.org",
      auth: { user: { id: "u1", organizationId: "org-1", role: "manager" } }, // no modules
    })
    const res = await authMiddleware(req)
    expect(res.status).toBe(403)
  })
})
