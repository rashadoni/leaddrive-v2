import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { WorkforceExceptionCaseWriterError } from "@/lib/workforce/exception-case-writer"
import { materializeAuthorizedWorkforceNoShowReviewCase } from "@/lib/workforce/no-show-case-materializer"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

const ORGANIZATION_ID = "org-no-show-materializer"
const AGENT_ID = "agent-no-show-materializer"
const WORK_DATE = "2026-09-01"
const AS_OF = new Date("2026-09-01T05:15:00.000Z")
const transaction = vi.fn(async (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma))
const client = { $transaction: transaction }
const SHIFT_DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}
const POLICY_DEFINITION = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 15 * 60,
  undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0,
  longPauseThresholdSeconds: 60 * 60,
}

function configureCandidate() {
  const template = {
    id: "shift-materializer",
    teamId: null,
    isDefault: true,
    version: 1,
    status: "ACTIVE",
    timezone: "Asia/Baku",
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: SHIFT_DEFINITION,
    definitionHash: workforceShiftDefinitionHash(SHIFT_DEFINITION),
  }
  const policy = {
    id: "policy-materializer",
    teamId: null,
    version: 1,
    status: "ACTIVE",
    name: "Baku standard",
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: POLICY_DEFINITION,
    definitionHash: workforcePolicyDefinitionHash(POLICY_DEFINITION),
  }
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    { id: "membership-materializer", teamId: "team-historical", effectiveAt: new Date("2026-08-01T00:00:00.000Z"), agentId: AGENT_ID, eventId: "employment-hire", kind: "HIRE" },
  ] as never)
  vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.workforceShiftTeamDefaultAssignment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.workforceShiftDefaultAssignment.findMany).mockResolvedValue([{ id: "default-materializer", template }] as never)
  vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([policy] as never)
  vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: "segment-materializer" } as never)
  vi.mocked(prisma.workforceExceptionCase.create).mockResolvedValue({ id: "case-materializer" } as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-materializer" } as never)
}

describe("Workforce no-show review-case materializer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureCandidate()
  })

  it("locks the canonical workday lane, rechecks the candidate and records only a review case", async () => {
    const authorize = vi.fn().mockResolvedValue(true)
    await expect(materializeAuthorizedWorkforceNoShowReviewCase({
      db: client as never,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      asOf: AS_OF,
      authorize,
    })).resolves.toEqual({
      outcome: "REVIEW_CASE_RECORDED",
      caseId: "case-materializer",
      idempotent: false,
      expectedStartAt: "2026-09-01T05:00:00.000Z",
    })
    expect(authorize).toHaveBeenCalledWith({ operation: "CASE_CREATE", organizationId: ORGANIZATION_ID, agentId: AGENT_ID })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(prisma.workforceExceptionCase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        kind: "NO_SHOW",
        workdayId: null,
        segmentId: "segment-materializer",
        expectedWorkDate: WORK_DATE,
      }),
    }))
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toMatch(/latitude|longitude|qr|device|reason/i)
  })

  it("does not create a case when the recheck sees a canonical workday", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "workday-now-visible" } as never)
    await expect(materializeAuthorizedWorkforceNoShowReviewCase({
      db: client as never,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      asOf: AS_OF,
      authorize: async () => true,
    })).resolves.toMatchObject({
      outcome: "NOT_CREATED",
      candidate: { outcome: "DO_NOT_CREATE", proposal: { code: "WORKFORCE_NO_SHOW_WORKDAY_EXISTS" } },
    })
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails before the workday lock or candidate reads when the worker is not authorized", async () => {
    await expect(materializeAuthorizedWorkforceNoShowReviewCase({
      db: client as never,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      asOf: AS_OF,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED",
    })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled()
  })

  it("keeps an exact duplicate detector subject idempotent without a second audit", async () => {
    await expect(materializeAuthorizedWorkforceNoShowReviewCase({
      db: client as never,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      asOf: AS_OF,
      authorize: async () => true,
    })).resolves.toMatchObject({ outcome: "REVIEW_CASE_RECORDED", caseId: "case-materializer", idempotent: false })
    const firstWrite = vi.mocked(prisma.workforceExceptionCase.create).mock.calls[0]?.[0]?.data
    vi.mocked(prisma.workforceExceptionCase.create).mockRejectedValueOnce({ code: "P2002" })
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockImplementation(async () => ({
      id: "case-materializer",
      ...firstWrite,
    }) as never)

    await expect(materializeAuthorizedWorkforceNoShowReviewCase({
      db: client as never,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      asOf: AS_OF,
      authorize: async () => true,
    })).resolves.toMatchObject({ outcome: "REVIEW_CASE_RECORDED", caseId: "case-materializer", idempotent: true })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
