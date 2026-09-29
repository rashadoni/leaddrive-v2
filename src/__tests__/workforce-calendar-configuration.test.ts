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
  searchWorkforceCalendarTeams,
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
  teamId?: string | null
} = {}) {
  return {
    id: input.id ?? "calendar-1",
    date: new Date(`${input.date ?? "2026-10-05"}T00:00:00.000Z`),
    kind: input.kind ?? "COMPANY_HOLIDAY",
    name: input.name ?? "Company day",
    teamId: input.teamId ?? null,
    agentId: null,
    movedToDate: null,
    routePlanningAllowed: input.routePlanningAllowed ?? true,
    source: input.source ?? "ADMIN",
  }
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce organization calendar configuration", () => {
  it("accepts only named, real-date, released override kinds and exact organization/team scopes", () => {
    expect(WorkforceCalendarOverrideCreateSchema.parse({
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "  Company day  ",
    })).toEqual({ scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" })
    expect(WorkforceCalendarOverrideCreateSchema.parse({
      scope: "TEAM",
      teamId: "team-north",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "North team day",
    })).toMatchObject({ scope: "TEAM", teamId: "team-north" })
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
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      scope: "TEAM",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "Missing team",
    })).toThrow(/active team/i)
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
      scope: "ORGANIZATION",
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

  it("lists one tenant-owned team scope without mixing organization or employee rows", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({ teamId: "team-north", name: "North team day" }),
    ] as never)

    await expect(listWorkforceCalendarOverrides({
      organizationId,
      currentDate: "2026-09-29",
      start: "2026-10-01",
      endExclusive: "2026-11-01",
      scope: "TEAM",
      teamId: "team-north",
    })).resolves.toEqual([
      { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "North team day" },
    ])

    expect(prisma.mtmWorkCalendarDay.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId,
        teamId: "team-north",
        agentId: null,
        deletedAt: null,
      }),
    }))
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
        scope: "ORGANIZATION",
        ...range,
      })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID" })
    }
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
  })

  it("creates a weekday exception with the no-override Route baseline and an atomic actor audit", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted() as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).resolves.toEqual({
      day: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      team: null,
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
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
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
      draft: { scope: "ORGANIZATION", date: "2026-10-10", kind: "EXCEPTION_WORKDAY", name: "Inventory day" },
      audit,
    })

    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ routePlanningAllowed: false }),
    }))
  })

  it("returns an exact locked state as a safe retry without a second write or audit", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([persisted()] as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).resolves.toMatchObject({ created: false })

    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects an organization replay whose stored Route flag differs from the independent baseline", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({ routePlanningAllowed: false }),
    ] as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })

    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed on a different existing state and on a concurrent unique conflict", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValueOnce([persisted({ name: "Different" })] as never)
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })

    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValueOnce([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockRejectedValueOnce({ code: "P2002" })
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toBeInstanceOf(WorkforceCalendarConfigurationError)
  })

  it("rejects today before opening a transaction and propagates audit failure", async () => {
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-10-05",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE" })
    expect(prisma.$transaction).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted() as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: { scope: "ORGANIZATION", date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day" },
      audit,
    })).rejects.toThrow("audit unavailable")
  })

  it("keeps the active team directory tenant-bound, named and explicitly truncated", async () => {
    const teams = Array.from({ length: 101 }, (_, index) => ({
      id: `team-${index}`,
      name: `Team ${index}`,
      code: index === 0 ? "NORTH" : null,
      isActive: true,
    }))
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue(teams as never)
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "team-selected",
      name: "Selected team",
      code: "SELECTED",
      isActive: false,
    } as never)

    const result = await searchWorkforceCalendarTeams({
      organizationId,
      query: " north ",
      selectedTeamId: "team-selected",
    })
    expect(result).toMatchObject({
      query: "north",
      limit: 100,
      hasMore: true,
      selectedTeam: { id: "team-selected", name: "Selected team", isActive: false },
      teams: expect.arrayContaining([{ id: "team-0", name: "Team 0", code: "NORTH", isActive: true }]),
    })
    expect(result.teams).toHaveLength(100)
    expect(prisma.mtmTeam.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { name: { contains: "north", mode: "insensitive" } },
          { code: { contains: "north", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 101,
      select: { id: true, name: true, code: true, isActive: true },
    })
    expect(prisma.mtmTeam.findFirst).toHaveBeenCalledWith({
      where: { organizationId, id: "team-selected" },
      select: { id: true, name: true, code: true, isActive: true },
    })
  })

  it("validates an active tenant team under the shared date lock and preserves the organization Route baseline", async () => {
    const organizationOverride = persisted({
      id: "organization-day",
      kind: "COMPANY_HOLIDAY",
      name: "Organization closure",
      routePlanningAllowed: false,
    })
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "team-north",
      name: "North team",
      code: "NORTH",
      isActive: true,
    } as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([organizationOverride] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted({
      id: "team-day",
      teamId: "team-north",
      kind: "EXCEPTION_WORKDAY",
      name: "North inventory",
      routePlanningAllowed: false,
    }) as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        scope: "TEAM",
        teamId: "team-north",
        date: "2026-10-05",
        kind: "EXCEPTION_WORKDAY",
        name: "North inventory",
      },
      audit,
    })).resolves.toMatchObject({
      created: true,
      team: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
    })

    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.$executeRaw.mock.calls[0]?.[1]).toBe(
      "workforce-calendar-configuration:org-workforce:2026-10-05",
    )
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.mtmTeam.findFirst.mock.invocationCallOrder[0])
    expect(prisma.mtmTeam.findFirst).toHaveBeenCalledWith({
      where: { organizationId, id: "team-north", isActive: true },
      select: { id: true, name: true, code: true, isActive: true },
    })
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: "team-north", routePlanningAllowed: false }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newData: expect.objectContaining({
          scope: "TEAM",
          teamId: "team-north",
          teamName: "North team",
          teamCode: "NORTH",
          routePlanningBaseline: false,
        }),
      }),
    })
  })

  it("replays an exact team state without a second row or audit", async () => {
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "team-north",
      name: "North team",
      code: "NORTH",
      isActive: true,
    } as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({
        id: "organization-day",
        kind: "COMPANY_HOLIDAY",
        name: "Organization closure",
        routePlanningAllowed: false,
      }),
      persisted({
        id: "team-day",
        teamId: "team-north",
        kind: "EXCEPTION_WORKDAY",
        name: "North inventory",
        routePlanningAllowed: false,
      }),
    ] as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        scope: "TEAM",
        teamId: "team-north",
        date: "2026-10-05",
        kind: "EXCEPTION_WORKDAY",
        name: "North inventory",
      },
      audit,
    })).resolves.toMatchObject({ created: false, team: { id: "team-north" } })

    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("makes missing, inactive and cross-tenant team targets indistinguishable before any write", async () => {
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue(null as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        scope: "TEAM",
        teamId: "team-unavailable",
        date: "2026-10-05",
        kind: "COMPANY_HOLIDAY",
        name: "Unavailable team day",
      },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE" })

    expect(prisma.mtmTeam.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId, id: "team-unavailable", isActive: true },
    }))
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
