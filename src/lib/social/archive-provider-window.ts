import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type ArchiveProviderWindow = {
  hours: number
  since: Date
  until: Date
  resumedFromWatermark: boolean
  clamped: boolean
}

export const ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES = 5

export type ArchiveProviderCursorScope = {
  routePlanId: string
  adapterKey: string
  /**
   * Explicit/manual archive runs must never share the scheduled cursor. The
   * scenario and its configured archive start are part of the namespace so a
   * later edit to either value starts from the newly requested lower bound.
   */
  fullArchiveRun?: boolean
  targetScenarioId?: string | null
  archiveStartAt?: Date | string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null
  }
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

/**
 * A physical source may be shared by several scenarios. Archive backfills must
 * therefore resolve the lower bound from the explicitly targeted scenario
 * link, never from another link or a global minimum.
 */
export function scenarioArchiveStartAtForSource(
  sourceSettings: unknown,
  targetScenarioId: string | null | undefined,
  authoritativeArchiveStartAt?: Date | string | null,
): Date | null {
  // A profile-scoped run has already authorized and loaded the tenant's
  // scenario. Its archive boundary is authoritative even when a legacy/shared
  // source has no scenarioLinks entry yet. `undefined` means the caller has no
  // authoritative scenario value and may fall back to source settings; `null`
  // is an explicit scenario with no archive lower bound.
  if (authoritativeArchiveStartAt !== undefined) {
    return dateValue(authoritativeArchiveStartAt)
  }
  const scenarioId = targetScenarioId?.trim()
  if (!scenarioId) return null
  const links = record(sourceSettings).scenarioLinks
  if (!Array.isArray(links)) return null
  for (const value of links) {
    const link = record(value)
    if (typeof link.scenarioId !== "string" || link.scenarioId.trim() !== scenarioId) continue
    return dateValue(link.archiveStartAt)
  }
  return null
}

export function archiveProviderCursorKey(scope: ArchiveProviderCursorScope): string {
  const routeKey = `${scope.routePlanId.trim()}:${scope.adapterKey.trim()}`
  if (scope.fullArchiveRun !== true) return routeKey

  const scenarioId = scope.targetScenarioId?.trim() || "unscoped"
  const archiveStartAt = dateValue(scope.archiveStartAt)
  const archiveIdentity = archiveStartAt ? String(archiveStartAt.getTime()) : "no-start"
  return `archive:v1:${encodeURIComponent(scenarioId)}:${archiveIdentity}:${routeKey}`
}

export function routeProviderCursorFetchAfterForSource(
  sourceSettings: unknown,
  scope?: ArchiveProviderCursorScope,
): Date | null {
  const searchIndex = record(record(sourceSettings).searchIndex)
  if (scope) {
    const cursors = record(searchIndex.routeProviderCursors)
    const scoped = record(cursors[archiveProviderCursorKey(scope)])
    // A route/provider pair owns its own checkpoint. A legacy source-wide
    // cursor must not make a first targeted archive run skip its start date.
    return dateValue(scoped.fetchAfter)
  }
  return dateValue(searchIndex.fetchAfter)
}

/**
 * Builds the next provider window from the last successfully queried instant.
 * The watermark represents paid query coverage, including true-zero results;
 * it is not inferred from the newest mention (which would hide empty periods).
 */
export function resolveArchiveProviderWindow(
  sourceSettings: unknown,
  now = new Date(),
  defaultHours = 24,
  maxHours = 24 * 30,
  options: {
    scope?: ArchiveProviderCursorScope
    ignoreWatermark?: boolean
    /**
     * Explicit scenario archive lower bound. Unlike a normal provider cursor,
     * this is not clamped to maxHours: a confirmed manual archive run must use
     * the scenario's exact requested start and surface provider limits later.
     */
    archiveStartAt?: Date | string | null
  } = {},
): ArchiveProviderWindow {
  const archiveStartAt = dateValue(options.archiveStartAt)
  const fetchAfter = options.ignoreWatermark
    ? null
    : routeProviderCursorFetchAfterForSource(sourceSettings, options.scope)
  const maxWindowMs = Math.max(1, maxHours) * 3_600_000
  const defaultWindowMs = Math.max(1, defaultHours) * 3_600_000
  const floor = new Date(now.getTime() - maxWindowMs)
  const requestedSince = archiveStartAt && fetchAfter
    ? new Date(Math.max(archiveStartAt.getTime(), fetchAfter.getTime()))
    : archiveStartAt ?? fetchAfter ?? new Date(now.getTime() - defaultWindowMs)
  const since = archiveStartAt
    ? new Date(Math.min(now.getTime(), requestedSince.getTime()))
    : new Date(Math.min(now.getTime(), Math.max(floor.getTime(), requestedSince.getTime())))
  return {
    hours: Math.max(0, Math.ceil((now.getTime() - since.getTime()) / 3_600_000)),
    since,
    until: now,
    resumedFromWatermark: Boolean(fetchAfter),
    clamped: !archiveStartAt && requestedSince.getTime() < floor.getTime(),
  }
}

/**
 * Re-read a small slice before a persisted watermark. Provider timestamps and
 * async completion are not perfectly aligned; the overlap prevents a boundary
 * item from being skipped while downstream identity dedupe absorbs repeats.
 * First runs keep their configured lookback unchanged.
 */
export function withArchiveProviderCursorOverlap(
  window: ArchiveProviderWindow,
  overlapMinutes = ARCHIVE_PROVIDER_CURSOR_OVERLAP_MINUTES,
  lowerBound?: Date | null,
): ArchiveProviderWindow {
  if (!window.resumedFromWatermark || overlapMinutes <= 0) return window
  const overlappedSince = window.since.getTime() - overlapMinutes * 60_000
  return {
    ...window,
    since: new Date(Math.max(
      overlappedSince,
      lowerBound?.getTime() ?? Number.NEGATIVE_INFINITY,
    )),
  }
}

export function providerFetchWatermarkForResult(input: {
  collectionMode: string
  status: string
  rawStats?: Record<string, unknown>
  finishedAt: Date
}): Date | null {
  if (!["search_index", "provider_api", "official_api"].includes(input.collectionMode)) return null
  if (input.status !== "success") return null
  if (input.rawStats?.queued === true || input.rawStats?.asyncPending === true) return null
  if (input.rawStats?.cursorAdvanceSuppressed === true) return null
  if (["PARTIAL", "SAMPLED", "BLOCKED"].includes(String(input.rawStats?.coverageClass ?? "").toUpperCase())) {
    return null
  }
  const explicitUntil = dateValue(input.rawStats?.until)
  if (explicitUntil) return explicitUntil
  if (input.rawStats?.providerImported === true || input.rawStats?.providerStatus === "IMPORTED") return input.finishedAt
  return null
}

export function shouldAdvanceMonitoringRouteProviderCursor(input: {
  fetchAfter: Date | null
  adapterKey: string | null
  fullArchiveRun: boolean
}): input is { fetchAfter: Date; adapterKey: string; fullArchiveRun: boolean } {
  return Boolean(input.fetchAfter && input.adapterKey)
}

/** Atomic JSONB merge: preserves scenario links/provider settings written while a collector runs. */
export async function advanceMonitoringSourceFetchAfter(input: {
  organizationId: string
  sourceId: string
  until: Date
  reason: string
}): Promise<number> {
  const executeRaw = (prisma as unknown as { $executeRaw?: typeof prisma.$executeRaw }).$executeRaw
  if (!executeRaw) return 0
  const until = input.until.toISOString()
  const updatedAt = new Date().toISOString()
  return executeRaw.call(prisma, Prisma.sql`
    UPDATE monitoring_sources
    SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{searchIndex}',
      COALESCE(settings->'searchIndex', '{}'::jsonb) || jsonb_build_object(
        'fetchAfter', ${until},
        'fetchAfterUpdatedAt', ${updatedAt},
        'fetchAfterReason', ${input.reason}
      ),
      true
    )
    WHERE id = ${input.sourceId}
      AND "organizationId" = ${input.organizationId}
      AND COALESCE(settings->'searchIndex'->>'fetchAfter', '') < ${until}
  `)
}

/**
 * Monotonically advances one provider route without moving another route's
 * coverage boundary. This keeps scheduled collection incremental per
 * source/route/provider while preserving concurrent JSON settings changes.
 */
export async function advanceMonitoringRouteProviderCursor(input: {
  organizationId: string
  sourceId: string
  routePlanId: string
  adapterKey: string
  fullArchiveRun?: boolean
  targetScenarioId?: string | null
  archiveStartAt?: Date | string | null
  until: Date
  reason: string
}): Promise<number> {
  const executeRaw = (prisma as unknown as { $executeRaw?: typeof prisma.$executeRaw }).$executeRaw
  if (!executeRaw) return 0
  const cursorKey = archiveProviderCursorKey(input)
  const until = input.until.toISOString()
  const updatedAt = new Date().toISOString()
  return executeRaw.call(prisma, Prisma.sql`
    UPDATE monitoring_sources
    SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{searchIndex}',
      COALESCE(settings->'searchIndex', '{}'::jsonb) || jsonb_build_object(
        'routeProviderCursors',
        COALESCE(settings->'searchIndex'->'routeProviderCursors', '{}'::jsonb)
          || jsonb_build_object(
            ${cursorKey},
            jsonb_build_object(
              'fetchAfter', ${until},
              'updatedAt', ${updatedAt},
              'reason', ${input.reason},
              'routePlanId', ${input.routePlanId},
              'adapterKey', ${input.adapterKey},
              'fullArchiveRun', ${input.fullArchiveRun === true},
              'targetScenarioId', ${input.targetScenarioId ?? null},
              'archiveStartAt', ${dateValue(input.archiveStartAt)?.toISOString() ?? null}
            )
          )
      ),
      true
    )
    WHERE id = ${input.sourceId}
      AND "organizationId" = ${input.organizationId}
      AND COALESCE(
        settings->'searchIndex'->'routeProviderCursors'->${cursorKey}->>'fetchAfter',
        ''
      ) < ${until}
  `)
}
