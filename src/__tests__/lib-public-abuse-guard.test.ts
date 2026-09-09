import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const redisState = vi.hoisted(() => ({
  connection: null as null | { eval: ReturnType<typeof vi.fn> },
  ready: false,
}))

vi.mock("@/lib/public-abuse-redis", () => ({
  getPublicGuardRedisConnection: vi.fn(() => redisState.connection),
  waitForPublicGuardRedis: vi.fn(async () => redisState.ready),
}))

import {
  _resetPublicAbuseGuardForTests,
  acquirePublicConcurrencySlot,
  consumePublicRateLimitBatch,
  consumePublicRateLimit,
  releasePublicConcurrencySlot,
  releasePublicActionReservation,
  reservePublicAction,
} from "@/lib/public-abuse-guard"

describe("public abuse guard", () => {
  beforeEach(() => {
    _resetPublicAbuseGuardForTests()
    redisState.connection = null
    redisState.ready = false
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("fails closed in production when the shared Redis store is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(await consumePublicRateLimit("web-lead:ip", "203.0.113.9", {
      maxRequests: 10,
      windowSeconds: 60,
    })).toEqual({ allowed: false, retryAfterSeconds: 1, unavailable: true })

    expect(await reservePublicAction("portal-register:recipient", "recipient@example.com", {
      cooldownSeconds: 600,
      maxActions: 3,
      windowSeconds: 3600,
    })).toEqual({ allowed: false, retryAfterSeconds: 1, unavailable: true })

    expect(await acquirePublicConcurrencySlot("uploads:get", "user-1", {
      maxConcurrent: 8,
      leaseSeconds: 120,
    })).toEqual({ allowed: false, retryAfterSeconds: 1, unavailable: true })
  })

  it("waits for a connecting Redis client and serves the first production request once ready", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const evalCommand = vi.fn().mockResolvedValue([1, 0])
    redisState.connection = { eval: evalCommand }
    redisState.ready = true

    await expect(consumePublicRateLimit("web-lead:ip", "203.0.113.10", {
      maxRequests: 10,
      windowSeconds: 60,
    })).resolves.toEqual({ allowed: true, retryAfterSeconds: 0, unavailable: false })
    expect(evalCommand).toHaveBeenCalledTimes(1)
  })

  it("blocks the request after an endpoint-specific sliding-window budget", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect(await consumePublicRateLimit("web-lead:ip", "203.0.113.1", {
        maxRequests: 10,
        windowSeconds: 60,
      })).toMatchObject({ allowed: true, unavailable: false })
    }

    expect(await consumePublicRateLimit("web-lead:ip", "203.0.113.1", {
      maxRequests: 10,
      windowSeconds: 60,
    })).toMatchObject({ allowed: false, retryAfterSeconds: 60, unavailable: false })

    vi.advanceTimersByTime(60_001)
    expect(await consumePublicRateLimit("web-lead:ip", "203.0.113.1", {
      maxRequests: 10,
      windowSeconds: 60,
    })).toMatchObject({ allowed: true, unavailable: false })
  })

  it("keeps scopes isolated for the same identifier", async () => {
    expect(await consumePublicRateLimit("web-lead:ip", "203.0.113.2", {
      maxRequests: 1,
      windowSeconds: 60,
    })).toMatchObject({ allowed: true })
    expect(await consumePublicRateLimit("portal-register:ip", "203.0.113.2", {
      maxRequests: 1,
      windowSeconds: 60,
    })).toMatchObject({ allowed: true })
  })

  it("atomically rejects a tenant-limited batch without burning a fresh device budget", async () => {
    const tenant = { scope: "mtm-sync:tenant", identifier: "org-1", policy: { maxRequests: 1, windowSeconds: 60 }, redisHashTag: "mtm-sync:org-1" }
    const device = { scope: "mtm-sync:device", identifier: "org-1:agent-1:Device-A", policy: { maxRequests: 1, windowSeconds: 60 }, identifierMode: "exact" as const, redisHashTag: "mtm-sync:org-1" }

    await expect(consumePublicRateLimitBatch([tenant])).resolves.toMatchObject({
      allowed: true,
    })
    await expect(consumePublicRateLimitBatch([device, tenant])).resolves.toMatchObject({
      allowed: false,
      unavailable: false,
    })
    await expect(consumePublicRateLimitBatch([device])).resolves.toMatchObject({
      allowed: true,
    })
  })

  it("keeps exact device identities case-sensitive inside an atomic batch", async () => {
    const policy = { maxRequests: 1, windowSeconds: 60 }
    const first = {
      scope: "mtm-sync:device",
      identifier: "org-1:agent-1:Device-A",
      policy,
      identifierMode: "exact" as const,
      redisHashTag: "mtm-sync:org-1",
    }
    const second = { ...first, identifier: "org-1:agent-1:device-a" }

    await expect(consumePublicRateLimitBatch([first])).resolves.toMatchObject({ allowed: true })
    await expect(consumePublicRateLimitBatch([second])).resolves.toMatchObject({ allowed: true })
    await expect(consumePublicRateLimitBatch([first])).resolves.toMatchObject({ allowed: false })
  })

  it("uses one Redis command for an all-or-nothing batch", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const evalCommand = vi.fn().mockResolvedValue([1, 0])
    redisState.connection = { eval: evalCommand }
    redisState.ready = true

    await expect(consumePublicRateLimitBatch([
      { scope: "mtm-sync:device", identifier: "org-1:agent-1:device-1", policy: { maxRequests: 60, windowSeconds: 60 }, identifierMode: "exact", redisHashTag: "mtm-sync:org-1" },
      { scope: "mtm-sync:user", identifier: "org-1:user-1", policy: { maxRequests: 60, windowSeconds: 60 }, identifierMode: "exact", redisHashTag: "mtm-sync:org-1" },
      { scope: "mtm-sync:tenant", identifier: "org-1", policy: { maxRequests: 180, windowSeconds: 60 }, identifierMode: "exact", redisHashTag: "mtm-sync:org-1" },
    ])).resolves.toEqual({ allowed: true, retryAfterSeconds: 0, unavailable: false })

    expect(evalCommand).toHaveBeenCalledTimes(1)
    expect(evalCommand.mock.calls[0]?.[1]).toBe(3)
  })

  it("enforces both recipient cooldown and the longer hourly cap", async () => {
    const policy = { cooldownSeconds: 10, maxActions: 3, windowSeconds: 3600 }
    const identifier = "recipient@example.com"

    expect(await reservePublicAction("portal-register:recipient", identifier, policy)).toMatchObject({ allowed: true })
    expect(await reservePublicAction("portal-register:recipient", identifier, policy)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10,
    })

    vi.advanceTimersByTime(10_001)
    expect(await reservePublicAction("portal-register:recipient", identifier, policy)).toMatchObject({ allowed: true })
    vi.advanceTimersByTime(10_001)
    expect(await reservePublicAction("portal-register:recipient", identifier, policy)).toMatchObject({ allowed: true })
    vi.advanceTimersByTime(10_001)
    expect(await reservePublicAction("portal-register:recipient", identifier, policy)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 3570,
    })
  })

  it("releases a cancelled reservation so a legitimate retry is possible", async () => {
    const policy = { cooldownSeconds: 600, maxActions: 3, windowSeconds: 3600 }
    const first = await reservePublicAction("portal-register:recipient", "recipient@example.com", policy)
    expect(first.allowed).toBe(true)

    await releasePublicActionReservation(first)

    expect(await reservePublicAction("portal-register:recipient", "recipient@example.com", policy)).toMatchObject({
      allowed: true,
    })
  })

  it("caps concurrent work and releases a slot deterministically", async () => {
    const policy = { maxConcurrent: 2, leaseSeconds: 120 }
    const first = await acquirePublicConcurrencySlot("uploads:get", "user-1", policy)
    const second = await acquirePublicConcurrencySlot("uploads:get", "user-1", policy)
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(await acquirePublicConcurrencySlot("uploads:get", "user-1", policy)).toMatchObject({
      allowed: false,
      unavailable: false,
    })

    await releasePublicConcurrencySlot(first)
    expect(await acquirePublicConcurrencySlot("uploads:get", "user-1", policy)).toMatchObject({
      allowed: true,
    })
  })
})
