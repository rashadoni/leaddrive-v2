import { describe, expect, it } from "vitest"
import {
  AI_ACTION_INTENT_ACTIVE_STATES,
  AI_ACTION_INTENT_STATES,
  AI_ACTION_INTENT_TERMINAL_STATES,
  DEFAULT_AI_ACTION_INTENT_TTL_MS,
  aiActionIntentExpiresAt,
  assertAiActionIntentTransition,
  canTransitionAiActionIntent,
  canonicalizeAiActionIntentJson,
  hashAiActionIntentPayload,
  isActiveAiActionIntentState,
  isAiActionIntentState,
  isTerminalAiActionIntentState,
} from "@/lib/ai/voice/action-intent"

describe("AI voice action-intent foundation", () => {
  it("keeps active and terminal state groups exhaustive and disjoint", () => {
    expect(new Set([
      ...AI_ACTION_INTENT_ACTIVE_STATES,
      ...AI_ACTION_INTENT_TERMINAL_STATES,
    ])).toEqual(new Set(AI_ACTION_INTENT_STATES))

    for (const state of AI_ACTION_INTENT_STATES) {
      expect(isAiActionIntentState(state)).toBe(true)
      expect(isActiveAiActionIntentState(state)).not.toBe(isTerminalAiActionIntentState(state))
    }
    expect(isAiActionIntentState("approved")).toBe(false)
  })

  it("allows only review, explicit execution and terminal lifecycle transitions", () => {
    expect(canTransitionAiActionIntent("collecting", "awaiting_confirmation")).toBe(true)
    expect(canTransitionAiActionIntent("awaiting_confirmation", "collecting")).toBe(true)
    expect(canTransitionAiActionIntent("awaiting_confirmation", "executing")).toBe(true)
    expect(canTransitionAiActionIntent("executing", "succeeded")).toBe(true)
    expect(canTransitionAiActionIntent("executing", "failed")).toBe(true)
    expect(canTransitionAiActionIntent("executing", "stale")).toBe(true)

    expect(canTransitionAiActionIntent("awaiting_confirmation", "succeeded")).toBe(false)
    expect(canTransitionAiActionIntent("collecting", "executing")).toBe(false)
    expect(canTransitionAiActionIntent("succeeded", "executing")).toBe(false)
    expect(() => assertAiActionIntentTransition("failed", "executing"))
      .toThrow("Illegal AI action-intent transition: failed -> executing")
  })

  it("uses a ten-minute default TTL without mutating the input date", () => {
    const now = new Date("2026-09-19T12:00:00.000Z")
    const expiry = aiActionIntentExpiresAt(now)

    expect(DEFAULT_AI_ACTION_INTENT_TTL_MS).toBe(600_000)
    expect(expiry.toISOString()).toBe("2026-09-19T12:10:00.000Z")
    expect(now.toISOString()).toBe("2026-09-19T12:00:00.000Z")
    expect(aiActionIntentExpiresAt(now, 60_000).toISOString())
      .toBe("2026-09-19T12:01:00.000Z")
  })

  it("rejects invalid creation times and TTLs", () => {
    expect(() => aiActionIntentExpiresAt(new Date("invalid"))).toThrow("valid Date")
    expect(() => aiActionIntentExpiresAt(new Date(), 0)).toThrow("positive integer")
    expect(() => aiActionIntentExpiresAt(new Date(), 1.5)).toThrow("positive integer")
  })

  it("canonicalizes nested object keys while preserving array order", () => {
    expect(canonicalizeAiActionIntentJson({
      z: 1,
      nested: { beta: true, alpha: "x" },
      list: [3, 1, 2],
    })).toBe('{"list":[3,1,2],"nested":{"alpha":"x","beta":true},"z":1}')
  })

  it("creates the same digest for semantically identical normalized payloads", () => {
    const first = hashAiActionIntentPayload({
      actionType: "create_lead",
      revision: 1,
      normalizedPayload: {
        lastName: "Mammadov",
        firstName: "Ali",
        phone: "+994501234567",
      },
    })
    const second = hashAiActionIntentPayload({
      actionType: "create_lead",
      revision: 1,
      normalizedPayload: {
        phone: "+994501234567",
        firstName: "Ali",
        lastName: "Mammadov",
      },
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe("29ee6d0ce922cb50e51d961ecc25079a598a9fbd5b9e2397ba25b2460a9c865c")
  })

  it("binds action type and revision into the payload hash", () => {
    const base = {
      actionType: "create_lead",
      revision: 1,
      normalizedPayload: { name: "Ali" },
    }
    expect(hashAiActionIntentPayload(base)).not.toBe(hashAiActionIntentPayload({
      ...base,
      actionType: "create_deal",
    }))
    expect(hashAiActionIntentPayload(base)).not.toBe(hashAiActionIntentPayload({
      ...base,
      revision: 2,
    }))
  })

  it("fails closed for values JSON would silently discard or reinterpret", () => {
    expect(() => canonicalizeAiActionIntentJson({ value: undefined })).toThrow("undefined")
    expect(() => canonicalizeAiActionIntentJson(Number.NaN)).toThrow("non-finite")
    expect(() => canonicalizeAiActionIntentJson(new Date())).toThrow("plain JSON objects")
    expect(() => canonicalizeAiActionIntentJson(1n)).toThrow("unsupported bigint")
  })
})
