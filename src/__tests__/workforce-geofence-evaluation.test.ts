import { describe, expect, it } from "vitest"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  WorkforceSnapshottedCircleGeofenceSchema,
  evaluateWorkforceSnapshottedGeofence,
} from "@/lib/workforce/geofence-evaluation"

const geofence = WorkforceSnapshottedCircleGeofenceSchema.parse({
  revisionId: "geofence-revision-20260830-1",
  kind: "CIRCLE",
  centerLatitude: 40.4093,
  centerLongitude: 49.8671,
  radiusMeters: 100,
})

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
      latitude: 40.4093,
      longitude: 49.8671,
      accuracyMeters: 5,
      provider: "FUSED",
      isMock: false,
    },
    methodReference: null,
    ...overrides,
  })
}

describe("Workforce geofence evaluation", () => {
  it("evaluates the raw distance on the server and only accepts a fully-inside accuracy circle", () => {
    const result = evaluateWorkforceSnapshottedGeofence({
      geofence,
      evidence: locationEvidence(),
    })

    expect(result).toMatchObject({
      verdict: "INSIDE",
      reasonCode: "INSIDE_WITH_ACCURACY",
      geofenceRevisionId: geofence.revisionId,
      accuracyMeters: 5,
    })
    expect(result.distanceMeters).toBeLessThan(0.01)
  })

  it("returns unknown when the GPS uncertainty overlaps the geofence boundary", () => {
    const result = evaluateWorkforceSnapshottedGeofence({
      geofence,
      evidence: locationEvidence({
        location: {
          availability: "AVAILABLE",
          latitude: 40.4102,
          longitude: 49.8671,
          accuracyMeters: 15,
          provider: "GPS",
          isMock: false,
        },
      }),
    })

    expect(result).toMatchObject({
      verdict: "UNKNOWN",
      reasonCode: "BOUNDARY_ACCURACY_OVERLAP",
      accuracyMeters: 15,
    })
    expect(result.distanceMeters).toBeGreaterThan(90)
    expect(result.distanceMeters).toBeLessThan(110)
  })

  it("returns outside only when the complete accuracy circle is outside", () => {
    const result = evaluateWorkforceSnapshottedGeofence({
      geofence,
      evidence: locationEvidence({
        location: {
          availability: "AVAILABLE",
          latitude: 40.4112,
          longitude: 49.8671,
          accuracyMeters: 10,
          provider: "GPS",
          isMock: false,
        },
      }),
    })

    expect(result).toMatchObject({ verdict: "OUTSIDE", reasonCode: "OUTSIDE_WITH_ACCURACY" })
    expect(result.distanceMeters).toBeGreaterThan(200)
  })

  it("does not infer a pass when the snapshot or usable location is absent", () => {
    expect(evaluateWorkforceSnapshottedGeofence({
      geofence: null,
      evidence: locationEvidence(),
    })).toMatchObject({ verdict: "UNKNOWN", reasonCode: "GEOFENCE_SNAPSHOT_MISSING" })

    expect(evaluateWorkforceSnapshottedGeofence({
      geofence,
      evidence: WorkforceEvidenceEnvelopeSchema.parse({
        schemaVersion: 1,
        source: "LOCATION",
        capturedAt: "2026-08-30T09:00:00.000Z",
        operationReference: "operation-9a3d72f2",
        sessionReference: "session-73be7a5a",
        deviceReference: null,
        app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
        location: {
          availability: "PERMISSION_DENIED",
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          provider: null,
          isMock: false,
        },
        methodReference: null,
      }),
    })).toMatchObject({ verdict: "UNKNOWN", reasonCode: "LOCATION_UNAVAILABLE" })
  })

  it("keeps valid zero coordinates distinct from missing coordinates", () => {
    const zeroGeofence = WorkforceSnapshottedCircleGeofenceSchema.parse({
      revisionId: "geofence-revision-zero-20260830",
      kind: "CIRCLE",
      centerLatitude: 0,
      centerLongitude: 0,
      radiusMeters: 100,
    })
    const result = evaluateWorkforceSnapshottedGeofence({
      geofence: zeroGeofence,
      evidence: locationEvidence({
        location: {
          availability: "AVAILABLE",
          latitude: 0,
          longitude: 0,
          accuracyMeters: 0,
          provider: "GPS",
          isMock: false,
        },
      }),
    })

    expect(result).toMatchObject({ verdict: "INSIDE", distanceMeters: 0, accuracyMeters: 0 })
  })
})
