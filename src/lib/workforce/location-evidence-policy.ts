import { z } from "zod"
import type { WorkforceEvidenceEnvelope, WorkforceLocationProvider } from "@/lib/workforce/evidence-envelope"

const LOCATION_POLICY_VERSION = "workforce-location-evidence-v1" as const

export const WorkforceLocationEvidencePolicySchema = z.object({
  policyVersion: z.literal(LOCATION_POLICY_VERSION),
  /** GPS accuracy must be no worse than the C2 technical calibration baseline. */
  maxAccuracyMeters: z.number().finite().min(1).max(1_000),
  /** Action-time evidence is only eligible for geometry during this short window. */
  maxEvidenceAgeSeconds: z.number().int().min(1).max(600),
  /** Small device/server clock skew is tolerable; material future time is not. */
  maxFutureSkewSeconds: z.number().int().min(0).max(300),
  eligibleProviders: z.array(z.enum(["FUSED", "GPS", "NETWORK", "PASSIVE", "UNKNOWN"]))
    .min(1)
    .max(5)
    .refine((providers) => new Set(providers).size === providers.length, "Providers must not repeat"),
}).strict()

export type WorkforceLocationEvidencePolicy = z.infer<typeof WorkforceLocationEvidencePolicySchema>

/**
 * Reversible starting policy only. It is intentionally conservative and does
 * not activate background tracking, choose a tenant's proof combination or
 * replace the required site-local calibration and legal decisions.
 */
export const WORKFORCE_LOCATION_EVIDENCE_BASELINE_V1: WorkforceLocationEvidencePolicy = {
  policyVersion: LOCATION_POLICY_VERSION,
  maxAccuracyMeters: 100,
  maxEvidenceAgeSeconds: 120,
  maxFutureSkewSeconds: 60,
  eligibleProviders: ["FUSED", "GPS"],
}

export type WorkforceLocationEvidenceStatus =
  | "ELIGIBLE_FOR_GEOFENCE"
  | "REVIEW_REQUIRED"
  | "UNAVAILABLE"

export type WorkforceLocationEvidenceReasonCode =
  | "LOCATION_EVIDENCE_REQUIRED"
  | "LOCATION_PERMISSION_DENIED"
  | "LOCATION_PROVIDER_DISABLED"
  | "LOCATION_SERVICE_UNAVAILABLE"
  | "LOCATION_INCOMPLETE"
  | "LOCATION_FUTURE_TIMESTAMP"
  | "LOCATION_STALE"
  | "LOCATION_ACCURACY_EXCEEDED"
  | "LOCATION_MOCK_SUSPECTED"
  | "LOCATION_PROVIDER_REVIEW_REQUIRED"
  | "LOCATION_READY_FOR_GEOFENCE"

export type WorkforceLocationEvidenceAssessment = {
  policyVersion: string
  status: WorkforceLocationEvidenceStatus
  reasonCodes: WorkforceLocationEvidenceReasonCode[]
  capturedAgeSeconds: number | null
  /** Included only to explain a policy result; never a coordinate. */
  reportedAccuracyMeters: number | null
  provider: WorkforceLocationProvider | null
}

function unavailable(
  policyVersion: string,
  reasonCode: Exclude<WorkforceLocationEvidenceReasonCode, "LOCATION_READY_FOR_GEOFENCE">,
): WorkforceLocationEvidenceAssessment {
  return {
    policyVersion,
    status: "UNAVAILABLE",
    reasonCodes: [reasonCode],
    capturedAgeSeconds: null,
    reportedAccuracyMeters: null,
    provider: null,
  }
}

/**
 * Evaluates location quality before a geometry result is allowed to influence
 * an attendance workflow. "ELIGIBLE_FOR_GEOFENCE" means only that the signal
 * may proceed to C4-002; it is never an identity, attendance, payroll or
 * disciplinary decision. Low-quality and suspicious signals are kept
 * explainable for a later review/fallback flow rather than silently passing.
 */
export function assessWorkforceLocationEvidence(input: {
  evidence: WorkforceEvidenceEnvelope
  policy?: WorkforceLocationEvidencePolicy
  now?: Date
}): WorkforceLocationEvidenceAssessment {
  const policy = input.policy ?? WORKFORCE_LOCATION_EVIDENCE_BASELINE_V1
  const parsedPolicy = WorkforceLocationEvidencePolicySchema.parse(policy)

  if (input.evidence.source !== "LOCATION" || input.evidence.location == null) {
    return unavailable(parsedPolicy.policyVersion, "LOCATION_EVIDENCE_REQUIRED")
  }

  const location = input.evidence.location
  if (location.availability !== "AVAILABLE") {
    const reasonCode = location.availability === "PERMISSION_DENIED"
      ? "LOCATION_PERMISSION_DENIED"
      : location.availability === "PROVIDER_DISABLED"
        ? "LOCATION_PROVIDER_DISABLED"
        : "LOCATION_SERVICE_UNAVAILABLE"
    return unavailable(parsedPolicy.policyVersion, reasonCode)
  }

  if (
    location.latitude == null
    || location.longitude == null
    || location.accuracyMeters == null
    || location.provider == null
  ) {
    return unavailable(parsedPolicy.policyVersion, "LOCATION_INCOMPLETE")
  }

  const now = input.now ?? new Date()
  const nowMilliseconds = now.getTime()
  if (Number.isNaN(nowMilliseconds)) throw new RangeError("now must be a valid timestamp")

  const capturedAgeSeconds = (nowMilliseconds - input.evidence.capturedAt.getTime()) / 1_000
  const reasonCodes: WorkforceLocationEvidenceReasonCode[] = []
  if (capturedAgeSeconds < -parsedPolicy.maxFutureSkewSeconds) {
    reasonCodes.push("LOCATION_FUTURE_TIMESTAMP")
  } else if (capturedAgeSeconds > parsedPolicy.maxEvidenceAgeSeconds) {
    reasonCodes.push("LOCATION_STALE")
  }
  if (location.accuracyMeters > parsedPolicy.maxAccuracyMeters) {
    reasonCodes.push("LOCATION_ACCURACY_EXCEEDED")
  }
  if (location.isMock) {
    reasonCodes.push("LOCATION_MOCK_SUSPECTED")
  }
  if (!parsedPolicy.eligibleProviders.includes(location.provider)) {
    reasonCodes.push("LOCATION_PROVIDER_REVIEW_REQUIRED")
  }

  if (reasonCodes.length > 0) {
    return {
      policyVersion: parsedPolicy.policyVersion,
      status: "REVIEW_REQUIRED",
      reasonCodes,
      capturedAgeSeconds,
      reportedAccuracyMeters: location.accuracyMeters,
      provider: location.provider,
    }
  }

  return {
    policyVersion: parsedPolicy.policyVersion,
    status: "ELIGIBLE_FOR_GEOFENCE",
    reasonCodes: ["LOCATION_READY_FOR_GEOFENCE"],
    capturedAgeSeconds,
    reportedAccuracyMeters: location.accuracyMeters,
    provider: location.provider,
  }
}
