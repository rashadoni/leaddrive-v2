/**
 * Read-side actor memo (review of #204): the photo file proxy resolved a
 * manager's whole scope for every image — 7–11 queries each, ~2000 for a
 * 200-photo gallery. The memo keeps a resolved actor for 30 s per person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTtlMemo, createTtlThrottle } from "@/lib/mtm/actor-memo"
import {
  MTM_FIELD_SCOPE_MEMO_TTL_MS,
  mtmFieldScopeMemoKey,
  resetMtmFieldScopeMemo,
  resolveMtmFieldScope,
} from "@/lib/mtm/field-access"
import { resetMtmActorDiagnostics, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

describe("createTtlMemo", () => {
  it("reuses a value inside the TTL and reloads after it expires", async () => {
    let clock = 1_000
    const memo = createTtlMemo<string>({ ttlMs: 30_000, maxEntries: 10, now: () => clock })
    const load = vi.fn(async () => `value-${clock}`)

    expect(await memo.get("k", load)).toBe("value-1000")
    clock += 29_999
    expect(await memo.get("k", load)).toBe("value-1000")
    expect(load).toHaveBeenCalledTimes(1)

    clock += 1
    expect(await memo.get("k", load)).toBe("value-31000")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("shares one in-flight load between parallel callers", async () => {
    const memo = createTtlMemo<number>({ ttlMs: 30_000, maxEntries: 10 })
    let release: (value: number) => void = () => {}
    const load = vi.fn(() => new Promise<number>((resolve) => { release = resolve }))

    const pending = Promise.all(Array.from({ length: 50 }, () => memo.get("gallery", load)))
    release(7)

    expect(await pending).toEqual(Array(50).fill(7))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("never caches a failed load", async () => {
    const memo = createTtlMemo<string>({ ttlMs: 30_000, maxEntries: 10 })
    await expect(memo.get("k", () => Promise.reject(new Error("db down")))).rejects.toThrow("db down")
    await Promise.resolve()
    expect(await memo.get("k", async () => "fresh")).toBe("fresh")
  })

  it("stays bounded, dropping the oldest entries first", async () => {
    const memo = createTtlMemo<string>({ ttlMs: 30_000, maxEntries: 3 })
    for (const key of ["a", "b", "c", "d"]) await memo.get(key, async () => key)
    expect(memo.size).toBe(3)
    const reloadA = vi.fn(async () => "a2")
    expect(await memo.get("a", reloadA)).toBe("a2")
    expect(reloadA).toHaveBeenCalledTimes(1)
  })
})

describe("createTtlThrottle", () => {
  it("lets a key pass once per TTL", () => {
    let clock = 0
    const throttle = createTtlThrottle({ ttlMs: 30_000, maxEntries: 10, now: () => clock })
    expect(throttle.shouldRun("user-1")).toBe(true)
    expect(throttle.shouldRun("user-1")).toBe(false)
    expect(throttle.shouldRun("user-2")).toBe(true)
    clock += 30_000
    expect(throttle.shouldRun("user-1")).toBe(true)
  })
})

describe("resolveMtmFieldScope memo", () => {
  function prismaFor(role: string) {
    return {
      mtmAgent: {
        findFirst: vi.fn().mockResolvedValue({ id: "card-1", role, canPlanOwnRoutes: true, canSelfPublishRoutes: false }),
        findUnique: vi.fn().mockResolvedValue({ id: "card-1", teamId: null }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
      },
      mtmTeam: { findFirst: vi.fn(), findMany: vi.fn() },
    }
  }

  beforeEach(() => {
    resetMtmFieldScopeMemo()
    resetMtmActorDiagnostics()
    vi.useRealTimers()
  })

  it("resolves a person's scope once for a burst of requests", async () => {
    const prisma = prismaFor("MANAGER")
    const params = { organizationId: "org-1", userId: "manager-user", webRole: "manager" }

    await Promise.all(Array.from({ length: 20 }, () => resolveMtmFieldScope(prisma as never, params)))

    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })

  it("isolates entries by organization and by principal", async () => {
    const prisma = prismaFor("MANAGER")
    await resolveMtmFieldScope(prisma as never, { organizationId: "org-1", userId: "same-user", webRole: "manager" })
    await resolveMtmFieldScope(prisma as never, { organizationId: "org-2", userId: "same-user", webRole: "manager" })
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(2)
    expect(prisma.mtmAgent.findFirst.mock.calls[1][0].where.organizationId).toBe("org-2")

    expect(mtmFieldScopeMemoKey({ organizationId: "org-1", userId: "x" }))
      .not.toBe(mtmFieldScopeMemoKey({ organizationId: "org-2", userId: "x" }))
    expect(mtmFieldScopeMemoKey({ organizationId: "org-1", userId: "x", agentId: "x" }))
      .not.toBe(mtmFieldScopeMemoKey({ organizationId: "org-1", userId: "x" }))
  })

  it("expires after the TTL so a scope change is picked up", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-14T10:00:00Z") })
    const prisma = prismaFor("MANAGER")
    const params = { organizationId: "org-1", userId: "manager-user", webRole: "manager" }

    await resolveMtmFieldScope(prisma as never, params)
    vi.setSystemTime(new Date(Date.now() + MTM_FIELD_SCOPE_MEMO_TTL_MS - 1))
    await resolveMtmFieldScope(prisma as never, params)
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date(Date.now() + 1))
    prisma.mtmAgent.findFirst.mockResolvedValue(null)
    expect((await resolveMtmFieldScope(prisma as never, params)).kind).toBe("none")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("does not memoize a web administrator", async () => {
    const prisma = prismaFor("MANAGER")
    const scope = await resolveMtmFieldScope(prisma as never, { organizationId: "org-1", userId: "admin-user", webRole: "admin" })
    expect(scope.kind).toBe("organization")
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })
})

describe("duplicate-card warning is throttled", () => {
  beforeEach(() => resetMtmActorDiagnostics())

  it("counts and warns once per person per TTL, not on every request", async () => {
    const prisma = {
      mtmAgent: {
        findFirst: vi.fn().mockResolvedValue({ id: "old-card", role: "AGENT", canPlanOwnRoutes: true, canSelfPublishRoutes: false }),
        count: vi.fn().mockResolvedValue(2),
      },
      mtmTeam: {},
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      for (let i = 0; i < 5; i += 1) {
        await resolveMtmRouteActor(prisma as never, { organizationId: "org-1", userId: "twice-linked", webRole: "sales" })
      }
      expect(prisma.mtmAgent.count).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
