import { describe, expect, it } from "vitest"
import {
  WorkforceEvidenceEnvelopeSchema,
  canonicalWorkforceEvidenceEnvelope,
  redactWorkforceEvidenceEnvelope,
  workforceEvidencePayloadHash,
} from "@/lib/workforce/evidence-envelope"

const key = "evidence-test-key-that-is-at-least-thirty-two-characters"

function locationEnvelope(overrides: Record<string, unknown> = {}) {
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
      accuracyMeters: 12.5,
      provider: "FUSED",
      isMock: false,
    },
    methodReference: null,
    ...overrides,
  })
}

describe("Workforce evidence envelope", () => {
  it("requires a complete, unambiguous location envelope", () => {
    const envelope = locationEnvelope()
    expect(envelope.location).toMatchObject({ availability: "AVAILABLE", accuracyMeters: 12.5, provider: "FUSED" })

    expect(() => locationEnvelope({
      location: {
        availability: "AVAILABLE",
        latitude: 40.4093,
        longitude: null,
        accuracyMeters: null,
        provider: null,
        isMock: false,
      },
    })).toThrow(/requires coordinates, accuracy and provider/i)
    expect(() => locationEnvelope({ source: "QR", methodReference: "station-12aa66ff" })).toThrow(/only LOCATION/i)
    expect(() => locationEnvelope({ source: "MANUAL", location: null, methodReference: "manual-is-not-a-proof" })).toThrow(/must not impersonate/i)
  })

  it("requires method and opaque device references for automated non-location evidence", () => {
    expect(() => WorkforceEvidenceEnvelopeSchema.parse({
      schemaVersion: 1,
      source: "QR",
      capturedAt: "2026-08-30T09:00:00.000Z",
      operationReference: "operation-9a3d72f2",
      sessionReference: "session-73be7a5a",
      deviceReference: null,
      app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
      location: null,
      methodReference: null,
    })).toThrow(/QR evidence requires/i)
    expect(() => WorkforceEvidenceEnvelopeSchema.parse({
      schemaVersion: 1,
      source: "DEVICE",
      capturedAt: "2026-08-30T09:00:00.000Z",
      operationReference: "operation-9a3d72f2",
      sessionReference: "session-73be7a5a",
      deviceReference: null,
      app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-reference-92acf217" },
      location: null,
      methodReference: "enrollment-5d92a1cf",
    })).toThrow(/DEVICE evidence requires/i)
  })

  it("uses a tenant-bound HMAC and removes reversible coordinates from the receipt", () => {
    const envelope = locationEnvelope()
    const hash = workforceEvidencePayloadHash({ organizationId: "org-a", envelope, hmacKey: key })
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(workforceEvidencePayloadHash({ organizationId: "org-a", envelope, hmacKey: key }))
    expect(hash).not.toBe(workforceEvidencePayloadHash({ organizationId: "org-b", envelope, hmacKey: key }))
    expect(canonicalWorkforceEvidenceEnvelope(envelope)).toContain("40.4093")

    const receipt = redactWorkforceEvidenceEnvelope({ organizationId: "org-a", envelope, hmacKey: key })
    expect(receipt).toMatchObject({
      source: "LOCATION",
      location: { availability: "AVAILABLE", provider: "FUSED", isMock: false },
      payloadHash: hash,
    })
    expect(JSON.stringify(receipt)).not.toContain("40.4093")
    expect(JSON.stringify(receipt)).not.toContain("49.8671")
    expect(() => workforceEvidencePayloadHash({ organizationId: "org-a", envelope, hmacKey: "too-short" })).toThrow(/at least 32/i)
  })
})
