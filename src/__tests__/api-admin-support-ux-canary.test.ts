import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { getRlsContext } from "@/lib/rls-context"

const mocks = vi.hoisted(() => ({
  sha: "f62ab3a609a0461cbd14c264306df2d28325628f",
  tx: { $queryRaw: vi.fn(), organization: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } },
  transaction: vi.fn(),
}))
vi.mock("@/generated/build-sha", () => ({ get DEPLOY_SHA() { return mocks.sha } }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn() }))
import { POST } from "@/app/api/v1/admin/tenants/[id]/support-ux-canary/route"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { SUPPORT_UX_V2_CANARY_FLAG as FLAG } from "@/lib/support-ux-rollout"

const SHA = "f62ab3a609a0461cbd14c264306df2d28325628f"
const AUTH = { orgId: "operator-org", userId: "operator-1", role: "superadmin" as const, email: "test@example.invalid", name: "Operator" }
const tenant = { id: "chosen-org", slug: "chosen-tenant", isActive: true, features: ["support", "crm", "crm"] }
const params = { params: Promise.resolve({ id: tenant.id }) }
function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/v1/admin/tenants/chosen-org/support-ux-canary", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug: tenant.slug, enabled: true, expectedEnabled: false, expectedArtifactSha: SHA, ...overrides }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.sha = SHA
  vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH)
  mocks.transaction.mockImplementation(async (callback) => await callback(mocks.tx))
  mocks.tx.$queryRaw.mockResolvedValue([{ id: tenant.id }])
  mocks.tx.organization.findUnique.mockResolvedValue(structuredClone(tenant))
  mocks.tx.organization.update.mockResolvedValue({ id: tenant.id })
  mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1", createdAt: new Date("2026-10-03T10:00:00Z") })
})
describe("superadmin Support canary action", () => {
  it.each([401, 403])("rejects unauthorized access (%s) before any database work", async (status) => {
    vi.mocked(requireSuperAdmin).mockResolvedValue(NextResponse.json({ error: "denied" }, { status }))
    expect((await POST(request(), params)).status).toBe(status)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each([{ arbitraryFlag: "another" }, { tenantSlug: "wrong/shape" }, { enabled: "true" }, { expectedArtifactSha: "short" }])("rejects invalid input: %j", async (override) => {
    expect((await POST(request(override), params)).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects unstamped and changed compiled artifacts before database access", async () => {
    mocks.sha = ""
    expect((await POST(request(), params)).status).toBe(503)
    mocks.sha = "a".repeat(40)
    expect((await POST(request(), params)).status).toBe(409)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("updates only features and awaits the actor/state/source audit in the bypass transaction", async () => {
    mocks.transaction.mockImplementation(async (callback) => {
      expect(getRlsContext()?.bypass).toBe(true)
      return await callback(mocks.tx)
    })
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 })
    expect(mocks.tx.organization.update).toHaveBeenCalledWith({ where: { id: tenant.id }, data: { features: [...tenant.features, FLAG] }, select: { id: true } })
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({ data: {
      organizationId: tenant.id, userId: AUTH.userId, action: "support_ux_canary_enable",
      entityType: "support_ux_canary", entityId: tenant.id, entityName: FLAG,
      oldValue: { enabled: false }, newValue: { enabled: true, changed: true, artifactSha: SHA },
    }, select: { id: true, createdAt: true } })
    expect((await response.json()).data).toEqual(expect.objectContaining({ changed: true, auditId: "audit-1", artifactSha: SHA }))
  })
  it.each([null, { ...tenant, slug: "another" }])("rejects absent or mismatched tenant: %j", async (row) => {
    mocks.tx.organization.findUnique.mockResolvedValue(row)
    expect((await POST(request(), params)).status).toBe(404)
    expect(mocks.tx.organization.update).not.toHaveBeenCalled()
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled()
  })
  it("rejects enabling an inactive tenant but allows its scoped rollback", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ...tenant, isActive: false, features: [FLAG, "crm"] })
    expect((await POST(request({ expectedEnabled: true }), params)).status).toBe(409)
    expect((await POST(request({ enabled: false, expectedEnabled: true }), params)).status).toBe(200)
    expect(mocks.tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({ data: { features: ["crm"] } }))
  })
  it("rejects stale expected state before a write or audit", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ...tenant, features: [FLAG] })
    expect((await POST(request(), params)).status).toBe(409)
    expect(mocks.tx.organization.update).not.toHaveBeenCalled()
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled()
  })
  it("records an idempotent confirmation without changing features or inventing activation time", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ...tenant, features: ` ["${FLAG}", "crm"] ` })
    const response = await POST(request({ expectedEnabled: true }), params)
    expect(response.status).toBe(200)
    const data = (await response.json()).data
    expect(data.changed).toBe(false)
    expect(data).not.toHaveProperty("activatedAt")
    expect(mocks.tx.organization.update).not.toHaveBeenCalled()
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "support_ux_canary_confirm" }) }))
    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce()
  })
  it("returns a fixed failure if the transactional audit rejects, without leaking its text", async () => {
    mocks.tx.auditLog.create.mockRejectedValue(new Error("sensitive database detail"))
    const response = await POST(request(), params)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, code: "SUPPORT_UX_CHANGE_FAILED" })
  })
  it.each([{ code: "P2034" }, { code: "P2010", meta: { code: "40001" } }, { code: "P2010", meta: { code: "40P01" } }])("reports serialization/deadlock conflicts without retrying: %j", async (error) => {
    mocks.transaction.mockRejectedValue(error)
    expect((await POST(request(), params)).status).toBe(409)
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })
  it("does not misclassify unrelated raw SQL failures as a state conflict", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2010", meta: { code: "23514" } })
    expect((await POST(request(), params)).status).toBe(500)
  })
})
