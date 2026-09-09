import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { effectiveMonitoringPlatformWhere } from "@/lib/social/effective-platform"
import {
  ingestEnvelopeOtherAuthorsWhere,
  mergeMonitoringAuthorIdentities,
  monitoringAuthorIdentity,
  type MonitoringAuthorIdentityInput,
} from "@/lib/social/mention-author-scope"
import { mapReviewQueueEnvelope, type ReviewQueueEnvelopeRow } from "@/lib/social/review-queue-envelope"
import {
  reviewQueueSentiment,
  type ReviewQueueSentiment,
} from "@/lib/social/review-queue-sentiment"
import { detectSocialReplyLanguage } from "@/lib/social/ai-reply-policy"
import {
  reviewQueueSurfaceForEnvelope,
  reviewQueueSurfaceWhere,
  type ReviewQueueSurface,
} from "@/lib/social/review-queue-surface"
import { operatorActionableReviewReasonWhere } from "@/lib/social/review-queue-policy"
import { withRlsAuth } from "@/lib/with-rls"

const listQuerySchema = z.object({
  limit: z.union([
    z.literal("all"),
    z.coerce.number().int().min(1).max(200),
  ]).default(25),
  page: z.coerce.number().int().min(1).default(1),
  cursor: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().max(200).optional(),
  subjectId: z.string().trim().min(1).max(200).optional(),
  // Comma-separated platform allow-list so the review queue tracks the feed's
  // platform / "Media" (video-platform) filter instead of always showing every
  // pending item (which read as "the filter does nothing").
  platform: z.string().trim().max(200).optional(),
  surface: z.string().trim().max(200).optional(),
  sentiment: z.string().trim().max(200).optional(),
  language: z.string().trim().max(200).optional(),
  sort: z.enum([
    "newest",
    "oldest",
    "sentiment_negative_first",
    "sentiment_positive_first",
  ]).default("newest"),
})

const MAX_MULTI_FILTER_VALUES = 20
const MAX_MULTI_FILTER_VALUE_LENGTH = 64
const REVIEW_QUEUE_SURFACES = new Set<ReviewQueueSurface>(["posts", "comments", "media", "unknown"])
const REVIEW_QUEUE_SENTIMENTS = new Set<ReviewQueueSentiment>(["positive", "neutral", "negative", "unknown"])
const REVIEW_QUEUE_LANGUAGES = new Set(["az", "ru", "en", "unknown"])
type ReviewQueueLanguage = "az" | "ru" | "en" | "unknown"
type ReviewQueueSort = z.infer<typeof listQuerySchema>["sort"]

function multiFilterValues(searchParams: URLSearchParams, key: string): string[] {
  const values = searchParams.getAll(key)
    .flatMap(value => value.split(","))
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 0 && value.length <= MAX_MULTI_FILTER_VALUE_LENGTH)

  const unique = Array.from(new Set(values)).slice(0, MAX_MULTI_FILTER_VALUES)
  return unique.includes("all") ? [] : unique
}

function reviewQueueLanguage(text: unknown): ReviewQueueLanguage {
  if (typeof text !== "string" || !text.trim()) return "unknown"
  return detectSocialReplyLanguage(text)
}

function reviewQueueSentimentRank(sentiment: ReviewQueueSentiment, sort: ReviewQueueSort): number {
  if (sort === "sentiment_positive_first") {
    return { positive: 0, neutral: 1, negative: 2, unknown: 3 }[sentiment]
  }
  return { negative: 0, neutral: 1, positive: 2, unknown: 3 }[sentiment]
}

function sortReviewQueueBySentiment(rows: ReviewQueueEnvelopeRow[], sort: ReviewQueueSort): void {
  rows.sort((left, right) => {
    const rank = reviewQueueSentimentRank(reviewQueueSentiment(left.text), sort)
      - reviewQueueSentimentRank(reviewQueueSentiment(right.text), sort)
    if (rank !== 0) return rank
    const createdAt = right.createdAt.getTime() - left.createdAt.getTime()
    if (createdAt !== 0) return createdAt
    return right.id.localeCompare(left.id)
  })
}

const reviewQueueEnvelopeSelect = {
  id: true,
  platform: true,
  contentKind: true,
  text: true,
  url: true,
  canonicalUrl: true,
  parentPostUrl: true,
  publishedAt: true,
  relevanceReason: true,
  matchedTerms: true,
  providerKey: true,
  subjectDecision: true,
  policySnapshot: true,
  source: {
    select: {
      query: true,
      handle: true,
      url: true,
      keywords: true,
      settings: true,
      subjectSources: {
        select: {
          scenarioId: true,
          subject: { select: { id: true, name: true } },
        },
      },
    },
  },
  routePlan: { select: { scenarioId: true } },
  providerRun: {
    select: {
      status: true,
      inputSnapshot: true,
      routePlan: { select: { scenarioId: true } },
    },
  },
  tiktokPublicationRevisit: { select: { coverageClass: true } },
  createdAt: true,
  purgeAt: true,
} satisfies Prisma.IngestEnvelopeSelect

/**
 * Operator review queue: transient discovery observations held in REVIEW
 * (unknown/stale publish date, snippet-only keyword match). Rows auto-purge at
 * `purgeAt`; already-purged or expired rows are never listed so an operator
 * cannot approve content past its retention intent.
 */
export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const platformValues = multiFilterValues(req.nextUrl.searchParams, "platform")
  const surfaceValues = multiFilterValues(req.nextUrl.searchParams, "surface")
  const sentimentValues = multiFilterValues(req.nextUrl.searchParams, "sentiment")
  const languageValues = multiFilterValues(req.nextUrl.searchParams, "language")
  const parsed = listQuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
    q: req.nextUrl.searchParams.get("q") ?? undefined,
    subjectId: req.nextUrl.searchParams.get("subjectId") ?? undefined,
    platform: platformValues.join(",") || undefined,
    surface: surfaceValues.join(",") || undefined,
    sentiment: sentimentValues.join(",") || undefined,
    language: languageValues.join(",") || undefined,
    sort: req.nextUrl.searchParams.get("sort") ?? undefined,
    page: req.nextUrl.searchParams.get("page") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 })
  }

  // REVIEW rows are a separate data set from accepted mentions, so they need
  // the same owned/official exclusion explicitly. A selected subject narrows
  // identity resolution to that brand; otherwise every active tenant identity
  // is merged so the unscoped external queue cannot leak any owned publication.
  const identitySubjects = await prisma.monitoringSubject.findMany({
    where: {
      organizationId: auth.orgId,
      status: { not: "deleted" },
      ...(parsed.data.subjectId ? { id: parsed.data.subjectId } : {}),
    },
    select: {
      id: true,
      legacyScenarioId: true,
      name: true,
      aliases: {
        where: { isNegative: false },
        select: { kind: true, value: true },
      },
      sources: {
        where: {
          OR: [
            { relationType: { in: ["OWNED", "OFFICIAL"] } },
            { source: { ownership: "owned" } },
          ],
        },
        select: {
          source: {
            select: { id: true, platform: true, sourceType: true, handle: true, url: true, query: true },
          },
        },
      },
    },
  }) as Array<MonitoringAuthorIdentityInput & {
    id: string
    legacyScenarioId: string | null
  }>
  const focusedSubject = parsed.data.subjectId ? identitySubjects[0] ?? null : null
  if (parsed.data.subjectId && !focusedSubject) {
    return NextResponse.json({ error: "Monitoring subject not found" }, { status: 404 })
  }
  const focusedSubjectLinks = focusedSubject
    ? await prisma.monitoringSubjectSource.findMany({
        where: {
          organizationId: auth.orgId,
          subjectId: focusedSubject.id,
        },
        select: {
          sourceId: true,
          scenarioId: true,
          source: {
            select: {
              subjectSources: {
                where: {
                  subject: { status: { not: "deleted" } },
                },
                select: { subjectId: true },
              },
            },
          },
        },
      })
    : []
  const focusedScenarioIds = focusedSubject
    ? Array.from(new Set([
        focusedSubject.legacyScenarioId,
        ...focusedSubjectLinks.map(link => link.scenarioId),
      ].filter((value): value is string => Boolean(value))))
    : []
  const focusedExclusiveSourceIds = focusedSubject
    ? Array.from(new Set(
        focusedSubjectLinks
          .filter((link) => {
            const linkedSubjectIds = new Set(
              link.source.subjectSources.map(subjectLink => subjectLink.subjectId),
            )
            return linkedSubjectIds.size === 1 && linkedSubjectIds.has(focusedSubject.id)
          })
          .map(link => link.sourceId),
      ))
    : []
  const noDirectScenarioWhere: Prisma.IngestEnvelopeWhereInput = {
    OR: [
      { routePlanId: null },
      { routePlan: { is: { scenarioId: null } } },
    ],
  }
  const noProviderScenarioWhere: Prisma.IngestEnvelopeWhereInput = {
    OR: [
      { providerRunId: null },
      { providerRun: { is: { routePlan: { is: { scenarioId: null } } } } },
    ],
  }
  const focusedSubjectProvenanceClauses: Prisma.IngestEnvelopeWhereInput[] = focusedSubject
    ? [
        ...(focusedScenarioIds.length > 0
          ? [
              { routePlan: { is: { scenarioId: { in: focusedScenarioIds } } } },
              {
                AND: [
                  noDirectScenarioWhere,
                  {
                    providerRun: {
                      is: {
                        routePlan: {
                          is: { scenarioId: { in: focusedScenarioIds } },
                        },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
        ...(focusedExclusiveSourceIds.length > 0
          ? [{
              AND: [
                noDirectScenarioWhere,
                noProviderScenarioWhere,
                { sourceId: { in: focusedExclusiveSourceIds } },
              ],
            }]
          : []),
      ]
    : []
  const focusedSubjectWhere: Prisma.IngestEnvelopeWhereInput = focusedSubject
    ? focusedSubjectProvenanceClauses.length > 0
      ? { OR: focusedSubjectProvenanceClauses }
      : { id: { in: [] } }
    : {}
  const externalAuthorScopeWhere = ingestEnvelopeOtherAuthorsWhere(
    mergeMonitoringAuthorIdentities(identitySubjects.map(subject => monitoringAuthorIdentity(subject))),
  )
  const platforms = platformValues
  const surfaces = surfaceValues
    .filter((surface): surface is ReviewQueueSurface => REVIEW_QUEUE_SURFACES.has(surface as ReviewQueueSurface))
  const sentiments = sentimentValues
    .filter((sentiment): sentiment is ReviewQueueSentiment => REVIEW_QUEUE_SENTIMENTS.has(sentiment as ReviewQueueSentiment))
  const languages = languageValues
    .filter((language): language is ReviewQueueLanguage => REVIEW_QUEUE_LANGUAGES.has(language))
  const platformWhere = effectiveMonitoringPlatformWhere(platforms) as Prisma.IngestEnvelopeWhereInput
  const now = new Date()
  const mutationLeaseWhere: Prisma.IngestEnvelopeWhereInput = {
    OR: [
      { reviewMutationUntil: null },
      { reviewMutationUntil: { lte: now } },
    ],
  }
  // Automatic review rows are worker-owned, including terminal technical
  // quarantine. They are retained for audit but never inflate manual work.
  const operatorReviewReasonWhere = operatorActionableReviewReasonWhere()
  const baseWhere = {
    organizationId: auth.orgId,
    relevanceStatus: "REVIEW",
    // A linked envelope has already been materialized (including the separate
    // workflow-free official archive) and must not be offered for a second,
    // potentially conflicting operator action.
    acceptedMentionId: null,
    purgedAt: null,
    deletedAtSource: null,
    purgeAt: { gt: now },
    discoveryAutoReviewDecisions: {
      none: { state: "SUPPRESSED" },
    },
    ...(parsed.data.q ? {
      OR: [
        { text: { contains: parsed.data.q, mode: "insensitive" as const } },
        { url: { contains: parsed.data.q, mode: "insensitive" as const } },
        { canonicalUrl: { contains: parsed.data.q, mode: "insensitive" as const } },
        { source: { is: { query: { contains: parsed.data.q, mode: "insensitive" as const } } } },
        { source: { is: { handle: { contains: parsed.data.q, mode: "insensitive" as const } } } },
        { source: { is: { url: { contains: parsed.data.q, mode: "insensitive" as const } } } },
        {
          source: {
            is: {
              subjectSources: {
                some: { subject: { name: { contains: parsed.data.q, mode: "insensitive" as const } } },
              },
            },
          },
        },
      ],
    } : {}),
  } satisfies Prisma.IngestEnvelopeWhereInput
  const scopedWhere = (requestedSurfaces: ReviewQueueSurface[] = []): Prisma.IngestEnvelopeWhereInput => ({
    ...baseWhere,
    AND: [
      mutationLeaseWhere,
      operatorReviewReasonWhere,
      ...(Object.keys(focusedSubjectWhere).length ? [focusedSubjectWhere] : []),
      ...(Object.keys(externalAuthorScopeWhere).length ? [externalAuthorScopeWhere] : []),
      ...(platforms.length ? [platformWhere] : []),
      ...(requestedSurfaces.length === 1
        ? [reviewQueueSurfaceWhere(requestedSurfaces[0])]
        : requestedSurfaces.length > 1
          ? [{ OR: requestedSurfaces.map(surface => reviewQueueSurfaceWhere(surface)) }]
          : []),
    ],
  })
  const where = scopedWhere(surfaces)
  const requestedLimit = parsed.data.limit
  const chronologicalDirection: Prisma.SortOrder = parsed.data.sort === "oldest" ? "asc" : "desc"
  const chronologicalOrderBy: Prisma.IngestEnvelopeOrderByWithRelationInput[] = [
    { createdAt: chronologicalDirection },
    { id: chronologicalDirection },
  ]

  // REVIEW envelopes predate persisted sentiment. Apply the deterministic
  // review classifier to the complete filtered set first, then paginate the
  // result. This keeps the tone filter truthful without invoking an AI model or
  // a paid provider merely to browse the queue.
  const requiresDerivedFiltering = sentiments.length > 0
    || languages.length > 0
    || parsed.data.sort === "sentiment_negative_first"
    || parsed.data.sort === "sentiment_positive_first"
  if (requiresDerivedFiltering) {
    const allRows = await prisma.ingestEnvelope.findMany({
      // Surface is deliberately omitted here so the segmented counters remain
      // a breakdown of the complete sentiment-filtered queue. The selected
      // surface is applied below, before page slicing.
      where: scopedWhere(),
      orderBy: chronologicalOrderBy,
      select: reviewQueueEnvelopeSelect,
    }) as ReviewQueueEnvelopeRow[]
    const derivedRows = allRows.filter(row => (
      (sentiments.length === 0 || sentiments.includes(reviewQueueSentiment(row.text)))
      && (languages.length === 0 || languages.includes(reviewQueueLanguage(row.text)))
    ))
    const surfaceCounts = derivedRows.reduce((counts, row) => {
      const surface = reviewQueueSurfaceForEnvelope(row)
      counts[surface] += 1
      counts.all += 1
      return counts
    }, { all: 0, posts: 0, comments: 0, media: 0, unknown: 0 })
    const filteredRows = surfaces.length > 0
      ? derivedRows.filter(row => surfaces.includes(reviewQueueSurfaceForEnvelope(row)))
      : derivedRows
    if (
      parsed.data.sort === "sentiment_negative_first"
      || parsed.data.sort === "sentiment_positive_first"
    ) {
      sortReviewQueueBySentiment(filteredRows, parsed.data.sort)
    }

    const cursorIndex = parsed.data.cursor
      ? filteredRows.findIndex(row => row.id === parsed.data.cursor)
      : -1
    if (parsed.data.cursor && cursorIndex < 0) {
      return NextResponse.json({ error: "Invalid cursor for filtered review queue" }, { status: 400 })
    }
    const offset = parsed.data.cursor
      ? cursorIndex + 1
      : requestedLimit === "all"
        ? 0
        : (parsed.data.page - 1) * requestedLimit
    const pageRows = requestedLimit === "all"
      ? filteredRows.slice(offset)
      : filteredRows.slice(offset, offset + requestedLimit)
    const hasMore = offset + pageRows.length < filteredRows.length
    return NextResponse.json({
      success: true,
      data: {
        envelopes: pageRows.map(mapReviewQueueEnvelope),
        total: filteredRows.length,
        surfaceCounts,
        pageInfo: {
          page: requestedLimit === "all" ? 1 : parsed.data.page,
          pageSize: requestedLimit,
          totalPages: requestedLimit === "all" ? 1 : Math.max(1, Math.ceil(filteredRows.length / requestedLimit)),
          hasMore,
          nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
        },
      },
    })
  }

  const [envelopes, total, posts, comments, media, unknown] = await Promise.all([
    prisma.ingestEnvelope.findMany({
      where,
      orderBy: chronologicalOrderBy,
      ...(requestedLimit === "all" ? {} : { take: requestedLimit + 1 }),
      ...(parsed.data.cursor ? {
        cursor: { id: parsed.data.cursor },
        skip: 1,
      } : requestedLimit === "all" ? {} : {
        skip: (parsed.data.page - 1) * requestedLimit,
      }),
      select: reviewQueueEnvelopeSelect,
    }),
    prisma.ingestEnvelope.count({ where }),
    prisma.ingestEnvelope.count({ where: scopedWhere(["posts"]) }),
    prisma.ingestEnvelope.count({ where: scopedWhere(["comments"]) }),
    prisma.ingestEnvelope.count({ where: scopedWhere(["media"]) }),
    prisma.ingestEnvelope.count({ where: scopedWhere(["unknown"]) }),
  ])
  const hasMore = requestedLimit !== "all" && envelopes.length > requestedLimit
  const pageRows = (
    requestedLimit === "all" || !hasMore ? envelopes : envelopes.slice(0, requestedLimit)
  ) as ReviewQueueEnvelopeRow[]
  const data = pageRows.map(mapReviewQueueEnvelope)
  const nextCursor = hasMore ? pageRows.at(-1)?.id ?? null : null
  const surfaceCounts = { all: posts + comments + media + unknown, posts, comments, media, unknown }
  return NextResponse.json({
    success: true,
    data: {
      envelopes: data,
      total,
      surfaceCounts,
      pageInfo: {
        page: requestedLimit === "all" ? 1 : parsed.data.page,
        pageSize: requestedLimit,
        totalPages: requestedLimit === "all" ? 1 : Math.max(1, Math.ceil(total / requestedLimit)),
        hasMore,
        nextCursor,
      },
    },
  })
})
