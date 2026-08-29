import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { currentDateKey } from "@/lib/mtm/mobile-week"

export type MtmWorkdayAction = "START" | "PAUSE" | "RESUME" | "FINISH"

/**
 * Transient H5 evidence. It is intentionally never copied into the immutable
 * workday event: QR and device material are validated inside the transaction
 * and only their dedicated audit-safe verification facts are persisted.
 */
export type MtmWorkdayAttendanceEvidence = {
  qrToken?: string
  device?: {
    enrollmentId: string
    signature: string
  }
}

export type MtmWorkdayEventInput = {
  action: MtmWorkdayAction
  workdayId: string
  clientEventId: string
  /**
   * Compatibility event time. C1 defines it as the employee's claimed action
   * time; its newer explicit alias `claimedAt` must be exactly the same
   * instant so a client cannot provide two competing business times.
   */
  occurredAt: Date
  claimedAt: Date
  capturedAt: Date
  queuedAt: Date | null
  /** Server receipt is assigned by the parser, never accepted from the client. */
  serverReceivedAt: Date
  /** `1` is the legacy envelope, `2` supplies full client provenance. */
  schemaVersion: number
  workDateKey: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  note: string | null
  attendance?: MtmWorkdayAttendanceEvidence
}

export type MtmWorkdayResult =
  | {
      status: "ok"
      workday: Record<string, unknown>
      event: Record<string, unknown>
      idempotent: boolean
    }
  | {
      status: "conflict"
      code: string
      message: string
      workday?: Record<string, unknown>
      /**
       * A server-derived recovery hint for a disclosed current workday. It is
       * informational: the client must refresh before attempting another
       * transition and must not manufacture an action when no workday exists.
       */
      allowedActions?: MtmWorkdayAction[]
    }

type WorkdayDb = Pick<
  Prisma.TransactionClient,
  "mtmAgent" | "mtmAgentWorkday" | "mtmAgentWorkdayEvent" | "$executeRaw"
>

type WorkdayScope = { organizationId: string; agentId: string }

export type MtmWorkdayPostEventContext = {
  scope: WorkdayScope
  input: MtmWorkdayEventInput
  /** The disclosed state before this transition, if a workday already existed. */
  beforeWorkday: Record<string, unknown> | null
  workday: Record<string, unknown> & {
    id: string
    agentId: string
    workDate: Date
    startedAt: Date
  }
  event: Record<string, unknown> & { id: string }
}

export type MtmWorkdayApplyOptions = {
  /**
   * Runs after the canonical event is created but before the surrounding
   * transaction commits. Security proofs can therefore reference that event;
   * a rejection atomically rolls back both state and event.
   */
  afterEvent?: (context: MtmWorkdayPostEventContext) => Promise<void>
}

const WORKDAY_ACTIONS = new Set<MtmWorkdayAction>(["START", "PAUSE", "RESUME", "FINISH"])
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
/** The owner-approved maximum age for an offline Workforce attendance claim. */
export const WORKFORCE_WORKDAY_OFFLINE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
export const WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION = 1
export const WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION = 2

/**
 * Keep recovery actions next to the canonical state machine instead of
 * letting each mobile transport infer a potentially stale next step.
 */
export function recoveryActionsForMtmWorkday(workday: Record<string, unknown> | null | undefined): MtmWorkdayAction[] {
  if (workday?.status === "STARTED") return ["PAUSE", "FINISH"]
  if (workday?.status === "PAUSED") return ["RESUME", "FINISH"]
  return []
}

const workdaySelect = {
  id: true,
  workDate: true,
  status: true,
  startedAt: true,
  pausedAt: true,
  completedAt: true,
  totalPausedSeconds: true,
  startLatitude: true,
  startLongitude: true,
  endLatitude: true,
  endLongitude: true,
  createdAt: true,
  updatedAt: true,
} as const

const eventSelect = {
  id: true,
  workdayId: true,
  clientEventId: true,
  type: true,
  occurredAt: true,
  claimedAt: true,
  capturedAt: true,
  queuedAt: true,
  serverReceivedAt: true,
  appliedAt: true,
  schemaVersion: true,
  requestHash: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  note: true,
  createdAt: true,
} as const

const replayEventSelect = {
  ...eventSelect,
  workday: { select: workdaySelect },
} as const

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function validCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  if (latitude == null && longitude == null) return true
  return finiteNumber(latitude) && latitude >= -90 && latitude <= 90 &&
    finiteNumber(longitude) && longitude >= -180 && longitude <= 180
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100
}

function parseTimestamp(value: unknown): Date | null {
  const parsed = typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : new Date(Number.NaN)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function hasExplicitValue(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] != null
}

function timestampIsTooFarInFuture(value: Date, now: Date): boolean {
  return value.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS
}

function timestampIsBeyondOfflineHorizon(value: Date, now: Date): boolean {
  return value.getTime() < now.getTime() - WORKFORCE_WORKDAY_OFFLINE_HORIZON_MS
}

function validSchemaVersion(value: unknown): value is number {
  return value === WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION || value === WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION
}

function parseAttendanceEvidence(value: unknown): {
  evidence: MtmWorkdayAttendanceEvidence | undefined
  error: string | null
} {
  if (value == null) return { evidence: undefined, error: null }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { evidence: undefined, error: "attendance must be an object" }
  }
  const attendance = value as Record<string, unknown>
  const qrToken = attendance.qrToken
  if (qrToken != null && (typeof qrToken !== "string" || !qrToken.trim() || qrToken.length > 4096)) {
    return { evidence: undefined, error: "attendance.qrToken must be a non-empty string at most 4096 characters" }
  }
  const device = attendance.device
  if (device != null && (!device || typeof device !== "object" || Array.isArray(device))) {
    return { evidence: undefined, error: "attendance.device must be an object" }
  }
  let parsedDevice: MtmWorkdayAttendanceEvidence["device"]
  if (device) {
    const value = device as Record<string, unknown>
    if (!validId(value.enrollmentId)) {
      return { evidence: undefined, error: "attendance.device.enrollmentId is required" }
    }
    if (typeof value.signature !== "string" || !value.signature.trim() || value.signature.length > 8192) {
      return { evidence: undefined, error: "attendance.device.signature must be a non-empty string at most 8192 characters" }
    }
    parsedDevice = {
      enrollmentId: value.enrollmentId.trim(),
      signature: value.signature.trim(),
    }
  }
  const parsedQrToken = typeof qrToken === "string" ? qrToken.trim() : undefined
  if (!parsedQrToken && !parsedDevice) {
    return { evidence: undefined, error: "attendance must include qrToken or device proof" }
  }
  return {
    evidence: {
      ...(parsedQrToken ? { qrToken: parsedQrToken } : {}),
      ...(parsedDevice ? { device: parsedDevice } : {}),
    },
    error: null,
  }
}

export function parseMtmWorkdayEvent(
  data: unknown,
  clientEventId: string,
  timezone: string,
  now = new Date(),
  options: { enforceOfflineHorizon?: boolean } = {},
): { input: MtmWorkdayEventInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "Workday event data must be an object" }
  }
  const value = data as Record<string, unknown>
  const action = value.action
  if (typeof action !== "string" || !WORKDAY_ACTIONS.has(action as MtmWorkdayAction)) {
    return { input: null, error: "Invalid workday action" }
  }
  const workdayId = action === "START" ? value.id : value.workdayId
  if (!validId(workdayId)) {
    return {
      input: null,
      error: action === "START" ? "data.id required for workday start" : "data.workdayId required for workday transition",
    }
  }
  const occurredAt = parseTimestamp(value.occurredAt)
  if (!occurredAt) {
    return { input: null, error: "Valid data.occurredAt is required" }
  }
  if (timestampIsTooFarInFuture(occurredAt, now)) {
    return { input: null, error: "Workday event time is too far in the future" }
  }

  const schemaVersion = value.schemaVersion == null
    ? WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION
    : value.schemaVersion
  if (!validSchemaVersion(schemaVersion)) {
    return {
      input: null,
      error: `Unsupported Workforce workday schemaVersion; expected ${WORKFORCE_WORKDAY_LEGACY_SCHEMA_VERSION} or ${WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION}`,
    }
  }

  const claimedAt = hasExplicitValue(value, "claimedAt") ? parseTimestamp(value.claimedAt) : occurredAt
  const capturedAt = hasExplicitValue(value, "capturedAt") ? parseTimestamp(value.capturedAt) : occurredAt
  const queuedAt = hasExplicitValue(value, "queuedAt") ? parseTimestamp(value.queuedAt) : null
  if (!claimedAt || !capturedAt || (hasExplicitValue(value, "queuedAt") && !queuedAt)) {
    return { input: null, error: "Workday provenance timestamps are invalid" }
  }
  if (claimedAt.getTime() !== occurredAt.getTime()) {
    return { input: null, error: "claimedAt must equal occurredAt for a Workforce workday event" }
  }
  if (
    timestampIsTooFarInFuture(claimedAt, now)
    || timestampIsTooFarInFuture(capturedAt, now)
    || (queuedAt && timestampIsTooFarInFuture(queuedAt, now))
  ) {
    return { input: null, error: "Workday provenance time is too far in the future" }
  }
  if (options.enforceOfflineHorizon !== false && timestampIsBeyondOfflineHorizon(claimedAt, now)) {
    return {
      input: null,
      error: "Workday event is beyond the supported seven-day offline horizon",
    }
  }
  if (
    (queuedAt && (claimedAt > queuedAt || capturedAt > queuedAt))
    || (schemaVersion === WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION && !queuedAt)
  ) {
    return {
      input: null,
      error: "Workday provenance must be ordered and schemaVersion 2 requires queuedAt",
    }
  }
  if (!validCoordinatePair(value.latitude, value.longitude)) {
    return { input: null, error: "Valid latitude and longitude are required together" }
  }
  if (value.accuracy != null && (!finiteNumber(value.accuracy) || value.accuracy < 0)) {
    return { input: null, error: "accuracy must be a non-negative number" }
  }
  const note = typeof value.note === "string" ? value.note.trim() : ""
  if (note.length > 500) {
    return { input: null, error: "Workday note must be 500 characters or fewer" }
  }
  const attendance = parseAttendanceEvidence(value.attendance)
  if (attendance.error) return { input: null, error: attendance.error }

  return {
    input: {
      action: action as MtmWorkdayAction,
      workdayId,
      clientEventId,
      occurredAt,
      claimedAt,
      capturedAt,
      queuedAt,
      serverReceivedAt: now,
      schemaVersion,
      workDateKey: currentDateKey(occurredAt, timezone),
      latitude: value.latitude == null ? null : value.latitude as number,
      longitude: value.longitude == null ? null : value.longitude as number,
      accuracy: value.accuracy == null ? null : value.accuracy as number,
      note: note || null,
      ...(attendance.evidence ? { attendance: attendance.evidence } : {}),
    },
    error: null,
  }
}

/**
 * Canonical digest for a new workday mutation. It binds the authenticated
 * actor, action, client times, schema and non-reversible evidence digests to
 * the operation ID. Raw QR/device proof never enters the database through
 * this function.
 *
 * C2 will replace `segment: null` with the effective-dated segment reference;
 * keeping the reserved field in the canonical wire shape prevents a later
 * segment-aware schema from quietly weakening existing request hashing.
 */
export function mtmWorkdayRequestHash(scope: WorkdayScope, input: MtmWorkdayEventInput): string {
  const qrFingerprint = input.attendance?.qrToken
    ? createHash("sha256").update(input.attendance.qrToken).digest("hex")
    : null
  const deviceProofFingerprint = input.attendance?.device
    ? createHash("sha256").update(input.attendance.device.signature).digest("hex")
    : null
  return createHash("sha256").update(JSON.stringify({
    version: 2,
    organizationId: scope.organizationId,
    agentId: scope.agentId,
    clientEventId: input.clientEventId,
    action: input.action,
    workdayId: input.workdayId,
    claimedAt: input.claimedAt.toISOString(),
    capturedAt: input.capturedAt.toISOString(),
    queuedAt: input.queuedAt?.toISOString() ?? null,
    schemaVersion: input.schemaVersion,
    segment: null,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    note: input.note,
    qrFingerprint,
    deviceEnrollmentId: input.attendance?.device?.enrollmentId ?? null,
    deviceProofFingerprint,
  })).digest("hex")
}

function conflict(
  code: string,
  message: string,
  workday?: Record<string, unknown> | null,
): MtmWorkdayResult {
  return {
    status: "conflict",
    code,
    message,
    ...(workday ? {
      workday,
      allowedActions: recoveryActionsForMtmWorkday(workday),
    } : {}),
  }
}

export function mtmWorkdayReplayMatches(
  replay: {
    workdayId: string
    type: string
    occurredAt: Date
    latitude: number | null
    longitude: number | null
    accuracy: number | null
    note: string | null
    requestHash?: string | null
  },
  input: MtmWorkdayEventInput,
  scope?: WorkdayScope,
): boolean {
  if (typeof replay.requestHash === "string" && replay.requestHash.length > 0) {
    // A C1-provenance event must never fall back to the weaker legacy field
    // comparison merely because a transport omitted one newer field.
    return scope != null && replay.requestHash === mtmWorkdayRequestHash(scope, input)
  }
  // H5 proof material is deliberately absent. A true replay must remain
  // possible after its QR expires, because the canonical event already owns
  // the result and proof ledger; clientEventId still rejects a changed event.
  return replay.type === input.action &&
    replay.workdayId === input.workdayId &&
    replay.occurredAt.getTime() === input.occurredAt.getTime() &&
    replay.latitude === input.latitude &&
    replay.longitude === input.longitude &&
    replay.accuracy === input.accuracy &&
    replay.note === input.note
}

function pausedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000))
}

/**
 * Serialize every workday writer for an employee inside its surrounding
 * transaction. Both the week endpoint and offline/mobile sync use this exact
 * key, so a transition cannot read state while another writer is changing it.
 */
export async function lockMtmWorkdayTransitions(
  db: Pick<WorkdayDb, "$executeRaw">,
  scope: WorkdayScope,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mtm-workday:${scope.organizationId}:${scope.agentId}`}))`
}

export async function applyMtmWorkdayEvent(
  db: WorkdayDb,
  scope: WorkdayScope,
  input: MtmWorkdayEventInput,
  options: MtmWorkdayApplyOptions = {},
): Promise<MtmWorkdayResult> {
  // Keep the lock in the shared state machine. Callers may acquire it earlier
  // when they need a replay check under the same fence; PostgreSQL advisory
  // transaction locks are reentrant for the owning transaction.
  await lockMtmWorkdayTransitions(db, scope)

  // clientEventId belongs to the immutable workday event, not to a transport.
  // Resolve it under the shared fence so a web event retried through offline
  // sync (or the inverse) replays identically instead of hitting a unique-key
  // race or re-applying the state transition.
  const replay = await db.mtmAgentWorkdayEvent.findFirst({
    where: {
      organizationId: scope.organizationId,
      agentId: scope.agentId,
      clientEventId: input.clientEventId,
    },
    select: replayEventSelect,
  })
  if (replay) {
    if (!mtmWorkdayReplayMatches(replay, input, scope)) {
      return conflict(
        "MTM_WORKDAY_IDEMPOTENCY_MISMATCH",
        "clientEventId was already used for a different workday operation",
      )
    }
    const { workday, ...event } = replay
    return {
      status: "ok",
      workday: workday as Record<string, unknown>,
      event: event as Record<string, unknown>,
      idempotent: true,
    }
  }

  const baseEvent = {
    organizationId: scope.organizationId,
    agentId: scope.agentId,
    workdayId: input.workdayId,
    clientEventId: input.clientEventId,
    type: input.action,
    occurredAt: input.occurredAt,
    claimedAt: input.claimedAt,
    capturedAt: input.capturedAt,
    queuedAt: input.queuedAt,
    serverReceivedAt: input.serverReceivedAt,
    appliedAt: new Date(),
    schemaVersion: input.schemaVersion,
    requestHash: mtmWorkdayRequestHash(scope, input),
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    note: input.note,
  }

  if (input.action === "START") {
    const workDate = new Date(`${input.workDateKey}T00:00:00.000Z`)
    const [sameDay, activeWorkday] = await Promise.all([
      db.mtmAgentWorkday.findFirst({
        where: {
          organizationId: scope.organizationId,
          agentId: scope.agentId,
          workDate,
        },
        select: workdaySelect,
      }),
      db.mtmAgentWorkday.findFirst({
        where: {
          organizationId: scope.organizationId,
          agentId: scope.agentId,
          status: { in: ["STARTED", "PAUSED"] },
        },
        orderBy: { startedAt: "desc" },
        select: workdaySelect,
      }),
    ])
    if (sameDay) {
      return conflict("MTM_WORKDAY_ALREADY_EXISTS", "A workday already exists for this date", sameDay as Record<string, unknown>)
    }
    if (activeWorkday) {
      return conflict("MTM_WORKDAY_ACTIVE", "Another workday is still active", activeWorkday as Record<string, unknown>)
    }

    const workday = await db.mtmAgentWorkday.create({
      data: {
        id: input.workdayId,
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        workDate,
        status: "STARTED",
        startedAt: input.occurredAt,
        startLatitude: input.latitude,
        startLongitude: input.longitude,
      },
      select: workdaySelect,
    })
    const event = await db.mtmAgentWorkdayEvent.create({ data: baseEvent, select: eventSelect })
    await options.afterEvent?.({
      scope,
      input,
      beforeWorkday: null,
      workday: { ...workday, agentId: scope.agentId } as MtmWorkdayPostEventContext["workday"],
      event: event as MtmWorkdayPostEventContext["event"],
    })
    return {
      status: "ok",
      workday: workday as Record<string, unknown>,
      event: event as Record<string, unknown>,
      idempotent: false,
    }
  }

  const workday = await db.mtmAgentWorkday.findFirst({
    where: {
      id: input.workdayId,
      organizationId: scope.organizationId,
      agentId: scope.agentId,
    },
    select: workdaySelect,
  })
  if (!workday) return conflict("MTM_WORKDAY_NOT_FOUND", "Workday not found")
  if (workday.status === "COMPLETED") {
    return conflict("MTM_WORKDAY_COMPLETED", "Completed workday cannot be changed", workday as Record<string, unknown>)
  }

  const lastEvent = await db.mtmAgentWorkdayEvent.findFirst({
    where: { workdayId: workday.id, organizationId: scope.organizationId },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  })
  if (input.occurredAt.getTime() < workday.startedAt.getTime() ||
      (lastEvent && input.occurredAt.getTime() < lastEvent.occurredAt.getTime())) {
    return conflict("MTM_WORKDAY_EVENT_OUT_OF_ORDER", "Workday event is older than the current state", workday as Record<string, unknown>)
  }

  let update: Record<string, unknown>
  if (input.action === "PAUSE") {
    if (workday.status !== "STARTED") {
      return conflict("MTM_WORKDAY_NOT_RUNNING", "Only a running workday can be paused", workday as Record<string, unknown>)
    }
    update = { status: "PAUSED", pausedAt: input.occurredAt }
  } else if (input.action === "RESUME") {
    if (workday.status !== "PAUSED" || !workday.pausedAt) {
      return conflict("MTM_WORKDAY_NOT_PAUSED", "Only a paused workday can be resumed", workday as Record<string, unknown>)
    }
    update = {
      status: "STARTED",
      pausedAt: null,
      totalPausedSeconds: workday.totalPausedSeconds + pausedSeconds(workday.pausedAt, input.occurredAt),
    }
  } else {
    const additionalPause = workday.status === "PAUSED" && workday.pausedAt
      ? pausedSeconds(workday.pausedAt, input.occurredAt)
      : 0
    update = {
      status: "COMPLETED",
      pausedAt: null,
      completedAt: input.occurredAt,
      totalPausedSeconds: workday.totalPausedSeconds + additionalPause,
      endLatitude: input.latitude,
      endLongitude: input.longitude,
    }
  }

  const updated = await db.mtmAgentWorkday.update({
    where: { id: workday.id },
    data: update,
    select: workdaySelect,
  })
  const event = await db.mtmAgentWorkdayEvent.create({ data: baseEvent, select: eventSelect })
  await options.afterEvent?.({
    scope,
    input,
    beforeWorkday: workday as Record<string, unknown>,
    workday: { ...updated, agentId: scope.agentId } as MtmWorkdayPostEventContext["workday"],
    event: event as MtmWorkdayPostEventContext["event"],
  })
  if (input.action === "FINISH") {
    // Keep the last accepted coordinate for history, but remove the agent from
    // the live map as part of the same transaction that ends the workday.
    // Otherwise a successfully ended shift can remain misleadingly "online"
    // until a background heartbeat or a manager refreshes stale data.
    await db.mtmAgent.updateMany({
      where: { id: scope.agentId, organizationId: scope.organizationId },
      data: { isOnline: false },
    })
  }
  return {
    status: "ok",
    workday: updated as Record<string, unknown>,
    event: event as Record<string, unknown>,
    idempotent: false,
  }
}
