import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { classifySocialAiTopic, detectSocialReplyLanguage } from "@/lib/social/ai-reply-policy"
import { createScenarioSocialMentionAiDraft } from "@/lib/social/ai-draft-service"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

export const SOCIAL_TRIAGE_VERSION = "social_triage_v1"
export const SOCIAL_TRIAGE_FEATURE_NAME = "ai_auto_social_triage_shadow"
export const SOCIAL_TRIAGE_ALERT_TYPE = "social_signal_risk"

export type SocialTriageLanguage = "az" | "ru" | "en"
export type SocialTriageRisk = "low" | "medium" | "high"
export type SocialTriageUrgency = "low" | "medium" | "high" | "critical"
export type SocialTriageRecommendedAction =
  | "ignore_noise"
  | "monitor"
  | "draft_reply"
  | "create_lead"
  | "escalate"
  | "open_original"

export interface SocialTriageResult {
  version: typeof SOCIAL_TRIAGE_VERSION
  relevanceScore: number
  language: SocialTriageLanguage
  leadIntent: boolean
  complaint: boolean
  prRisk: SocialTriageRisk
  urgency: SocialTriageUrgency
  topic: string
  recommendedAction: SocialTriageRecommendedAction
  hiddenNoise: boolean
  draftAllowed: boolean
  approvalRequired: boolean
  forbiddenReason: string | null
  reasons: string[]
  queuedAction: boolean
  alertCreated: boolean
  draftCreated?: boolean
  draftId?: string | null
  draftSkippedReason?: string | null
  triagedAt?: string
}

export interface SocialTriageInput {
  id?: string
  organizationId?: string
  platform: string
  accountId?: string | null
  sourceType?: string | null
  contentKind?: string | null
  contentVersion?: number
  sourceProvider?: string | null
  sourceMetadata?: unknown
  text: string
  authorName?: string | null
  authorHandle?: string | null
  sentiment?: string | null
  externalId?: string | null
  matchedTerm?: string | null
  reach?: number | null
  engagement?: number | null
  url?: string | null
  cluster?: { mentionCount: number; riskLevel?: string | null; topic?: string | null } | null
}

export interface SocialTriageRunResult {
  scanned: number
  updated: number
  queued: number
  alerts: number
  hiddenNoise: number
}

export interface SocialTriageRunOptions {
  limit?: number
  force?: boolean
  now?: Date
}

type SocialTriageMentionRow = Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput

const LEAD_PATTERNS = [
  /\b(price|pricing|cost|demo|buy|quote|contact|call|whatsapp|number|trial|order)\b/i,
  /\b(qiym[eə]t|demo|almaq|sifari[sş]|[eə]laq[eə]|elaqe|z[eə]ng|n[oö]mr[eə]|whatsapp)\b/i,
  /\b(цена|стоимость|купить|демо|заказ|связаться|позвоните|номер|ватсап|whatsapp)\b/i,
]

const COMPLAINT_PATTERNS = [
  /\b(complaint|broken|not\s*working|bad\s*service|terrible|refund|angry|scam|fraud)\b/i,
  /(şikay|sikay|işləmir|islemir|pis\s*xidm[eə]t|geri\s*qaytar|f[ıi]r[ıi]ldaq)/i,
  /\b(жалоб|не\s*работает|плохой\s*сервис|ужасн|возврат|мошенник|обман)\b/i,
]

const URGENT_PATTERNS = [
  /\b(urgent|asap|immediately|now|emergency|sos)\b/i,
  /\b(t[eə]cili|indi|d[eə]rhal|t[eə]cili\s*k[oö]m[eə]k)\b/i,
  /\b(срочно|немедленно|сейчас|экстренно|помогите)\b/i,
]

const QUESTION_PATTERNS = [
  /\?/,
  /\b(how|what|when|where|can\s*i|do\s*you)\b/i,
  /\b(nec[eə]|n[eə]|harada|hansi|olarm[ıi])\b/i,
  /\b(как|что|когда|где|можно|почему)\b/i,
]

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function numberValue(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function socialTriageFromMetadata(sourceMetadata: unknown): Record<string, unknown> {
  return asRecord(asRecord(sourceMetadata).socialTriage)
}

function isAlreadyTriaged(sourceMetadata: unknown): boolean {
  return socialTriageFromMetadata(sourceMetadata).version === SOCIAL_TRIAGE_VERSION
}

function sourceNeedsHumanApproval(provider: string | null | undefined): boolean {
  return Boolean(provider && !["native", "official_api", "manual"].includes(provider))
}

type ScenarioSignal = {
  scenarioId: string | null
  scenarioName: string | null
  action: string
  sentiments: string[]
  minConfidence: number
  matchedConfidence: number
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function scenarioSignalsFromMetadata(sourceMetadata: unknown): ScenarioSignal[] {
  const scenario = asRecord(asRecord(sourceMetadata).socialScenario)
  const matches = Array.isArray(scenario.matches) ? scenario.matches : []
  return matches
    .map((item) => {
      const record = asRecord(item)
      const action = typeof record.action === "string" ? record.action : "show_only"
      return {
        scenarioId: typeof record.scenarioId === "string" ? record.scenarioId : null,
        scenarioName: typeof record.scenarioName === "string" ? record.scenarioName : null,
        action,
        sentiments: stringList(record.sentiments),
        minConfidence: numberOrFallback(record.minConfidence, 80),
        matchedConfidence: numberOrFallback(record.matchedConfidence, 0),
      }
    })
    .filter((item) => item.matchedConfidence > 0)
}

function scenarioTriggerMatches(
  signal: ScenarioSignal,
  facts: { sentiment: string | null; leadIntent: boolean; complaint: boolean; question: boolean },
): boolean {
  if (signal.sentiments.length === 0) return true
  return signal.sentiments.some((trigger) => {
    if (trigger === "lead") return facts.leadIntent
    if (trigger === "complaint") return facts.complaint
    if (trigger === "question") return facts.question
    return facts.sentiment === trigger
  })
}

export function scoreSocialMentionForTriage(input: SocialTriageInput): SocialTriageResult {
  const text = input.text || ""
  const language = detectSocialReplyLanguage(text)
  const topicDecision = classifySocialAiTopic(text)
  const leadIntent = matchesAny(text, LEAD_PATTERNS)
  const complaint = topicDecision.reason === "complaint" || matchesAny(text, COMPLAINT_PATTERNS)
  const urgent = matchesAny(text, URGENT_PATTERNS)
  const question = matchesAny(text, QUESTION_PATTERNS)
  const scenarioSignals = scenarioSignalsFromMetadata(input.sourceMetadata)
  const scenarioMatched = scenarioSignals.length > 0
  const scenarioReadySignals = scenarioSignals.filter((signal) => (
    signal.matchedConfidence >= signal.minConfidence &&
    scenarioTriggerMatches(signal, { sentiment: input.sentiment || null, leadIntent, complaint, question })
  ))
  const reach = numberValue(input.reach)
  const engagement = numberValue(input.engagement)
  const clusterCount = Math.max(1, numberValue(input.cluster?.mentionCount))
  const matchedTerm = Boolean(input.matchedTerm?.trim())
  const sentiment = input.sentiment || null
  const reasons: string[] = []

  let relevanceScore = 10
  if (matchedTerm) {
    relevanceScore += 20
    reasons.push("matched_term")
  }
  if (scenarioMatched) {
    relevanceScore += 25
    reasons.push("scenario_match")
  }
  if (scenarioReadySignals.length > 0) {
    relevanceScore += 15
    reasons.push("scenario_trigger")
  }
  if (leadIntent) {
    relevanceScore += 35
    reasons.push("lead_intent")
  }
  if (complaint) {
    relevanceScore += 35
    reasons.push("complaint")
  }
  if (urgent) {
    relevanceScore += 20
    reasons.push("urgent_language")
  }
  if (question) {
    relevanceScore += 10
    reasons.push("question")
  }
  if (sentiment === "negative") {
    relevanceScore += 20
    reasons.push("negative_sentiment")
  } else if (sentiment === "neutral") {
    relevanceScore += 8
  } else if (sentiment === "positive") {
    relevanceScore += 5
  }
  if (reach > 0) {
    relevanceScore += Math.min(20, reach / 400)
    if (reach >= 5000) reasons.push("high_reach")
  }
  if (engagement > 0) {
    relevanceScore += Math.min(20, engagement / 8)
    if (engagement >= 100) reasons.push("high_engagement")
  }
  if (clusterCount >= 3) {
    relevanceScore += 15
    reasons.push("cluster_spike")
  }
  if (text.trim().length < 16 && !matchedTerm && !leadIntent && !complaint) relevanceScore -= 15

  let prRisk: SocialTriageRisk = "low"
  if (
    ["legal_or_medical", "personal_data", "aggressive_conflict"].includes(topicDecision.reason || "") ||
    (sentiment === "negative" && (reach >= 5000 || engagement >= 100 || clusterCount >= 3)) ||
    (complaint && (reach >= 1000 || engagement >= 30 || clusterCount >= 2))
  ) {
    prRisk = "high"
    reasons.push("pr_risk_high")
  } else if (complaint || sentiment === "negative" || reach >= 2500 || engagement >= 60 || clusterCount >= 2) {
    prRisk = "medium"
    reasons.push("pr_risk_medium")
  }

  let urgency: SocialTriageUrgency = "low"
  if (urgent && (complaint || prRisk === "high")) urgency = "critical"
  else if (urgent || prRisk === "high") urgency = "high"
  else if (leadIntent || complaint || prRisk === "medium" || relevanceScore >= 55) urgency = "medium"

  const topic = topicDecision.reason || (leadIntent ? "lead_intent" : complaint ? "complaint" : question ? "question" : "brand_mention")
  const draftAllowed = !topicDecision.blocked
  const score = clampScore(relevanceScore)
  const hiddenNoise = !scenarioMatched && score < 30 && !leadIntent && !complaint && prRisk === "low"
  const scenarioAction = scenarioReadySignals.find((signal) => signal.action !== "show_only")?.action ?? null
  if (scenarioAction) reasons.push(`scenario_action_${scenarioAction}`)
  if (scenarioAction === "escalate" && prRisk === "low") prRisk = "medium"
  if ((scenarioAction === "escalate" || scenarioAction === "alert") && urgency === "low") urgency = "medium"

  let recommendedAction: SocialTriageRecommendedAction = "monitor"
  if (scenarioAction === "escalate") recommendedAction = "escalate"
  else if (scenarioAction === "create_lead") recommendedAction = "create_lead"
  else if (scenarioAction === "draft_reply" && draftAllowed) recommendedAction = "draft_reply"
  else if (hiddenNoise) recommendedAction = "ignore_noise"
  else if (complaint || prRisk === "high" || urgency === "critical" || urgency === "high") recommendedAction = "escalate"
  else if (leadIntent) recommendedAction = "create_lead"
  else if (draftAllowed && score >= 40) recommendedAction = "draft_reply"
  else if (input.url) recommendedAction = "open_original"

  const approvalRequired = Boolean(
    topicDecision.blocked ||
    complaint ||
    prRisk !== "low" ||
    urgency === "high" ||
    urgency === "critical" ||
    sourceNeedsHumanApproval(input.sourceProvider) ||
    Boolean(scenarioAction && scenarioAction !== "show_only")
  )
  if (approvalRequired) reasons.push("approval_required")
  if (!draftAllowed && topicDecision.reason) reasons.push(`forbidden_${topicDecision.reason}`)
  if (hiddenNoise) reasons.push("hidden_noise")

  return {
    version: SOCIAL_TRIAGE_VERSION,
    relevanceScore: score,
    language,
    leadIntent,
    complaint,
    prRisk,
    urgency,
    topic,
    recommendedAction,
    hiddenNoise,
    draftAllowed,
    approvalRequired,
    forbiddenReason: topicDecision.reason,
    reasons: Array.from(new Set(reasons)),
    queuedAction: false,
    alertCreated: false,
  }
}

async function writeScenarioDraft(
  mention: Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput,
  result: SocialTriageResult,
  now: Date,
  orgName: string,
): Promise<{ draftCreated: boolean; draftId: string | null; draftSkippedReason: string | null }> {
  if (result.recommendedAction !== "draft_reply") return { draftCreated: false, draftId: null, draftSkippedReason: null }
  if (!result.reasons.includes("scenario_action_draft_reply")) return { draftCreated: false, draftId: null, draftSkippedReason: null }
  if (!result.draftAllowed) return { draftCreated: false, draftId: null, draftSkippedReason: "draft_not_allowed" }
  const contentKind = mention.contentKind?.toUpperCase() ?? ""
  const sourceType = mention.sourceType?.toLowerCase() ?? ""
  if (
    mention.sentiment?.toLowerCase() !== "negative"
    || (!["POST", "COMMENT", "REPLY"].includes(contentKind) && !["post", "comment", "reply"].includes(sourceType))
  ) return { draftCreated: false, draftId: null, draftSkippedReason: "not_negative_reply_candidate" }

  const signal = scenarioSignalsFromMetadata(mention.sourceMetadata).find((item) => item.action === "draft_reply")
  if (!signal) return { draftCreated: false, draftId: null, draftSkippedReason: "scenario_signal_missing" }

  try {
    const draft = await createScenarioSocialMentionAiDraft({
      organizationId: mention.organizationId,
      orgName,
      now,
      scenario: {
        scenarioId: signal.scenarioId,
        scenarioName: signal.scenarioName,
        action: "draft_reply",
      },
      mention: {
        id: mention.id,
        organizationId: mention.organizationId,
        platform: mention.platform,
        accountId: mention.accountId ?? null,
        contentKind: mention.contentKind ?? null,
        contentVersion: mention.contentVersion ?? 1,
        sourceType: mention.sourceType ?? null,
        sourceProvider: mention.sourceProvider ?? null,
        sourceMetadata: mention.sourceMetadata,
        text: mention.text,
        authorName: mention.authorName ?? null,
        authorHandle: mention.authorHandle ?? null,
        sentiment: mention.sentiment ?? null,
        externalId: mention.externalId || mention.id,
        url: mention.url ?? null,
      },
    })
    if (!draft) return { draftCreated: false, draftId: null, draftSkippedReason: "recent_draft_exists" }
    return { draftCreated: true, draftId: draft.id, draftSkippedReason: null }
  } catch (error) {
    console.error(`Scenario social draft failed for mention ${mention.id}:`, error)
    return { draftCreated: false, draftId: null, draftSkippedReason: "draft_creation_failed" }
  }
}

function shouldQueueTriageAction(result: SocialTriageResult): boolean {
  return (
    result.recommendedAction === "escalate" ||
    result.recommendedAction === "create_lead" ||
    result.prRisk === "high" ||
    result.urgency === "critical"
  )
}

function shouldCreateTriageAlert(result: SocialTriageResult): boolean {
  return result.prRisk === "high" || result.urgency === "critical" || result.reasons.includes("scenario_action_alert")
}

function triageTaskTitle(mention: SocialTriageInput, result: SocialTriageResult): string {
  const label = result.recommendedAction === "create_lead" ? "Create lead from social mention" : "Review high-risk social mention"
  return `${label}: ${mention.platform}`.slice(0, 200)
}

function triageTaskDescription(mention: SocialTriageInput, result: SocialTriageResult): string {
  return [
    `Recommended action: ${result.recommendedAction}`,
    `Risk: ${result.prRisk}; urgency: ${result.urgency}; relevance: ${result.relevanceScore}`,
    mention.authorHandle ? `Author: @${mention.authorHandle.replace(/^@/, "")}` : mention.authorName ? `Author: ${mention.authorName}` : null,
    mention.url ? `Source: ${mention.url}` : null,
    "",
    mention.text.slice(0, 1000),
  ].filter(Boolean).join("\n")
}

async function writeTriageShadowAction(
  mention: Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput,
  result: SocialTriageResult,
  now: Date,
): Promise<boolean> {
  if (!shouldQueueTriageAction(result)) return false

  const existing = await prisma.aiShadowAction.findFirst({
    where: {
      organizationId: mention.organizationId,
      featureName: SOCIAL_TRIAGE_FEATURE_NAME,
      entityType: "social_mention",
      entityId: mention.id,
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { id: true },
  })
  if (existing) return false

  try {
    await prisma.aiShadowAction.create({
      data: {
        organizationId: mention.organizationId,
        featureName: SOCIAL_TRIAGE_FEATURE_NAME,
        entityType: "social_mention",
        entityId: mention.id,
        actionType: "create_task",
        riskLevel: result.prRisk === "high" || result.urgency === "critical" ? "high" : "medium",
        payload: {
          title: triageTaskTitle(mention, result),
          description: triageTaskDescription(mention, result),
          relatedType: "social_mention",
          relatedId: mention.id,
          source: "social_triage",
          recommendedAction: result.recommendedAction,
          triage: result,
        },
        evidenceSnapshot: {
          platform: mention.platform,
          sourceType: mention.sourceType,
          sourceProvider: mention.sourceProvider,
          url: mention.url,
          text: mention.text.slice(0, 1000),
        },
        approved: null,
      },
    })
    return true
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") return false
    throw e
  }
}

async function writeTriageAlert(
  mention: Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput,
  result: SocialTriageResult,
  now: Date,
): Promise<boolean> {
  if (!shouldCreateTriageAlert(result)) return false

  const existing = await prisma.aiAlert.findFirst({
    where: {
      organizationId: mention.organizationId,
      type: SOCIAL_TRIAGE_ALERT_TYPE,
      metadata: { path: ["mentionId"], equals: mention.id },
      createdAt: { gte: new Date(now.getTime() - 24 * 3600000) },
    },
    select: { id: true },
  })
  if (existing) return false

  await prisma.aiAlert.create({
    data: {
      organizationId: mention.organizationId,
      type: SOCIAL_TRIAGE_ALERT_TYPE,
      severity: result.urgency === "critical" ? "critical" : "warning",
      message: `${mention.platform} social mention needs review (${result.prRisk} risk, ${result.relevanceScore}/100)`,
      metadata: {
        mentionId: mention.id,
        platform: mention.platform,
        recommendedAction: result.recommendedAction,
        triage: result,
      },
    },
  })
  return true
}

export async function applySocialTriageToMention(
  mention: Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput,
  options: { now?: Date; writeQueue?: boolean; orgName?: string } = {},
): Promise<SocialTriageResult> {
  const now = options.now || new Date()
  const result = scoreSocialMentionForTriage(mention)
  const queuedAction = options.writeQueue === false ? false : await writeTriageShadowAction(mention, result, now)
  const alertCreated = options.writeQueue === false ? false : await writeTriageAlert(mention, result, now)
  const draftResult = options.writeQueue === false
    ? { draftCreated: false, draftId: null, draftSkippedReason: null }
    : await writeScenarioDraft(mention, result, now, options.orgName ?? "")
  const storedResult: SocialTriageResult = {
    ...result,
    queuedAction,
    alertCreated,
    draftCreated: draftResult.draftCreated,
    draftId: draftResult.draftId,
    draftSkippedReason: draftResult.draftSkippedReason,
    triagedAt: now.toISOString(),
  }

  await prisma.socialMention.update({
    where: { id: mention.id },
    data: {
      sourceMetadata: {
        ...asRecord(mention.sourceMetadata),
        socialTriage: storedResult,
      } as unknown as Prisma.InputJsonObject,
    },
  })

  return storedResult
}

export async function findMentionsForSocialTriage(
  organizationId: string,
  options: SocialTriageRunOptions = {},
): Promise<Array<Required<Pick<SocialTriageInput, "id" | "organizationId">> & SocialTriageInput>> {
  const now = options.now || new Date()
  const recent = new Date(now.getTime() - 7 * 24 * 3600000)
  const rows = await prisma.socialMention.findMany({
    where: {
      organizationId,
      externalId: { not: "__tg_offset__" },
      purgedAt: null,
      deletedAtSource: null,
      AND: [riskRelevantMentionWhere()],
      createdAt: { gte: recent },
      status: { in: ["new", "reviewed"] },
      platform: { in: ["twitter", "facebook", "instagram", "tiktok", "telegram", "youtube", "vkontakte"] },
    },
    select: {
      id: true,
      organizationId: true,
      platform: true,
      accountId: true,
      sourceType: true,
      contentKind: true,
      contentVersion: true,
      sourceProvider: true,
      sourceMetadata: true,
      text: true,
      authorName: true,
      authorHandle: true,
      sentiment: true,
      externalId: true,
      matchedTerm: true,
      reach: true,
      engagement: true,
      url: true,
      cluster: { select: { mentionCount: true, riskLevel: true, topic: true } },
    },
    take: Math.min(Math.max(options.limit ?? 100, 1), 200),
    // Negative sorts before neutral/positive and therefore cannot be displaced
    // from the bounded auto-draft candidate window by non-negative content.
    orderBy: [{ sentiment: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  })

  return (rows as SocialTriageMentionRow[]).filter((row) => options.force || !isAlreadyTriaged(row.sourceMetadata))
}

async function runSocialTriageForOrganizationWithinFence(
  organizationId: string,
  options: SocialTriageRunOptions = {},
): Promise<SocialTriageRunResult> {
  const now = options.now || new Date()
  const mentions = await findMentionsForSocialTriage(organizationId, { ...options, now })
  const organization = mentions.length > 0
    ? await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } })
    : null
  const orgName = organization?.name || ""
  const result: SocialTriageRunResult = {
    scanned: mentions.length,
    updated: 0,
    queued: 0,
    alerts: 0,
    hiddenNoise: 0,
  }

  for (const mention of mentions) {
    const triage = await applySocialTriageToMention(mention, { now, orgName })
    result.updated += 1
    if (triage.queuedAction) result.queued += 1
    if (triage.alertCreated) result.alerts += 1
    if (triage.hiddenNoise) result.hiddenNoise += 1
  }

  return result
}

export async function runSocialTriageForOrganization(
  organizationId: string,
  options: SocialTriageRunOptions = {},
): Promise<SocialTriageRunResult> {
  const fenced = await withSocialMonitoringTenantCollectionFence(
    organizationId,
    () => runSocialTriageForOrganizationWithinFence(organizationId, options),
  )
  if (!fenced.allowed) {
    return {
      scanned: 0,
      updated: 0,
      queued: 0,
      alerts: 0,
      hiddenNoise: 0,
    }
  }
  return fenced.value
}
