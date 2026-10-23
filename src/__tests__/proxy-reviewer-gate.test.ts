/**
 * The reviewer gate in the proxy: refusals happen before any route runs, an
 * expired grant sends the reviewer to sign in, and a file of a section that
 * was not ticked is refused like its API.
 */
import { describe, expect, it, vi } from "vitest"

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
vi.mock("@/lib/auth", () => ({
  auth: (cb: Function) => cb,
}))

import { NextRequest } from "next/server"
import authMiddleware from "@/proxy"

const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

function reviewer(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "rev1", organizationId: "org-1", role: "reviewer", plan: "enterprise",
      modules: { crm: true, contacts: true, contracts: true, inbox: false, omnichannel: false },
      reviewerAccessUntil: future(),
      ...overrides,
    },
  }
}

async function run(pathname: string, auth: unknown, method = "GET") {
  const req = new NextRequest(new URL(pathname, "http://localhost"), { method, headers: { host: "localhost" } })
  ;(req as unknown as { auth: unknown }).auth = auth
  return authMiddleware(req)
}

describe("proxy reviewer gate", () => {
  it("passes an ordinary read", async () => {
    const res = await run("/dashboard", reviewer())
    expect(res.status).toBe(200)
  })

  it("refuses a write and a settings read before any route runs", async () => {
    expect((await run("/api/v1/contacts", reviewer(), "POST")).status).toBe(403)
    expect((await run("/api/v1/settings/roles", reviewer())).status).toBe(403)
    expect((await run("/api/v1/tasks/export", reviewer())).status).toBe(403)
  })

  it("sends a settings page back to the start", async () => {
    const res = await run("/settings/users", reviewer())
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/\/$/)
  })

  it("ends the session at the end date", async () => {
    const expired = reviewer({ reviewerAccessUntil: new Date(Date.now() - 1000).toISOString() })
    expect((await run("/api/v1/contacts", expired)).status).toBe(401)
    const page = await run("/contacts", expired)
    expect(page.status).toBe(307)
    expect(page.headers.get("location")).toMatch(/\/login$/)
  })

  it("refuses a file from a section that was not ticked", async () => {
    expect((await run("/uploads/inbox/org-1/a1b2c3d4.pdf", reviewer())).status).toBe(403)
  })

  it("leaves everyone else alone", async () => {
    const viewer = { user: { id: "u1", organizationId: "org-1", role: "viewer" } }
    expect((await run("/settings/users", viewer)).status).toBe(200)
  })
})
