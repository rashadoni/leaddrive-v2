import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  resolveCurrentWorkforcePolicy,
  resolveWorkforcePolicy,
  WorkforcePolicyResolutionError,
} from "@/lib/workforce/policy-resolution"

const ORGANIZATION_ID = "org-workforce"
const AGENT_ID = "agent-1"
const WORK_DATE = "2026-08-29"
const WORKDAY_STARTED_AT = new Date("2026-08-29T08:00:00.000Z")
const RESOLUTION_AT = new Date("2026-08-29T13:00:00.000Z")

function policy(id: string, teamId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    teamId,
    version: 1,
    status: "ACTIVE",
    name: id,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: { expectedWorkSeconds: 8 * 60 * 60 },
    definitionHash: "a".repeat(64),
    ...overrides,
  }
}

function input(
  overrides: Partial<Parameters<typeof resolveWorkforcePolicy>[0]> = {},
): Parameters<typeof resolveWorkforcePolicy>[0] {
  return {
    workDate: WORK_DATE,
    workdayStartedAt: WORKDAY_STARTED_AT,
    resolutionAt: RESOLUTION_AT,
    teamMembershipId: "membership-b",
    teamIdAtWorkday: "team-b",
    policies: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([])
})

describe("Workforce policy resolution", () => {
  it("uses the matching historical team policy before the organization fallback", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [policy("org-policy", null), policy("team-b-policy", "team-b")],
    }))

    expect(result).toMatchObject({ id: "team-b-policy", scope: "TEAM" })
  })

  it("uses the team recorded at workday start rather than a later transfer", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [
        policy("org-policy", null),
        policy("team-a-policy", "team-a"),
        policy("team-b-policy", "team-b"),
      ],
      teamMembershipId: "membership-a",
      teamIdAtWorkday: "team-a",
    }))

    expect(result).toMatchObject({
      id: "team-a-policy", scope: "TEAM", teamMembershipId: "membership-a", teamIdAtWorkday: "team-a",
    })
  })

  it("falls back to exactly one organization policy and fails closed on overlap", () => {
    expect(resolveWorkforcePolicy(input({
      policies: [policy("org-policy", null), policy("team-a-policy", "team-a")],
    }))).toMatchObject({ id: "org-policy", scope: "ORGANIZATION" })

    expect(() => resolveWorkforcePolicy(input({
      policies: [policy("team-b-policy-1", "team-b"), policy("team-b-policy-2", "team-b")],
    }))).toThrow(WorkforcePolicyResolutionError)
  })

  it("does not let a team policy activated after workday start displace the organization fallback", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [
        policy("org-policy", null),
        policy("team-b-policy", "team-b", { activatedAt: new Date("2026-08-29T12:00:00.000Z") }),
      ],
    }))

    expect(result).toMatchObject({ id: "org-policy", scope: "ORGANIZATION" })
  })

  it("does not let a future-activated team policy displace the organization fallback", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [
        policy("org-policy", null),
        policy("future-team-b-policy", "team-b", { activatedAt: new Date("2026-08-29T14:00:00.000Z") }),
      ],
    }))

    expect(result).toMatchObject({ id: "org-policy", scope: "ORGANIZATION" })
  })

  it("does not substitute a later organization policy for the historical policy", () => {
    let error: unknown
    try {
      resolveWorkforcePolicy(input({
        teamMembershipId: null,
        teamIdAtWorkday: null,
        policies: [policy("later-org-policy", null, { activatedAt: new Date("2026-08-29T12:00:00.000Z") })],
      }))
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: "WORKFORCE_POLICY_MISSING" })
  })

  it("accepts an organization policy retired after the workday began", () => {
    const result = resolveWorkforcePolicy(input({
      teamMembershipId: null,
      teamIdAtWorkday: null,
      policies: [policy("retired-org-policy", null, {
        status: "RETIRED",
        retiredAt: new Date("2026-08-29T10:00:00.000Z"),
      })],
    }))

    expect(result).toMatchObject({ id: "retired-org-policy", scope: "ORGANIZATION" })
  })

  it("loads relevant effective policies for the employee's historical team membership", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{
      id: "membership-a", teamId: "team-a", effectiveAt: new Date("2026-08-29T07:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy("org-policy", null),
      policy("team-a-policy", "team-a"),
    ] as never)

    const result = await resolveCurrentWorkforcePolicy(prisma, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-a-policy", scope: "TEAM", teamMembershipId: "membership-a" })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { id: AGENT_ID, organizationId: ORGANIZATION_ID },
      select: { id: true },
    })
    expect(prisma.workforcePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        status: { in: ["ACTIVE", "RETIRED"] },
        effectiveFrom: { lte: new Date("2026-08-29T00:00:00.000Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-08-29T00:00:00.000Z") } }],
        AND: [{ OR: [{ teamId: null }, { teamId: "team-a" }] }],
      }),
    }))
  })

  it("falls back safely when an older workday predates all known team history", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy("org-policy", null),
    ] as never)

    await expect(resolveCurrentWorkforcePolicy(prisma, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })).resolves.toMatchObject({ scope: "ORGANIZATION", teamMembershipId: null, teamIdAtWorkday: null })
    expect(prisma.workforcePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: [{ OR: [{ teamId: null }] }] }),
    }))
  })

  it("rejects invalid work dates, resolution times and unavailable employees with machine codes", async () => {
    expect(() => resolveWorkforcePolicy(input({ workDate: "2026-02-31" })))
      .toThrow("Workforce workDate must be YYYY-MM-DD")
    expect(() => resolveWorkforcePolicy(input({ resolutionAt: new Date(Number.NaN) })))
      .toThrow("Workforce policy resolution time is invalid")

    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
    await expect(resolveCurrentWorkforcePolicy(prisma, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })).rejects.toMatchObject({ code: "WORKFORCE_POLICY_AGENT_NOT_FOUND" })
  })
})
