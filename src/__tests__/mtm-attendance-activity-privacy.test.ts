import { beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), isAuthError: (value: unknown) => value instanceof Response }))
import { GET } from "@/app/api/v1/mtm/activity/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
const ORG = "attendance-activity-fixture"
const makeReq = (url: string) => new NextRequest(new URL(url, "http://localhost"))
beforeEach(() => {
  vi.clearAllMocks(); resetMtmFieldScopeMemo()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "fictional-reader", role: "admin", email: "fixture@example.invalid", name: "Fictional reader", principalType: "session" } as never)
  vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(0)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm", "workforce-hrm"], modules: { mtm: true, "workforce-hrm": true } } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
})
  it("keeps private attendance decision and cancellation details out of the general feed", async () => {
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([{
      id: "attendance-audit", organizationId: ORG, agentId: "agent-1", agent: { id: "agent-1", name: "Fictional employee", avatar: null },
      action: "MTM_ATTENDANCE_APPROVAL_REVOKED", entity: "hrm_request", entityId: "fictional-request", metadataKind: "mtm_attendance_request",
      actorUserId: null, createdAt: new Date("2026-10-13T10:00:00Z"), oldData: { status: "APPROVED" }, newData: { status: "CANCELLED", reason: "PRIVATE_ATTENDANCE_REASON" },
    }] as never)
    const response = await GET(makeReq("/api/v1/mtm/activity?period=all"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.logs[0]).toMatchObject({ id: "attendance-audit", oldData: null, newData: null })
    expect(JSON.stringify(body)).not.toContain("PRIVATE_ATTENDANCE_REASON")
  })

