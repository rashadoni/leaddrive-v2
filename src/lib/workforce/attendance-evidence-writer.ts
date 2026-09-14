import type { Prisma } from "@prisma/client"
import { deriveTenantWorkforceEvidenceHmacKey } from "@/lib/crypto/tenant-pii-encryption"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  appendWorkforceGeofenceAssessment,
  appendWorkforceLocationQualityAssessment,
  persistWorkforceAttendanceEvidence,
  type WorkforceEvidenceStorageDb,
} from "@/lib/workforce/evidence-storage"
import { evaluateWorkforceSnapshottedGeofence } from "@/lib/workforce/geofence-evaluation"
import {
  workforceSnapshottedSegmentAt,
  workforceSnapshottedSiteGeofence,
} from "@/lib/workforce/snapshot-writer"
import type {
  PreparedWorkforceAttendanceVerification,
  WorkforceAttendancePrincipal,
} from "@/lib/workforce/attendance-trust"

/**
 * Attaches the action-time location proof only after the canonical workday
 * event exists. The row and its derived quality assessment share the caller's
 * transaction, so neither can survive a rejected attendance mutation.
 *
 * It records a geometry verdict only when the accepted event instant resolves
 * to an immutable SITE segment in the same workday snapshot. A location
 * requirement alone never selects a site or creates a presence conclusion.
 */
export async function recordPreparedWorkforceLocationEvidence(
  db: Prisma.TransactionClient,
  input: {
    prepared: PreparedWorkforceAttendanceVerification
    workdayEventId: string
    workdayId: string
    occurredAt: Date
    principal: WorkforceAttendancePrincipal
  },
): Promise<{ evidenceId: string; idempotent: boolean } | null> {
  const location = input.prepared.locationEvidence
  if (!location) return null
  // This writer always runs inside the canonical Prisma transaction. The
  // storage helper intentionally exposes a minimal structural test seam; the
  // Prisma delegate is broader but provides exactly that subset at runtime.
  const evidenceStorage = db as unknown as WorkforceEvidenceStorageDb

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
  const persisted = await persistWorkforceAttendanceEvidence(evidenceStorage, {
    organizationId: input.prepared.organizationId,
    subject: { workdayEventId: input.workdayEventId },
    envelope,
    hmacKey: deriveTenantWorkforceEvidenceHmacKey(input.prepared.organizationId),
  })
  await appendWorkforceLocationQualityAssessment(evidenceStorage, {
    organizationId: input.prepared.organizationId,
    evidenceId: persisted.evidenceId,
    assessment: location.quality,
    assessedAt: location.capturedAt,
  })
  // A location policy alone does not identify a site. Only a segment resolved
  // from the immutable workday snapshot at the accepted event instant can
  // produce geometry. This intentionally leaves off-schedule/non-site actions
  // with a quality receipt but no inferred presence result.
  const schedule = await db.workforceWorkdayScheduleSnapshot.findFirst({
    where: {
      organizationId: input.prepared.organizationId,
      workdayId: input.workdayId,
      agentId: input.prepared.agentId,
    },
    select: {
      workDate: true,
      segments: true,
      sites: true,
      shiftSnapshot: { select: { timezone: true } },
    },
  })
  const segment = schedule == null
    ? null
    : workforceSnapshottedSegmentAt({
      workDate: schedule.workDate,
      timezone: schedule.shiftSnapshot.timezone,
      segments: schedule.segments,
      occurredAt: input.occurredAt,
    })
  if (schedule == null || segment?.mode !== "SITE" || segment.siteId == null) return persisted

  await appendWorkforceGeofenceAssessment(evidenceStorage, {
    organizationId: input.prepared.organizationId,
    evidenceId: persisted.evidenceId,
    assessorVersion: "workforce-snapshotted-geofence-v1",
    assessedAt: location.capturedAt,
    evaluation: evaluateWorkforceSnapshottedGeofence({
      geofence: workforceSnapshottedSiteGeofence(schedule.sites, segment.siteId),
      evidence: envelope,
    }),
  })
  return persisted
}
