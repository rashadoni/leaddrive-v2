/**
 * Tests for G6 Real-time Event Stream slice 1 — 5 pure helpers + types.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  canTransitionDeadLetterTriage,
  canTransitionStreamStatus,
  canTransitionSubscriptionStatus,
  validatePublishEvent,
} from "@/lib/event-stream/event-validator"
import {
  matchesSubscription,
  resolvePath,
} from "@/lib/event-stream/subscription-filter-matcher"
import {
  applyJitter,
  decideRetry,
} from "@/lib/event-stream/delivery-retry-policy"
import {
  isEventEligibleForDeletion,
  planRetention,
  planRetentionBatch,
} from "@/lib/event-stream/retention-pruner"
import {
  DEAD_LETTER_TRIAGE_STATUSES,
  DEAD_LETTER_TRIAGE_TRANSITIONS,
  DELIVERY_OUTCOMES,
  DELIVERY_TERMINAL_OUTCOMES,
  DEFAULT_RETRY_POLICY,
  STREAM_STATUSES,
  STREAM_STATUS_TRANSITIONS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_TRANSITIONS,
  SUBSCRIPTION_TARGET_TYPES,
  type PayloadSchema,
  type PublishEventInput,
} from "@/lib/event-stream/types"

/* ─── Transition-map exhaustiveness (guards against silent drops) ─────── */

describe("G6 — transition-map keys cover every status", () => {
  it("STREAM_STATUS_TRANSITIONS has an entry for every status", () => {
    const mapKeys = Object.keys(STREAM_STATUS_TRANSITIONS).sort()
    const statuses = [...STREAM_STATUSES].sort()
    expect(mapKeys).toEqual(statuses)
  })

  it("SUBSCRIPTION_STATUS_TRANSITIONS has an entry for every status", () => {
    const mapKeys = Object.keys(SUBSCRIPTION_STATUS_TRANSITIONS).sort()
    const statuses = [...SUBSCRIPTION_STATUSES].sort()
    expect(mapKeys).toEqual(statuses)
  })

  it("DEAD_LETTER_TRIAGE_TRANSITIONS has an entry for every status", () => {
    const mapKeys = Object.keys(DEAD_LETTER_TRIAGE_TRANSITIONS).sort()
    const statuses = [...DEAD_LETTER_TRIAGE_STATUSES].sort()
    expect(mapKeys).toEqual(statuses)
  })

  it("every transition target is itself a known status (no orphan refs)", () => {
    for (const target of Object.values(STREAM_STATUS_TRANSITIONS).flat()) {
      expect(STREAM_STATUSES).toContain(target)
    }
    for (const target of Object.values(SUBSCRIPTION_STATUS_TRANSITIONS).flat()) {
      expect(SUBSCRIPTION_STATUSES).toContain(target)
    }
    for (const target of Object.values(DEAD_LETTER_TRIAGE_TRANSITIONS).flat()) {
      expect(DEAD_LETTER_TRIAGE_STATUSES).toContain(target)
    }
  })
})

/* ─── State-machine: stream ────────────────────────────────────────────── */

describe("G6 — stream state machine", () => {
  it("enumerates the four canonical statuses", () => {
    expect(STREAM_STATUSES).toEqual(["draft", "active", "paused", "archived"])
  })

  it("draft → active | archived", () => {
    expect(canTransitionStreamStatus("draft", "active")).toBe(true)
    expect(canTransitionStreamStatus("draft", "archived")).toBe(true)
    expect(canTransitionStreamStatus("draft", "paused")).toBe(false)
  })

  it("active → paused | archived (not draft)", () => {
    expect(canTransitionStreamStatus("active", "paused")).toBe(true)
    expect(canTransitionStreamStatus("active", "archived")).toBe(true)
    expect(canTransitionStreamStatus("active", "draft")).toBe(false)
  })

  it("paused → active | archived", () => {
    expect(canTransitionStreamStatus("paused", "active")).toBe(true)
    expect(canTransitionStreamStatus("paused", "archived")).toBe(true)
    expect(canTransitionStreamStatus("paused", "draft")).toBe(false)
  })

  it("archived is terminal", () => {
    expect(STREAM_STATUS_TRANSITIONS.archived).toEqual([])
    expect(canTransitionStreamStatus("archived", "active")).toBe(false)
    expect(canTransitionStreamStatus("archived", "paused")).toBe(false)
    expect(canTransitionStreamStatus("archived", "draft")).toBe(false)
  })

  it("permits same → same as a no-op", () => {
    expect(canTransitionStreamStatus("active", "active")).toBe(true)
    expect(canTransitionStreamStatus("archived", "archived")).toBe(true)
  })
})

/* ─── State-machine: subscription ──────────────────────────────────────── */

describe("G6 — subscription state machine", () => {
  it("enumerates the three statuses", () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(["active", "paused", "archived"])
  })

  it("active ↔ paused", () => {
    expect(canTransitionSubscriptionStatus("active", "paused")).toBe(true)
    expect(canTransitionSubscriptionStatus("paused", "active")).toBe(true)
  })

  it("either → archived", () => {
    expect(canTransitionSubscriptionStatus("active", "archived")).toBe(true)
    expect(canTransitionSubscriptionStatus("paused", "archived")).toBe(true)
  })

  it("archived is terminal", () => {
    expect(SUBSCRIPTION_STATUS_TRANSITIONS.archived).toEqual([])
    expect(canTransitionSubscriptionStatus("archived", "active")).toBe(false)
    expect(canTransitionSubscriptionStatus("archived", "paused")).toBe(false)
  })

  it("target types are the four declared kinds", () => {
    expect(SUBSCRIPTION_TARGET_TYPES).toEqual([
      "webhook",
      "internal_queue",
      "workflow",
      "activation",
    ])
  })
})

/* ─── State-machine: dead-letter triage ────────────────────────────────── */

describe("G6 — dead-letter triage state machine", () => {
  it("enumerates four triage statuses", () => {
    expect(DEAD_LETTER_TRIAGE_STATUSES).toEqual([
      "open",
      "replaying",
      "resolved",
      "discarded",
    ])
  })

  it("open → replaying | resolved | discarded", () => {
    expect(canTransitionDeadLetterTriage("open", "replaying")).toBe(true)
    expect(canTransitionDeadLetterTriage("open", "resolved")).toBe(true)
    expect(canTransitionDeadLetterTriage("open", "discarded")).toBe(true)
  })

  it("replaying may return to open (cancel)", () => {
    expect(canTransitionDeadLetterTriage("replaying", "open")).toBe(true)
    expect(canTransitionDeadLetterTriage("replaying", "resolved")).toBe(true)
    expect(canTransitionDeadLetterTriage("replaying", "discarded")).toBe(true)
  })

  it("resolved + discarded are terminal", () => {
    expect(DEAD_LETTER_TRIAGE_TRANSITIONS.resolved).toEqual([])
    expect(DEAD_LETTER_TRIAGE_TRANSITIONS.discarded).toEqual([])
    expect(canTransitionDeadLetterTriage("resolved", "open")).toBe(false)
    expect(canTransitionDeadLetterTriage("discarded", "open")).toBe(false)
  })
})

/* ─── Delivery outcome constants ───────────────────────────────────────── */

describe("G6 — delivery outcome enum", () => {
  it("contains pending + three terminals", () => {
    expect(DELIVERY_OUTCOMES).toEqual([
      "pending",
      "succeeded",
      "failed",
      "exhausted",
    ])
  })

  it("DELIVERY_TERMINAL_OUTCOMES excludes pending", () => {
    expect(DELIVERY_TERMINAL_OUTCOMES).toEqual([
      "succeeded",
      "failed",
      "exhausted",
    ])
    expect(DELIVERY_TERMINAL_OUTCOMES).not.toContain("pending")
  })
})

/* ─── Event validator ──────────────────────────────────────────────────── */

describe("G6 — event-validator: shape", () => {
  const trivialSchema: PayloadSchema = {}

  it("accepts a minimal valid event", () => {
    const input: PublishEventInput = {
      eventType: "deal.stage_changed",
      payload: { dealId: "d_1" },
    }
    expect(validatePublishEvent(input, trivialSchema)).toEqual({ ok: true })
  })

  it("rejects missing eventType", () => {
    const input = {
      eventType: "",
      payload: { x: 1 },
    } as PublishEventInput
    const result = validatePublishEvent(input, trivialSchema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_event_type")
  })

  it("rejects whitespace-only eventType", () => {
    const result = validatePublishEvent(
      { eventType: "   ", payload: {} },
      trivialSchema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_event_type")
  })

  it("rejects array payload", () => {
    const result = validatePublishEvent(
      {
        eventType: "x",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: ([1, 2] as unknown) as Record<string, unknown>,
      },
      trivialSchema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_payload")
  })

  it("rejects null payload", () => {
    const result = validatePublishEvent(
      {
        eventType: "x",
        payload: null as unknown as Record<string, unknown>,
      },
      trivialSchema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_payload")
  })

  it("accepts null idempotencyKey (no dedup)", () => {
    const result = validatePublishEvent(
      { eventType: "x", payload: {}, idempotencyKey: null },
      trivialSchema,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects empty idempotencyKey string", () => {
    const result = validatePublishEvent(
      { eventType: "x", payload: {}, idempotencyKey: "" },
      trivialSchema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_idempotency_key")
  })

  it("rejects oversized idempotencyKey (>200 chars)", () => {
    const result = validatePublishEvent(
      {
        eventType: "x",
        payload: {},
        idempotencyKey: "a".repeat(201),
      },
      trivialSchema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_idempotency_key")
  })

  it("accepts 200-char idempotencyKey boundary", () => {
    const result = validatePublishEvent(
      {
        eventType: "x",
        payload: {},
        idempotencyKey: "a".repeat(200),
      },
      trivialSchema,
    )
    expect(result.ok).toBe(true)
  })
})

describe("G6 — event-validator: required fields", () => {
  const schema: PayloadSchema = {
    required: ["dealId", "amount"],
  }

  it("rejects payload missing required field", () => {
    const result = validatePublishEvent(
      { eventType: "x", payload: { dealId: "d_1" } },
      schema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("missing_required_fields")
      expect(result.fields).toEqual(["amount"])
    }
  })

  it("lists ALL missing fields, not just the first", () => {
    const result = validatePublishEvent(
      { eventType: "x", payload: {} },
      schema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fields).toEqual(["dealId", "amount"])
  })

  it("accepts payload with all required fields", () => {
    const result = validatePublishEvent(
      { eventType: "x", payload: { dealId: "d_1", amount: 100 } },
      schema,
    )
    expect(result.ok).toBe(true)
  })
})

describe("G6 — event-validator: type tags", () => {
  it("string field rejects non-string", () => {
    const schema: PayloadSchema = {
      properties: { name: { type: "string" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { name: 42 } },
      schema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("invalid_field_type")
      expect(result.fields).toEqual(["name"])
    }
  })

  it("number field rejects NaN", () => {
    const schema: PayloadSchema = {
      properties: { amount: { type: "number" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { amount: Number.NaN } },
      schema,
    )
    expect(result.ok).toBe(false)
  })

  it("number field accepts 0 and negative numbers", () => {
    const schema: PayloadSchema = {
      properties: { amount: { type: "number" } },
    }
    expect(
      validatePublishEvent(
        { eventType: "x", payload: { amount: 0 } },
        schema,
      ).ok,
    ).toBe(true)
    expect(
      validatePublishEvent(
        { eventType: "x", payload: { amount: -5 } },
        schema,
      ).ok,
    ).toBe(true)
  })

  it("boolean field rejects number", () => {
    const schema: PayloadSchema = {
      properties: { ok: { type: "boolean" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { ok: 1 } },
      schema,
    )
    expect(result.ok).toBe(false)
  })

  it("object field rejects array (the JS-typeof trap)", () => {
    const schema: PayloadSchema = {
      properties: { data: { type: "object" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { data: [1, 2] } },
      schema,
    )
    expect(result.ok).toBe(false)
  })

  it("object field rejects null", () => {
    const schema: PayloadSchema = {
      properties: { data: { type: "object" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { data: null } },
      schema,
    )
    expect(result.ok).toBe(false)
  })

  it("array field accepts empty array", () => {
    const schema: PayloadSchema = {
      properties: { tags: { type: "array" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { tags: [] } },
      schema,
    )
    expect(result.ok).toBe(true)
  })

  it("null type accepts null only", () => {
    const schema: PayloadSchema = {
      properties: { flag: { type: "null" } },
    }
    expect(
      validatePublishEvent(
        { eventType: "x", payload: { flag: null } },
        schema,
      ).ok,
    ).toBe(true)
    expect(
      validatePublishEvent(
        { eventType: "x", payload: { flag: 0 } },
        schema,
      ).ok,
    ).toBe(false)
  })

  it("skips type check when field absent (non-required)", () => {
    const schema: PayloadSchema = {
      properties: { amount: { type: "number" } },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { other: "ok" } },
      schema,
    )
    expect(result.ok).toBe(true)
  })
})

describe("G6 — event-validator: enums", () => {
  it("rejects out-of-enum value", () => {
    const schema: PayloadSchema = {
      properties: {
        stage: { type: "string", enum: ["won", "lost", "open"] },
      },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { stage: "draft" } },
      schema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_enum_value")
  })

  it("accepts in-enum value", () => {
    const schema: PayloadSchema = {
      properties: {
        stage: { type: "string", enum: ["won", "lost", "open"] },
      },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { stage: "won" } },
      schema,
    )
    expect(result.ok).toBe(true)
  })

  it("type-fail beats enum-fail (type checked first)", () => {
    const schema: PayloadSchema = {
      properties: {
        stage: { type: "string", enum: ["won"] },
      },
    }
    const result = validatePublishEvent(
      { eventType: "x", payload: { stage: 42 } },
      schema,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_field_type")
  })
})

/* ─── Subscription filter matcher ──────────────────────────────────────── */

describe("G6 — subscription-filter-matcher: eventType", () => {
  it("equality filter passes on match", () => {
    expect(
      matchesSubscription(
        { eventType: "deal.won", payload: {} },
        { eventTypeFilter: "deal.won" },
      ),
    ).toBe(true)
  })

  it("equality filter rejects on mismatch", () => {
    expect(
      matchesSubscription(
        { eventType: "deal.lost", payload: {} },
        { eventTypeFilter: "deal.won" },
      ),
    ).toBe(false)
  })

  it("null filter = no constraint", () => {
    expect(
      matchesSubscription(
        { eventType: "deal.won", payload: {} },
        { eventTypeFilter: null },
      ),
    ).toBe(true)
  })

  it("undefined filter = no constraint", () => {
    expect(
      matchesSubscription({ eventType: "deal.won", payload: {} }, {}),
    ).toBe(true)
  })
})

describe("G6 — subscription-filter-matcher: payload predicates", () => {
  it("eq matches nested path", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { deal: { stage: "won" } } },
        { payloadFilter: { "deal.stage": { eq: "won" } } },
      ),
    ).toBe(true)
  })

  it("eq fails on mismatch", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { deal: { stage: "lost" } } },
        { payloadFilter: { "deal.stage": { eq: "won" } } },
      ),
    ).toBe(false)
  })

  it("neq inverts eq", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "lost" } },
        { payloadFilter: { stage: { neq: "won" } } },
      ),
    ).toBe(true)
  })

  it("in / not_in", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "won" } },
        { payloadFilter: { stage: { in: ["won", "open"] } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "lost" } },
        { payloadFilter: { stage: { in: ["won", "open"] } } },
      ),
    ).toBe(false)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "spam" } },
        { payloadFilter: { stage: { not_in: ["won", "open"] } } },
      ),
    ).toBe(true)
  })

  it("gt / lt numeric", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 1500 } },
        { payloadFilter: { amount: { gt: 1000 } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 500 } },
        { payloadFilter: { amount: { gt: 1000 } } },
      ),
    ).toBe(false)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 50 } },
        { payloadFilter: { amount: { lt: 100 } } },
      ),
    ).toBe(true)
  })

  it("gte / lte include boundary", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 1000 } },
        { payloadFilter: { amount: { gte: 1000 } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 1000 } },
        { payloadFilter: { amount: { lte: 1000 } } },
      ),
    ).toBe(true)
  })

  it("gt rejects non-numeric value", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: "1500" } },
        { payloadFilter: { amount: { gt: 1000 } } },
      ),
    ).toBe(false)
  })

  it("contains substring match", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { title: "VIP customer flagged" } },
        { payloadFilter: { title: { contains: "VIP" } } },
      ),
    ).toBe(true)
  })

  it("contains rejects non-string value", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { title: 42 } },
        { payloadFilter: { title: { contains: "4" } } },
      ),
    ).toBe(false)
  })

  it("exists: true requires presence", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { dealId: "d_1" } },
        { payloadFilter: { dealId: { exists: true } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: {} },
        { payloadFilter: { dealId: { exists: true } } },
      ),
    ).toBe(false)
  })

  it("exists: false requires absence", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: {} },
        { payloadFilter: { dealId: { exists: false } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { dealId: "d" } },
        { payloadFilter: { dealId: { exists: false } } },
      ),
    ).toBe(false)
  })

  it("multiple predicates on same path AND together", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 1500 } },
        { payloadFilter: { amount: { gt: 1000, lt: 2000 } } },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { amount: 2500 } },
        { payloadFilter: { amount: { gt: 1000, lt: 2000 } } },
      ),
    ).toBe(false)
  })

  it("multiple paths AND together", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "won", amount: 1500 } },
        {
          payloadFilter: {
            stage: { eq: "won" },
            amount: { gt: 1000 },
          },
        },
      ),
    ).toBe(true)
    expect(
      matchesSubscription(
        { eventType: "x", payload: { stage: "won", amount: 500 } },
        {
          payloadFilter: {
            stage: { eq: "won" },
            amount: { gt: 1000 },
          },
        },
      ),
    ).toBe(false)
  })

  it("eventTypeFilter + payloadFilter both must pass", () => {
    expect(
      matchesSubscription(
        { eventType: "deal.lost", payload: { stage: "won" } },
        {
          eventTypeFilter: "deal.won",
          payloadFilter: { stage: { eq: "won" } },
        },
      ),
    ).toBe(false)
  })

  it("empty payloadFilter object → no payload constraint", () => {
    expect(
      matchesSubscription(
        { eventType: "x", payload: { anything: 1 } },
        { payloadFilter: {} },
      ),
    ).toBe(true)
  })
})

describe("G6 — subscription-filter-matcher: resolvePath", () => {
  it("returns root on empty path", () => {
    const obj = { a: 1 }
    expect(resolvePath(obj, "")).toBe(obj)
  })

  it("resolves nested dot path", () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42)
  })

  it("resolves array index", () => {
    expect(resolvePath({ items: ["x", "y", "z"] }, "items.1")).toBe("y")
  })

  it("returns undefined for missing path", () => {
    expect(resolvePath({ a: 1 }, "b.c")).toBeUndefined()
  })

  it("returns undefined for out-of-range array index", () => {
    expect(resolvePath({ items: ["x"] }, "items.5")).toBeUndefined()
  })

  it("returns undefined when traversing through primitive", () => {
    expect(resolvePath({ a: 42 }, "a.b")).toBeUndefined()
  })

  it("returns undefined when traversing through null", () => {
    expect(resolvePath({ a: null }, "a.b")).toBeUndefined()
  })
})

/* ─── Retry policy ─────────────────────────────────────────────────────── */

describe("G6 — delivery-retry-policy: decideRetry", () => {
  it("first failure → schedules attempt 2 with exponential delay", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      config: { jitter: "none" },
    })
    expect(decision.shouldRetry).toBe(true)
    expect(decision.nextAttemptNumber).toBe(2)
    expect(decision.delayMs).toBe(1000)
    expect(decision.rawDelayMs).toBe(1000)
  })

  it("second failure → 2x base delay (exponent base 2)", () => {
    const decision = decideRetry({
      failedAttemptNumber: 2,
      maxAttempts: 5,
      config: { jitter: "none" },
    })
    expect(decision.shouldRetry).toBe(true)
    expect(decision.nextAttemptNumber).toBe(3)
    expect(decision.delayMs).toBe(2000)
  })

  it("third failure → 4x base", () => {
    const decision = decideRetry({
      failedAttemptNumber: 3,
      maxAttempts: 5,
      config: { jitter: "none" },
    })
    expect(decision.delayMs).toBe(4000)
  })

  it("exhausts on reaching maxAttempts", () => {
    const decision = decideRetry({
      failedAttemptNumber: 5,
      maxAttempts: 5,
    })
    expect(decision.shouldRetry).toBe(false)
    expect(decision.delayMs).toBe(0)
    expect(decision.nextAttemptNumber).toBe(6)
  })

  it("exhausts when failedAttemptNumber > maxAttempts", () => {
    const decision = decideRetry({
      failedAttemptNumber: 7,
      maxAttempts: 5,
    })
    expect(decision.shouldRetry).toBe(false)
  })

  it("respects maxDelayMs cap", () => {
    const decision = decideRetry({
      failedAttemptNumber: 10,
      maxAttempts: 20,
      config: {
        initialDelayMs: 1000,
        exponentBase: 2,
        maxDelayMs: 10_000,
        jitter: "none",
      },
    })
    // raw = 1000 * 2^9 = 512_000 → capped to 10_000
    expect(decision.delayMs).toBe(10_000)
    expect(decision.rawDelayMs).toBe(512_000)
  })

  it("jitter:full with sample 0.5 = half the capped delay", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      jitterSample: 0.5,
      config: { initialDelayMs: 1000, jitter: "full" },
    })
    // jittered = 0.5 * 1000 = 500
    expect(decision.delayMs).toBe(500)
  })

  it("jitter:equal with sample 0 = half delay (minimum)", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      jitterSample: 0,
      config: { initialDelayMs: 1000, jitter: "equal" },
    })
    expect(decision.delayMs).toBe(500)
  })

  it("jitter:equal with sample 1 (clamped to <1) ~= full delay", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      jitterSample: 0.999_999,
      config: { initialDelayMs: 1000, jitter: "equal" },
    })
    // 500 + 0.999... * 500 ≈ 1000
    expect(decision.delayMs).toBeGreaterThanOrEqual(999)
    expect(decision.delayMs).toBeLessThanOrEqual(1000)
  })

  it("uses DEFAULT_RETRY_POLICY when config absent", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
    })
    // equal jitter, sample 0 → 500ms
    expect(decision.delayMs).toBe(500)
  })

  it("clamps negative or non-finite jitterSample to 0", () => {
    const negative = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      jitterSample: -1,
      config: { initialDelayMs: 1000, jitter: "full" },
    })
    expect(negative.delayMs).toBe(0)

    const nan = decideRetry({
      failedAttemptNumber: 1,
      maxAttempts: 5,
      jitterSample: Number.NaN,
      config: { initialDelayMs: 1000, jitter: "full" },
    })
    expect(nan.delayMs).toBe(0)
  })

  it("never returns negative delay", () => {
    for (let i = 1; i <= 10; i++) {
      const decision = decideRetry({
        failedAttemptNumber: i,
        maxAttempts: 20,
        jitterSample: 0,
      })
      expect(decision.delayMs).toBeGreaterThanOrEqual(0)
    }
  })

  it("floor failedAttemptNumber (defensive)", () => {
    const decision = decideRetry({
      failedAttemptNumber: 1.7,
      maxAttempts: 5,
      config: { jitter: "none" },
    })
    // floored to 1 → raw = 1000
    expect(decision.delayMs).toBe(1000)
    expect(decision.nextAttemptNumber).toBe(2)
  })
})

describe("G6 — delivery-retry-policy: applyJitter", () => {
  it("none returns delay unchanged", () => {
    expect(applyJitter(1000, "none", 0.5)).toBe(1000)
  })

  it("full with sample 0 = 0ms", () => {
    expect(applyJitter(1000, "full", 0)).toBe(0)
  })

  it("equal with sample 0 = delay/2", () => {
    expect(applyJitter(1000, "equal", 0)).toBe(500)
  })
})

/* ─── Retention pruner ─────────────────────────────────────────────────── */

describe("G6 — retention-pruner: planRetention", () => {
  const now = new Date("2026-05-19T12:00:00Z")

  it("computes cutoff = now - retentionSeconds", () => {
    const plan = planRetention({
      streamId: "s_1",
      retentionSeconds: 3600,
      now,
    })
    expect(plan.cutoff).toEqual(new Date("2026-05-19T11:00:00Z"))
    expect(plan.streamId).toBe("s_1")
  })

  it("null retention → null cutoff (retain forever)", () => {
    expect(
      planRetention({ streamId: "s", retentionSeconds: null, now }).cutoff,
    ).toBeNull()
  })

  it("zero retention → null cutoff (defensive)", () => {
    expect(
      planRetention({ streamId: "s", retentionSeconds: 0, now }).cutoff,
    ).toBeNull()
  })

  it("negative retention → null cutoff (defensive)", () => {
    expect(
      planRetention({ streamId: "s", retentionSeconds: -10, now }).cutoff,
    ).toBeNull()
  })

  it("non-integer retention → null cutoff (defensive)", () => {
    expect(
      planRetention({ streamId: "s", retentionSeconds: 3.5, now }).cutoff,
    ).toBeNull()
  })

  it("30-day default retention (2_592_000s)", () => {
    const plan = planRetention({
      streamId: "s",
      retentionSeconds: 2_592_000,
      now,
    })
    const expected = new Date(now.getTime() - 30 * 86_400_000)
    expect(plan.cutoff).toEqual(expected)
  })
})

describe("G6 — retention-pruner: planRetentionBatch", () => {
  const now = new Date("2026-05-19T12:00:00Z")

  it("filters out streams with null retention", () => {
    const plans = planRetentionBatch(
      [
        { streamId: "a", retentionSeconds: 3600 },
        { streamId: "b", retentionSeconds: null },
        { streamId: "c", retentionSeconds: 7200 },
      ],
      now,
    )
    expect(plans.map((p) => p.streamId)).toEqual(["a", "c"])
  })

  it("returns empty array when all retain forever", () => {
    const plans = planRetentionBatch(
      [
        { streamId: "a", retentionSeconds: null },
        { streamId: "b", retentionSeconds: 0 },
      ],
      now,
    )
    expect(plans).toEqual([])
  })

  it("all valid streams produce cutoffs", () => {
    const plans = planRetentionBatch(
      [
        { streamId: "a", retentionSeconds: 60 },
        { streamId: "b", retentionSeconds: 120 },
      ],
      now,
    )
    expect(plans.length).toBe(2)
    expect(plans[0].cutoff).toEqual(new Date("2026-05-19T11:59:00Z"))
    expect(plans[1].cutoff).toEqual(new Date("2026-05-19T11:58:00Z"))
  })
})

describe("G6 — retention-pruner: isEventEligibleForDeletion", () => {
  it("event older than cutoff is eligible", () => {
    expect(
      isEventEligibleForDeletion(
        new Date("2026-05-19T10:00:00Z"),
        new Date("2026-05-19T11:00:00Z"),
      ),
    ).toBe(true)
  })

  it("event at cutoff exactly is NOT eligible (strict <)", () => {
    const cutoff = new Date("2026-05-19T11:00:00Z")
    expect(isEventEligibleForDeletion(cutoff, cutoff)).toBe(false)
  })

  it("event newer than cutoff is not eligible", () => {
    expect(
      isEventEligibleForDeletion(
        new Date("2026-05-19T12:00:00Z"),
        new Date("2026-05-19T11:00:00Z"),
      ),
    ).toBe(false)
  })

  it("null cutoff means nothing is eligible (retain forever)", () => {
    expect(
      isEventEligibleForDeletion(new Date("1900-01-01"), null),
    ).toBe(false)
  })
})
