import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZeytunClientsCache } from "@/lib/voice-agent/pharmacy/zeytun-clients-cache"
import { zeytunClientsScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-clients-client"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { clientGuid, clientContext, clientStamp, clientRow, clientsXml } from "./fixtures/zeytun-clients"

const config = { organizationId: "tenant-test", endpoint: "https://clients.example/ws/service", username: "synthetic-user", password: "synthetic-secret" }
const scopeKey = zeytunClientsScopeKey(config)
const hour = 3_600_000

describe("durable ListClients background cache", () => {
  let root: string
  let now: number
  let store: ZeytunSnapshotStore
  const makeRead = () => ({ payload: clientsXml(), scopeKey, context: { ...clientContext, observedAt: new Date(now).toISOString() } })
  const upstream = vi.fn(async () => makeRead())
  const cache = () => new ZeytunClientsCache(config, store, upstream, () => now)
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zeytun-clients-test-"))
    now = Date.parse(clientStamp)
    store = new ZeytunSnapshotStore(root, config.organizationId, scopeKey)
    upstream.mockReset(); upstream.mockImplementation(async () => makeRead())
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it("persists validated snapshots, restores original age and searches with no network", async () => {
    const worker = cache()
    expect(await worker.restore()).toBe(false)
    expect((await worker.refresh()).outcome).toBe("updated")
    expect(worker.current("tenant-test")!.get("tenant-test", clientGuid)!.phoneE164).toBe("+994500000001")
    now += 30 * 60_000
    const restarted = cache()
    expect(await restarted.restore()).toBe(true)
    expect(restarted.status()).toMatchObject({ observedAt: clientStamp, clientCount: 1, canAuthorizeCall: false })
    expect((await restarted.refresh()).outcome).toBe("throttled")
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(restarted.status())).not.toMatch(/synthetic-secret|synthetic-user|994500000001/)
    expect(() => restarted.current("other")).toThrow("tenant_mismatch")
  })
  it("keeps a good snapshot on a malformed refresh and backs off across restarts", async () => {
    const worker = cache(); await worker.refresh()
    const version = worker.status().version
    now += hour
    upstream.mockResolvedValue({ ...makeRead(), payload: Buffer.from("malformed private payload") })
    expect((await worker.refresh()).outcome).toBe("failed")
    expect(worker.status().version).toBe(version)
    expect(worker.current("tenant-test")!.get("tenant-test", clientGuid)).not.toBeNull()
    const restarted = cache(); await restarted.restore()
    expect((await restarted.refresh()).outcome).toBe("throttled")
    now += hour
    expect((await restarted.refresh()).outcome).toBe("failed")
    expect(restarted.status().nextAttemptAt).toBe(now + 2 * hour)
    expect(upstream).toHaveBeenCalledTimes(3)
  })
  it("fails closed on corrupt attempt metadata instead of hammering 1C", async () => {
    await cache().refresh()
    await writeFile(join(root, `${scopeKey}.attempt`), "invalid")
    const restarted = cache()
    expect(await restarted.restore()).toBe(false)
    expect(restarted.current("tenant-test")).toBeNull()
    expect((await restarted.refresh()).outcome).toBe("failed")
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it("shares one in-flight request and honors a lock held by another scope", async () => {
    let release!: () => void
    let entered!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const started = new Promise<void>((r) => { entered = r })
    upstream.mockImplementation(async () => { entered(); await pending; return makeRead() })
    const first = cache(); const read = first.refresh()
    expect(first.refresh()).toBe(read)
    await started
    try { expect((await cache().refresh()).outcome).toBe("busy") }
    finally { release(); await read }
    expect(upstream).toHaveBeenCalledTimes(1)
    now += hour
    const otherScope = new ZeytunSnapshotStore(root, "other-tenant", "a".repeat(64))
    await otherScope.withLock(async () => { expect((await first.refresh()).outcome).toBe("busy") })
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it("rejects mismatched scope/source and duplicate customer replacements", async () => {
    for (const patch of [
      () => ({ scopeKey: "a".repeat(64) }), () => ({ context: { ...clientContext, organizationId: "other" } }),
      () => ({ context: { ...clientContext, observedAt: new Date(now + 1000).toISOString() } }),
      () => ({ payload: clientsXml([clientRow(), clientRow()]) }),
    ]) {
      upstream.mockResolvedValue({ ...makeRead(), ...patch() })
      const worker = cache()
      expect((await worker.refresh()).outcome).toBe("failed")
      expect(worker.current("tenant-test")).toBeNull()
      now += 7 * hour
    }
    expect(() => new ZeytunClientsCache({ ...config, organizationId: "other" }, store)).toThrow("tenant_mismatch")
  })
})
