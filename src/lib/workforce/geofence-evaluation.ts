import { z } from "zod"
import { calculateDistance } from "@/lib/geo-utils"
import type { WorkforceEvidenceEnvelope } from "@/lib/workforce/evidence-envelope"

/**
 * Immutable input copied from the geofence revision selected for a workday
 * snapshot. This deliberately contains no live-site lookup: later site edits
 * must not change an already-recorded attendance assessment.
 */
export const WorkforceSnapshottedCircleGeofenceSchema = z.object({
  revisionId: z.string().trim().min(1).max(191),
  kind: z.literal("CIRCLE"),
  centerLatitude: z.number().finite().min(-90).max(90),
  centerLongitude: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().finite().min(25).max(5_000),
}).strict()

export type WorkforceSnapshottedCircleGeofence = z.infer<typeof WorkforceSnapshottedCircleGeofenceSchema>

export type WorkforceGeofenceVerdict = "INSIDE" | "OUTSIDE" | "UNKNOWN"
export type WorkforceGeofenceReasonCode =
  | "GEOFENCE_SNAPSHOT_MISSING"
  | "LOCATION_EVIDENCE_REQUIRED"
  | "LOCATION_UNAVAILABLE"
  | "LOCATION_INCOMPLETE"
  | "INSIDE_WITH_ACCURACY"
  | "OUTSIDE_WITH_ACCURACY"
  | "BOUNDARY_ACCURACY_OVERLAP"

export type WorkforceGeofenceEvaluation = {
  verdict: WorkforceGeofenceVerdict
  reasonCode: WorkforceGeofenceReasonCode
  geofenceRevisionId: string | null
  distanceMeters: number | null
  accuracyMeters: number | null
}

function unknown(input: {
  reasonCode: Exclude<WorkforceGeofenceReasonCode, "INSIDE_WITH_ACCURACY" | "OUTSIDE_WITH_ACCURACY">
  geofenceRevisionId: string | null
  accuracyMeters?: number | null
}): WorkforceGeofenceEvaluation {
  return {
    verdict: "UNKNOWN",
    reasonCode: input.reasonCode,
    geofenceRevisionId: input.geofenceRevisionId,
    distanceMeters: null,
    accuracyMeters: input.accuracyMeters ?? null,
  }
}

/**
 * Evaluates one location envelope against the immutable geofence selected for
 * the workday/segment. The server evaluates the distance; callers must never
 * submit a client-side inside/outside assertion.
 *
 * Accuracy is treated as an uncertainty radius. A result is only inside when
 * the complete accuracy circle is inside the geofence, and only outside when
 * it is completely outside. A circle overlapping the boundary is explicitly
 * UNKNOWN, so weak GPS cannot silently become attendance.
 *
 * Freshness, provider and mock-location policy are deliberately separate
 * C4-003 decisions. This function reports geometry only and does not turn
 * those signals into a presence verdict.
 */
export function evaluateWorkforceSnapshottedGeofence(input: {
  geofence: WorkforceSnapshottedCircleGeofence | null
  evidence: WorkforceEvidenceEnvelope
}): WorkforceGeofenceEvaluation {
  if (input.geofence == null) {
    return unknown({ reasonCode: "GEOFENCE_SNAPSHOT_MISSING", geofenceRevisionId: null })
  }

  if (input.evidence.source !== "LOCATION" || input.evidence.location == null) {
    return unknown({
      reasonCode: "LOCATION_EVIDENCE_REQUIRED",
      geofenceRevisionId: input.geofence.revisionId,
    })
  }

  const location = input.evidence.location
  if (location.availability !== "AVAILABLE") {
    return unknown({
      reasonCode: "LOCATION_UNAVAILABLE",
      geofenceRevisionId: input.geofence.revisionId,
    })
  }

  if (location.latitude == null || location.longitude == null || location.accuracyMeters == null) {
    return unknown({
      reasonCode: "LOCATION_INCOMPLETE",
      geofenceRevisionId: input.geofence.revisionId,
    })
  }

  const distanceMeters = calculateDistance(
    location.latitude,
    location.longitude,
    input.geofence.centerLatitude,
    input.geofence.centerLongitude,
  )
  const accuracyMeters = location.accuracyMeters
  const insideBoundaryMeters = distanceMeters + accuracyMeters
  const outsideBoundaryMeters = Math.max(0, distanceMeters - accuracyMeters)

  if (insideBoundaryMeters <= input.geofence.radiusMeters) {
    return {
      verdict: "INSIDE",
      reasonCode: "INSIDE_WITH_ACCURACY",
      geofenceRevisionId: input.geofence.revisionId,
      distanceMeters,
      accuracyMeters,
    }
  }

  if (outsideBoundaryMeters > input.geofence.radiusMeters) {
    return {
      verdict: "OUTSIDE",
      reasonCode: "OUTSIDE_WITH_ACCURACY",
      geofenceRevisionId: input.geofence.revisionId,
      distanceMeters,
      accuracyMeters,
    }
  }

  return {
    verdict: "UNKNOWN",
    reasonCode: "BOUNDARY_ACCURACY_OVERLAP",
    geofenceRevisionId: input.geofence.revisionId,
    distanceMeters,
    accuracyMeters,
  }
}
