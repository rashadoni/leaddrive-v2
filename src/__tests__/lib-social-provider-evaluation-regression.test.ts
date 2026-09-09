import { describe, expect, it } from "vitest"
import {
  evaluateProviderPromotionRegression,
  evaluateRelevancePromotionRegression,
} from "@/lib/social/provider-evaluation-regression"
import type {
  ProviderComparisonMetrics,
  ProviderComparisonReport,
} from "@/lib/social/provider-comparison"
import type { RelevanceEvaluationReport, RelevanceRates } from "@/lib/social/relevance-evaluator"

const metric = (value = 1) => ({ numerator: value * 100, denominator: 100, value })

function providerMetrics(): ProviderComparisonMetrics {
  return {
    discoveryRecall: metric(),
    discoveryPrecision: metric(),
    enrichmentCompleteness: metric(),
    commentRecall: metric(),
    visibleCommentRecall: metric(),
    mediaCompleteness: metric(),
    visibleMediaCompleteness: metric(),
    metricCompleteness: metric(),
    schemaValidity: metric(),
    acceptedUniqueUrls: 10,
    totalCostUsd: 0.5,
    costPerAcceptedUniqueUsd: 0.05,
  }
}

function providerReport(): ProviderComparisonReport {
  const requiredCapabilities = ["DISCOVER_URLS", "ENRICH_CONTENT", "READ_COMMENTS", "READ_MEDIA", "UPDATE_METRICS"] as const
  return {
    contractVersion: "social-provider-v1",
    corpusVersion: "gold-2026-07-14",
    providerKey: "bright-data",
    requiredCapabilities: [...requiredCapabilities],
    metrics: providerMetrics(),
    slices: [{
      sliceKey: "instagram:en:POST",
      platform: "instagram",
      locale: "en",
      contentKind: "POST",
      itemCount: 10,
      requiredCapabilities: [...requiredCapabilities],
      metrics: providerMetrics(),
    }],
    errors: [],
    warnings: [],
  }
}

const rates = (overrides: Partial<RelevanceRates> = {}): RelevanceRates => ({
  recall: 1,
  precision: 1,
  reviewRate: 0.1,
  count: 10,
  ...overrides,
})

function relevanceReport(): RelevanceEvaluationReport {
  return {
    schemaVersion: "relevance_gold_v1",
    datasetVersion: "gold-2026-07-14",
    total: 20,
    recall: 1,
    precision: 1,
    reviewRate: 0.1,
    falseNegativeDiscovery: 0,
    falseNegativeRelevance: 0,
    confusion: {
      ACCEPTED: { ACCEPTED: 10, REVIEW: 0, REJECTED: 0 },
      REVIEW: { ACCEPTED: 0, REVIEW: 5, REJECTED: 0 },
      REJECTED: { ACCEPTED: 0, REVIEW: 0, REJECTED: 5 },
    },
    byLocale: { en: rates(), ru: rates() },
    byKind: { POST: rates({ count: 20 }) },
    byChallenge: {},
    items: [],
  }
}

describe("provider/model promotion regression gates", () => {
  it("allows an unchanged provider evaluation", () => {
    expect(evaluateProviderPromotionRegression(providerReport(), providerReport())).toEqual({ pass: true, issues: [] })
  })

  it("blocks provider contract drift even when candidate metrics pass", () => {
    const candidate = providerReport()
    candidate.contractVersion = "social-provider-v2"

    const result = evaluateProviderPromotionRegression(providerReport(), candidate)

    expect(result.pass).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "CONTRACT_VERSION_CHANGED" }))
  })

  it("blocks a cohort regression hidden above the absolute quality gate", () => {
    const candidate = providerReport()
    candidate.slices[0].metrics.discoveryRecall = metric(0.97)

    const result = evaluateProviderPromotionRegression(providerReport(), candidate)

    expect(result.pass).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "METRIC_REGRESSION",
      scope: "cohort:instagram:en:POST:discoveryRecall",
      baseline: 1,
      candidate: 0.97,
    }))
  })

  it("blocks a missing required provider cohort", () => {
    const candidate = providerReport()
    candidate.slices = []

    const result = evaluateProviderPromotionRegression(providerReport(), candidate)

    expect(result.pass).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "REQUIRED_COHORT_MISSING" }))
  })

  it("blocks relevance model drift by dataset version and locale regression", () => {
    const candidate = relevanceReport()
    candidate.datasetVersion = "unapproved-gold-v2"
    candidate.byLocale.ru = rates({ recall: 0.95 })

    const result = evaluateRelevancePromotionRegression(relevanceReport(), candidate)

    expect(result.pass).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DATASET_VERSION_CHANGED" }),
      expect.objectContaining({ code: "METRIC_REGRESSION", scope: "cohort:locale:ru:recall" }),
    ]))
  })
})
