/**
 * Tests for C12 Multi-channel Campaign Orchestrator slice 1 — 5 pure helpers.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  isChannel,
  resolveChannelChain,
} from "@/lib/multichannel-orchestrator/channel-priority-resolver"
import {
  checkQuietHours,
  nextQuietHoursEnd,
} from "@/lib/multichannel-orchestrator/quiet-hours-checker"
import { checkFrequencyCap } from "@/lib/multichannel-orchestrator/frequency-cap-checker"
import {
  canTransitionPolicyStatus,
  canTransitionRunStatus,
  checkCrossChannelDedup,
  isPolicyStatus,
  isRunStatus,
} from "@/lib/multichannel-orchestrator/cross-channel-dedup"
import {
  CHANNELS,
  DELIVERY_OUTCOMES,
  POLICY_STATUSES,
  POLICY_STATUS_TRANSITIONS,
  RUN_STATUSES,
  RUN_STATUS_TRANSITIONS,
  TRIGGER_SOURCES,
} from "@/lib/multichannel-orchestrator/types"

/* ─── Enum / transition exhaustiveness ─────────────────────────────────── */

describe("C12 — enum + transition map exhaustiveness", () => {
  it("POLICY_STATUS_TRANSITIONS has entry for each status", () => {
    expect(Object.keys(POLICY_STATUS_TRANSITIONS).sort()).toEqual(
      [...POLICY_STATUSES].sort(),
    )
  })
  it("RUN_STATUS_TRANSITIONS has entry for each status", () => {
    expect(Object.keys(RUN_STATUS_TRANSITIONS).sort()).toEqual(
      [...RUN_STATUSES].sort(),
    )
  })
  it("every transition target is a known status", () => {
    for (const t of Object.values(POLICY_STATUS_TRANSITIONS).flat()) {
      expect(POLICY_STATUSES).toContain(t)
    }
    for (const t of Object.values(RUN_STATUS_TRANSITIONS).flat()) {
      expect(RUN_STATUSES).toContain(t)
    }
  })
  it("CHANNELS has 7 kinds", () => {
    expect(CHANNELS).toEqual([
      "email",
      "sms",
      "push",
      "telegram",
      "whatsapp",
      "voice",
      "postal",
    ])
  })
  it("DELIVERY_OUTCOMES has 5 kinds (1 success + 4 suppress reasons)", () => {
    expect(DELIVERY_OUTCOMES).toEqual([
      "attempted",
      "no_channel_available",
      "suppressed_quiet_hours",
      "suppressed_frequency_cap",
      "deduped",
    ])
  })
  it("TRIGGER_SOURCES has 4 kinds", () => {
    expect(TRIGGER_SOURCES).toEqual(["cron", "manual", "api", "webhook"])
  })
})

/* ─── Type guards ──────────────────────────────────────────────────────── */

describe("C12 — type guards", () => {
  it("isChannel", () => {
    expect(isChannel("email")).toBe(true)
    expect(isChannel("postal")).toBe(true)
    expect(isChannel("fax")).toBe(false)
    expect(isChannel(42)).toBe(false)
  })
  it("isPolicyStatus", () => {
    expect(isPolicyStatus("active")).toBe(true)
    expect(isPolicyStatus("xxx")).toBe(false)
  })
  it("isRunStatus", () => {
    expect(isRunStatus("pending")).toBe(true)
    expect(isRunStatus("queued")).toBe(false)
  })
})

/* ─── State machines ───────────────────────────────────────────────────── */

describe("C12 — policy state machine", () => {
  it("draft → active | archived", () => {
    expect(canTransitionPolicyStatus("draft", "active")).toBe(true)
    expect(canTransitionPolicyStatus("draft", "archived")).toBe(true)
  })
  it("active → archived only", () => {
    expect(canTransitionPolicyStatus("active", "archived")).toBe(true)
    expect(canTransitionPolicyStatus("active", "draft")).toBe(false)
  })
  it("archived terminal", () => {
    expect(canTransitionPolicyStatus("archived", "active")).toBe(false)
  })
  it("same-status no-op accepted", () => {
    expect(canTransitionPolicyStatus("active", "active")).toBe(true)
  })
})

describe("C12 — run state machine", () => {
  it("pending → running | failed", () => {
    expect(canTransitionRunStatus("pending", "running")).toBe(true)
    expect(canTransitionRunStatus("pending", "failed")).toBe(true)
    expect(canTransitionRunStatus("pending", "succeeded")).toBe(false)
  })
  it("running → succeeded | failed", () => {
    expect(canTransitionRunStatus("running", "succeeded")).toBe(true)
    expect(canTransitionRunStatus("running", "failed")).toBe(true)
    expect(canTransitionRunStatus("running", "pending")).toBe(false)
  })
  it("succeeded + failed terminal", () => {
    expect(canTransitionRunStatus("succeeded", "running")).toBe(false)
    expect(canTransitionRunStatus("failed", "pending")).toBe(false)
  })
})

/* ─── Channel priority resolver ────────────────────────────────────────── */

describe("C12 — resolveChannelChain", () => {
  it("uses policy priority when contact has no preferences", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [],
      policyPriority: ["email", "sms", "push"],
    })
    expect(result.channels).toEqual(["email", "sms", "push"])
    expect(result.hasAnyOptIn).toBe(true)
  })

  it("contact priority overrides policy", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        { channel: "sms", priority: 1, isOptedIn: true },
        { channel: "email", priority: 2, isOptedIn: true },
      ],
      policyPriority: ["email", "sms"],
    })
    expect(result.channels).toEqual(["sms", "email"])
  })

  it("excludes opted-out channels", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [{ channel: "email", priority: 1, isOptedIn: false }],
      policyPriority: ["email", "sms"],
    })
    expect(result.channels).toEqual(["sms"])
    expect(result.channels).not.toContain("email")
  })

  it("hasAnyOptIn=false when all channels opted out", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        { channel: "email", priority: 1, isOptedIn: false },
        { channel: "sms", priority: 2, isOptedIn: false },
      ],
      policyPriority: ["email", "sms"],
    })
    expect(result.channels).toEqual([])
    expect(result.hasAnyOptIn).toBe(false)
  })

  it("hasAnyOptIn=false on empty policy + empty preferences", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [],
      policyPriority: [],
    })
    expect(result.hasAnyOptIn).toBe(false)
  })

  it("includes channels in preferences not in policy (appended)", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        { channel: "telegram", priority: 1, isOptedIn: true },
      ],
      policyPriority: ["email", "sms"],
    })
    // telegram (contact-prio=1) leads, then policy order
    expect(result.channels[0]).toBe("telegram")
    expect(result.channels).toContain("email")
    expect(result.channels).toContain("sms")
  })

  it("channels with NULL contact priority fall back to policy order", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        { channel: "email", priority: null, isOptedIn: true },
      ],
      policyPriority: ["sms", "email", "push"],
    })
    // email has no contact prio → falls back to policy index (= 1).
    // sms (policy index 0) leads.
    expect(result.channels[0]).toBe("sms")
  })

  it("filters unknown channel values defensively", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { channel: "fax" as any, priority: 1, isOptedIn: true },
        { channel: "email", priority: 2, isOptedIn: true },
      ],
      policyPriority: ["email"],
    })
    expect(result.channels).toEqual(["email"])
  })

  it("contact-set priorities sort before NULL-priority channels", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [
        // sms: NULL contact prio (policy decides) — policy index 0 = first
        { channel: "sms", priority: null, isOptedIn: true },
        // email: explicit contact prio 1 — should still lead despite sms
        // being first in policy, because contact pri is "set"
        { channel: "email", priority: 1, isOptedIn: true },
      ],
      policyPriority: ["sms", "email"],
    })
    expect(result.channels).toEqual(["email", "sms"])
  })

  it("dedup of policy + preferences (same channel appears once)", () => {
    const result = resolveChannelChain({
      contactId: "c1",
      preferences: [{ channel: "email", priority: 1, isOptedIn: true }],
      policyPriority: ["email", "email", "sms"],
    })
    const emailCount = result.channels.filter((c) => c === "email").length
    expect(emailCount).toBe(1)
  })
})

/* ─── Quiet hours checker ──────────────────────────────────────────────── */

describe("C12 — checkQuietHours", () => {
  it("empty windows → not in quiet hours", () => {
    const result = checkQuietHours({
      config: { windows: [] },
      asOf: new Date(),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("missing windows array → not in quiet hours", () => {
    const result = checkQuietHours({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: {} as any,
      asOf: new Date(),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("in-day window matches at noon", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "11:00", to: "13:00" }],
      },
      // 2026-05-19T12:00:00Z → 12:00 UTC, Tuesday
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(result.inQuietHours).toBe(true)
    expect(result.matchedWindow?.from).toBe("11:00")
  })

  it("in-day window excludes at boundary 'to' (exclusive)", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "11:00", to: "13:00" }],
      },
      asOf: new Date("2026-05-19T13:00:00Z"),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("in-day window includes at boundary 'from' (inclusive)", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "11:00", to: "13:00" }],
      },
      asOf: new Date("2026-05-19T11:00:00Z"),
    })
    expect(result.inQuietHours).toBe(true)
  })

  it("wrap-around window: 21:00 → 08:00 matches at 23:00", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
      },
      asOf: new Date("2026-05-19T23:00:00Z"),
    })
    expect(result.inQuietHours).toBe(true)
  })

  it("wrap-around window matches at 03:00 (other side of midnight)", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
      },
      asOf: new Date("2026-05-19T03:00:00Z"),
    })
    expect(result.inQuietHours).toBe(true)
  })

  it("wrap-around excludes at 10:00 (between 'to' and 'from')", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
      },
      asOf: new Date("2026-05-19T10:00:00Z"),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("dayOfWeek constraint: integer matches only that day", () => {
    // 2026-05-19T12:00:00Z = Tuesday (getUTCDay() = 2)
    const tuesdayMatch = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: 2, from: "11:00", to: "13:00" }],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(tuesdayMatch.inQuietHours).toBe(true)

    const mondayMiss = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: 1, from: "11:00", to: "13:00" }],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(mondayMiss.inQuietHours).toBe(false)
  })

  it("empty window (from == to) → no match", () => {
    const result = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "12:00", to: "12:00" }],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("invalid time string → window ignored", () => {
    const result = checkQuietHours({
      config: {
        windows: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { dayOfWeek: "any", from: "25:00" as any, to: "13:00" },
          { dayOfWeek: "any", from: "11:00", to: "13:00" },
        ],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(result.inQuietHours).toBe(true) // second window matches
  })

  it("invalid dayOfWeek (>6) → window ignored", () => {
    const result = checkQuietHours({
      config: {
        windows: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { dayOfWeek: 7 as any, from: "11:00", to: "13:00" },
        ],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(result.inQuietHours).toBe(false)
  })

  it("first-matching-window wins", () => {
    const result = checkQuietHours({
      config: {
        windows: [
          { dayOfWeek: "any", from: "11:00", to: "13:00" },
          { dayOfWeek: "any", from: "08:00", to: "20:00" },
        ],
      },
      asOf: new Date("2026-05-19T12:00:00Z"),
    })
    expect(result.matchedWindow?.from).toBe("11:00")
  })

  it("nextQuietHoursEnd is a slice-1 stub returning null (locks contract)", () => {
    // When slice-2 implements the real next-end-of-window calculation,
    // this test fails — that's the signal to update the test alongside
    // the implementation. Per architect pass-2 suggestion.
    expect(
      nextQuietHoursEnd({
        config: {
          windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
        },
        asOf: new Date("2026-05-19T22:00:00Z"),
      }),
    ).toBeNull()
  })
})

/* ─── Frequency cap checker ────────────────────────────────────────────── */

describe("C12 — checkFrequencyCap", () => {
  const asOf = new Date("2026-05-19T12:00:00Z")
  const hoursAgo = (h: number) =>
    new Date(asOf.getTime() - h * 60 * 60 * 1000)

  it("empty config → allowed", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [],
      asOf,
      config: {},
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(true)
    expect(result.capsHit).toEqual([])
  })

  it("overall maxPerDay enforced", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(1) },
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(2) },
        { channel: "sms", countTowardCaps: true, decidedAt: hoursAgo(3) },
      ],
      asOf,
      config: { overall: { maxPerDay: 3 } },
      candidateChannel: "email",
    })
    // 3 prior + 1 candidate = 4, cap is 3 → blocked.
    expect(result.allowed).toBe(false)
    expect(result.capsHit).toContain("overall:perDay 4/3")
  })

  it("overall maxPerDay allows N-1 prior", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(1) },
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(2) },
      ],
      asOf,
      config: { overall: { maxPerDay: 3 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(true)
  })

  it("per-channel cap enforced for matching channel only", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "sms", countTowardCaps: true, decidedAt: hoursAgo(1) },
      ],
      asOf,
      config: {
        perChannel: [
          { channel: "sms", maxPerDay: 1 },
          { channel: "email", maxPerDay: 5 },
        ],
      },
      candidateChannel: "sms",
    })
    expect(result.allowed).toBe(false)
    expect(result.capsHit).toContain("sms:perDay 2/1")
  })

  it("per-channel cap for different channel doesn't block candidate", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "sms", countTowardCaps: true, decidedAt: hoursAgo(1) },
      ],
      asOf,
      config: {
        perChannel: [{ channel: "sms", maxPerDay: 1 }],
      },
      candidateChannel: "email", // different channel
    })
    expect(result.allowed).toBe(true)
  })

  it("non-counting deliveries are ignored", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        // 3 deliveries with countTowardCaps=false (suppressed)
        { channel: "email", countTowardCaps: false, decidedAt: hoursAgo(1) },
        { channel: "email", countTowardCaps: false, decidedAt: hoursAgo(2) },
        { channel: "email", countTowardCaps: false, decidedAt: hoursAgo(3) },
      ],
      asOf,
      config: { overall: { maxPerDay: 1 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(true)
  })

  it("deliveries older than week-cutoff are ignored", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        {
          channel: "email",
          countTowardCaps: true,
          decidedAt: new Date(asOf.getTime() - 8 * 24 * 60 * 60 * 1000),
        },
      ],
      asOf,
      config: { overall: { maxPerDay: 1, maxPerWeek: 1 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(true)
  })

  it("weekly cap enforced", () => {
    const fourDaysAgo = new Date(asOf.getTime() - 4 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(asOf.getTime() - 5 * 24 * 60 * 60 * 1000)
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: fourDaysAgo },
        { channel: "email", countTowardCaps: true, decidedAt: fiveDaysAgo },
      ],
      asOf,
      config: { overall: { maxPerWeek: 2 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(false)
    expect(result.capsHit).toContain("overall:perWeek 3/2")
  })

  it("null maxPerDay = no cap", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(1) },
      ],
      asOf,
      config: { overall: { maxPerDay: null, maxPerWeek: 100 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(true)
  })

  it("multiple caps hit are all listed", () => {
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(1) },
        { channel: "email", countTowardCaps: true, decidedAt: hoursAgo(2) },
      ],
      asOf,
      config: {
        overall: { maxPerDay: 1 },
        perChannel: [{ channel: "email", maxPerDay: 1 }],
      },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(false)
    expect(result.capsHit.length).toBeGreaterThanOrEqual(2)
  })

  it("per-day cutoff boundary: 24h ago exactly is included", () => {
    // Exactly at cutoff: cutoffDay = asOf - 24h. delivery at cutoffDay
    // should be included (>= comparison).
    const exactly24h = new Date(asOf.getTime() - 24 * 60 * 60 * 1000)
    const result = checkFrequencyCap({
      priorDeliveries: [
        { channel: "email", countTowardCaps: true, decidedAt: exactly24h },
      ],
      asOf,
      config: { overall: { maxPerDay: 1 } },
      candidateChannel: "email",
    })
    expect(result.allowed).toBe(false) // boundary included → 2/1 blocked
  })
})

/* ─── Cross-channel dedup ──────────────────────────────────────────────── */

describe("C12 — checkCrossChannelDedup", () => {
  const asOf = new Date("2026-05-19T12:00:00Z")
  const hoursAgo = (h: number) =>
    new Date(asOf.getTime() - h * 60 * 60 * 1000)

  it("no priors → no dedup", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "email",
    })
    expect(result.shouldDedup).toBe(false)
  })

  it("dedupWindow=0 → never dedup", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(1),
        },
      ],
      asOf,
      dedupWindowSeconds: 0,
      candidateChannel: "sms",
    })
    expect(result.shouldDedup).toBe(false)
  })

  it("cross-channel prior within window → dedup", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(1),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "sms",
    })
    expect(result.shouldDedup).toBe(true)
    expect(result.reason).toContain("cross-channel")
  })

  it("same-channel prior within window → dedup (idempotency)", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(1),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "email",
    })
    expect(result.shouldDedup).toBe(true)
    expect(result.reason).toContain("same channel")
  })

  it("prior outside window → no dedup", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(48),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400, // 24h
      candidateChannel: "sms",
    })
    expect(result.shouldDedup).toBe(false)
  })

  it("non-attempted prior is ignored (didn't reach contact)", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: null,
          outcome: "suppressed_quiet_hours",
          decidedAt: hoursAgo(1),
        },
        {
          selectedChannel: null,
          outcome: "deduped",
          decidedAt: hoursAgo(2),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "email",
    })
    expect(result.shouldDedup).toBe(false)
  })

  it("first-matching prior wins (reason mentions it)", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "telegram",
          outcome: "attempted",
          decidedAt: hoursAgo(1),
        },
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(2),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "sms",
    })
    expect(result.shouldDedup).toBe(true)
    // First in priorDeliveries: telegram → reason mentions telegram
    expect(result.reason).toContain("telegram")
  })

  it("negative dedupWindow defensively treated as 0 (no dedup)", () => {
    const result = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: hoursAgo(1),
        },
      ],
      asOf,
      dedupWindowSeconds: -100,
      candidateChannel: "sms",
    })
    expect(result.shouldDedup).toBe(false)
  })
})

/* ─── End-to-end orchestration sanity ──────────────────────────────────── */

describe("C12 — end-to-end orchestration sanity", () => {
  it("typical decision flow: resolve chain → check quiet hours → check caps → check dedup", () => {
    const asOf = new Date("2026-05-19T14:00:00Z") // afternoon

    // Step 1: resolver
    const chain = resolveChannelChain({
      contactId: "c1",
      preferences: [
        { channel: "email", priority: 1, isOptedIn: true },
        { channel: "sms", priority: 2, isOptedIn: true },
        { channel: "telegram", priority: null, isOptedIn: false },
      ],
      policyPriority: ["email", "sms", "telegram", "push"],
    })
    expect(chain.channels).toEqual(["email", "sms", "push"])
    expect(chain.hasAnyOptIn).toBe(true)

    // Step 2: quiet hours — afternoon, no nighttime windows match
    const quiet = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
      },
      asOf,
    })
    expect(quiet.inQuietHours).toBe(false)

    // Step 3: frequency caps — no priors, easy pass
    const freq = checkFrequencyCap({
      priorDeliveries: [],
      asOf,
      config: { overall: { maxPerDay: 3 } },
      candidateChannel: chain.channels[0],
    })
    expect(freq.allowed).toBe(true)

    // Step 4: dedup — no priors, easy pass
    const dedup = checkCrossChannelDedup({
      priorDeliveries: [],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: chain.channels[0],
    })
    expect(dedup.shouldDedup).toBe(false)
  })

  it("cross-channel dedup: 2nd channel attempt blocked", () => {
    const asOf = new Date("2026-05-19T14:00:00Z")

    // 1st channel (email) already attempted 2 hours ago.
    // Now considering sms as fallback.
    const dedup = checkCrossChannelDedup({
      priorDeliveries: [
        {
          selectedChannel: "email",
          outcome: "attempted",
          decidedAt: new Date(asOf.getTime() - 2 * 60 * 60 * 1000),
        },
      ],
      asOf,
      dedupWindowSeconds: 86400,
      candidateChannel: "sms",
    })
    expect(dedup.shouldDedup).toBe(true)
  })

  it("quiet hours blocks every channel", () => {
    // 23:00 UTC — squarely inside 21:00 → 08:00 window
    const asOf = new Date("2026-05-19T23:00:00Z")
    const quiet = checkQuietHours({
      config: {
        windows: [{ dayOfWeek: "any", from: "21:00", to: "08:00" }],
      },
      asOf,
    })
    expect(quiet.inQuietHours).toBe(true)
    // Orchestrator slice-2 worker records all candidate channels as
    // suppressed_quiet_hours and emits a single deliveries record.
  })
})
