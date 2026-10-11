import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
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

describe("PR594 retention compatibility using actual history discovery and DELETE handler", () => {
  it("keeps a schedule-only exception subject even without workdays or snapshots", async () => {
    expect(agentHistoryRelations()).toContainEqual({ model: "WorkforceExceptionCase", field: "agentId" })
    vi.mocked(prisma.workforceExceptionCase.count).mockResolvedValue(1)
    const response = await remove()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_AGENT_HAS_HISTORY", data: { kinds: ["WorkforceExceptionCase.agentId"] } })
    expect(prisma.workforceExceptionCase.count).toHaveBeenCalledWith({ where: { organizationId: "org-a", agentId: "subject-a" } })
    expect(prisma.mtmAgentWorkday.count).toHaveBeenCalled()
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })
  it("preserves the earlier approval-only retention refusal", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.count).mockResolvedValue(1)
    const response = await remove()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_RETENTION_BLOCKED" })
    expect(prisma.workforceExceptionCase.count).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })
  it("retains PR594's setup-only deletion exception", async () => {
    expect(agentHistoryRelations()).not.toContainEqual({ model: "WorkforceEmployeeTeamMembership", field: "agentId" })
    const response = await remove()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(prisma.mtmAgent.deleteMany).toHaveBeenCalledWith({ where: { id: "subject-a", organizationId: "org-a" } })
  })
  // «Ссылка на местоположение» (2026-10-10). A link to an employee's position
  // is a row that points at him, and «history» is read from the schema — so
  // without its line in SETUP_NOT_HISTORY an employee a manager once made a
  // link for could never be deleted again (409 MTM_AGENT_HAS_HISTORY), and
  // nothing else in the suite would have said so.
  it("does not take a link to an employee's position for his work history: he is deleted, and the links go with him", async () => {
    // The relation is there for the discovery to find…
    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === "MtmLocationShareLink")
    expect(model?.fields.find((field) => field.type === "MtmAgent")?.relationFromFields).toEqual(["organizationId", "agentId"])
    // …and it is named as setup, not counted as history.
    expect(agentHistoryRelations()).not.toContainEqual({ model: "MtmLocationShareLink", field: "agentId" })
    vi.mocked(prisma.mtmLocationShareLink.count).mockResolvedValue(3)
    const response = await remove()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(prisma.mtmLocationShareLink.count).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.deleteMany).toHaveBeenCalledWith({ where: { id: "subject-a", organizationId: "org-a" } })
  })
  it("refuses deletion when the history lookup fails; no database detail crosses the HTTP boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(prisma.workforceExceptionCase.count).mockRejectedValue(new Error("PRIVATE-HISTORY-QUERY"))
    const response = await remove()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Failed to delete", code: "MTM_AGENT_DELETE_FAILED" })
    expect(prisma.mtmAgent.deleteMany).not.toHaveBeenCalled()
  })
})
