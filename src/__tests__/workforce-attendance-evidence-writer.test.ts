import { afterEach, describe, expect, it, vi } from "vitest"
import { decryptForTenantBound, resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { recordPreparedWorkforceLocationEvidence } from "@/lib/workforce/attendance-evidence-writer"
import type { PreparedWorkforceAttendanceVerification } from "@/lib/workforce/attendance-trust"

const organizationId = "org_1"
const capturedAt = new Date("2026-08-31T09:00:00.000Z")

const prepared: PreparedWorkforceAttendanceVerification = {
  organizationId,
  agentId: "agent_1",
  policyId: "policy_1",
  policyVersion: 1,
  policyDefinitionHash: "a".repeat(64),
  facts: [],
  locationEvidence: {
    capturedAt,
    latitude: 40.4093,
    longitude: 49.8671,
    accuracy: 12,
    provider: "GPS",
    isMock: false,
    quality: {
      policyVersion: "workforce-location-evidence-v1",
      status: "ELIGIBLE_FOR_GEOFENCE",
      reasonCodes: ["LOCATION_READY_FOR_GEOFENCE"],
      capturedAgeSeconds: 1,
      reportedAccuracyMeters: 12,
      provider: "GPS",
    },
  },
}

function scheduleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    workDate: new Date("2026-08-31T00:00:00.000Z"),
    segments: [{
      id: "segment-site-a",
      mode: "SITE",
      siteId: "site-a",
      startTime: "09:00",
      endTime: "18:00",
    }],
    sites: [{
      id: "site-a",
      geofenceRevision: {
        id: "geofence-a-r1",
        kind: "CIRCLE",
        centerLatitude: 40.4093,
        centerLongitude: 49.8671,
        radiusMeters: 100,
      },
    }],
    shiftSnapshot: { timezone: "Asia/Baku" },
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
})

describe("Workforce action-time evidence writer", () => {
  it("writes an encrypted event-bound envelope and a raw-free location quality assessment", async () => {
    process.env.TENANT_PII_MASTER_KEY = "e".repeat(64)
    resetMasterKekCache()
    const evidenceCreate = vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "a".repeat(64) })
    const assessmentCreate = vi.fn().mockResolvedValue({ id: "assessment_1" })
    const db = {
      workforceAttendanceEvidence: { create: evidenceCreate, findFirst: vi.fn(), updateMany: vi.fn() },
      workforceEvidenceAssessment: { create: assessmentCreate, findMany: vi.fn() },
      workforceWorkdayScheduleSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    }

    await expect(recordPreparedWorkforceLocationEvidence(db as never, {
      prepared,
      workdayEventId: "event-server-74b23fa1",
      workdayId: "workday-1",
      occurredAt: new Date("2026-08-31T09:00:00.000Z"),
      principal: "mobile",
    })).resolves.toEqual({ evidenceId: "evidence_1", idempotent: false })

    const evidence = evidenceCreate.mock.calls[0]?.[0].data as Record<string, unknown>
    expect(evidence.workdayEventId).toBe("event-server-74b23fa1")
    expect(JSON.stringify(evidence.redactedReceipt)).not.toMatch(/40\\.4093|49\\.8671/)
    expect(String(evidence.rawEnvelopeCiphertext)).not.toMatch(/40\\.4093|49\\.8671/)
    expect(decryptForTenantBound(organizationId, "workforce_attendance_evidence", "rawEnvelopeCiphertext", String(evidence.rawEnvelopeCiphertext)))
      .toContain("40.4093")
    expect(assessmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "LOCATION_QUALITY",
        verdict: "ELIGIBLE",
        reasonCodes: ["LOCATION_READY_FOR_GEOFENCE"],
        geofenceRevisionId: null,
        distanceMeters: null,
      }),
    }))
    expect(JSON.stringify(assessmentCreate.mock.calls[0]?.[0])).not.toMatch(/40\\.4093|49\\.8671|rawEnvelopeCiphertext/)
  })

  it("does not create a location row when policy did not require a location proof", async () => {
    const db = {
      workforceAttendanceEvidence: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
      workforceEvidenceAssessment: { create: vi.fn(), findMany: vi.fn() },
      workforceWorkdayScheduleSnapshot: { findFirst: vi.fn() },
    }
    await expect(recordPreparedWorkforceLocationEvidence(db as never, {
      prepared: { ...prepared, locationEvidence: undefined },
      workdayEventId: "event-server-74b23fa1",
      workdayId: "workday-1",
      occurredAt: new Date("2026-08-31T09:00:00.000Z"),
      principal: "web",
    })).resolves.toBeNull()
    expect(db.workforceAttendanceEvidence.create).not.toHaveBeenCalled()
    expect(db.workforceEvidenceAssessment.create).not.toHaveBeenCalled()
    expect(db.workforceWorkdayScheduleSnapshot.findFirst).not.toHaveBeenCalled()
  })

  it("evaluates only the server-resolved snapshotted SITE segment and appends no raw coordinates", async () => {
    process.env.TENANT_PII_MASTER_KEY = "f".repeat(64)
    resetMasterKekCache()
    const evidenceCreate = vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "a".repeat(64) })
    const assessmentCreate = vi.fn().mockResolvedValue({ id: "assessment_1" })
    const scheduleFind = vi.fn().mockResolvedValue(scheduleSnapshot())
    const db = {
      workforceAttendanceEvidence: { create: evidenceCreate, findFirst: vi.fn(), updateMany: vi.fn() },
      workforceEvidenceAssessment: { create: assessmentCreate, findMany: vi.fn() },
      workforceWorkdayScheduleSnapshot: { findFirst: scheduleFind },
    }

    await expect(recordPreparedWorkforceLocationEvidence(db as never, {
      prepared,
      workdayEventId: "event-server-74b23fa1",
      workdayId: "workday-1",
      occurredAt: new Date("2026-08-31T05:00:00.000Z"), // 09:00 Asia/Baku
      principal: "mobile",
    })).resolves.toEqual({ evidenceId: "evidence_1", idempotent: false })

    expect(scheduleFind).toHaveBeenCalledWith({
      where: { organizationId, workdayId: "workday-1", agentId: "agent_1" },
      select: {
        workDate: true,
        segments: true,
        sites: true,
        shiftSnapshot: { select: { timezone: true } },
      },
    })
    expect(assessmentCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "GEOFENCE",
        assessorVersion: "workforce-snapshotted-geofence-v1",
        verdict: "INSIDE",
        reasonCodes: ["INSIDE_WITH_ACCURACY"],
        geofenceRevisionId: "geofence-a-r1",
      }),
    }))
    expect(JSON.stringify(assessmentCreate.mock.calls[1]?.[0])).not.toMatch(/40\\.4093|49\\.8671|rawEnvelopeCiphertext/)
  })

  it("does not infer a site verdict outside a pinned SITE segment", async () => {
    process.env.TENANT_PII_MASTER_KEY = "a".repeat(64)
    resetMasterKekCache()
    const assessmentCreate = vi.fn().mockResolvedValue({ id: "assessment_1" })
    const db = {
      workforceAttendanceEvidence: { create: vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "a".repeat(64) }), findFirst: vi.fn(), updateMany: vi.fn() },
      workforceEvidenceAssessment: { create: assessmentCreate, findMany: vi.fn() },
      workforceWorkdayScheduleSnapshot: { findFirst: vi.fn().mockResolvedValue(scheduleSnapshot()) },
    }

    await recordPreparedWorkforceLocationEvidence(db as never, {
      prepared,
      workdayEventId: "event-server-74b23fa1",
      workdayId: "workday-1",
      occurredAt: new Date("2026-08-31T04:59:59.000Z"),
      principal: "mobile",
    })

    expect(assessmentCreate).toHaveBeenCalledTimes(1)
    expect(assessmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "LOCATION_QUALITY" }),
    }))
  })

  it("records an explicit UNKNOWN rather than falling back to a live geofence", async () => {
    process.env.TENANT_PII_MASTER_KEY = "b".repeat(64)
    resetMasterKekCache()
    const assessmentCreate = vi.fn().mockResolvedValue({ id: "assessment_1" })
    const db = {
      workforceAttendanceEvidence: { create: vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "a".repeat(64) }), findFirst: vi.fn(), updateMany: vi.fn() },
      workforceEvidenceAssessment: { create: assessmentCreate, findMany: vi.fn() },
      workforceWorkdayScheduleSnapshot: {
        findFirst: vi.fn().mockResolvedValue(scheduleSnapshot({
          sites: [{ id: "site-a", geofenceRevision: null }],
        })),
      },
    }

    await recordPreparedWorkforceLocationEvidence(db as never, {
      prepared,
      workdayEventId: "event-server-74b23fa1",
      workdayId: "workday-1",
      occurredAt: new Date("2026-08-31T05:00:00.000Z"),
      principal: "mobile",
    })

    expect(assessmentCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "GEOFENCE",
        verdict: "UNKNOWN",
        reasonCodes: ["GEOFENCE_SNAPSHOT_MISSING"],
        geofenceRevisionId: null,
      }),
    }))
  })
})
