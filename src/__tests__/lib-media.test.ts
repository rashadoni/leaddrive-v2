/**
 * Tests for R11 Media Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextCampaign,
  allowedNextContent,
  allowedNextPlacement,
  allowedNextSubscriber,
  isCampaignTerminal,
  isContentTerminal,
  isPlacementTerminal,
  isSubscriberTerminal,
  transitionCampaign,
  transitionContent,
  transitionPlacement,
  transitionSubscriber,
} from "@/lib/media/state-machine"
import { matchAdTargeting } from "@/lib/media/ad-targeting-matcher"
import { aggregateContentMetrics } from "@/lib/media/content-metric-aggregator"
import { aggregateDailyRollups } from "@/lib/media/daily-rollup-aggregator"
import { calculateAdPacing } from "@/lib/media/ad-pacing-calculator"
import {
  CAMPAIGN_GOALS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRANSITIONS,
  CONTENT_KINDS,
  CONTENT_STATUSES,
  CONTENT_TRANSITIONS,
  DEVICE_KINDS,
  EVENT_KINDS,
  MONETIZATION_KINDS,
  PLACEMENT_SLOT_KINDS,
  PLACEMENT_STATUSES,
  PLACEMENT_TRANSITIONS,
  PRICING_MODELS,
  SUBSCRIBER_STATUSES,
  SUBSCRIBER_TRANSITIONS,
  type CampaignStatus,
  type ConsumptionEvent,
  type ContentStatus,
  type PlacementStatus,
  type SubscriberStatus,
} from "@/lib/media/types"

/* ─── Drift guards ───────────────────────────────────────────────────── */

describe("R11 — enum drift guards", () => {
  it("subscriber statuses cardinality is 5", () => {
    expect(SUBSCRIBER_STATUSES).toHaveLength(5)
  })
  it("content statuses cardinality is 5", () => {
    expect(CONTENT_STATUSES).toHaveLength(5)
  })
  it("content kinds cardinality is 6", () => {
    expect(CONTENT_KINDS).toHaveLength(6)
  })
  it("monetization kinds cardinality is 5", () => {
    expect(MONETIZATION_KINDS).toHaveLength(5)
  })
  it("campaign statuses cardinality is 6", () => {
    expect(CAMPAIGN_STATUSES).toHaveLength(6)
  })
  it("campaign goals cardinality is 5", () => {
    expect(CAMPAIGN_GOALS).toHaveLength(5)
  })
  it("placement statuses cardinality is 5", () => {
    expect(PLACEMENT_STATUSES).toHaveLength(5)
  })
  it("placement slot kinds cardinality is 7", () => {
    expect(PLACEMENT_SLOT_KINDS).toHaveLength(7)
  })
  it("pricing models cardinality is 4", () => {
    expect(PRICING_MODELS).toHaveLength(4)
  })
  it("event kinds cardinality is 8", () => {
    expect(EVENT_KINDS).toHaveLength(8)
  })
  it("device kinds cardinality is 6", () => {
    expect(DEVICE_KINDS).toHaveLength(6)
  })

  it("subscriber transition targets all valid", () => {
    for (const s of SUBSCRIBER_STATUSES) {
      for (const t of SUBSCRIBER_TRANSITIONS[s])
        expect(SUBSCRIBER_STATUSES).toContain(t)
    }
  })
  it("content transition targets all valid", () => {
    for (const s of CONTENT_STATUSES) {
      for (const t of CONTENT_TRANSITIONS[s])
        expect(CONTENT_STATUSES).toContain(t)
    }
  })
  it("campaign transition targets all valid", () => {
    for (const s of CAMPAIGN_STATUSES) {
      for (const t of CAMPAIGN_TRANSITIONS[s])
        expect(CAMPAIGN_STATUSES).toContain(t)
    }
  })
  it("placement transition targets all valid", () => {
    for (const s of PLACEMENT_STATUSES) {
      for (const t of PLACEMENT_TRANSITIONS[s])
        expect(PLACEMENT_STATUSES).toContain(t)
    }
  })
})

/* ─── Subscriber state machine ───────────────────────────────────────── */

describe("R11 — subscriber state machine", () => {
  it("trial → active legal", () => {
    expect(transitionSubscriber("trial", "active").ok).toBe(true)
  })
  it("active → paused → active round-trip legal", () => {
    expect(transitionSubscriber("active", "paused").ok).toBe(true)
    expect(transitionSubscriber("paused", "active").ok).toBe(true)
  })
  it("churned → active legal (win-back)", () => {
    expect(transitionSubscriber("churned", "active").ok).toBe(true)
  })
  it("banned terminal", () => {
    expect(isSubscriberTerminal("banned")).toBe(true)
    for (const t of SUBSCRIBER_STATUSES) {
      if (t === "banned") continue
      expect(transitionSubscriber("banned", t).ok).toBe(false)
    }
  })
  it("no-op rejected", () => {
    expect(transitionSubscriber("active", "active").ok).toBe(false)
  })
  it("unknown rejected", () => {
    expect(transitionSubscriber("ghost" as SubscriberStatus, "active").ok).toBe(
      false
    )
    expect(transitionSubscriber(null, "active").ok).toBe(false)
  })
  it("allowedNextSubscriber introspection", () => {
    expect([...allowedNextSubscriber("trial")]).toEqual([
      "active",
      "churned",
      "banned",
    ])
  })
})

/* ─── Content state machine ──────────────────────────────────────────── */

describe("R11 — content state machine", () => {
  it("draft → scheduled → published happy path", () => {
    expect(transitionContent("draft", "scheduled").ok).toBe(true)
    expect(transitionContent("scheduled", "published").ok).toBe(true)
  })
  it("draft → published legal (immediate publish)", () => {
    expect(transitionContent("draft", "published").ok).toBe(true)
  })
  it("published → unpublished → published round-trip", () => {
    expect(transitionContent("published", "unpublished").ok).toBe(true)
    expect(transitionContent("unpublished", "published").ok).toBe(true)
  })
  it("archived terminal", () => {
    expect(isContentTerminal("archived")).toBe(true)
    for (const t of CONTENT_STATUSES) {
      if (t === "archived") continue
      expect(transitionContent("archived", t).ok).toBe(false)
    }
  })
  it("scheduled → draft legal (un-schedule)", () => {
    expect(transitionContent("scheduled", "draft").ok).toBe(true)
  })
  it("draft → archived rejected (must publish first)", () => {
    expect(transitionContent("draft", "archived").ok).toBe(false)
  })

  it("allowedNextContent introspection", () => {
    expect([...allowedNextContent("draft")]).toEqual(["scheduled", "published"])
  })
})

/* ─── Campaign state machine ─────────────────────────────────────────── */

describe("R11 — campaign state machine", () => {
  it("draft → scheduled → running → paused → running → completed", () => {
    expect(transitionCampaign("draft", "scheduled").ok).toBe(true)
    expect(transitionCampaign("scheduled", "running").ok).toBe(true)
    expect(transitionCampaign("running", "paused").ok).toBe(true)
    expect(transitionCampaign("paused", "running").ok).toBe(true)
    expect(transitionCampaign("running", "completed").ok).toBe(true)
  })
  it("can cancel from any non-terminal state", () => {
    for (const s of CAMPAIGN_STATUSES) {
      if (isCampaignTerminal(s)) continue
      expect(transitionCampaign(s, "cancelled").ok).toBe(true)
    }
  })
  it("completed / cancelled terminal", () => {
    expect(isCampaignTerminal("completed")).toBe(true)
    expect(isCampaignTerminal("cancelled")).toBe(true)
  })
  it("draft → running rejected (must schedule first)", () => {
    expect(transitionCampaign("draft", "running").ok).toBe(false)
  })

  it("allowedNextCampaign introspection", () => {
    expect([...allowedNextCampaign("running")]).toEqual([
      "paused",
      "completed",
      "cancelled",
    ])
  })
})

/* ─── Placement state machine ────────────────────────────────────────── */

describe("R11 — placement state machine", () => {
  it("pending → live → paused → live → completed happy", () => {
    expect(transitionPlacement("pending", "live").ok).toBe(true)
    expect(transitionPlacement("live", "paused").ok).toBe(true)
    expect(transitionPlacement("paused", "live").ok).toBe(true)
    expect(transitionPlacement("live", "completed").ok).toBe(true)
  })
  it("completed / cancelled terminal", () => {
    expect(isPlacementTerminal("completed")).toBe(true)
    expect(isPlacementTerminal("cancelled")).toBe(true)
  })
  it("can cancel from pending, live, paused", () => {
    expect(transitionPlacement("pending", "cancelled").ok).toBe(true)
    expect(transitionPlacement("live", "cancelled").ok).toBe(true)
    expect(transitionPlacement("paused", "cancelled").ok).toBe(true)
  })
  it("allowedNextPlacement introspection", () => {
    expect([...allowedNextPlacement("live")]).toEqual([
      "paused",
      "completed",
      "cancelled",
    ])
  })
})

/* ─── Ad targeting matcher ───────────────────────────────────────────── */

describe("R11 — ad targeting matcher", () => {
  const baseSub = { tierSlug: "premium", billingRegion: "US" }
  const baseContent = {
    contentKind: "article" as const,
    genreSlug: "sports",
    languageCode: "en",
    licensedRegions: [] as string[], // global
  }

  it("empty criteria + global content + valid subscriber → matched score 1.0", () => {
    const r = matchAdTargeting({
      criteria: {},
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(true)
      expect(r.match.score).toBe(1)
    }
  })

  it("tier match (premium) succeeds", () => {
    const r = matchAdTargeting({
      criteria: { tiers: ["premium", "premium-plus"] },
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(true)
      expect(r.match.matchedFacets).toContain("tier")
    }
  })

  it("tier mismatch (free) fails", () => {
    const r = matchAdTargeting({
      criteria: { tiers: ["premium"] },
      subscriber: { tierSlug: "free", billingRegion: "US" },
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(false)
      expect(r.match.unmatchedFacets).toContain("tier")
    }
  })

  it("region match (US) succeeds", () => {
    const r = matchAdTargeting({
      criteria: { regions: ["US", "CA"] },
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(true)
  })

  it("genre match against content (sports)", () => {
    const r = matchAdTargeting({
      criteria: { genres: ["sports", "news"] },
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(true)
  })

  it("content-kind constraint (article only)", () => {
    const r = matchAdTargeting({
      criteria: { contentKinds: ["article"] },
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(true)
  })

  it("content-kind mismatch fails", () => {
    const r = matchAdTargeting({
      criteria: { contentKinds: ["video"] },
      subscriber: baseSub,
      content: baseContent, // article
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(false)
  })

  it("licensing geo-restriction fires (US-only content for FR subscriber)", () => {
    const r = matchAdTargeting({
      criteria: {},
      subscriber: { tierSlug: "premium", billingRegion: "FR" },
      content: { ...baseContent, licensedRegions: ["US", "CA"] },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(false)
      expect(r.match.unmatchedFacets).toContain("licensing")
    }
  })

  it("licensing-OK passes (subscriber in licensed region)", () => {
    const r = matchAdTargeting({
      criteria: {},
      subscriber: baseSub, // US
      content: { ...baseContent, licensedRegions: ["US", "CA"] },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(true)
  })

  it("partial match — 2 of 3 facets matched → score 0.667, not matched", () => {
    const r = matchAdTargeting({
      criteria: {
        tiers: ["premium"],
        regions: ["US"],
        genres: ["news"], // mismatch: content is sports
      },
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(false)
      expect(r.match.score).toBeCloseTo(2 / 3, 2)
    }
  })

  it("rejects non-object criteria", () => {
    const r = matchAdTargeting({
      criteria: null as never,
      subscriber: baseSub,
      content: baseContent,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown content kind", () => {
    const r = matchAdTargeting({
      criteria: {},
      subscriber: baseSub,
      content: { ...baseContent, contentKind: "hologram" as never },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array licensedRegions", () => {
    const r = matchAdTargeting({
      criteria: {},
      subscriber: baseSub,
      content: { ...baseContent, licensedRegions: "US" as never },
    })
    expect(r.ok).toBe(false)
  })

  it("subscriber with NULL region against region constraint fails", () => {
    const r = matchAdTargeting({
      criteria: { regions: ["US"] },
      subscriber: { tierSlug: "premium", billingRegion: null },
      content: baseContent,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.match.matched).toBe(false)
  })

  it("licensing failure on run-of-site (empty criteria) → score=0", () => {
    // Lock down the hard-gate branch ordering: empty criteria default
    // would otherwise return score=1.0 (line `activeFacets === 0`),
    // but the !licensingOK check fires first so we get score=0.
    const r = matchAdTargeting({
      criteria: {},
      subscriber: { tierSlug: "premium", billingRegion: "FR" },
      content: {
        contentKind: "article",
        genreSlug: "sports",
        languageCode: "en",
        licensedRegions: ["US", "CA"],
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(false)
      expect(r.match.score).toBe(0)
      expect(r.match.unmatchedFacets).toContain("licensing")
    }
  })

  it("licensing failure forces score=0 even when all criteria match (regression)", () => {
    // Bug guard: previously a campaign with all criteria matched
    // but licensing geo-failed returned score=1.0 + matched=false,
    // which would let a higher-scoring (but non-serveable) ad win
    // a ranker beating lower-scored (serveable) alternatives.
    const r = matchAdTargeting({
      criteria: { tiers: ["premium"], regions: ["US"] }, // both match
      subscriber: { tierSlug: "premium", billingRegion: "US" },
      content: {
        contentKind: "article",
        genreSlug: "sports",
        languageCode: "en",
        // Licensed only in CA — subscriber is in US → licensing fails.
        licensedRegions: ["CA"],
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.match.matched).toBe(false)
      expect(r.match.score).toBe(0)
      expect(r.match.unmatchedFacets).toContain("licensing")
    }
  })
})

/* ─── Content metric aggregator ──────────────────────────────────────── */

describe("R11 — content metric aggregator", () => {
  function event(
    kind: ConsumptionEvent["eventKind"],
    occurredAt: string,
    subscriberId: string | null,
    engagedSeconds?: number
  ): ConsumptionEvent {
    return {
      eventKind: kind,
      occurredAt: new Date(occurredAt),
      subscriberId,
      contentId: "c-1",
      engagedSeconds,
    }
  }

  it("happy path — funnel + uniques + completion rate", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        event("view_start", "2026-05-15T10:00:00Z", "sub-1"),
        event("view_complete", "2026-05-15T10:30:00Z", "sub-1", 1800),
        event("view_start", "2026-05-15T11:00:00Z", "sub-2"),
        event("view_abandon", "2026-05-15T11:05:00Z", "sub-2"),
        event("view_start", "2026-05-15T12:00:00Z", "sub-3"),
        event("view_complete", "2026-05-15T12:45:00Z", "sub-3", 2700),
        event("click", "2026-05-15T13:00:00Z", "sub-1"),
        event("conversion", "2026-05-15T13:05:00Z", "sub-1"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.uniqueSubscribers).toBe(3)
      expect(r.metrics.viewStarts).toBe(3)
      expect(r.metrics.viewCompletes).toBe(2)
      expect(r.metrics.viewAbandons).toBe(1)
      expect(r.metrics.completionRate).toBeCloseTo(2 / 3, 5)
      expect(r.metrics.avgEngagedSeconds).toBe(2250) // (1800+2700)/2
      expect(r.metrics.clicks).toBe(1)
      expect(r.metrics.conversions).toBe(1)
    }
  })

  it("events outside window dropped", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        event("view_start", "2026-05-14T23:59:59Z", "sub-1"), // before
        event("view_start", "2026-05-15T12:00:00Z", "sub-2"), // in
        event("view_start", "2026-05-16T00:00:00Z", "sub-3"), // boundary = excluded
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.viewStarts).toBe(1)
      expect(r.metrics.uniqueSubscribers).toBe(1)
    }
  })

  it("zero view_starts → completionRate = null (slice-2: was NaN)", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [event("click", "2026-05-15T10:00:00Z", "sub-1")],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Slice-2: replaced NaN sentinel with null for type-safe
      // null-handling at consumer (`?? defaultRate` works cleanly).
      expect(r.metrics.completionRate).toBeNull()
      // Confirm NaN is gone — defensive check that we didn't leave
      // a Number.NaN escape path.
      expect(Number.isNaN(r.metrics.completionRate as number)).toBe(false)
    }
  })

  it("view_starts > 0 → completionRate is a real number 0..1", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        event("view_start", "2026-05-15T10:00:00Z", "sub-1"),
        event("view_start", "2026-05-15T10:01:00Z", "sub-2"),
        event("view_complete", "2026-05-15T10:30:00Z", "sub-1"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.completionRate).toBe(0.5)
      // Not null when denominator > 0.
      expect(r.metrics.completionRate).not.toBeNull()
    }
  })

  it("completionRate clamped to 1.0 (defensive: viewCompletes > viewStarts shouldn't happen, but guard caps it)", () => {
    // Slice-1 validator should never let viewCompletes > viewStarts
    // reach the aggregator, but a raw-SQL backfill or ETL import
    // could leak the invariant. Clamp keeps the metric well-formed.
    // Construct: 1 view_start + 2 view_complete events on the same
    // subscriber. (Same-subscriber double-completion is a model bug;
    // we don't dedupe it here — that's the ingester's job. Clamp
    // ensures downstream dashboards still see a value in [0, 1].)
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        event("view_start", "2026-05-15T10:00:00Z", "sub-1"),
        event("view_complete", "2026-05-15T10:30:00Z", "sub-1"),
        event("view_complete", "2026-05-15T11:00:00Z", "sub-1"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Raw ratio would be 2/1 = 2.0; clamp caps at 1.0.
      expect(r.metrics.completionRate).toBe(1)
    }
  })

  it("empty events list → all zeros", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.uniqueSubscribers).toBe(0)
      expect(r.metrics.viewStarts).toBe(0)
      expect(r.metrics.avgEngagedSeconds).toBe(0)
    }
  })

  it("anonymous events (null subscriberId) don't count toward unique", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        event("view_start", "2026-05-15T10:00:00Z", null),
        event("view_start", "2026-05-15T11:00:00Z", null),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.uniqueSubscribers).toBe(0)
      expect(r.metrics.viewStarts).toBe(2)
    }
  })

  it("rejects windowEnd ≤ windowStart", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-15T00:00:00Z"),
      events: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite Date in event", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        {
          eventKind: "view_start",
          occurredAt: new Date("invalid"),
          subscriberId: null,
          contentId: "c-1",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown event kind", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        {
          eventKind: "telepathy" as never,
          occurredAt: new Date("2026-05-15T12:00:00Z"),
          subscriberId: null,
          contentId: "c-1",
        },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array events", () => {
    const r = aggregateContentMetrics({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: null as never,
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Ad pacing calculator ───────────────────────────────────────────── */

describe("R11 — ad pacing calculator", () => {
  it("on-pace campaign — 50% elapsed, 50% spent", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 5_000,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"), // 10 days
      asOf: new Date("2026-05-06T00:00:00Z"), // day 5
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pacing.remainingBudget).toBe(5_000)
      expect(r.pacing.remainingDays).toBe(5)
      expect(r.pacing.dailyPaceTarget).toBe(1_000)
      expect(r.pacing.expectedSpendByNow).toBe(5_000)
      expect(r.pacing.isOverPaced).toBe(false)
      expect(r.pacing.isUnderPaced).toBe(false)
    }
  })

  it("over-paced — 20% elapsed, 50% spent", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 5_000,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-03T00:00:00Z"), // day 2 of 10
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pacing.isOverPaced).toBe(true)
      expect(r.pacing.expectedSpendByNow).toBe(2_000)
    }
  })

  it("under-paced — 80% elapsed, 10% spent", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 1_000,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-09T00:00:00Z"), // day 8
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pacing.isUnderPaced).toBe(true)
      expect(r.pacing.dailyPaceTarget).toBe(4_500) // 9000 / 2 remaining days
    }
  })

  it("daily cap clamps pace target", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 0,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-06T00:00:00Z"), // 5 days
      asOf: new Date("2026-05-01T00:00:00Z"), // day 0
      dailyBudgetCap: 1_000, // cap < natural 10000/5 = 2000
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.pacing.dailyPaceTarget).toBe(1_000)
  })

  it("flight ended — remainingDays = 0", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 8_000,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-15T00:00:00Z"), // past end
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pacing.remainingDays).toBe(0)
      // dailyPaceTarget falls back to remainingBudget when no days left
      expect(r.pacing.dailyPaceTarget).toBe(2_000)
    }
  })

  it("asOf before flightStart — elapsed clamped to 0", () => {
    const r = calculateAdPacing({
      totalBudget: 10_000,
      spentAmount: 0,
      flightStartAt: new Date("2026-05-10T00:00:00Z"),
      flightEndAt: new Date("2026-05-20T00:00:00Z"),
      asOf: new Date("2026-05-01T00:00:00Z"), // before start
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pacing.expectedSpendByNow).toBe(0)
      expect(r.pacing.isOverPaced).toBe(false)
    }
  })

  it("rejects spentAmount > totalBudget", () => {
    const r = calculateAdPacing({
      totalBudget: 100,
      spentAmount: 200,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-06T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative totalBudget", () => {
    const r = calculateAdPacing({
      totalBudget: -1,
      spentAmount: 0,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-06T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects flightEnd ≤ flightStart", () => {
    const r = calculateAdPacing({
      totalBudget: 100,
      spentAmount: 0,
      flightStartAt: new Date("2026-05-11T00:00:00Z"),
      flightEndAt: new Date("2026-05-01T00:00:00Z"),
      asOf: new Date("2026-05-06T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite dates", () => {
    const r = calculateAdPacing({
      totalBudget: 100,
      spentAmount: 0,
      flightStartAt: new Date("invalid"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-06T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative dailyBudgetCap", () => {
    const r = calculateAdPacing({
      totalBudget: 100,
      spentAmount: 0,
      flightStartAt: new Date("2026-05-01T00:00:00Z"),
      flightEndAt: new Date("2026-05-11T00:00:00Z"),
      asOf: new Date("2026-05-06T00:00:00Z"),
      dailyBudgetCap: -1,
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Terminal-set drift ─────────────────────────────────────────────── */

describe("R11 — terminal-set drift", () => {
  it("subscriber terminals: { banned }", () => {
    expect(
      [...SUBSCRIBER_STATUSES.filter((s) => isSubscriberTerminal(s))].sort()
    ).toEqual(["banned"])
  })

  it("content terminals: { archived }", () => {
    expect(
      [...CONTENT_STATUSES.filter((s) => isContentTerminal(s))].sort()
    ).toEqual(["archived"])
  })

  it("campaign terminals: { cancelled, completed }", () => {
    expect(
      [...CAMPAIGN_STATUSES.filter((s) => isCampaignTerminal(s))].sort()
    ).toEqual(["cancelled", "completed"])
  })

  it("placement terminals: { cancelled, completed }", () => {
    expect(
      [...PLACEMENT_STATUSES.filter((s) => isPlacementTerminal(s))].sort()
    ).toEqual(["cancelled", "completed"])
  })

  it("active states NOT terminal across all 4 entities", () => {
    expect(isSubscriberTerminal("active" as SubscriberStatus)).toBe(false)
    expect(isContentTerminal("published" as ContentStatus)).toBe(false)
    expect(isCampaignTerminal("running" as CampaignStatus)).toBe(false)
    expect(isPlacementTerminal("live" as PlacementStatus)).toBe(false)
  })
})

/* ─── Daily-rollup aggregator (slice-2) ─────────────────────────────── */

describe("R11 — aggregateDailyRollups (slice-2)", () => {
  function ev(
    kind: ConsumptionEvent["eventKind"],
    iso: string,
    subId: string,
    contentId: string,
  ): ConsumptionEvent {
    return {
      eventKind: kind,
      occurredAt: new Date(iso),
      subscriberId: subId,
      contentId,
    }
  }

  it("buckets events by (contentId, UTC day)", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-17T00:00:00Z"), // 2-day window
      events: [
        ev("view_start", "2026-05-15T10:00:00Z", "sub-1", "content-A"),
        ev("view_complete", "2026-05-15T10:30:00Z", "sub-1", "content-A"),
        ev("view_start", "2026-05-16T08:00:00Z", "sub-2", "content-A"),
        ev("view_start", "2026-05-15T12:00:00Z", "sub-3", "content-B"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 3 buckets: (A, 2026-05-15), (A, 2026-05-16), (B, 2026-05-15)
      expect(r.buckets).toHaveLength(3)
      // Deterministic sort: contentId then day
      expect(r.buckets[0]).toMatchObject({
        contentId: "content-A",
        day: "2026-05-15",
      })
      expect(r.buckets[0].metrics.viewStarts).toBe(1)
      expect(r.buckets[0].metrics.viewCompletes).toBe(1)
      expect(r.buckets[1]).toMatchObject({
        contentId: "content-A",
        day: "2026-05-16",
      })
      expect(r.buckets[1].metrics.viewStarts).toBe(1)
      expect(r.buckets[2]).toMatchObject({
        contentId: "content-B",
        day: "2026-05-15",
      })
    }
  })

  it("dayStart is the UTC midnight of the bucket day", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [ev("view_start", "2026-05-15T23:59:00Z", "sub-1", "X")],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buckets[0].dayStart.toISOString()).toBe("2026-05-15T00:00:00.000Z")
    }
  })

  it("events outside the window are dropped silently", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        ev("view_start", "2026-05-14T23:59:59Z", "sub-1", "X"), // before
        ev("view_start", "2026-05-15T12:00:00Z", "sub-2", "X"), // in
        ev("view_start", "2026-05-16T00:00:00Z", "sub-3", "X"), // boundary excl
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buckets).toHaveLength(1)
      expect(r.buckets[0].metrics.viewStarts).toBe(1)
    }
  })

  it("non-day-aligned windowStart is floored, windowEnd is ceiled", () => {
    // Window 2026-05-15T10:00 → 2026-05-16T08:00. Spans 2 UTC days.
    // Expected: events bucketed into day-2026-05-15 + day-2026-05-16
    // (after ceil to midnight of next day).
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T10:00:00Z"),
      windowEnd: new Date("2026-05-16T08:00:00Z"),
      events: [
        ev("view_start", "2026-05-15T11:00:00Z", "sub-1", "X"),
        ev("view_start", "2026-05-16T07:00:00Z", "sub-2", "X"),
        // After ceil, 2026-05-16T08:00 → 2026-05-17T00:00, so this is still inside.
        ev("view_start", "2026-05-16T20:00:00Z", "sub-3", "X"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buckets).toHaveLength(2) // 2026-05-15 + 2026-05-16
      expect(r.buckets[0].day).toBe("2026-05-15")
      expect(r.buckets[1].day).toBe("2026-05-16")
      expect(r.buckets[1].metrics.viewStarts).toBe(2) // both 07:00 + 20:00
    }
  })

  it("empty event list returns empty buckets array", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.buckets).toEqual([])
  })

  it("rejects windowEnd <= windowStart", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-16T00:00:00Z"),
      windowEnd: new Date("2026-05-15T00:00:00Z"),
      events: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects window spanning > 400 days (runaway-iteration guard)", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2027-06-01T00:00:00Z"), // ~516 days
      events: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("400")
  })

  it("malformed event with NaN occurredAt is skipped without failing the batch", () => {
    const r = aggregateDailyRollups({
      windowStart: new Date("2026-05-15T00:00:00Z"),
      windowEnd: new Date("2026-05-16T00:00:00Z"),
      events: [
        { eventKind: "view_start", occurredAt: new Date("invalid"), subscriberId: "s", contentId: "X" } as never,
        ev("view_start", "2026-05-15T10:00:00Z", "sub-2", "X"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Only the valid event counts.
      expect(r.buckets[0].metrics.viewStarts).toBe(1)
    }
  })
})
