import { describe, it, expect, vi, beforeEach } from "vitest"

// Same middleware harness as lib-middleware.test.ts: mock rate-limit + auth
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (v: string) => `hash_${v.slice(0, 8)}`),
  RATE_LIMIT_CONFIG: {
    api: { maxRequests: 100, windowMs: 60000 },
    ai: { maxRequests: 20, windowMs: 60000 },
    public: { maxRequests: 10, windowMs: 60000 },
    apiKey: { maxRequests: 300, windowMs: 60000 },
    webhook: { maxRequests: 600, windowMs: 60000 },
  },
}))

vi.mock("@/lib/auth", () => ({
  auth: <T,>(cb: T): T => cb,
}))

import { checkRateLimit } from "@/lib/rate-limit"
import { NextRequest } from "next/server"
import { buildCsp } from "@/lib/csp"
import authMiddleware from "@/proxy"

type RequestWithAuth = NextRequest & { auth?: unknown }

function makeReq(opts: { pathname?: string; host?: string; auth?: unknown }) {
  const pathname = opts.pathname ?? "/dashboard"
  const host = opts.host ?? "localhost"
  const url = new URL(pathname, `http://${host}`)
  const req = new NextRequest(url, { method: "GET", headers: { host } }) as RequestWithAuth
  req.auth = opts.auth ?? null
  return req
}

describe("buildCsp policy content", () => {
  const nonce = "test-nonce-123"
  const csp = buildCsp(nonce)
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? ""

  it("keeps the script nonce + strict-dynamic", () => {
    expect(directive("script-src")).toContain(`'nonce-${nonce}'`)
    expect(directive("script-src")).toContain("'strict-dynamic'")
  })

  it("does not retain the retired ElevenLabs browser origins", () => {
    expect(directive("connect-src")).not.toContain("elevenlabs.io")
  })

  it("has NO nonce in style-src (nonce would make browsers ignore unsafe-inline)", () => {
    expect(directive("style-src")).not.toContain("nonce")
    expect(directive("style-src")).toContain("'unsafe-inline'")
  })

  it("does not allow eval", () => {
    expect(csp).not.toContain("unsafe-eval")
  })

  it("allows social-monitoring media CDNs in media-src and connect-src", () => {
    for (const d of ["media-src", "connect-src"]) {
      expect(directive(d)).toContain("https://*.fbcdn.net")
      expect(directive(d)).toContain("https://*.cdninstagram.com")
      expect(directive(d)).toContain("https://*.tiktokcdn.com")
      expect(directive(d)).toContain("https://*.tiktokcdn-us.com")
    }
  })

  it("allows only the exact Gemini Live HTTPS and WebSocket origins", () => {
    const connect = directive("connect-src")
    expect(connect).toContain("https://generativelanguage.googleapis.com")
    expect(connect).toContain("wss://generativelanguage.googleapis.com")
    expect(connect).not.toContain("*.generativelanguage.googleapis.com")
  })

  it("allows YouTube/TikTok video players in frame-src (mention-card embeds)", () => {
    expect(directive("frame-src")).toContain("https://www.youtube.com")
    expect(directive("frame-src")).toContain("https://www.tiktok.com")
  })

  it("allows the explicitly requested Google Maps Embed surface without weakening script CSP", () => {
    expect(directive("frame-src")).toContain("https://www.google.com")
    expect(directive("script-src")).not.toContain("'unsafe-eval'")
  })

  it("allows Google Fonts (Dancing Script on /sign)", () => {
    expect(directive("style-src")).toContain("https://fonts.googleapis.com")
    expect(directive("font-src")).toContain("https://fonts.gstatic.com")
  })

  it("sets the hardening directives added for enforce", () => {
    expect(directive("base-uri")).toBe("base-uri 'self'")
    expect(directive("object-src")).toBe("object-src 'none'")
    expect(directive("script-src-attr")).toBe("script-src-attr 'none'")
    expect(directive("worker-src")).toBe("worker-src 'self' blob:")
    expect(directive("manifest-src")).toBe("manifest-src 'self'")
  })

  it("keeps report-uri for post-enforce regression monitoring", () => {
    expect(csp).toContain("report-uri /api/v1/public/csp-report")
  })

  it("supports frame-ancestors modes: none / self / omit", () => {
    expect(buildCsp(nonce, "none")).toContain("frame-ancestors 'none'")
    expect(buildCsp(nonce, "self")).toContain("frame-ancestors 'self'")
    expect(buildCsp(nonce, "omit")).not.toContain("frame-ancestors")
  })
})

describe("middleware CSP headers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockReturnValue(true)
  })

  it("ENFORCES CSP on the app host", async () => {
    const res = await authMiddleware(makeReq({ pathname: "/login", host: "app.leaddrivecrm.org" }))
    const csp = res.headers.get("Content-Security-Policy")
    expect(csp).toBeTruthy()
    expect(csp).toContain("'strict-dynamic'")
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull()
    expect(res.headers.get("X-Frame-Options")).toBe("DENY")
  })

  it("ENFORCES CSP on tenant subdomains", async () => {
    const res = await authMiddleware(makeReq({ pathname: "/login", host: "mars.leaddrivecrm.org" }))
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy()
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull()
  })

  it("keeps the marketing host on Report-Only (Cloudflare email-decode script)", async () => {
    const res = await authMiddleware(makeReq({ pathname: "/home", host: "leaddrivecrm.org" }))
    expect(res.headers.get("Content-Security-Policy")).toBeNull()
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy()
  })

  it("omits frame-ancestors and X-Frame-Options for the cross-origin chat widget", async () => {
    const res = await authMiddleware(makeReq({ pathname: "/embed/chat/session-1", host: "app.leaddrivecrm.org" }))
    const csp = res.headers.get("Content-Security-Policy")
    expect(csp).toBeTruthy()
    expect(csp).not.toContain("frame-ancestors")
    expect(res.headers.get("X-Frame-Options")).toBeNull()
  })

  it("sends NO CSP with /sw.js (a worker-script CSP would strangle serwist's cross-origin runtime cache)", async () => {
    const res = await authMiddleware(makeReq({ pathname: "/sw.js", host: "app.leaddrivecrm.org" }))
    expect(res.headers.get("Content-Security-Policy")).toBeNull()
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull()
    // other security headers still apply
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("rate-limits csp-report POSTs in their own bucket (not the shared public one)", async () => {
    const seenKeys: string[] = []
    vi.mocked(checkRateLimit).mockImplementation((key: string) => {
      seenKeys.push(key)
      return !key.startsWith("csp-report:")
    })
    const url = new URL("/api/v1/public/csp-report", "http://app.leaddrivecrm.org")
    const req = new NextRequest(url, { method: "POST", headers: { host: "app.leaddrivecrm.org", "x-real-ip": "10.0.0.1" } }) as RequestWithAuth
    req.auth = null
    const res = await authMiddleware(req)
    expect(res.status).toBe(429)
    expect(seenKeys).toContain("csp-report:10.0.0.1")
    expect(seenKeys.filter((k) => k.startsWith("public:"))).toHaveLength(0)
  })

  it("allows same-origin framing for the invoice preview", async () => {
    const res = await authMiddleware(
      makeReq({
        pathname: "/api/v1/invoices/inv-1/pdf",
        host: "app.leaddrivecrm.org",
        auth: { user: { id: "u1", role: "superadmin", organizationId: "org1" } },
      }),
    )
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'")
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
  })
})
