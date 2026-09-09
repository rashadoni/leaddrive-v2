import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  disableWorkforceMobileWriteCohort,
  evaluateWorkforceMobileWriteAccess,
  setWorkforceMobileWriteFence,
  upsertWorkforceMobileWriteCohort,
  WorkforceMobileWriteFenceError,
  WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
} from "@/lib/workforce/mobile-write-fence"

const AUTH = { orgId: "org-1", agentId: "agent-1" }
const NOW = new Date("2026-08-29T12:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncCohort.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
})

describe("Workforce mobile write fence", () => {
  it("keeps legacy mobile writes allowed when no tenant fence exists", async () => {
    await expect(evaluateWorkforceMobileWriteAccess({
      auth: AUTH,
      deviceId: "device-1",
      now: NOW,
    })).resolves.toEqual({
      allowed: true,
      mode: "LEGACY_ALLOWED",
      deviceId: "device-1",
      cohortEpoch: null,
    })
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("holds the shared tenant fence lock through a transaction-scoped decision", async () => {
    await expect(evaluateWorkforceMobileWriteAccess({
      auth: AUTH,
      deviceId: "device-1",
      now: NOW,
      tx: prisma as never,
    })).resolves.toMatchObject({ allowed: true, mode: "LEGACY_ALLOWED" })

    const lockCall = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[0].join("?")).toContain("pg_advisory_xact_lock_shared")
    expect(lockCall[1]).toBe(`workforce-mobile-write-fence:${AUTH.orgId}`)
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.workforceMobileWriteFence.findUnique).mock.invocationCallOrder[0])
  })

  it("fails mobile Workforce writes closed when the tenant is frozen", async () => {
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue({ mode: "FROZEN" } as never)

    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "device-1", now: NOW }))
      .resolves.toMatchObject({
        allowed: false,
        mode: "FROZEN",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      })
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("requires an exact enabled and unexpired device in cohort-only mode", async () => {
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue({ mode: "COHORT_ONLY" } as never)
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-29T11:00:00.000Z"),
    } as never)

    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "device-1", now: NOW }))
      .resolves.toEqual({
        allowed: true,
        mode: "COHORT_ONLY",
        deviceId: "device-1",
        cohortEpoch: "2026-08-29T11:00:00.000Z",
      })
    expect(prisma.mtmMobileSyncCohort.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: AUTH.orgId,
        agentId: AUTH.agentId,
        deviceId: "device-1",
        stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
      }),
    }))
  })

  it("does not trust a missing, malformed, or unenrolled device selector in cohort-only mode", async () => {
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue({ mode: "COHORT_ONLY" } as never)

    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: null, now: NOW }))
      .resolves.toMatchObject({ allowed: false, code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED", deviceId: null })
    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "not a stable id", now: NOW }))
      .resolves.toMatchObject({ allowed: false, code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED", deviceId: null })
    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "other-device", now: NOW }))
      .resolves.toMatchObject({ allowed: false, code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED", deviceId: "other-device" })
  })

  it("uses legacy behavior only while the new additive fence table is absent", async () => {
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockRejectedValue({ code: "P2021" } as never)

    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "device-1", now: NOW })).resolves.toMatchObject({
      allowed: true,
      mode: "LEGACY_ALLOWED",
    })
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("does not degrade a configured cohort-only tenant on a cohort lookup failure", async () => {
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue({ mode: "COHORT_ONLY" } as never)
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockRejectedValue(new Error("database unavailable") as never)

    await expect(evaluateWorkforceMobileWriteAccess({ auth: AUTH, deviceId: "device-1", now: NOW }))
      .rejects.toThrow("database unavailable")
  })

  it("refuses cohort-only mode until an active server cohort exists", async () => {
    await expect(setWorkforceMobileWriteFence({
      organizationId: AUTH.orgId,
      actorUserId: "admin-1",
      update: { mode: "COHORT_ONLY" },
    })).rejects.toMatchObject({ code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED" })
    expect(prisma.workforceMobileWriteFence.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("creates an exact cohort only for an active employee and audits a device hash", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AUTH.agentId } as never)
    vi.mocked(prisma.mtmMobileSyncCohort.create).mockResolvedValue({
      id: "cohort-1",
      agentId: AUTH.agentId,
      deviceId: "device-1",
      enabled: true,
      expiresAt: null,
      updatedAt: NOW,
    } as never)

    const result = await upsertWorkforceMobileWriteCohort({
      organizationId: AUTH.orgId,
      actorUserId: "admin-1",
      cohort: { agentId: AUTH.agentId, deviceId: "device-1", expiresAt: null },
      audit: { ipAddress: "203.0.113.42", userAgent: "vitest" },
    })

    expect(result).toMatchObject({ id: "cohort-1", deviceId: "device-1", enabled: true })
    expect(prisma.mtmMobileSyncCohort.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        agentId: AUTH.agentId,
        deviceId: "device-1",
        stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
        enabled: true,
      }),
    }))
    const lockCall = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(lockCall[1]).toBe(`workforce-mobile-write-fence:${AUTH.orgId}`)
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(audit.data).toMatchObject({
      organizationId: AUTH.orgId,
      action: "WORKFORCE_MOBILE_WRITE_COHORT_ENABLED",
      ipAddress: "203.0.113.42",
    })
    expect(JSON.stringify(audit.data)).not.toContain('"device-1"')
    expect(JSON.stringify(audit.data)).toMatch(/[a-f0-9]{64}/)
  })

  it("does not allow the final active cohort to be disabled while cohort-only is active", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      id: "cohort-1",
      agentId: AUTH.agentId,
      deviceId: "device-1",
      enabled: true,
      expiresAt: null,
    } as never)
    vi.mocked(prisma.workforceMobileWriteFence.findUnique).mockResolvedValue({ mode: "COHORT_ONLY" } as never)
    vi.mocked(prisma.mtmMobileSyncCohort.count).mockResolvedValue(0)

    await expect(disableWorkforceMobileWriteCohort({
      organizationId: AUTH.orgId,
      actorUserId: "admin-1",
      cohort: { agentId: AUTH.agentId, deviceId: "device-1" },
    })).rejects.toBeInstanceOf(WorkforceMobileWriteFenceError)
    await expect(disableWorkforceMobileWriteCohort({
      organizationId: AUTH.orgId,
      actorUserId: "admin-1",
      cohort: { agentId: AUTH.agentId, deviceId: "device-1" },
    })).rejects.toMatchObject({ code: "WORKFORCE_MOBILE_WRITE_FENCE_LAST_COHORT" })
    expect(prisma.mtmMobileSyncCohort.update).not.toHaveBeenCalled()
  })
})
