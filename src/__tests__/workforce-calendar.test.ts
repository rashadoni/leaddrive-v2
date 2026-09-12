import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  resolvePersistedWorkforceCalendarDay,
  resolveWorkforceCalendarDay,
  WorkforceCalendarResolutionError,
} from "@/lib/workforce/calendar"

const DATE = "2026-09-01"

describe("Workforce calendar semantics", () => {
  it("separates an ordinary scheduled day, non-working weekend and public holiday", () => {
    expect(resolveWorkforceCalendarDay({ date: "2026-09-01", overrides: [] })).toMatchObject({
      state: "SCHEDULED", attendanceExpected: true, noShowEligible: true,
    })
    expect(resolveWorkforceCalendarDay({ date: "2026-09-05", overrides: [] })).toMatchObject({
      state: "NON_WORKING", attendanceExpected: false, noShowEligible: false,
    })
    expect(resolveWorkforceCalendarDay({
      date: DATE,
      overrides: [{
        id: "public-holiday", date: DATE, kind: "PUBLIC_HOLIDAY", name: "Holiday",
        teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null,
      }],
    })).toMatchObject({
      state: "PUBLIC_HOLIDAY", attendanceExpected: false, noShowEligible: false, excused: false,
    })
  })

  it("recognizes only explicit Workforce request sources as approved leave or absence", () => {
    const base = {
      id: "leave", date: DATE, kind: "COMPANY_HOLIDAY" as const, name: "Approved leave",
      teamId: null, agentId: "agent-1", movedToDate: null, routePlanningAllowed: false,
    }
    expect(resolveWorkforceCalendarDay({
      date: DATE, agentId: "agent-1", overrides: [{ ...base, source: "WORKFORCE_LEAVE" }],
    })).toMatchObject({ state: "APPROVED_LEAVE", excused: true, noShowEligible: false })
    expect(resolveWorkforceCalendarDay({
      date: DATE, agentId: "agent-1", overrides: [{ ...base, source: "WORKFORCE_ABSENCE" }],
    })).toMatchObject({ state: "APPROVED_ABSENCE", excused: true, noShowEligible: false })
    expect(resolveWorkforceCalendarDay({
      date: DATE, agentId: "agent-1", overrides: [{ ...base, source: "HRM" }],
    })).toMatchObject({ state: "PERSONAL_EXCEPTION", excused: true, noShowEligible: false })
  })

  it("loads only the employee, team and organization candidates before resolving precedence", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([{
      id: "team-closure", date: new Date("2026-09-01T00:00:00.000Z"), kind: "COMPANY_HOLIDAY",
      name: "Office closed", teamId: "team-1", agentId: null, movedToDate: null,
      routePlanningAllowed: false, source: "WORKFORCE_CONFIG",
    }] as never)

    await expect(resolvePersistedWorkforceCalendarDay(prisma as never, {
      organizationId: "org-1", agentId: "agent-1", date: DATE,
    })).resolves.toMatchObject({ state: "TENANT_CLOSURE", attendanceExpected: false })
    expect(prisma.mtmWorkCalendarDay.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        date: new Date("2026-09-01T00:00:00.000Z"),
        OR: expect.arrayContaining([
          { agentId: "agent-1", teamId: null },
          { agentId: null, teamId: "team-1" },
          { agentId: null, teamId: null },
        ]),
      }),
    }))
  })

  it("fails closed for impossible dates and unavailable employees", async () => {
    expect(() => resolveWorkforceCalendarDay({ date: "2026-02-30", overrides: [] })).toThrowError(
      WorkforceCalendarResolutionError,
    )
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockClear()
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
    await expect(resolvePersistedWorkforceCalendarDay(prisma as never, {
      organizationId: "org-1", agentId: "agent-missing", date: DATE,
    })).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_AGENT_NOT_FOUND" })
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
  })
})
