import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import {
  resolveCurrentWorkforceShift,
  resolveWorkforceShiftTemplate,
  WorkforceShiftResolutionError,
} from "@/lib/workforce/shift-resolution"

const WORK_DATE = "2026-08-31"
const WORKDAY_STARTED_AT = new Date("2026-08-31T08:00:00.000Z")
const RESOLUTION_AT = new Date("2026-08-31T13:00:00.000Z")
const DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}

function template(id: string, teamId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    teamId,
    isDefault: false,
    version: 1,
    status: "ACTIVE",
    timezone: "Asia/Baku",
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: DEFINITION,
    definitionHash: workforceShiftDefinitionHash(DEFINITION),
    ...overrides,
  }
}

function input(overrides: Partial<Parameters<typeof resolveWorkforceShiftTemplate>[0]> = {}) {
  return {
    workDate: WORK_DATE,
    workdayStartedAt: WORKDAY_STARTED_AT,
    resolutionAt: RESOLUTION_AT,
    teamMembershipId: "membership-b",
    teamIdAtWorkday: "team-b",
    template: template("team-b-template", "team-b"),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce shift resolution", () => {
  it("resolves a selected historical-team template and its plan", () => {
    expect(resolveWorkforceShiftTemplate(input())).toMatchObject({
      id: "team-b-template",
      scope: "TEAM",
      schedule: {
        plannedStartAt: "2026-08-31T05:00:00.000Z",
        plannedEndAt: "2026-08-31T14:00:00.000Z",
      },
    })
  })

  it("uses the workday-start team after a delayed transfer and rejects the later team", () => {
    expect(() => resolveWorkforceShiftTemplate(input({
      teamMembershipId: "membership-a",
      teamIdAtWorkday: "team-a",
      template: template("team-b-template", "team-b"),
    }))).toThrow(WorkforceShiftResolutionError)
    expect(resolveWorkforceShiftTemplate(input({
      teamMembershipId: "membership-a",
      teamIdAtWorkday: "team-a",
      template: template("team-a-template", "team-a"),
    })).scope).toBe("TEAM")
  })

  it("requires a team template to be active by workday start", () => {
    expect(() => resolveWorkforceShiftTemplate(input({
      template: template("future-team-b-template", "team-b", {
        activatedAt: new Date("2026-08-31T14:00:00.000Z"),
      }),
    }))).toThrow("active for the workday start")
  })

  it("retains the historical lifecycle for an organization template", () => {
    expect(resolveWorkforceShiftTemplate(input({
      teamMembershipId: "membership-b",
      teamIdAtWorkday: "team-b",
      template: template("org-template", null, {
        status: "RETIRED",
        retiredAt: new Date("2026-08-31T10:00:00.000Z"),
      }),
    })).scope).toBe("ORGANIZATION")
  })

  it("fails closed on a definition hash mismatch", () => {
    expect(() => resolveWorkforceShiftTemplate(input({
      template: template("corrupt-template", "team-b", { definitionHash: "a".repeat(64) }),
    }))).toThrow("does not match its immutable hash")
  })

  it("loads an explicitly selected template with tenant scope", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-08-31T07:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(
      template("team-a-template", "team-a") as never,
    )

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      templateId: "team-a-template",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-a-template", scope: "TEAM", teamMembershipId: "membership-a" })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { id: "agent-1", organizationId: "org-workforce" },
      select: { id: true },
    })
    expect(prisma.workforceShiftTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "team-a-template", organizationId: "org-workforce" },
    }))
  })

  it("prefers the workday-start team's explicit default and falls back to an organization default", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-08-31T07:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([
      template("org-default", null, { isDefault: true }),
      template("team-a-default", "team-a", { isDefault: true }),
    ] as never)

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-a-default", scope: "TEAM", teamMembershipId: "membership-a" })
    expect(prisma.workforceShiftTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-workforce",
        status: { in: ["ACTIVE", "RETIRED"] },
        isDefault: true,
      }),
    }))
  })

  it("uses the organization default when the workday-start team has none", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-08-31T07:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([
      template("org-default", null, { isDefault: true }),
    ] as never)

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "org-default", scope: "ORGANIZATION" })
  })

  it("uses a dated default timeline before the legacy isDefault compatibility fallback", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.workforceShiftDefaultAssignment.findMany).mockResolvedValue([{
      id: "default-v2",
      template: template("org-default-v2", null),
    }] as never)

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({
      id: "org-default-v2", scope: "ORGANIZATION", assignmentId: null, defaultAssignmentId: "default-v2",
    })
    expect(prisma.workforceShiftTemplate.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceShiftDefaultAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce" }),
    }))
  })

  it("uses one effective-dated employee assignment before defaults and exposes its audit identity", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-08-31T07:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue([
      { id: "assignment-1", templateId: "assigned-template" },
    ] as never)
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(
      template("assigned-template", "team-a") as never,
    )

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({
      id: "assigned-template",
      assignmentId: "assignment-1",
      scope: "TEAM", teamMembershipId: "membership-a",
    })
    expect(prisma.workforceShiftTemplate.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceShiftAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce", agentId: "agent-1" }),
    }))
  })

  it("fails closed if corrupt storage exposes overlapping effective assignments", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue([
      { id: "assignment-1", templateId: "shift-a" },
      { id: "assignment-2", templateId: "shift-b" },
    ] as never)

    await expect(resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })).rejects.toMatchObject({ code: "WORKFORCE_SHIFT_ASSIGNMENT_AMBIGUOUS" })
  })
})
