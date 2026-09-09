import { describe, expect, it } from "vitest"
import {
  evaluateSelectiveDiscoveryObservationDay,
  summarizeSelectiveDiscoveryObservationWindow,
  type ObservationDayResult,
  type SelectiveDiscoveryObservationDay,
} from "@/lib/social/selective-discovery-observation"

const ORG = "org-brandprotection"

function baseDay(
  overrides: Partial<SelectiveDiscoveryObservationDay> = {},
): SelectiveDiscoveryObservationDay {
  return {
    observedOrganizationId: ORG,
    utcDay: "2026-07-19",
    collectorRuns: [
      { id: "cr-1", organizationId: ORG, sourceId: "src-tt", status: "success", duplicateCount: 8 },
    ],
    routePlans: [
      {
        id: "rp-discover",
        organizationId: ORG,
        platform: "tiktok",
        capability: "DISCOVER_POSTS",
        primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
        fallbackAdapters: [],
        acquisitionMode: "LICENSED_PROVIDER",
        replyMode: "NO_ACTION",
        status: "ACTIVE",
      },
    ],
    providerRuns: [
      {
        id: "pr-discover",
        organizationId: ORG,
        sourceId: "src-tt",
        routePlanId: "rp-discover",
        platform: "tiktok",
        phase: "DISCOVER_CANDIDATE_POSTS",
        providerKey: "bright-data",
        adapterKey: "bright-data",
        status: "succeeded",
        watermarkAdvanced: true,
      },
    ],
    envelopes: [
      {
        id: "env-1",
        organizationId: ORG,
        sourceId: "src-tt",
        platform: "tiktok",
        contentKind: "VIDEO",
        relevanceStatus: "ACCEPTED",
        externalId: "vid-1",
      },
    ],
    externalReplies: [],
    ...overrides,
  }
}

function verdict(result: ReturnType<typeof evaluateSelectiveDiscoveryObservationDay>, id: string) {
  return result.invariants.find(inv => inv.id === id)
}

describe("selective discovery observation — clean day", () => {
  it("passes every invariant for a well-formed brandprotection day", () => {
    const result = evaluateSelectiveDiscoveryObservationDay(baseDay())
    expect(result.ok).toBe(true)
    expect(result.hasSuccessfulRun).toBe(true)
    expect(result.invariants.every(inv => inv.verdict !== "FAIL")).toBe(true)
    expect(verdict(result, "tenant_isolation")?.verdict).toBe("PASS")
  })

  it("treats a comment-free day's comment invariants as not applicable", () => {
    const result = evaluateSelectiveDiscoveryObservationDay(baseDay())
    expect(verdict(result, "comments_only_for_matched")?.verdict).toBe("NOT_APPLICABLE")
    expect(verdict(result, "no_review_rejected_dispatch")?.verdict).toBe("NOT_APPLICABLE")
  })
})

describe("selective discovery observation — invariant violations", () => {
  it("1. flags cross-tenant rows", () => {
    const day = baseDay()
    day.envelopes[0].organizationId = "org-other"
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(result.ok).toBe(false)
    expect(verdict(result, "tenant_isolation")?.verdict).toBe("FAIL")
    expect(verdict(result, "tenant_isolation")?.offenders).toContain("envelope:env-1")
  })

  it("2. flags un-sourced (arbitrary) provider runs", () => {
    const day = baseDay()
    day.providerRuns[0].sourceId = null
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "no_arbitrary_scanning")?.verdict).toBe("FAIL")
    expect(verdict(result, "no_arbitrary_scanning")?.offenders).toContain("providerRun:pr-discover")
  })

  it("3. flags an Apify adapter outside the approved social read capabilities", () => {
    const day = baseDay()
    day.routePlans[0].capability = "SEND_REPLY"
    day.routePlans[0].fallbackAdapters = ["APIFY_ASYNC"]
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "no_apify_external_routes")?.verdict).toBe("FAIL")
    expect(verdict(result, "no_apify_external_routes")?.offenders).toContain("routePlan:rp-discover")
  })

  it("3b. flags an Apify provider run outside approved TikTok reads", () => {
    const day = baseDay()
    day.providerRuns.push({
      id: "pr-apify",
      organizationId: ORG,
      sourceId: "src-tt",
      routePlanId: "rp-discover",
      platform: "tiktok",
      phase: "SEND_REPLY",
      providerKey: "apify",
      adapterKey: "APIFY_ASYNC",
      status: "succeeded",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "no_apify_external_routes")?.offenders).toContain("providerRun:pr-apify")
  })

  it.each(["facebook", "instagram", "tiktok"])(
    "3c. allows scoped Apify comment extraction for %s",
    (platform) => {
      const day = baseDay()
      day.providerRuns.push({
        id: `pr-${platform}-comments`,
        organizationId: ORG,
        sourceId: "src-tt",
        routePlanId: "rp-discover",
        platform,
        phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
        providerKey: "apify",
        adapterKey: "APIFY_ASYNC",
        status: "succeeded",
      })
      const result = evaluateSelectiveDiscoveryObservationDay(day)
      expect(verdict(result, "no_apify_external_routes")?.offenders)
        .not.toContain(`providerRun:pr-${platform}-comments`)
    },
  )

  it.each(["facebook", "instagram", "tiktok"])(
    "3d. allows Apify discovery for %s",
    (platform) => {
      const day = baseDay()
      day.routePlans.push({
        ...day.routePlans[0],
        id: `rp-${platform}-discover`,
        platform,
        primaryAdapter: "APIFY_ASYNC",
        fallbackAdapters: [],
        acquisitionMode: "APIFY_FALLBACK",
      })
      const result = evaluateSelectiveDiscoveryObservationDay(day)
      expect(verdict(result, "no_apify_external_routes")?.offenders)
        .not.toContain(`routePlan:rp-${platform}-discover`)
    },
  )

  it("3e. does not apply the Apify check when only YouTube routes exist", () => {
    const day = baseDay({
      routePlans: [
        {
          id: "rp-yt",
          organizationId: ORG,
          platform: "youtube",
          capability: "DISCOVER_POSTS",
          primaryAdapter: "YOUTUBE_DATA_API",
          fallbackAdapters: [],
          acquisitionMode: "OFFICIAL_API",
          replyMode: "NO_ACTION",
        },
      ],
      providerRuns: [],
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "no_apify_external_routes")?.verdict).toBe("NOT_APPLICABLE")
  })

  it("4/5. flags a comment run dispatched for a REVIEW parent", () => {
    const day = baseDay()
    day.providerRuns.push({
      id: "pr-comment",
      organizationId: ORG,
      sourceId: "src-tt",
      routePlanId: "rp-discover",
      platform: "tiktok",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      providerKey: "bright-data",
      adapterKey: "bright-data",
      status: "succeeded",
      parentRelevanceStatus: "REVIEW",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "comments_only_for_matched")?.verdict).toBe("FAIL")
    expect(verdict(result, "no_review_rejected_dispatch")?.verdict).toBe("FAIL")
    expect(verdict(result, "no_review_rejected_dispatch")?.offenders).toContain("providerRun:pr-comment")
  })

  it("4. accepts a comment run dispatched for an ACCEPTED parent", () => {
    const day = baseDay()
    day.providerRuns.push({
      id: "pr-comment-ok",
      organizationId: ORG,
      sourceId: "src-tt",
      routePlanId: "rp-discover",
      platform: "tiktok",
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      providerKey: "bright-data",
      adapterKey: "bright-data",
      status: "succeeded",
      parentRelevanceStatus: "ACCEPTED",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "comments_only_for_matched")?.verdict).toBe("PASS")
    expect(verdict(result, "no_review_rejected_dispatch")?.verdict).toBe("PASS")
  })

  it("6. flags a watermark advanced by an incomplete run", () => {
    const day = baseDay()
    day.providerRuns[0].status = "partial"
    day.providerRuns[0].watermarkAdvanced = true
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "dedup_and_watermark")?.verdict).toBe("FAIL")
    expect(verdict(result, "dedup_and_watermark")?.offenders).toContain("watermark:pr-discover")
  })

  it("6b. flags a duplicate accepted publication", () => {
    const day = baseDay()
    day.envelopes.push({
      id: "env-dup",
      organizationId: ORG,
      sourceId: "src-tt",
      platform: "tiktok",
      contentKind: "VIDEO",
      relevanceStatus: "ACCEPTED",
      externalId: "vid-1",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "dedup_and_watermark")?.offenders).toContain("duplicate:env-dup")
  })

  it("7. flags a dispatched external reply", () => {
    const day = baseDay({
      externalReplies: [{ id: "reply-1", organizationId: ORG, platform: "tiktok", status: "sent" }],
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "external_replies_zero")?.verdict).toBe("FAIL")
    expect(verdict(result, "external_replies_zero")?.offenders).toContain("externalReply:reply-1")
  })

  it("7b. flags an active live external reply route", () => {
    const day = baseDay()
    day.routePlans.push({
      id: "rp-reply",
      organizationId: ORG,
      platform: "tiktok",
      capability: "REPLY_EXTERNAL",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: [],
      acquisitionMode: "LICENSED_PROVIDER",
      replyMode: "LIVE",
      status: "ACTIVE",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "external_replies_zero")?.offenders).toContain("routePlan:rp-reply")
  })

  it("7c. tolerates a blocked external reply route", () => {
    const day = baseDay()
    day.routePlans.push({
      id: "rp-reply-blocked",
      organizationId: ORG,
      platform: "tiktok",
      capability: "REPLY_EXTERNAL",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: [],
      acquisitionMode: "LICENSED_PROVIDER",
      replyMode: "LIVE",
      status: "BLOCKED",
    })
    const result = evaluateSelectiveDiscoveryObservationDay(day)
    expect(verdict(result, "external_replies_zero")?.verdict).toBe("PASS")
  })
})

describe("selective discovery observation — window summary", () => {
  function okDay(utcDay: string, ran = true): ObservationDayResult {
    return evaluateSelectiveDiscoveryObservationDay(
      baseDay({
        utcDay,
        collectorRuns: ran
          ? [{ id: `cr-${utcDay}`, organizationId: ORG, sourceId: "src-tt", status: "success" }]
          : [],
      }),
    )
  }

  it("counts a trailing streak of clean, run days", () => {
    const days = ["2026-07-10", "2026-07-11", "2026-07-12"].map(d => okDay(d))
    const summary = summarizeSelectiveDiscoveryObservationWindow(days, { requiredConsecutiveDays: 14 })
    expect(summary.consecutivePassingDays).toBe(3)
    expect(summary.windowSatisfied).toBe(false)
    expect(summary.firstDay).toBe("2026-07-10")
    expect(summary.lastDay).toBe("2026-07-12")
    expect(summary.firstFailingDay).toBeNull()
  })

  it("satisfies the window at exactly 14 consecutive clean run days", () => {
    const days = Array.from({ length: 14 }, (_, i) =>
      okDay(`2026-07-${String(i + 1).padStart(2, "0")}`),
    )
    const summary = summarizeSelectiveDiscoveryObservationWindow(days)
    expect(summary.consecutivePassingDays).toBe(14)
    expect(summary.windowSatisfied).toBe(true)
  })

  it("resets the trailing streak after a failing day and records it", () => {
    const failing = evaluateSelectiveDiscoveryObservationDay(
      baseDay({
        utcDay: "2026-07-11",
        externalReplies: [{ id: "r", organizationId: ORG, platform: "tiktok", status: "sent" }],
      }),
    )
    const days = [okDay("2026-07-10"), failing, okDay("2026-07-12"), okDay("2026-07-13")]
    const summary = summarizeSelectiveDiscoveryObservationWindow(days)
    expect(summary.consecutivePassingDays).toBe(2)
    expect(summary.firstFailingDay).toBe("2026-07-11")
  })

  it("does not count a clean day that had no successful run", () => {
    const days = [okDay("2026-07-10"), okDay("2026-07-11", false)]
    const summary = summarizeSelectiveDiscoveryObservationWindow(days)
    expect(summary.consecutivePassingDays).toBe(0)
    expect(summary.firstFailingDay).toBe("2026-07-11")
  })
})
