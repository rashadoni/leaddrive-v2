import { Prisma } from "@prisma/client"
import { DecryptError, decryptToken, encryptToken } from "@/lib/secure-token"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"

/** Read-only v2 streams remain independently cohort-gated and pull-only. */
export const MTM_MOBILE_SYNC_V2_PROTOCOL = 2
export const MTM_MOBILE_SYNC_V2_ROUTE_STREAM = "routes" as const
export const MTM_MOBILE_SYNC_V2_VISIT_STREAM = "visits" as const
export const MTM_MOBILE_SYNC_V2_TASK_STREAM = "tasks" as const
export const MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM = "workforce" as const
export const MTM_MOBILE_SYNC_V2_MAX_PAGE_SIZE = 500
export const MTM_MOBILE_SYNC_V2_DEFAULT_PAGE_SIZE = 200
export const MTM_MOBILE_SYNC_V2_SNAPSHOT_TTL_MS = 60 * 60 * 1_000
export const MTM_MOBILE_SYNC_V2_TOMBSTONE_RETENTION_DAYS = 14
export const MTM_MOBILE_SYNC_V2_MAX_CURSOR_LENGTH = 4_096
/** Device route-cache policy approved for the future, cohort-gated v2 client. */
export const MTM_MOBILE_SYNC_V2_ROUTE_OFFLINE_HORIZON_DAYS = 7
/** Terminal route history outside the active window is not retained on-device. */
export const MTM_MOBILE_SYNC_V2_ROUTE_TERMINAL_HISTORY_DAYS = 0
// Bump this whenever the server changes the route inclusion window. It is
// part of the opaque cursor/snapshot horizon key, so a server-first policy
// rollout cannot silently reuse a cache built with older rules.
export const MTM_MOBILE_SYNC_V2_ROUTE_HORIZON_POLICY_VERSION = "v2"
// Visits and tasks start with the smallest safe horizon: only currently
// active work. Their key is explicit so a later, reviewed history policy can
// force a stream-local rebuild instead of silently widening a cache.
export const MTM_MOBILE_SYNC_V2_ACTIVE_VISIT_HORIZON_POLICY_VERSION = "v1"
export const MTM_MOBILE_SYNC_V2_ACTIVE_TASK_HORIZON_POLICY_VERSION = "v1"
// Workforce starts with only the agent's own active workday state. Calendar
// policy, completed history, HRM requests and their free-form reason/decision
// fields remain on v1 until a separate data-horizon and privacy contract is
// approved.
export const MTM_MOBILE_SYNC_V2_WORKDAY_HORIZON_POLICY_VERSION = "v1"
// A delta cursor must survive the approved seven-day offline period. It is
// deliberately no longer than journal retention: after this window the
// server returns a controlled stream resnapshot rather than accepting a
// cursor whose tombstones may have been pruned.
export const MTM_MOBILE_SYNC_V2_DELTA_CURSOR_TTL_MS =
  MTM_MOBILE_SYNC_V2_TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1_000

export type MtmMobileSyncV2Stream =
  | typeof MTM_MOBILE_SYNC_V2_ROUTE_STREAM
  | typeof MTM_MOBILE_SYNC_V2_VISIT_STREAM
  | typeof MTM_MOBILE_SYNC_V2_TASK_STREAM
  | typeof MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM

export type MobileSyncV2CursorContext = {
  organizationId: string
  agentId: string
  deviceId: string
  stream: MtmMobileSyncV2Stream
}

type CursorBase = Record<string, unknown> & {
  v: 2
  stream: MtmMobileSyncV2Stream
  organizationId: string
  agentId: string
  deviceId: string
  /** Decimal string — JSON cannot encode bigint directly. */
  scopeRevision: string
  horizonKey: string
  exp: number
}

export type MobileSyncV2DeltaCursor = CursorBase & {
  kind: "delta"
  revision: string
}

export type MobileSyncV2SnapshotCursor = CursorBase & {
  kind: "snapshot"
  snapshotId: string
  ordinal: number
}

export type MobileSyncV2Cursor = MobileSyncV2DeltaCursor | MobileSyncV2SnapshotCursor

export class MobileSyncV2CursorError extends Error {
  constructor(
    public readonly code: "MOBILE_SYNC_V2_CURSOR_INVALID" | "MOBILE_SYNC_V2_CURSOR_EXPIRED",
  ) {
    super(code)
    this.name = "MobileSyncV2CursorError"
  }
}

export class MobileSyncV2ResnapshotRequiredError extends Error {
  constructor(
    public readonly reason:
      | "RETENTION_EXPIRED"
      | "SCOPE_CHANGED"
      | "HORIZON_CHANGED"
      | "SNAPSHOT_EXPIRED"
      | "STREAM_REWOUND",
  ) {
    super("MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED")
    this.name = "MobileSyncV2ResnapshotRequiredError"
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function decimalBigint(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
}

function knownStream(value: unknown): value is MtmMobileSyncV2Stream {
  return value === MTM_MOBILE_SYNC_V2_ROUTE_STREAM ||
    value === MTM_MOBILE_SYNC_V2_VISIT_STREAM ||
    value === MTM_MOBILE_SYNC_V2_TASK_STREAM ||
    value === MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM
}

function baseMatches(value: Record<string, unknown>): value is CursorBase {
  return value.v === MTM_MOBILE_SYNC_V2_PROTOCOL &&
    knownStream(value.stream) &&
    nonEmptyString(value.organizationId) &&
    nonEmptyString(value.agentId) &&
    nonEmptyString(value.deviceId) &&
    decimalBigint(value.scopeRevision) &&
    nonEmptyString(value.horizonKey) &&
    typeof value.exp === "number" && Number.isSafeInteger(value.exp)
}

function parseCursor(value: unknown, nowMs: number): MobileSyncV2Cursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
  }
  const cursor = value as Record<string, unknown>
  if (!baseMatches(cursor)) throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
  if (cursor.exp <= nowMs) throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_EXPIRED")
  if (cursor.kind === "delta" && decimalBigint(cursor.revision)) {
    return cursor as MobileSyncV2DeltaCursor
  }
  if (
    cursor.kind === "snapshot" &&
    nonEmptyString(cursor.snapshotId) &&
    typeof cursor.ordinal === "number" &&
    Number.isSafeInteger(cursor.ordinal) &&
    cursor.ordinal >= 0
  ) {
    return cursor as MobileSyncV2SnapshotCursor
  }
  throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
}

/**
 * Seal cursors instead of exposing timestamp/offset/revision internals. The
 * encrypted claim is bound to tenant, actor, registered device and stream.
 */
export function issueMobileSyncV2Cursor(cursor: MobileSyncV2Cursor): string {
  return encryptToken(JSON.stringify(cursor), "mtm-mobile-sync-v2-cursor")
}

export function readMobileSyncV2Cursor(
  token: string,
  expected: MobileSyncV2CursorContext,
  nowMs = Date.now(),
): MobileSyncV2Cursor {
  if (
    token.length === 0
    || token.length > MTM_MOBILE_SYNC_V2_MAX_CURSOR_LENGTH
    || !token.startsWith("v1:")
  ) {
    throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
  }
  let decrypted: string
  try {
    decrypted = decryptToken(token, "mtm-mobile-sync-v2-cursor")
  } catch (error) {
    if (error instanceof DecryptError) throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(decrypted)
  } catch {
    throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
  }
  const cursor = parseCursor(value, nowMs)
  if (
    cursor.organizationId !== expected.organizationId ||
    cursor.agentId !== expected.agentId ||
    cursor.deviceId !== expected.deviceId ||
    cursor.stream !== expected.stream
  ) {
    throw new MobileSyncV2CursorError("MOBILE_SYNC_V2_CURSOR_INVALID")
  }
  return cursor
}

export function parseMobileSyncV2PageSize(value: string | null): number {
  if (value == null || value === "") return MTM_MOBILE_SYNC_V2_DEFAULT_PAGE_SIZE
  if (!/^\d+$/.test(value)) return MTM_MOBILE_SYNC_V2_DEFAULT_PAGE_SIZE
  return Math.min(MTM_MOBILE_SYNC_V2_MAX_PAGE_SIZE, Math.max(1, Number(value)))
}

export function parseMobileSyncV2DeviceId(value: string | null): string | null {
  // Header values occasionally have harmless outer spaces from proxies, but
  // never normalise a control character into a valid cohort selector. In
  // particular, `"\nunsafe".trim()` must not become a different device id.
  if (value != null && /[\r\n\t\f\v]/.test(value)) return null
  const deviceId = value?.trim()
  // Device IDs are stable, transport-safe opaque identifiers generated by the
  // APK. Reject whitespace/control characters instead of using them as a
  // surprising cohort or rate-limit key.
  return deviceId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)
    ? deviceId
    : null
}

export function mobileSyncV2RouteScope(
  organizationId: string,
  agentId: string,
): Prisma.MtmRouteWhereInput {
  return {
    organizationId,
    deletedAt: null,
    OR: [
      { agentId },
      {
        assignments: {
          some: {
            organizationId,
            agentId,
            removedAt: null,
            role: { not: "OBSERVER" },
          },
        },
      },
    ],
  }
}

export function mobileSyncV2RouteHorizon(timezone: string, now = new Date()) {
  const dateKey = currentDateKey(now, timezone)
  return {
    // Date alone is not an authority boundary: an administrator can change a
    // tenant timezone while the local date happens to remain the same. Bind
    // both inputs and the server policy revision, forcing a controlled stream
    // rebuild before an old snapshot/cache crosses the new horizon.
    key: `${MTM_MOBILE_SYNC_V2_ROUTE_HORIZON_POLICY_VERSION}:${timezone}:${dateKey}`,
    // The owner-approved device cache contains exactly the current local
    // calendar day plus the next six: [today, today + 7 days). Completed and
    // cancelled history outside it is not part of the Route v2 snapshot.
    // An in-progress route remains visible for safe recovery until it reaches
    // a terminal state (the query adds that narrow exception below).
    from: localDateKeyToUtc(dateKey, timezone),
    until: localDateKeyToUtc(addDateKeyDays(dateKey, 7), timezone),
  }
}

export type MtmMobileSyncV2Horizon = { key: string }

/** Active visit data has no date-based history window in the first pilot. */
export function mobileSyncV2ActiveVisitHorizon(): MtmMobileSyncV2Horizon {
  return { key: `active-visits:${MTM_MOBILE_SYNC_V2_ACTIVE_VISIT_HORIZON_POLICY_VERSION}` }
}

/** Active task data has no date-based history window in the first pilot. */
export function mobileSyncV2ActiveTaskHorizon(): MtmMobileSyncV2Horizon {
  return { key: `active-tasks:${MTM_MOBILE_SYNC_V2_ACTIVE_TASK_HORIZON_POLICY_VERSION}` }
}

/**
 * The first workforce cache is deliberately only the current active shift.
 * It has no calendar/history window to accidentally broaden or leave behind,
 * while the shared v2 cursor still retains the owner-approved seven-day
 * offline period. Timezone/calendar/HRM history remains the compatible v1
 * workspace until a reviewed policy exists.
 */
export function mobileSyncV2WorkdayHorizon(): MtmMobileSyncV2Horizon {
  return { key: `active-workdays:${MTM_MOBILE_SYNC_V2_WORKDAY_HORIZON_POLICY_VERSION}` }
}

export function mobileSyncV2RoutePilotWhere(input: {
  organizationId: string
  agentId: string
  timezone: string
  now?: Date
}): Prisma.MtmRouteWhereInput {
  const scope = mobileSyncV2RouteScope(input.organizationId, input.agentId)
  const horizon = mobileSyncV2RouteHorizon(input.timezone, input.now)
  return {
    ...scope,
    AND: [
      {
        OR: [
          { date: { gte: horizon.from, lt: horizon.until } },
          { status: "IN_PROGRESS" },
        ],
      },
    ],
  }
}

/**
 * Minimal read-only visit scope. The richer workspace (including a secondary
 * participant's on-demand view) remains a v1 endpoint for now, so this first
 * pilot never widens the established primary-agent sync audience. It carries
 * neither a customer/contact projection nor coordinates, notes, evidence,
 * media or requirements.
 */
export function mobileSyncV2ActiveVisitWhere(
  organizationId: string,
  agentId: string,
): Prisma.MtmVisitWhereInput {
  return {
    organizationId,
    deletedAt: null,
    status: "CHECKED_IN",
    agentId,
  }
}

/**
 * Minimal read-only task scope. Terminal work and all free-form task content
 * remain on the compatible v1 path until their own explicit product review.
 */
export function mobileSyncV2ActiveTaskWhere(
  organizationId: string,
  agentId: string,
): Prisma.MtmTaskWhereInput {
  return {
    organizationId,
    agentId,
    deletedAt: null,
    status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
  }
}

/**
 * Workday has only one authorised viewer: its own Field agent. Never reuse a
 * team/manager relationship as an implicit mobile sync audience. An open
 * shift remains visible regardless of its original work date to preserve its
 * recovery state after an offline restart; location coordinates and event
 * notes are deliberately not part of the v2 projection.
 */
export function mobileSyncV2WorkdayWhere(input: {
  organizationId: string
  agentId: string
}): Prisma.MtmAgentWorkdayWhereInput {
  return {
    organizationId: input.organizationId,
    agentId: input.agentId,
    status: { in: ["STARTED", "PAUSED"] },
  }
}

type RouteProjectionSource = {
  id: string
  agentId: string
  date: Date
  name: string | null
  status: string
  version: number
  publishedVersion: number | null
  totalPoints: number
  visitedPoints: number
  updatedAt: Date
  assignments: Array<{
    agentId: string
    role: string
    assignedAt: Date
  }>
  points: Array<{
    id: string
    customerId: string
    contactId: string | null
    orderIndex: number
    status: string
    plannedTime: Date | null
    visitedAt: Date | null
  }>
}

/** A minimal, mobile-required route projection; customer/contact PII stays out. */
export function projectMtmMobileSyncV2Route(route: RouteProjectionSource) {
  return {
    id: route.id,
    agentId: route.agentId,
    date: route.date.toISOString(),
    name: route.name,
    status: route.status,
    version: route.version,
    publishedVersion: route.publishedVersion,
    totalPoints: route.totalPoints,
    visitedPoints: route.visitedPoints,
    updatedAt: route.updatedAt.toISOString(),
    assignments: route.assignments.map((assignment) => ({
      agentId: assignment.agentId,
      role: assignment.role,
      assignedAt: assignment.assignedAt.toISOString(),
    })),
    points: route.points.map((point) => ({
      id: point.id,
      customerId: point.customerId,
      contactId: point.contactId,
      orderIndex: point.orderIndex,
      status: point.status,
      plannedTime: point.plannedTime?.toISOString() ?? null,
      visitedAt: point.visitedAt?.toISOString() ?? null,
    })),
  }
}

type VisitProjectionSource = {
  id: string
  routeId: string | null
  routePointId: string | null
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  duration: number | null
  outcome: string | null
  potential: string | null
  nextActionDueAt: Date | null
  updatedAt: Date
}

/** A PII/GPS/media-free active-visit projection for the v2 comparison cache. */
export function projectMtmMobileSyncV2Visit(visit: VisitProjectionSource) {
  return {
    id: visit.id,
    routeId: visit.routeId,
    routePointId: visit.routePointId,
    status: visit.status,
    checkInAt: visit.checkInAt.toISOString(),
    checkOutAt: visit.checkOutAt?.toISOString() ?? null,
    duration: visit.duration,
    outcome: visit.outcome,
    potential: visit.potential,
    nextActionDueAt: visit.nextActionDueAt?.toISOString() ?? null,
    updatedAt: visit.updatedAt.toISOString(),
  }
}

type TaskProjectionSource = {
  id: string
  visitId: string | null
  status: string
  priority: string
  scheduledStartAt: Date | null
  dueDate: Date | null
  completedAt: Date | null
  progress: number | null
  version: number
  acceptedAt: Date | null
  startedAt: Date | null
  updatedAt: Date
}

/** A PII/media-free active-task projection for the v2 comparison cache. */
export function projectMtmMobileSyncV2Task(task: TaskProjectionSource) {
  return {
    id: task.id,
    visitId: task.visitId,
    status: task.status,
    priority: task.priority,
    scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    progress: task.progress,
    version: task.version,
    acceptedAt: task.acceptedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString(),
  }
}

type WorkdayProjectionSource = {
  id: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
  updatedAt: Date
}

/**
 * PII/GPS/note-free read-only active-workday projection. `availableActions`
 * and live worked time remain derived locally from server-authoritative state,
 * rather than becoming a second mutable state machine in this stream.
 */
export function projectMtmMobileSyncV2Workday(workday: WorkdayProjectionSource) {
  return {
    id: workday.id,
    workDate: workday.workDate.toISOString(),
    status: workday.status,
    startedAt: workday.startedAt.toISOString(),
    pausedAt: workday.pausedAt?.toISOString() ?? null,
    completedAt: workday.completedAt?.toISOString() ?? null,
    totalPausedSeconds: workday.totalPausedSeconds,
    updatedAt: workday.updatedAt.toISOString(),
  }
}

export function nextMobileSyncV2DeltaCursor(input: {
  context: MobileSyncV2CursorContext
  revision: bigint
  scopeRevision: bigint
  horizonKey: string
  nowMs?: number
  ttlMs?: number
}): string {
  const nowMs = input.nowMs ?? Date.now()
  return issueMobileSyncV2Cursor({
    v: 2,
    kind: "delta",
    ...input.context,
    revision: input.revision.toString(),
    scopeRevision: input.scopeRevision.toString(),
    horizonKey: input.horizonKey,
    exp: nowMs + (input.ttlMs ?? MTM_MOBILE_SYNC_V2_DELTA_CURSOR_TTL_MS),
  })
}

export function nextMobileSyncV2SnapshotCursor(input: {
  context: MobileSyncV2CursorContext
  snapshotId: string
  ordinal: number
  scopeRevision: bigint
  horizonKey: string
  expiresAt: Date
}): string {
  return issueMobileSyncV2Cursor({
    v: 2,
    kind: "snapshot",
    ...input.context,
    snapshotId: input.snapshotId,
    ordinal: input.ordinal,
    scopeRevision: input.scopeRevision.toString(),
    horizonKey: input.horizonKey,
    exp: input.expiresAt.getTime(),
  })
}
