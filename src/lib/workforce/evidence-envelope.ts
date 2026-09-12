import { createHmac } from "node:crypto"
import { z } from "zod"

const OPAQUE_REFERENCE = z.string().trim().min(16).max(191)
  .regex(/^[A-Za-z0-9._:-]+$/, "reference must be an opaque identifier")
const APP_VERSION = z.string().trim().min(1).max(100)
const EVIDENCE_CAPTURE_SOURCES = ["LOCATION", "QR", "DEVICE", "KIOSK", "MANUAL"] as const

export const WORKFORCE_EVIDENCE_ENVELOPE_VERSION = 1

export const WorkforceEvidenceCaptureSourceSchema = z.enum(EVIDENCE_CAPTURE_SOURCES)
export const WorkforceLocationAvailabilitySchema = z.enum([
  "AVAILABLE",
  "PERMISSION_DENIED",
  "PROVIDER_DISABLED",
  "UNAVAILABLE",
])
export const WorkforceLocationProviderSchema = z.enum([
  "FUSED",
  "GPS",
  "NETWORK",
  "PASSIVE",
  "UNKNOWN",
])

const WorkforceLocationEvidenceSchema = z.object({
  availability: WorkforceLocationAvailabilitySchema,
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  accuracyMeters: z.number().finite().min(0).max(100_000).nullable(),
  provider: WorkforceLocationProviderSchema.nullable(),
  isMock: z.boolean(),
}).strict().superRefine((value, context) => {
  const present = [value.latitude, value.longitude, value.accuracyMeters, value.provider]
  if (value.availability === "AVAILABLE") {
    if (present.some((entry) => entry == null)) {
      context.addIssue({
        code: "custom",
        message: "available location evidence requires coordinates, accuracy and provider",
      })
    }
    return
  }
  if (present.some((entry) => entry != null) || value.isMock) {
    context.addIssue({
      code: "custom",
      message: "unavailable location evidence must not contain coordinates, provider, accuracy or mock status",
    })
  }
})

/**
 * Wire envelope for one evidence capture. `deviceReference` and
 * `sessionReference` are opaque, server-recognised references—not hardware
 * serials, advertising IDs or session tokens. Raw QR/device proof stays in
 * its dedicated verifier and never belongs in this generic structure.
 */
export const WorkforceEvidenceEnvelopeSchema = z.object({
  schemaVersion: z.literal(WORKFORCE_EVIDENCE_ENVELOPE_VERSION),
  source: WorkforceEvidenceCaptureSourceSchema,
  capturedAt: z.coerce.date(),
  operationReference: OPAQUE_REFERENCE,
  sessionReference: OPAQUE_REFERENCE,
  deviceReference: OPAQUE_REFERENCE.nullable(),
  app: z.object({
    platform: z.enum(["ANDROID", "WEB", "KIOSK"]),
    version: APP_VERSION,
    buildReference: OPAQUE_REFERENCE,
  }).strict(),
  location: WorkforceLocationEvidenceSchema.nullable(),
  /** A method-specific opaque value, for example a verified station ID. */
  methodReference: OPAQUE_REFERENCE.nullable(),
}).strict().superRefine((value, context) => {
  if (Number.isNaN(value.capturedAt.getTime())) {
    context.addIssue({ code: "custom", path: ["capturedAt"], message: "capturedAt must be a valid timestamp" })
  }
  if (value.source === "LOCATION" && value.location == null) {
    context.addIssue({ code: "custom", path: ["location"], message: "LOCATION evidence requires location details" })
  }
  if (value.source !== "LOCATION" && value.location != null) {
    context.addIssue({ code: "custom", path: ["location"], message: "only LOCATION evidence may include coordinates" })
  }
  if ((value.source === "QR" || value.source === "DEVICE" || value.source === "KIOSK") && value.methodReference == null) {
    context.addIssue({ code: "custom", path: ["methodReference"], message: `${value.source} evidence requires an opaque method reference` })
  }
  if (value.source === "MANUAL" && value.methodReference != null) {
    context.addIssue({ code: "custom", path: ["methodReference"], message: "MANUAL evidence must not impersonate an automated proof method" })
  }
  if (value.source === "DEVICE" && value.deviceReference == null) {
    context.addIssue({ code: "custom", path: ["deviceReference"], message: "DEVICE evidence requires an opaque device reference" })
  }
})

export type WorkforceEvidenceEnvelope = z.infer<typeof WorkforceEvidenceEnvelopeSchema>
export type WorkforceLocationAvailability = z.infer<typeof WorkforceLocationAvailabilitySchema>
export type WorkforceLocationProvider = z.infer<typeof WorkforceLocationProviderSchema>

export type WorkforceEvidenceRedactedReceipt = {
  schemaVersion: number
  source: z.infer<typeof WorkforceEvidenceCaptureSourceSchema>
  capturedAt: string
  operationReference: string
  sessionReference: string
  deviceReference: string | null
  app: WorkforceEvidenceEnvelope["app"]
  location: null | {
    availability: WorkforceLocationAvailability
    provider: WorkforceLocationProvider | null
    isMock: boolean
  }
  methodReference: string | null
  payloadHash: string
}

function canonicalValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalValue)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  )
}

export function canonicalWorkforceEvidenceEnvelope(envelope: WorkforceEvidenceEnvelope): string {
  return JSON.stringify(canonicalValue(envelope))
}

/**
 * Produces a tenant-bound non-reversible fingerprint for an envelope. The
 * secret is supplied by a server-side key provider and must never be a client
 * input, organisation ID or hard-coded fallback.
 */
export function workforceEvidencePayloadHash(input: {
  organizationId: string
  envelope: WorkforceEvidenceEnvelope
  hmacKey: Uint8Array | string
}): string {
  if (!input.organizationId.trim()) throw new Error("organizationId is required for evidence hashing")
  if (typeof input.hmacKey === "string" && input.hmacKey.length < 32) {
    throw new Error("evidence HMAC key must be at least 32 characters")
  }
  if (input.hmacKey instanceof Uint8Array && input.hmacKey.byteLength < 32) {
    throw new Error("evidence HMAC key must be at least 32 bytes")
  }
  return createHmac("sha256", input.hmacKey)
    .update(`workforce-evidence:v${WORKFORCE_EVIDENCE_ENVELOPE_VERSION}:${input.organizationId}:`)
    .update(canonicalWorkforceEvidenceEnvelope(input.envelope))
    .digest("hex")
}

/** Removes reversible coordinates before audit/report/output persistence. */
export function redactWorkforceEvidenceEnvelope(input: {
  organizationId: string
  envelope: WorkforceEvidenceEnvelope
  hmacKey: Uint8Array | string
}): WorkforceEvidenceRedactedReceipt {
  const { envelope } = input
  return {
    schemaVersion: envelope.schemaVersion,
    source: envelope.source,
    capturedAt: envelope.capturedAt.toISOString(),
    operationReference: envelope.operationReference,
    sessionReference: envelope.sessionReference,
    deviceReference: envelope.deviceReference,
    app: envelope.app,
    location: envelope.location == null ? null : {
      availability: envelope.location.availability,
      provider: envelope.location.provider,
      isMock: envelope.location.isMock,
    },
    methodReference: envelope.methodReference,
    payloadHash: workforceEvidencePayloadHash(input),
  }
}
