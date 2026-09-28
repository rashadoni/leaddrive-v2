import {
  WORKFORCE_EVIDENCE_ACCESS_PURPOSES,
  WORKFORCE_EVIDENCE_ACCESS_REASONS,
  type WorkforceEvidenceAccessPurpose,
  type WorkforceEvidenceAccessReason,
} from "@/lib/workforce/evidence-timeline"

export const WORKFORCE_EVIDENCE_SOURCES = ["LOCATION", "QR", "DEVICE", "KIOSK", "MANUAL"] as const
export const WORKFORCE_EVIDENCE_SUBJECT_KINDS = ["WORKDAY_EVENT", "SITE_TRANSITION", "UNAVAILABLE"] as const
export const WORKFORCE_EVIDENCE_ACTIONS = ["START", "PAUSE", "RESUME", "FINISH", "REOPEN", "ARRIVAL", "DEPARTURE"] as const
export const WORKFORCE_EVIDENCE_REVIEW_STATES = ["LEGACY_UNKNOWN", "NOT_REQUIRED", "PENDING_REVIEW"] as const
export const WORKFORCE_EVIDENCE_ASSESSMENT_KINDS = ["GEOFENCE", "LOCATION_QUALITY", "PROOF_POLICY"] as const
export const WORKFORCE_EVIDENCE_VERDICTS = ["INSIDE", "OUTSIDE", "UNKNOWN", "ELIGIBLE", "REVIEW_REQUIRED", "UNAVAILABLE", "SATISFIED"] as const
export const WORKFORCE_EVIDENCE_RETENTION_STATES = ["WITHIN_RETENTION", "PURGED"] as const

export type WorkforceEvidenceSource = typeof WORKFORCE_EVIDENCE_SOURCES[number]
export type WorkforceEvidenceSubjectKind = typeof WORKFORCE_EVIDENCE_SUBJECT_KINDS[number]
export type WorkforceEvidenceAction = typeof WORKFORCE_EVIDENCE_ACTIONS[number]
export type WorkforceEvidenceReviewState = typeof WORKFORCE_EVIDENCE_REVIEW_STATES[number]
export type WorkforceEvidenceAssessmentKind = typeof WORKFORCE_EVIDENCE_ASSESSMENT_KINDS[number]
export type WorkforceEvidenceVerdict = typeof WORKFORCE_EVIDENCE_VERDICTS[number]
export type WorkforceEvidenceRetentionState = typeof WORKFORCE_EVIDENCE_RETENTION_STATES[number]

export const WORKFORCE_EVIDENCE_REASON_LABEL_KEYS = [
  "LOCATION_REQUIRED",
  "LOCATION_UNAVAILABLE",
  "LOCATION_TIMING_REVIEW",
  "LOCATION_QUALITY_REVIEW",
  "LOCATION_READY",
  "GEOFENCE_UNAVAILABLE",
  "INSIDE_CONFIRMED",
  "OUTSIDE_RECORDED",
  "REVIEW_REQUIRED",
] as const

export type WorkforceEvidenceReasonLabelKey = typeof WORKFORCE_EVIDENCE_REASON_LABEL_KEYS[number]

const REASON_LABELS: Readonly<Record<string, WorkforceEvidenceReasonLabelKey>> = {
  LOCATION_EVIDENCE_REQUIRED: "LOCATION_REQUIRED",
  LOCATION_PERMISSION_DENIED: "LOCATION_UNAVAILABLE",
  LOCATION_PROVIDER_DISABLED: "LOCATION_UNAVAILABLE",
  LOCATION_SERVICE_UNAVAILABLE: "LOCATION_UNAVAILABLE",
  LOCATION_UNAVAILABLE: "LOCATION_UNAVAILABLE",
  LOCATION_INCOMPLETE: "LOCATION_UNAVAILABLE",
  LOCATION_FUTURE_TIMESTAMP: "LOCATION_TIMING_REVIEW",
  LOCATION_STALE: "LOCATION_TIMING_REVIEW",
  LOCATION_ACCURACY_EXCEEDED: "LOCATION_QUALITY_REVIEW",
  LOCATION_MOCK_SUSPECTED: "LOCATION_QUALITY_REVIEW",
  LOCATION_PROVIDER_REVIEW_REQUIRED: "LOCATION_QUALITY_REVIEW",
  BOUNDARY_ACCURACY_OVERLAP: "LOCATION_QUALITY_REVIEW",
  LOCATION_READY_FOR_GEOFENCE: "LOCATION_READY",
  GEOFENCE_SNAPSHOT_MISSING: "GEOFENCE_UNAVAILABLE",
  INSIDE_WITH_ACCURACY: "INSIDE_CONFIRMED",
  OUTSIDE_WITH_ACCURACY: "OUTSIDE_RECORDED",
}

/** Unknown machine/security codes stay hidden behind localized safe copy. */
export function workforceEvidenceReasonLabelKey(reasonCode: string): WorkforceEvidenceReasonLabelKey {
  return REASON_LABELS[reasonCode] ?? "REVIEW_REQUIRED"
}

export type WorkforceEvidenceTimelineView = {
  timezone: string
  start: string
  end: string
  employeeName: string
  access: {
    purpose: WorkforceEvidenceAccessPurpose
    reasonCode: WorkforceEvidenceAccessReason
    caseReference: string | null
  }
  evidence: Array<{
    source: WorkforceEvidenceSource
    capturedAt: string
    rawRetentionState: WorkforceEvidenceRetentionState
    subject: {
      kind: WorkforceEvidenceSubjectKind
      action: WorkforceEvidenceAction | null
      claimedAt: string | null
      reviewState: WorkforceEvidenceReviewState
    }
    assessments: Array<{
      kind: WorkforceEvidenceAssessmentKind
      verdict: WorkforceEvidenceVerdict
      reasonCodes: string[]
      assessedAt: string
    }>
  }>
}

export type WorkforceEvidenceTarget = { id: string; label: string }

const IDENTIFIER = /^[A-Za-z0-9_-]{1,191}$/
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const CASE_REFERENCE = /^[A-Za-z0-9._:/-]{1,100}$/
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value)
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isBoundedDateRange(start: string, end: string): boolean {
  const startTime = Date.parse(`${start}T00:00:00.000Z`)
  const endTime = Date.parse(`${end}T00:00:00.000Z`)
  return endTime >= startTime && endTime - startTime <= 30 * 86_400_000
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value))
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function memberOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number])
}

function parseSubject(value: unknown): WorkforceEvidenceTimelineView["evidence"][number]["subject"] | null {
  if (!isRecord(value) || !memberOf(WORKFORCE_EVIDENCE_SUBJECT_KINDS, value.kind)
    || !memberOf(WORKFORCE_EVIDENCE_REVIEW_STATES, value.reviewState)) return null
  if (value.kind === "UNAVAILABLE") {
    if (value.id !== null || value.action !== null || value.claimedAt !== null) return null
    return { kind: value.kind, action: null, claimedAt: null, reviewState: value.reviewState }
  }
  if (!isIdentifier(value.id) || !isInstant(value.claimedAt)) return null
  if (value.kind === "WORKDAY_EVENT") {
    if (!memberOf(["START", "PAUSE", "RESUME", "FINISH", "REOPEN"] as const, value.action)) return null
  } else if (!memberOf(["ARRIVAL", "DEPARTURE"] as const, value.action)) return null
  return {
    kind: value.kind,
    action: value.action,
    claimedAt: value.claimedAt,
    reviewState: value.reviewState,
  }
}

function parseAssessments(value: unknown): WorkforceEvidenceTimelineView["evidence"][number]["assessments"] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const ids = new Set<string>()
  const parsed = value.flatMap((candidate) => {
    if (!isRecord(candidate) || !isIdentifier(candidate.id) || ids.has(candidate.id)
      || !memberOf(WORKFORCE_EVIDENCE_ASSESSMENT_KINDS, candidate.kind)
      || !memberOf(WORKFORCE_EVIDENCE_VERDICTS, candidate.verdict)
      || typeof candidate.assessorVersion !== "string" || candidate.assessorVersion.length < 1
      || candidate.assessorVersion.length > 64 || !isInstant(candidate.assessedAt)
      || !Array.isArray(candidate.reasonCodes) || candidate.reasonCodes.length < 1
      || candidate.reasonCodes.length > 20
      || !candidate.reasonCodes.every((reason): reason is string => typeof reason === "string" && REASON_CODE.test(reason))) return []
    ids.add(candidate.id)
    return [{
      kind: candidate.kind,
      verdict: candidate.verdict,
      reasonCodes: [...candidate.reasonCodes],
      assessedAt: candidate.assessedAt,
    }]
  })
  return parsed.length === value.length ? parsed : null
}

/**
 * Parses the complete, bounded API contract and returns a rendering model that
 * deliberately drops every internal evidence/subject/assessment identifier.
 */
export function parseWorkforceEvidenceTimeline(
  value: unknown,
  expectedAgentId: string,
): WorkforceEvidenceTimelineView | null {
  if (!isRecord(value) || !isTimezone(value.timezone) || !isDateKey(value.start)
    || !isDateKey(value.end) || !isBoundedDateRange(value.start, value.end) || !isRecord(value.employee)
    || value.employee.id !== expectedAgentId || !isIdentifier(value.employee.id)
    || typeof value.employee.name !== "string" || value.employee.name.trim().length < 1
    || value.employee.name.length > 500 || !isRecord(value.access)
    || !memberOf(WORKFORCE_EVIDENCE_ACCESS_PURPOSES, value.access.purpose)
    || !memberOf(WORKFORCE_EVIDENCE_ACCESS_REASONS, value.access.reasonCode)
    || (value.access.caseReference !== null
      && (typeof value.access.caseReference !== "string" || !CASE_REFERENCE.test(value.access.caseReference)))
    || !isRecord(value.boundaries)
    || value.boundaries.projection !== "DERIVED_ONLY"
    || value.boundaries.rawEvidence !== "NOT_RETURNED"
    || value.boundaries.physicalPresence !== "VERDICT_IS_NOT_IDENTITY_OR_PRESENCE_PROOF"
    || !Array.isArray(value.evidence) || value.evidence.length > 500) return null

  const ids = new Set<string>()
  const evidence = value.evidence.flatMap((candidate) => {
    if (!isRecord(candidate) || !isIdentifier(candidate.id) || ids.has(candidate.id)
      || !memberOf(WORKFORCE_EVIDENCE_SOURCES, candidate.source)
      || !isInstant(candidate.capturedAt)
      || !memberOf(WORKFORCE_EVIDENCE_RETENTION_STATES, candidate.rawRetentionState)) return []
    const subject = parseSubject(candidate.subject)
    const assessments = parseAssessments(candidate.assessments)
    if (!subject || !assessments) return []
    ids.add(candidate.id)
    return [{
      source: candidate.source,
      capturedAt: candidate.capturedAt,
      rawRetentionState: candidate.rawRetentionState,
      subject,
      assessments,
    }]
  })
  if (evidence.length !== value.evidence.length) return null
  return {
    timezone: value.timezone,
    start: value.start,
    end: value.end,
    employeeName: value.employee.name.trim(),
    access: {
      purpose: value.access.purpose,
      reasonCode: value.access.reasonCode,
      caseReference: value.access.caseReference,
    },
    evidence,
  }
}

export function parseWorkforceEvidenceTargets(value: unknown): {
  items: WorkforceEvidenceTarget[]
  hasMore: boolean
} | null {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 25
    || typeof value.hasMore !== "boolean") return null
  const ids = new Set<string>()
  const items = value.items.flatMap((candidate) => {
    if (!isRecord(candidate) || !isIdentifier(candidate.id) || ids.has(candidate.id)
      || typeof candidate.label !== "string" || candidate.label.trim().length < 1
      || candidate.label.length > 500) return []
    ids.add(candidate.id)
    return [{ id: candidate.id, label: candidate.label.trim() }]
  })
  return items.length === value.items.length ? { items, hasMore: value.hasMore } : null
}
