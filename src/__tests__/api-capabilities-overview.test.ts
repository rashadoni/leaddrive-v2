import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), findUnique: vi.fn(), count: vi.fn(), tenant: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({ requireAuth: mocks.requireAuth, isAuthError: (value: unknown) => value instanceof NextResponse }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => fn(),
  runWithTenant: (orgId: string, fn: () => unknown) => { mocks.tenant(orgId); return fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: mocks.findUnique }, appInstallation: { count: mocks.count } } }))

import { GET } from "@/app/api/v1/settings/capabilities/overview/route"

describe("tenant capabilities overview GET", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({ orgId: "tenant-one", role: "admin", userId: "u1" })
    mocks.findUnique.mockResolvedValue({ plan: "starter", features: ["crm", "sales", "settings"], addons: [], modules: { crm: true, sales: true, settings: true }, settings: { unrelatedSecret: "must-not-leak" } })
    mocks.count.mockResolvedValue(3)
  })

  it("uses the authenticated tenant even when a caller supplies another tenant", async () => {
    const response = await GET(new NextRequest("https://example.com/api/v1/settings/capabilities/overview?organizationId=tenant-two", { headers: { "x-organization-id": "tenant-two" } }))
    expect(response.status).toBe(200)
    expect(mocks.tenant).toHaveBeenCalledWith("tenant-one")
    expect(mocks.findUnique.mock.calls[0][0].where).toEqual({ id: "tenant-one" })
    expect(mocks.count.mock.calls[0][0].where).toEqual({ organizationId: "tenant-one", uninstalledAt: null })
    const text = await response.text()
    expect(text).not.toContain("must-not-leak")
    expect(JSON.parse(text).data.installedAppsCount).toBe(3)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it.each([401, 403])("preserves authentication/role denial %s before any tenant read", async status => {
    mocks.requireAuth.mockResolvedValue(NextResponse.json({ error: "Denied" }, { status }))
    const response = await GET(new NextRequest("https://example.com/api/v1/settings/capabilities/overview"))
    expect(response.status).toBe(status)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.count).not.toHaveBeenCalled()
  })

  it("returns a missing organisation error rather than an empty successful catalogue", async () => {
    mocks.findUnique.mockResolvedValue(null)
    const response = await GET(new NextRequest("https://example.com/api/v1/settings/capabilities/overview"))
    expect(response.status).toBe(404)
    expect(mocks.count).not.toHaveBeenCalled()
  })
})
