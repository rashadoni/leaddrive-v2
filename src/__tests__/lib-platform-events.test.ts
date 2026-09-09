/**
 * Tests for N14 Platform Events slice 1 — payload validator + in-memory bus.
 * No DB. No network.
 */
import { describe, expect, it, vi } from "vitest"
import { InMemoryEventBus } from "@/lib/platform-events/event-bus"
import {
  parseFieldSpecs,
  validatePayload,
} from "@/lib/platform-events/payload-validator"
import { MAX_PAYLOAD_BYTES, type BusEvent, type FieldSpec } from "@/lib/platform-events/types"

/* ─── parseFieldSpecs ─────────────────────────────────────────────────── */

describe("N14 — parseFieldSpecs", () => {
  it("accepts a valid spec with mixed types", () => {
    const parsed = parseFieldSpecs([
      { name: "amount", type: "number", required: true },
      { name: "currency", type: "string", required: true, maxLength: 8 },
      { name: "metadata", type: "json", required: false },
    ])
    expect(parsed).toHaveLength(3)
  })

  it("rejects non-array", () => {
    expect(() => parseFieldSpecs("nope")).toThrow(/must be an array/)
  })

  it("rejects empty array", () => {
    expect(() => parseFieldSpecs([])).toThrow(/at least one field/)
  })

  it("rejects duplicate field names", () => {
    expect(() =>
      parseFieldSpecs([
        { name: "x", type: "string", required: true },
        { name: "x", type: "number", required: false },
      ])
    ).toThrow(/duplicate/i)
  })

  it("rejects field with unknown type", () => {
    expect(() =>
      parseFieldSpecs([{ name: "x", type: "embedding", required: true }])
    ).toThrow(/unknown type/i)
  })

  it("rejects field with non-boolean required", () => {
    expect(() =>
      parseFieldSpecs([{ name: "x", type: "string", required: "yes" }])
    ).toThrow(/required must be boolean/)
  })

  it("rejects field with non-identifier name", () => {
    expect(() =>
      parseFieldSpecs([{ name: "1bad-name", type: "string", required: true }])
    ).toThrow(/valid identifier/)
  })

  it("rejects field with non-positive maxLength", () => {
    expect(() =>
      parseFieldSpecs([
        { name: "x", type: "string", required: true, maxLength: 0 },
      ])
    ).toThrow(/positive number/)
  })
})

/* ─── validatePayload ─────────────────────────────────────────────────── */

describe("N14 — validatePayload", () => {
  const specs: FieldSpec[] = [
    { name: "amount", type: "number", required: true },
    { name: "currency", type: "string", required: true, maxLength: 8 },
    { name: "isTest", type: "boolean", required: false },
    { name: "occurredAt", type: "timestamp", required: false },
    { name: "metadata", type: "json", required: false },
  ]

  it("accepts a fully-valid payload + returns normalised object", () => {
    const r = validatePayload(
      { amount: 100, currency: "USD" },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload).toEqual({ amount: 100, currency: "USD" })
  })

  it("rejects missing required field", () => {
    const r = validatePayload({ currency: "USD" }, specs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/missing required field "amount"/)
  })

  it("rejects unknown field (strict schema)", () => {
    const r = validatePayload(
      { amount: 100, currency: "USD", evilField: "x" },
      specs
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/unknown field "evilField"/)
  })

  it("coerces numeric strings to numbers", () => {
    const r = validatePayload({ amount: "12.5", currency: "USD" }, specs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.amount).toBe(12.5)
  })

  it("rejects non-finite numbers", () => {
    const r = validatePayload({ amount: "not a number", currency: "USD" }, specs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/must be a finite number/)
  })

  it("enforces string maxLength", () => {
    const r = validatePayload(
      { amount: 1, currency: "TOO_LONG_CURRENCY" },
      specs
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/exceeds maxLength 8/)
  })

  it("coerces boolean strings", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", isTest: "true" },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.isTest).toBe(true)
  })

  it("rejects non-boolean for boolean field", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", isTest: "maybe" },
      specs
    )
    expect(r.ok).toBe(false)
  })

  it("coerces timestamp from ISO string + epoch ms + Date", () => {
    const iso = "2026-05-17T00:00:00.000Z"
    const a = validatePayload(
      { amount: 1, currency: "USD", occurredAt: iso },
      specs
    )
    const b = validatePayload(
      { amount: 1, currency: "USD", occurredAt: Date.parse(iso) },
      specs
    )
    const c = validatePayload(
      { amount: 1, currency: "USD", occurredAt: new Date(iso) },
      specs
    )
    expect(a.ok && a.payload.occurredAt).toBe(iso)
    expect(b.ok && b.payload.occurredAt).toBe(iso)
    expect(c.ok && c.payload.occurredAt).toBe(iso)
  })

  it("rejects invalid timestamp", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", occurredAt: "banana" },
      specs
    )
    expect(r.ok).toBe(false)
  })

  it("json field accepts nested objects + round-trips through JSON", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", metadata: { nested: [1, 2, { x: "y" }] } },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.metadata).toEqual({ nested: [1, 2, { x: "y" }] })
    }
  })

  it("json field rejects BigInt (not JSON-serialisable)", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", metadata: BigInt(42) },
      specs
    )
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.some(e => e.includes("metadata"))).toBe(true)
  })

  it("rejects non-object payload", () => {
    expect(validatePayload(null, specs).ok).toBe(false)
    expect(validatePayload("string", specs).ok).toBe(false)
    expect(validatePayload([1, 2, 3], specs).ok).toBe(false)
  })

  it("omits absent optional fields from normalised payload", () => {
    const r = validatePayload({ amount: 1, currency: "USD" }, specs)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.payload).sort()).toEqual(["amount", "currency"])
      expect("isTest" in r.payload).toBe(false)
    }
  })

  it("rejects payload exceeding MAX_PAYLOAD_BYTES", () => {
    const big = "x".repeat(MAX_PAYLOAD_BYTES + 100)
    const localSpecs: FieldSpec[] = [
      { name: "data", type: "string", required: true, maxLength: MAX_PAYLOAD_BYTES + 1000 },
    ]
    const r = validatePayload({ data: big }, localSpecs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/exceeds.*bytes/)
  })

  it("explicit null on required field → missing-required error", () => {
    const r = validatePayload({ amount: null, currency: "USD" }, specs)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.some(e => /missing required field "amount"/.test(e))).toBe(true)
  })

  it("explicit null on optional field → omitted from normalised payload (parity with absent)", () => {
    const r = validatePayload(
      { amount: 1, currency: "USD", isTest: null, occurredAt: null },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect("isTest" in r.payload).toBe(false)
      expect("occurredAt" in r.payload).toBe(false)
    }
  })

  it("falsy-but-valid values (0, false, '') survive on present fields", () => {
    // Critical: a naive `if (!value)` drop would lose these. boolean
    // false, number 0, and empty string are all legitimate values.
    const r = validatePayload(
      { amount: 0, currency: "", isTest: false },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.amount).toBe(0)
      expect(r.payload.currency).toBe("")
      expect(r.payload.isTest).toBe(false)
    }
  })

  it("json field silently drops undefined properties (documented JSON behaviour)", () => {
    // RFC 8259: JSON has no `undefined`. JSON.stringify drops them.
    // The validator accepts this without warning — caller-side
    // sanitisation is required if exact field preservation matters.
    // Locked here so a future change can't accidentally start
    // rejecting them.
    const r = validatePayload(
      { amount: 1, currency: "USD", metadata: { a: undefined, b: 1 } },
      specs
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.metadata).toEqual({ b: 1 })
  })

  it("collects multiple errors (not just first)", () => {
    const r = validatePayload(
      { currency: "TOO_LONG_CURRENCY", evilField: 1 },
      specs
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Expect: missing amount, unknown field evilField, maxLength on currency.
      expect(r.errors.length).toBeGreaterThanOrEqual(3)
    }
  })
})

/* ─── InMemoryEventBus ───────────────────────────────────────────────── */

function mkEvent(over: Partial<BusEvent> = {}): BusEvent {
  return {
    id: "evt_1",
    organizationId: "org_1",
    definitionId: "def_1",
    eventName: "OrderPlaced",
    payload: { amount: 100 },
    origin: "manual",
    publishedBy: "user_1",
    publishedAt: new Date(),
    ...over,
  }
}

describe("N14 — InMemoryEventBus", () => {
  it("delivers events to subscribers in the same org", async () => {
    const bus = new InMemoryEventBus()
    const seen: BusEvent[] = []
    bus.subscribe({
      organizationId: "org_1",
      listener: e => { seen.push(e) },
    })
    bus.publish(mkEvent())
    await new Promise(r => setImmediate(r))
    expect(seen).toHaveLength(1)
    expect(seen[0].eventName).toBe("OrderPlaced")
  })

  it("isolates events between orgs (org B does NOT see org A's events)", async () => {
    const bus = new InMemoryEventBus()
    const seenB: BusEvent[] = []
    bus.subscribe({
      organizationId: "org_B",
      listener: e => { seenB.push(e) },
    })
    bus.publish(mkEvent({ organizationId: "org_A" }))
    await new Promise(r => setImmediate(r))
    expect(seenB).toHaveLength(0)
  })

  it("filters by eventName when subscribe specifies it", async () => {
    const bus = new InMemoryEventBus()
    const seen: BusEvent[] = []
    bus.subscribe({
      organizationId: "org_1",
      eventName: "OrderPlaced",
      listener: e => { seen.push(e) },
    })
    bus.publish(mkEvent({ eventName: "OrderPlaced" }))
    bus.publish(mkEvent({ eventName: "UserRegistered" }))
    await new Promise(r => setImmediate(r))
    expect(seen).toHaveLength(1)
    expect(seen[0].eventName).toBe("OrderPlaced")
  })

  it("delivers to ALL events when subscriber omits eventName", async () => {
    const bus = new InMemoryEventBus()
    const seen: BusEvent[] = []
    bus.subscribe({
      organizationId: "org_1",
      listener: e => { seen.push(e) },
    })
    bus.publish(mkEvent({ eventName: "A" }))
    bus.publish(mkEvent({ eventName: "B" }))
    bus.publish(mkEvent({ eventName: "C" }))
    await new Promise(r => setImmediate(r))
    expect(seen.map(e => e.eventName)).toEqual(["A", "B", "C"])
  })

  it("unsubscribe stops delivery", async () => {
    const bus = new InMemoryEventBus()
    const seen: BusEvent[] = []
    const sub = bus.subscribe({
      organizationId: "org_1",
      listener: e => { seen.push(e) },
    })
    bus.publish(mkEvent({ eventName: "first" }))
    await new Promise(r => setImmediate(r))
    sub.unsubscribe()
    bus.publish(mkEvent({ eventName: "second" }))
    await new Promise(r => setImmediate(r))
    expect(seen).toHaveLength(1)
    expect(seen[0].eventName).toBe("first")
  })

  it("one listener throwing does NOT break delivery to other listeners", async () => {
    const bus = new InMemoryEventBus()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const goodSeen: BusEvent[] = []
    bus.subscribe({
      organizationId: "org_1",
      listener: () => { throw new Error("kaboom") },
    })
    bus.subscribe({
      organizationId: "org_1",
      listener: e => { goodSeen.push(e) },
    })
    bus.publish(mkEvent())
    await new Promise(r => setImmediate(r))
    expect(goodSeen).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("multiple subscribers in the same org all receive the event", async () => {
    const bus = new InMemoryEventBus()
    const a: BusEvent[] = []
    const b: BusEvent[] = []
    const c: BusEvent[] = []
    bus.subscribe({ organizationId: "org_1", listener: e => { a.push(e) } })
    bus.subscribe({ organizationId: "org_1", listener: e => { b.push(e) } })
    bus.subscribe({ organizationId: "org_1", listener: e => { c.push(e) } })
    bus.publish(mkEvent())
    await new Promise(r => setImmediate(r))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(c).toHaveLength(1)
  })

  it("async listener doesn't block the publisher (fire-and-forget)", async () => {
    const bus = new InMemoryEventBus()
    let slowDone = false
    bus.subscribe({
      organizationId: "org_1",
      listener: async () => {
        await new Promise(r => setTimeout(r, 50))
        slowDone = true
      },
    })
    const before = Date.now()
    bus.publish(mkEvent())
    const after = Date.now()
    // Publish must return synchronously — well under the 50ms listener delay.
    expect(after - before).toBeLessThan(20)
    expect(slowDone).toBe(false)
  })

  it("subscriptions live until unsubscribe (no auto-expiry in slice 1)", () => {
    const bus = new InMemoryEventBus()
    bus.subscribe({ organizationId: "org_1", listener: () => {} })
    bus.subscribe({ organizationId: "org_2", listener: () => {} })
    expect(bus._size()).toBe(2)
  })
})
