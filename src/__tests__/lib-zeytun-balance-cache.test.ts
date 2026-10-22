import { createHash } from "node:crypto"
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ZeytunBalanceCache } from "@/lib/voice-agent/pharmacy/zeytun-balance-cache"
import { zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { ZeytunSnapshotStore, ZeytunSnapshotStoreError } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { guid, secondGuid, payload } from "./fixtures/zeytun-balances"

const config = {
  organizationId: "tenant-test", endpoint: "https://inventory.example/AvailableBalances",
  username: "test-account", password: "test-secret-never-store",
  request: { GUID: guid, METRO: false, Warehouse: secondGuid },
}
const scopeKey = zeytunBalanceScopeKey(config)
let root: string
let now: number
function snapshot(source: "live" | "attachment" = "live") {
  const bytes = Buffer.from(payload())
  return { payload: bytes, version: createHash("sha256").update(bytes).digest("hex"), context: {
    organizationId: config.organizationId, observedAt: new Date(now).toISOString(), source,
  } }
}
function downloaded() {
  const record = snapshot()
  return { payload: record.payload, feed: new ZeytunAvailableBalances(record.payload, record.context), scopeKey }
}
function store(key = scopeKey) { return new ZeytunSnapshotStore(root, config.organizationId, key) }
function setup(fetchFeed = vi.fn(async () => downloaded())) {
  const disk = store()
  return { disk, fetchFeed, cache: new ZeytunBalanceCache(config, disk, fetchFeed, () => now) }
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "zeytun-cache-test-")); now = Date.parse("2026-10-22T12:00:00Z") })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe("private durable snapshots", () => {
  it("roundtrips source time/provenance and writes only private data files", async () => {
    const disk = store()
    const expected = snapshot("attachment")
    await disk.save(expected)
    const restored = await disk.load()
    expect(restored).toEqual(expected)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    const file = join(root, `${scopeKey}.snapshot`)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readFile(file, "utf8")).not.toContain(config.password)
    expect(await readdir(root)).toEqual([`${scopeKey}.snapshot`])
  })
  it("rejects cross-counterparty copies and tampered/truncated content", async () => {
    await store().save(snapshot())
    const other = zeytunBalanceScopeKey({ ...config, request: { ...config.request, METRO: true } })
    await copyFile(join(root, `${scopeKey}.snapshot`), join(root, `${other}.snapshot`))
    await expect(store(other).load()).rejects.toThrow("snapshot_storage_unavailable")
    const filename = join(root, `${scopeKey}.snapshot`)
    const bytes = await readFile(filename)
    await writeFile(filename, bytes.subarray(0, bytes.length - 2))
    await expect(store().load()).rejects.toThrow("snapshot_storage_unavailable")
  })
  it("does not replace good data with a mismatched checksum or tenant", async () => {
    const disk = store()
    const original = snapshot()
    await disk.save(original)
    await expect(disk.save({ ...original, payload: Buffer.from("broken") })).rejects.toThrow()
    await expect(disk.save({ ...original, context: { ...original.context, organizationId: "other" } })).rejects.toThrow()
    expect(await disk.load()).toEqual(original)
  })
  it("refuses exposed directories/files and symlinks", async () => {
    await chmod(root, 0o755)
    await expect(store().load()).rejects.toThrow()
    await chmod(root, 0o700)
    await store().save(snapshot())
    const filename = join(root, `${scopeKey}.snapshot`)
    await chmod(filename, 0o644)
    await expect(store().load()).rejects.toThrow()
    await rm(filename)
    await symlink(join(root, "outside"), filename)
    await expect(store().load()).rejects.toThrow()
  })
  it("retains the kernel lock after flock exits, across independent stores/scopes; releases on error", async () => {
    const first = store()
    const other = store("a".repeat(64))
    await expect(first.withLock(async () => {
      expect(await other.withLock(async () => "must not run")).toEqual({ acquired: false })
      throw new Error("test failure containing private info")
    })).rejects.toThrow("snapshot_storage_unavailable")
    expect(await other.withLock(async () => "now allowed")).toEqual({ acquired: true, value: "now allowed" })
  })
})

describe("background refresh and network-free search", () => {
  it("coalesces simultaneous refreshes and preserves limits across a new instance", async () => {
    const { cache, fetchFeed } = setup()
    const responses = await Promise.all(Array.from({ length: 15 }, () => cache.refresh()))
    expect(responses.every((result) => result.outcome === "updated")).toBe(true)
    expect(fetchFeed).toHaveBeenCalledTimes(1)
    const restarted = setup(fetchFeed).cache
    expect(await restarted.restore()).toBe(true)
    expect(await restarted.refresh()).toMatchObject({ outcome: "throttled", itemCount: 1 })
    expect(fetchFeed).toHaveBeenCalledTimes(1)
    expect(restarted.search(config.organizationId, scopeKey, { text: "Тестмедин" })).toMatchObject({ candidateCount: 1, canSubmitTo1c: false })
  })
  it("prevents a second worker downloading even for another counterparty", async () => {
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const released = new Promise<void>((resolve) => { release = resolve })
    const first = setup(vi.fn(async () => { started(); await released; return downloaded() }))
    const otherConfig = { ...config, request: { ...config.request, GUID: secondGuid } }
    const readOther = vi.fn(async () => downloaded())
    const other = new ZeytunBalanceCache(otherConfig, store(zeytunBalanceScopeKey(otherConfig)), readOther, () => now)
    const pending = first.cache.refresh()
    await startedPromise
    try {
      expect(await other.refresh()).toMatchObject({ outcome: "busy", itemCount: 0 })
      expect(readOther).not.toHaveBeenCalled()
    } finally { release(); await pending }
  })
  it("retains the last good snapshot after read failure; backs off and survives restart", async () => {
    const { cache, fetchFeed } = setup()
    await cache.refresh()
    const original = cache.status().catalogVersion
    fetchFeed.mockRejectedValue(new Error(config.password))
    now += 15 * 60_000
    expect(await cache.refresh()).toMatchObject({ outcome: "failed", catalogVersion: original, lastError: "read_failed" })
    now += 15 * 60_000
    const failed = await cache.refresh()
    expect(failed.nextAttemptAt).toBe(now + 30 * 60_000)
    expect(failed.observationStatus).toBe("stale")
    expect(JSON.stringify(failed)).not.toContain(config.password)
    const restarted = setup(fetchFeed).cache
    await restarted.restore()
    expect(await restarted.refresh()).toMatchObject({ outcome: "throttled", catalogVersion: original })
    const calls = fetchFeed.mock.calls.length
    for (let i = 0; i < 10; i++) restarted.search(config.organizationId, scopeKey, { itemCode: "SN-TEST-001" })
    expect(fetchFeed).toHaveBeenCalledTimes(calls)
    now = failed.nextAttemptAt!
    fetchFeed.mockResolvedValue(downloaded())
    expect(await restarted.refresh()).toMatchObject({ outcome: "updated", lastError: null, observationStatus: "recent" })
    expect((await store().readAttempt())?.failures).toBe(0)
  })
  it("never fetches on an empty search and rejects another tenant/customer", () => {
    const { cache, fetchFeed } = setup()
    expect(cache.search(config.organizationId, scopeKey, { text: "Тестмедин" })).toMatchObject({ status: "snapshot_unavailable" })
    expect(() => cache.search("other", scopeKey, {})).toThrow("tenant_mismatch")
    expect(() => cache.search(config.organizationId, "a".repeat(64), {})).toThrow("tenant_mismatch")
    expect(fetchFeed).not.toHaveBeenCalled()
  })
  it("does not redate saved data at restart or label attachment/future observations recent", async () => {
    const { cache, disk } = setup()
    await disk.save(snapshot("attachment"))
    await cache.restore()
    expect(cache.status()).toMatchObject({ observationStatus: "stale", source: "attachment" })
    now += 60_000
    const live = snapshot()
    await disk.save(live)
    await cache.restore()
    now -= 60_000
    expect(cache.status().observationStatus).toBe("stale")
    now += 31 * 60_000
    await cache.restore()
    expect(cache.status()).toMatchObject({ observationStatus: "stale", observedAt: live.context.observedAt })
  })
  it("fails closed on damaged rate-limit state before any network call", async () => {
    const { cache, fetchFeed } = setup()
    await writeFile(join(root, `${scopeKey}.attempt`), "broken", { mode: 0o600 })
    expect(await cache.refresh()).toMatchObject({ outcome: "failed", lastError: "storage_failed" })
    expect(fetchFeed).not.toHaveBeenCalled()
  })
  it("does not fetch when the preflight persistence fails", async () => {
    const { cache, disk, fetchFeed } = setup()
    vi.spyOn(disk, "saveAttempt").mockRejectedValue(new Error("disk full"))
    expect(await cache.refresh()).toMatchObject({ outcome: "failed", lastError: "storage_failed" })
    expect(fetchFeed).not.toHaveBeenCalled()
  })
  it("honors a deadline left by a worker interrupted during download", async () => {
    const { cache, disk, fetchFeed } = setup()
    await disk.saveAttempt({ scopeKey, attemptedAt: now, nextAttemptAt: now + 900_000, failures: 1, lastError: "interrupted" })
    expect(await cache.refresh()).toMatchObject({ outcome: "throttled", lastError: "interrupted", itemCount: 0 })
    expect(fetchFeed).not.toHaveBeenCalled()
  })
  it("keeps the old observation and bytes when persisting a valid replacement fails", async () => {
    const { cache, disk } = setup()
    await cache.refresh()
    const originalTime = cache.status().observedAt
    const before = await readFile(join(root, `${scopeKey}.snapshot`))
    now += 900_000
    vi.spyOn(disk, "save").mockRejectedValue(new ZeytunSnapshotStoreError())
    expect(await cache.refresh()).toMatchObject({ outcome: "failed", observedAt: originalTime, lastError: "storage_failed" })
    expect(await readFile(join(root, `${scopeKey}.snapshot`))).toEqual(before)
  })
  it("recovers a corrupt snapshot only after validating a full replacement", async () => {
    const { cache, fetchFeed } = setup()
    await writeFile(join(root, `${scopeKey}.snapshot`), "broken", { mode: 0o600 })
    expect(await cache.restore()).toBe(false)
    expect(await cache.refresh()).toMatchObject({ outcome: "updated", itemCount: 1, lastError: null })
    expect(fetchFeed).toHaveBeenCalledTimes(1)
    expect(await setup().cache.restore()).toBe(true)
  })
  it("retains good data when a fetcher supplies the wrong customer scope", async () => {
    const { cache, fetchFeed } = setup()
    await cache.refresh()
    const before = await readFile(join(root, `${scopeKey}.snapshot`))
    now += 15 * 60_000
    fetchFeed.mockResolvedValue({ ...downloaded(), scopeKey: "a".repeat(64) })
    expect(await cache.refresh()).toMatchObject({ outcome: "failed", itemCount: 1 })
    expect(await readFile(join(root, `${scopeKey}.snapshot`))).toEqual(before)
  })
})
