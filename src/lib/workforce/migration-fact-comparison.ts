import { createHash } from "node:crypto"
import { workforceWorkdayEventFact, WORKFORCE_WORKDAY_EVENT_TYPES } from "@/lib/workforce/workday-facts-replay"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { WORKFORCE_MOBILE_SCHEMA_SUPPORT } from "@/lib/workforce/mobile-schema-support"

type Scoped = { id: string; organizationId: string; agentId: string }
type Workday = Scoped & Parameters<typeof workforceWorkdayCorrectionFacts>[0]
type Event = Scoped & Parameters<typeof workforceWorkdayEventFact>[0] & {
  workdayId: string
  schemaVersion: number
  requestHash: string | null
  claimedAt: Date | null
  capturedAt: Date | null
  queuedAt: Date | null
  serverReceivedAt: Date | null
  attendanceReviewState: string
}

/** Caller assertions are prerequisites, never proof of historical completeness. */
export type WorkforceMigrationFactSnapshot = {
  organizationId: string
  periodStart: string
  periodEnd: string
  agentIds: readonly string[]
  sourceSnapshotId: string
  capturedAt: Date
  coverage: {
    complete: true
    consistentSnapshot: true
    workdays: number
    events: number
  }
  workdays: readonly Workday[]
  events: readonly Event[]
}

export class WorkforceMigrationFactComparisonError extends Error {
  readonly code = "WORKFORCE_MIGRATION_FACT_INPUT_INVALID"
  constructor() { super("WORKFORCE_MIGRATION_FACT_INPUT_INVALID") }
}

const LIMITS = { workdays: 1_000, events: 5_000 }
const REVIEW_STATES = new Set(["LEGACY_UNKNOWN", "NOT_REQUIRED", "PENDING_REVIEW"])
function fail(): never { throw new WorkforceMigrationFactComparisonError() }
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) fail()
  return value
}
function instant(value: unknown): string {
  if (!(value instanceof Date)) fail()
  const milliseconds = Date.prototype.getTime.call(value)
  if (!Number.isFinite(milliseconds)) fail()
  return Date.prototype.toISOString.call(new Date(milliseconds))
}
function nullableInstant(value: unknown): string | null { return value === null ? null : instant(value) }
function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail()
  return value
}
function scoped(row: Scoped, organizationId: string) {
  const id = identifier(row.id), agentId = identifier(row.agentId)
  if (row.organizationId !== organizationId) fail()
  return { id, agentId, organizationId }
}
function digest(rows: readonly { id: string }[]): string {
  const ordered = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return createHash("sha256").update("workforce-migration-facts-v1\0").update(JSON.stringify(ordered)).digest("hex")
}
function unique(rows: readonly Scoped[]) {
  const ids = new Set<string>()
  for (const row of rows) {
    const id = identifier(row?.id)
    if (ids.has(id)) fail()
    ids.add(id)
  }
}

function project(snapshot: WorkforceMigrationFactSnapshot) {
  const org = identifier(snapshot.organizationId)
  const start = day(snapshot.periodStart), end = day(snapshot.periodEnd)
  if (start > end) fail()
  const capturedAt = Date.parse(instant(snapshot.capturedAt))
  identifier(snapshot.sourceSnapshotId)
  if (!Array.isArray(snapshot.agentIds) || snapshot.agentIds.length < 1 || snapshot.agentIds.length > 1_000) fail()
  const agentIds = snapshot.agentIds.map(identifier).sort()
  for (const agentId of agentIds) identifier(agentId)
  const agents = new Set(agentIds)
  if (agents.size !== agentIds.length) fail()
  if (snapshot.coverage.complete !== true || snapshot.coverage.consistentSnapshot !== true) fail()
  for (const kind of ["workdays", "events"] as const) {
    const rows = snapshot[kind]
    if (!Array.isArray(rows) || rows.length > LIMITS[kind]
      || snapshot.coverage[kind] !== rows.length) fail()
  }
  const workdays = [...snapshot.workdays].map(row => {
    const scope = scoped(row, org)
    if (!agents.has(scope.agentId)) fail()
    const date = instant(row.workDate), status = row.status, totalPausedSeconds = row.totalPausedSeconds
    if (!date.endsWith("T00:00:00.000Z") || date.slice(0, 10) < start || date.slice(0, 10) > end
      || !["STARTED", "PAUSED", "COMPLETED"].includes(status)
      || !Number.isSafeInteger(totalPausedSeconds) || totalPausedSeconds < 0) fail()
    const startedAt = instant(row.startedAt), pausedAt = nullableInstant(row.pausedAt)
    const completedAt = nullableInstant(row.completedAt)
    return { ...scope, ...workforceWorkdayCorrectionFacts({
      id: scope.id, workDate: new Date(date), status, totalPausedSeconds,
      startedAt: new Date(startedAt), pausedAt: pausedAt === null ? null : new Date(pausedAt),
      completedAt: completedAt === null ? null : new Date(completedAt),
    }) }
  })
  unique(workdays)
  const parents = new Map(workdays.map(row => [row.id, row]))
  const events = [...snapshot.events].map(row => {
    const scope = scoped(row, org), workdayId = identifier(row.workdayId)
    const parent = parents.get(workdayId)
    const type = row.type, schemaVersion = row.schemaVersion, attendanceReviewState = row.attendanceReviewState
    const requestHash = row.requestHash, clientEventId = row.clientEventId
    if (!parent || parent.agentId !== scope.agentId
      || !WORKFORCE_WORKDAY_EVENT_TYPES.some(known => known === type)
      || !WORKFORCE_MOBILE_SCHEMA_SUPPORT.workdayRequest.supported.some(version => version === schemaVersion)
      || !REVIEW_STATES.has(attendanceReviewState)
      || (requestHash !== null && (typeof requestHash !== "string" || !/^[0-9a-f]{64}$/.test(requestHash)))) fail()
    if (clientEventId !== null && (typeof clientEventId !== "string"
      || !clientEventId.trim() || clientEventId.length > 256 || /[\u0000-\u001f]/.test(clientEventId))) fail()
    const occurredAt = instant(row.occurredAt), appliedAt = nullableInstant(row.appliedAt)
    return {
      ...scope, workdayId,
      ...workforceWorkdayEventFact({ id: scope.id, type, occurredAt: new Date(occurredAt),
        appliedAt: appliedAt === null ? null : new Date(appliedAt), clientEventId }),
      schemaVersion, requestHash,
      claimedAt: nullableInstant(row.claimedAt), capturedAt: nullableInstant(row.capturedAt),
      queuedAt: nullableInstant(row.queuedAt), serverReceivedAt: nullableInstant(row.serverReceivedAt),
      attendanceReviewState,
    }
  })
  unique(events)
  if (Buffer.byteLength(JSON.stringify({ workdays, events }), "utf8") > 4 * 1024 * 1024) fail()
  return { org, start, end, capturedAt, agentIds, workdays, events }
}

/**
 * Dormant, read-only comparison of supplied complete fact snapshots. The caller
 * must separately prove authorization, consistent extraction, frozen scope and
 * historical provenance. MATCHED_INPUT_FACTS is never staging/rollout approval.
 * Hashes, identifiers and raw evidence never leave the comparison boundary.
 */
export function compareWorkforceMigrationFacts(input: {
  before: WorkforceMigrationFactSnapshot
  after: WorkforceMigrationFactSnapshot
}) {
  try {
    const before = project(input.before), after = project(input.after)
    if (before.org !== after.org || before.start !== after.start || before.end !== after.end
      || JSON.stringify(before.agentIds) !== JSON.stringify(after.agentIds)
      || before.capturedAt > after.capturedAt) fail()
    const kinds = ["workdays", "events"] as const
    const compared = Object.fromEntries(kinds.map(kind => [kind, {
      before: before[kind].length,
      after: after[kind].length,
      countMatches: before[kind].length === after[kind].length,
      factsMatch: digest(before[kind]) === digest(after[kind]),
    }])) as Record<typeof kinds[number], { before: number; after: number; countMatches: boolean; factsMatch: boolean }>
    return {
      contract: "workforce-migration-facts-v1" as const,
      comparisonScope: "PROVIDED_BOUNDED_FACTS" as const,
      status: kinds.every(kind => compared[kind].factsMatch) ? "MATCHED_INPUT_FACTS" as const : "FACT_MISMATCH" as const,
      compared,
      notCovered: ["APPROVALS", "REPORTS", "POLICY_SHIFT_SCHEDULE_CONTENT", "CORRECTION_LEDGERS", "RAW_EVIDENCE", "EXTRACTION_PROVENANCE"] as const,
      historicalCompleteness: "CALLER_ASSERTED_NOT_VERIFIED" as const,
      rolloutAcceptance: "NOT_ESTABLISHED" as const,
      repair: "NONE" as const,
    }
  } catch {
    // Never forward parser/date/validation messages containing source values.
    throw new WorkforceMigrationFactComparisonError()
  }
}
