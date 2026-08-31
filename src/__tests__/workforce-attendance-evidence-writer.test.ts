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
    }

    await expect(recordPreparedWorkforceLocationEvidence(db, {
      prepared,
      workdayEventId: "event-server-74b23fa1",
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
    }
    await expect(recordPreparedWorkforceLocationEvidence(db, {
      prepared: { ...prepared, locationEvidence: undefined },
      workdayEventId: "event-server-74b23fa1",
      principal: "web",
    })).resolves.toBeNull()
    expect(db.workforceAttendanceEvidence.create).not.toHaveBeenCalled()
    expect(db.workforceEvidenceAssessment.create).not.toHaveBeenCalled()
  })
})
