/**
 * Tests for N3 Apex-equivalent JS sandbox slice 1 — pure sandbox engine.
 * No DB. Real node:vm executor. Mocked CRM repositories.
 */
import { describe, it, expect, vi } from "vitest"
import {
  buildApiSurface,
  createSandboxLogger,
} from "@/lib/apex/api-surface"
import { runCodeModule } from "@/lib/apex/engine"
import {
  NodeVmExecutor,
  _resetCompileCacheForTesting,
} from "@/lib/apex/node-vm-executor"
import { validateCodeModuleSource } from "@/lib/apex/source-guard"
import type {
  CodeContext,
  ContactRepository,
  DealRepository,
} from "@/lib/apex/types"

function mockDealRepo(): DealRepository {
  return {
    find: vi.fn().mockResolvedValue([
      { id: "d1", name: "Acme", stage: "won", valueAmount: 5000 },
      { id: "d2", name: "Beta", stage: "won", valueAmount: 3000 },
    ]),
    create: vi.fn().mockResolvedValue({ id: "d_new", name: "Created" }),
    update: vi.fn().mockResolvedValue({ id: "d1", name: "Updated" }),
  }
}

function mockContactRepo(): ContactRepository {
  return {
    find: vi.fn().mockResolvedValue([{ id: "c1", fullName: "Alice" }]),
    create: vi.fn().mockResolvedValue({ id: "c_new", fullName: "Bob" }),
    update: vi.fn().mockResolvedValue({ id: "c1", fullName: "Updated" }),
  }
}

const baseContext: CodeContext = {
  organizationId: "org_1",
  userId: "user_1",
  trigger: "manual",
}

/* ─── source guard ───────────────────────────────────────────────────── */

describe("N3 — code module source guard", () => {
  it("allows normal CRM automation code", () => {
    const result = validateCodeModuleSource(`
      exports.handler = async function () {
        const deals = await crm.deals.find({ stage: "won" })
        crm.log("found " + deals.length)
        return { count: deals.length }
      }
    `)
    expect(result.ok).toBe(true)
  })

  it.each([
    [`exports.handler = function () { return eval("1 + 1") }`, /dynamic code generation/],
    [
      `exports.handler = function () { return ({}).constructor.constructor("return process")() }`,
      /constructor escape primitive/,
    ],
    [
      `exports.handler = async function () { return import("node:fs") }`,
      /dynamic import/,
    ],
    [
      `exports.handler = function () { globalThis.leak = 1; return null }`,
      /host runtime access/,
    ],
  ])("rejects sandbox escape source %#", (source, reason) => {
    const result = validateCodeModuleSource(source)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(reason)
  })
})

/* ─── createSandboxLogger ─────────────────────────────────────────────── */

describe("N3 — createSandboxLogger", () => {
  it("captures log lines in order", () => {
    const l = createSandboxLogger(10)
    l.log("first")
    l.log("second")
    expect(l.lines).toEqual(["first", "second"])
  })

  it("coerces non-string values via JSON", () => {
    const l = createSandboxLogger(10)
    l.log({ key: "val" } as unknown as string)
    l.log(42 as unknown as string)
    l.log(true as unknown as string)
    expect(l.lines).toEqual(['{"key":"val"}', "42", "true"])
  })

  it("truncates at maxLines + appends a truncation marker", () => {
    const l = createSandboxLogger(3)
    for (let i = 0; i < 10; i++) l.log(`line ${i}`)
    expect(l.lines).toEqual([
      "line 0",
      "line 1",
      "line 2",
      "[…log output truncated at 3 lines]",
    ])
  })

  it("handles Error values with first stack frame", () => {
    const l = createSandboxLogger(5)
    l.log(new Error("boom") as unknown as string)
    expect(l.lines[0]).toMatch(/^boom/)
  })
})

/* ─── buildApiSurface ─────────────────────────────────────────────────── */

describe("N3 — buildApiSurface", () => {
  it("returns a frozen `crm` object", () => {
    const logger = createSandboxLogger(10)
    const api = buildApiSurface({
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      logger,
      context: baseContext,
    })
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.deals)).toBe(true)
    expect(Object.isFrozen(api.contacts)).toBe(true)
    expect(Object.isFrozen(api.context)).toBe(true)
  })

  it("prevents method reassignment on crm.deals", () => {
    const api = buildApiSurface({
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      logger: createSandboxLogger(10),
      context: baseContext,
    })
    expect(() => {
      ;(api.deals as { find: unknown }).find = () => "hijacked"
    }).toThrow()
  })

  it("forwards context fields read-only", () => {
    const api = buildApiSurface({
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      logger: createSandboxLogger(10),
      context: { ...baseContext, event: { recordId: "r1" } },
    })
    expect(api.context.organizationId).toBe("org_1")
    expect(api.context.event).toEqual({ recordId: "r1" })
    expect(Object.isFrozen(api.context.event)).toBe(true)
  })

  it("api.log routes into the logger buffer", () => {
    const logger = createSandboxLogger(10)
    const api = buildApiSurface({
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      logger,
      context: baseContext,
    })
    api.log("via api")
    expect(logger.lines).toEqual(["via api"])
  })
})

/* ─── NodeVmExecutor (via runCodeModule) ──────────────────────────────── */

describe("N3 — NodeVmExecutor end-to-end", () => {
  it("runs a trivial handler and returns the value", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return { hello: "world" } }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(r.result).toBe('{"hello":"world"}')
    expect(r.errorMessage).toBeNull()
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("captures crm.log output", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          crm.log("step 1")
          crm.log("step 2")
          return 42
        }
      `,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.output).toEqual(["step 1", "step 2"])
    expect(r.result).toBe("42")
  })

  it("supports async handlers (await crm.deals.find)", async () => {
    const deals = mockDealRepo()
    const r = await runCodeModule({
      source: `
        exports.handler = async function () {
          const won = await crm.deals.find({ stage: "won" })
          crm.log("got " + won.length + " deals")
          return { count: won.length, ids: won.map(d => d.id) }
        }
      `,
      context: baseContext,
      deals,
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(deals.find).toHaveBeenCalledWith({ stage: "won" })
    expect(JSON.parse(r.result!)).toEqual({ count: 2, ids: ["d1", "d2"] })
    expect(r.output).toEqual(["got 2 deals"])
  })

  it("supports console.log bridging into the logger", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { console.log("bridged"); return null }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.output).toEqual(["bridged"])
  })

  it("times out a runaway sync loop", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { while (true) {} }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 100,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("timeout")
    expect(r.errorMessage).toMatch(/timed out/i)
  })

  it("times out a never-resolving async handler", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return new Promise(() => {}) }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 100,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("timeout")
  })

  it("captures handler runtime errors with phase + message", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { throw new Error("kaboom") }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("error")
    // V8/vm sometimes prefixes the message with the Error type when
    // bubbling up through `runInContext`; accept either form.
    expect(r.errorMessage).toMatch(/\[handler\] (?:Error: )?kaboom/)
  })

  it("rejects empty source", async () => {
    const r = await runCodeModule({
      source: "   \n   ",
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/Empty source/)
  })

  it("rejects module that doesn't export a handler", async () => {
    const r = await runCodeModule({
      source: `module.exports.notHandler = function () {}`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/did not export a `handler`/)
  })

  it("rejects non-JSON-serialisable return value (circular)", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          const a = {}
          a.self = a
          return a
        }
      `,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/result serialisation|not JSON-serialisable/)
  })

  it("captures syntax errors in module init", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { this is not valid javascript }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("error")
    expect(r.errorMessage).toMatch(/\[compile\]|\[module init\]/)
  })

  it("rejects setTimeout before sandbox execution", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          return new Promise(resolve => setTimeout(() => resolve("late"), 10))
        }
      `,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/timer or event-loop escape/)
  })

  it("rejects process.env access before sandbox execution", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return process.env.SECRET }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/host runtime access/)
  })

  it("rejects require() before sandbox execution", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { const fs = require("fs"); return null }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/host runtime access/)
  })

  it("rejects eval() before sandbox execution", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return eval("1+1") }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/dynamic code generation/)
  })

  it("rejects constructor escape primitives before repository access", async () => {
    const deals = mockDealRepo()
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          return ({}).constructor.constructor("return process")().env
        }
      `,
      context: baseContext,
      deals,
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/constructor escape primitive/)
    expect(deals.find).not.toHaveBeenCalled()
  })

  it("handler can mutate via crm.deals.create", async () => {
    const deals = mockDealRepo()
    const r = await runCodeModule({
      source: `
        exports.handler = async function () {
          const created = await crm.deals.create({ name: "From sandbox" })
          return created
        }
      `,
      context: baseContext,
      deals,
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(deals.create).toHaveBeenCalledWith({ name: "From sandbox" })
  })

  it("propagates repository errors as handler errors", async () => {
    const deals = mockDealRepo()
    ;(deals.find as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("permission denied")
    )
    const r = await runCodeModule({
      source: `exports.handler = async function () { return await crm.deals.find({}) }`,
      context: baseContext,
      deals,
      contacts: mockContactRepo(),
      timeoutMs: 1000,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("error")
    expect(r.errorMessage).toMatch(/permission denied/)
  })

  it("context surface is visible inside the handler", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          return { org: crm.context.organizationId, trigger: crm.context.trigger }
        }
      `,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(JSON.parse(r.result!)).toEqual({ org: "org_1", trigger: "manual" })
  })

  it("uses the compile cache for repeated source (smoke)", async () => {
    _resetCompileCacheForTesting()
    const source = `exports.handler = function () { return 1 }`
    const r1 = await runCodeModule({
      source,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    const r2 = await runCodeModule({
      source, // identical → cache hit
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r1.outcome).toBe("ok")
    expect(r2.outcome).toBe("ok")
    // Both produce same result — cache doesn't corrupt state across runs.
    expect(r1.result).toBe(r2.result)
  })

  it("handler returning explicit undefined → outcome ok + result null", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return undefined }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(r.result).toBeNull()
  })

  it("handler returning BigInt → rejected with TypeError-derived message", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return 12345n }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    // Tighter than /BigInt|serialisation/i — must come through the
    // result-serialisation phase tag so a future serialiser change
    // can't accidentally route it through the wrong code path.
    expect(r.errorMessage).toMatch(/^\[result serialisation\].*BigInt/)
  })

  it("handler returning Symbol → rejected (JSON.stringify yields undefined)", async () => {
    const r = await runCodeModule({
      source: `exports.handler = function () { return Symbol("x") }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("rejected")
    expect(r.errorMessage).toMatch(/not JSON-serialisable/)
  })

  it("nested event payload is deep-frozen — handler can't mutate event.deal.stage", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          let mutated = false
          try {
            crm.context.event.deal.stage = "hijacked"
          } catch (e) { mutated = false }
          return { stage: crm.context.event.deal.stage }
        }
      `,
      context: {
        ...baseContext,
        event: { deal: { id: "d1", stage: "won" } },
      },
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(JSON.parse(r.result!)).toEqual({ stage: "won" })
  })

  it("nested array-in-array is deep-frozen recursively (matrix[0][1] guard)", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          try { crm.context.event.matrix[0][1] = 999 } catch (e) {}
          return crm.context.event.matrix[0]
        }
      `,
      context: {
        ...baseContext,
        event: { matrix: [[1, 2], [3, 4]] },
      },
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(JSON.parse(r.result!)).toEqual([1, 2]) // unchanged
  })

  it("Date inside nested event object keeps identity (not Object.freeze'd as a plain object)", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          const d = crm.context.event.history[0].at
          return { iso: d.toISOString(), isDate: d instanceof Date }
        }
      `,
      context: {
        ...baseContext,
        event: { history: [{ at: new Date("2026-05-17T00:00:00Z"), value: 1 }] },
      },
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(JSON.parse(r.result!)).toEqual({
      iso: "2026-05-17T00:00:00.000Z",
      isDate: true,
    })
  })

  it("Map / Set in event payload is rejected at api-surface build time", async () => {
    // The error fires inside buildApiSurface (before runCodeModule
    // hands control to the executor), so it bubbles up from
    // runCodeModule as an unhandled exception — caller-side data bug.
    await expect(
      runCodeModule({
        source: `exports.handler = function () { return null }`,
        context: {
          ...baseContext,
          event: { tagSet: new Set(["a", "b"]) },
        },
        deals: mockDealRepo(),
        contacts: mockContactRepo(),
        timeoutMs: 500,
        maxLogLines: 50,
      })
    ).rejects.toThrow(/Map\/Set values in crm\.context\.event/)
  })

  it("nested event array is deep-frozen — handler can't push/mutate", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          try { crm.context.event.tags.push("new") } catch (e) {}
          return crm.context.event.tags.length
        }
      `,
      context: {
        ...baseContext,
        event: { tags: ["a", "b"] },
      },
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(r.outcome).toBe("ok")
    expect(JSON.parse(r.result!)).toBe(2) // push was silently dropped
  })

  it("handler can NOT escape via prototype mutation on crm.context", async () => {
    const r = await runCodeModule({
      source: `
        exports.handler = function () {
          try { crm.context.organizationId = "other-tenant" } catch (e) {}
          return crm.context.organizationId
        }
      `,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
    })
    expect(JSON.parse(r.result!)).toBe("org_1")
  })

  it("explicit NodeVmExecutor instance produces identical results", async () => {
    const exec = new NodeVmExecutor()
    const r = await runCodeModule({
      source: `exports.handler = function () { return "via explicit executor" }`,
      context: baseContext,
      deals: mockDealRepo(),
      contacts: mockContactRepo(),
      timeoutMs: 500,
      maxLogLines: 50,
      executor: exec,
    })
    expect(r.outcome).toBe("ok")
    expect(JSON.parse(r.result!)).toBe("via explicit executor")
  })
})
