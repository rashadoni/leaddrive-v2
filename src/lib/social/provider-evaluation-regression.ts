import {
  DEFAULT_PROVIDER_COMPARISON_GATES,
  providerComparisonPasses,
  type ProviderComparisonGates,
  type ProviderComparisonMetrics,
  type ProviderComparisonReport,
  type RatioMetric,
} from "@/lib/social/provider-comparison"
import {
  DEFAULT_RELEVANCE_GATES,
  evaluateRelevanceGates,
  type RelevanceEvaluationReport,
  type RelevanceGateThresholds,
  type RelevanceRates,
} from "@/lib/social/relevance-evaluator"

export type EvaluationRegressionIssue = {
  code: string
  scope: string
  baseline: string | number | null
  candidate: string | number | null
}

export type EvaluationRegressionResult = {
  pass: boolean
  issues: EvaluationRegressionIssue[]
}

export type EvaluationRegressionPolicy = {
  maxMetricRegression: number
  maxSchemaValidityRegression: number
}

export const DEFAULT_EVALUATION_REGRESSION_POLICY: EvaluationRegressionPolicy = {
  maxMetricRegression: 0.02,
  maxSchemaValidityRegression: 0,
}

const PROVIDER_RATIO_KEYS = [
  "discoveryRecall",
  "discoveryPrecision",
  "enrichmentCompleteness",
  "commentRecall",
  "visibleCommentRecall",
  "mediaCompleteness",
  "visibleMediaCompleteness",
  "metricCompleteness",
  "schemaValidity",
] as const satisfies ReadonlyArray<keyof ProviderComparisonMetrics>

function validateRegressionPolicy(policy: EvaluationRegressionPolicy): void {
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} must be between 0 and 1`)
  }
}

function compareRatio(
  issues: EvaluationRegressionIssue[],
  scope: string,
  metricKey: string,
  baseline: RatioMetric,
  candidate: RatioMetric,
  maxRegression: number,
): void {
  if (baseline.value === null) return
  if (candidate.value === null || baseline.value - candidate.value > maxRegression + Number.EPSILON) {
    issues.push({
      code: "METRIC_REGRESSION",
      scope: `${scope}:${metricKey}`,
      baseline: baseline.value,
      candidate: candidate.value,
    })
  }
}

function compareProviderMetrics(
  issues: EvaluationRegressionIssue[],
  scope: string,
  baseline: ProviderComparisonMetrics,
  candidate: ProviderComparisonMetrics,
  policy: EvaluationRegressionPolicy,
): void {
  for (const key of PROVIDER_RATIO_KEYS) {
    compareRatio(
      issues,
      scope,
      key,
      baseline[key] as RatioMetric,
      candidate[key] as RatioMetric,
      key === "schemaValidity" ? policy.maxSchemaValidityRegression : policy.maxMetricRegression,
    )
  }
}

export function evaluateProviderPromotionRegression(
  baseline: ProviderComparisonReport,
  candidate: ProviderComparisonReport,
  options: {
    regressionPolicy?: EvaluationRegressionPolicy
    comparisonGates?: ProviderComparisonGates
  } = {},
): EvaluationRegressionResult {
  const policy = options.regressionPolicy ?? DEFAULT_EVALUATION_REGRESSION_POLICY
  validateRegressionPolicy(policy)
  const issues: EvaluationRegressionIssue[] = []
  if (baseline.providerKey !== candidate.providerKey) {
    issues.push({ code: "PROVIDER_CHANGED", scope: "report", baseline: baseline.providerKey, candidate: candidate.providerKey })
  }
  if (baseline.corpusVersion !== candidate.corpusVersion) {
    issues.push({ code: "CORPUS_VERSION_CHANGED", scope: "report", baseline: baseline.corpusVersion, candidate: candidate.corpusVersion })
  }
  if (baseline.contractVersion !== candidate.contractVersion) {
    issues.push({ code: "CONTRACT_VERSION_CHANGED", scope: "report", baseline: baseline.contractVersion, candidate: candidate.contractVersion })
  }
  if (!providerComparisonPasses(candidate, options.comparisonGates ?? DEFAULT_PROVIDER_COMPARISON_GATES)) {
    issues.push({ code: "CANDIDATE_GATE_FAILED", scope: "report", baseline: 1, candidate: 0 })
  }
  compareProviderMetrics(issues, "overall", baseline.metrics, candidate.metrics, policy)
  const candidateSlices = new Map(candidate.slices.map(slice => [slice.sliceKey, slice]))
  for (const baselineSlice of baseline.slices) {
    const candidateSlice = candidateSlices.get(baselineSlice.sliceKey)
    if (!candidateSlice) {
      issues.push({ code: "REQUIRED_COHORT_MISSING", scope: baselineSlice.sliceKey, baseline: baselineSlice.itemCount, candidate: null })
      continue
    }
    compareProviderMetrics(issues, `cohort:${baselineSlice.sliceKey}`, baselineSlice.metrics, candidateSlice.metrics, policy)
  }
  return { pass: issues.length === 0, issues }
}

function compareRelevanceRates(
  issues: EvaluationRegressionIssue[],
  scope: string,
  baseline: RelevanceRates,
  candidate: RelevanceRates,
  maxRegression: number,
): void {
  for (const key of ["recall", "precision"] as const) {
    if (baseline[key] - candidate[key] > maxRegression + Number.EPSILON) {
      issues.push({ code: "METRIC_REGRESSION", scope: `${scope}:${key}`, baseline: baseline[key], candidate: candidate[key] })
    }
  }
}

export function evaluateRelevancePromotionRegression(
  baseline: RelevanceEvaluationReport,
  candidate: RelevanceEvaluationReport,
  options: {
    regressionPolicy?: EvaluationRegressionPolicy
    relevanceGates?: RelevanceGateThresholds
  } = {},
): EvaluationRegressionResult {
  const policy = options.regressionPolicy ?? DEFAULT_EVALUATION_REGRESSION_POLICY
  validateRegressionPolicy(policy)
  const issues: EvaluationRegressionIssue[] = []
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    issues.push({ code: "SCHEMA_VERSION_CHANGED", scope: "report", baseline: baseline.schemaVersion, candidate: candidate.schemaVersion })
  }
  if (baseline.datasetVersion !== candidate.datasetVersion) {
    issues.push({ code: "DATASET_VERSION_CHANGED", scope: "report", baseline: baseline.datasetVersion, candidate: candidate.datasetVersion })
  }
  if (!evaluateRelevanceGates(candidate, options.relevanceGates ?? DEFAULT_RELEVANCE_GATES).pass) {
    issues.push({ code: "CANDIDATE_GATE_FAILED", scope: "report", baseline: 1, candidate: 0 })
  }
  compareRelevanceRates(issues, "overall", {
    recall: baseline.recall,
    precision: baseline.precision,
    reviewRate: baseline.reviewRate,
    count: baseline.total,
  }, {
    recall: candidate.recall,
    precision: candidate.precision,
    reviewRate: candidate.reviewRate,
    count: candidate.total,
  }, policy.maxMetricRegression)
  for (const [dimension, baselineCohorts, candidateCohorts] of [
    ["locale", baseline.byLocale, candidate.byLocale],
    ["contentKind", baseline.byKind, candidate.byKind],
  ] as const) {
    for (const [key, baselineRates] of Object.entries(baselineCohorts)) {
      if (!baselineRates) continue
      const candidateRates = candidateCohorts[key as keyof typeof candidateCohorts] as RelevanceRates | undefined
      if (!candidateRates) {
        issues.push({ code: "REQUIRED_COHORT_MISSING", scope: `${dimension}:${key}`, baseline: baselineRates.count, candidate: null })
        continue
      }
      compareRelevanceRates(issues, `cohort:${dimension}:${key}`, baselineRates, candidateRates, policy.maxMetricRegression)
    }
  }
  return { pass: issues.length === 0, issues }
}
