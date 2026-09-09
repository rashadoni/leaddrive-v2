// src/__tests__/lib-rls-context.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  rlsStorage,
  getRlsContext,
  runWithTenant,
  runWithRlsBypass,
  enterTenantContext,
  enterRlsBypass,
} from "@/lib/rls-context"

describe("rls-context", () => {
  // enterWith deliberately leaks across async continuations (that's the design
  // for HTTP guards) — reset before each test so tests stay order-independent.
  beforeEach(() => { rlsStorage.enterWith(undefined as never) })

  it("runWithTenant scopes orgId to the callback and clears after", async () => {
    expect(getRlsContext()).toBeUndefined()
    const inside = await runWithTenant("org-a", async () => getRlsContext())
    expect(inside).toEqual({ orgId: "org-a" })
    expect(getRlsContext()).toBeUndefined()
  })

  it("runWithTenant throws on empty orgId (fail-closed, never empty-string match)", () => {
    expect(() => runWithTenant("", async () => {})).toThrow(/non-empty/)
  })

  it("runWithRlsBypass sets bypass flag", async () => {
    const inside = await runWithRlsBypass(async () => getRlsContext())
    expect(inside).toEqual({ bypass: true })
  })

  it("nested runWithTenant overrides outer context and restores it", async () => {
    await runWithTenant("org-a", async () => {
      await runWithTenant("org-b", async () => {
        expect(getRlsContext()).toEqual({ orgId: "org-b" })
      })
      expect(getRlsContext()).toEqual({ orgId: "org-a" })
    })
  })

  it("enterTenantContext inside an awaited callee propagates to the caller continuation (guard→handler shape)", async () => {
    // This pins the Node ALS semantics the whole zero-route-edit design rests on.
    async function guard() {
      enterTenantContext("org-guard")
      return "ok"
    }
    async function handler() {
      await guard()
      await new Promise((r) => setTimeout(r, 5)) // cross a real async boundary
      return getRlsContext()
    }
    expect(await handler()).toEqual({ orgId: "org-guard" })
  })

  it("enterTenantContext refuses empty orgId and enters NO context", async () => {
    async function handler() {
      const entered = enterTenantContext("")
      return { entered, ctx: getRlsContext() }
    }
    const r = await handler()
    expect(r.entered).toBe(false)
    expect(r.ctx).toBeUndefined()
  })

  it("enterRlsBypass replaces a previously entered tenant context (superadmin-after-requireAuth shape)", async () => {
    async function handler() {
      enterTenantContext("org-x")
      enterRlsBypass()
      return getRlsContext()
    }
    expect(await handler()).toEqual({ bypass: true })
  })

  it("INVARIANT: enterWith leaks across interval ticks; .run() isolates them", async () => {
    // Documents WHY timers must use runWithRlsBypass (.run), never enterTenantContext.
    const leak: Array<unknown> = []
    await new Promise<void>((resolve) => {
      let tick = 0
      const t = setInterval(() => {
        tick++
        if (tick === 1) rlsStorage.enterWith({ orgId: "tick-1" })
        leak.push(getRlsContext())
        if (tick === 2) { clearInterval(t); resolve() }
      }, 5)
    })
    expect(leak[1]).toEqual({ orgId: "tick-1" }) // the leak — this is the footgun

    const isolated: Array<unknown> = []
    await new Promise<void>((resolve) => {
      let tick = 0
      const t = setInterval(() => {
        tick++
        void runWithRlsBypass(async () => { isolated.push(getRlsContext()) })
        if (tick === 2) { clearInterval(t); resolve() }
      }, 5)
    })
    expect(isolated).toEqual([{ bypass: true }, { bypass: true }])
    expect(getRlsContext()).toBeUndefined()
  })
})
