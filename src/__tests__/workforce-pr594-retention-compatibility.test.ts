import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({ getSession: vi.fn(), getOrgId: vi.fn(), requireAuth: vi.fn(), isAuthError: (v: unknown) => v instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", () => ({ resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capabilities", async original => ({ ...await original<typeof import("@/lib/tenant-capabilities")>(), isTenantCapabilityEnabled: vi.fn(() => true) }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
import { DELETE } from "@/app/api/v1/mtm/agents/[id]/route"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { agentHistoryRelations } from "@/lib/mtm/agent-deletion"

const remove = () => DELETE(new NextRequest("http://localhost/api/v1/mtm/agents/subject-a", { method: "DELETE" }), { params: Promise.resolve({ id: "subject-a" }) })
beforeEach(() => {
  vi.clearAllMocks()
  resetMtmFieldScopeMemo()
  for (const model of Object.values(prisma)) {
    if (model && typeof model === "object" && "count" in model) vi.mocked(model.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
  }
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-a", userId: "admin-a", role: "admin", email: "synthetic@example.test", name: "Fixture" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "subject-a", role: "AGENT", name: "Synthetic" } as never)
  vi.mocked(prisma.mtmAgent.deleteMany).mockResolvedValue({ count: 1 })
})
afterEach(() => vi.restoreAllMocks())

describe("Field removal preserves Workforce retention", () => {
  it.each(["workforceExceptionCase", "workforceTimesheetApproval"] as const)("retains %s while removing Field access", async model => {
    vi.mocked(prisma[model].count).mockResolvedValue(1)
    const response = await remove()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fieldDeletedAt: expect.any(Date) }) }))
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
    expect(prisma[model].deleteMany).not.toHaveBeenCalled()
  })
  it("retains historical relations, including setup-only links", async () => {
    expect(agentHistoryRelations()).toContainEqual({ model: "WorkforceExceptionCase", field: "agentId" })
    expect((await remove()).status).toBe(200)
    expect(prisma.mtmLocationShareLink.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })
  it("refuses removal when the audit fails, without exposing database details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(new Error("PRIVATE-AUDIT-QUERY"))
    const response = await remove()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Failed to delete", code: "MTM_AGENT_DELETE_FAILED" })
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })
})
