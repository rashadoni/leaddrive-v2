import { describe, expect, it, vi } from "vitest"
import {
  runWorkforceRawLocationRetention,
  WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH,
} from "@/lib/workforce/raw-location-retention"

const orgId = "org-retention"
const now = new Date("2026-08-30T12:00:00.000Z")

function db() {
  return {
    mtmAgentLocation: { findMany: vi.fn().mockResolvedValue([{ id: "location-1" }]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    mtmAgentLatestLocation: { findMany: vi.fn().mockResolvedValue([{ id: "latest-1" }]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    mtmAgentWorkday: { findMany: vi.fn().mockResolvedValue([{ id: "workday-1" }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    mtmAgentWorkdayEvent: { findMany: vi.fn().mockResolvedValue([{ id: "event-1" }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    workforceAttendanceEvidence: { findMany: vi.fn().mockResolvedValue([{ id: "evidence-1" }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
  }
}

describe("Workforce raw location retention", () => {
  it("defaults to a tenant-scoped dry run and reports every raw copy without mutation", async () => {
    const retentionDb = db()

    await expect(runWorkforceRawLocationRetention(retentionDb, { organizationId: orgId, now })).resolves.toMatchObject({
      mode: "DRY_RUN",
      candidates: {
        locationRows: 1,
        latestLocationRows: 1,
        workdayCoordinateRows: 1,
        workdayEventCoordinateRows: 1,
        evidenceCiphertextRows: 1,
      },
      purged: {
        locationRows: 0,
        latestLocationRows: 0,
        workdayCoordinateRows: 0,
        workdayEventCoordinateRows: 0,
        evidenceCiphertextRows: 0,
      },
    })
    expect(retentionDb.mtmAgentLocation.deleteMany).not.toHaveBeenCalled()
    expect(retentionDb.mtmAgentWorkday.updateMany).not.toHaveBeenCalled()
    expect(retentionDb.workforceAttendanceEvidence.updateMany).not.toHaveBeenCalled()
    expect(retentionDb.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: orgId, workDate: { lt: new Date("2026-07-31T00:00:00.000Z") } }),
    }))
  })

  it("clears only selected tenant coordinates/ciphertext in explicit execute mode", async () => {
    const retentionDb = db()

    await expect(runWorkforceRawLocationRetention(retentionDb, {
      organizationId: orgId,
      mode: "EXECUTE",
      limit: 3,
      now,
    })).resolves.toMatchObject({
      mode: "EXECUTE",
      purged: {
        locationRows: 1,
        latestLocationRows: 1,
        workdayCoordinateRows: 1,
        workdayEventCoordinateRows: 1,
        evidenceCiphertextRows: 1,
      },
      remaining: {
        locationRows: 0,
        latestLocationRows: 0,
        workdayCoordinateRows: 0,
        workdayEventCoordinateRows: 0,
        evidenceCiphertextRows: 0,
      },
      morePending: false,
    })
    expect(retentionDb.mtmAgentWorkday.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: orgId,
        id: { in: ["workday-1"] },
        workDate: { lt: new Date("2026-07-31T00:00:00.000Z") },
      }),
      data: { startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null },
    }))
    expect(retentionDb.mtmAgentWorkdayEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: orgId,
        id: { in: ["event-1"] },
        occurredAt: { lt: new Date("2026-07-31T12:00:00.000Z") },
      }),
      data: { latitude: null, longitude: null, accuracy: null },
    }))
    expect(retentionDb.mtmAgentLocation.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: orgId,
        id: { in: ["location-1"] },
        recordedAt: { lt: new Date("2026-07-31T12:00:00.000Z") },
      },
    })
    expect(retentionDb.mtmAgentLatestLocation.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: orgId,
        id: { in: ["latest-1"] },
        recordedAt: { lt: new Date("2026-07-31T12:00:00.000Z") },
      },
    })
    expect(retentionDb.workforceAttendanceEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: orgId, id: { in: ["evidence-1"] }, rawPurgedAt: null }),
      data: { rawEnvelopeCiphertext: null, rawPurgedAt: now },
    }))
  })

  it("rechecks expiry and raw-presence predicates to preserve rows changed after selection", async () => {
    const retentionDb = db()
    retentionDb.mtmAgentLocation.deleteMany.mockResolvedValueOnce({ count: 0 })
    retentionDb.mtmAgentLatestLocation.deleteMany.mockResolvedValueOnce({ count: 0 })
    retentionDb.mtmAgentWorkday.updateMany.mockResolvedValueOnce({ count: 0 })
    retentionDb.mtmAgentWorkdayEvent.updateMany.mockResolvedValueOnce({ count: 0 })
    retentionDb.workforceAttendanceEvidence.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await runWorkforceRawLocationRetention(retentionDb, {
      organizationId: orgId,
      mode: "EXECUTE",
      now,
    })

    expect(result.purged).toEqual({
      locationRows: 0,
      latestLocationRows: 0,
      workdayCoordinateRows: 0,
      workdayEventCoordinateRows: 0,
      evidenceCiphertextRows: 0,
    })
    expect(retentionDb.mtmAgentLatestLocation.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: expect.objectContaining({ recordedAt: { lt: new Date("2026-07-31T12:00:00.000Z") } }),
    })
    expect(retentionDb.mtmAgentWorkday.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }))
    expect(retentionDb.mtmAgentWorkdayEvent.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }))
    expect(retentionDb.workforceAttendanceEvidence.updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ rawPurgedAt: null, rawEnvelopeCiphertext: { not: null } }),
    }))
  })

  it("rejects invalid bounds, tenant or runtime mode before issuing a query", async () => {
    const retentionDb = db()

    await expect(runWorkforceRawLocationRetention(retentionDb, {
      organizationId: orgId,
      limit: WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH + 1,
      now,
    })).rejects.toThrow("limit must be an integer")
    await expect(runWorkforceRawLocationRetention(retentionDb, {
      organizationId: " ", now,
    })).rejects.toThrow("organizationId is invalid")
    await expect(runWorkforceRawLocationRetention(retentionDb, {
      organizationId: orgId, mode: "INVALID" as never, now,
    })).rejects.toThrow("mode must be DRY_RUN or EXECUTE")
    expect(retentionDb.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })
})
