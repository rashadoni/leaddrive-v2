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
    currentTeamId: "team-b",
    policies: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([])
})

describe("Workforce policy resolution", () => {
  it("uses the matching current team policy before the organization fallback", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [policy("org-policy", null), policy("team-b-policy", "team-b")],
    }))

    expect(result).toMatchObject({ id: "team-b-policy", scope: "TEAM" })
  })

  it("treats a delayed offline workday as belonging to the team current at server processing", () => {
    const result = resolveWorkforcePolicy(input({
      // The owner selected the new team B after a transfer, rather than an
      // unrecorded historical team from when the device was offline.
      policies: [
        policy("org-policy", null),
        policy("team-a-policy", "team-a"),
        policy("team-b-policy", "team-b"),
      ],
    }))

    expect(result).toMatchObject({ id: "team-b-policy", scope: "TEAM" })
  })

  it("falls back to exactly one organization policy and fails closed on overlap", () => {
    expect(resolveWorkforcePolicy(input({
      policies: [policy("org-policy", null), policy("team-a-policy", "team-a")],
    }))).toMatchObject({ id: "org-policy", scope: "ORGANIZATION" })

    expect(() => resolveWorkforcePolicy(input({
      policies: [policy("team-b-policy-1", "team-b"), policy("team-b-policy-2", "team-b")],
    }))).toThrow(WorkforcePolicyResolutionError)
  })

  it("uses a team policy activated after the offline workday began but before server resolution", () => {
    const result = resolveWorkforcePolicy(input({
      policies: [
        policy("org-policy", null),
        policy("team-b-policy", "team-b", { activatedAt: new Date("2026-08-29T12:00:00.000Z") }),
      ],
    }))

    expect(result).toMatchObject({ id: "team-b-policy", scope: "TEAM" })
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
        currentTeamId: null,
        policies: [policy("later-org-policy", null, { activatedAt: new Date("2026-08-29T12:00:00.000Z") })],
      }))
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: "WORKFORCE_POLICY_MISSING" })
  })

  it("accepts an organization policy retired after the workday began", () => {
    const result = resolveWorkforcePolicy(input({
      currentTeamId: null,
      policies: [policy("retired-org-policy", null, {
        status: "RETIRED",
        retiredAt: new Date("2026-08-29T10:00:00.000Z"),
      })],
    }))

    expect(result).toMatchObject({ id: "retired-org-policy", scope: "ORGANIZATION" })
  })

  it("loads relevant effective policies for the agent's current tenant-local team", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID, teamId: "team-b" } as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy("org-policy", null),
      policy("team-b-policy", "team-b"),
    ] as never)

    const result = await resolveCurrentWorkforcePolicy(prisma, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workDate: WORK_DATE,
      workdayStartedAt: WORKDAY_STARTED_AT,
      resolutionAt: RESOLUTION_AT,
    })

    expect(result).toMatchObject({ id: "team-b-policy", scope: "TEAM" })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { id: AGENT_ID, organizationId: ORGANIZATION_ID, status: "ACTIVE" },
      select: { id: true, teamId: true },
    })
    expect(prisma.workforcePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        status: { in: ["ACTIVE", "RETIRED"] },
        effectiveFrom: { lte: new Date("2026-08-29T00:00:00.000Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-08-29T00:00:00.000Z") } }],
        AND: [{ OR: [{ teamId: null }, { teamId: "team-b" }] }],
      }),
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
