import { deriveTenantWorkforceEvidenceHmacKey } from "@/lib/crypto/tenant-pii-encryption"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  appendWorkforceLocationQualityAssessment,
  persistWorkforceAttendanceEvidence,
  type WorkforceEvidenceStorageDb,
} from "@/lib/workforce/evidence-storage"
import type {
  PreparedWorkforceAttendanceVerification,
  WorkforceAttendancePrincipal,
} from "@/lib/workforce/attendance-trust"

/**
 * Attaches the action-time location proof only after the canonical workday
 * event exists. The row and its derived quality assessment share the caller's
 * transaction, so neither can survive a rejected attendance mutation.
 *
 * This deliberately records no geofence verdict: a location requirement does
 * not identify a snapshotted site. A later site/segment-aware evaluator must
 * append a distinct geometry assessment rather than inferring one here.
 */
export async function recordPreparedWorkforceLocationEvidence(
  db: WorkforceEvidenceStorageDb,
  input: {
    prepared: PreparedWorkforceAttendanceVerification
    workdayEventId: string
    principal: WorkforceAttendancePrincipal
  },
): Promise<{ evidenceId: string; idempotent: boolean } | null> {
  const location = input.prepared.locationEvidence
  if (!location) return null

  const envelope = WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt: location.capturedAt,
    operationReference: `workday-event:${input.workdayEventId}`,
    sessionReference: `workday-event-session:${input.workdayEventId}`,
    deviceReference: null,
    app: {
      platform: input.principal === "mobile" ? "ANDROID" : "WEB",
      // Transport/source format, not a client-provided version claim.
      version: "workforce-attendance-v4",
      buildReference: "workforce-transport-v4",
    },
    location: {
      availability: "AVAILABLE",
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracy,
      provider: location.provider,
      isMock: location.isMock,
    },
    methodReference: null,
  })
  const persisted = await persistWorkforceAttendanceEvidence(db, {
    organizationId: input.prepared.organizationId,
    subject: { workdayEventId: input.workdayEventId },
    envelope,
    hmacKey: deriveTenantWorkforceEvidenceHmacKey(input.prepared.organizationId),
  })
  await appendWorkforceLocationQualityAssessment(db, {
    organizationId: input.prepared.organizationId,
    evidenceId: persisted.evidenceId,
    assessment: location.quality,
    assessedAt: location.capturedAt,
  })
  return persisted
}
