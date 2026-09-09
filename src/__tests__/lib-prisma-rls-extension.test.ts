// src/__tests__/lib-prisma-rls-extension.test.ts
import { describe, it, expect, vi } from "vitest"
import { rlsStorage, runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { __rlsPerOpWrap, __wrapTransaction } from "@/lib/prisma"

function makeStubBase() {
  const calls: any[] = []
  const stub = {
    calls,
    $executeRaw: vi.fn((..._a: any[]) => ({ __setCfg: true })),
    $transaction: vi.fn(async (arg: any, opts?: any) => {
      calls.push({ arg, opts })
      if (typeof arg === "function") {
        const tx = { $executeRaw: vi.fn(async () => 1), label: "tx" }
        return arg(tx)
      }
      return Promise.all(arg.map((p: any) => (typeof p?.then === "function" ? p : Promise.resolve(p))))
    }),
  }
  return stub
}

describe("rls per-operation wrap", () => {
  it("no context + org-scoped model → THROWS in the test env (Phase 3 CI guardrail)", async () => {
    // Under RLS this op fail-closes in prod (empty reads / WITH CHECK reject). The
    // Phase 3 guardrail turns that into a CI failure instead of a silent warning.
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async (a: any) => ({ rows: a }))
    await expect(
      wrap({ args: { where: 1 }, query, operation: "findMany", model: "Deal" } as any)
    ).rejects.toThrow(/\[RLS-GUARD\]/)
    expect(query).not.toHaveBeenCalled() // throws BEFORE running the query
    expect(base.$transaction).not.toHaveBeenCalled()
  })

  it("no context + non-org-scoped model → passes through untouched (guard only fires for org tables)", async () => {
    // PlanTemplate is a global catalog table (no organizationId) → not org-scoped →
    // the guard neither warns nor throws; the op passes straight through.
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async (a: any) => ({ rows: a }))
    const result = await wrap({ args: { where: 1 }, query, operation: "findMany", model: "PlanTemplate" } as any)
    expect(result).toEqual({ rows: { where: 1 } })
    expect(base.$transaction).not.toHaveBeenCalled()
  })

  it("tenant context → wraps op in a batch tx with set_config first", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async () => "data")
    const result = await runWithTenant("org-a", () =>
      wrap({ args: {}, query, operation: "findMany", model: "Deal" } as any)
    )
    expect(result).toBe("data")
    expect(base.$transaction).toHaveBeenCalledTimes(1)
    const batch = base.$transaction.mock.calls[0][0]
    expect(Array.isArray(batch)).toBe(true)
    expect(batch).toHaveLength(2)
    expect(base.$executeRaw).toHaveBeenCalledTimes(1) // the set_config statement
  })

  it("bypass context → set_config app.rls_bypass", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    await runWithRlsBypass(() => wrap({ args: {}, query: vi.fn(async () => 1), operation: "count", model: "Deal" } as any))
    const tpl = base.$executeRaw.mock.calls[0][0]
    expect(String(tpl.join?.("") ?? tpl)).toContain("app.rls_bypass")
  })

  it("inTx context → passes through (no nested transaction)", async () => {
    const base = makeStubBase()
    const wrap = __rlsPerOpWrap(base as any)
    const query = vi.fn(async () => "inner")
    const result = await rlsStorage.run({ orgId: "org-a", inTx: true }, () =>
      wrap({ args: {}, query, operation: "findMany", model: "Deal" } as any)
    )
    expect(result).toBe("inner")
    expect(base.$transaction).not.toHaveBeenCalled()
  })
})

describe("rls $transaction override", () => {
  it("no context → delegates verbatim (arg + opts)", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    const fn = async () => "x"
    await $transaction(fn, { timeout: 5000 })
    expect(base.$transaction).toHaveBeenCalledWith(fn, { timeout: 5000 })
  })

  it("interactive form: injects set_config first, runs callback under inTx, preserves opts", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    let seenCtx: any
    const result = await runWithTenant("org-a", () =>
      $transaction(async (tx: any) => {
        seenCtx = rlsStorage.getStore()
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1) // set_config ran on the tx FIRST
        return "done"
      }, { isolationLevel: "Serializable" })
    )
    expect(result).toBe("done")
    expect(seenCtx).toEqual({ orgId: "org-a", inTx: true })
    expect(base.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" })
  })

  it("batch form: prepends set_config, slices it off the results", async () => {
    const base = makeStubBase()
    const $transaction = __wrapTransaction(base as any, base as any)
    const result = await runWithTenant("org-a", () => $transaction([Promise.resolve("r1"), Promise.resolve("r2")]))
    expect(result).toEqual(["r1", "r2"]) // set_config result hidden from caller
    const batch = base.$transaction.mock.calls[0][0]
    expect(batch).toHaveLength(3)
  })
})
