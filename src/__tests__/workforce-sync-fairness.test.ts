import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import IORedis from "ioredis"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import { _resetPublicAbuseGuardForTests, consumePublicRateLimitBatch, type PublicRateLimitBatchEntry } from "@/lib/public-abuse-guard"
import { _resetPublicGuardRedisForTests } from "@/lib/public-abuse-redis"

const redisUrl = process.env.WORKFORCE_FAIRNESS_TEST_REDIS_URL
const base = { stream: "workforce" as const, phase: "pull" as const, organizationId: "tenant-fairness", agentId: "agent-fairness", userId: "user-fairness", deviceId: "device-fairness" }
function entries(): PublicRateLimitBatchEntry[] {
  return [
    { scope: "mtm-mobile-sync-v2:workforce:pull:device", identifier: `${base.organizationId}:${base.agentId}:${base.deviceId}`, policy: { maxRequests: 60, windowSeconds: 60 } },
    { scope: "mtm-mobile-sync-v2:workforce:pull:user", identifier: `${base.organizationId}:${base.userId}`, policy: { maxRequests: 60, windowSeconds: 60 } },
    { scope: "mtm-mobile-sync-v2:workforce:pull:tenant", identifier: base.organizationId, policy: { maxRequests: 180, windowSeconds: 60 } },
  ].map(value => ({ ...value, identifierMode: "exact", redisHashTag: `mtm-mobile-sync-v2:${base.organizationId}` }))
}

for (const backend of ["memory", "redis"] as const) {
  describe.skipIf(backend === "redis" && !redisUrl)(`F4/F5 actual ${backend} all-or-nothing guard`, () => {
    let clock: number
    let fixture: IORedis | undefined
    beforeEach(async () => {
      clock = Date.UTC(2026, 9, 6, 12)
      vi.spyOn(Date, "now").mockImplementation(() => clock)
      _resetPublicGuardRedisForTests()
      _resetPublicAbuseGuardForTests()
      vi.stubEnv("NODE_ENV", backend === "redis" ? "production" : "test")
      vi.stubEnv("REDIS_URL", backend === "redis" ? redisUrl! : "")
      if (backend === "redis") {
        const url = new URL(redisUrl!)
        if (url.protocol !== "redis:" || url.hostname !== "127.0.0.1" || url.pathname !== "/15") throw new Error("FAIRNESS_REDIS_NOT_ISOLATED")
        fixture ??= new IORedis(redisUrl!, { maxRetriesPerRequest: 0 })
        await fixture.flushdb()
      }
    })
    afterEach(() => { _resetPublicGuardRedisForTests(); _resetPublicAbuseGuardForTests(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
    afterAll(async () => { if (fixture) { await fixture.flushdb(); await fixture.quit() } })

    it("a noisy tenant/stream leaves another tenant and the other stream their complete budgets", async () => {
      for (let i = 0; i < 60; i++) expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: true })
      for (let i = 0; i < 20; i++) expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: false, unavailable: false, retryAfterSeconds: 60 })
      for (const independent of [{ ...base, organizationId: "tenant-independent" }, { ...base, stream: "routes" as const }]) {
        for (let i = 0; i < 60; i++) expect(await consumeMtmMobileSyncV2RateLimit(independent)).toMatchObject({ allowed: true })
        expect(await consumeMtmMobileSyncV2RateLimit(independent)).toMatchObject({ allowed: false, unavailable: false })
      }
    })

    it.each([0, 1, 2])("denial at bucket %i charges neither other bucket and recovers exactly at the window edge", async index => {
      const buckets = entries()
      for (let i = 0; i < buckets[index].policy.maxRequests; i++) expect(await consumePublicRateLimitBatch([buckets[index]])).toMatchObject({ allowed: true })
      for (let i = 0; i < 10; i++) expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: false, retryAfterSeconds: 60, unavailable: false })
      for (const [i, entry] of buckets.entries()) {
        if (i === index) continue
        for (let j = 0; j < entry.policy.maxRequests; j++) expect(await consumePublicRateLimitBatch([entry])).toMatchObject({ allowed: true })
        expect(await consumePublicRateLimitBatch([entry])).toMatchObject({ allowed: false })
      }
      clock += 59_999
      expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: false, retryAfterSeconds: 1 })
      clock += 1
      expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: true, retryAfterSeconds: 0 })
    })

    it("exhausting snapshot creation does not consume pull capacity", async () => {
      for (let i = 0; i < 3; i++) expect(await consumeMtmMobileSyncV2RateLimit({ ...base, phase: "initial-snapshot" })).toMatchObject({ allowed: true })
      expect(await consumeMtmMobileSyncV2RateLimit({ ...base, phase: "initial-snapshot" })).toMatchObject({ allowed: false })
      for (let i = 0; i < 60; i++) expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: true })
      expect(await consumeMtmMobileSyncV2RateLimit(base)).toMatchObject({ allowed: false })
    })
  })
}
