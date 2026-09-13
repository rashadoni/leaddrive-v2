import { describe, expect, it, vi } from "vitest"
import { makeMtmPrismaMock } from "./mocks/mtm-prisma"
import {
  recordWorkforceEmploymentEvent,
  resolveWorkforceHistoricalEmployment,
  resolveWorkforceHistoricalAssignment,
  WorkforceEmploymentEventCreateSchema,
  WorkforceEmploymentHistoryError,
} from "@/lib/workforce/employment-history"

const ORG = "org-workforce"
const AGENT = "agent-1"

describe("Workforce employment history", () => {
  it("returns explicit employment state without reading mutable team or site data", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.$queryRaw).mockResolvedValue([{
      agentId: AGENT,
      eventId: "employment-termination",
      kind: "TERMINATION",
      effectiveAt: new Date("2026-08-20T08:00:00.000Z"),
    }] as never)

    await expect(resolveWorkforceHistoricalEmployment(db as never, {
      organizationId: ORG,
      agentId: AGENT,
      occurredAt: new Date("2026-08-25T09:00:00.000Z"),
    })).resolves.toEqual({
      state: "TERMINATED",
      event: {
        id: "employment-termination",
        kind: "TERMINATION",
        effectiveAt: new Date("2026-08-20T08:00:00.000Z"),
      },
    })
    expect(db.workforceSiteAssignment.findMany).not.toHaveBeenCalled()
  })

  it("resolves delayed work from explicit lifecycle, historical team and effective site facts", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([{
        agentId: AGENT,
        eventId: "employment-hire",
        kind: "HIRE",
        effectiveAt: new Date("2026-08-01T08:00:00.000Z"),
      }] as never)
      .mockResolvedValueOnce([{
        id: "team-history-a", teamId: "team-a", effectiveAt: new Date("2026-08-15T08:00:00.000Z"),
      }] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([{
      id: "site-history-a", siteId: "site-a", kind: "TEMPORARY", effectiveFrom: new Date("2026-08-20T00:00:00.000Z"), effectiveTo: new Date("2026-08-31T00:00:00.000Z"),
    }] as never)

    const result = await resolveWorkforceHistoricalAssignment(db as never, {
      organizationId: ORG,
      agentId: AGENT,
      occurredAt: new Date("2026-08-25T09:00:00.000Z"),
      workDate: "2026-08-25",
    })

    expect(result).toMatchObject({
      employment: { state: "EMPLOYED", event: { id: "employment-hire", kind: "HIRE" } },
      teamMembership: { id: "team-history-a", teamId: "team-a" },
      siteAssignments: [{ id: "site-history-a", siteId: "site-a", kind: "TEMPORARY" }],
    })
    expect(db.workforceSiteAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, agentId: AGENT }),
    }))
  })

  it("returns unknown lifecycle rather than inferring employment from the mutable directory", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([{ agentId: AGENT, eventId: null, kind: null, effectiveAt: null }] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([] as never)

    const result = await resolveWorkforceHistoricalAssignment(db as never, {
      organizationId: ORG,
      agentId: AGENT,
      occurredAt: new Date("2026-08-25T09:00:00.000Z"),
      workDate: "2026-08-25",
    })

    expect(result?.employment).toEqual({ state: "UNKNOWN", event: null })
    expect(result?.teamMembership).toBeNull()
  })

  it("appends only a valid lifecycle sequence and records metadata-only audit", async () => {
    const db = makeMtmPrismaMock()
    const eventInput = WorkforceEmploymentEventCreateSchema.parse({
      agentId: AGENT,
      kind: "HIRE",
      effectiveAt: "2026-09-01T09:00:00.000Z",
    })
    vi.mocked(db.mtmAgent.findFirst).mockResolvedValue({ id: AGENT } as never)
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
      id: "employment-hire", kind: "HIRE", effectiveAt: eventInput.effectiveAt, source: "HR_RECORDED", recordedAt: new Date(),
      }] as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-employment" } as never)

    const result = await recordWorkforceEmploymentEvent({
      organizationId: ORG,
      recordedByUserId: "admin-1",
      event: eventInput,
      audit: { actorUserId: "admin-1", ipAddress: "203.0.113.7", userAgent: "vitest" },
      db: db as never,
    })

    expect(result).toMatchObject({ id: "employment-hire", kind: "HIRE", source: "HR_RECORDED" })
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EMPLOYMENT_EVENT_RECORDED",
        newData: expect.not.objectContaining({ reason: expect.anything() }),
      }),
    }))
  })

  it("refuses a rehire before a termination and refuses a backdated insertion", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgent.findFirst).mockResolvedValue({ id: AGENT } as never)
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([] as never)

    await expect(recordWorkforceEmploymentEvent({
      organizationId: ORG,
      recordedByUserId: "admin-1",
      event: WorkforceEmploymentEventCreateSchema.parse({ agentId: AGENT, kind: "REHIRE", effectiveAt: "2026-09-01T09:00:00.000Z" }),
      audit: { actorUserId: "admin-1" },
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceEmploymentHistoryError>>({
      code: "WORKFORCE_EMPLOYMENT_EVENT_TRANSITION_INVALID",
    })

    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{
      id: "employment-hire", kind: "HIRE", effectiveAt: new Date("2026-09-02T09:00:00.000Z"),
    }] as never)
    await expect(recordWorkforceEmploymentEvent({
      organizationId: ORG,
      recordedByUserId: "admin-1",
      event: WorkforceEmploymentEventCreateSchema.parse({ agentId: AGENT, kind: "TERMINATION", effectiveAt: "2026-09-01T09:00:00.000Z" }),
      audit: { actorUserId: "admin-1" },
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceEmploymentHistoryError>>({
      code: "WORKFORCE_EMPLOYMENT_EVENT_ORDER_INVALID",
    })
  })
})
