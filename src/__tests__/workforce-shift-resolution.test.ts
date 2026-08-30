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
    currentTeamId: "team-b",
    template: template("team-b-template", "team-b"),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce shift resolution", () => {
  it("resolves a selected current-team template and its plan", () => {
    expect(resolveWorkforceShiftTemplate(input())).toMatchObject({
      id: "team-b-template",
      scope: "TEAM",
      schedule: {
        plannedStartAt: "2026-08-31T05:00:00.000Z",
        plannedEndAt: "2026-08-31T14:00:00.000Z",
      },
    })
  })

  it("uses the current team after a delayed transfer and rejects the old team", () => {
    expect(() => resolveWorkforceShiftTemplate(input({
      template: template("team-a-template", "team-a"),
    }))).toThrow(WorkforceShiftResolutionError)
    expect(resolveWorkforceShiftTemplate(input({
      template: template("team-b-template", "team-b"),
    })).scope).toBe("TEAM")
  })

  it("requires a team template to be active by server resolution", () => {
    expect(() => resolveWorkforceShiftTemplate(input({
      template: template("future-team-b-template", "team-b", {
        activatedAt: new Date("2026-08-31T14:00:00.000Z"),
      }),
    }))).toThrow("active at server processing")
  })

  it("retains the historical lifecycle for an organization template", () => {
    expect(resolveWorkforceShiftTemplate(input({
      currentTeamId: "team-b",
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
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(
      template("team-b-template", "team-b") as never,
    )

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      templateId: "team-b-template",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-b-template", scope: "TEAM" })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { id: "agent-1", organizationId: "org-workforce" },
      select: { id: true, teamId: true },
    })
    expect(prisma.workforceShiftTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "team-b-template", organizationId: "org-workforce" },
    }))
  })

  it("prefers the current team's explicit default and falls back to an organization default", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([
      template("org-default", null, { isDefault: true }),
      template("team-b-default", "team-b", { isDefault: true }),
    ] as never)

    const result = await resolveCurrentWorkforceShift(prisma, {
      organizationId: "org-workforce",
      agentId: "agent-1",
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-b-default", scope: "TEAM" })
    expect(prisma.workforceShiftTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-workforce",
        status: "ACTIVE",
        isDefault: true,
      }),
    }))
  })

  it("uses the organization default when the current team has none", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
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
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
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
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
    vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue([
      { id: "assignment-1", templateId: "assigned-template" },
    ] as never)
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(
      template("assigned-template", "team-b") as never,
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
      scope: "TEAM",
    })
    expect(prisma.workforceShiftTemplate.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceShiftAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce", agentId: "agent-1" }),
    }))
  })

  it("fails closed if corrupt storage exposes overlapping effective assignments", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
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
