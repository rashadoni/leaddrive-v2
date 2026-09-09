import { describe, expect, it } from "vitest"
import {
  canonicalizeDiscoveryCandidateUrl,
  classifyDiscoveryCandidateUrl,
  DISCOVERY_AUTO_REVIEW_VERSION,
  resolveDiscoveryAutoReview,
  resolveStoredSubjectAcceptanceEvidence,
  type DiscoveryAutoReviewInput,
} from "@/lib/social/discovery-auto-review"

const providerWindow = {
  since: new Date("2026-07-16T12:00:00.000Z"),
  until: new Date("2026-07-23T12:00:00.000Z"),
}

function resolve(overrides: Partial<DiscoveryAutoReviewInput> = {}) {
  return resolveDiscoveryAutoReview({
    reviewReason: "discovery_snippet_only_match",
    url: "https://news.example/articles/baku-electronics-campaign",
    canonicalUrl: null,
    publishedAt: new Date("2026-07-22T10:00:00.000Z"),
    rawPayload: {
      title: "Baku Electronics launches a new campaign",
      snippet: "Search snippet text",
    },
    providerWindow,
    subjectIdentityTerms: ["Baku Electronics"],
    officialHosts: ["bakuelectronics.az"],
    ...overrides,
  })
}

describe("canonicalizeDiscoveryCandidateUrl", () => {
  it("removes tracking data and produces a stable parameter order", () => {
    expect(canonicalizeDiscoveryCandidateUrl(
      "HTTPS://WWW.Example.COM/path/?utm_source=x&b=2&fbclid=secret&a=1#result",
    )).toBe("https://example.com/path?a=1&b=2")
  })

  it("rejects missing, non-http, credentialed, and malformed URLs", () => {
    expect(canonicalizeDiscoveryCandidateUrl(null)).toBeNull()
    expect(canonicalizeDiscoveryCandidateUrl("javascript:alert(1)")).toBeNull()
    expect(canonicalizeDiscoveryCandidateUrl("https://user:secret@example.com/post")).toBeNull()
    expect(canonicalizeDiscoveryCandidateUrl("not a URL")).toBeNull()
  })
})

describe("classifyDiscoveryCandidateUrl", () => {
  it("distinguishes social content from profile and channel roots", () => {
    expect(classifyDiscoveryCandidateUrl("https://facebook.com/bakuelectronics").classification)
      .toBe("PROFILE_OR_CHANNEL")
    expect(classifyDiscoveryCandidateUrl("https://facebook.com/bakuelectronics/posts/123").classification)
      .toBe("CONTENT")
    expect(classifyDiscoveryCandidateUrl("https://youtube.com/@bakuelectronics").classification)
      .toBe("PROFILE_OR_CHANNEL")
    expect(classifyDiscoveryCandidateUrl("https://youtube.com/watch?v=abc").classification)
      .toBe("CONTENT")
  })

  it("classifies known listing pages as evergreen directories", () => {
    expect(classifyDiscoveryCandidateUrl("https://example.com/category/electronics").classification)
      .toBe("EVERGREEN_DIRECTORY")
    expect(classifyDiscoveryCandidateUrl("https://youtube.com/results?search_query=baku").classification)
      .toBe("EVERGREEN_DIRECTORY")
    expect(classifyDiscoveryCandidateUrl("https://example.com/category/electronics/new-product").classification)
      .toBe("CONTENT")
  })

  it("matches exact official hosts and their subdomains without suffix confusion", () => {
    expect(classifyDiscoveryCandidateUrl(
      "https://news.bakuelectronics.az/press/release",
      ["https://www.bakuelectronics.az/about"],
    )).toMatchObject({
      classification: "OFFICIAL_DOMAIN",
      matchedOfficialHost: "bakuelectronics.az",
    })
    expect(classifyDiscoveryCandidateUrl(
      "https://notbakuelectronics.az/post",
      ["bakuelectronics.az"],
    ).classification).toBe("CONTENT")
  })
})

describe("resolveDiscoveryAutoReview", () => {
  it("exports deterministic policy evidence and never directly accepts", () => {
    const decision = resolve()
    expect(decision).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      reason: "discovery_auto_review_fresh_independent_identity",
      evidence: {
        policyVersion: DISCOVERY_AUTO_REVIEW_VERSION,
        freshness: "IN_WINDOW",
        titleIdentityTerms: ["Baku Electronics"],
      },
    })
    expect(decision.action).not.toBe("ACCEPT")
  })

  it("keeps unrelated review reasons under their existing policy", () => {
    expect(resolve({ reviewReason: "thread_context_for_actionable_descendant" })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_unsupported_reason",
    })
  })

  it("rejects official-domain, profile/channel, and evergreen-directory candidates", () => {
    expect(resolve({ url: "https://shop.bakuelectronics.az/news", canonicalUrl: null })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_official_domain",
    })
    expect(resolve({ url: "https://instagram.com/bakuelectronics", canonicalUrl: null })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_profile_or_channel",
    })
    expect(resolve({ url: "https://example.com/tag/baku-electronics", canonicalUrl: null })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_evergreen_directory",
    })
  })

  it("preserves an external distribution URL even when its canonical points to the official site", () => {
    expect(resolve({
      url: "https://independent.example/news/baku-electronics-store",
      canonicalUrl: "https://bakuelectronics.az/releases/store",
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      reason: "discovery_auto_review_fresh_independent_identity",
      evidence: {
        canonicalUrl: "https://independent.example/news/baku-electronics-store",
        urlHost: "independent.example",
        matchedOfficialHost: null,
      },
    })
  })

  it("rejects timestamps before or materially after the provider window", () => {
    expect(resolve({
      reviewReason: "discovery_outside_lookback_window",
      publishedAt: new Date("2026-07-16T11:59:59.999Z"),
    })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_outside_provider_window",
      evidence: { freshness: "OUTSIDE_WINDOW" },
    })
    expect(resolve({
      reviewReason: "discovery_outside_lookback_window",
      publishedAt: new Date("2026-07-23T12:05:00.001Z"),
    })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_outside_provider_window",
    })
  })

  it("treats the lower boundary and five-minute clock skew as fresh", () => {
    expect(resolve({ publishedAt: providerWindow.since }).action).toBe("RELEASE_TO_NORMAL_PIPELINE")
    expect(resolve({ publishedAt: new Date("2026-07-23T12:05:00.000Z") }).action)
      .toBe("RELEASE_TO_NORMAL_PIPELINE")
  })

  it("recovers absolute date evidence from existing raw provider fields", () => {
    expect(resolve({
      reviewReason: "discovery_missing_published_at",
      publishedAt: null,
      rawPayload: {
        title: "Baku Electronics campaign",
        createdAt: "2026-07-20T09:30:00.000Z",
      },
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      evidence: {
        resolvedPublishedAt: "2026-07-20T09:30:00.000Z",
        publishedAtSource: "rawPayload.createdAt",
      },
    })
  })

  it("parses numeric epoch seconds from raw payload", () => {
    expect(resolve({
      reviewReason: "discovery_missing_published_at",
      publishedAt: null,
      rawPayload: {
        title: "Baku Electronics campaign",
        timestamp: Date.parse("2026-07-20T09:30:00.000Z") / 1_000,
      },
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      evidence: {
        resolvedPublishedAt: "2026-07-20T09:30:00.000Z",
        publishedAtSource: "rawPayload.timestamp",
      },
    })
  })

  it("resolves relative dates against provider-window until, not wall-clock time", () => {
    expect(resolve({
      reviewReason: "discovery_missing_published_at",
      url: "https://news.example/posts/bakuelectronics-update",
      canonicalUrl: null,
      publishedAt: null,
      rawPayload: { title: "Retail update", lastUpdated: "2 days ago" },
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      evidence: {
        resolvedPublishedAt: "2026-07-21T12:00:00.000Z",
        publishedAtSource: "rawPayload.lastUpdated",
        titleIdentityTerms: [],
        urlIdentityTerms: ["Baku Electronics"],
      },
    })
    expect(resolve({
      reviewReason: "discovery_missing_published_at",
      publishedAt: null,
      rawPayload: { title: "Baku Electronics campaign", lastUpdated: "2 weeks ago" },
    })).toMatchObject({
      action: "REJECT",
      reason: "discovery_auto_review_outside_provider_window",
    })
  })

  it("keeps missing or unparseable date evidence in review", () => {
    expect(resolve({
      reviewReason: "discovery_missing_published_at",
      publishedAt: null,
      rawPayload: { title: "Baku Electronics campaign", lastUpdated: "recently" },
    })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_missing_publish_date",
      evidence: { freshness: "UNKNOWN", resolvedPublishedAt: null },
    })
  })

  it("does not treat a snippet-only identity match as independent evidence", () => {
    expect(resolve({
      rawPayload: {
        title: "Major summer discounts announced",
        snippet: "Baku Electronics appears only in the search-engine snippet",
      },
      url: "https://news.example/posts/major-summer-discounts",
      canonicalUrl: null,
    })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_insufficient_independent_identity",
      evidence: { titleIdentityTerms: [], urlIdentityTerms: [] },
    })
  })

  it("requires exact title identity rather than substring overlap", () => {
    expect(resolve({
      subjectIdentityTerms: ["Araz"],
      rawPayload: { title: "Parazitlər haqqında yeni məqalə" },
      url: "https://news.example/posts/parazitler",
      canonicalUrl: null,
    })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_insufficient_independent_identity",
    })
    expect(resolve({
      subjectIdentityTerms: ["Araz"],
      rawPayload: { title: "Araz haqqında yeni məqalə" },
      url: "https://news.example/posts/new-article",
      canonicalUrl: null,
    }).action).toBe("RELEASE_TO_NORMAL_PIPELINE")
  })

  it("keeps an invalid provider window or unusable candidate URL in review", () => {
    expect(resolve({
      providerWindow: {
        since: new Date("2026-07-24T00:00:00.000Z"),
        until: new Date("2026-07-23T00:00:00.000Z"),
      },
    })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_invalid_provider_window",
    })
    expect(resolve({ url: "not a URL", canonicalUrl: null })).toMatchObject({
      action: "KEEP_REVIEW",
      reason: "discovery_auto_review_missing_or_invalid_url",
      evidence: { urlClassification: "INVALID" },
    })
  })

  it("prefers the observed provider URL and uses canonical only as a fallback", () => {
    expect(resolve({
      canonicalUrl: "https://news.example/canonical/baku-electronics",
      url: "https://news.example/posts/baku-electronics",
      rawPayload: { title: "Retail update" },
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      evidence: { canonicalUrl: "https://news.example/posts/baku-electronics" },
    })
    expect(resolve({
      canonicalUrl: "https://news.example/canonical/baku-electronics",
      url: "invalid",
      rawPayload: { title: "Retail update" },
    })).toMatchObject({
      action: "RELEASE_TO_NORMAL_PIPELINE",
      evidence: { canonicalUrl: "https://news.example/canonical/baku-electronics" },
    })
  })
})

describe("resolveStoredSubjectAcceptanceEvidence", () => {
  const acceptedDecision = {
    status: "ACCEPTED",
    reason: "subject_alias_match",
    confidence: 0.9,
    matches: [
      {
        subjectId: "subject-1",
        status: "MATCHED",
        reason: "subject_alias_match",
        confidence: 0.9,
      },
    ],
  }

  it("accepts one persisted target MATCHED decision above the confidence boundary", () => {
    expect(resolveStoredSubjectAcceptanceEvidence({
      subjectDecision: acceptedDecision,
      subjectId: "subject-1",
      minConfidence: 0.7,
    })).toEqual({
      decisionStatus: "ACCEPTED",
      decisionConfidence: 0.9,
      targetMatchStatus: "MATCHED",
      targetMatchConfidence: 0.9,
      accepted: true,
    })
  })

  it.each([
    {
      label: "overall decision is not accepted",
      subjectDecision: { ...acceptedDecision, status: "REVIEW" },
    },
    {
      label: "target match is below the confidence boundary",
      subjectDecision: {
        ...acceptedDecision,
        matches: [{ ...acceptedDecision.matches[0], confidence: 0.69 }],
      },
    },
    {
      label: "a different subject was matched",
      subjectDecision: {
        ...acceptedDecision,
        matches: [{ ...acceptedDecision.matches[0], subjectId: "subject-2" }],
      },
    },
    {
      label: "the target match is duplicated",
      subjectDecision: {
        ...acceptedDecision,
        matches: [acceptedDecision.matches[0], acceptedDecision.matches[0]],
      },
    },
    {
      label: "confidence is encoded as an untrusted string",
      subjectDecision: { ...acceptedDecision, confidence: "0.9" },
    },
  ])("fails closed when $label", ({ subjectDecision }) => {
    expect(resolveStoredSubjectAcceptanceEvidence({
      subjectDecision,
      subjectId: "subject-1",
      minConfidence: 0.7,
    }).accepted).toBe(false)
  })

  it("fails closed for an invalid confidence policy boundary", () => {
    expect(resolveStoredSubjectAcceptanceEvidence({
      subjectDecision: acceptedDecision,
      subjectId: "subject-1",
      minConfidence: Number.NaN,
    }).accepted).toBe(false)
  })
})
