/**
 * Small, identity-bound read cache for the SWM-17 operational week.
 *
 * This is deliberately separate from the mobile route cache. A manager can
 * switch between employees, so every entry is fenced by both the signed-in
 * viewer and the selected employee. Bootstrap/filter responses are never
 * cached by callers.
 */

export const OPERATIONAL_WEEK_CACHE_SCHEMA = 2
export const OPERATIONAL_WEEK_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const OPERATIONAL_WEEK_CACHE_RETENTION_MS = 48 * 60 * 60 * 1000
export const OPERATIONAL_WEEK_CACHE_MAX_ENTRIES = 4
export const OPERATIONAL_WEEK_CACHE_MAX_ENTRY_BYTES = 750_000

const STORAGE_KEY = `leaddrive:mtm:operational-week:v${OPERATIONAL_WEEK_CACHE_SCHEMA}`
const LEGACY_STORAGE_KEYS = ["leaddrive:mtm:operational-week:v1"] as const

export interface OperationalWeekCacheIdentity {
  organizationId: string
  viewerId: string
  agentId: string
  date: string
  days: 1 | 5 | 7
  regionId?: string
  teamId?: string
}

export interface OperationalWeekSnapshot<T> {
  schemaVersion: number
  data: T
  cachedAt: string
  expiresAt: string
  snapshotId: string | null
}

export interface OperationalWeekCacheEntry<T> {
  identity: OperationalWeekCacheIdentity
  snapshot: OperationalWeekSnapshot<T>
}

type SnapshotIndex = Record<string, OperationalWeekSnapshot<unknown>>

function encodePart(value: string | undefined): string {
  return encodeURIComponent(value || "_")
}

function decodePart(value: string): string {
  try {
    const decoded = decodeURIComponent(value)
    return decoded === "_" ? "" : decoded
  } catch {
    return ""
  }
}

/** A cache key that cannot cross viewer, tenant, agent, range, or team scope. */
export function operationalWeekCacheKey(identity: OperationalWeekCacheIdentity): string {
  return [
    identity.organizationId,
    identity.viewerId,
    identity.agentId,
    identity.date,
    String(identity.days),
    identity.regionId,
    identity.teamId,
  ].map(encodePart).join("::")
}

function identityFromCacheKey(key: string): OperationalWeekCacheIdentity | null {
  const parts = key.split("::")
  if (parts.length !== 7) return null
  const [organizationId, viewerId, agentId, date, rawDays, regionId, teamId] = parts.map(decodePart)
  const days = Number(rawDays)
  if (!organizationId || !viewerId || !agentId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (days !== 1 && days !== 5 && days !== 7)) {
    return null
  }
  return {
    organizationId,
    viewerId,
    agentId,
    date,
    days,
    ...(regionId ? { regionId } : {}),
    ...(teamId ? { teamId } : {}),
  }
}

export function buildOperationalWeekSnapshot<T>(
  data: T,
  options: { now?: Date; snapshotId?: string | null } = {},
): OperationalWeekSnapshot<T> {
  const now = options.now ?? new Date()
  return {
    schemaVersion: OPERATIONAL_WEEK_CACHE_SCHEMA,
    data,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OPERATIONAL_WEEK_CACHE_TTL_MS).toISOString(),
    snapshotId: options.snapshotId ?? null,
  }
}

export function isOperationalWeekSnapshotExpired(
  snapshot: OperationalWeekSnapshot<unknown>,
  now: Date = new Date(),
): boolean {
  const expiresAt = Date.parse(snapshot.expiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime()
}

function isSnapshot(value: unknown): value is OperationalWeekSnapshot<unknown> {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<OperationalWeekSnapshot<unknown>>
  return candidate.schemaVersion === OPERATIONAL_WEEK_CACHE_SCHEMA
    && typeof candidate.cachedAt === "string"
    && typeof candidate.expiresAt === "string"
    && "data" in candidate
}

export function pruneOperationalWeekSnapshots(
  index: SnapshotIndex,
  now: Date = new Date(),
): SnapshotIndex {
  const retentionBoundary = now.getTime() - OPERATIONAL_WEEK_CACHE_RETENTION_MS
  return Object.fromEntries(
    Object.entries(index)
      .filter(([, snapshot]) => isSnapshot(snapshot) && Date.parse(snapshot.cachedAt) >= retentionBoundary)
      .sort(([, left], [, right]) => Date.parse(right.cachedAt) - Date.parse(left.cachedAt))
      .slice(0, OPERATIONAL_WEEK_CACHE_MAX_ENTRIES),
  )
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function removeLegacyOperationalWeekSnapshots(storage: Storage): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    try { storage.removeItem(key) } catch { /* Current-schema cache can still operate. */ }
  }
}

function readIndex(storage: Storage): SnapshotIndex {
  removeLegacyOperationalWeekSnapshots(storage)
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as SnapshotIndex
  } catch {
    return {}
  }
}

export function saveOperationalWeekSnapshot<T>(
  key: string,
  data: T,
  snapshotId: string | null = null,
  storage: Storage | null = browserStorage(),
  now: Date = new Date(),
): OperationalWeekSnapshot<T> | null {
  if (!storage) return null
  const snapshot = buildOperationalWeekSnapshot(data, { now, snapshotId })
  try {
    const serialized = JSON.stringify(snapshot)
    const byteLength = typeof TextEncoder === "undefined" ? serialized.length : new TextEncoder().encode(serialized).byteLength
    if (byteLength > OPERATIONAL_WEEK_CACHE_MAX_ENTRY_BYTES) return null
    const next = pruneOperationalWeekSnapshots({ ...readIndex(storage), [key]: snapshot }, now)
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
    return snapshot
  } catch {
    return null
  }
}

export function loadOperationalWeekSnapshot<T>(
  key: string,
  storage: Storage | null = browserStorage(),
  now: Date = new Date(),
): OperationalWeekSnapshot<T> | null {
  if (!storage) return null
  try {
    const index = readIndex(storage)
    const snapshot = index[key]
    if (!isSnapshot(snapshot)) return null
    const cachedAt = Date.parse(snapshot.cachedAt)
    if (!Number.isFinite(cachedAt) || now.getTime() - cachedAt > OPERATIONAL_WEEK_CACHE_RETENTION_MS) {
      const rest = { ...index }
      delete rest[key]
      storage.setItem(STORAGE_KEY, JSON.stringify(pruneOperationalWeekSnapshots(rest, now)))
      return null
    }
    return snapshot as OperationalWeekSnapshot<T>
  } catch {
    return null
  }
}

/**
 * Recover the newest snapshot for the exact signed-in tenant/viewer pair.
 * This supports a normal `/mtm` offline entry where no canonical tenant date
 * or employee is present in the URL yet; it never searches another identity.
 */
export function loadLatestOperationalWeekSnapshot<T>(
  scope: Pick<OperationalWeekCacheIdentity, "organizationId" | "viewerId">,
  storage: Storage | null = browserStorage(),
  now: Date = new Date(),
): OperationalWeekCacheEntry<T> | null {
  if (!storage) return null
  try {
    const retained = pruneOperationalWeekSnapshots(readIndex(storage), now)
    storage.setItem(STORAGE_KEY, JSON.stringify(retained))
    const match = Object.entries(retained)
      .flatMap(([key, snapshot]) => {
        const identity = identityFromCacheKey(key)
        return identity && identity.organizationId === scope.organizationId && identity.viewerId === scope.viewerId
          ? [{ identity, snapshot }]
          : []
      })
      .sort((left, right) => Date.parse(right.snapshot.cachedAt) - Date.parse(left.snapshot.cachedAt))[0]
    return match ? {
      identity: match.identity,
      snapshot: match.snapshot as OperationalWeekSnapshot<T>,
    } : null
  } catch {
    return null
  }
}

/** Purge every snapshot for a revoked/unauthenticated viewer in one tenant. */
export function clearOperationalWeekSnapshotsForViewer(
  scope: Pick<OperationalWeekCacheIdentity, "organizationId" | "viewerId">,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    const retained = Object.fromEntries(Object.entries(readIndex(storage)).filter(([key]) => {
      const identity = identityFromCacheKey(key)
      if (!identity) return false
      return identity.organizationId !== scope.organizationId || identity.viewerId !== scope.viewerId
    }))
    storage.setItem(STORAGE_KEY, JSON.stringify(retained))
    return true
  } catch {
    return false
  }
}

/**
 * A task mutation can move an item between active, returned, overdue, and
 * closed queues. Task detail does not carry the dashboard's manager identity,
 * so invalidate this bounded cache rather than risk replaying a stale queue.
 */
export function invalidateOperationalWeekSnapshotsAfterTaskMutation(
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    removeLegacyOperationalWeekSnapshots(storage)
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
