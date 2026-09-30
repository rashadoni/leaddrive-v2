import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { calendarPairSelect } from "@/lib/workforce/calendar-moved-day-pair"
import {
  WorkforceCalendarConfigurationError,
  createWorkforceCalendarMovedDay,
  createWorkforceCalendarOverride,
  listWorkforceCalendarOverrides,
  searchWorkforceCalendarAgents,
  searchWorkforceCalendarTeams,
} from "@/lib/workforce/calendar-configuration"
import {
  WorkforceCalendarConfigurationCreateSchema,
  WorkforceCalendarMovedDayCreateSchema,
  WorkforceCalendarOverrideCreateSchema,
} from "@/lib/workforce/calendar-configuration-contract"

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
  kind?: "PUBLIC_HOLIDAY" | "COMPANY_HOLIDAY" | "EXCEPTION_WORKDAY" | "MOVED_WORKDAY" | "MOVED_DAY_OFF"
  name?: string
  movedToDate?: string | null
  routePlanningAllowed?: boolean
  source?: string
  teamId?: string | null
  agentId?: string | null
} = {}) {
  return {
    id: input.id ?? "calendar-1",
    date: new Date(`${input.date ?? "2026-10-05"}T00:00:00.000Z`),
    kind: input.kind ?? "COMPANY_HOLIDAY",
    name: input.name ?? "Company day",
    teamId: input.teamId ?? null,
    agentId: input.agentId ?? null,
    movedToDate: input.movedToDate ? new Date(`${input.movedToDate}T00:00:00.000Z`) : null,
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
    expect(WorkforceCalendarOverrideCreateSchema.parse({
      scope: "AGENT",
      agentId: "agent-one",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "Personal schedule exception",
    })).toMatchObject({ scope: "AGENT", agentId: "agent-one" })
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
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      scope: "AGENT",
      teamId: "team-north",
      agentId: "agent-one",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "Mixed target",
    })).toThrow()
    expect(() => WorkforceCalendarOverrideCreateSchema.parse({
      scope: "AGENT",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY",
      name: "Missing employee",
    })).toThrow(/active employee/i)
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
      { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day", pairedDate: null },
      { date: "2026-10-06", kind: "PUBLIC_HOLIDAY", name: "Public day", pairedDate: null },
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
      select: calendarPairSelect,
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
      { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "North team day", pairedDate: null },
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

  it("lists one tenant-owned employee scope without mixing organization or team rows", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({ agentId: "agent-one", name: "Personal schedule exception" }),
    ] as never)

    await expect(listWorkforceCalendarOverrides({
      organizationId,
      currentDate: "2026-09-29",
      start: "2026-10-01",
      endExclusive: "2026-11-01",
      scope: "AGENT",
      agentId: "agent-one",
    })).resolves.toEqual([
      { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Personal schedule exception", pairedDate: null },
    ])

    expect(prisma.mtmWorkCalendarDay.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId,
        teamId: null,
        agentId: "agent-one",
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
      day: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Company day", pairedDate: null },
      team: null,
      agent: null,
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

  it("keeps the employee directory tenant-bound, PII-minimized and explicitly truncated", async () => {
    const agents = Array.from({ length: 101 }, (_, index) => ({
      id: `agent-${index}`,
      name: `Employee ${index}`,
      externalCode: index === 0 ? "EMP-001" : null,
      status: "ACTIVE",
      team: index === 0
        ? { id: "team-north", name: "North team", code: "NORTH", isActive: true }
        : null,
    }))
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(agents as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-selected",
      name: "Selected employee",
      externalCode: "EMP-SELECTED",
      status: "SUSPENDED",
      team: { id: "team-south", name: "South team", code: null, isActive: false },
    } as never)

    const result = await searchWorkforceCalendarAgents({
      organizationId,
      query: " employee ",
      selectedAgentId: "agent-selected",
    })
    expect(result).toMatchObject({
      query: "employee",
      limit: 100,
      hasMore: true,
      selectedAgent: {
        id: "agent-selected",
        name: "Selected employee",
        externalCode: "EMP-SELECTED",
        status: "SUSPENDED",
        currentTeam: { id: "team-south", name: "South team", isActive: false },
      },
      agents: expect.arrayContaining([{
        id: "agent-0",
        name: "Employee 0",
        externalCode: "EMP-001",
        status: "ACTIVE",
        currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
      }]),
    })
    expect(result.agents).toHaveLength(100)
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        status: "ACTIVE",
        OR: [
          { name: { contains: "employee", mode: "insensitive" } },
          { externalCode: { contains: "employee", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 101,
      select: {
        id: true,
        name: true,
        externalCode: true,
        status: true,
        team: { select: { id: true, name: true, code: true, isActive: true } },
      },
    })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { organizationId, id: "agent-selected" },
      select: {
        id: true,
        name: true,
        externalCode: true,
        status: true,
        team: { select: { id: true, name: true, code: true, isActive: true } },
      },
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

  it("locks an active tenant employee after the shared date lock and snapshots the current-team Route baseline", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "agent-one",
      name: "Employee One",
      externalCode: "EMP-001",
      status: "ACTIVE",
      teamId: "team-north",
      teamRecordId: "team-north",
      teamName: "North team",
      teamCode: "NORTH",
      teamIsActive: true,
    }] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({
        id: "organization-day",
        name: "Organization closure",
        routePlanningAllowed: false,
      }),
      persisted({
        id: "team-day",
        teamId: "team-north",
        name: "North route day",
        routePlanningAllowed: true,
      }),
    ] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockResolvedValue(persisted({
      id: "agent-day",
      agentId: "agent-one",
      name: "Personal schedule exception",
      routePlanningAllowed: true,
    }) as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        scope: "AGENT",
        agentId: "agent-one",
        date: "2026-10-05",
        kind: "COMPANY_HOLIDAY",
        name: "Personal schedule exception",
      },
      audit,
    })).resolves.toEqual({
      day: { date: "2026-10-05", kind: "COMPANY_HOLIDAY", name: "Personal schedule exception", pairedDate: null },
      team: null,
      agent: {
        id: "agent-one",
        name: "Employee One",
        externalCode: "EMP-001",
        status: "ACTIVE",
        currentTeam: { id: "team-north", name: "North team", code: "NORTH", isActive: true },
      },
      created: true,
    })

    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0])
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.mtmWorkCalendarDay.findMany.mock.invocationCallOrder[0])
    const rowLock = prisma.$queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[] }
    expect(rowLock.strings?.join(" ")).toContain('FOR SHARE OF agent')
    expect(rowLock.strings?.join(" ")).toContain('agent."status" = \'ACTIVE\'')
    expect(prisma.mtmWorkCalendarDay.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId,
        OR: [
          { teamId: null, agentId: "agent-one" },
          { teamId: null, agentId: null },
          { teamId: "team-north", agentId: null },
        ],
      }),
    }))
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: null,
        agentId: "agent-one",
        routePlanningAllowed: true,
        source: "ADMIN",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId,
        agentId: "agent-one",
        actorUserId: createdByUserId,
        newData: expect.objectContaining({
          scope: "AGENT",
          agentId: "agent-one",
          agentName: "Employee One",
          agentExternalCode: "EMP-001",
          currentTeamId: "team-north",
          routePlanningBaseline: true,
        }),
      }),
    })
  })

  it("replays only an exact ADMIN employee state and never replaces request-created personal rows", async () => {
    const lockedAgent = {
      id: "agent-one",
      name: "Employee One",
      externalCode: null,
      status: "ACTIVE",
      teamId: null,
      teamRecordId: null,
      teamName: null,
      teamCode: null,
      teamIsActive: null,
    }
    vi.mocked(prisma.$queryRaw).mockResolvedValue([lockedAgent] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValueOnce([
      persisted({
        id: "agent-day",
        agentId: "agent-one",
        name: "Personal schedule exception",
        routePlanningAllowed: true,
      }),
    ] as never)

    const draft = {
      scope: "AGENT" as const,
      agentId: "agent-one",
      date: "2026-10-05",
      kind: "COMPANY_HOLIDAY" as const,
      name: "Personal schedule exception",
    }
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft,
      audit,
    })).resolves.toMatchObject({ created: false, agent: { id: "agent-one" } })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(prisma.$queryRaw).mockResolvedValue([lockedAgent] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValueOnce([
      persisted({
        id: "approved-absence",
        agentId: "agent-one",
        name: "Personal schedule exception",
        routePlanningAllowed: true,
        source: "WORKFORCE_ABSENCE",
      }),
    ] as never)
    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("makes missing, inactive, suspended and cross-tenant employee targets indistinguishable", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)

    await expect(createWorkforceCalendarOverride({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        scope: "AGENT",
        agentId: "agent-unavailable",
        date: "2026-10-05",
        kind: "COMPANY_HOLIDAY",
        name: "Unavailable employee day",
      },
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE" })

    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})

describe("Workforce atomic moved-day configuration", () => {
  const organizationDraft = {
    operation: "MOVE_WORKDAY" as const,
    scope: "ORGANIZATION" as const,
    sourceDate: "2026-10-05",
    destinationDate: "2026-10-10",
    name: "Holiday workday move",
  }

  it("accepts only one strict organization/team operation with two distinct real dates", () => {
    expect(WorkforceCalendarMovedDayCreateSchema.parse(organizationDraft)).toEqual(organizationDraft)
    expect(WorkforceCalendarConfigurationCreateSchema.parse({
      ...organizationDraft,
      scope: "TEAM",
      teamId: "team-north",
    })).toMatchObject({ operation: "MOVE_WORKDAY", scope: "TEAM", teamId: "team-north" })
    for (const invalid of [
      { ...organizationDraft, scope: "AGENT", agentId: "agent-one" },
      { ...organizationDraft, scope: "TEAM" },
      { ...organizationDraft, teamId: "team-north" },
      { ...organizationDraft, destinationDate: organizationDraft.sourceDate },
      { ...organizationDraft, kind: "MOVED_DAY_OFF" },
      { ...organizationDraft, movedToDate: organizationDraft.destinationDate },
      { ...organizationDraft, routePlanningAllowed: false },
    ]) {
      expect(() => WorkforceCalendarConfigurationCreateSchema.parse(invalid)).toThrow()
    }
  })

  it("rejects a runtime employee-scope draft before opening a transaction", async () => {
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        ...organizationDraft,
        scope: "AGENT",
        agentId: "agent-one",
      } as never,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns reciprocal paired dates in the minimized future inventory", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({
        date: organizationDraft.sourceDate,
        kind: "MOVED_DAY_OFF",
        movedToDate: organizationDraft.destinationDate,
      }),
      persisted({
        id: "calendar-2",
        date: organizationDraft.destinationDate,
        kind: "MOVED_WORKDAY",
        movedToDate: organizationDraft.sourceDate,
      }),
    ] as never)

    await expect(listWorkforceCalendarOverrides({
      organizationId,
      currentDate: "2026-09-29",
      start: "2026-10-01",
      endExclusive: "2026-11-01",
      scope: "ORGANIZATION",
    })).resolves.toEqual([
      {
        date: organizationDraft.sourceDate,
        kind: "MOVED_DAY_OFF",
        name: "Company day",
        pairedDate: organizationDraft.destinationDate,
      },
      {
        date: organizationDraft.destinationDate,
        kind: "MOVED_WORKDAY",
        name: "Company day",
        pairedDate: organizationDraft.sourceDate,
      },
    ])
  })

  it("locks both dates deterministically and creates one atomic organization pair plus audit", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create)
      .mockResolvedValueOnce(persisted({
        id: "moved-off",
        date: organizationDraft.sourceDate,
        kind: "MOVED_DAY_OFF",
        name: organizationDraft.name,
        movedToDate: organizationDraft.destinationDate,
        routePlanningAllowed: true,
      }) as never)
      .mockResolvedValueOnce(persisted({
        id: "moved-workday",
        date: organizationDraft.destinationDate,
        kind: "MOVED_WORKDAY",
        name: organizationDraft.name,
        movedToDate: organizationDraft.sourceDate,
        routePlanningAllowed: false,
      }) as never)

    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).resolves.toEqual({
      days: [
        {
          date: organizationDraft.sourceDate,
          kind: "MOVED_DAY_OFF",
          name: organizationDraft.name,
          pairedDate: organizationDraft.destinationDate,
        },
        {
          date: organizationDraft.destinationDate,
          kind: "MOVED_WORKDAY",
          name: organizationDraft.name,
          pairedDate: organizationDraft.sourceDate,
        },
      ],
      team: null,
      created: true,
    })

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(prisma.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      `workforce-calendar-configuration:${organizationId}:2026-10-05`,
      `workforce-calendar-configuration:${organizationId}:2026-10-10`,
    ])
    expect(prisma.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prisma.mtmWorkCalendarDay.findMany.mock.invocationCallOrder[0],
    )
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        date: new Date("2026-10-05T00:00:00.000Z"),
        kind: "MOVED_DAY_OFF",
        movedToDate: new Date("2026-10-10T00:00:00.000Z"),
        routePlanningAllowed: true,
        source: "ADMIN",
      }),
    }))
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        date: new Date("2026-10-10T00:00:00.000Z"),
        kind: "MOVED_WORKDAY",
        movedToDate: new Date("2026-10-05T00:00:00.000Z"),
        routePlanningAllowed: false,
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "WORKFORCE_CALENDAR_MOVED_DAY_CREATED",
        entity: "work_calendar_pair",
        entityId: "moved-off",
        newData: expect.objectContaining({
          operation: "MOVE_WORKDAY",
          sourceDate: "2026-10-05",
          destinationDate: "2026-10-10",
          sourceRoutePlanningBaseline: true,
          destinationRoutePlanningBaseline: false,
        }),
      }),
    })
  })

  it("row-locks an active tenant team and freezes each organization Route baseline independently", async () => {
    const draft = { ...organizationDraft, scope: "TEAM" as const, teamId: "team-north" }
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "team-north",
      name: "North team",
      code: "NORTH",
      isActive: true,
    }] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      persisted({
        id: "organization-source",
        date: draft.sourceDate,
        kind: "EXCEPTION_WORKDAY",
        routePlanningAllowed: false,
      }),
      persisted({
        id: "organization-destination",
        date: draft.destinationDate,
        kind: "COMPANY_HOLIDAY",
        routePlanningAllowed: true,
      }),
    ] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create)
      .mockResolvedValueOnce(persisted({
        id: "team-moved-off",
        teamId: "team-north",
        date: draft.sourceDate,
        kind: "MOVED_DAY_OFF",
        name: draft.name,
        movedToDate: draft.destinationDate,
        routePlanningAllowed: false,
      }) as never)
      .mockResolvedValueOnce(persisted({
        id: "team-moved-workday",
        teamId: "team-north",
        date: draft.destinationDate,
        kind: "MOVED_WORKDAY",
        name: draft.name,
        movedToDate: draft.sourceDate,
        routePlanningAllowed: true,
      }) as never)

    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft,
      audit,
    })).resolves.toMatchObject({ created: true, team: { id: "team-north" } })

    const teamLock = prisma.$queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[] }
    expect(teamLock.strings?.join(" ")).toContain("FOR SHARE OF team")
    expect(teamLock.strings?.join(" ")).toContain('team."organizationId"')
    expect(prisma.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0])
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.mtmWorkCalendarDay.findMany.mock.invocationCallOrder[0],
    )
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ teamId: "team-north", routePlanningAllowed: false }),
    }))
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ teamId: "team-north", routePlanningAllowed: true }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newData: expect.objectContaining({
          scope: "TEAM",
          teamId: "team-north",
          teamName: "North team",
          sourceRoutePlanningBaseline: false,
          destinationRoutePlanningBaseline: true,
        }),
      }),
    })
  })

  it("replays only an exact reciprocal ADMIN pair and rejects partial or foreign provenance", async () => {
    const source = persisted({
      id: "moved-off",
      date: organizationDraft.sourceDate,
      kind: "MOVED_DAY_OFF",
      name: organizationDraft.name,
      movedToDate: organizationDraft.destinationDate,
    })
    const destination = persisted({
      id: "moved-workday",
      date: organizationDraft.destinationDate,
      kind: "MOVED_WORKDAY",
      name: organizationDraft.name,
      movedToDate: organizationDraft.sourceDate,
      routePlanningAllowed: false,
    })
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([source, destination] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).resolves.toMatchObject({ created: false })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([source] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      { ...source, source: "WORKFORCE_CONFIG" },
      destination,
    ] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([
      { ...source, routePlanningAllowed: null },
      destination,
    ] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
  })

  it("requires a working source and non-working destination before either row is written", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        ...organizationDraft,
        sourceDate: "2026-10-04",
        destinationDate: "2026-10-10",
      },
      audit,
    })).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_SOURCE_NOT_WORKING",
    })

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: {
        ...organizationDraft,
        sourceDate: "2026-10-05",
        destinationDate: "2026-10-06",
      },
      audit,
    })).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DESTINATION_NOT_NON_WORKING",
    })
    expect(prisma.mtmWorkCalendarDay.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails before a transaction for invalid horizons and maps unique/audit failures atomically", async () => {
    for (const draft of [
      { ...organizationDraft, sourceDate: "2026-09-29" },
      { ...organizationDraft, destinationDate: "2027-10-03" },
      { ...organizationDraft, destinationDate: organizationDraft.sourceDate },
    ]) {
      await expect(createWorkforceCalendarMovedDay({
        organizationId,
        createdByUserId,
        currentDate: "2026-09-29",
        draft,
        audit,
      })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID" })
    }
    expect(prisma.$transaction).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create).mockRejectedValueOnce({ code: "P2002" })
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS" })

    vi.clearAllMocks()
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmWorkCalendarDay.create)
      .mockResolvedValueOnce(persisted({
        id: "moved-off",
        date: organizationDraft.sourceDate,
        kind: "MOVED_DAY_OFF",
        name: organizationDraft.name,
        movedToDate: organizationDraft.destinationDate,
      }) as never)
      .mockResolvedValueOnce(persisted({
        id: "moved-workday",
        date: organizationDraft.destinationDate,
        kind: "MOVED_WORKDAY",
        name: organizationDraft.name,
        movedToDate: organizationDraft.sourceDate,
        routePlanningAllowed: false,
      }) as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(new Error("audit unavailable"))
    await expect(createWorkforceCalendarMovedDay({
      organizationId,
      createdByUserId,
      currentDate: "2026-09-29",
      draft: organizationDraft,
      audit,
    })).rejects.toThrow("audit unavailable")
    expect(prisma.mtmWorkCalendarDay.create).toHaveBeenCalledTimes(2)
  })
})
