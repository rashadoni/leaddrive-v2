import { prisma } from "@/lib/prisma"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import {
  socialReportEffectiveSubjectWhere,
  socialReportVisibleMentionWhere,
} from "@/lib/social/report-visibility"
import { operatorActionableReviewReasonWhere } from "@/lib/social/review-queue-policy"

export type IncrementalReportLocale = "az" | "en" | "ru"
export type IncrementalReportState = "accepted" | "review"

export type IncrementalReportCandidate = {
  id: string
  uniqueKey: string
  state: IncrementalReportState
  platform: string
  contentKind: string
  provider: string
  sourceId: string | null
  sourceLabel: string
  publishedAt: Date | null
  discoveredAt: Date
  text: string
  url: string | null
}

export type IncrementalReportRun = {
  status: string
  foundCount: number
  newCount: number
  duplicateCount: number
  ignoredCount: number
}

export type IncrementalMonitoringReport = {
  subject: { id: string; name: string } | null
  range: {
    from: string
    to: string
    days: number
    cadence: "weekly"
  }
  totals: {
    newFindings: number
    accepted: number
    review: number
    archiveExcluded: number
    unknownDateExcluded: number
    duplicatesExcluded: number
    providerFound: number
    providerNew: number
    providerDuplicates: number
    providerIgnored: number
    runs: number
    partialRuns: number
    failedRuns: number
  }
  platforms: Array<{
    platform: string
    total: number
    accepted: number
    review: number
  }>
  sources: Array<{
    sourceId: string | null
    label: string
    platform: string
    total: number
    accepted: number
    review: number
  }>
  summaryText: string
  items: Array<{
    id: string
    state: IncrementalReportState
    platform: string
    contentKind: string
    provider: string
    sourceId: string | null
    sourceLabel: string
    publishedAt: string
    discoveredAt: string
    text: string
    url: string | null
  }>
}

type BuildIncrementalMonitoringReportInput = {
  subject: { id: string; name: string } | null
  from: Date
  to: Date
  days: number
  locale: IncrementalReportLocale
  candidates: IncrementalReportCandidate[]
  runs: IncrementalReportRun[]
}

type SourceShape = {
  id: string
  platform: string
  url: string | null
  handle: string | null
  query: string | null
  settings?: unknown
}

function normalizePlatform(value: string): string {
  return value.trim().toLowerCase() || "unknown"
}

function sourceLabel(source: SourceShape | null | undefined): string {
  if (!source) return "Unknown source"
  const settings = recordValue(source.settings)
  if (settings.managedBy === "google_alerts_rss") {
    const scenarioName = typeof settings.scenarioName === "string"
      ? settings.scenarioName.trim()
      : ""
    return scenarioName ? `Google Alerts RSS · ${scenarioName}` : "Google Alerts RSS"
  }
  return source.handle?.trim()
    || source.query?.trim()
    || source.url?.trim()
    || source.id
}

function uniqueCandidateKey(candidate: {
  id: string
  platform: string
  externalId: string | null
  canonicalUrl: string | null
  url: string | null
}): string {
  const identity = candidate.externalId?.trim()
    || candidate.canonicalUrl?.trim()
    || candidate.url?.trim()
    || candidate.id
  return `${normalizePlatform(candidate.platform)}:${identity}`
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function envelopeMatchesSubject(
  subjectDecision: unknown,
  subjectId: string,
  sourceSubjectIds: string[],
): boolean {
  const decision = recordValue(subjectDecision)
  const matches = Array.isArray(decision.matches) ? decision.matches : null
  if (matches) {
    return matches.some(value => {
      const match = recordValue(value)
      return match.subjectId === subjectId && ["MATCHED", "REVIEW"].includes(String(match.status ?? "").toUpperCase())
    })
  }
  return sourceSubjectIds.includes(subjectId)
}

function buildSummaryText(
  locale: IncrementalReportLocale,
  days: number,
  total: number,
  platforms: Array<{ platform: string; total: number }>,
): string {
  const counts = new Map(platforms.map(item => [item.platform, item.total]))
  const platformSummary = [
    `TikTok ${counts.get("tiktok") ?? 0}`,
    `Instagram ${counts.get("instagram") ?? 0}`,
    `Facebook ${counts.get("facebook") ?? 0}`,
  ].join(", ")

  if (locale === "ru") {
    return `За последние ${days} дней найдено ${total} новых материалов: ${platformSummary}.`
  }
  if (locale === "az") {
    return `Son ${days} gün ərzində ${total} yeni material tapılıb: ${platformSummary}.`
  }
  return `${total} new items were found in the last ${days} days: ${platformSummary}.`
}

export function buildIncrementalMonitoringReport(
  input: BuildIncrementalMonitoringReportInput,
): IncrementalMonitoringReport {
  const ordered = [...input.candidates].sort((left, right) => {
    if (left.state !== right.state) return left.state === "accepted" ? -1 : 1
    return right.discoveredAt.getTime() - left.discoveredAt.getTime()
  })

  const seen = new Set<string>()
  const current: IncrementalReportCandidate[] = []
  let archiveExcluded = 0
  let unknownDateExcluded = 0
  let duplicatesExcluded = 0

  for (const candidate of ordered) {
    if (seen.has(candidate.uniqueKey)) {
      duplicatesExcluded += 1
      continue
    }
    seen.add(candidate.uniqueKey)
    if (!candidate.publishedAt) {
      unknownDateExcluded += 1
      continue
    }
    if (candidate.publishedAt < input.from || candidate.publishedAt > input.to) {
      archiveExcluded += 1
      continue
    }
    current.push(candidate)
  }

  const platformMap = new Map<string, { platform: string; total: number; accepted: number; review: number }>()
  const sourceMap = new Map<string, {
    sourceId: string | null
    label: string
    platform: string
    total: number
    accepted: number
    review: number
  }>()

  for (const item of current) {
    const platform = normalizePlatform(item.platform)
    const platformRow = platformMap.get(platform) ?? { platform, total: 0, accepted: 0, review: 0 }
    platformRow.total += 1
    platformRow[item.state] += 1
    platformMap.set(platform, platformRow)

    const sourceKey = item.sourceId ?? `${platform}:${item.sourceLabel}`
    const sourceRow = sourceMap.get(sourceKey) ?? {
      sourceId: item.sourceId,
      label: item.sourceLabel,
      platform,
      total: 0,
      accepted: 0,
      review: 0,
    }
    sourceRow.total += 1
    sourceRow[item.state] += 1
    sourceMap.set(sourceKey, sourceRow)
  }

  const platforms = [...platformMap.values()].sort((left, right) =>
    right.total - left.total || left.platform.localeCompare(right.platform),
  )
  const sources = [...sourceMap.values()].sort((left, right) =>
    right.total - left.total || left.label.localeCompare(right.label),
  )
  const accepted = current.filter(item => item.state === "accepted").length
  const review = current.length - accepted

  return {
    subject: input.subject,
    range: {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      days: input.days,
      cadence: "weekly",
    },
    totals: {
      newFindings: current.length,
      accepted,
      review,
      archiveExcluded,
      unknownDateExcluded,
      duplicatesExcluded,
      providerFound: input.runs.reduce((sum, run) => sum + run.foundCount, 0),
      providerNew: input.runs.reduce((sum, run) => sum + run.newCount, 0),
      providerDuplicates: input.runs.reduce((sum, run) => sum + run.duplicateCount, 0),
      providerIgnored: input.runs.reduce((sum, run) => sum + run.ignoredCount, 0),
      runs: input.runs.length,
      partialRuns: input.runs.filter(run => run.status === "partial").length,
      failedRuns: input.runs.filter(run => run.status === "failed").length,
    },
    platforms,
    sources,
    summaryText: buildSummaryText(input.locale, input.days, current.length, platforms),
    items: current.map(item => ({
      id: item.id,
      state: item.state,
      platform: normalizePlatform(item.platform),
      contentKind: item.contentKind,
      provider: item.provider,
      sourceId: item.sourceId,
      sourceLabel: item.sourceLabel,
      publishedAt: item.publishedAt!.toISOString(),
      discoveredAt: item.discoveredAt.toISOString(),
      text: item.text,
      url: item.url,
    })),
  }
}

export async function getIncrementalMonitoringReport(options: {
  organizationId: string
  subjectId?: string
  from: Date
  to: Date
  days: number
  locale: IncrementalReportLocale
}): Promise<IncrementalMonitoringReport> {
  const subject = options.subjectId
    ? await prisma.monitoringSubject.findFirst({
      where: {
        id: options.subjectId,
        organizationId: options.organizationId,
        status: { notIn: ["archived", "deleted"] },
      },
      select: { id: true, name: true },
    })
    : null

  if (options.subjectId && !subject) throw new Error("monitoring_subject_not_found")

  const [mentions, pendingEnvelopes, runs] = await Promise.all([
    prisma.socialMention.findMany({
      where: {
        organizationId: options.organizationId,
        purgedAt: null,
        deletedAtSource: null,
        AND: [
          riskRelevantMentionWhere(),
          socialReportVisibleMentionWhere(),
          ...(subject
            ? [socialReportEffectiveSubjectWhere({
              organizationId: options.organizationId,
              subjectIds: [subject.id],
              matchStatuses: ["MATCHED", "REVIEW"],
              excludeParentPostMatch: false,
            })]
            : []),
        ],
        createdAt: { gte: options.from, lte: options.to },
      },
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        platform: true,
        externalId: true,
        canonicalUrl: true,
        url: true,
        contentKind: true,
        sourceProvider: true,
        publishedAt: true,
        createdAt: true,
        text: true,
        ingestEnvelopes: {
          where: { purgedAt: null, deletedAtSource: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            sourceId: true,
            providerKey: true,
            source: {
              select: { id: true, platform: true, url: true, handle: true, query: true, settings: true },
            },
          },
        },
      },
    }),
    prisma.ingestEnvelope.findMany({
      where: {
        organizationId: options.organizationId,
        acceptedMentionId: null,
        purgedAt: null,
        deletedAtSource: null,
        relevanceStatus: { in: ["PENDING", "REVIEW"] },
        AND: [operatorActionableReviewReasonWhere()],
        createdAt: { gte: options.from, lte: options.to },
        // subjectDecision is JSON and cannot be safely filtered with the same
        // portable Prisma query on every supported database. The tenant-scoped
        // result is filtered by subject below without losing detached rows.
      },
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        platform: true,
        externalId: true,
        canonicalUrl: true,
        url: true,
        contentKind: true,
        providerKey: true,
        adapterKey: true,
        publishedAt: true,
        createdAt: true,
        text: true,
        subjectDecision: true,
        sourceId: true,
        source: {
          select: {
            id: true,
            platform: true,
            url: true,
            handle: true,
            query: true,
            settings: true,
            subjectSources: { select: { subjectId: true } },
          },
        },
      },
    }),
    prisma.collectorRun.findMany({
      where: {
        organizationId: options.organizationId,
        startedAt: { gte: options.from, lte: options.to },
        ...(subject
          ? { source: { subjectSources: { some: { subjectId: subject.id } } } }
          : {}),
      },
      select: {
        status: true,
        foundCount: true,
        newCount: true,
        duplicateCount: true,
        ignoredCount: true,
      },
    }),
  ])

  const acceptedCandidates: IncrementalReportCandidate[] = mentions.map(mention => {
    const envelope = mention.ingestEnvelopes[0]
    return {
      id: mention.id,
      uniqueKey: uniqueCandidateKey(mention),
      state: "accepted",
      platform: mention.platform,
      contentKind: mention.contentKind,
      provider: envelope?.providerKey ?? mention.sourceProvider,
      sourceId: envelope?.sourceId ?? null,
      sourceLabel: sourceLabel(envelope?.source),
      publishedAt: mention.publishedAt,
      discoveredAt: mention.createdAt,
      text: mention.text,
      url: mention.canonicalUrl ?? mention.url,
    }
  })

  const reviewCandidates: IncrementalReportCandidate[] = pendingEnvelopes
    .filter(envelope => {
      if (!subject) return true
      return envelopeMatchesSubject(
        envelope.subjectDecision,
        subject.id,
        envelope.source?.subjectSources.map(link => link.subjectId) ?? [],
      )
    })
    .map(envelope => ({
      id: envelope.id,
      uniqueKey: uniqueCandidateKey(envelope),
      state: "review",
      platform: envelope.platform,
      contentKind: envelope.contentKind,
      provider: envelope.providerKey ?? envelope.adapterKey,
      sourceId: envelope.sourceId,
      sourceLabel: sourceLabel(envelope.source),
      publishedAt: envelope.publishedAt,
      discoveredAt: envelope.createdAt,
      text: envelope.text ?? "",
      url: envelope.canonicalUrl ?? envelope.url,
    }))

  return buildIncrementalMonitoringReport({
    subject,
    from: options.from,
    to: options.to,
    days: options.days,
    locale: options.locale,
    candidates: [...acceptedCandidates, ...reviewCandidates],
    runs,
  })
}
