import { describe, expect, it } from "vitest"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import { evaluateWorkforceSnapshottedGeofence } from "@/lib/workforce/geofence-evaluation"
import { assessWorkforceLocationEvidence } from "@/lib/workforce/location-evidence-policy"

const now = new Date("2026-08-30T09:01:00.000Z")
const geofence = { revisionId: "revision_1", kind: "CIRCLE" as const, centerLatitude: 0, centerLongitude: 0, radiusMeters: 100 }

function evidence(location: Record<string, unknown>, capturedAt = "2026-08-30T09:00:00.000Z") {
  return WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt,
    operationReference: "operation-9a3d72f2",
    sessionReference: "session-73be7a5a",
    deviceReference: "device-fingerprint-9f3e",
    app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
    location,
    methodReference: null,
  })
}

describe("Workforce GPS edge matrix", () => {
  it("keeps valid zero coordinates eligible and inside", () => {
    const source = evidence({ availability: "AVAILABLE", latitude: 0, longitude: 0, accuracyMeters: 0, provider: "GPS", isMock: false })
    expect(assessWorkforceLocationEvidence({ evidence: source, now })).toMatchObject({ status: "ELIGIBLE_FOR_GEOFENCE" })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence, evidence: source })).toMatchObject({ verdict: "INSIDE" })
  })

  it("keeps boundary, weak/stale/future/mock/provider signals out of a silent pass", () => {
    const boundary = evidence({ availability: "AVAILABLE", latitude: 0.0009, longitude: 0, accuracyMeters: 15, provider: "GPS", isMock: false })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence, evidence: boundary })).toMatchObject({ verdict: "UNKNOWN", reasonCode: "BOUNDARY_ACCURACY_OVERLAP" })

    const weak = evidence({ availability: "AVAILABLE", latitude: 0, longitude: 0, accuracyMeters: 101, provider: "NETWORK", isMock: true }, "2026-08-30T08:55:00.000Z")
    expect(assessWorkforceLocationEvidence({ evidence: weak, now })).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: expect.arrayContaining(["LOCATION_STALE", "LOCATION_ACCURACY_EXCEEDED", "LOCATION_MOCK_SUSPECTED", "LOCATION_PROVIDER_REVIEW_REQUIRED"]),
    })
    const future = evidence({ availability: "AVAILABLE", latitude: 0, longitude: 0, accuracyMeters: 1, provider: "GPS", isMock: false }, "2026-08-30T09:02:01.000Z")
    expect(assessWorkforceLocationEvidence({ evidence: future, now })).toMatchObject({ reasonCodes: ["LOCATION_FUTURE_TIMESTAMP"] })
  })

  it("surfaces a missing permission/provider as unavailable rather than outside", () => {
    const denied = evidence({ availability: "PERMISSION_DENIED", latitude: null, longitude: null, accuracyMeters: null, provider: null, isMock: false })
    expect(assessWorkforceLocationEvidence({ evidence: denied, now })).toMatchObject({ status: "UNAVAILABLE", reasonCodes: ["LOCATION_PERMISSION_DENIED"] })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence, evidence: denied })).toMatchObject({ verdict: "UNKNOWN", reasonCode: "LOCATION_UNAVAILABLE" })
  })
})
