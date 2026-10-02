import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: { orgId: "cltenantobservation00000001", userId: "clactor00000000000000001", role: "admin" },
  denied: false,
  info: vi.fn(),
  transaction: vi.fn(),
  organization: { findUnique: vi.fn(), update: vi.fn() },
  ticketMacro: { findMany: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
}))
vi.mock("@/generated/build-sha", () => ({ DEPLOY_SHA: "a".repeat(40) }))
vi.mock("@/lib/logger", () => ({ default: { info: mocks.info } }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, organization: mocks.organization, ticketMacro: mocks.ticketMacro, user: mocks.user } }))
vi.mock("@/lib/with-rls", () => ({ withRlsAuth: (_module: string, _action: string, handler: (req: NextRequest, auth: typeof mocks.auth) => Promise<Response>) => (req: NextRequest) => mocks.denied ? Promise.resolve(new Response(null, { status: 403 })) : handler(req, mocks.auth) }))

import { POST, PATCH, DELETE } from "@/app/api/v1/ticket-macros/categories/route"
import { GET } from "@/app/api/v1/ticket-macros/route"
import { supportUxObservationTenantKey } from "@/lib/support-ux-observation"

function request(method: string, body?: object) {
  return new NextRequest("http://localhost:3000/api/v1/ticket-macros/categories", { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) })
}

describe("Real Macros handler observation preserves operations and tenant fences", () => {
  afterEach(() => { vi.unstubAllEnvs() })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXTAUTH_SECRET", "synthetic-observation-secret-0123456789")
    mocks.denied = false
    mocks.auth.role = "admin"
    mocks.info.mockReset()
    mocks.organization.findUnique.mockResolvedValue({ settings: { ticketMacroCategories: ["custom"] }, features: ["support_ux_v2_canary"] })
    mocks.organization.update.mockResolvedValue({})
    mocks.ticketMacro.findMany.mockResolvedValue([])
    mocks.ticketMacro.updateMany.mockResolvedValue({ count: 2 })
    mocks.user.findMany.mockResolvedValue([])
    mocks.transaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({ organization: mocks.organization, ticketMacro: mocks.ticketMacro }))
  })

  it("records one actual successful create without exposing its name or actor", async () => {
    const response = await POST(request("POST", { name: "Private Customer Category" }))
    expect(response.status).toBe(201)
    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ operation: "CATEGORY_CREATE", mode: "database", http_status: 201, outcome: "success", tenant_key: supportUxObservationTenantKey(mocks.auth.orgId) })
    expect(mocks.organization.findUnique).toHaveBeenCalledWith({ where: { id: mocks.auth.orgId }, select: { settings: true, features: true } })
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    const logged = JSON.stringify(mocks.info.mock.calls)
    for (const privateValue of ["Private Customer Category", mocks.auth.orgId, mocks.auth.userId, "synthetic-observation-secret"]) expect(logged).not.toContain(privateValue)
  })

  it("keeps flag-off rejection and its browser mode without any settings write", async () => {
    mocks.organization.findUnique.mockResolvedValue({ settings: {}, features: [] })
    const response = await POST(request("POST", { name: "custom-new" }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("SUPPORT_UX_CANARY_DISABLED")
    expect(mocks.organization.update).not.toHaveBeenCalled()
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ mode: "browser", outcome: "client_rejection", http_status: 409 })
  })

  it("counts invalid-body rejection in unverified mode without reading or mutating DB", async () => {
    const response = await POST(request("POST", { name: "new", organizationId: "another-tenant" }))
    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ mode: "unverified", http_status: 400, outcome: "client_rejection" })
  })

  it("preserves local role denial without a DB call", async () => {
    mocks.auth.role = "viewer"
    expect((await POST(request("POST", { name: "new" }))).status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ mode: "unverified", http_status: 403 })
  })

  it("keeps rename updates scoped to the authenticated organization", async () => {
    expect((await PATCH(request("PATCH", { name: "custom", newName: "renamed" }))).status).toBe(200)
    expect(mocks.ticketMacro.updateMany).toHaveBeenCalledWith({ where: { organizationId: mocks.auth.orgId, category: "custom" }, data: { category: "renamed" } })
    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ operation: "CATEGORY_RENAME", mode: "database", http_status: 200 })
  })

  it("preserves delete response and same-tenant reassignment", async () => {
    const response = await DELETE(request("DELETE", { name: "custom" }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.moved).toBe(2)
    expect(mocks.ticketMacro.updateMany).toHaveBeenCalledWith({ where: { organizationId: mocks.auth.orgId, category: "custom" }, data: { category: "general" } })
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ operation: "CATEGORY_DELETE", mode: "database", outcome: "success" })
  })

  it("keeps the default-category guard before any mutation", async () => {
    expect((await DELETE(request("DELETE", { name: "general" }))).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ operation: "CATEGORY_DELETE", mode: "unverified", outcome: "client_rejection" })
  })

  it("records category list mode without exposing features or changing the response", async () => {
    const response = await GET(request("GET"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.categories).toContain("custom")
    expect(body).not.toHaveProperty("features")
    expect(mocks.ticketMacro.findMany.mock.calls[0][0].where.organizationId).toBe(mocks.auth.orgId)
    expect(mocks.info.mock.calls[0][0]).toMatchObject({ operation: "CATEGORY_LIST", mode: "database", http_status: 200 })
  })

  it("does not fabricate tenant-handler events for a base-auth denial", async () => {
    mocks.denied = true
    expect((await POST(request("POST", { name: "new" }))).status).toBe(403)
    expect(mocks.info).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("does not make a successful write fail when the telemetry sink fails", async () => {
    mocks.info.mockImplementation(() => { throw new Error("synthetic sink unavailable") })
    expect((await POST(request("POST", { name: "new" }))).status).toBe(201)
    expect(mocks.organization.update).toHaveBeenCalledTimes(1)
  })
})
