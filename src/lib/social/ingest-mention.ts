import { prisma } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { applyMonitoringScenariosToMentionInput } from "@/lib/social/monitoring-scenarios"
import { detectArticleLanguage } from "@/lib/social/article-language"
import type { Prisma } from "@prisma/client"
import crypto from "crypto"
import { hmacToken } from "@/lib/secure-token"
import { classifySentiment, crudeSentiment } from "@/lib/sentiment"
import {
  evaluateSubjectRelevance,
  persistSubjectMatches,
  type SubjectMatchDecision,
  type SubjectRelevanceDecision,
} from "@/lib/social/subject-relevance"
import { scheduleMentionMedia, scheduleRejectedMediaCandidate } from "@/lib/social/media-observations"
import { createLegalCandidate, getOrCreateLegalPolicy } from "@/lib/social/legal-workflow"
import { suggestLegalCategory } from "@/lib/social/legal-categories"
import {
  applyRelevanceConfidencePolicy,
  DEFAULT_RELEVANCE_CONFIDENCE_POLICY,
} from "@/lib/social/relevance-confidence-policy"
import { hasCommentComplaintSignal } from "@/lib/social/tiktok-comment-relevance"
import { hasOperatorSentiment } from "@/lib/social/operator-sentiment"
import {
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  resolveAutomaticReviewTriage,
  type AutomaticReviewClassifierSource,
  type AutomaticReviewTextClassification,
} from "@/lib/social/automatic-review-triage"

const INGEST_ENVELOPE_MUTATION_LEASE_MS = 15 * 60_000

/**
 * Отказы сверки строк, которые имеет смысл отдать ИИ-судье (#646): площадка
 * нашла запись по слову, но названия бренда в тексте нет, либо алиас
 * неоднозначен и второго сигнала не нашлось. Смысловая оценка тут может
 * решить то, чего сверка строк не умеет.
 *
 * Остальные отказы в список НЕ входят намеренно: запись вне окна свежести
 * судья не сделает свежей, чужую письменность уже отсекли, а официальный
 * автор архивируется отдельно.
 */
const SUBJECT_MATCH_JUDGE_CANDIDATE_REASONS = new Set([
  "no_monitoring_subject_match",
  "ambiguous_alias_requires_second_signal",
])

/**
 * Insert-or-update a social mention. Returns true when a new row was created,
 * false on a duplicate (already present, fields refreshed). On creation we
 * fire workflow rules for entityType='social_mention', triggerEvent='created'.
 *
 * The find-then-create pattern (instead of pure upsert) is what lets us tell
 * "first time we see this comment" from "we already had it" — Prisma's upsert
 * doesn't expose that flag.
 */
export interface IngestInput {
  organizationId: string
  accountId?: string | null
  platform: string
  externalId: string
  sourceType?: "comment" | "dm" | "mention" | "post" | "manual" | "unknown" | string
  contentKind?: "POST" | "MENTION" | "COMMENT" | "REPLY" | "REVIEW" | "DM" | "UNKNOWN" | string
  postExternalId?: string | null
  parentExternalId?: string | null
  threadExternalId?: string | null
  replyToExternalId?: string | null
  depth?: number
  canonicalUrl?: string | null
  parentPostUrl?: string | null
  editedAt?: Date | null
  deletedAtSource?: Date | null
  sourceProvider?: "native" | "chatwoot" | "manual" | "webhook" | "poller" | string
  sourceMetadata?: Record<string, unknown>
  text: string
  sentiment: "positive" | "neutral" | "negative" | null
  /** Frozen provenance for a sentiment supplied by automatic REVIEW replay. */
  sentimentClassification?: {
    source: Exclude<AutomaticReviewClassifierSource, "RULES">
    version?: string | null
  }
  matchedTerm: string | null
  engagement?: number
  reach?: number
  url?: string | null
  authorName?: string | null
  authorHandle?: string | null
  authorAvatar?: string | null
  publishedAt?: Date | null
  observation?: IngestObservationContext
  /**
   * Parent-post provenance for comment collectors. This context may link an
   * observation to its source post. A server-resolved negative parent may
   * authorize complete thread capture for the exact subjects that matched the
   * publication; other verified parents only supply complaint context.
   */
  parentMatchContext?: ParentMatchContext | null
  /**
   * Приговор ИИ-судьи (#646) по объектам, посчитанный ВНЕ приёма.
   *
   * Судья — сетевой вызов, поэтому внутри ingest он не живёт: вердикт считает
   * отдельный проход по сохранённым кандидатам и передаёт готовым. Работает
   * только в одну сторону — «про нас» добавляет второй сигнал неоднозначному
   * алиасу. Права отклонять у судьи нет: замер 2026-08-03 показал 40 из 40 на
   * явных упоминаниях бренда, но обратную сторону (сколько настоящих находок
   * он назвал бы чужими) на такой выборке не измерить, а цена ошибки — потеря
   * жалобы клиента.
   */
  aiRelevanceJudge?: {
    version: string
    /** subjectId → вердикт судьи по этому объекту. */
    verdicts: Record<string, "about_subject" | "not_about_subject" | "unsure">
  } | null
}

export interface ParentMatchContext {
  parentMentionId: string | null
  matchedTerm: string | null
  subjectIds: string[]
  /** Stored sentiment of the resolved parent mention, retained for audit. */
  parentSentiment?: string | null
  /**
   * Subject-scoped allow-list for complete COMMENT/REPLY inheritance. This is
   * populated only from a non-deleted, non-purged negative parent carrying a
   * durable MATCHED subject link.
   */
  inheritAllCommentSubjectIds?: string[]
}

export interface IngestObservationContext {
  sourceId?: string | null
  collectorRunId?: string | null
  routePlanId?: string | null
  providerRunId?: string | null
  adapterKey?: string
  providerKey?: string | null
  providerItemId?: string | null
  idempotencyKey?: string
  acquisitionMode?: string
  rawPayload?: Record<string, unknown>
  policySnapshot?: Record<string, unknown>
  /** Explicit collector decision. PR3 supplies richer subject matching. */
  relevanceStatus?: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  relevanceReason?: string
  relevanceConfidence?: number
  matchedTerms?: string[]
  /**
   * External comments normally require a direct match from their own text.
   * The sole contextual exception is a server-resolved, subject-scoped
   * negative parent authorizing complete thread capture.
   */
  requireMatchedTerm?: boolean
}

export interface IngestResult {
  id: string
  created: boolean
  accepted?: boolean
  envelopeId?: string
  /** Final observation decision when the item did not enter the mention feed. */
  relevanceStatus?: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  relevanceReason?: string
  automaticReviewTriage?: IngestAutomaticReviewTriageProvenance
}

export type IngestAutomaticReviewTriageProvenance = {
  version: typeof AUTOMATIC_REVIEW_TRIAGE_VERSION
  resolved: boolean
  originalReason: string
  decisionStatus: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  decisionReason: string
  classification: AutomaticReviewTextClassification
  sentiment: "positive" | "neutral" | "negative" | "unknown"
  classifierSource: AutomaticReviewClassifierSource
  classifierVersion: string
  classifierEvidence: string
  providerFetchPerformed: false
}

export type IngestAutoReviewDecisionContext = {
  runId: string
  decisionId: string
  subjectId: string
}

export type IngestOperatorReviewDecisionContext = {
  envelopeId: string
  subjectId: string
  actorId?: string
}

function activeSuppressionGuards(
  autoReviewDecision: IngestAutoReviewDecisionContext | undefined,
): Prisma.IngestEnvelopeWhereInput[] {
  if (!autoReviewDecision) {
    return [{
      discoveryAutoReviewDecisions: {
        none: { state: "SUPPRESSED" },
      },
    }]
  }
  return [
    {
      discoveryAutoReviewDecisions: {
        some: {
          id: autoReviewDecision.decisionId,
          runId: autoReviewDecision.runId,
          state: "SUPPRESSED",
          action: "RELEASE_TO_NORMAL_PIPELINE",
          run: {
            subjectId: autoReviewDecision.subjectId,
            state: "APPLIED",
          },
        },
      },
    },
    {
      discoveryAutoReviewDecisions: {
        none: {
          state: "SUPPRESSED",
          id: { not: autoReviewDecision.decisionId },
        },
      },
    },
  ]
}

type ExistingMentionForDedupe = {
  id: string
  clusterId?: string | null
  matchedTerm?: string | null
  sourceMetadata?: unknown
  url?: string | null
  canonicalUrl?: string | null
  text?: string | null
  authorName?: string | null
  authorHandle?: string | null
  publishedAt?: Date | null
  createdAt?: Date | null
  contentVersion?: number
}

function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)
}

export function normalizeMentionUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    url.hash = ""
    const removableParams = [
      "fbclid",
      "gclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "ref",
      "ref_src",
      "utm_campaign",
      "utm_content",
      "utm_medium",
      "utm_source",
      "utm_term",
    ]
    for (const param of removableParams) url.searchParams.delete(param)
    const params = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b))
    url.search = ""
    for (const [key, itemValue] of params) url.searchParams.append(key, itemValue)
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "")
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().replace(/\/$/, "")
  } catch {
    return value.trim().toLowerCase()
  }
}

export function mentionTextFingerprint(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}#@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized.length < 16) return null
  return hashKey(normalized)
}

function authorKey(value: Pick<IngestInput, "authorHandle" | "authorName"> | ExistingMentionForDedupe): string | null {
  const handle = value.authorHandle?.trim().replace(/^@+/, "").toLowerCase()
  if (handle) return `h:${handle}`
  const name = value.authorName?.trim().toLowerCase().replace(/\s+/g, " ")
  return name ? `n:${name}` : null
}

function dayBucket(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return value.toISOString().slice(0, 10)
}

function clusterKeyForInput(input: IngestInput): string {
  const textKey = mentionTextFingerprint(input.text)
  const bucket = dayBucket(input.publishedAt ?? null)
  const author = authorKey(input) ?? "unknown"
  if (textKey && bucket) return `text:${hashKey(`${input.platform}:${textKey}:${author}:${bucket}`)}`
  const normalizedUrl = normalizeMentionUrl(input.url)
  if (normalizedUrl) return `url:${hashKey(`${input.platform}:${normalizedUrl}`)}`
  return `external:${hashKey(`${input.platform}:${input.externalId}`)}`
}

function contentKindForInput(input: IngestInput): string {
  const explicitKind = input.contentKind?.trim().toUpperCase()
  if (explicitKind && explicitKind !== "UNKNOWN") return explicitKind
  switch ((input.sourceType ?? "unknown").toLowerCase()) {
    case "post": return "POST"
    case "comment": return "COMMENT"
    case "reply": return "REPLY"
    case "review": return "REVIEW"
    case "dm": return "DM"
    case "mention": return "MENTION"
    default: return "UNKNOWN"
  }
}

function isCommentLike(input: IngestInput): boolean {
  const kind = contentKindForInput(input)
  return kind === "COMMENT" || kind === "REPLY"
}

function metadataString(metadata: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function canonicalFieldsForInput(input: IngestInput) {
  const commentLike = isCommentLike(input)
  const explicitCommentUrl = input.canonicalUrl
    ?? metadataString(input.sourceMetadata, "commentUrl", "commentPermalink")
  return {
    contentKind: contentKindForInput(input),
    postExternalId: input.postExternalId ?? metadataString(input.sourceMetadata, "postExternalId", "postId", "videoId"),
    parentExternalId: input.parentExternalId ?? metadataString(input.sourceMetadata, "parentExternalId", "parentCommentId"),
    threadExternalId: input.threadExternalId ?? metadataString(input.sourceMetadata, "threadExternalId", "threadId", "conversationId"),
    replyToExternalId: input.replyToExternalId ?? metadataString(input.sourceMetadata, "replyToExternalId", "replyToCommentId"),
    depth: Math.max(0, Math.trunc(input.depth ?? (contentKindForInput(input) === "REPLY" ? 1 : 0))),
    canonicalUrl: normalizeMentionUrl(commentLike ? explicitCommentUrl : (input.canonicalUrl ?? input.url)),
    parentPostUrl: normalizeMentionUrl(input.parentPostUrl ?? (commentLike
      ? metadataString(input.sourceMetadata, "parentPostUrl", "sourcePostUrl", "postUrl", "videoUrl") ?? input.url ?? null
      : null),
    ),
  }
}

function topicForInput(input: IngestInput): string | null {
  if (input.matchedTerm?.trim()) return input.matchedTerm.trim().slice(0, 120)
  return input.text.replace(/\s+/g, " ").trim().slice(0, 120) || null
}

function clusterRiskForInput(input: IngestInput): string {
  if (input.sentiment === "negative") return "high"
  return "medium"
}

async function findExistingMentionForInput(input: IngestInput): Promise<ExistingMentionForDedupe | null> {
  const exact = await prisma.socialMention.findUnique({
    where: {
      organizationId_platform_externalId: {
        organizationId: input.organizationId,
        platform: input.platform,
        externalId: input.externalId,
      },
    },
    select: { id: true, clusterId: true, matchedTerm: true, sourceMetadata: true, text: true, contentVersion: true },
  })
  if (exact) return exact

  // A URL can be a comment identity only when an adapter explicitly labels it
  // as such. Never infer it from input.url: legacy collectors commonly put the
  // parent post permalink there.
  const canonicalCommentUrl = isCommentLike(input)
    ? normalizeMentionUrl(input.canonicalUrl ?? metadataString(input.sourceMetadata, "commentUrl", "commentPermalink"))
    : null
  if (canonicalCommentUrl) {
    const candidates: ExistingMentionForDedupe[] = await prisma.socialMention.findMany({
      where: {
        organizationId: input.organizationId,
        platform: input.platform,
        canonicalUrl: { not: null },
        contentKind: { in: ["COMMENT", "REPLY"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, clusterId: true, matchedTerm: true, sourceMetadata: true, canonicalUrl: true },
    })
    const urlDuplicate = candidates.find(
      (candidate: ExistingMentionForDedupe) => normalizeMentionUrl(candidate.canonicalUrl) === canonicalCommentUrl,
    )
    if (urlDuplicate) return urlDuplicate
  }

  // Comments legitimately share the parent post's URL (FB/IG/YouTube pollers store the
  // post permalink), so URL-dedupe would collapse every comment under a post into one
  // row. Comment/reply identity relies on stable external IDs; text similarity is a
  // cluster signal only. Symmetrically, a post/mention input must never absorb a
  // comment/reply row that happens to carry the same parent-post URL.
  const normalizedUrl = isCommentLike(input) ? null : normalizeMentionUrl(input.url)
  if (normalizedUrl) {
    const candidates: ExistingMentionForDedupe[] = await prisma.socialMention.findMany({
      where: {
        organizationId: input.organizationId,
        platform: input.platform,
        url: { not: null },
        contentKind: { notIn: ["COMMENT", "REPLY"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, clusterId: true, matchedTerm: true, sourceMetadata: true, url: true },
    })
    const urlDuplicate = candidates.find((candidate: ExistingMentionForDedupe) => normalizeMentionUrl(candidate.url) === normalizedUrl)
    if (urlDuplicate) return urlDuplicate
  }

  // Text/author/day is intentionally not an identity tier. Repeated text can be
  // two legitimate comments, while copied text across providers is only a
  // similarity signal. attachMentionCluster() groups those rows without deleting
  // either occurrence.
  return null
}

async function attachMentionCluster(input: IngestInput, mentionId: string, incrementCount: boolean): Promise<void> {
  const clusterKey = clusterKeyForInput(input)
  const seenAt = input.publishedAt ?? new Date()
  const cluster = await prisma.mentionCluster.upsert({
    where: {
      organizationId_clusterKey: {
        organizationId: input.organizationId,
        clusterKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      clusterKey,
      primaryMentionId: mentionId,
      topic: topicForInput(input),
      sentiment: input.sentiment,
      riskLevel: clusterRiskForInput(input),
      mentionCount: 1,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    },
    update: {
      ...(incrementCount ? { mentionCount: { increment: 1 } } : {}),
      lastSeenAt: seenAt,
      ...(input.sentiment ? { sentiment: input.sentiment } : {}),
      riskLevel: clusterRiskForInput(input),
    },
    select: { id: true },
  })

  await prisma.socialMention.update({
    where: { organizationId_id: { organizationId: input.organizationId, id: mentionId } },
    data: { clusterId: cluster.id },
  })
}

export { findMatchedKeyword } from "@/lib/social/keyword-match"

async function persistMentionWithResult(
  effectiveInput: IngestInput,
  options: { suppressWorkflows?: boolean } = {},
): Promise<IngestResult> {
  const canonical = canonicalFieldsForInput(effectiveInput)

  // A source must never erase fields it doesn't know about: re-polls and webhook
  // redeliveries update only what they carry (a webhook without url/engagement must
  // not null the permalink the poller stored), and sourceMetadata is MERGED so stamps
  // written by other subsystems (socialTriage, phoneLead) survive re-ingestion.
  const updateExisting = async (existing: ExistingMentionForDedupe): Promise<IngestResult> => {
    let currentExisting = existing
    const persist = async () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const currentMeta =
        currentExisting.sourceMetadata && typeof currentExisting.sourceMetadata === "object" && !Array.isArray(currentExisting.sourceMetadata)
          ? (currentExisting.sourceMetadata as Record<string, unknown>)
          : {}
      const mergedMetadata = { ...currentMeta, ...(effectiveInput.sourceMetadata ?? {}) }
      const textChanged = typeof currentExisting.text === "string" && currentExisting.text !== effectiveInput.text
      const nextVersion = (currentExisting.contentVersion ?? 1) + (textChanged ? 1 : 0)

      await tx.socialMention.update({
        where: {
          organizationId_id: {
            organizationId: effectiveInput.organizationId,
            id: existing.id,
          },
        },
        data: {
          text: effectiveInput.text,
          // Тональность, закреплённую человеком, сбор не переписывает. Рядом уже
          // стоит правило «источник не должен стирать поля, которых не знает» —
          // тональность из него выпадала, и правка владельца исчезала при
          // очередном сборе той же записи.
          ...(hasOperatorSentiment(currentMeta) ? {} : { sentiment: effectiveInput.sentiment }),
          contentKind: canonical.contentKind,
          ...(canonical.postExternalId ? { postExternalId: canonical.postExternalId } : {}),
          ...(canonical.parentExternalId ? { parentExternalId: canonical.parentExternalId } : {}),
          ...(canonical.threadExternalId ? { threadExternalId: canonical.threadExternalId } : {}),
          ...(canonical.replyToExternalId ? { replyToExternalId: canonical.replyToExternalId } : {}),
          depth: canonical.depth,
          ...(canonical.canonicalUrl ? { canonicalUrl: canonical.canonicalUrl } : {}),
          ...(canonical.parentPostUrl ? { parentPostUrl: canonical.parentPostUrl } : {}),
          ...(textChanged ? { contentVersion: nextVersion, editedAt: effectiveInput.editedAt ?? new Date() } : {}),
          ...(effectiveInput.deletedAtSource !== undefined ? { deletedAtSource: effectiveInput.deletedAtSource } : {}),
          ...(effectiveInput.publishedAt ? { publishedAt: effectiveInput.publishedAt } : {}),
          ...(effectiveInput.reach !== undefined ? { reach: effectiveInput.reach } : {}),
          ...(effectiveInput.engagement !== undefined ? { engagement: effectiveInput.engagement } : {}),
          ...(effectiveInput.url ? { url: effectiveInput.url } : {}),
          ...(effectiveInput.sourceType ? { sourceType: effectiveInput.sourceType } : {}),
          ...(effectiveInput.sourceProvider ? { sourceProvider: effectiveInput.sourceProvider } : {}),
          sourceMetadata: mergedMetadata as never,
          // Backfill only: a row that never matched a term can gain one (self-healing
          // legacy rows into the "search" stream), but an existing match is never
          // overwritten — the first matched term is the one scenarios acted on.
          ...(!currentExisting.matchedTerm && effectiveInput.matchedTerm ? { matchedTerm: effectiveInput.matchedTerm } : {}),
          ...(effectiveInput.authorName ? { authorName: effectiveInput.authorName } : {}),
          ...(effectiveInput.authorHandle ? { authorHandle: effectiveInput.authorHandle } : {}),
          ...(effectiveInput.authorAvatar ? { authorAvatar: effectiveInput.authorAvatar } : {}),
        },
      })
      if (textChanged) {
        await tx.socialMentionVersion.create({
          data: {
            organizationId: effectiveInput.organizationId,
            mentionId: existing.id,
            version: nextVersion,
            text: effectiveInput.text,
            sourceMetadata: mergedMetadata as never,
            publishedAt: effectiveInput.publishedAt ?? null,
            editedAt: effectiveInput.editedAt ?? new Date(),
          },
        })
      }
    }, { isolationLevel: "Serializable" })

    for (let attempt = 0; ; attempt += 1) {
      try {
        await persist()
        break
      } catch (error) {
        const code = (error as { code?: string })?.code
        if ((code !== "P2034" && code !== "P2002") || attempt >= 2) throw error
        const refreshed = await prisma.socialMention.findFirst({
          where: { id: existing.id, organizationId: effectiveInput.organizationId },
          select: { id: true, text: true, contentVersion: true, matchedTerm: true, sourceMetadata: true },
        })
        if (!refreshed) throw new Error("social_mention_disappeared_during_update")
        currentExisting = refreshed
      }
    }
    await attachMentionCluster(effectiveInput, existing.id, false)
    return { id: existing.id, created: false }
  }

  const existing = await findExistingMentionForInput(effectiveInput)
  if (existing) return updateExisting(existing)

  let created: { id: string } & Record<string, unknown>
  try {
    created = await prisma.socialMention.create({
      data: {
        organizationId: effectiveInput.organizationId,
        accountId: effectiveInput.accountId ?? null,
        platform: effectiveInput.platform,
        externalId: effectiveInput.externalId,
        sourceType: effectiveInput.sourceType ?? "unknown",
        contentKind: canonical.contentKind,
        postExternalId: canonical.postExternalId,
        parentExternalId: canonical.parentExternalId,
        threadExternalId: canonical.threadExternalId,
        replyToExternalId: canonical.replyToExternalId,
        depth: canonical.depth,
        canonicalUrl: canonical.canonicalUrl,
        parentPostUrl: canonical.parentPostUrl,
        editedAt: effectiveInput.editedAt ?? null,
        deletedAtSource: effectiveInput.deletedAtSource ?? null,
        acquisitionMode: observationAcquisitionMode(effectiveInput),
        policySnapshot: (effectiveInput.observation?.policySnapshot ?? {}) as Prisma.InputJsonValue,
        retentionClass: "OPERATIONAL_180D",
        purgeAt: new Date((effectiveInput.publishedAt ?? new Date()).getTime() + 180 * 86_400_000),
        sourceProvider: effectiveInput.sourceProvider ?? "manual",
        sourceMetadata: effectiveInput.sourceMetadata ?? {},
        text: effectiveInput.text,
        sentiment: effectiveInput.sentiment,
        matchedTerm: effectiveInput.matchedTerm,
        engagement: effectiveInput.engagement ?? 0,
        reach: effectiveInput.reach ?? 0,
        url: effectiveInput.url ?? null,
        authorName: effectiveInput.authorName ?? null,
        authorHandle: effectiveInput.authorHandle ?? null,
        authorAvatar: effectiveInput.authorAvatar ?? null,
        publishedAt: effectiveInput.publishedAt ?? null,
        versions: {
          create: {
            version: 1,
            text: effectiveInput.text,
            sourceMetadata: effectiveInput.sourceMetadata ?? {},
            publishedAt: effectiveInput.publishedAt ?? null,
            editedAt: effectiveInput.editedAt ?? null,
          },
        },
      },
    })
  } catch (e) {
    // Concurrent ingest of the same externalId (two poll crons, webhook + poller):
    // the find-then-create window lets both pass the dedupe lookup — the loser of the
    // create race falls back to the update path instead of failing the item (the old
    // raw upserts converged here for free).
    if ((e as { code?: string })?.code === "P2002") {
      const raced = await prisma.socialMention.findUnique({
        where: {
          organizationId_platform_externalId: {
            organizationId: effectiveInput.organizationId,
            platform: effectiveInput.platform,
            externalId: effectiveInput.externalId,
          },
        },
        select: { id: true, clusterId: true, matchedTerm: true, sourceMetadata: true, text: true, contentVersion: true },
      })
      if (raced) return updateExisting(raced)
    }
    throw e
  }
  await attachMentionCluster(effectiveInput, created.id, true)

  // Keep workflow side effects inside the caller's tenant collection fence.
  if (!options.suppressWorkflows) {
    await executeWorkflows(effectiveInput.organizationId, "social_mention", "created", {
      id: created.id,
      platform: created.platform,
      sentiment: created.sentiment,
      text: created.text,
      authorName: created.authorName,
      authorHandle: created.authorHandle,
      url: created.url,
      matchedTerm: created.matchedTerm,
      sourceType: created.sourceType,
      sourceProvider: created.sourceProvider,
      sourceMetadata: created.sourceMetadata,
      engagement: created.engagement,
      publishedAt: created.publishedAt,
    }).catch(e => console.error("[ingestMention] workflow execution failed:", e))
  }

  return { id: created.id, created: true }
}

function observationAdapterKey(input: IngestInput): string {
  if (input.observation?.adapterKey?.trim()) return input.observation.adapterKey.trim().toUpperCase()
  const routeAdapter = metadataString(input.sourceMetadata, "routeAdapter")
  if (routeAdapter) return routeAdapter.toUpperCase()
  const provider = input.sourceProvider?.trim().toLowerCase()
  if (provider === "native") return "CONNECTED_ACCOUNT_LEGACY"
  if (provider === "provider_api") return "LICENSED_PROVIDER"
  if (provider === "search_index") return "SEARCH_INDEX_GENERIC"
  if (provider === "browser_capture") return "BROWSER_CAPTURE_READ_ONLY"
  if (provider === "notification_inbox") return "NOTIFICATION_INBOX"
  if (provider === "webhook") return "WEBHOOK_LEGACY"
  if (provider === "poller") return "POLLER_LEGACY"
  return "MANUAL_INGEST"
}

function observationAcquisitionMode(input: IngestInput): string {
  if (input.observation?.acquisitionMode?.trim()) return input.observation.acquisitionMode.trim().toUpperCase()
  const routeMode = metadataString(input.sourceMetadata, "acquisitionMode")
  if (routeMode) return routeMode.toUpperCase()
  if (input.sourceProvider === "native") return input.accountId ? "CONNECTED_ACCOUNT" : "OFFICIAL_API"
  if (input.sourceProvider === "provider_api") return "LICENSED_PROVIDER"
  if (input.sourceProvider === "search_index") {
    const provider = typeof input.sourceMetadata?.provider === "string" ? input.sourceMetadata.provider : null
    return provider === "apify" ? "APIFY_FALLBACK" : "MANUAL_URL"
  }
  return "MANUAL_URL"
}

function observationDecision(input: IngestInput, subjectDecision: SubjectRelevanceDecision | null): {
  status: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  reason: string
  confidence: number
  matchedTerms: string[]
} {
  const context = input.observation
  const matchedTerms = Array.from(new Set([
    ...(context?.matchedTerms ?? []),
    ...(input.matchedTerm ? [input.matchedTerm] : []),
  ].map(term => term.trim()).filter(Boolean)))
  // Deleted/source-policy decisions stay terminal even when a parent matched.
  // They represent acquisition legality/source state, not comment relevance.
  if (input.deletedAtSource) return { status: "DELETED_AT_SOURCE", reason: "source_deleted", confidence: 1, matchedTerms }
  if (["REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE"].includes(context?.relevanceStatus ?? "")) {
    return {
      status: context!.relevanceStatus as "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE",
      reason: context?.relevanceReason ?? "collector_explicit_decision",
      confidence: context?.relevanceConfidence ?? 0,
      matchedTerms,
    }
  }
  // Owner policy: once a negative publication has a durable subject match,
  // every real comment/reply in that thread is useful context. The inherited
  // subject decision is stronger than collector text heuristics such as
  // "neutral comment -> REVIEW", while remaining tenant + subject scoped.
  const negativeParentInherited = isCommentLike(input)
    && subjectDecision?.matches.some(match => (
      match.status === "MATCHED" && match.reason === "negative_parent_post_inheritance"
    )) === true
  if (negativeParentInherited && subjectDecision?.status === "ACCEPTED") {
    return {
      status: "ACCEPTED",
      reason: subjectDecision.reason,
      confidence: subjectDecision.confidence,
      matchedTerms: Array.from(new Set([...matchedTerms, ...subjectDecision.matchedTerms])),
    }
  }
  // Other explicit negative decisions remain terminal. Collector-side
  // ACCEPTED only means "the adapter fetched what it was asked for"; when
  // subjects exist it must still pass the tenant's subject/context matcher.
  if (context?.relevanceStatus && context.relevanceStatus !== "ACCEPTED") {
    return {
      status: context.relevanceStatus,
      reason: context.relevanceReason ?? "collector_explicit_decision",
      confidence: context.relevanceConfidence ?? 0,
      matchedTerms,
    }
  }
  if (
    context?.relevanceStatus === "ACCEPTED"
    && context.relevanceReason === "reply_to_actionable_comment"
  ) {
    return {
      status: "ACCEPTED",
      reason: context.relevanceReason,
      confidence: context.relevanceConfidence ?? 1,
      matchedTerms,
    }
  }
  if (subjectDecision) {
    return {
      status: subjectDecision.status,
      reason: subjectDecision.reason,
      confidence: subjectDecision.confidence,
      matchedTerms: Array.from(new Set([...matchedTerms, ...subjectDecision.matchedTerms])),
    }
  }
  if (context?.relevanceStatus === "ACCEPTED") {
    return {
      status: "ACCEPTED",
      reason: context.relevanceReason ?? "collector_explicit_decision",
      confidence: context.relevanceConfidence ?? 1,
      matchedTerms,
    }
  }
  if (context?.requireMatchedTerm && matchedTerms.length === 0) {
    return { status: "REJECTED", reason: "external_comment_has_no_own_subject_match", confidence: 1, matchedTerms }
  }
  // PR2 preserves existing connected/owned ingest semantics. PR3 adds subject,
  // context and lightweight-classifier decisions before this acceptance point.
  return { status: "ACCEPTED", reason: matchedTerms.length > 0 ? "exact_term_match" : "trusted_collector_scope", confidence: 1, matchedTerms }
}

function observationIdempotencyKey(input: IngestInput, contentHmac: string): string {
  if (input.observation?.idempotencyKey?.trim()) return input.observation.idempotencyKey.trim()
  const providerItem = input.observation?.providerItemId?.trim() || input.externalId
  const revision = input.editedAt?.toISOString() || contentHmac.slice(0, 16)
  return `ingest:${input.platform}:${providerItem}:${revision}`.slice(0, 500)
}

function sanitizedRawPayload(input: IngestInput): Prisma.InputJsonValue {
  const raw = input.observation?.rawPayload ?? {}
  try {
    return JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue
  } catch {
    return {}
  }
}

async function rememberRejectedObservation(input: IngestInput, adapterKey: string, contentHmac: string, reasonCode: string, now: Date) {
  await prisma.rejectedObservationFingerprint.upsert({
    where: {
      organizationId_adapterKey_fingerprintHmac: {
        organizationId: input.organizationId,
        adapterKey,
        fingerprintHmac: contentHmac,
      },
    },
    create: {
      organizationId: input.organizationId,
      sourceId: input.observation?.sourceId ?? metadataString(input.sourceMetadata, "monitoringSourceId"),
      adapterKey,
      providerKey: input.observation?.providerKey ?? metadataString(input.sourceMetadata, "provider"),
      fingerprintHmac: contentHmac,
      reasonCode,
      firstSeenAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 14 * 86_400_000),
    },
    update: {
      duplicateCount: { increment: 1 },
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 14 * 86_400_000),
      reasonCode,
    },
  })
}

/**
 * The single observation boundary for every social collector. Existing pollers
 * call this export already, while PR2 route-aware adapters provide `observation`
 * context. Rejected content is inserted only in scrubbed form and can never
 * reach SocialMention, agent memory, embeddings or workflows, except for
 * official-author posts retained as a workflow-free, subject-linked archive.
 */
export async function ingestMentionWithResult(
  input: IngestInput,
  options: {
    envelopeMutationKey?: string
    autoReviewDecision?: IngestAutoReviewDecisionContext
    operatorReviewDecision?: IngestOperatorReviewDecisionContext
    suppressWorkflows?: boolean
    suppressMediaScheduling?: boolean
  } = {},
): Promise<IngestResult> {
  let effectiveInput = await applyMonitoringScenariosToMentionInput(input)
  // Язык проставляем эвристикой при инжесте — до ветвления на официальный
  // архив и принятые находки: обе ветки фильтруются языковым фильтром ленты,
  // и без socialTriage.language языковой фильтр прячет находку.
  //
  // Раньше это работало только для `web`, потому что веб-статьи не проходят
  // AI-триаж. Но и соцсети остались без языка: на проде у 927 находок из 941
  // его нет вообще (az — 5, en — 8, ru — 1). Поэтому детектор работает для
  // всех площадок как ЗАПАСНОЙ вариант.
  //
  // Он не спорит с AI: значение пишется только когда языка ещё нет, и никогда
  // не перезаписывает уже проставленный. При неуверенности детектор возвращает
  // null — честное «неизвестно» лучше ложной метки, которая спрячет находку
  // из-под языкового фильтра.
  {
    const detectedLanguage = detectArticleLanguage(effectiveInput.text)
    const sourceMetadata = { ...(effectiveInput.sourceMetadata ?? {}) }
    const existingTriage = sourceMetadata.socialTriage
    const socialTriage = existingTriage && typeof existingTriage === "object" && !Array.isArray(existingTriage)
      ? { ...(existingTriage as Record<string, unknown>) }
      : {}
    if (detectedLanguage && !socialTriage.language) {
      socialTriage.language = detectedLanguage
      socialTriage.languageSource = "heuristic"
      effectiveInput = { ...effectiveInput, sourceMetadata: { ...sourceMetadata, socialTriage } }
    }
  }
  const subjectDecision = await evaluateSubjectRelevance(effectiveInput)
  const sourceMetadata = effectiveInput.sourceMetadata ?? {}
  const operatorReviewDecision = options.operatorReviewDecision
  const operatorReviewAuthorized = Boolean(
    operatorReviewDecision
    && options.envelopeMutationKey
    && !options.autoReviewDecision
    && (
      (
        effectiveInput.observation?.relevanceStatus === "ACCEPTED"
        && effectiveInput.observation.relevanceReason === "operator_review_accept"
      )
      || (
        effectiveInput.observation?.relevanceStatus === "REVIEW"
        && effectiveInput.observation.relevanceReason === AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON
        && sourceMetadata.queuedOperatorReview === true
      )
    )
    && sourceMetadata.reviewOverride === true
    && sourceMetadata.replayedFromEnvelopeId === operatorReviewDecision.envelopeId
    && sourceMetadata.targetSubjectId === operatorReviewDecision.subjectId
    && !effectiveInput.deletedAtSource,
  )
  if (operatorReviewDecision && !operatorReviewAuthorized) {
    throw new Error("Invalid operator review override context")
  }
  const now = new Date()
  const adapterKey = observationAdapterKey(effectiveInput)
  const contentHmac = hmacToken(JSON.stringify({
    platform: effectiveInput.platform,
    externalId: effectiveInput.externalId,
    text: effectiveInput.text,
    authorName: effectiveInput.authorName ?? null,
    authorHandle: effectiveInput.authorHandle ?? null,
    url: effectiveInput.url ?? null,
  }), `social-observation:${effectiveInput.organizationId}`)
  const idempotencyKey = observationIdempotencyKey(effectiveInput, contentHmac)
  const confidencePolicy = DEFAULT_RELEVANCE_CONFIDENCE_POLICY
  const currentMatchedSubjects = subjectDecision?.matches.filter(
    match => match.status === "MATCHED",
  ) ?? []
  const currentTargetMatch = options.autoReviewDecision
    && subjectDecision?.status === "ACCEPTED"
    && subjectDecision.confidence >= confidencePolicy.minAutoAcceptConfidence
    && currentMatchedSubjects.length === 1
    && currentMatchedSubjects[0].subjectId === options.autoReviewDecision.subjectId
    && currentMatchedSubjects[0].confidence >= confidencePolicy.minAutoAcceptConfidence
    ? currentMatchedSubjects[0]
    : null
  const confidenceBoundDecision = applyRelevanceConfidencePolicy(
    observationDecision(effectiveInput, subjectDecision),
    confidencePolicy,
  )
  // An operator validates subject relevance, not sentiment. Apply that scoped
  // relevance override before the universal comment gate so negative/neutral
  // comments can be admitted, positives are rejected, and unknown text is
  // queued for the bounded classifier without losing the selected subject.
  const triageInputDecision = operatorReviewAuthorized
    ? {
        ...confidenceBoundDecision,
        status: "ACCEPTED" as const,
        reason: "operator_review_accept",
        confidence: 1,
      }
    : confidenceBoundDecision
  const automaticReviewTriage = resolveAutomaticReviewTriage({
    decision: triageInputDecision,
    subjectDecision,
    contentKind: contentKindForInput(effectiveInput),
    text: effectiveInput.text,
    sentiment: effectiveInput.sentiment,
    sentimentClassification: effectiveInput.sentimentClassification,
    url: effectiveInput.url,
    canonicalUrl: effectiveInput.canonicalUrl,
    parentPostUrl: effectiveInput.parentPostUrl,
    publishedAt: effectiveInput.publishedAt,
    rawPayload: effectiveInput.observation?.rawPayload,
    policySnapshot: effectiveInput.observation?.policySnapshot,
    parentMatchContext: effectiveInput.parentMatchContext,
  })
  const automaticReviewTriageProvenance: IngestAutomaticReviewTriageProvenance | undefined =
    automaticReviewTriage.classifierSource
    && automaticReviewTriage.classifierVersion
    && automaticReviewTriage.classifierEvidence
      ? {
          version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
          resolved: automaticReviewTriage.resolved,
          originalReason: automaticReviewTriage.originalReason,
          decisionStatus: automaticReviewTriage.decision.status,
          decisionReason: automaticReviewTriage.decision.reason,
          classification: automaticReviewTriage.classification,
          sentiment: automaticReviewTriage.sentiment,
          classifierSource: automaticReviewTriage.classifierSource,
          classifierVersion: automaticReviewTriage.classifierVersion,
          classifierEvidence: automaticReviewTriage.classifierEvidence,
          providerFetchPerformed: false,
        }
      : undefined
  if (
    automaticReviewTriage.resolved
    && automaticReviewTriage.decision.status === "ACCEPTED"
    && automaticReviewTriage.sentiment !== "unknown"
  ) {
    // The admission decision and persisted sentiment must be identical. Do not
    // run the asynchronous AI enrichment after a deterministic neutral/negative
    // gate: a later positive result would violate the selected feed policy.
    effectiveInput = { ...effectiveInput, sentiment: automaticReviewTriage.sentiment }
  }
  if (automaticReviewTriageProvenance) {
    effectiveInput = {
      ...effectiveInput,
      sourceMetadata: {
        ...(effectiveInput.sourceMetadata ?? {}),
        automaticReviewSentiment: {
          sentiment: automaticReviewTriageProvenance.sentiment,
          classification: automaticReviewTriageProvenance.classification,
          source: automaticReviewTriageProvenance.classifierSource,
          classifierVersion: automaticReviewTriageProvenance.classifierVersion,
        },
      },
      observation: {
        ...(effectiveInput.observation ?? {}),
        policySnapshot: {
          ...(effectiveInput.observation?.policySnapshot ?? {}),
          automaticReviewTriage: automaticReviewTriageProvenance,
        },
      },
    }
  }
  const currentDecision = automaticReviewTriage.decision
  const operatorReviewMatch: SubjectMatchDecision | null = operatorReviewDecision
    && currentDecision.status === "ACCEPTED"
    ? {
        subjectId: operatorReviewDecision.subjectId,
        status: "MATCHED",
        reason: "operator_review_accept",
        confidence: 1,
        matchedAliasIds: [],
        matchedTerms: [],
        contextSignals: {
          operatorReviewOverride: true,
          envelopeId: operatorReviewDecision.envelopeId,
          ...(operatorReviewDecision.actorId ? { actorId: operatorReviewDecision.actorId } : {}),
          currentRelevanceStatus: subjectDecision?.status ?? null,
          currentRelevanceReason: subjectDecision?.reason ?? null,
          currentRelevanceConfidence: subjectDecision?.confidence ?? null,
        },
      }
    : null
  const automaticParentReviewMatch: SubjectMatchDecision | null =
    automaticReviewTriage.parentSubjectId
    && currentDecision.status === "ACCEPTED"
    && !subjectDecision?.matches.some(match => (
      match.subjectId === automaticReviewTriage.parentSubjectId
      && match.status === "MATCHED"
    ))
      ? {
          subjectId: automaticReviewTriage.parentSubjectId,
          status: "MATCHED",
          reason: "automatic_review_parent_context",
          confidence: 1,
          matchedAliasIds: [],
          matchedTerms: [],
          contextSignals: {
            automaticReviewTriage: true,
            parentMentionId: effectiveInput.parentMatchContext?.parentMentionId ?? null,
            parentSubjectId: automaticReviewTriage.parentSubjectId,
            originalRelevanceReason: automaticReviewTriage.originalReason,
            sentiment: automaticReviewTriage.sentiment,
          },
        }
      : null
  // A SAFE_RESOLVE release belongs to one active monitoring subject. The
  // ordinary aggregate subject decision may be ACCEPTED because another
  // subject matches, or because a collector supplied an explicit ACCEPTED
  // status while no active subjects remain. Neither is sufficient here:
  // release only when the exact target is still an active, high-confidence
  // MATCHED subject in the freshly evaluated decision.
  const decision = options.autoReviewDecision && !currentTargetMatch
    ? {
        status: "REJECTED" as const,
        reason: "auto_review_target_subject_not_matched",
        confidence: 1,
        matchedTerms: subjectDecision?.matchedTerms ?? [],
      }
    : currentDecision
  const subjectMatchesToPersist = operatorReviewMatch
    ? [operatorReviewMatch]
    : automaticParentReviewMatch
      ? [automaticParentReviewMatch, ...(subjectDecision?.matches ?? []).filter(match => (
          match.subjectId !== automaticParentReviewMatch.subjectId
        ))]
      : subjectDecision?.matches ?? []
  const accepted = decision.status === "ACCEPTED"
  const officialArchive = decision.status === "REJECTED" && decision.reason === "official_author"
  const borrowedMutationLease = Boolean(options.envelopeMutationKey)
  const persistenceMutationKey = accepted || officialArchive
    ? options.envelopeMutationKey ?? crypto.randomUUID()
    : null
  const persistenceMutationUntil = new Date(now.getTime() + INGEST_ENVELOPE_MUTATION_LEASE_MS)
  // Кандидат для ИИ-судьи (#646): сверка строк отклонила запись, потому что
  // названия бренда в тексте нет. Это крупнейший класс потерь, и судить его
  // не по чему, если текст вычищен. Такие записи сохраняем — публичный
  // контент, решение владельца 2026-08-03 — но только их: остальные отказы
  // (вне окна свежести, чужая письменность, официальный автор) судье не
  // помогают и вычищаются как прежде.
  const subjectMatchCandidate = decision.status === "REJECTED"
    && SUBJECT_MATCH_JUDGE_CANDIDATE_REASONS.has(decision.reason)
  const durableObservation = accepted
    || decision.status === "REVIEW"
    || officialArchive
    || subjectMatchCandidate
  const purgeAt = new Date(now.getTime() + (officialArchive
    ? 180 * 86_400_000
    : decision.status === "REVIEW"
      ? confidencePolicy.reviewRetentionDays * 86_400_000
      : subjectMatchCandidate
        ? confidencePolicy.subjectMatchCandidateRetentionDays * 86_400_000
        : 24 * 3_600_000))
  const canonical = canonicalFieldsForInput(effectiveInput)
  const sourceId = effectiveInput.observation?.sourceId ?? metadataString(effectiveInput.sourceMetadata, "monitoringSourceId")
  const collectorRunId = effectiveInput.observation?.collectorRunId ?? metadataString(effectiveInput.sourceMetadata, "collectorRunId")
  const routePlanId = effectiveInput.observation?.routePlanId ?? metadataString(effectiveInput.sourceMetadata, "routePlanId")
  const providerRunId = effectiveInput.observation?.providerRunId ?? metadataString(effectiveInput.sourceMetadata, "providerRunId")
  const providerKey = effectiveInput.observation?.providerKey ?? metadataString(effectiveInput.sourceMetadata, "provider")

  const envelope = await prisma.ingestEnvelope.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: effectiveInput.organizationId,
        idempotencyKey,
      },
    },
    create: {
      organizationId: effectiveInput.organizationId,
      sourceId,
      collectorRunId,
      routePlanId,
      providerRunId,
      adapterKey,
      providerKey,
      providerItemId: effectiveInput.observation?.providerItemId ?? effectiveInput.externalId,
      idempotencyKey,
      acquisitionMode: observationAcquisitionMode(effectiveInput),
      contentKind: canonical.contentKind,
      platform: effectiveInput.platform,
      externalId: effectiveInput.externalId,
      externalIds: {
        externalId: effectiveInput.externalId,
        postExternalId: canonical.postExternalId,
        parentExternalId: canonical.parentExternalId,
        threadExternalId: canonical.threadExternalId,
        replyToExternalId: canonical.replyToExternalId,
      },
      postExternalId: canonical.postExternalId,
      parentExternalId: canonical.parentExternalId,
      threadExternalId: canonical.threadExternalId,
      replyToExternalId: canonical.replyToExternalId,
      depth: canonical.depth,
      // Rejected rows are born scrubbed, except the explicit official-author
      // archive retained for the separate Official filter.
      url: durableObservation ? effectiveInput.url ?? null : null,
      canonicalUrl: durableObservation ? canonical.canonicalUrl : null,
      parentPostUrl: durableObservation ? canonical.parentPostUrl : null,
      authorName: durableObservation ? effectiveInput.authorName ?? null : null,
      authorHandle: durableObservation ? effectiveInput.authorHandle ?? null : null,
      // Аватар — ссылка на изображение живого человека. Судье он не нужен,
      // поэтому у кандидатов не хранится даже при durableObservation.
      authorAvatar: durableObservation && !subjectMatchCandidate
        ? effectiveInput.authorAvatar ?? null
        : null,
      text: durableObservation ? effectiveInput.text : null,
      contentHmac,
      // Сырой ответ провайдера судье не нужен — он читает нормализованный
      // текст. Не храним лишнего: это самый объёмный кусок записи.
      rawPayload: durableObservation && !subjectMatchCandidate
        ? sanitizedRawPayload(effectiveInput)
        : {},
      policySnapshot: {
        ...(effectiveInput.observation?.policySnapshot ?? {
          version: "social-monitoring-v2-pr2",
          decisionSource: "observation-boundary",
        }),
        relevanceConfidencePolicy: confidencePolicy,
        ...(automaticReviewTriageProvenance
          ? { automaticReviewTriage: automaticReviewTriageProvenance }
          : {}),
      } as Prisma.InputJsonValue,
      publishedAt: effectiveInput.publishedAt ?? null,
      editedAt: effectiveInput.editedAt ?? null,
      deletedAtSource: effectiveInput.deletedAtSource ?? null,
      relevanceStatus: decision.status,
      relevanceReason: decision.reason,
      relevanceConfidence: decision.confidence,
      matchedTerms: decision.matchedTerms,
      subjectDecision: (subjectDecision ?? {}) as Prisma.InputJsonValue,
      decidedAt: now,
      purgeAt,
      reviewMutationKey: persistenceMutationKey,
      reviewMutationUntil: persistenceMutationKey ? persistenceMutationUntil : null,
    },
    update: {},
  })

  let persistenceClaimed = Boolean(
    persistenceMutationKey
    && envelope.reviewMutationKey === persistenceMutationKey,
  )
  try {
    if (envelope.acceptedMentionId) {
      // Preserve the observation identity on idempotent redelivery. Downstream
      // publication gates (for example TikTok comment revisits) need the
      // envelope even when the SocialMention was linked by an earlier run.
      return { id: envelope.acceptedMentionId, created: false, envelopeId: envelope.id }
    }

    if (persistenceMutationKey && !persistenceClaimed) {
      const claimGuards = {
        id: envelope.id,
        organizationId: effectiveInput.organizationId,
        acceptedMentionId: null,
        purgedAt: null,
        AND: [
          ...activeSuppressionGuards(options.autoReviewDecision),
          {
            OR: [
              { reviewMutationUntil: null },
              { reviewMutationUntil: { lte: now } },
            ],
          },
        ],
      }
      // Обычный захват живого конверта — ровно как раньше, окно не трогаем.
      // Сокращать его нельзя: конверт в очереди оператора живёт дольше
      // суток, и свежее решение по тому же элементу не имеет права укорачивать
      // его срок.
      let claimed = await prisma.ingestEnvelope.updateMany({
        where: { ...claimGuards, purgeAt: { gt: persistenceMutationUntil } },
        data: {
          reviewMutationKey: persistenceMutationKey,
          reviewMutationUntil: persistenceMutationUntil,
        },
      })
      if (claimed.count !== 1) {
        // Окно истекло — продлеваем ТЕМ ЖЕ атомарным апдейтом вместо отказа.
        // Прежде истёкшее окно было условием захвата, и это заклинивало
        // повторную доставку намертво: отклонённый конверт живёт 24 часа, а
        // его ключ идемпотентности — вечно. Через сутки любая повторная
        // доставка той же записи упиралась в просроченный конверт, захват
        // срывался, и код объявлял это «уже пишется» — навсегда (прод,
        // 2026-08-01: 1185 из 1308 отклонённых конвертов были просрочены).
        // Содержимое старого конверта для приёма не нужно: текст приходит со
        // свежей доставкой.
        claimed = await prisma.ingestEnvelope.updateMany({
          where: { ...claimGuards, purgeAt: { lte: persistenceMutationUntil } },
          data: {
            reviewMutationKey: persistenceMutationKey,
            reviewMutationUntil: persistenceMutationUntil,
            purgeAt,
          },
        })
      }
      persistenceClaimed = claimed.count === 1
      if (!persistenceClaimed) {
        const current = await prisma.ingestEnvelope.findFirst({
          where: {
            id: envelope.id,
            organizationId: effectiveInput.organizationId,
          },
          select: {
            acceptedMentionId: true,
            relevanceStatus: true,
            purgedAt: true,
            // Живая аренда — единственный признак того, что запись идёт ПРЯМО
            // СЕЙЧАС. Без неё неудача захвата означает лишь, что писать больше
            // нечего.
            reviewMutationUntil: true,
            discoveryAutoReviewDecisions: {
              where: { state: "SUPPRESSED" },
              select: { id: true },
              take: 1,
            },
          },
        })
        if (current?.acceptedMentionId) {
          return { id: current.acceptedMentionId, created: false, envelopeId: envelope.id }
        }
        if (current?.discoveryAutoReviewDecisions.length) {
          return {
            id: envelope.id,
            created: false,
            accepted: false,
            envelopeId: envelope.id,
            relevanceStatus: "REVIEW",
          }
        }
        if (!current || current.purgedAt || current.relevanceStatus === "PURGED") {
          throw new Error("Ingest envelope payload has been purged")
        }
        // Настоящая параллельная запись видна по живой аренде — это
        // единственный признак, который о ней действительно говорит.
        if (current.reviewMutationUntil && current.reviewMutationUntil.getTime() > now.getTime()) {
          throw new Error("Ingest envelope persistence is already in progress")
        }
        throw new Error(
          `Ingest envelope persistence could not be claimed (status=${current.relevanceStatus ?? "unknown"})`,
        )
      }
    }

    if (officialArchive) {
      const archivedInput: IngestInput = {
        ...effectiveInput,
        // This stamp is informational only. Subject-match status is the source
        // of truth used by the API to keep official content out of client KPIs.
        sourceMetadata: { ...(effectiveInput.sourceMetadata ?? {}), officialArchive: true },
      }
      const result = await persistMentionWithResult(archivedInput, { suppressWorkflows: true })
      if (subjectMatchesToPersist.length) {
        await persistSubjectMatches(effectiveInput.organizationId, result.id, subjectMatchesToPersist)
      }
      // A replay owns a borrowed envelope lease. Leave both the mention link
      // and the terminal relevance transition to its outer CAS so a crash can
      // never strand a REVIEW row with acceptedMentionId already populated.
      if (!borrowedMutationLease) {
        const linked = await prisma.ingestEnvelope.updateMany({
          where: {
            id: envelope.id,
            organizationId: effectiveInput.organizationId,
            reviewMutationKey: persistenceMutationKey,
            AND: activeSuppressionGuards(options.autoReviewDecision),
          },
          data: {
            acceptedMentionId: result.id,
            acceptedAt: now,
            reviewMutationKey: null,
            reviewMutationUntil: null,
          },
        })
        if (linked.count !== 1) {
          throw new Error("Ingest envelope changed during official archive persistence")
        }
      }
      persistenceClaimed = borrowedMutationLease
      return {
        id: result.id,
        created: result.created,
        accepted: false,
        envelopeId: envelope.id,
        relevanceStatus: "REJECTED",
      }
    }
    if (!accepted) {
      if (decision.status === "DELETED_AT_SOURCE" && effectiveInput.deletedAtSource) {
        await prisma.socialMention.updateMany({
          where: {
            organizationId: effectiveInput.organizationId,
            platform: effectiveInput.platform,
            externalId: effectiveInput.externalId,
            deletedAtSource: null,
          },
          data: { deletedAtSource: effectiveInput.deletedAtSource, status: "ignored" },
        })
      }
      if (
        !options.suppressMediaScheduling
        && ["REJECTED", "REVIEW"].includes(decision.status)
        // Never create detached media for a comment that has not passed the
        // risk admission gate. Otherwise a later positive rejection would
        // leave a discovery lead visible in the media dashboard.
        && !isCommentLike(effectiveInput)
      ) {
        await scheduleRejectedMediaCandidate(effectiveInput, sourceId).catch(error => {
          console.error("[ingestMention] media candidate scheduling failed:", error)
        })
      }
      if (["REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE"].includes(decision.status)) {
        await rememberRejectedObservation(effectiveInput, adapterKey, contentHmac, decision.reason, now)
      }
      return {
        id: envelope.id,
        created: false,
        accepted: false,
        envelopeId: envelope.id,
        relevanceStatus: decision.status,
        relevanceReason: decision.reason,
        ...(automaticReviewTriageProvenance
          ? { automaticReviewTriage: automaticReviewTriageProvenance }
          : {}),
      }
    }

    try {
      const acceptedSubjectMatches = subjectMatchesToPersist.filter(match => match.status === "MATCHED")
      const inheritanceOnly = isCommentLike(effectiveInput)
        && acceptedSubjectMatches.length > 0
        && acceptedSubjectMatches.every(match => [
          "negative_parent_post_inheritance",
          "automatic_review_parent_context",
        ].includes(match.reason))
      let acceptedInput = effectiveInput
      if (!acceptedInput.sentiment) {
        if (inheritanceOnly) {
          // Complete-thread capture can add hundreds of neutral/off-topic rows.
          // Classify those synchronously with the shared multilingual complaint
          // detector plus the deterministic lexicon instead of serializing one
          // external AI request per comment. Comments with their own alias or
          // complaint match are not inheritance-only and keep full AI triage.
          acceptedInput = {
            ...acceptedInput,
            sentiment: hasCommentComplaintSignal(acceptedInput.text)
              ? "negative"
              : crudeSentiment(acceptedInput.text),
          }
        } else {
          try { acceptedInput = { ...acceptedInput, sentiment: await classifySentiment(acceptedInput.text) } } catch {
            // Sentiment enrichment is non-blocking; accepted source evidence must
            // not be lost because an AI/provider classifier is unavailable.
          }
        }
      }
      // Full-thread capture is intentionally broader than operational action.
      // Persist and classify inheritance-only context, but keep it fail-closed
      // for generic lead/legal/outbound workflows. A comment with its own alias
      // or complaint signal receives a direct subject reason above and remains
      // actionable through the ordinary workflow path.
      const suppressAcceptedWorkflows = options.suppressWorkflows === true
        || inheritanceOnly
      const result = await persistMentionWithResult(acceptedInput, {
        suppressWorkflows: suppressAcceptedWorkflows,
      })
      if (subjectMatchesToPersist.length) {
        await persistSubjectMatches(effectiveInput.organizationId, result.id, subjectMatchesToPersist)
      }
      if (!options.suppressMediaScheduling) {
        await scheduleMentionMedia(
          effectiveInput,
          result.id,
          subjectMatchesToPersist.find(match => match.status === "MATCHED")?.subjectId ?? null,
        ).catch(error => {
          console.error("[ingestMention] accepted media scheduling failed:", error)
        })
      }
      const legalCategory = result.created && !suppressAcceptedWorkflows
        ? suggestLegalCategory(acceptedInput.text)
        : null
      if (legalCategory) {
        await getOrCreateLegalPolicy(effectiveInput.organizationId)
          .then(policy => {
            if (!policy.enabled || !policy.allowedCategories.includes(legalCategory)) return null
            return createLegalCandidate({
              organizationId: effectiveInput.organizationId,
              mentionId: result.id,
              runAi: false,
            })
          })
          .catch(error => {
            console.error("[ingestMention] legal/reputation candidate scheduling failed:", error)
          })
      }
      // Borrowed replay leases must terminalize atomically in the outer
      // replay boundary. Persisting acceptedMentionId here would make a crash
      // between this write and that transition hide the REVIEW row forever.
      if (!borrowedMutationLease) {
        const linked = await prisma.ingestEnvelope.updateMany({
          where: {
            id: envelope.id,
            organizationId: effectiveInput.organizationId,
            reviewMutationKey: persistenceMutationKey,
            AND: activeSuppressionGuards(options.autoReviewDecision),
          },
          data: {
            acceptedMentionId: result.id,
            acceptedAt: now,
            reviewMutationKey: null,
            reviewMutationUntil: null,
          },
        })
        if (linked.count !== 1) {
          throw new Error("Ingest envelope changed during mention persistence")
        }
      }
      persistenceClaimed = borrowedMutationLease
      // Preserve the long-standing accepted-result contract. Collectors only
      // need an explicit flag for rejection (`accepted === false`).
      return {
        ...result,
        ...(borrowedMutationLease && automaticReviewTriageProvenance
          ? { automaticReviewTriage: automaticReviewTriageProvenance }
          : {}),
      }
    } catch (error) {
      // The outer auto-review replay owns borrowed leases and their apply-time
      // content/updatedAt/purgeAt snapshot. Mutating any envelope field here
      // would poison that compare-and-set boundary and make every retry
      // permanently unclaimable. The outer replay releases the lease; a later
      // idempotent retry reconciles any mention already persisted before the
      // downstream failure.
      if (!borrowedMutationLease) {
        await prisma.ingestEnvelope.updateMany({
          where: {
            id: envelope.id,
            organizationId: effectiveInput.organizationId,
            reviewMutationKey: persistenceMutationKey,
            AND: activeSuppressionGuards(options.autoReviewDecision),
          },
          data: {
            relevanceStatus: "REVIEW",
            relevanceReason: "mention_persistence_failed",
            purgeAt: new Date(now.getTime() + 72 * 3_600_000),
            reviewMutationKey: null,
            reviewMutationUntil: null,
          },
        }).catch(() => {})
      }
      persistenceClaimed = borrowedMutationLease
      throw error
    }
  } finally {
    if (persistenceClaimed && persistenceMutationKey && !borrowedMutationLease) {
      await prisma.ingestEnvelope.updateMany({
        where: {
          id: envelope.id,
          organizationId: effectiveInput.organizationId,
          reviewMutationKey: persistenceMutationKey,
        },
        data: {
          reviewMutationKey: null,
          reviewMutationUntil: null,
        },
      }).catch(() => {})
    }
  }
}

export async function ingestMention(input: IngestInput): Promise<boolean> {
  const result = await ingestMentionWithResult(input)
  return result.accepted !== false && result.created
}
