import { encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import {
  canonicalWorkforceEvidenceEnvelope,
  redactWorkforceEvidenceEnvelope,
  workforceEvidencePayloadHash,
  type WorkforceEvidenceEnvelope,
} from "@/lib/workforce/evidence-envelope"
import type { WorkforceGeofenceEvaluation } from "@/lib/workforce/geofence-evaluation"

const RAW_EVIDENCE_RETENTION_DAYS = 30
const EVIDENCE_TABLE = "workforce_attendance_evidence"
const EVIDENCE_COLUMN = "rawEnvelopeCiphertext"

type EvidenceSubject =
  | { workdayEventId: string; siteTransitionId?: never }
  | { siteTransitionId: string; workdayEventId?: never }

type EvidenceDb = {
  workforceAttendanceEvidence: {
    create: (args: { data: Record<string, unknown>; select: { id: true; payloadHash: true } }) => Promise<{ id: string; payloadHash: string }>
    findFirst: (args: { where: Record<string, unknown>; select: { id: true; payloadHash: true } }) => Promise<{ id: string; payloadHash: string } | null>
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
  }
  workforceEvidenceAssessment: {
    create: (args: { data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>
  }
}

export class WorkforceEvidenceStorageError extends Error {
  constructor(
    readonly code: "WORKFORCE_EVIDENCE_OPERATION_CONFLICT" | "WORKFORCE_EVIDENCE_ASSESSMENT_INVALID",
    message = code,
  ) {
    super(message)
  }
}

function uniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`${name} must be a valid timestamp`)
  return value
}

export function workforceRawEvidenceExpiry(capturedAt: Date): Date {
  return new Date(validDate(capturedAt, "capturedAt").getTime() + RAW_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1_000)
}

/**
 * Writes the opaque encrypted envelope and its redacted receipt together. The
 * plaintext exists only while this function encrypts it; it is never sent to
 * audit/report fields. The HMAC key must come from a server-only key provider.
 */
export async function persistWorkforceAttendanceEvidence(
  db: EvidenceDb,
  input: {
    organizationId: string
    subject: EvidenceSubject
    envelope: WorkforceEvidenceEnvelope
    hmacKey: Uint8Array | string
  },
): Promise<{ evidenceId: string; idempotent: boolean }> {
  const payloadHash = workforceEvidencePayloadHash({
    organizationId: input.organizationId,
    envelope: input.envelope,
    hmacKey: input.hmacKey,
  })
  const rawEnvelopeCiphertext = encryptForTenantBound(
    input.organizationId,
    EVIDENCE_TABLE,
    EVIDENCE_COLUMN,
    canonicalWorkforceEvidenceEnvelope(input.envelope),
  )
  try {
    const created = await db.workforceAttendanceEvidence.create({
      data: {
        organizationId: input.organizationId,
        ...(input.subject.workdayEventId
          ? { workdayEventId: input.subject.workdayEventId }
          : { siteTransitionId: input.subject.siteTransitionId }),
        operationReference: input.envelope.operationReference,
        source: input.envelope.source,
        schemaVersion: input.envelope.schemaVersion,
        capturedAt: input.envelope.capturedAt,
        payloadHash,
        redactedReceipt: redactWorkforceEvidenceEnvelope({
          organizationId: input.organizationId,
          envelope: input.envelope,
          hmacKey: input.hmacKey,
        }),
        rawEnvelopeCiphertext,
        rawExpiresAt: workforceRawEvidenceExpiry(input.envelope.capturedAt),
      },
      select: { id: true, payloadHash: true },
    })
    return { evidenceId: created.id, idempotent: false }
  } catch (error) {
    if (!uniqueViolation(error)) throw error
    const existing = await db.workforceAttendanceEvidence.findFirst({
      where: { organizationId: input.organizationId, operationReference: input.envelope.operationReference },
      select: { id: true, payloadHash: true },
    })
    if (existing?.payloadHash === payloadHash) return { evidenceId: existing.id, idempotent: true }
    throw new WorkforceEvidenceStorageError(
      "WORKFORCE_EVIDENCE_OPERATION_CONFLICT",
      "The evidence operation reference was already used with different content",
    )
  }
}

/** Appends a geometry verdict without copying raw coordinates or ciphertext. */
export async function appendWorkforceGeofenceAssessment(
  db: EvidenceDb,
  input: {
    organizationId: string
    evidenceId: string
    evaluation: WorkforceGeofenceEvaluation
    assessorVersion: string
    assessedAt?: Date
  },
): Promise<{ assessmentId: string }> {
  if (!input.assessorVersion.trim() || input.assessorVersion.length > 64) {
    throw new WorkforceEvidenceStorageError("WORKFORCE_EVIDENCE_ASSESSMENT_INVALID", "assessorVersion is invalid")
  }
  const assessedAt = validDate(input.assessedAt ?? new Date(), "assessedAt")
  const assessment = await db.workforceEvidenceAssessment.create({
    data: {
      organizationId: input.organizationId,
      evidenceId: input.evidenceId,
      kind: "GEOFENCE",
      assessorVersion: input.assessorVersion,
      verdict: input.evaluation.verdict,
      reasonCodes: [input.evaluation.reasonCode],
      geofenceRevisionId: input.evaluation.geofenceRevisionId,
      distanceMeters: input.evaluation.distanceMeters,
      accuracyMeters: input.evaluation.accuracyMeters,
      assessedAt,
    },
    select: { id: true },
  })
  return { assessmentId: assessment.id }
}

/** Removes only due raw ciphertext; the immutable receipt and assessments remain. */
export async function purgeExpiredWorkforceEvidence(
  db: EvidenceDb,
  input: { organizationId: string; now?: Date },
): Promise<{ purged: number }> {
  const now = validDate(input.now ?? new Date(), "now")
  const changed = await db.workforceAttendanceEvidence.updateMany({
    where: {
      organizationId: input.organizationId,
      rawPurgedAt: null,
      rawExpiresAt: { lte: now },
    },
    data: { rawEnvelopeCiphertext: null, rawPurgedAt: now },
  })
  return { purged: changed.count }
}

/** A normal report projection deliberately omits encrypted/raw evidence fields. */
export async function listWorkforceEvidenceAssessmentReport(
  db: EvidenceDb,
  organizationId: string,
): Promise<unknown[]> {
  return db.workforceEvidenceAssessment.findMany({
    where: { organizationId },
    orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      kind: true,
      assessorVersion: true,
      verdict: true,
      reasonCodes: true,
      geofenceRevisionId: true,
      assessedAt: true,
      evidence: {
        select: {
          id: true,
          operationReference: true,
          source: true,
          capturedAt: true,
          rawPurgedAt: true,
        },
      },
    },
  })
}
