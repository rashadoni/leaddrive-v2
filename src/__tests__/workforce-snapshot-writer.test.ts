import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import {
  writeWorkforceSnapshots,
  writeWorkforceSnapshotsIfReadyInTransaction,
  writeWorkforceSnapshotsInTransaction,
} from "@/lib/workforce/snapshot-writer"

const RESOLUTION_AT = new Date("2026-08-31T13:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.workforcePolicySnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.workforceShiftSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
    id: "workday-1",
    agentId: "agent-1",
    workDate: new Date("2026-08-31T00:00:00.000Z"),
    startedAt: new Date("2026-08-31T08:00:00.000Z"),
  } as never)
})

describe("Workforce snapshot writer", () => {
  it("returns an existing immutable pair without re-resolving or writing", async () => {
    vi.mocked(prisma.workforcePolicySnapshot.findFirst).mockResolvedValue({ id: "policy-snapshot-1" } as never)
    vi.mocked(prisma.workforceShiftSnapshot.findFirst).mockResolvedValue({ id: "shift-snapshot-1" } as never)

    await expect(writeWorkforceSnapshots({
      organizationId: "org-workforce",
      workdayId: "workday-1",
      resolutionAt: RESOLUTION_AT,
    })).resolves.toEqual({
      kind: "already_present",
      policySnapshotId: "policy-snapshot-1",
      shiftSnapshotId: "shift-snapshot-1",
    })
    expect(prisma.workforcePolicy.findMany).not.toHaveBeenCalled()
    expect(prisma.workforcePolicySnapshot.create).not.toHaveBeenCalled()
  })

  it("creates both snapshots transactionally from the current policy and default shift", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-b" } as never)
    const policyDefinition = {
      expectedWorkSeconds: 28800,
      lateGraceSeconds: 300,
      undertimeToleranceSeconds: 300,
      overtimeThresholdSeconds: 900,
      longPauseThresholdSeconds: 3600,
    }
    const shiftDefinition = {
      startTime: "09:00",
      endTime: "18:00",
      timezone: "Asia/Baku",
      daysOfWeek: [1, 2, 3, 4, 5],
      plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
    }
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "policy-1",
      teamId: "team-b",
      version: 1,
      status: "ACTIVE",
      name: "Team B",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      retiredAt: null,
      definition: policyDefinition,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }] as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([{
      id: "shift-template-1",
      teamId: "team-b",
      isDefault: true,
      version: 1,
      status: "ACTIVE",
      timezone: "Asia/Baku",
      activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      retiredAt: null,
      definition: shiftDefinition,
      definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    }] as never)
    vi.mocked(prisma.workforcePolicySnapshot.create).mockResolvedValue({ id: "policy-snapshot-1" } as never)
    vi.mocked(prisma.workforceShiftSnapshot.create).mockResolvedValue({ id: "shift-snapshot-1" } as never)

    await expect(writeWorkforceSnapshots({
      organizationId: "org-workforce",
      workdayId: "workday-1",
      resolutionAt: RESOLUTION_AT,
    })).resolves.toMatchObject({ kind: "created" })
    expect(prisma.workforcePolicySnapshot.create).toHaveBeenCalled()
    expect(prisma.workforceShiftSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ definition: shiftDefinition }),
    }))
  })

  it("uses the caller transaction and its just-created workday without nesting a transaction", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: null } as never)
    const policyDefinition = {
      expectedWorkSeconds: 28800,
      lateGraceSeconds: 300,
      undertimeToleranceSeconds: 300,
      overtimeThresholdSeconds: 900,
      longPauseThresholdSeconds: null,
    }
    const shiftDefinition = {
      startTime: "09:00",
      endTime: "18:00",
      timezone: "Asia/Baku",
      daysOfWeek: [1, 2, 3, 4, 5],
    }
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([{
      id: "policy-1", teamId: null, version: 1, status: "ACTIVE", name: "Organization",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null,
      activatedAt: new Date("2026-08-01T00:00:00.000Z"), retiredAt: null,
      definition: policyDefinition, definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }] as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([{
      id: "shift-template-1", teamId: null, isDefault: true, version: 1, status: "ACTIVE",
      timezone: "Asia/Baku", activatedAt: new Date("2026-08-01T00:00:00.000Z"), retiredAt: null,
      definition: shiftDefinition, definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    }] as never)
    vi.mocked(prisma.workforcePolicySnapshot.create).mockResolvedValue({ id: "policy-snapshot-1" } as never)
    vi.mocked(prisma.workforceShiftSnapshot.create).mockResolvedValue({ id: "shift-snapshot-1" } as never)

    await expect(writeWorkforceSnapshotsInTransaction(prisma as never, {
      organizationId: "org-workforce",
      workdayId: "workday-1",
      workday: {
        id: "workday-1",
        agentId: "agent-1",
        workDate: new Date("2026-08-31T00:00:00.000Z"),
        startedAt: new Date("2026-08-31T08:00:00.000Z"),
      },
      resolutionAt: RESOLUTION_AT,
    })).resolves.toMatchObject({ kind: "created" })

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("keeps a pre-H3 tenant's accepted START snapshot-free when calculation setup is absent", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: null } as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([] as never)

    await expect(writeWorkforceSnapshotsIfReadyInTransaction(prisma as never, {
      organizationId: "org-workforce",
      workdayId: "workday-1",
      workday: {
        id: "workday-1",
        agentId: "agent-1",
        workDate: new Date("2026-08-31T00:00:00.000Z"),
        startedAt: new Date("2026-08-31T08:00:00.000Z"),
      },
      resolutionAt: RESOLUTION_AT,
    })).resolves.toEqual({ kind: "not_ready", reason: "POLICY_MISSING" })
    expect(prisma.workforcePolicySnapshot.create).not.toHaveBeenCalled()
    expect(prisma.workforceShiftSnapshot.create).not.toHaveBeenCalled()
  })
})
