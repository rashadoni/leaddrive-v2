import { describe, expect, it } from "vitest"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  WORKFORCE_LOCATION_EVIDENCE_BASELINE_V1,
  assessWorkforceLocationEvidence,
} from "@/lib/workforce/location-evidence-policy"

const now = new Date("2026-08-30T09:01:00.000Z")

function locationEvidence(overrides: Record<string, unknown> = {}) {
  return WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt: "2026-08-30T09:00:00.000Z",
    operationReference: "operation-9a3d72f2",
    sessionReference: "session-73be7a5a",
    deviceReference: "device-fingerprint-9f3e",
    app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
    location: {
      availability: "AVAILABLE",
      latitude: 0,
      longitude: 0,
      accuracyMeters: 25,
      provider: "FUSED",
      isMock: false,
    },
    methodReference: null,
    ...overrides,
  })
}

describe("Workforce location-evidence policy", () => {
  it("makes fresh calibrated GPS eligible for geometry without treating it as attendance", () => {
    const assessment = assessWorkforceLocationEvidence({ evidence: locationEvidence(), now })

    expect(assessment).toEqual({
      policyVersion: WORKFORCE_LOCATION_EVIDENCE_BASELINE_V1.policyVersion,
      status: "ELIGIBLE_FOR_GEOFENCE",
      reasonCodes: ["LOCATION_READY_FOR_GEOFENCE"],
      capturedAgeSeconds: 60,
      reportedAccuracyMeters: 25,
      provider: "FUSED",
    })
  })

  it("keeps stale, weak, mocked and non-preferred location reviewable with every signal", () => {
    const assessment = assessWorkforceLocationEvidence({
      evidence: locationEvidence({
        capturedAt: "2026-08-30T08:55:00.000Z",
        location: {
          availability: "AVAILABLE",
          latitude: 40.4093,
          longitude: 49.8671,
          accuracyMeters: 101,
          provider: "NETWORK",
          isMock: true,
        },
      }),
      now,
    })

    expect(assessment).toMatchObject({
      status: "REVIEW_REQUIRED",
      reportedAccuracyMeters: 101,
      provider: "NETWORK",
      reasonCodes: [
        "LOCATION_STALE",
        "LOCATION_ACCURACY_EXCEEDED",
        "LOCATION_MOCK_SUSPECTED",
        "LOCATION_PROVIDER_REVIEW_REQUIRED",
      ],
    })
  })

  it("marks a material future clock as review-required instead of silently accepting it", () => {
    const assessment = assessWorkforceLocationEvidence({
      evidence: locationEvidence({ capturedAt: "2026-08-30T09:02:01.000Z" }),
      now,
    })

    expect(assessment).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: ["LOCATION_FUTURE_TIMESTAMP"],
    })
  })

  it("makes a denied permission an explicit unavailable state with no coordinate leakage", () => {
    const assessment = assessWorkforceLocationEvidence({
      evidence: locationEvidence({
        location: {
          availability: "PERMISSION_DENIED",
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          provider: null,
          isMock: false,
        },
      }),
      now,
    })

    expect(assessment).toEqual({
      policyVersion: WORKFORCE_LOCATION_EVIDENCE_BASELINE_V1.policyVersion,
      status: "UNAVAILABLE",
      reasonCodes: ["LOCATION_PERMISSION_DENIED"],
      capturedAgeSeconds: null,
      reportedAccuracyMeters: null,
      provider: null,
    })
    expect(JSON.stringify(assessment)).not.toContain("latitude")
  })
})
