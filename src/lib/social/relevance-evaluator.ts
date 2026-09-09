/**
 * Social Monitoring — offline relevance evaluator (CR-2).
 *
 * Прогоняет чистое ядро relevance-пайплайна (`decideSubjectRelevance`,
 * exact/context/classifier стадии) против версионированного gold dataset и считает
 * recall, precision, duplicate/review rate, разделяя false-negative discovery
 * (объект вообще не обнаружен) и false-negative relevance (обнаружен, но не принят).
 *
 * Чистый модуль без Prisma и без клиентских данных: gold dataset подаётся как
 * аргумент. Настоящий 500-элементный gold dataset (AZ/RU/EN) с реальной разметкой
 * предоставляет владелец; здесь — формат, evaluator и синтетический seed.
 */

import type { IngestInput } from "@/lib/social/ingest-mention"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"
import { decideSubjectRelevance, type SubjectForMatch } from "@/lib/social/subject-relevance"

export const GOLD_DATASET_SCHEMA_VERSION = "relevance_gold_v1"

export type GoldExpected = "ACCEPTED" | "REVIEW" | "REJECTED"
export type GoldContentKind = "POST" | "COMMENT" | "REPLY" | "MENTION" | "CAPTION" | "OCR" | "TRANSCRIPT"

/** Таксономия «трудных» случаев (для покрытия и разбивки отчёта). */
export type GoldChallenge =
  | "alias"
  | "handle"
  | "transliteration"
  | "declension"
  | "typo"
  | "homonym"
  | "negative_alias"
  | "exclusion"
  | "sarcasm"
  | "short_ambiguous"
  | "required_context"
  | "owned_source"

export interface GoldAlias {
  id?: string
  value: string
  kind?: string // IDENTITY | NAME | HANDLE | HASHTAG | DOMAIN | CONTEXT | NEGATIVE
  weight?: number
  isNegative?: boolean
  isAmbiguous?: boolean
}

export interface GoldSubjectSource {
  sourceId: string
  relationType: string // OWNED | OFFICIAL | ...
  trustWeight?: number
}

export interface GoldSubject {
  id: string
  aliases: GoldAlias[]
  requiredContext?: string[]
  exclusions?: string[]
  sources?: GoldSubjectSource[]
}

export interface GoldItem {
  id: string
  locale: string // az | ru | en
  kind: GoldContentKind
  text: string
  authorHandle?: string
  authorName?: string
  url?: string
  sourceId?: string // для проверки trusted-owned-source пути
  /** Ground truth (человеческая разметка). */
  expected: GoldExpected
  /** Объект, о котором на самом деле упоминание (для ACCEPTED/REVIEW). */
  expectedSubjectId?: string
  challenges?: GoldChallenge[]
}

export interface GoldDataset {
  schemaVersion: string
  datasetVersion: string
  locales: string[]
  subjects: GoldSubject[]
  items: GoldItem[]
}

function toSubjectForMatch(subject: GoldSubject): SubjectForMatch {
  return {
    id: subject.id,
    exclusions: subject.exclusions ?? [],
    requiredContext: subject.requiredContext ?? [],
    aliases: subject.aliases.map((alias, index) => ({
      id: alias.id ?? `${subject.id}-alias-${index}`,
      value: alias.value,
      normalizedValue: normalizeSubjectTerm(alias.value),
      kind: alias.kind ?? "IDENTITY",
      weight: alias.weight ?? 0.8,
      isNegative: alias.isNegative ?? false,
      isAmbiguous: alias.isAmbiguous ?? false,
    })),
    sources: (subject.sources ?? []).map((source, index) => ({
      id: `${subject.id}-src-${index}`,
      sourceId: source.sourceId,
      relationType: source.relationType,
      trustWeight: source.trustWeight ?? 0.9,
    })),
  } as unknown as SubjectForMatch
}

function toIngestInput(item: GoldItem): IngestInput {
  const contentKind = item.kind === "CAPTION" || item.kind === "OCR" || item.kind === "TRANSCRIPT" ? "POST" : item.kind
  return {
    organizationId: "gold",
    platform: "gold",
    externalId: item.id,
    text: item.text,
    sentiment: null,
    matchedTerm: null,
    contentKind,
    authorHandle: item.authorHandle ?? null,
    authorName: item.authorName ?? null,
    url: item.url ?? null,
    sourceMetadata: item.sourceId ? { monitoringSourceId: item.sourceId } : undefined,
  }
}

export interface GoldItemResult {
  id: string
  locale: string
  kind: GoldContentKind
  expected: GoldExpected
  predicted: GoldExpected
  correct: boolean
  /** Для пропущенных релевантных: discovery — объект не обнаружен; relevance — обнаружен, но не принят. */
  falseNegativeType: "discovery" | "relevance" | null
  matchedExpectedSubject: boolean
  challenges: GoldChallenge[]
}

export interface RelevanceRates {
  recall: number
  precision: number
  reviewRate: number
  count: number
}

export interface RelevanceEvaluationReport {
  schemaVersion: string
  datasetVersion: string
  total: number
  recall: number
  precision: number
  reviewRate: number
  falseNegativeDiscovery: number
  falseNegativeRelevance: number
  confusion: Record<GoldExpected, Record<GoldExpected, number>>
  byLocale: Record<string, RelevanceRates>
  byKind: Partial<Record<GoldContentKind, RelevanceRates>>
  byChallenge: Partial<Record<GoldChallenge, RelevanceRates>>
  items: GoldItemResult[]
}

function emptyConfusion(): Record<GoldExpected, Record<GoldExpected, number>> {
  const row = (): Record<GoldExpected, number> => ({ ACCEPTED: 0, REVIEW: 0, REJECTED: 0 })
  return { ACCEPTED: row(), REVIEW: row(), REJECTED: row() }
}

function ratesFor(items: GoldItemResult[]): RelevanceRates {
  const expectedAccepted = items.filter((i) => i.expected === "ACCEPTED")
  const predictedAccepted = items.filter((i) => i.predicted === "ACCEPTED")
  const truePositive = predictedAccepted.filter((i) => i.expected === "ACCEPTED").length
  return {
    recall: expectedAccepted.length === 0 ? 1 : truePositive / expectedAccepted.length,
    precision: predictedAccepted.length === 0 ? 1 : truePositive / predictedAccepted.length,
    reviewRate: items.length === 0 ? 0 : items.filter((i) => i.predicted === "REVIEW").length / items.length,
    count: items.length,
  }
}

export function evaluateGoldDataset(dataset: GoldDataset): RelevanceEvaluationReport {
  const subjects = dataset.subjects.map(toSubjectForMatch)
  const confusion = emptyConfusion()
  const items: GoldItemResult[] = dataset.items.map((item) => {
    const decision = decideSubjectRelevance(subjects, toIngestInput(item))
    const predicted = decision.status
    const matchedExpectedSubject = item.expectedSubjectId
      ? decision.matches.some((match) => match.subjectId === item.expectedSubjectId)
      : decision.matches.length > 0
    let falseNegativeType: "discovery" | "relevance" | null = null
    if (item.expected === "ACCEPTED" && predicted !== "ACCEPTED") {
      falseNegativeType = matchedExpectedSubject ? "relevance" : "discovery"
    }
    confusion[item.expected][predicted] += 1
    return {
      id: item.id,
      locale: item.locale,
      kind: item.kind,
      expected: item.expected,
      predicted,
      correct: predicted === item.expected,
      falseNegativeType,
      matchedExpectedSubject,
      challenges: item.challenges ?? [],
    }
  })

  const overall = ratesFor(items)
  const byLocale: Record<string, RelevanceRates> = {}
  for (const locale of new Set(items.map((i) => i.locale))) {
    byLocale[locale] = ratesFor(items.filter((i) => i.locale === locale))
  }
  const byKind: Partial<Record<GoldContentKind, RelevanceRates>> = {}
  for (const kind of new Set(items.map((i) => i.kind))) {
    byKind[kind] = ratesFor(items.filter((i) => i.kind === kind))
  }
  const byChallenge: Partial<Record<GoldChallenge, RelevanceRates>> = {}
  for (const challenge of new Set(items.flatMap((i) => i.challenges))) {
    byChallenge[challenge] = ratesFor(items.filter((i) => i.challenges.includes(challenge)))
  }

  return {
    schemaVersion: dataset.schemaVersion,
    datasetVersion: dataset.datasetVersion,
    total: items.length,
    recall: overall.recall,
    precision: overall.precision,
    reviewRate: overall.reviewRate,
    falseNegativeDiscovery: items.filter((i) => i.falseNegativeType === "discovery").length,
    falseNegativeRelevance: items.filter((i) => i.falseNegativeType === "relevance").length,
    confusion,
    byLocale,
    byKind,
    byChallenge,
    items,
  }
}

export interface RelevanceGateThresholds {
  minRecall: number // §6.3: ≥ 0.90
  minPrecision: number // Provider routing roadmap §3: ≥ 0.90
}

export const DEFAULT_RELEVANCE_GATES: RelevanceGateThresholds = { minRecall: 0.9, minPrecision: 0.9 }

export interface RelevanceGateResult {
  pass: boolean
  recall: { value: number; threshold: number; pass: boolean }
  precision: { value: number; threshold: number; pass: boolean }
  cohorts: Array<{
    dimension: "locale" | "contentKind"
    key: string
    count: number
    recall: { value: number; threshold: number; pass: boolean }
    precision: { value: number; threshold: number; pass: boolean }
    pass: boolean
  }>
}

export function evaluateRelevanceGates(
  report: RelevanceEvaluationReport,
  thresholds: RelevanceGateThresholds = DEFAULT_RELEVANCE_GATES,
): RelevanceGateResult {
  const recallPass = report.recall >= thresholds.minRecall
  const precisionPass = report.precision >= thresholds.minPrecision
  const cohorts = [
    ...Object.entries(report.byLocale).map(([key, rates]) => ({ dimension: "locale" as const, key, rates })),
    ...Object.entries(report.byKind).flatMap(([key, rates]) => (
      rates ? [{ dimension: "contentKind" as const, key, rates }] : []
    )),
  ].map(({ dimension, key, rates }) => {
    const cohortRecallPass = rates.recall >= thresholds.minRecall
    const cohortPrecisionPass = rates.precision >= thresholds.minPrecision
    return {
      dimension,
      key,
      count: rates.count,
      recall: { value: rates.recall, threshold: thresholds.minRecall, pass: cohortRecallPass },
      precision: { value: rates.precision, threshold: thresholds.minPrecision, pass: cohortPrecisionPass },
      pass: cohortRecallPass && cohortPrecisionPass,
    }
  })
  return {
    pass: recallPass && precisionPass && cohorts.every(cohort => cohort.pass),
    recall: { value: report.recall, threshold: thresholds.minRecall, pass: recallPass },
    precision: { value: report.precision, threshold: thresholds.minPrecision, pass: precisionPass },
    cohorts,
  }
}
