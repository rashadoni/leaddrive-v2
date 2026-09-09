import { describe, it, expect, vi } from "vitest"
import { readdirSync, statSync } from "fs"
import { join } from "path"

// Same middleware harness as lib-middleware.test.ts / csp.test.ts.
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
vi.mock("@/lib/auth", () => ({ auth: (cb: Function) => cb }))

import { NextRequest } from "next/server"
import authMiddleware from "@/proxy"

/**
 * Everything under /api/internal is machine-to-machine: the PBX and Asterisk
 * call these routes and authenticate with a bearer token inside the handler.
 * None of them has a browser session, so none may be sent to the login page.
 *
 * The exemption list in the middleware is EXACT-MATCH. Adding a route without
 * adding its path there does not fail loudly — the caller is redirected and
 * gets an HTML sign-in form where it expected JSON, which on the PBX side looks
 * like the feature simply not working. That is how the call-source endpoint
 * shipped dead: the route, its auth, its tests and the telephony side were all
 * correct, and the request never reached the handler.
 *
 * So the guard is discovery-based rather than a second hand-maintained list:
 * it walks the route files on disk, and a new one is covered the moment it
 * exists.
 */

const INTERNAL_DIR = join(process.cwd(), "src", "app", "api", "internal")

function internalRoutePaths(dir: string, prefix = "/api/internal"): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...internalRoutePaths(full, `${prefix}/${entry}`))
    } else if (entry === "route.ts" || entry === "route.tsx") {
      found.push(prefix)
    }
  }
  return found
}

function makeReq(pathname: string) {
  const req = new NextRequest(new URL(pathname, "http://localhost"), {
    method: "GET",
    headers: { host: "localhost" },
  })
  // Unauthenticated: exactly the state the PBX calls in.
  ;(req as any).auth = null
  return req
}

describe("internal machine-to-machine routes", () => {
  const routes = internalRoutePaths(INTERNAL_DIR)

  it("discovers the internal routes at all", () => {
    // Negative control: an empty list would make every assertion below vacuous,
    // and a test that cannot fail is worse than no test.
    expect(routes.length).toBeGreaterThanOrEqual(5)
    expect(routes).toContain("/api/internal/voice-agent/runtime-config")
  })

  it.each(routes)("does not redirect %s to the login page", async (pathname) => {
    const res = await authMiddleware(makeReq(pathname) as never)
    const location = res?.headers?.get("location") ?? ""
    expect(location).not.toContain("/login")
    // A redirect anywhere is equally fatal for a caller expecting JSON.
    expect([301, 302, 303, 307, 308]).not.toContain(res?.status)
  })
})
