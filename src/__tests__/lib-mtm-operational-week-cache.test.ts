import { describe, expect, it } from "vitest"
import {
  OPERATIONAL_WEEK_CACHE_MAX_ENTRIES,
  OPERATIONAL_WEEK_CACHE_SCHEMA,
  OPERATIONAL_WEEK_CACHE_TTL_MS,
  buildOperationalWeekSnapshot,
  clearOperationalWeekSnapshotsForViewer,
  invalidateOperationalWeekSnapshotsAfterTaskMutation,
  isOperationalWeekSnapshotExpired,
  loadLatestOperationalWeekSnapshot,
  loadOperationalWeekSnapshot,
  operationalWeekCacheKey,
  pruneOperationalWeekSnapshots,
  saveOperationalWeekSnapshot,
} from "@/lib/mtm/operational-week-cache"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe("SWM-17 operational week cache", () => {
  it("fences snapshots by tenant, viewer, employee, range, and filters", () => {
    const base = {
      organizationId: "org-1",
      viewerId: "manager-1",
      agentId: "agent-1",
      date: "2026-08-03",
      days: 5 as const,
      regionId: "north",
      teamId: "team-a",
    }
    const key = operationalWeekCacheKey(base)

    expect(key).not.toBe(operationalWeekCacheKey({ ...base, organizationId: "org-2" }))
    expect(key).not.toBe(operationalWeekCacheKey({ ...base, viewerId: "manager-2" }))
    expect(key).not.toBe(operationalWeekCacheKey({ ...base, agentId: "agent-2" }))
    expect(key).not.toBe(operationalWeekCacheKey({ ...base, date: "2026-08-04" }))
    expect(key).not.toBe(operationalWeekCacheKey({ ...base, days: 7 }))
    expect(key).not.toBe(operationalWeekCacheKey({ ...base, teamId: "team-b" }))
  })

  it("records schema, saved time, expiry, and snapshot identity", () => {
    const now = new Date("2026-08-01T10:00:00.000Z")
    const snapshot = buildOperationalWeekSnapshot({ days: [] }, { now, snapshotId: "snap-17" })

    expect(OPERATIONAL_WEEK_CACHE_SCHEMA).toBe(2)
    expect(snapshot.schemaVersion).toBe(OPERATIONAL_WEEK_CACHE_SCHEMA)
    expect(snapshot.cachedAt).toBe(now.toISOString())
    expect(snapshot.expiresAt).toBe(new Date(now.getTime() + OPERATIONAL_WEEK_CACHE_TTL_MS).toISOString())
    expect(snapshot.snapshotId).toBe("snap-17")
    expect(isOperationalWeekSnapshotExpired(snapshot, new Date(now.getTime() + OPERATIONAL_WEEK_CACHE_TTL_MS - 1))).toBe(false)
    expect(isOperationalWeekSnapshotExpired(snapshot, new Date(now.getTime() + OPERATIONAL_WEEK_CACHE_TTL_MS))).toBe(true)
  })

  it("keeps only the newest bounded set", () => {
    const now = new Date("2026-08-03T12:00:00.000Z")
    const index = Object.fromEntries(Array.from({ length: OPERATIONAL_WEEK_CACHE_MAX_ENTRIES + 2 }, (_, index) => {
      const savedAt = new Date(now.getTime() - index * 60_000)
      return [`key-${index}`, buildOperationalWeekSnapshot({ index }, { now: savedAt })]
    }))

    const pruned = pruneOperationalWeekSnapshots(index, now)
    expect(Object.keys(pruned)).toHaveLength(OPERATIONAL_WEEK_CACHE_MAX_ENTRIES)
    expect(Object.keys(pruned)).toContain("key-0")
    expect(Object.keys(pruned)).not.toContain(`key-${OPERATIONAL_WEEK_CACHE_MAX_ENTRIES + 1}`)
  })

  it("reports an unavailable cache so the live UI can disclose that no offline copy was saved", () => {
    expect(saveOperationalWeekSnapshot("identity-key", { days: [] }, "snapshot-1", null)).toBeNull()
  })

  it("restores only the newest snapshot for the exact tenant and viewer on a plain offline entry", () => {
    const storage = memoryStorage()
    const now = new Date("2026-08-03T12:00:00.000Z")
    const base = {
      organizationId: "org-1",
      viewerId: "manager-1",
      date: "2026-08-03",
      days: 5 as const,
    }
    saveOperationalWeekSnapshot(
      operationalWeekCacheKey({ ...base, agentId: "agent-old" }),
      { selectedAgent: { id: "agent-old" } },
      "old",
      storage,
      new Date(now.getTime() - 60_000),
    )
    saveOperationalWeekSnapshot(
      operationalWeekCacheKey({ ...base, agentId: "agent-new", teamId: "team-1" }),
      { selectedAgent: { id: "agent-new" } },
      "new",
      storage,
      now,
    )
    saveOperationalWeekSnapshot(
      operationalWeekCacheKey({ ...base, organizationId: "org-2", agentId: "agent-foreign" }),
      { selectedAgent: { id: "agent-foreign" } },
      "foreign",
      storage,
      new Date(now.getTime() + 1_000),
    )

    const restored = loadLatestOperationalWeekSnapshot<{ selectedAgent: { id: string } }>(
      { organizationId: "org-1", viewerId: "manager-1" },
      storage,
      now,
    )

    expect(restored?.identity).toMatchObject({ organizationId: "org-1", viewerId: "manager-1", agentId: "agent-new", teamId: "team-1" })
    expect(restored?.snapshot.data.selectedAgent.id).toBe("agent-new")
  })

  it("purges a viewer's tenant snapshots after authorization or scope revocation", () => {
    const storage = memoryStorage()
    const now = new Date("2026-08-03T12:00:00.000Z")
    const ownIdentity = {
      organizationId: "org-1",
      viewerId: "manager-1",
      agentId: "agent-1",
      date: "2026-08-03",
      days: 5 as const,
    }
    const otherIdentity = { ...ownIdentity, viewerId: "manager-2" }
    const ownKey = operationalWeekCacheKey(ownIdentity)
    const otherKey = operationalWeekCacheKey(otherIdentity)
    saveOperationalWeekSnapshot(ownKey, { private: "own" }, "own", storage, now)
    saveOperationalWeekSnapshot(otherKey, { private: "other" }, "other", storage, now)

    expect(clearOperationalWeekSnapshotsForViewer({ organizationId: "org-1", viewerId: "manager-1" }, storage)).toBe(true)
    expect(loadOperationalWeekSnapshot(ownKey, storage, now)).toBeNull()
    expect(loadOperationalWeekSnapshot(otherKey, storage, now)?.data).toEqual({ private: "other" })
  })

  it("invalidates the bounded dashboard cache after a task mutation", () => {
    const storage = memoryStorage()
    const legacyKey = "leaddrive:mtm:operational-week:v1"
    const key = operationalWeekCacheKey({
      organizationId: "org-1",
      viewerId: "manager-1",
      agentId: "agent-1",
      date: "2026-08-03",
      days: 5,
    })
    storage.setItem(legacyKey, JSON.stringify({ legacy: "tenant task and GPS data" }))
    saveOperationalWeekSnapshot(key, { tasks: [{ id: "task-1", status: "PENDING" }] }, "before-sync", storage)

    expect(storage.getItem(legacyKey)).toBeNull()
    expect(loadOperationalWeekSnapshot(key, storage)).not.toBeNull()
    storage.setItem(legacyKey, JSON.stringify({ legacy: "reintroduced" }))
    expect(invalidateOperationalWeekSnapshotsAfterTaskMutation(storage)).toBe(true)
    expect(storage.getItem(legacyKey)).toBeNull()
    expect(loadOperationalWeekSnapshot(key, storage)).toBeNull()
  })

  it("ignores malformed cache keys and prunes identity snapshots beyond retention", () => {
    const storage = memoryStorage()
    const now = new Date("2026-08-03T12:00:00.000Z")
    const oldKey = operationalWeekCacheKey({
      organizationId: "org-1",
      viewerId: "manager-1",
      agentId: "agent-old",
      date: "2026-08-01",
      days: 5,
    })
    saveOperationalWeekSnapshot(
      oldKey,
      { selectedAgent: { id: "agent-old" } },
      "old",
      storage,
      new Date(now.getTime() - 49 * 60 * 60 * 1_000),
    )
    const storageKey = storage.key(0)!
    const raw = JSON.parse(storage.getItem(storageKey) || "{}")
    raw["malformed::identity"] = buildOperationalWeekSnapshot(
      { selectedAgent: { id: "malformed" } },
      { now },
    )
    storage.setItem(storageKey, JSON.stringify(raw))

    expect(loadLatestOperationalWeekSnapshot(
      { organizationId: "org-1", viewerId: "manager-1" },
      storage,
      now,
    )).toBeNull()
    expect(loadOperationalWeekSnapshot(oldKey, storage, now)).toBeNull()
  })
})
