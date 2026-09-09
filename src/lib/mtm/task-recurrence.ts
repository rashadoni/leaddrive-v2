import type { Prisma } from "@prisma/client"
import { getOffsetMinutes, isValidTimezone } from "@/lib/timezone"

export const MTM_TASK_RECURRENCE_PREVIEW_MAX = 31

export type MtmTaskRecurrenceRule = "DAILY" | "WEEKLY" | "MONTHLY"
export type MtmTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT"

export interface MtmTaskRecurrenceAnchor {
  scheduledStartAt: Date | null
  dueDate: Date | null
}

export interface MtmTaskRecurrenceSchedule extends MtmTaskRecurrenceAnchor {
  recurrenceRule: MtmTaskRecurrenceRule
  recurrenceInterval: number
  recurrenceUntil: Date | null
  recurrenceTimezone: string
}

export type MtmTaskRecurrenceDstResolution =
  | { kind: "EXACT"; shiftedMinutes: 0 }
  | { kind: "AMBIGUOUS_EARLIER"; shiftedMinutes: 0 }
  | { kind: "SHIFTED_FORWARD"; shiftedMinutes: number }

export interface MtmTaskTenantLocalDateTimeResolution {
  instant: Date
  resolution: MtmTaskRecurrenceDstResolution
}

export interface MtmTaskRecurrenceOccurrence extends MtmTaskRecurrenceAnchor {
  recurrenceTimezone: string
  dst: {
    scheduledStartAt: MtmTaskRecurrenceDstResolution | null
    dueDate: MtmTaskRecurrenceDstResolution | null
  }
}

export interface MtmTaskRecurrencePreviewOptions {
  limit?: number
  anchor?: MtmTaskRecurrenceAnchor
}

export interface MtmTaskRecurrencePreview {
  occurrences: MtmTaskRecurrenceOccurrence[]
  limit: number
  hasMore: boolean
  wasLimitClamped: boolean
}

export interface MtmTaskRecurrenceSource extends MtmTaskRecurrenceAnchor {
  id: string
  agentId: string
  customerId: string | null
  taskGroupDictionaryId: string | null
  taskGroupCode: string | null
  title: string
  description: string | null
  priority: MtmTaskPriority
  recurrenceRule: MtmTaskRecurrenceRule | null
  recurrenceInterval: number | null
  recurrenceUntil: Date | null
  recurrenceTimezone: string | null
  recurrenceAnchorScheduledStartAt: Date | null
  recurrenceAnchorDueDate: Date | null
  recurrenceCursorScheduledStartAt: Date | null
  recurrenceCursorDueDate: Date | null
  recurrenceParentId: string | null
}

export interface SpawnMtmTaskRecurrenceInput {
  organizationId: string
  sourceTask: MtmTaskRecurrenceSource
  tenantTimezone: string
  occurredAt?: Date
}

export type SpawnMtmTaskRecurrenceResult =
  | { status: "ended"; occurrence: null }
  | {
      status: "created" | "existing" | "tombstoned"
      taskId: string
      occurrence: MtmTaskRecurrenceOccurrence
      sourceKey: string
    }

interface LocalDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

interface RawRecurrenceRoot {
  id: string
  scheduledStartAt: Date | null
  dueDate: Date | null
  recurrenceTimezone: string | null
  recurrenceAnchorScheduledStartAt: Date | null
  recurrenceAnchorDueDate: Date | null
  recurrenceCursorScheduledStartAt: Date | null
  recurrenceCursorDueDate: Date | null
}

interface RawRecurrenceMatch {
  id: string
  deletedAt: Date | null
  sourceKey: string | null
  scheduledStartAt: Date | null
  dueDate: Date | null
  recurrenceCursorScheduledStartAt: Date | null
  recurrenceCursorDueDate: Date | null
}

const DEFAULT_PREVIEW_LIMIT = 8
const MAX_DST_GAP_MINUTES = 180
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid date`)
  }
}

function assertValidSchedule(schedule: MtmTaskRecurrenceSchedule): void {
  if (!isValidTimezone(schedule.recurrenceTimezone)) {
    throw new RangeError("recurrenceTimezone must be a valid IANA timezone")
  }
  if (!Number.isInteger(schedule.recurrenceInterval) || schedule.recurrenceInterval < 1 || schedule.recurrenceInterval > 365) {
    throw new RangeError("recurrenceInterval must be an integer between 1 and 365")
  }
  if (!schedule.scheduledStartAt && !schedule.dueDate) {
    throw new RangeError("A recurring task requires a scheduled start or due date")
  }
  if (schedule.scheduledStartAt) assertValidDate(schedule.scheduledStartAt, "scheduledStartAt")
  if (schedule.dueDate) assertValidDate(schedule.dueDate, "dueDate")
  if (schedule.recurrenceUntil) assertValidDate(schedule.recurrenceUntil, "recurrenceUntil")
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  formatterCache.set(timezone, formatter)
  return formatter
}

function localParts(at: Date, timezone: string): LocalDateTimeParts {
  const values = Object.fromEntries(
    formatterFor(timezone).formatToParts(at).map((part) => [part.type, part.value]),
  )
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: at.getUTCMilliseconds(),
  }
}

function naiveUtcMillis(parts: LocalDateTimeParts): number {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond)
  return date.getTime()
}

function sameLocalParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond
}

function candidateInstants(parts: LocalDateTimeParts, timezone: string): Date[] {
  const naive = naiveUtcMillis(parts)
  const offsets = new Set<number>()
  for (const sampleHours of [-48, -24, -12, 0, 12, 24, 48]) {
    offsets.add(getOffsetMinutes(timezone, new Date(naive + sampleHours * 60 * 60 * 1_000)))
  }

  const instants = new Map<number, Date>()
  for (const offset of offsets) {
    const candidate = new Date(naive - offset * 60_000)
    if (sameLocalParts(localParts(candidate, timezone), parts)) {
      instants.set(candidate.getTime(), candidate)
    }
  }
  return [...instants.values()].sort((left, right) => left.getTime() - right.getTime())
}

function addLocalMinutes(parts: LocalDateTimeParts, minutes: number): LocalDateTimeParts {
  const shifted = new Date(naiveUtcMillis(parts) + minutes * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  }
}

/**
 * Resolve a tenant-local wall time to an instant without relying on the server
 * timezone. Fall-back ambiguity chooses the earlier instant. A spring-forward
 * gap advances to the first valid wall minute, preserving minutes/seconds when
 * possible and making the adjustment explicit in the returned occurrence.
 */
function resolveLocalDateTime(parts: LocalDateTimeParts, timezone: string): MtmTaskTenantLocalDateTimeResolution {
  const exact = candidateInstants(parts, timezone)
  if (exact.length > 0) {
    return {
      instant: exact[0],
      resolution: exact.length > 1
        ? { kind: "AMBIGUOUS_EARLIER", shiftedMinutes: 0 }
        : { kind: "EXACT", shiftedMinutes: 0 },
    }
  }

  for (let shiftedMinutes = 1; shiftedMinutes <= MAX_DST_GAP_MINUTES; shiftedMinutes += 1) {
    const shifted = candidateInstants(addLocalMinutes(parts, shiftedMinutes), timezone)
    if (shifted.length > 0) {
      return {
        instant: shifted[0],
        resolution: { kind: "SHIFTED_FORWARD", shiftedMinutes },
      }
    }
  }

  throw new RangeError(`Unable to resolve local time in ${timezone}`)
}

/**
 * Resolve an HTML `datetime-local` value under the exact recurrence DST
 * policy. The function is pure and independent of the browser/server default
 * timezone, so authoring previews can serialize the same instant that the
 * recurrence writer will later persist.
 */
export function resolveMtmTaskTenantLocalDateTime(
  value: string,
  timezone: string,
): MtmTaskTenantLocalDateTimeResolution {
  if (!isValidTimezone(timezone)) {
    throw new RangeError("timezone must be a valid IANA timezone")
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) {
    throw new RangeError("value must use YYYY-MM-DDTHH:mm")
  }
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
    millisecond: 0,
  }
  const normalized = new Date(naiveUtcMillis(parts))
  if (
    normalized.getUTCFullYear() !== parts.year
    || normalized.getUTCMonth() + 1 !== parts.month
    || normalized.getUTCDate() !== parts.day
    || normalized.getUTCHours() !== parts.hour
    || normalized.getUTCMinutes() !== parts.minute
  ) {
    throw new RangeError("value must be a valid local date and time")
  }
  return resolveLocalDateTime(parts, timezone)
}

function addLocalDays(parts: LocalDateTimeParts, days: number): LocalDateTimeParts {
  const shifted = new Date(naiveUtcMillis(parts))
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function daysInMonth(year: number, month: number): number {
  const lastDay = new Date(0)
  lastDay.setUTCFullYear(year, month, 0)
  lastDay.setUTCHours(0, 0, 0, 0)
  return lastDay.getUTCDate()
}

function addLocalMonths(
  current: LocalDateTimeParts,
  anchor: LocalDateTimeParts,
  months: number,
): LocalDateTimeParts {
  const monthIndex = current.year * 12 + current.month - 1 + months
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = monthIndex - targetYear * 12 + 1
  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(anchor.day, daysInMonth(targetYear, targetMonth)),
    hour: anchor.hour,
    minute: anchor.minute,
    second: anchor.second,
    millisecond: anchor.millisecond,
  }
}

function nextMoment(
  current: Date | null,
  anchor: Date | null,
  schedule: MtmTaskRecurrenceSchedule,
): MtmTaskTenantLocalDateTimeResolution | null {
  if (!current) return null

  const timezone = schedule.recurrenceTimezone
  const currentLocal = localParts(current, timezone)
  const anchorLocal = localParts(anchor ?? current, timezone)
  let target: LocalDateTimeParts

  if (schedule.recurrenceRule === "MONTHLY") {
    target = addLocalMonths(currentLocal, anchorLocal, schedule.recurrenceInterval)
  } else {
    const days = schedule.recurrenceRule === "WEEKLY"
      ? schedule.recurrenceInterval * 7
      : schedule.recurrenceInterval
    const targetDate = addLocalDays(currentLocal, days)
    target = {
      ...targetDate,
      hour: anchorLocal.hour,
      minute: anchorLocal.minute,
      second: anchorLocal.second,
      millisecond: anchorLocal.millisecond,
    }
  }

  return resolveLocalDateTime(target, timezone)
}

function localDateOrdinal(at: Date, timezone: string): number {
  const parts = localParts(at, timezone)
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

/**
 * Expand exactly one tenant-local recurrence. `anchor` is the immutable root
 * schedule and is required when walking a monthly series so a clamped February
 * occurrence can return to day 31 in March.
 */
export function nextMtmTaskRecurrenceOccurrence(
  schedule: MtmTaskRecurrenceSchedule,
  anchor: MtmTaskRecurrenceAnchor = schedule,
): MtmTaskRecurrenceOccurrence | null {
  assertValidSchedule(schedule)
  if (anchor.scheduledStartAt) assertValidDate(anchor.scheduledStartAt, "anchor.scheduledStartAt")
  if (anchor.dueDate) assertValidDate(anchor.dueDate, "anchor.dueDate")

  const scheduledStart = nextMoment(schedule.scheduledStartAt, anchor.scheduledStartAt, schedule)
  const due = nextMoment(schedule.dueDate, anchor.dueDate, schedule)
  const occurrence: MtmTaskRecurrenceOccurrence = {
    scheduledStartAt: scheduledStart?.instant ?? null,
    dueDate: due?.instant ?? null,
    recurrenceTimezone: schedule.recurrenceTimezone,
    dst: {
      scheduledStartAt: scheduledStart?.resolution ?? null,
      dueDate: due?.resolution ?? null,
    },
  }

  // The due date is the series identity whenever present. This keeps an
  // overnight task whose start is still inside the window from being spawned
  // after its deadline has moved beyond the inclusive `until` date.
  const identityMoment = occurrence.dueDate ?? occurrence.scheduledStartAt
  if (!identityMoment) return null
  if (
    schedule.recurrenceUntil
    && localDateOrdinal(identityMoment, schedule.recurrenceTimezone)
      > localDateOrdinal(schedule.recurrenceUntil, schedule.recurrenceTimezone)
  ) {
    return null
  }
  return occurrence
}

/** Return at most 31 occurrences, plus one sentinel expansion for `hasMore`. */
export function previewMtmTaskRecurrence(
  schedule: MtmTaskRecurrenceSchedule,
  options: MtmTaskRecurrencePreviewOptions = {},
): MtmTaskRecurrencePreview {
  const requestedLimit = options.limit ?? DEFAULT_PREVIEW_LIMIT
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new RangeError("Preview limit must be a positive integer")
  }
  const limit = Math.min(requestedLimit, MTM_TASK_RECURRENCE_PREVIEW_MAX)
  const anchor = options.anchor ?? schedule
  const occurrences: MtmTaskRecurrenceOccurrence[] = []
  let cursor = schedule

  while (occurrences.length < limit) {
    const occurrence = nextMtmTaskRecurrenceOccurrence(cursor, anchor)
    if (!occurrence) break
    occurrences.push(occurrence)
    cursor = {
      ...cursor,
      scheduledStartAt: occurrence.scheduledStartAt,
      dueDate: occurrence.dueDate,
    }
  }

  const hasMore = occurrences.length === limit
    && nextMtmTaskRecurrenceOccurrence(cursor, anchor) !== null
  return {
    occurrences,
    limit,
    hasMore,
    wasLimitClamped: requestedLimit > MTM_TASK_RECURRENCE_PREVIEW_MAX,
  }
}

/** Stable idempotency key shared by API, mobile sync, and future job writers. */
export function mtmTaskRecurrenceSourceKey(
  rootTaskId: string,
  occurrence: Pick<MtmTaskRecurrenceOccurrence, "scheduledStartAt" | "dueDate">,
): string {
  if (!rootTaskId) throw new RangeError("rootTaskId is required")
  const identityMoment = occurrence.dueDate ?? occurrence.scheduledStartAt
  if (!identityMoment) throw new RangeError("A recurrence source key requires a scheduled start or due date")
  assertValidDate(identityMoment, "occurrence date")
  return `task-recurrence:${rootTaskId}:${identityMoment.toISOString()}`
}

function mtmTaskRecurrenceAliasSourceKey(canonicalSourceKey: string, sourceTaskId: string): string {
  return `${canonicalSourceKey}:from:${sourceTaskId}`
}

function sameNullableInstant(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime()
}

function rawMatchClaimsOccurrence(
  match: RawRecurrenceMatch,
  occurrence: Pick<MtmTaskRecurrenceOccurrence, "scheduledStartAt" | "dueDate">,
): boolean {
  const hasPersistedCursor = match.recurrenceCursorScheduledStartAt != null
    || match.recurrenceCursorDueDate != null
  return sameNullableInstant(
    hasPersistedCursor ? match.recurrenceCursorScheduledStartAt : match.scheduledStartAt,
    occurrence.scheduledStartAt,
  ) && sameNullableInstant(
    hasPersistedCursor ? match.recurrenceCursorDueDate : match.dueDate,
    occurrence.dueDate,
  )
}

/** Serialize every writer that changes or expands one recurrence series. */
export async function lockMtmTaskRecurrenceSeriesInTransaction(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; rootTaskId: string },
): Promise<void> {
  if (!input.organizationId || !input.rootTaskId) {
    throw new RangeError("organizationId and rootTaskId are required")
  }
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`mtm-task-recurrence:${input.organizationId}:${input.rootTaskId}`}, 0)
    )
  `
}

/**
 * Spawn the next task exactly once inside the caller's interactive Prisma
 * transaction. The transaction-scoped advisory lock serializes cooperating
 * writers, while the raw lookup intentionally sees soft-deleted rows so a
 * deleted generated occurrence remains a permanent tombstone. The lookup also
 * recognizes the exact root + immutable occurrence facts of an existing child whose
 * immutable creation sourceKey predates an edit-future reschedule.
 */
export async function spawnNextMtmTaskRecurrenceInTransaction(
  tx: Prisma.TransactionClient,
  input: SpawnMtmTaskRecurrenceInput,
): Promise<SpawnMtmTaskRecurrenceResult> {
  const source = input.sourceTask
  if (!source.recurrenceRule || (!source.scheduledStartAt && !source.dueDate)) {
    return { status: "ended", occurrence: null }
  }
  if (!input.organizationId) throw new RangeError("organizationId is required")

  const rootTaskId = source.recurrenceParentId ?? source.id
  await lockMtmTaskRecurrenceSeriesInTransaction(tx, {
    organizationId: input.organizationId,
    rootTaskId,
  })

  let root: RawRecurrenceRoot = {
    id: source.id,
    scheduledStartAt: source.scheduledStartAt,
    dueDate: source.dueDate,
    recurrenceTimezone: source.recurrenceTimezone,
    recurrenceAnchorScheduledStartAt: source.recurrenceAnchorScheduledStartAt,
    recurrenceAnchorDueDate: source.recurrenceAnchorDueDate,
    recurrenceCursorScheduledStartAt: source.recurrenceCursorScheduledStartAt,
    recurrenceCursorDueDate: source.recurrenceCursorDueDate,
  }
  if (source.recurrenceParentId) {
    const roots = await tx.$queryRaw<RawRecurrenceRoot[]>`
      SELECT
        "id",
        "scheduledStartAt",
        "dueDate",
        "recurrenceTimezone",
        "recurrenceAnchorScheduledStartAt",
        "recurrenceAnchorDueDate",
        "recurrenceCursorScheduledStartAt",
        "recurrenceCursorDueDate"
      FROM "mtm_tasks"
      WHERE "organizationId" = ${input.organizationId}
        AND "id" = ${rootTaskId}
      LIMIT 1
    `
    if (!roots[0]) {
      throw new Error("Recurrence root is not available in the organization scope")
    }
    root = roots[0]
  }

  // Every generated task carries the pinned series timezone. Prefer the
  // current source so an explicit edit-future timezone takes effect; use the
  // raw root only to backfill a legacy child that predates the column.
  const recurrenceTimezone = isValidTimezone(source.recurrenceTimezone)
    ? source.recurrenceTimezone
    : isValidTimezone(root.recurrenceTimezone)
      ? root.recurrenceTimezone
      : input.tenantTimezone
  if (!isValidTimezone(recurrenceTimezone)) {
    throw new RangeError("A valid recurrence or tenant timezone is required")
  }

  const hasPersistedCursor = source.recurrenceCursorScheduledStartAt != null
    || source.recurrenceCursorDueDate != null
  const schedule: MtmTaskRecurrenceSchedule = {
    scheduledStartAt: hasPersistedCursor
      ? source.recurrenceCursorScheduledStartAt
      : source.scheduledStartAt,
    dueDate: hasPersistedCursor ? source.recurrenceCursorDueDate : source.dueDate,
    recurrenceRule: source.recurrenceRule,
    recurrenceInterval: source.recurrenceInterval ?? 1,
    recurrenceUntil: source.recurrenceUntil,
    recurrenceTimezone,
  }
  const anchor: MtmTaskRecurrenceAnchor = {
    scheduledStartAt: source.recurrenceAnchorScheduledStartAt
      ?? root.recurrenceAnchorScheduledStartAt
      ?? root.recurrenceCursorScheduledStartAt
      ?? root.scheduledStartAt
      ?? source.recurrenceCursorScheduledStartAt
      ?? source.scheduledStartAt,
    dueDate: source.recurrenceAnchorDueDate
      ?? root.recurrenceAnchorDueDate
      ?? root.recurrenceCursorDueDate
      ?? root.dueDate
      ?? source.recurrenceCursorDueDate
      ?? source.dueDate,
  }
  const occurrence = nextMtmTaskRecurrenceOccurrence(schedule, anchor)
  if (!occurrence) return { status: "ended", occurrence: null }

  const canonicalSourceKey = mtmTaskRecurrenceSourceKey(rootTaskId, occurrence)
  const aliasSourceKey = mtmTaskRecurrenceAliasSourceKey(canonicalSourceKey, source.id)
  const matches = await tx.$queryRaw<RawRecurrenceMatch[]>`
    SELECT
      "id",
      "deletedAt",
      "sourceKey",
      "scheduledStartAt",
      "dueDate",
      "recurrenceCursorScheduledStartAt",
      "recurrenceCursorDueDate"
    FROM "mtm_tasks"
    WHERE "organizationId" = ${input.organizationId}
      AND (
        "sourceKey" IN (${canonicalSourceKey}, ${aliasSourceKey})
        OR (
          "recurrenceParentId" = ${rootTaskId}
          AND (
            CASE
              WHEN "recurrenceCursorScheduledStartAt" IS NOT NULL
                OR "recurrenceCursorDueDate" IS NOT NULL
              THEN "recurrenceCursorScheduledStartAt"
              ELSE "scheduledStartAt"
            END
          ) IS NOT DISTINCT FROM ${occurrence.scheduledStartAt}
          AND (
            CASE
              WHEN "recurrenceCursorScheduledStartAt" IS NOT NULL
                OR "recurrenceCursorDueDate" IS NOT NULL
              THEN "recurrenceCursorDueDate"
              ELSE "dueDate"
            END
          ) IS NOT DISTINCT FROM ${occurrence.dueDate}
        )
      )
    LIMIT 4
  `
  const occurrenceMatches = matches.filter((match) => rawMatchClaimsOccurrence(match, occurrence))
  if (occurrenceMatches.length > 1) {
    throw new Error("Multiple recurrence tasks claim the same occurrence")
  }
  const existing = occurrenceMatches[0]
  if (existing) {
    return {
      status: existing.deletedAt ? "tombstoned" : "existing",
      taskId: existing.id,
      occurrence,
      sourceKey: canonicalSourceKey,
    }
  }

  const canonicalOccupied = matches.some((match) => match.sourceKey === canonicalSourceKey)
  const aliasOccupied = matches.some((match) => match.sourceKey === aliasSourceKey)
  if (canonicalOccupied && aliasOccupied) {
    throw new Error("Recurrence source keys are occupied by different occurrences")
  }
  // A THIS_AND_FUTURE edit deliberately preserves immutable source keys on
  // existing rows. If one of those stale keys now names the next occurrence,
  // use a deterministic per-source alias; cursor matching remains authoritative
  // for retries and tombstones.
  const sourceKey = canonicalOccupied ? aliasSourceKey : canonicalSourceKey

  const occurredAt = input.occurredAt ?? new Date()
  assertValidDate(occurredAt, "occurredAt")
  const created = await tx.mtmTask.create({
    data: {
      organizationId: input.organizationId,
      agentId: source.agentId,
      customerId: source.customerId,
      visitId: null,
      taskGroupDictionaryId: source.taskGroupDictionaryId,
      taskGroupCode: source.taskGroupCode,
      copiedFromId: null,
      sourceKey,
      title: source.title,
      description: source.description,
      status: "PENDING",
      priority: source.priority,
      scheduledStartAt: occurrence.scheduledStartAt,
      dueDate: occurrence.dueDate,
      recurrenceRule: source.recurrenceRule,
      recurrenceInterval: schedule.recurrenceInterval,
      recurrenceUntil: source.recurrenceUntil,
      recurrenceTimezone,
      recurrenceAnchorScheduledStartAt: anchor.scheduledStartAt,
      recurrenceAnchorDueDate: anchor.dueDate,
      recurrenceCursorScheduledStartAt: occurrence.scheduledStartAt,
      recurrenceCursorDueDate: occurrence.dueDate,
      recurrenceParentId: rootTaskId,
    },
    select: { id: true },
  })
  await tx.mtmTaskEvent.create({
    data: {
      organizationId: input.organizationId,
      taskId: created.id,
      agentId: source.agentId,
      type: "CREATED",
      occurredAt,
      toStatus: "PENDING",
      evidence: {
        kind: "MTM_TASK_RECURRENCE",
        rootTaskId,
        sourceTaskId: source.id,
        sourceKey,
        recurrenceTimezone,
        recurrenceAnchorScheduledStartAt: anchor.scheduledStartAt?.toISOString() ?? null,
        recurrenceAnchorDueDate: anchor.dueDate?.toISOString() ?? null,
        scheduledStartAt: occurrence.scheduledStartAt?.toISOString() ?? null,
        dueDate: occurrence.dueDate?.toISOString() ?? null,
        dst: occurrence.dst,
      } as Prisma.InputJsonValue,
    },
  })

  return {
    status: "created",
    taskId: created.id,
    occurrence,
    sourceKey,
  }
}
