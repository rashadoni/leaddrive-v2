/**
 * T8 Cobrowse — channel manager tests.
 *
 * Pure pub-sub. Invariants pinned here:
 *   1) publish from agent → only customer listener fires (no echo)
 *   2) publish from customer → only agent listener fires
 *   3) publish before recipient subscribed returns false (no buffering)
 *   4) unsubscribe drops the listener WITHOUT wiping a fresh
 *      reconnect that replaced it
 *   5) channel entry is GC'd when both sides unsubscribe
 *   6) listener throw doesn't cascade back to the publisher
 *   7) envelope is stamped with `from` + `ts`
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  __resetChannelsForTest,
  getSubscribersInfo,
  publish,
  subscribe,
  type SignalEnvelope,
} from "@/lib/cobrowse/channels"

beforeEach(() => {
  __resetChannelsForTest()
})

describe("subscribe + getSubscribersInfo", () => {
  it("starts with no subscribers", () => {
    expect(getSubscribersInfo("s1")).toEqual({ agent: false, customer: false })
  })

  it("registers a single agent subscriber", () => {
    subscribe("s1", "agent", vi.fn())
    expect(getSubscribersInfo("s1")).toEqual({ agent: true, customer: false })
  })

  it("registers both agent and customer subscribers", () => {
    subscribe("s1", "agent", vi.fn())
    subscribe("s1", "customer", vi.fn())
    expect(getSubscribersInfo("s1")).toEqual({ agent: true, customer: true })
  })

  it("scopes subscriptions per sessionId", () => {
    subscribe("s1", "agent", vi.fn())
    subscribe("s2", "customer", vi.fn())
    expect(getSubscribersInfo("s1")).toEqual({ agent: true, customer: false })
    expect(getSubscribersInfo("s2")).toEqual({ agent: false, customer: true })
  })
})

describe("publish — routing", () => {
  it("delivers agent → customer", () => {
    const fn = vi.fn()
    subscribe("s1", "customer", fn)
    const delivered = publish("s1", "agent", { kind: "offer", payload: { sdp: "x" } })
    expect(delivered).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    const env: SignalEnvelope = fn.mock.calls[0][0]
    expect(env.kind).toBe("offer")
    expect(env.from).toBe("agent")
    expect(typeof env.ts).toBe("number")
    expect(env.payload).toEqual({ sdp: "x" })
  })

  it("delivers customer → agent", () => {
    const fn = vi.fn()
    subscribe("s1", "agent", fn)
    publish("s1", "customer", { kind: "answer", payload: { sdp: "y" } })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0].from).toBe("customer")
  })

  it("does NOT echo back to the publisher's own listener", () => {
    const agentFn = vi.fn()
    const customerFn = vi.fn()
    subscribe("s1", "agent", agentFn)
    subscribe("s1", "customer", customerFn)
    publish("s1", "agent", { kind: "ice", payload: {} })
    expect(customerFn).toHaveBeenCalledTimes(1)
    expect(agentFn).not.toHaveBeenCalled()
  })

  it("returns false when no recipient listener is subscribed", () => {
    subscribe("s1", "agent", vi.fn())
    // Customer hasn't connected yet.
    const delivered = publish("s1", "agent", { kind: "offer", payload: {} })
    expect(delivered).toBe(false)
  })

  it("returns false on unknown sessionId", () => {
    expect(publish("ghost", "agent", { kind: "offer", payload: {} })).toBe(false)
  })

  it("listener throw does NOT propagate back to publisher", () => {
    const throwingFn = vi.fn(() => {
      throw new Error("stream closed")
    })
    subscribe("s1", "customer", throwingFn)
    // Should not throw.
    const delivered = publish("s1", "agent", { kind: "offer", payload: {} })
    expect(delivered).toBe(false)
  })
})

describe("unsubscribe", () => {
  it("removes a single role's listener", () => {
    const unsub = subscribe("s1", "agent", vi.fn())
    expect(getSubscribersInfo("s1").agent).toBe(true)
    unsub()
    expect(getSubscribersInfo("s1").agent).toBe(false)
  })

  it("does NOT wipe a reconnect that REPLACED the listener", () => {
    const firstFn = vi.fn()
    const secondFn = vi.fn()
    const firstUnsub = subscribe("s1", "agent", firstFn)
    // Reconnect — second subscribe replaces firstFn.
    subscribe("s1", "agent", secondFn)
    // First connection's late unsubscribe (its abort handler) fires.
    firstUnsub()
    // Should still have the SECOND listener.
    expect(getSubscribersInfo("s1").agent).toBe(true)
    publish("s1", "customer", { kind: "answer", payload: {} })
    expect(secondFn).toHaveBeenCalledTimes(1)
    expect(firstFn).not.toHaveBeenCalled()
  })

  it("removes the session entry when last subscriber unsubscribes (GC)", () => {
    const unsubA = subscribe("s1", "agent", vi.fn())
    const unsubC = subscribe("s1", "customer", vi.fn())
    unsubA()
    expect(getSubscribersInfo("s1")).toEqual({ agent: false, customer: true })
    unsubC()
    // Both unsubbed — channel should be fully GC'd, not just empty.
    expect(getSubscribersInfo("s1")).toEqual({ agent: false, customer: false })
  })

  it("calling unsubscribe twice is a no-op", () => {
    const unsub = subscribe("s1", "agent", vi.fn())
    unsub()
    expect(() => unsub()).not.toThrow()
  })

  it("calling unsubscribe on an unknown session is a no-op", () => {
    const fn = vi.fn()
    // Manually construct an unsubscribe by subscribing then resetting state.
    const unsub = subscribe("s1", "agent", fn)
    __resetChannelsForTest()
    expect(() => unsub()).not.toThrow()
  })
})

describe("envelope shape", () => {
  it("stamps ts at publish time (>= now - 1s)", () => {
    const fn = vi.fn()
    subscribe("s1", "customer", fn)
    const before = Date.now()
    publish("s1", "agent", { kind: "offer", payload: {} })
    const env: SignalEnvelope = fn.mock.calls[0][0]
    expect(env.ts).toBeGreaterThanOrEqual(before)
    expect(env.ts).toBeLessThanOrEqual(Date.now())
  })

  it("preserves arbitrary payload shape (opaque routing)", () => {
    const fn = vi.fn()
    subscribe("s1", "customer", fn)
    const complex = { sdp: "v=0...", iceCandidates: [{ a: 1 }, { b: 2 }] }
    publish("s1", "agent", { kind: "offer", payload: complex })
    expect(fn.mock.calls[0][0].payload).toEqual(complex)
  })
})
