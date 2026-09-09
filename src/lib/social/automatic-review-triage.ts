import {
  classifyDiscoveryCandidateUrl,
  resolveDiscoveryAutoReview,
} from "@/lib/social/discovery-auto-review"
import { hasCommentComplaintSignal } from "@/lib/social/tiktok-comment-relevance"
import { isCondolencePost } from "@/lib/social/condolence-post-signal"

export const AUTOMATIC_REVIEW_TRIAGE_VERSION = "automatic_review_triage_v3"
export const AUTOMATIC_REVIEW_RULES_VERSION = "automatic_review_rules_v3"
export const AUTOMATIC_REVIEW_AI_VERSION = "ai_sentiment_v1"
export const AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON = "automatic_review_technical_unresolved"
export const AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE = "ambiguous_emoji_requires_ai"
export const AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION = "automatic_review_triage_v2"
export const AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_RECOVERY = "V2_AMBIGUOUS_EMOJI_AI_ORDERING"
export const AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY = "V3_DISCOVERY_TERMINAL_POLICY"
export const AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY_VERSION =
  "automatic_review_triage_v3_discovery_recovery_v1"
export const AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON = "comment_sentiment_requires_review"
export const AUTOMATIC_REVIEW_COMMENT_SUBJECT_UNRESOLVED_REASON =
  "automatic_review_comment_subject_unresolved"
export const AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON =
  "automatic_review_discovery_missing_publish_date"
export const AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON =
  "automatic_review_discovery_insufficient_independent_identity"
export const AUTOMATIC_REVIEW_DISCOVERY_RECOVERY_FALLBACK_REJECTION_REASON =
  "automatic_review_discovery_recovery_unresolved_evidence"

export type AutomaticReviewSentiment = "positive" | "neutral" | "negative" | "unknown"
export type AutomaticReviewTextClassification = AutomaticReviewSentiment | "irrelevant"
export type AutomaticReviewClassifierSource = "RULES" | "AI" | "PROVIDED"

export type AutomaticReviewTextResult = {
  classification: AutomaticReviewTextClassification
  sentiment: AutomaticReviewSentiment
  classifierSource: AutomaticReviewClassifierSource
  classifierVersion: string
  classifierEvidence: string
}

type RelevanceDecision = {
  status: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  reason: string
  confidence: number
  matchedTerms: string[]
}

type SubjectDecision = {
  status: "ACCEPTED" | "REVIEW" | "REJECTED"
  reason: string
  confidence: number
  matchedTerms: string[]
  matches: Array<{
    subjectId: string
    status: "MATCHED" | "REVIEW" | "REJECTED"
    confidence: number
    matchedTerms?: string[]
    contextSignals?: Record<string, unknown>
  }>
}

export type AutomaticReviewTriageResult = {
  decision: RelevanceDecision
  resolved: boolean
  classification: AutomaticReviewTextClassification
  sentiment: AutomaticReviewSentiment
  classifierSource: AutomaticReviewClassifierSource | null
  classifierVersion: string | null
  classifierEvidence: string | null
  originalReason: string
  parentSubjectId: string | null
}

const CONTEXT_ONLY_REASONS = new Set([
  // This row can be required to render an accepted descendant in its original
  // thread. It is not an analytics candidate and must not be scrubbed merely
  // because its own text does not name the monitored subject.
  "thread_context_for_actionable_descendant",
])

const TEXTLESS_REASONS = new Set([
  // A video without a caption needs media/OCR evidence. Treating an empty body
  // as neutral would silently turn an unresolved item into a feed mention.
  "discovery_tiktok_video_without_caption",
])

export const AUTOMATIC_REVIEW_DISCOVERY_REASONS = [
  "discovery_missing_published_at",
  "discovery_outside_lookback_window",
  "discovery_snippet_only_match",
] as const

export type AutomaticReviewDiscoveryReason = typeof AUTOMATIC_REVIEW_DISCOVERY_REASONS[number]

export const AUTOMATIC_REVIEW_PARENT_COMMENT_REASONS = [
  "comment_on_verified_brand_parent",
  "negative_parent_post_inheritance",
] as const

export const AUTOMATIC_REVIEW_COMMENT_REASONS = [
  ...AUTOMATIC_REVIEW_PARENT_COMMENT_REASONS,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
] as const

export const AUTOMATIC_REVIEW_TRIAGE_REASONS = [
  ...AUTOMATIC_REVIEW_DISCOVERY_REASONS,
  ...AUTOMATIC_REVIEW_COMMENT_REASONS,
] as const

const DISCOVERY_REVIEW_REASONS = new Set<string>(AUTOMATIC_REVIEW_DISCOVERY_REASONS)

const POSITIVE_PATTERNS = [
  /(?<![\p{L}\p{N}])(?:love|great|best|super|excellent|amazing|awesome|perfect|recommend(?:ed)?|thank(?:s| you)?)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:(?:очень\s+)?(?:хорош|отличн|прекрасн)\p{L}*|супер|рекомендую|спасибо|благодар\p{L}*)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:(?:çox\s+)?yaxşı|əla|super|təşəkkür|sağ\s*ol|məmnun(?:am|uq)?|məsləhət\s+görürəm)(?![\p{L}\p{N}])/iu,
]

const POSITIVE_EMOJI = /(?:👍|❤|❤️|💚|💙|💜|😍|🥰|😘|👏|🔥|💯|🤩|🌹|💐|🙏|😊|☺️?)/u
const NEGATIVE_EMOJI = /(?:👎|😡|🤬|😠|😤|🤢|🤮|💩|😞|😔|😢|😭|💔)/u

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((item): item is string => Boolean(item))
}

/**
 * Identifies the narrow v2 replay bug where a versioned AI result for an
 * ambiguous emoji was ignored and the row was terminalized as technical.
 * No other technical REVIEW reason is automatically reopened.
 */
export function recoverableAutomaticReviewOriginalReason(input: {
  relevanceReason: string | null
  contentKind: string | null
  text?: string | null
  policySnapshot: unknown
}): "comment_on_verified_brand_parent" | null {
  if (
    input.relevanceReason !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    || !["COMMENT", "REPLY"].includes(input.contentKind?.toUpperCase() ?? "")
  ) return null

  const triage = record(record(input.policySnapshot).automaticReviewTriage)
  const replayResolution = record(record(input.policySnapshot).replayResolution)
  const originalRelevance = record(replayResolution.originalRelevance)
  const originalReason = stringValue(triage.originalReason)
  const attemptedAt = stringValue(triage.attemptedAt)
  const currentTextDecision = classifyAutomaticReviewText(input.text ?? "", null)
  if (
    triage.version !== AUTOMATIC_REVIEW_V2_AMBIGUOUS_EMOJI_VERSION
    || triage.resolved !== false
    || triage.decisionReason !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    || triage.classifierSource !== "AI"
    || triage.classifierVersion !== AUTOMATIC_REVIEW_AI_VERSION
    || triage.classifierEvidence !== AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE
    || originalReason !== "comment_on_verified_brand_parent"
    || !attemptedAt
    || Number.isNaN(new Date(attemptedAt).getTime())
    || replayResolution.action !== "automatic_review_unresolved"
    || originalRelevance.reason !== "comment_on_verified_brand_parent"
    || currentTextDecision.classification !== "unknown"
    || currentTextDecision.classifierEvidence !== AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE
  ) return null

  return originalReason
}

/**
 * Reopens only the v3 discovery rows that the first unattended pass moved to a
 * generic technical reason after the frozen discovery resolver deliberately
 * returned KEEP_REVIEW. The original reason and both replay snapshots must
 * agree, so an unrelated technical row can never acquire this capability.
 */
export function recoverableAutomaticReviewV3DiscoveryOriginalReason(input: {
  relevanceReason: string | null
  contentKind: string | null
  policySnapshot: unknown
}): AutomaticReviewDiscoveryReason | null {
  if (
    input.relevanceReason !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    || !["POST", "MENTION", "VIDEO", "IMAGE", "AUDIO"].includes(
      input.contentKind ?? "",
    )
  ) return null

  const policy = record(input.policySnapshot)
  const triage = record(policy.automaticReviewTriage)
  const replayResolution = record(policy.replayResolution)
  const originalRelevance = record(replayResolution.originalRelevance)
  const originalReason = stringValue(triage.originalReason)
  const attemptedAt = stringValue(triage.attemptedAt)
  const classifierSource = stringValue(triage.classifierSource)
  const classifierVersion = stringValue(triage.classifierVersion)
  const validClassifier = (
    classifierSource === "AI" && classifierVersion === AUTOMATIC_REVIEW_AI_VERSION
  ) || (
    classifierSource === "RULES" && classifierVersion === AUTOMATIC_REVIEW_RULES_VERSION
  )
  if (
    triage.version !== AUTOMATIC_REVIEW_TRIAGE_VERSION
    || triage.resolved !== false
    || triage.decisionStatus !== "REVIEW"
    || triage.decisionReason !== AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON
    || triage.classification !== "unknown"
    || triage.sentiment !== "unknown"
    || triage.classifierEvidence !== "technical_evidence_unresolved"
    || triage.providerFetchPerformed !== false
    || !validClassifier
    || !originalReason
    || !AUTOMATIC_REVIEW_DISCOVERY_REASONS.includes(
      originalReason as AutomaticReviewDiscoveryReason,
    )
    || !attemptedAt
    || Number.isNaN(new Date(attemptedAt).getTime())
    || replayResolution.version !== "stored-envelope-replay-v1"
    || replayResolution.action !== "automatic_review_unresolved"
    || replayResolution.providerFetchPerformed !== false
    || originalRelevance.status !== "REVIEW"
    || originalRelevance.reason !== originalReason
  ) return null

  return originalReason as AutomaticReviewDiscoveryReason
}

/**
 * High-confidence, provider-free text gate shared by live ingest, backlog and
 * review presentation. It deliberately has no generic "letters => neutral"
 * fallback: semantic text that lacks an explicit signal must be classified by
 * AI once, or remain in the manual REVIEW queue when AI is unavailable.
 */
export function classifyAutomaticReviewText(
  text: string,
  stored: "positive" | "neutral" | "negative" | null,
  storedClassification?: {
    source: Exclude<AutomaticReviewClassifierSource, "RULES">
    version?: string | null
  },
  identityTerms: readonly string[] = [],
): AutomaticReviewTextResult {
  const value = text.trim()
  // Complaint evidence takes precedence over incidental positive words (for
  // example "good shop, but expired food again"). This preserves recall for
  // Azerbaijani complaints that the tiny generic lexicon does not cover.
  if (hasCommentComplaintSignal(value)) {
    return {
      classification: "negative",
      sentiment: "negative",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: "explicit_complaint",
    }
  }
  // Соболезнование — не претензия к бренду.
  //
  // Порядок здесь и есть правило: претензия важнее соболезнования (жалоба в
  // траурной ветке остаётся жалобой), соболезнование важнее плачущего смайлика.
  // Прод 2026-08-04: владелец открыл ленту с сортировкой «сначала негатив» и
  // увидел «Məkanın cənnət olsun Şəhidim. Halaldı sənə Araz market» — похвалу.
  // Из 110 принятых находок-соболезнований 61 была помечена негативом: горе и
  // 😭 читались как жалоба, поэтому они и шли первыми.
  if (isCondolencePost(value)) {
    return {
      classification: "irrelevant",
      sentiment: "neutral",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: "condolence_without_complaint",
    }
  }
  if (NEGATIVE_EMOJI.test(value)) {
    return {
      classification: "negative",
      sentiment: "negative",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: "negative_emoji",
    }
  }
  const withoutHandles = value.replace(/(^|\s)@[\p{L}\p{N}._-]+(?=\s|$)/gu, " ").trim()
  const hasSemanticText = /[\p{L}\p{N}]/u.test(withoutHandles)
  const positiveText = POSITIVE_PATTERNS.some(pattern => pattern.test(withoutHandles))
  const positiveEmoji = POSITIVE_EMOJI.test(value)
  // Emoji-only praise is safe to remove. A positive-looking emoji attached to
  // otherwise semantic text is not: 🙏 can mean a plea and hearts can occur
  // inside a complaint, so ambiguous mixed text must go through AI.
  if (positiveText || (positiveEmoji && !hasSemanticText)) {
    return {
      classification: "positive",
      sentiment: "positive",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: positiveText ? "explicit_positive" : "positive_emoji",
    }
  }

  const storedResult: AutomaticReviewTextResult | null = stored && storedClassification
    ? {
        classification: stored,
        sentiment: stored,
        classifierSource: storedClassification.source,
        classifierVersion: storedClassification.version?.trim()
          || (storedClassification.source === "AI"
            ? AUTOMATIC_REVIEW_AI_VERSION
            : "provided_sentiment_v1"),
        classifierEvidence: storedClassification.source === "AI"
          ? "ai_classification"
          : "provided_classification",
      }
    : null
  const versionedAmbiguousEmojiAiResult = storedResult
    && storedClassification?.source === "AI"
    && storedClassification.version?.trim() === AUTOMATIC_REVIEW_AI_VERSION
    ? storedResult
    : null

  // A handle by itself or punctuation carries no useful observation. Unknown
  // emoji can still express negative sentiment, so it must go through AI rather
  // than being irreversibly scrubbed as noise. Once that bounded AI pass has
  // supplied a versioned result, it is authoritative for the ambiguous emoji;
  // otherwise replay would send the same row back to REVIEW forever.
  if (!hasSemanticText) {
    if (/\p{Extended_Pictographic}/u.test(value)) {
      if (versionedAmbiguousEmojiAiResult) return versionedAmbiguousEmojiAiResult
      return {
        classification: "unknown",
        sentiment: "unknown",
        classifierSource: "RULES",
        classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
        classifierEvidence: AUTOMATIC_REVIEW_AMBIGUOUS_EMOJI_EVIDENCE,
      }
    }
    return {
      classification: "irrelevant",
      sentiment: "unknown",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: value ? "non_semantic_noise" : "empty_text",
    }
  }
  const normalizedSemanticText = withoutHandles
    .replace(/^#+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase()
  const normalizedIdentityTerms = new Set(identityTerms
    .map(term => term
      .replace(/^[@#]+/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLocaleLowerCase())
    .filter(Boolean))
  if (normalizedIdentityTerms.has(normalizedSemanticText)) {
    return {
      classification: "irrelevant",
      sentiment: "unknown",
      classifierSource: "RULES",
      classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
      classifierEvidence: "mention_only",
    }
  }

  // Only a versioned upstream/AI decision is terminal. An unversioned provider
  // label may be stale or use a different polarity policy, so semantic text
  // with such a label still goes through the automatic-review classifier.
  if (storedResult) return storedResult

  return {
    classification: "unknown",
    sentiment: "unknown",
    classifierSource: "RULES",
    classifierVersion: AUTOMATIC_REVIEW_RULES_VERSION,
    classifierEvidence: "semantic_text_requires_ai",
  }
}

function automaticDecision(
  original: RelevanceDecision,
  status: "ACCEPTED" | "REVIEW" | "REJECTED",
  reason: string,
  confidence: number,
): RelevanceDecision {
  return {
    ...original,
    status,
    reason,
    confidence,
  }
}

/**
 * Resolves semantic REVIEW rows at the shared ingest boundary without an AI or
 * provider call. The tenant-scoped subject matcher remains authoritative for
 * relevance; the deterministic sentiment pass only separates the product's
 * requested negative/neutral feed from positive observations.
 *
 * REVIEW is retained only when stored evidence is genuinely insufficient:
 * ambiguous/multiple subjects, missing text/link, or context/media rows that
 * require another technical stage.
 */
export function resolveAutomaticReviewTriage(input: {
  decision: RelevanceDecision
  subjectDecision: SubjectDecision | null
  contentKind?: string | null
  text: string
  sentiment: "positive" | "neutral" | "negative" | null
  sentimentClassification?: {
    source: Exclude<AutomaticReviewClassifierSource, "RULES">
    version?: string | null
  }
  url?: string | null
  canonicalUrl?: string | null
  parentPostUrl?: string | null
  publishedAt?: Date | string | number | null
  rawPayload?: unknown
  policySnapshot?: unknown
  parentMatchContext?: {
    parentMentionId: string | null
    subjectIds: string[]
    inheritAllCommentSubjectIds?: string[]
  } | null
}): AutomaticReviewTriageResult {
  const originalReason = input.decision.reason
  const unchanged = (textResult?: AutomaticReviewTextResult): AutomaticReviewTriageResult => ({
    decision: input.decision,
    resolved: false,
    classification: textResult?.classification ?? "unknown",
    sentiment: textResult?.sentiment ?? "unknown",
    classifierSource: textResult?.classifierSource ?? null,
    classifierVersion: textResult?.classifierVersion ?? null,
    classifierEvidence: textResult?.classifierEvidence ?? null,
    originalReason,
    parentSubjectId: null,
  })
  const classifiedResult = (
    decision: RelevanceDecision,
    resolved: boolean,
    textResult: AutomaticReviewTextResult,
    parentSubjectId: string | null,
  ): AutomaticReviewTriageResult => ({
    decision,
    resolved,
    classification: textResult.classification,
    sentiment: textResult.sentiment,
    classifierSource: textResult.classifierSource,
    classifierVersion: textResult.classifierVersion,
    classifierEvidence: textResult.classifierEvidence,
    originalReason,
    parentSubjectId,
  })
  const classifyText = () => classifyAutomaticReviewText(
    input.text,
    input.sentiment,
    input.sentimentClassification,
    Array.from(new Set([
      ...input.decision.matchedTerms,
      ...(input.subjectDecision?.matchedTerms ?? []),
      ...(input.subjectDecision?.matches.flatMap(match => match.matchedTerms ?? []) ?? []),
    ])),
  )
  const unclassifiedResult = (
    decision: RelevanceDecision,
    resolved: boolean,
    parentSubjectId: string | null = null,
  ): AutomaticReviewTriageResult => ({
    decision,
    resolved,
    classification: "unknown",
    sentiment: "unknown",
    classifierSource: null,
    classifierVersion: null,
    classifierEvidence: null,
    originalReason,
    parentSubjectId,
  })

  const inheritedSubjectIds = Array.from(new Set(
    input.parentMatchContext?.inheritAllCommentSubjectIds
      ?.map(value => value.trim())
      .filter(Boolean) ?? [],
  ))
  const inheritedNegativeParent = input.decision.status === "ACCEPTED"
    && (
      originalReason === "negative_parent_post_inheritance"
      || (
        ["COMMENT", "REPLY"].includes(input.contentKind?.toUpperCase() ?? "")
        && inheritedSubjectIds.length > 0
      )
    )
  if (inheritedNegativeParent) {
    const textResult = classifyText()
    if (textResult.classification === "unknown") {
      return classifiedResult(
        automaticDecision(input.decision, "REVIEW", "negative_parent_post_inheritance", 0),
        false,
        textResult,
        null,
      )
    }
    if (textResult.classification === "positive") {
      return classifiedResult(
        automaticDecision(
          input.decision,
          "REJECTED",
          "automatic_review_positive_parent_comment",
          1,
        ),
        true,
        textResult,
        null,
      )
    }
    if (textResult.classification === "irrelevant") {
      return classifiedResult(
        automaticDecision(
          input.decision,
          "REJECTED",
          "automatic_review_irrelevant_parent_comment",
          1,
        ),
        true,
        textResult,
        null,
      )
    }
    return classifiedResult(input.decision, true, textResult, null)
  }

  // Product invariant: comments are brand-risk observations, not praise
  // analytics. Apply the same sentiment admission gate to every automatically
  // accepted COMMENT/REPLY, regardless of platform, collector or relevance
  // reason. Unknown semantic text is queued for the bounded AI worker.
  const commentLike = ["COMMENT", "REPLY"].includes(input.contentKind?.toUpperCase() ?? "")
  if (commentLike && input.decision.status === "ACCEPTED") {
    const textResult = classifyText()
    if (textResult.classification === "unknown") {
      return classifiedResult(
        automaticDecision(input.decision, "REVIEW", AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON, 0),
        false,
        textResult,
        null,
      )
    }
    if (textResult.classification === "positive") {
      return classifiedResult(
        automaticDecision(input.decision, "REJECTED", "automatic_review_positive_comment", 1),
        true,
        textResult,
        null,
      )
    }
    if (textResult.classification === "irrelevant") {
      return classifiedResult(
        automaticDecision(input.decision, "REJECTED", "automatic_review_irrelevant_comment", 1),
        true,
        textResult,
        null,
      )
    }
    return classifiedResult(input.decision, true, textResult, null)
  }

  if (input.decision.status !== "REVIEW") return unchanged()
  if (CONTEXT_ONLY_REASONS.has(originalReason) || TEXTLESS_REASONS.has(originalReason)) {
    return unchanged()
  }

  if (originalReason === "comment_on_verified_brand_parent") {
    const parentSubjectIds = Array.from(new Set(
      input.parentMatchContext?.subjectIds.map(value => value.trim()).filter(Boolean) ?? [],
    ))
    if (parentSubjectIds.length !== 1) return unchanged()
    const textResult = classifyText()
    if (textResult.classification === "unknown") return unchanged(textResult)
    if (textResult.classification === "positive") {
      return classifiedResult(
        automaticDecision(
          input.decision,
          "REJECTED",
          "automatic_review_positive_parent_comment",
          1,
        ),
        true,
        textResult,
        parentSubjectIds[0],
      )
    }
    if (textResult.classification === "irrelevant") {
      return classifiedResult(
        automaticDecision(
          input.decision,
          "REJECTED",
          "automatic_review_irrelevant_parent_comment",
          1,
        ),
        true,
        textResult,
        parentSubjectIds[0],
      )
    }
    return classifiedResult(
      automaticDecision(
        input.decision,
        "ACCEPTED",
        textResult.sentiment === "negative"
          ? "automatic_review_parent_context_negative"
          : "automatic_review_parent_context_neutral",
        1,
      ),
      true,
      textResult,
      parentSubjectIds[0],
    )
  }

  if (commentLike) {
    const subjectDecision = input.subjectDecision
    const matchedSubjects = Array.from(new Set(subjectDecision?.matches
      .filter(match => match.status === "MATCHED" && match.confidence >= 0.7)
      .map(match => match.subjectId) ?? []))
    if (subjectDecision?.status === "REJECTED") {
      return unclassifiedResult(
        automaticDecision(input.decision, "REJECTED", "automatic_review_irrelevant_subject", 1),
        true,
      )
    }
    if (subjectDecision?.status !== "ACCEPTED" || matchedSubjects.length !== 1) {
      return unclassifiedResult(
        automaticDecision(
          input.decision,
          "REJECTED",
          AUTOMATIC_REVIEW_COMMENT_SUBJECT_UNRESOLVED_REASON,
          1,
        ),
        true,
      )
    }
    const textResult = classifyText()
    if (textResult.classification === "unknown") return unchanged(textResult)
    if (textResult.classification === "positive") {
      return classifiedResult(
        automaticDecision(input.decision, "REJECTED", "automatic_review_positive_comment", 1),
        true,
        textResult,
        null,
      )
    }
    if (textResult.classification === "irrelevant") {
      return classifiedResult(
        automaticDecision(input.decision, "REJECTED", "automatic_review_irrelevant_comment", 1),
        true,
        textResult,
        null,
      )
    }
    return classifiedResult(
      automaticDecision(
        input.decision,
        "ACCEPTED",
        textResult.sentiment === "negative"
          ? "automatic_review_comment_negative"
          : "automatic_review_comment_neutral",
        subjectDecision.confidence,
      ),
      true,
      textResult,
      null,
    )
  }

  // New/unknown REVIEW reasons fail closed. Automatic resolution is limited to
  // the explicit comment gates above and discovery uncertainty already covered
  // by the frozen discovery resolver.
  if (!DISCOVERY_REVIEW_REASONS.has(originalReason)) return unchanged()

  const policy = record(input.policySnapshot)
  const v3DiscoveryRecovery =
    policy.automaticTriageRecovery === AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY
  const conservativeRecoveryRejection = () => unclassifiedResult(
    automaticDecision(
      input.decision,
      "REJECTED",
      AUTOMATIC_REVIEW_DISCOVERY_RECOVERY_FALLBACK_REJECTION_REASON,
      1,
    ),
    true,
  )

  const subjectDecision = input.subjectDecision
  if (subjectDecision?.status === "REJECTED") {
    return unclassifiedResult(
      automaticDecision(
        input.decision,
        "REJECTED",
        "automatic_review_irrelevant_subject",
        1,
      ),
      true,
    )
  }
  if (subjectDecision?.status !== "ACCEPTED") {
    return v3DiscoveryRecovery ? conservativeRecoveryRejection() : unchanged()
  }

  const matchedSubjects = Array.from(new Set(subjectDecision.matches
    .filter(match => match.status === "MATCHED" && match.confidence >= 0.7)
    .map(match => match.subjectId)))
  if (matchedSubjects.length !== 1) {
    return v3DiscoveryRecovery ? conservativeRecoveryRejection() : unchanged()
  }

  const providerWindow = record(policy.leadDriveProviderWindow)
  const since = stringValue(providerWindow.since)
  const until = stringValue(providerWindow.until)
  if (!since || !until) {
    return v3DiscoveryRecovery ? conservativeRecoveryRejection() : unchanged()
  }
  const subjectIdentityTerms = Array.from(new Set([
    ...subjectDecision.matchedTerms,
    ...subjectDecision.matches.flatMap(match => match.matchedTerms ?? []),
  ].map(value => value.trim()).filter(Boolean)))
  const officialHosts = Array.from(new Set(subjectDecision.matches.flatMap(match => (
    stringValues(record(match.contextSignals).officialHosts)
  ))))
  const discoveryDecision = resolveDiscoveryAutoReview({
    reviewReason: originalReason,
    url: input.url,
    canonicalUrl: input.canonicalUrl,
    publishedAt: input.publishedAt,
    rawPayload: input.rawPayload,
    providerWindow: { since, until },
    subjectIdentityTerms,
    officialHosts,
  })
  if (discoveryDecision.action === "KEEP_REVIEW") {
    // This product has no operator-managed discovery queue. Frozen candidates
    // that still lack freshness or independent brand identity after the
    // automatic pass are terminally suppressed rather than relabelled as a
    // generic technical REVIEW row. This never admits content and therefore
    // cannot bypass the negative/neutral sentiment gate below.
    const terminalReason = discoveryDecision.reason === "discovery_auto_review_missing_publish_date"
      ? AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON
      : discoveryDecision.reason === "discovery_auto_review_insufficient_independent_identity"
        ? AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON
        : null
    if (!terminalReason) {
      return v3DiscoveryRecovery ? conservativeRecoveryRejection() : unchanged()
    }
    return unclassifiedResult(
      automaticDecision(input.decision, "REJECTED", terminalReason, 1),
      true,
    )
  }
  if (discoveryDecision.action === "REJECT") {
    return unclassifiedResult(
      automaticDecision(
        input.decision,
        "REJECTED",
        discoveryDecision.reason,
        1,
      ),
      true,
    )
  }

  // A recovery capability is a terminal suppression operation, not a second
  // route into normal ingestion. Even if mutable subject configuration now
  // makes the old candidate look releasable, it cannot create a mention from a
  // row whose original unattended pass lacked sufficient frozen evidence.
  if (v3DiscoveryRecovery) return conservativeRecoveryRejection()

  const text = input.text.trim()

  const candidateUrl = input.url ?? input.canonicalUrl ?? input.parentPostUrl ?? null
  const urlDecision = classifyDiscoveryCandidateUrl(candidateUrl)
  if (["PROFILE_OR_CHANNEL", "EVERGREEN_DIRECTORY", "OFFICIAL_DOMAIN"].includes(urlDecision.classification)) {
    return unclassifiedResult(
      automaticDecision(
        input.decision,
        "REJECTED",
        "automatic_review_non_content_url",
        1,
      ),
      true,
    )
  }
  if (["MISSING", "INVALID"].includes(urlDecision.classification)) return unchanged()

  const textResult = classifyAutomaticReviewText(
    text,
    input.sentiment,
    input.sentimentClassification,
    subjectIdentityTerms,
  )
  if (textResult.classification === "unknown") return unchanged(textResult)
  if (textResult.classification === "positive") {
    return classifiedResult(
      automaticDecision(
        input.decision,
        "REJECTED",
        "automatic_review_positive",
        1,
      ),
      true,
      textResult,
      null,
    )
  }
  if (textResult.classification === "irrelevant") {
    return classifiedResult(
      automaticDecision(
        input.decision,
        "REJECTED",
        "automatic_review_irrelevant",
        1,
      ),
      true,
      textResult,
      null,
    )
  }
  return classifiedResult(
    automaticDecision(
      input.decision,
      "ACCEPTED",
      textResult.sentiment === "negative"
        ? "automatic_review_negative"
        : "automatic_review_neutral",
      subjectDecision.confidence,
    ),
    true,
    textResult,
    null,
  )
}
