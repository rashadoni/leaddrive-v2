import { describe, expect, it } from "vitest"
import { claimMtmRouteTravelPreview, secondsUntilNextUtcDay } from "@/lib/mtm/route-travel-invocation"

class FakeRedis {
  readonly values = new Map<string, string>()

  async get(key: string) {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: string, ...arguments_: Array<string | number>) {
    const nx = arguments_.includes("NX")
    if (nx && this.values.has(key)) return null
    this.values.set(key, value)
    return "OK"
  }

  async del(...keys: string[]) {
    let removed = 0
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1
    }
    return removed
  }

  async eval(script: string, _numberOfKeys: number, ...arguments_: string[]) {
    const [key, firstArg, secondArg] = arguments_
    if (script.includes("redis.call('incr'")) {
      const next = Number(this.values.get(key) ?? "0") + 1
      this.values.set(key, String(next))
      return next > Number(secondArg) ? 0 : next
    }
    if (this.values.get(key) === firstArg) return this.del(key)
    return 0
  }
}

const base = {
  organizationId: "org-1",
  routeId: "route-1",
  sourceFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  actorKey: "user-1",
  idempotencyKey: "preview-key-0001",
  dailyLimit: 2,
}

describe("MTM route travel invocation guard", () => {
  it("claims a paid call once and suppresses an exact replay without storing route content", async () => {
    const redis = new FakeRedis()
    const first = await claimMtmRouteTravelPreview(base, { redis })
    expect(first.state).toBe("CLAIMED")
    if (first.state !== "CLAIMED") return
    await first.release()

    const replay = await claimMtmRouteTravelPreview(base, { redis })
    expect(replay).toEqual({ state: "IDEMPOTENCY_REPLAY" })
    expect([...redis.values.values()]).not.toContain("12345")
    expect([...redis.values.keys()].some((key) => key.includes("idempotency"))).toBe(true)
  })

  it("rejects reuse of one idempotency key for another reviewed route source", async () => {
    const redis = new FakeRedis()
    const first = await claimMtmRouteTravelPreview(base, { redis })
    if (first.state === "CLAIMED") await first.release()

    await expect(claimMtmRouteTravelPreview({
      ...base,
      sourceFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }, { redis })).resolves.toEqual({ state: "IDEMPOTENCY_MISMATCH" })
  })

  it("reserves a finite tenant-day allowance before a provider request", async () => {
    const redis = new FakeRedis()
    const first = await claimMtmRouteTravelPreview({ ...base, dailyLimit: 1 }, { redis })
    if (first.state === "CLAIMED") await first.release()

    await expect(claimMtmRouteTravelPreview({
      ...base,
      sourceFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      idempotencyKey: "preview-key-0002",
      dailyLimit: 1,
    }, { redis })).resolves.toEqual({ state: "DAILY_LIMIT_REACHED" })
  })

  it("fails closed when the distributed protection is unavailable", async () => {
    await expect(claimMtmRouteTravelPreview(base, { redis: null })).resolves.toEqual({
      state: "PROTECTION_UNAVAILABLE",
    })
  })

  it("bounds daily counters to the next UTC day", () => {
    expect(secondsUntilNextUtcDay(new Date("2026-08-28T23:59:30.000Z"))).toBe(90)
  })
})
