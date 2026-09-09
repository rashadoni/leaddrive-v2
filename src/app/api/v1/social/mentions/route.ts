import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  effectiveMonitoringPlatform,
  effectiveMonitoringPlatformWhere,
} from "@/lib/social/effective-platform"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  mergeMonitoringAuthorIdentities,
  mentionAuthorScopeWhere,
  monitoringAuthorIdentity,
  type MentionAuthorScope,
  type MonitoringAuthorIdentityInput,
} from "@/lib/social/mention-author-scope"
import {
  socialMentionSurfaceWhere,
  type MentionSurface,
} from "@/lib/social/mention-surface"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import { withOperatorSentimentStamp } from "@/lib/social/operator-sentiment"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

const MAX_MULTI_FILTER_VALUES = 20
const MAX_MULTI_FILTER_VALUE_LENGTH = 64

function multiFilterValues(
  searchParams: URLSearchParams,
  key: string,
  normalize: (value: string) => string = value => value.toLowerCase(),
): string[] {
  const values = searchParams.getAll(key)
    .flatMap(value => value.split(","))
    .map(value => normalize(value.trim()))
    .filter(value => value.length > 0 && value.length <= MAX_MULTI_FILTER_VALUE_LENGTH)

  const unique = Array.from(new Set(values)).slice(0, MAX_MULTI_FILTER_VALUES)
  return unique.includes("all") ? [] : unique
}

/**
 * Окно по дате публикации, устойчивое к находкам без даты.
 *
 * Часть коллекторов (браузерный поиск Facebook) не может доверенно определить
 * дату публикации и оставляет `publishedAt` пустым. Прямое сравнение прятало
 * такие находки при любом периоде кроме «всё время», хотя счётчики карточек их
 * считают — отсюда расхождение «в карточке 162, в ленте пусто». Для них
 * используем время появления в системе, как это давно делает аналитика.
 */
function mentionDateRangeWhere(dateRangeMs: number): Prisma.SocialMentionWhereInput {
  const since = new Date(Date.now() - dateRangeMs)
  return {
    OR: [
      { publishedAt: { gte: since } },
      { AND: [{ publishedAt: null }, { createdAt: { gte: since } }] },
    ],
  }
}

function sentimentFilterWhere(sentiments: string[]): Prisma.SocialMentionWhereInput {
  if (sentiments.length === 0) return {}

  const includeUnknown = sentiments.includes("unknown")
  const persisted = sentiments.filter(value => value !== "unknown")
  return {
    OR: [
      ...(persisted.length > 0 ? [{ sentiment: { in: persisted } }] : []),
      ...(includeUnknown ? [{ sentiment: null }, { sentiment: "unknown" }] : []),
    ],
  }
}

// Комментарий и ответ: определение одно на файл, чтобы языковой фильтр и
// поиск прямых внешних совпадений не разъезжались.
const COMMENT_LIKE_WHERE: Prisma.SocialMentionWhereInput = {
  OR: [
    { contentKind: { in: ["COMMENT", "REPLY"] } },
    { sourceType: { in: ["comment", "reply"] } },
  ],
}

// Комментарии языковой фильтр НЕ отсекает.
//
// Комментарий — реакция на пост бренда: его релевантность держится на родителе,
// а не на собственном тексте. Тексты при этом короткие, смешанные и часто без
// диакритики («Gedib apteklerede baw ceksinler» — азербайджанский), поэтому
// детектор честно оставляет их без метки, а фильтр по языку прячет.
//
// На проде это скрывало 138 принятых комментариев из 305, среди них 33
// НЕГАТИВНЫХ — то есть жалобы, ради которых мониторинг и существует.
// Английских принятых комментариев при этом ноль, так что послаблением
// чужеязычные не проникают: их отсекает релевантность, а не язык.
function languageFilterWhere(languages: string[]): Prisma.SocialMentionWhereInput {
  if (languages.length === 0) return {}

  const includeUnknown = languages.includes("unknown")
  const detected = languages.filter(value => value !== "unknown")
  return {
    OR: [
      ...detected.map(language => ({
        sourceMetadata: { path: ["socialTriage", "language"], equals: language },
      })),
      ...(includeUnknown ? [{
        sourceMetadata: { path: ["socialTriage", "language"], equals: Prisma.DbNull },
      }] : []),
      COMMENT_LIKE_WHERE,
    ],
  }
}

type MentionListSort =
  | "newest"
  | "oldest"
  | "sentiment_negative_first"
  | "sentiment_positive_first"

function mentionOrderBy(sort: MentionListSort): Prisma.SocialMentionOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ publishedAt: "asc" }, { id: "asc" }]
  if (sort === "sentiment_negative_first") {
    return [
      { sentiment: { sort: "asc", nulls: "last" } },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]
  }
  if (sort === "sentiment_positive_first") {
    return [
      { sentiment: { sort: "desc", nulls: "last" } },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]
  }
  // nulls: "last" обязателен: в PostgreSQL при DESC значения NULL идут ПЕРВЫМИ,
  // и находки без даты публикации (браузерный сбор Facebook) вытеснили бы
  // свежие материалы с первых страниц «сначала новые». Сортировки по
  // тональности выше уже задают это явно — приводим дефолт к тому же правилу.
  return [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]
}

function socialTriageWhere(filter: string | undefined): Record<string, unknown> {
  switch (filter) {
    case "high_risk":
      return {
        OR: [
          { sourceMetadata: { path: ["socialTriage", "prRisk"], equals: "high" } },
          { sourceMetadata: { path: ["socialTriage", "urgency"], equals: "critical" } },
        ],
      }
    case "lead":
      return { sourceMetadata: { path: ["socialTriage", "leadIntent"], equals: true } }
    case "complaint":
      return { sourceMetadata: { path: ["socialTriage", "complaint"], equals: true } }
    case "needs_action":
      return {
        OR: [
          { sourceMetadata: { path: ["socialTriage", "recommendedAction"], equals: "create_lead" } },
          { sourceMetadata: { path: ["socialTriage", "recommendedAction"], equals: "escalate" } },
          { sourceMetadata: { path: ["socialTriage", "approvalRequired"], equals: true } },
        ],
      }
    case "noise":
      return { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], equals: true } }
    default:
      return {}
  }
}

function mentionSearchWhere(rawQuery: string | undefined): Prisma.SocialMentionWhereInput {
  const query = rawQuery?.trim()
  if (!query) return {}

  const withoutHash = query.replace(/^#+/, "").trim()
  const terms = Array.from(new Set([query, withoutHash].filter(Boolean)))
  const or: Prisma.SocialMentionWhereInput[] = []

  for (const term of terms) {
    or.push(
      { matchedTerm: { contains: term, mode: "insensitive" } },
      { text: { contains: term, mode: "insensitive" } },
      { authorName: { contains: term, mode: "insensitive" } },
      { authorHandle: { contains: term, mode: "insensitive" } },
      { cluster: { is: { topic: { contains: term, mode: "insensitive" } } } },
      { evidences: { some: { rawSnippet: { contains: term, mode: "insensitive" } } } },
    )
  }

  return { OR: or }
}

function visibleNoiseWhere(
  showNoise: boolean,
  stream: string | undefined,
  organizationId: string,
  subjectId?: string,
): Prisma.SocialMentionWhereInput {
  if (showNoise) return {}

  const normalVisibleWhere: Prisma.SocialMentionWhereInput = {
    OR: [
      { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], not: true } },
      { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], equals: Prisma.DbNull } },
    ],
  }

  if (stream !== "search") return normalVisibleWhere

  const contextAcceptedWhere: Prisma.SocialMentionWhereInput = {
    subjectMatches: {
      some: {
        organizationId,
        ...(subjectId ? { subjectId } : {}),
        status: "MATCHED",
        reason: {
          in: [
            "operator_review_accept",
            "negative_parent_post_inheritance",
            "comment_negative_in_brand_context",
          ],
        },
      },
    },
  }

  return {
    OR: [
      contextAcceptedWhere,
      {
        AND: [
          normalVisibleWhere,
          { matchedTerm: { not: null } },
        ],
      },
    ],
  }
}

function mentionStreamWhere(stream: string | undefined): Prisma.SocialMentionWhereInput {
  switch (stream) {
    case "owned":
      return { sourceProvider: "native" }
    case "search":
      return {
        OR: [
          {
            sourceProvider: {
              in: ["search_index", "provider_api", "browser_capture", "notification_inbox", "official_discovery"],
            },
          },
          {
            AND: [
              { platform: "youtube" },
              { sourceProvider: "native" },
              {
                OR: [
                  { sourceMetadata: { path: ["officialDiscovery"], equals: true } },
                  {
                    AND: [
                      { sourceMetadata: { path: ["officialCollector"], equals: true } },
                      { sourceMetadata: { path: ["ownership"], equals: "external" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
    default:
      return {}
  }
}

/**
 * Existing provider rows may carry a parent post's matchedTerm. In a focused
 * external-search view, comments therefore need explicit evidence that the
 * term came from the comment body itself. Generic parent inheritance remains
 * excluded; only the explicit negative-parent policy below is visible.
 * Durable operator acceptance and subject-scoped inheritance from a verified
 * negative parent are the exceptions: neither needs a synthetic matchedTerm.
 */
type FocusedSubjectIdentity = {
  name: string
  aliases: Array<{ kind: string; value: string; isNegative: boolean }>
}

function directSubjectTextWhere(subject: FocusedSubjectIdentity | null): Prisma.SocialMentionWhereInput {
  const terms = subject
    ? Array.from(new Set([
        subject.name,
        ...subject.aliases
          .filter(alias => !alias.isNegative && !["NEGATIVE", "CONTEXT"].includes(alias.kind))
          .map(alias => alias.value),
      ].map(term => term.replace(/^[@#]+/, "").trim()).filter(Boolean)))
    : []
  if (terms.length === 0) return { id: "__no_direct_comment_match__" }
  return {
    OR: terms.map(term => ({ text: { contains: term, mode: "insensitive" as const } })),
  }
}

function directExternalCommentMatchWhere(
  subject: FocusedSubjectIdentity | null,
  organizationId: string,
  subjectId: string,
): Prisma.SocialMentionWhereInput {
  const commentLike = COMMENT_LIKE_WHERE
  const notCommentLike: Prisma.SocialMentionWhereInput = {
    AND: [
      { contentKind: { notIn: ["COMMENT", "REPLY"] } },
      { sourceType: { notIn: ["comment", "reply"] } },
    ],
  }
  const noInheritedStamp: Prisma.SocialMentionWhereInput = {
    OR: [
      { sourceMetadata: { path: ["inheritedParentMatch"], not: true } },
      { sourceMetadata: { path: ["inheritedParentMatch"], equals: Prisma.DbNull } },
    ],
  }
  return {
    OR: [
      notCommentLike,
      {
        AND: [
          commentLike,
          { matchedTerm: { not: null } },
          directSubjectTextWhere(subject),
          noInheritedStamp,
        ],
      },
      {
        AND: [
          commentLike,
          {
            subjectMatches: {
              some: {
                organizationId,
                subjectId,
                status: "MATCHED",
                reason: {
                  in: [
                    "operator_review_accept",
                    "negative_parent_post_inheritance",
                    "comment_negative_in_brand_context",
                  ],
                },
              },
            },
          },
        ],
      },
    ],
  }
}

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const statuses = multiFilterValues(searchParams, "status")
  const platforms = multiFilterValues(searchParams, "platform")
  const sentiments = multiFilterValues(searchParams, "sentiment")
  const languages = multiFilterValues(searchParams, "language")
  const sourceType = searchParams.get("sourceType") || undefined
  const contentKind = searchParams.get("contentKind")?.toUpperCase() || undefined
  const sourceProvider = searchParams.get("sourceProvider") || undefined
  const stream = searchParams.get("stream") || undefined
  const aiStatus = searchParams.get("aiStatus") || undefined
  const replyQueue = searchParams.get("queue") === "ai_replies"
  const whatsappStatus = searchParams.get("whatsappStatus") || undefined
  const phoneLead = searchParams.get("phoneLead") || undefined
  const triage = searchParams.get("triage") || undefined
  const query = searchParams.get("q") || undefined
  const subjectId = searchParams.get("subjectId") || undefined
  const requestedAuthorScope = searchParams.get("authorScope")
  const authorScope: MentionAuthorScope = requestedAuthorScope === "others" || requestedAuthorScope === "official"
    ? requestedAuthorScope
    : "all"
  // External monitoring is explicitly about third-party content. Keep the
  // diagnostic "all" scope for other streams, but never let owned/official
  // publications leak back into the external search merely because the query
  // parameter was omitted.
  const effectiveAuthorScope: MentionAuthorScope =
    stream === "search" && authorScope === "all" ? "others" : authorScope
  const showNoise = searchParams.get("showNoise") === "1" || triage === "noise"
  const requestedLimit = searchParams.get("limit") || "25"
  const showAll = requestedLimit === "all"
  const parsedLimit = Number.parseInt(requestedLimit, 10)
  const limit = showAll
    ? null
    : Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 25
  const parsedPage = Number.parseInt(searchParams.get("page") || "1", 10)
  const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1
  const requestedDateRange = searchParams.get("dateRange") || "30d"
  const dateRange = ["24h", "7d", "30d", "all"].includes(requestedDateRange) ? requestedDateRange : "30d"
  const dateRangeMs = dateRange === "24h"
    ? 24 * 60 * 60_000
    : dateRange === "7d"
      ? 7 * 24 * 60 * 60_000
      : dateRange === "30d"
        ? 30 * 24 * 60 * 60_000
        : null
  const requestedSort = searchParams.get("sort")
  const sort: MentionListSort = requestedSort === "oldest"
    || requestedSort === "sentiment_negative_first"
    || requestedSort === "sentiment_positive_first"
    ? requestedSort
    : "newest"
  // Surface = the first-class Posts|Comments segmentation; wins over the granular
  // sourceType filter when both are sent. Provider discovery can produce posts and
  // comments for every supported social platform, including TikTok.
  const surfaces = multiFilterValues(searchParams, "surface")
    .filter((surface): surface is MentionSurface => (
      surface === "comments" || surface === "posts" || surface === "media" || surface === "unknown"
    ))
  const surfaceWhere: Prisma.SocialMentionWhereInput =
    surfaces.length === 1
      ? socialMentionSurfaceWhere(surfaces[0])
      : surfaces.length > 1
        ? { OR: surfaces.map(surface => socialMentionSurfaceWhere(surface)) }
      : {}
  const granularSourceWhere: Prisma.SocialMentionWhereInput =
    surfaces.length === 0 && sourceType ? { sourceType } : {}
  const contentKindWhere: Prisma.SocialMentionWhereInput =
    contentKind ? { contentKind } : {}
  // Product rule: WEB monitoring is a news feed, not a generic search-results
  // catalogue. This also keeps legacy Cloudflare/catalog/search-snippet rows
  // out of every feed without destructively deleting audit data.
  const webNewsOnlyWhere: Prisma.SocialMentionWhereInput = {
    OR: [
      { platform: { not: "web" } },
      { contentKind: "ARTICLE" },
    ],
  }
  // `NOT json_path = true` also rejects rows where the JSON key is absent on
  // PostgreSQL (the comparison is NULL/unknown). Live provider rows created
  // before archive stamping therefore disappeared from the feed. Mirror the
  // proven hidden-noise shape so missing `archiveOnly` means live/visible,
  // while explicit archive rows remain hidden until they are activated.
  const visibleArchiveWhere: Prisma.SocialMentionWhereInput = {
    OR: [
      { sourceMetadata: { path: ["archiveOnly"], not: true } },
      { sourceMetadata: { path: ["archiveOnly"], equals: Prisma.DbNull } },
    ],
  }
  const visibilityClauses: Prisma.SocialMentionWhereInput[] = [
    contentKindWhere,
    webNewsOnlyWhere,
    visibleArchiveWhere,
    visibleNoiseWhere(showNoise, stream, orgId, subjectId),
    riskRelevantMentionWhere(),
  ].filter(clause => Object.keys(clause).length > 0)
  const monitoringBaseWhere = {
    organizationId: orgId,
    // See excludeSentinel note below — exclude the telegram cursor row.
    externalId: { not: "__tg_offset__" },
    purgedAt: null,
    deletedAtSource: null,
    AND: visibilityClauses,
  }
  const streamWhere = sourceProvider
    ? { sourceProvider }
    : mentionStreamWhere(stream)
  const focusedSubject = subjectId
    ? await prisma.monitoringSubject.findFirst({
        where: { id: subjectId, organizationId: orgId },
        select: {
          name: true,
          aliases: { where: { isNegative: false }, select: { kind: true, value: true, isNegative: true } },
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
      })
    : null
  const orgOfficialSubjects: MonitoringAuthorIdentityInput[] = !focusedSubject && effectiveAuthorScope !== "all"
    ? await prisma.monitoringSubject.findMany({
        where: {
          organizationId: orgId,
          status: { not: "deleted" },
        },
        select: {
          name: true,
          aliases: { where: { isNegative: false }, select: { kind: true, value: true } },
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
      })
    : []
  const authorIdentity = focusedSubject
    ? monitoringAuthorIdentity(focusedSubject)
    : mergeMonitoringAuthorIdentities(orgOfficialSubjects.map(subject => monitoringAuthorIdentity(subject)))
  const authorScopeClause = effectiveAuthorScope !== "all"
    ? mentionAuthorScopeWhere(effectiveAuthorScope, authorIdentity)
    : {}
  // Relevance backfills retain their provenance in suffixed reason codes
  // (for example `official_author_excluded_backfill`). They represent the same
  // official-author archive as live `official_author` decisions and must remain
  // available in the explicit Official view without leaking into Others.
  const officialSubjectMatchWhere = {
    status: "REJECTED" as const,
    reason: { startsWith: "official_author" },
  }
  const focusedSubjectMatchWhere = subjectId
    ? effectiveAuthorScope === "official"
      ? officialSubjectMatchWhere
      : effectiveAuthorScope === "others"
        ? { status: "MATCHED" as const, reason: { not: "parent_post_match" } }
        : {
            OR: [
              { status: "MATCHED" as const, reason: { not: "parent_post_match" } },
              officialSubjectMatchWhere,
            ],
          }
    : null
  const phoneLeadWhere =
    phoneLead === "created"
      ? { sourceMetadata: { path: ["phoneLead", "status"], equals: "lead_created" } }
      : phoneLead === "duplicate"
        ? { sourceMetadata: { path: ["phoneLead", "status"], equals: "duplicate_linked" } }
        : phoneLead === "all"
          ? {
              OR: [
                { sourceMetadata: { path: ["phoneLead", "status"], equals: "lead_created" } },
                { sourceMetadata: { path: ["phoneLead", "status"], equals: "duplicate_linked" } },
              ],
            }
          : {}
  const sentimentWhere = sentimentFilterWhere(sentiments)
  const languageWhere = languageFilterWhere(languages)
  const platformWhere = platforms.length > 0
    ? effectiveMonitoringPlatformWhere(platforms) as Prisma.SocialMentionWhereInput
    : {}
  const andClauses = [
    phoneLead === "all" ? phoneLeadWhere : {},
    socialTriageWhere(triage),
    mentionSearchWhere(query),
    authorScopeClause,
    sentimentWhere,
    languageWhere,
    platformWhere,
    subjectId && stream === "search"
      ? directExternalCommentMatchWhere(focusedSubject, orgId, subjectId)
      : {},
    // В AND, а не спредом в объект: клауза состоит из OR, а на верхнем уровне
    // ключ OR уже занимают очередь ответов и stream-фильтр — спред затёр бы один
    // из них.
    !replyQueue && dateRangeMs ? mentionDateRangeWhere(dateRangeMs) : {},
  ].filter(clause => Object.keys(clause).length > 0)
  // Surface-agnostic variant feeds the bySourceType aggregate so the segmented
  // control shows counts for ALL segments while one of them is active.
  const surfaceAgnosticWhere: Prisma.SocialMentionWhereInput = {
    ...monitoringBaseWhere,
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(subjectId ? {
      subjectMatches: {
        some: {
          organizationId: orgId,
          subjectId,
          ...focusedSubjectMatchWhere!,
        },
      },
    } : {}),
    ...streamWhere,
    ...(replyQueue
      ? {
          OR: [
            { aiDrafts: { some: { organizationId: orgId, status: "needs_approval" } } },
            { manualEngagementTasks: { some: { organizationId: orgId, status: { in: ["OPEN", "IN_PROGRESS"] } } } },
          ],
        }
      : aiStatus ? { aiDrafts: { some: { organizationId: orgId, status: aiStatus } } } : {}),
    ...(whatsappStatus ? { whatsappGroupStatus: whatsappStatus } : {}),
    ...(phoneLead !== "all" ? phoneLeadWhere : {}),
    AND: [...visibilityClauses, ...andClauses],
  }
  const mentionWhere: Prisma.SocialMentionWhereInput = {
    ...surfaceAgnosticWhere,
    ...granularSourceWhere,
    AND: [
      ...visibilityClauses,
      ...andClauses,
      ...(Object.keys(surfaceWhere).length > 0 ? [surfaceWhere] : []),
    ],
  }
  const replyQueueWhere: Prisma.SocialMentionWhereInput = {
    organizationId: orgId,
    externalId: { not: "__tg_offset__" },
    purgedAt: null,
    deletedAtSource: null,
    AND: [riskRelevantMentionWhere()],
    OR: [
      { aiDrafts: { some: { organizationId: orgId, status: "needs_approval" } } },
      { manualEngagementTasks: { some: { organizationId: orgId, status: { in: ["OPEN", "IN_PROGRESS"] } } } },
    ],
  }

  const mentions = await prisma.socialMention.findMany({
    where: mentionWhere,
    orderBy: mentionOrderBy(sort),
    ...(limit === null ? {} : {
      take: limit,
      skip: (page - 1) * limit,
    }),
    include: {
      account: { select: { handle: true, displayName: true } },
      cluster: { select: { id: true, mentionCount: true, topic: true, riskLevel: true } },
      evidences: {
        orderBy: { capturedAt: "desc" },
        take: 5,
        select: {
          id: true,
          sourceTrustTier: true,
          confidence: true,
          permalink: true,
          screenshotUrl: true,
          rawSnippet: true,
          capturedAt: true,
          source: { select: { platform: true, sourceType: true, collectionMode: true } },
        },
      },
      aiDrafts: {
        ...(replyQueue ? { where: { status: "needs_approval" } } : {}),
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, sendMode: true, sentAt: true, forbiddenReason: true, createdAt: true },
      },
      manualEngagementTasks: {
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, engagementMode: true, reason: true, draftId: true },
      },
      subjectMatches: {
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: {
          subjectId: true,
          status: true,
          reason: true,
          confidence: true,
          matchedAliasIds: true,
          contextSignals: true,
          subject: {
            select: {
              name: true,
              aliases: { select: { id: true, value: true } },
            },
          },
        },
      },
      relevanceFeedback: {
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { subjectId: true, feedbackType: true },
      },
      mediaObservations: {
        where: { purgedAt: null },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          mediaType: true,
          sourceUrl: true,
          thumbnailUrl: true,
          status: true,
        },
      },
    },
  })

  const chatwootMessageIds = Array.from(new Set(mentions
    .map((mention: { sourceMetadata: unknown }) => {
      const metadata = asRecord(mention.sourceMetadata)
      if (stringValue(metadata.mediaUrl)) return null
      return stringValue(metadata.chatwootMessageId)
    })
    .filter((id: string | null): id is string => Boolean(id))))

  const channelMedia = chatwootMessageIds.length > 0
    ? await prisma.channelMessage.findMany({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          direction: "inbound",
          mediaUrl: { not: null },
          OR: [
            { externalId: { in: chatwootMessageIds } },
            { id: { in: chatwootMessageIds } },
          ],
        },
        select: { id: true, externalId: true, mediaUrl: true, messageType: true },
      })
    : []

  const mediaByChatwootId = new Map<string, { mediaUrl: string; messageType: string | null }>()
  for (const message of channelMedia) {
    if (!message.mediaUrl) continue
    const media = { mediaUrl: message.mediaUrl, messageType: message.messageType ?? null }
    mediaByChatwootId.set(message.id, media)
    if (message.externalId) mediaByChatwootId.set(message.externalId, media)
  }

  const mentionsWithMedia = mentions.map((mention: {
    platform: unknown
    sourceMetadata: unknown
    url: string | null
    canonicalUrl: string | null
    parentPostUrl: string | null
    [key: string]: unknown
  }) => {
    const metadata = asRecord(mention.sourceMetadata)
    const chatwootMessageId = stringValue(metadata.chatwootMessageId)
    const media = chatwootMessageId ? mediaByChatwootId.get(chatwootMessageId) : null
    const enrichedMention = !stringValue(metadata.mediaUrl) && media
      ? {
          ...mention,
          sourceMetadata: {
            ...metadata,
            mediaUrl: media.mediaUrl,
            messageType: media.messageType ?? "document",
          },
        }
      : mention

    return {
      ...enrichedMention,
      platform: effectiveMonitoringPlatform(enrichedMention),
      // Keep acquisition provenance explicit without presenting WEB search as
      // the destination platform of a Facebook/Instagram/etc. result.
      acquisitionPlatform: mention.platform,
    }
  })

  // Telegram poller stores its offset cursor as a sentinel row with a
  // well-known externalId. Exclude it by exact name. (Earlier `startsWith:
  // "__"` was broken — underscores are SQL LIKE wildcards.)
  const surfaceCountWhere = (surface: MentionSurface): Prisma.SocialMentionWhereInput => ({
    ...surfaceAgnosticWhere,
    AND: [
      ...visibilityClauses,
      ...andClauses,
      socialMentionSurfaceWhere(surface),
    ],
  })
  // Одно родительское видео/пост даёт десятки и сотни комментариев (прод,
  // август 2026: 275 комментариев под одним TikTok-видео, 124 из них негативные).
  // Лента показывала каждый комментарий отдельной карточкой С ТЕМ ЖЕ видео, и
  // при сортировке «сначала негатив» одно видео повторялось десятками экранов.
  // Размер ветки едет вместе со строкой: он и объясняет объём, и позволяет UI
  // не повторять один и тот же плеер. Счёт идёт по ТЕКУЩЕМУ фильтру, чтобы
  // число совпадало с тем, что лента реально содержит.
  const pageParentPostUrls = Array.from(new Set(mentionsWithMedia
    .map(mention => stringValue(mention.parentPostUrl))
    .filter((url): url is string => Boolean(url))))
  const [
    totals,
    byStatus,
    bySentiment,
    bySourceType,
    acceptedTotal,
    acceptedPosts,
    acceptedComments,
    acceptedMedia,
    acceptedUnknown,
    replyQueueTotal,
    threadTotals,
  ] = await Promise.all([
    prisma.socialMention.count({ where: mentionWhere }),
    prisma.socialMention.groupBy({
      by: ["status"],
      where: mentionWhere,
      _count: true,
    }),
    prisma.socialMention.groupBy({
      by: ["sentiment"],
      where: mentionWhere,
      _count: true,
    }),
    prisma.socialMention.groupBy({
      by: ["sourceType"],
      where: surfaceAgnosticWhere,
      _count: true,
    }),
    // `totals` follows the currently selected surface for pagination. The
    // segmented control needs the complete filtered dataset even while a
    // surface is active, so count that dataset directly instead of rebuilding
    // it from predicates that can be affected by legacy nullable metadata.
    prisma.socialMention.count({ where: surfaceAgnosticWhere }),
    prisma.socialMention.count({ where: surfaceCountWhere("posts") }),
    prisma.socialMention.count({ where: surfaceCountWhere("comments") }),
    prisma.socialMention.count({ where: surfaceCountWhere("media") }),
    prisma.socialMention.count({ where: surfaceCountWhere("unknown") }),
    prisma.socialMention.count({ where: replyQueueWhere }),
    pageParentPostUrls.length > 0
      ? prisma.socialMention.groupBy({
          by: ["parentPostUrl"],
          where: { ...mentionWhere, parentPostUrl: { in: pageParentPostUrls } },
          _count: true,
        })
      : Promise.resolve([] as Array<{ parentPostUrl: string | null; _count: number }>),
  ])

  const threadTotalByParent = new Map<string, number>()
  for (const group of threadTotals as Array<{ parentPostUrl: string | null; _count: number }>) {
    if (group.parentPostUrl) threadTotalByParent.set(group.parentPostUrl, group._count)
  }

  return NextResponse.json({
    success: true,
    data: {
      mentions: mentionsWithMedia.map(mention => ({
        ...mention,
        threadCommentTotal: stringValue(mention.parentPostUrl)
          ? threadTotalByParent.get(mention.parentPostUrl as string) ?? null
          : null,
      })),
      stats: {
        total: totals,
        byStatus: Object.fromEntries(byStatus.map((g: { status: string; _count: number }) => [g.status, g._count])),
        bySentiment: Object.fromEntries(
          bySentiment.map((g: { sentiment: string | null; _count: number }) => [g.sentiment ?? "unknown", g._count]),
        ),
        bySourceType: Object.fromEntries(
          bySourceType.map((g: { sourceType: string | null; _count: number }) => [g.sourceType ?? "unknown", g._count]),
        ),
        withMedia: acceptedMedia,
        bySurface: {
          all: acceptedTotal,
          posts: acceptedPosts,
          comments: acceptedComments,
          media: acceptedMedia,
          unknown: acceptedUnknown,
        },
        replyQueueTotal,
      },
      pagination: {
        page: limit === null ? 1 : page,
        pageSize: limit === null ? "all" : limit,
        total: totals,
        totalPages: limit === null ? 1 : Math.max(1, Math.ceil(totals / limit)),
      },
    },
  })
})

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["new", "reviewed", "replied", "ignored", "converted_to_ticket", "converted_to_lead", "converted_to_task"]).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
})

export const PATCH = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const session = { userId: auth.userId }

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const existing = await prisma.socialMention.findFirst({
    where: { id: parsed.data.id, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Правка тональности — решение человека, поэтому она метится провенансом:
  // кто, когда и из какого значения. Без метки повторный сбор той же записи
  // затирал правку, и владельцу это выглядело как «не сохранилось».
  const now = new Date()
  const updated = await prisma.socialMention.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status, handledAt: now, handledBy: session?.userId } : {}),
      ...(parsed.data.sentiment
        ? {
            sentiment: parsed.data.sentiment,
            sourceMetadata: withOperatorSentimentStamp({
              sourceMetadata: existing.sourceMetadata,
              sentimentBefore: existing.sentiment,
              sentimentAfter: parsed.data.sentiment,
              actorId: session?.userId ?? null,
              at: now,
            }) as Prisma.InputJsonValue,
          }
        : {}),
    },
  })
  return NextResponse.json({ success: true, data: updated })
})
