import { describe, expect, it, vi } from "vitest"

// The adapter module pulls prisma/auth at import time; mock the same boundary
// modules as lib-social-apify-async-adapter.test.ts so the pure decision
// helper can be imported in isolation.
const deps = vi.hoisted(() => ({
  findMatchedKeyword: vi.fn((text: string, terms: string[]) =>
    terms.find(term => text.toLowerCase().includes(term.toLowerCase())) ?? null),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/secure-token", () => ({ decryptToken: vi.fn(), hmacToken: vi.fn() }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: vi.fn(),
}))
vi.mock("@/lib/social/monitoring-settings", () => ({
  DEFAULT_APIFY_SEARCH_ACTORS: {},
  getSocialMonitoringSettings: vi.fn(),
}))
vi.mock("@/lib/social/collector-observation-context", () => ({
  observationContextForCollector: vi.fn(),
  routeExecutionMetadata: vi.fn(() => ({})),
}))

import {
  discoveryReviewDecision,
  DISCOVERY_REVIEW_REASONS,
  parseApifyRelativeTimestamp,
} from "@/lib/social/apify-async-adapter"

const now = new Date("2026-07-12T12:00:00Z")
const window = {
  since: new Date(now.getTime() - 24 * 3_600_000),
  until: now,
}

function decision(overrides: Partial<Parameters<typeof discoveryReviewDecision>[0]> = {}) {
  return discoveryReviewDecision({
    phase: "DISCOVER_CANDIDATE_POSTS",
    platform: "web",
    webDiscoveryOrganicResult: true,
    publishedAt: new Date(now.getTime() - 3_600_000),
    lookbackWindow: window,
    title: "Acme Robotics recall announced",
    terms: ["acme robotics", "hava"],
    matchedTerm: "acme robotics",
    ...overrides,
  })
}

describe("discoveryReviewDecision", () => {
  it("keeps fresh title-matched organic results accepted", () => {
    expect(decision()).toBeNull()
  })

  it("keeps undated WEB organic results visible for operator review", () => {
    expect(decision({ publishedAt: null })).toEqual({
      relevanceStatus: "REVIEW",
      reason: DISCOVERY_REVIEW_REASONS.missingPublishedAt,
    })
  })

  it("rejects stale organic results, missing date taking precedence", () => {
    expect(decision({ publishedAt: new Date("2025-05-19T00:00:00Z") }))
      .toEqual({
        relevanceStatus: "REJECTED",
        reason: DISCOVERY_REVIEW_REASONS.outsideLookbackWindow,
      })
    expect(decision({ publishedAt: null }))
      .toEqual({
        relevanceStatus: "REVIEW",
        reason: DISCOVERY_REVIEW_REASONS.missingPublishedAt,
      })
  })

  it("treats a boundary timestamp as inside the window", () => {
    expect(decision({ publishedAt: window.since })).toBeNull()
  })

  it("sends snippet-only keyword matches to review, including empty titles", () => {
    // Real prod case: FB video title about one topic, search snippet from an
    // unrelated weather article containing the scenario keyword "hava".
    expect(decision({ title: "Terror təşkilatına qoşulmaqda təqsirləndirilən şəxslər", matchedTerm: "hava" }))
      .toEqual({
        relevanceStatus: "REVIEW",
        reason: DISCOVERY_REVIEW_REASONS.snippetOnlyMatch,
      })
    expect(decision({ title: null, matchedTerm: "hava" }))
      .toEqual({
        relevanceStatus: "REVIEW",
        reason: DISCOVERY_REVIEW_REASONS.snippetOnlyMatch,
      })
  })

  it("never reviews comment-extraction items or native dataset items", () => {
    expect(decision({ phase: "EXTRACT_COMMENTS_FROM_CANDIDATES", publishedAt: null })).toBeNull()
    expect(decision({ webDiscoveryOrganicResult: false, publishedAt: null })).toBeNull()
  })
})

describe("parseApifyRelativeTimestamp", () => {
  const reference = new Date("2026-07-23T10:45:00.000Z")

  it("parses the bounded Google SERP relative-time grammar", () => {
    expect(parseApifyRelativeTimestamp("5 days ago", reference)?.toISOString())
      .toBe("2026-07-18T10:45:00.000Z")
    expect(parseApifyRelativeTimestamp("2 weeks ago", reference)?.toISOString())
      .toBe("2026-07-09T10:45:00.000Z")
    expect(parseApifyRelativeTimestamp("1 month ago", reference)?.toISOString())
      .toBe("2026-06-23T10:45:00.000Z")
    expect(parseApifyRelativeTimestamp("a year ago", reference)?.toISOString())
      .toBe("2025-07-23T10:45:00.000Z")
  })

  it("rejects future-looking, unknown, and unbounded relative dates", () => {
    expect(parseApifyRelativeTimestamp("in 2 days", reference)).toBeNull()
    expect(parseApifyRelativeTimestamp("recently", reference)).toBeNull()
    expect(parseApifyRelativeTimestamp("9999 years ago", reference)).toBeNull()
    expect(parseApifyRelativeTimestamp("2 days ago", new Date("invalid"))).toBeNull()
  })
})
