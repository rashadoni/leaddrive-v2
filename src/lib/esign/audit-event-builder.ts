/**
 * Audit-event constructor — M6 Phase 6 Block C slice 1.
 *
 * Pure builder for `esign_audit_events` rows. The DB enforces:
 *   • CHECK constraints on `eventType` + `actorType`
 *   • Append-only via UPDATE-blocking trigger
 *
 * The helper enforces the coherence rules that aren't easily
 * expressible in CHECK clauses:
 *   • signer_* events require signerId
 *   • envelope_* events MAY have signerId=null
 *   • actorType='user' / 'signer' requires actorId; 'system' requires null
 *   • metadata is sanitised — no prototype-chain keys
 *
 * Pure synchronous. Caller is responsible for INSERTing the
 * returned record; helper returns a plain object suitable for
 * `prisma.esignAuditEvent.create({ data: ... })`.
 */
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_TYPES,
  type AuditEventRecord,
  type AuditEventType,
  type BuildAuditEventInput,
  type BuildAuditEventResult,
} from "./types"

const FORBIDDEN_METADATA_KEYS = new Set(["__proto__", "constructor", "prototype"])

/**
 * Event-type groups. `SIGNER_EVENT_TYPES` requires non-null signerId
 * (enforced below). `ENVELOPE_EVENT_TYPES` REJECTS a non-null signerId
 * — those events are envelope-scoped and a stray signerId on them
 * would corrupt slice-2 timeline reads. Token events are flexible
 * (token_verified_ok/failed may or may not have a signer depending
 * on whether verification got far enough to identify the signer).
 */
const SIGNER_EVENT_TYPES: ReadonlySet<AuditEventType> = new Set<AuditEventType>([
  "signer_invited",
  "signer_viewed",
  "signer_signed",
  "signer_declined",
  "signer_expired",
])

const ENVELOPE_EVENT_TYPES: ReadonlySet<AuditEventType> = new Set<AuditEventType>([
  "envelope_created",
  "envelope_sent",
  "envelope_voided",
  "envelope_declined",
  "envelope_expired",
  "envelope_completed",
])

/**
 * Strip forbidden keys from caller metadata. The FORBIDDEN_METADATA_KEYS
 * skip is the only real defense — `Object.keys` already won't visit
 * `__proto__` in an object literal (it's a setter), but `constructor`
 * IS visited and must be filtered. Returns a fresh plain object
 * suitable for JSONB persistence.
 */
function sanitiseMetadata(
  raw: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (!raw) return {}
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) {
    if (FORBIDDEN_METADATA_KEYS.has(k)) continue
    out[k] = raw[k]
  }
  return out
}

export function buildAuditEvent(input: BuildAuditEventInput): BuildAuditEventResult {
  // 1. Basic field checks.
  if (typeof input.organizationId !== "string" || input.organizationId.length === 0) {
    return { ok: false, error: "organizationId is required" }
  }
  if (typeof input.envelopeId !== "string" || input.envelopeId.length === 0) {
    return { ok: false, error: "envelopeId is required" }
  }
  if (!(AUDIT_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    return {
      ok: false,
      error: `eventType "${String(input.eventType)}" is not in the allowed set`,
    }
  }
  if (!(AUDIT_ACTOR_TYPES as readonly string[]).includes(input.actorType)) {
    return {
      ok: false,
      error: `actorType "${String(input.actorType)}" must be user / signer / system`,
    }
  }
  if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) {
    return { ok: false, error: "at must be a valid Date" }
  }

  // 2. signerId coherence:
  //    • signer_* events MUST have a signerId.
  //    • envelope_* events MUST NOT have a signerId (they're
  //      envelope-scoped; a stray signerId would corrupt slice-2
  //      timeline filtering).
  //    • token_* events MAY have a signerId (verified_ok knows which
  //      signer; verified_failed may not have identified one yet).
  if (SIGNER_EVENT_TYPES.has(input.eventType)) {
    if (typeof input.signerId !== "string" || input.signerId.length === 0) {
      return {
        ok: false,
        error: `eventType "${input.eventType}" requires signerId`,
      }
    }
  }
  if (ENVELOPE_EVENT_TYPES.has(input.eventType)) {
    if (input.signerId !== null && input.signerId !== undefined) {
      return {
        ok: false,
        error: `eventType "${input.eventType}" is envelope-scoped; signerId must be null/omitted`,
      }
    }
  }

  // 3. actor coherence.
  if (input.actorType === "user" || input.actorType === "signer") {
    if (typeof input.actorId !== "string" || input.actorId.length === 0) {
      return {
        ok: false,
        error: `actorType "${input.actorType}" requires actorId`,
      }
    }
  }
  if (input.actorType === "system") {
    if (input.actorId !== null && input.actorId !== undefined) {
      return {
        ok: false,
        error: `actorType "system" requires actorId to be null/omitted`,
      }
    }
  }

  // 4. Metadata sanitisation.
  const metadata = sanitiseMetadata(input.metadata)

  // 5. Build record.
  const record: AuditEventRecord = {
    organizationId: input.organizationId,
    envelopeId: input.envelopeId,
    signerId: input.signerId ?? null,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata,
    createdAt: input.at,
  }
  return { ok: true, record }
}
