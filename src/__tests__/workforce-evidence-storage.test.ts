import { afterEach, describe, expect, it, vi } from "vitest"
import { decryptForTenantBound, resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  appendWorkforceGeofenceAssessment,
  listWorkforceEvidenceAssessmentReport,
  persistWorkforceAttendanceEvidence,
  purgeExpiredWorkforceEvidence,
  workforceRawEvidenceExpiry,
} from "@/lib/workforce/evidence-storage"

const key = "evidence-test-key-that-is-at-least-thirty-two-characters"
const orgId = "org_1"

function envelope() {
  return WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt: "2026-08-30T09:00:00.000Z",
    operationReference: "operation-9a3d72f2",
    sessionReference: "session-73be7a5a",
    deviceReference: "device-fingerprint-9f3e",
    app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
    location: { availability: "AVAILABLE", latitude: 40.4093, longitude: 49.8671, accuracyMeters: 12, provider: "GPS", isMock: false },
    methodReference: null,
  })
}

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
})

describe("Workforce evidence storage", () => {
  it("persists encrypted raw evidence with a redacted receipt and 30-day expiry", async () => {
    process.env.TENANT_PII_MASTER_KEY = "a".repeat(64)
    resetMasterKekCache()
    const create = vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "a".repeat(64) })
    const db = { workforceAttendanceEvidence: { create, findFirst: vi.fn(), updateMany: vi.fn() }, workforceEvidenceAssessment: { create: vi.fn(), findMany: vi.fn() } }
    const source = envelope()

    await expect(persistWorkforceAttendanceEvidence(db, {
      organizationId: orgId,
      subject: { siteTransitionId: "transition_1" },
      envelope: source,
      hmacKey: key,
    })).resolves.toEqual({ evidenceId: "evidence_1", idempotent: false })

    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>
    expect(JSON.stringify(data.redactedReceipt)).not.toContain("40.4093")
    expect(String(data.rawEnvelopeCiphertext)).not.toContain("40.4093")
    expect(decryptForTenantBound(orgId, "workforce_attendance_evidence", "rawEnvelopeCiphertext", String(data.rawEnvelopeCiphertext)))
      .toContain("40.4093")
    expect(data.rawExpiresAt).toEqual(new Date("2026-09-29T09:00:00.000Z"))
    expect(workforceRawEvidenceExpiry(source.capturedAt)).toEqual(data.rawExpiresAt)
  })

  it("replays only an identical operation and appends a separate raw-free assessment", async () => {
    process.env.TENANT_PII_MASTER_KEY = "b".repeat(64)
    resetMasterKekCache()
    const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" })
    const db = {
      workforceAttendanceEvidence: {
        create: vi.fn().mockRejectedValue(duplicate),
        findFirst: vi.fn().mockResolvedValue({ id: "evidence_1", payloadHash: "different" }),
        updateMany: vi.fn(),
      },
      workforceEvidenceAssessment: { create: vi.fn().mockResolvedValue({ id: "assessment_1" }), findMany: vi.fn() },
    }
    await expect(persistWorkforceAttendanceEvidence(db, {
      organizationId: orgId,
      subject: { workdayEventId: "event_1" },
      envelope: envelope(),
      hmacKey: key,
    })).rejects.toMatchObject({ code: "WORKFORCE_EVIDENCE_OPERATION_CONFLICT" })

    await appendWorkforceGeofenceAssessment(db, {
      organizationId: orgId,
      evidenceId: "evidence_1",
      assessorVersion: "c4-geofence-v1",
      assessedAt: new Date("2026-08-30T09:01:00.000Z"),
      evaluation: { verdict: "UNKNOWN", reasonCode: "BOUNDARY_ACCURACY_OVERLAP", geofenceRevisionId: "revision_1", distanceMeters: 100, accuracyMeters: 15 },
    })
    expect(db.workforceEvidenceAssessment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ rawEnvelopeCiphertext: expect.anything() }),
    }))
  })

  it("purges only due ciphertext and makes normal reports select no raw field", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const findMany = vi.fn().mockResolvedValue([])
    const db = { workforceAttendanceEvidence: { create: vi.fn(), findFirst: vi.fn(), updateMany }, workforceEvidenceAssessment: { create: vi.fn(), findMany } }
    await expect(purgeExpiredWorkforceEvidence(db, { organizationId: orgId, now: new Date("2026-09-30T00:00:00.000Z") }))
      .resolves.toEqual({ purged: 2 })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ rawPurgedAt: null }),
      data: { rawEnvelopeCiphertext: null, rawPurgedAt: new Date("2026-09-30T00:00:00.000Z") },
    }))
    await listWorkforceEvidenceAssessmentReport(db, orgId)
    expect(JSON.stringify(findMany.mock.calls[0]?.[0])).not.toContain("rawEnvelopeCiphertext")
  })
})
