import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * `withRls` authenticates. Until 2026-08-29 it did not authorize.
 *
 * 144 routes accepted POST/PUT/PATCH/DELETE through it with no role check of
 * any kind, so any member of the organization could call them whatever their
 * role — against a permission model that is specific about who may write:
 *
 *            deals  invoices  offers  contracts  pricing  tickets
 *   manager  write  write     write   write      read     write
 *   sales    write  read      write   read       —        read
 *   support  read   read      —       read       —        write
 *   viewer   read   read      read    read       read     read
 *
 * These tests exercise the wrapper against real roles and methods rather than
 * asserting on source text, so they keep meaning if the check moves.
 */

const getSession = vi.fn()
const getOrgId = vi.fn()

vi.mock("@/lib/api-auth", () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  getOrgId: (...a: unknown[]) => getOrgId(...a),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (v: unknown) => v instanceof Response,
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

const { withRls } = await import("@/lib/with-rls")

const handler = vi.fn(async () => NextResponse.json({ ok: true }))
const route = withRls(handler)

function sessionAs(role: string) {
  return { orgId: "org-1", userId: "u-1", role, email: "a@b.co", name: "A" }
}

function req(method: string, path: string) {
  return new NextRequest(`https://app.leaddrivecrm.org${path}`, { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  getOrgId.mockResolvedValue("org-1")
})

describe("withRls refuses what the role may not do", () => {
  // The headline case: viewer is `{"*": ["read"]}` and could write anywhere.
  it.each([
    ["POST", "/api/v1/deals"],
    ["PUT", "/api/v1/invoices/inv-1"],
    ["PATCH", "/api/v1/contacts/c-1"],
    ["DELETE", "/api/v1/tasks/t-1"],
  ])("viewer cannot %s %s", async (method, path) => {
    getSession.mockResolvedValue(sessionAs("viewer"))

    const res = await route(req(method, path))

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it("viewer can still read", async () => {
    getSession.mockResolvedValue(sessionAs("viewer"))

    const res = await route(req("GET", "/api/v1/deals"))

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  // sales is read-only on invoices, contracts and pricing per ROLE_PERMISSIONS,
  // and was writing all three through this wrapper.
  it.each([
    ["/api/v1/invoices"],
    ["/api/v1/contracts"],
    ["/api/v1/pricing/profiles"],
  ])("sales cannot POST %s", async (path) => {
    getSession.mockResolvedValue(sessionAs("sales"))

    const res = await route(req("POST", path))

    expect(res.status).toBe(403)
  })

  it("sales can still POST the modules it owns", async () => {
    getSession.mockResolvedValue(sessionAs("sales"))

    expect((await route(req("POST", "/api/v1/deals"))).status).toBe(200)
    expect((await route(req("POST", "/api/v1/leads"))).status).toBe(200)
  })

  it("ticketing cannot reach deals at all, and keeps its own module", async () => {
    getSession.mockResolvedValue(sessionAs("ticketing"))

    expect((await route(req("POST", "/api/v1/deals"))).status).toBe(403)
    expect((await route(req("GET", "/api/v1/deals"))).status).toBe(403)
    expect((await route(req("POST", "/api/v1/tickets"))).status).toBe(200)
  })

  it("admin and superadmin are unaffected", async () => {
    for (const role of ["admin", "superadmin"]) {
      getSession.mockResolvedValue(sessionAs(role))
      expect((await route(req("POST", "/api/v1/invoices"))).status).toBe(200)
    }
  })

  it("names the role, action and module so a 403 is diagnosable", async () => {
    getSession.mockResolvedValue(sessionAs("viewer"))

    const body = await (await route(req("POST", "/api/v1/deals"))).json()

    expect(body.error).toBe("Forbidden")
    expect(body.message).toContain("viewer")
    expect(body.message).toContain("write")
    expect(body.message).toContain("deals")
  })
})

describe("withRls leaves the principals that carry no role alone", () => {
  // Mobile JWT and API keys resolve through getOrgId with session === null.
  // They are gated by resolveMobileAuth and by API-key scopes respectively;
  // running them through a role model they have no role in would deny them all.
  it("a mobile-JWT principal still reaches the handler", async () => {
    getSession.mockResolvedValue(null)
    getOrgId.mockResolvedValue("org-1")

    const res = await route(req("POST", "/api/v1/mtm/visits"))

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it("still 401s when no organization resolves", async () => {
    getSession.mockResolvedValue(null)
    getOrgId.mockResolvedValue(null)

    expect((await route(req("POST", "/api/v1/deals"))).status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("withRls matches requireAuth on unmapped paths", () => {
  // resolveModuleFromPath returns null for routes outside ROUTE_MODULE_MAP, and
  // requireAuth skips the check for those too (`if (resolvedModule)`). Silently
  // denying here instead would make the two wrappers disagree — and adding a
  // ROUTE_MODULE_MAP entry, not special-casing, is how such a route gets gated.
  it("does not invent a denial for a path with no module", async () => {
    getSession.mockResolvedValue(sessionAs("viewer"))

    const res = await route(req("POST", "/api/v1/some-unmapped-thing"))

    expect(res.status).toBe(200)
  })

  it("leaves the self-service /me routes reachable by every role", async () => {
    getSession.mockResolvedValue(sessionAs("viewer"))

    const res = await route(req("PATCH", "/api/v1/users/me"))

    expect(res.status).toBe(200)
  })
})
