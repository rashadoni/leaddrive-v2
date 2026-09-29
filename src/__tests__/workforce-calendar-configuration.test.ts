import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  WorkforceCalendarConfigurationError,
  createWorkforceCalendarOverride,
  listWorkforceCalendarOverrides,
} from "@/lib/workforce/calendar-configuration"
import { WorkforceCalendarOverrideCreateSchema } from "@/lib/workforce/calendar-configuration-contract"

const organizationId = "org-workforce"
const createdByUserId = "scheduler-1"
const audit = {
  actorUserId: createdByUserId,
  ipAddress: "203.0.113.11",
  userAgent: "Vitest calendar",
}

function persisted(input: {
  id?: string
  date?: string
  kind?: "PUBLIC_HOLIDAY" | "COMPANY_HOLIDAY" | "EXCEPTION_WORKDAY"
  name?: string
  routePlanningAllowed?: boolean
  source?: string
} = {}) {
  return {
    id: input.id ?? "calendar-1",
    date: new Date(`${input.date ?? "2026-10-05"}T00:00:00.000Z`),
    kind: input.kind ?? "COMPANY_HOLIDAY",
    name: input.name ?? "Company day",
    teamId: null,
    agentId: null,
    movedToDate: null,
    routePlanningAllowed: input.routePlanningAllowed ?? true,
    source: input.source ?? "ADMIN",
  }
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce organization calendar configuration", () => {
  it("accepts only named, real-date, released override kinds with no caller scope fields", () => {
    expect(WorkforceCalendarOverrideCreateSchema.parse({
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "  Company day  ",
    })).toEqual({ date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" })
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      date: "2026-02-30",
      kind: "PUBLIC_HOLIDAY",
      name: "Invalid date",
    })).toThrow(/real calendar date/i)
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      date: "2026-10-05",
      kind: "MOVED_WORKDAY",
      name: "Moved",
    })).toThrow()
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "Company day",
      teamId: "team-other",
    })).toThrow()
  })

  it("lists only tenant-owned active organization rows in a bounded future range", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted(),
      persisted({ id: "calendar-2", date: "2026-10-06", kind: "PUBLIC_HOLIDAY", name: "Public day" }),
    ] as never)

    await expect(listWorkforceCalendarOverrides({
      organizationId,
      currentDate: "2026-09-29",
      start: "2026-10-01",
      endExclusive: "2026-11-01",
    })).resolves.toEqual([
      { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      { date: "2026-10-06", kind: "PUBLIC_HOLIDAY", name: "Public day" },
    ])

    expect(prisma.mtmWorkCalendarDay.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        date: {
          gte: new Date("2026-10-01T00:00:00.000Z"),
          lt: new Date("2026-11-01T00:00:00.000Z"),
        },
        teamId: null,
        agentId: null,
        deletedAt: null,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { date: true, kind: true, name: true },
    })
  })

  it("rejects today, past and unbounded read windows before querying", async () => {
    for (const range of [
      { start: "2026-09-29", endExclusive: "2026-10-01" },
      { start: "2026-10-01", endExclusive: "2026-10-01" },
      { start: "2026-10-01", endExclusive: "2027-10-04" },
    ]) {
      await expect(listWorkforceCalendarOverrides({
        organizationId,
        currentDate: "2026-09-29",
        ...range,
      })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID" })
    }
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
  })

  it("creates a weekday exception with the no-override Route baseline and an atomic actor audit", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted() as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).resolves.toEqual({
      day: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      created: true,
    })

    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        date: new Date("2026-10-05T00:00:00.000Z"),
        kind: "COMPANY_HOLIDAY",
        name: "Company day",
        teamId: null,
        agentId: null,
        movedToDate: null,
        routePlanningAllowed: true,
        source: "ADMIN",
        createdBy: createdByUserId,
        updatedBy: createdByUserId,
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId,
        actorUserId: createdByUserId,
        action: "WORKFORCE_CALENDAR_OVERRIDE_CREATED",
        entity: "work_calendar_day",
        entityId: "calendar-1",
        metadataKind: "workforce_calendar_configuration",
        newData: expect.objectContaining({
          date: "2026-10-05",
          scope: "ORGANIZATION",
          source: "ADMIN",
          routePlanningBaseline: true,
        }),
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      }),
    })
  })

  it("preserves the weekend planning baseline instead of deriving it from HR kind", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted({
      date: "2026-10-10",
      kind: "EXCEPTION_WORKDAY",
      name: "Inventory day",
      routePlanningAllowed: false,
    }) as never)

    await createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-10", kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
      audit,
    })

    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ routePlanningAllowed: false }),
    }))
  })

  it("returns an exact locked state as a safe retry without a second write or audit", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue(persisted() as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).resolves.toMatchObject({ created: false })

    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed on a different existing state and on a concurrent unique conflict", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValueOnce(persisted({ name: "Different" }) as never)
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })

    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockRejectedValueOnce({ code: "P2002" })
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toBeInstanceOf(WorkforceCalendarConfigurationError)
  })

  it("rejects today before opening a transaction and propagates audit failure", async () => {
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-10-05",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE" })
    expect(prisma.$transaction).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmWorkCalendarDay.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted() as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toThrow("audit unavailable")
  })
})
