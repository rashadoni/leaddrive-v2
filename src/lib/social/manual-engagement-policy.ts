import { classifySocialAiTopic } from "@/lib/social/ai-reply-policy"
import { isExternalCommentOrReply } from "@/lib/social/reply-brand-integrity"

const MANUAL_EXTERNAL_PLATFORMS = new Set(["facebook", "instagram", "tiktok"])
const BRAND_HARM_TOPIC_REASONS = new Set([
  "complaint",
  "aggressive_conflict",
  "threat",
])
const BRAND_HARM_TEXT_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:problem(?:i|li)?|donma|donur|donub|xarab|nasaz|işləmir|islemir|şikay|sikay|keyfiyyətsiz|keyfiyyetsiz|saxta|fırıldaq|firildaq|aldad|zəhərlən|zeherlen|qüsur|qusur|geri qaytar|imtina|bağlanıb|baglanib)\p{L}*/iu,
  /(?:çatdırılma|catdirilma|sifariş|sifaris|kuryer|cavab|xidmət|xidmet).{0,40}gecik\p{L}*|gecik\p{L}*.{0,40}(?:çatdırılma|catdirilma|sifariş|sifaris|kuryer|cavab|xidmət|xidmet)/iu,
  /\b(?:problem|broken|defect|malfunction|freez|not working|complaint|bad service|poor quality|scam|fraud|fake|mislead|poison|contaminat|refund|refus|closed|shutdown)\w*/iu,
  /\b(?:delivery|order|courier|refund|response|service).{0,40}\b(?:delay|late)\w*|\b(?:delay|late)\w*.{0,40}\b(?:delivery|order|courier|refund|response|service)\b/iu,
  /(?:проблем|сломан|дефект|неисправ|завис|не работает|жалоб|плох\w* обслуж|некачествен|мошенн|обман|поддел|отрав|возврат|отказ|закрыл)\w*/iu,
  /(?:достав|заказ|курьер|возврат|ответ|сервис).{0,40}(?:задерж|опозд)|(?:задерж|опозд).{0,40}(?:достав|заказ|курьер|возврат|ответ|сервис)/iu,
]

export type ManualEngagementRiskReason =
  | "negative_sentiment"
  | "brand_harm_text"
  | "harmful_topic"
  | "triage_complaint"
  | "triage_high_pr_risk"
  | "triage_escalation"

export interface ManualEngagementCandidate {
  platform?: string | null
  text?: string | null
  sentiment?: string | null
  contentKind?: string | null
  sourceType?: string | null
  sourceMetadata?: unknown
}

export interface ManualEngagementRiskAssessment {
  eligible: boolean
  reasons: ManualEngagementRiskReason[]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function assessManualEngagementRisk(
  input: ManualEngagementCandidate,
): ManualEngagementRiskAssessment {
  if (!MANUAL_EXTERNAL_PLATFORMS.has(input.platform?.trim().toLowerCase() || "")) {
    return { eligible: false, reasons: [] }
  }

  const reasons: ManualEngagementRiskReason[] = []
  const sentiment = input.sentiment?.trim().toLowerCase()
  const isCommentOrReply = isExternalCommentOrReply(input)
  const hasBrandHarmText = BRAND_HARM_TEXT_PATTERNS.some((pattern) => pattern.test(input.text || ""))

  const topic = classifySocialAiTopic(input.text || "")
  const hasHarmfulTopic = Boolean(topic.reason && BRAND_HARM_TOPIC_REASONS.has(topic.reason))
  if (hasHarmfulTopic) {
    reasons.push("harmful_topic")
  }
  if (hasBrandHarmText) reasons.push("brand_harm_text")

  const triage = asRecord(asRecord(input.sourceMetadata).socialTriage)
  const triageReasons = asStringList(triage.reasons)
  const triageHasBrandHarmEvidence = triage.complaint === true || triageReasons.some((reason) => (
    reason === "negative_sentiment"
    || reason === "complaint"
    || reason === "forbidden_aggressive_conflict"
    || reason === "forbidden_threat"
  ))
  if (triage.complaint === true) reasons.push("triage_complaint")
  if (triage.prRisk === "high" && triageHasBrandHarmEvidence) {
    reasons.push("triage_high_pr_risk")
  }
  if (
    triage.recommendedAction === "escalate"
    && (triageHasBrandHarmEvidence || sentiment === "negative")
  ) {
    reasons.push("triage_escalation")
  }
  if (
    sentiment === "negative"
    && (isCommentOrReply || hasBrandHarmText || hasHarmfulTopic || triageHasBrandHarmEvidence)
  ) {
    reasons.unshift("negative_sentiment")
  }

  return {
    eligible: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
  }
}

export function isManualEngagementRiskCandidate(input: ManualEngagementCandidate): boolean {
  return assessManualEngagementRisk(input).eligible
}
