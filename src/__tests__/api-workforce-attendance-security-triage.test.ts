import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceAdminAddon: vi.fn(async () => null),
}))

import { GET as getSecurityTriage } from "@/app/api/v1/workforce/attendance/security-triage/route"
import { prisma } from "@/lib/prisma"

const AUTH = {
  orgId: "org-workforce",
  userId: "admin-1",
  role: "admin",
  principalType: "session",
  email: "admin@example.test",
  name: "Admin",
}
const invoke = getSecurityTriage as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request() {
  return new NextRequest("http://localhost:3000/api/v1/workforce/attendance/security-triage", {
    headers: { "user-agent": "vitest-security-triage" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Amina" }] as never)
  vi.mocked(prisma.workforceAttendanceVerification.groupBy).mockResolvedValue([
    { agentId: "agent-1", deviceEnrollmentId: "device-a" },
    { agentId: "agent-1", deviceEnrollmentId: "device-b" },
  ] as never)
  vi.mocked(prisma.workforceAttendanceDeviceEnrollment.groupBy).mockResolvedValue([
    { agentId: "agent-1", _count: { _all: 3 } },
  ] as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.groupBy).mockResolvedValue([
    { agentId: "agent-1", _count: { _all: 12 } },
  ] as never)
})

describe("GET /api/v1/workforce/attendance/security-triage", () => {
  it("returns bounded review prompts and writes a metadata-only audit", async () => {
    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        disposition: "REVIEW_REQUIRED_NO_AUTOMATIC_ACTION",
        report: {
          examinedAgents: 1,
          reviewCandidates: [{
            employee: { id: "agent-1", name: "Amina" },
            riskCodes: [
              "MULTIPLE_TRUSTED_DEVICES_USED",
              "RAPID_DEVICE_ENROLLMENT_CHURN",
              "ABNORMAL_ATTENDANCE_ACTION_VOLUME",
            ],
            reviewRequired: true,
          }],
        },
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        action: "WORKFORCE_ATTENDANCE_SECURITY_TRIAGE_VIEWED",
        newData: expect.objectContaining({
          examinedAgents: 1,
          reviewCandidateCount: 1,
          riskCodes: expect.arrayContaining(["MULTIPLE_TRUSTED_DEVICES_USED"]),
        }),
      }),
    }))
    const audit = JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)
    expect(audit).not.toContain("agent-1")
    expect(audit).not.toContain("device-a")
    expect(audit).not.toContain("device-b")
    expect(prisma.workforceAttendanceDeviceEnrollment.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.updateMany).not.toHaveBeenCalled()
  })

  it("counts only the employee's own attendance actions, not a manager's reopen, its undo or a close", async () => {
    await invoke(request(), AUTH)

    expect(prisma.mtmAgentWorkdayEvent.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: { not: "REOPEN" },
        OR: [
          { clientEventId: null },
          { AND: [
            { NOT: { clientEventId: { startsWith: "reopen-undo:" } } },
            { NOT: { clientEventId: { startsWith: "close-left-open:" } } },
          ] },
        ],
      }),
    }))
  })

  it("does not read verification/enrollment/event aggregates when there are no active agents", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { report: { examinedAgents: 0, reviewCandidates: [] } } })
    expect(prisma.workforceAttendanceVerification.groupBy).not.toHaveBeenCalled()
    expect(prisma.workforceAttendanceDeviceEnrollment.groupBy).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.groupBy).not.toHaveBeenCalled()
  })
})
