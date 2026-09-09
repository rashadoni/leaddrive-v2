export const RELEVANCE_CONFIDENCE_POLICY_VERSION = "relevance-confidence-v1"

export type RelevanceConfidencePolicy = {
  version: string
  minAutoAcceptConfidence: number
  reviewRetentionDays: number
  /**
   * Сколько дней хранить текст записи, отклонённой сверкой строк как «бренда
   * нет в тексте» (#646).
   *
   * Такие записи рождались вычищенными и жили 24 часа: чужой публичный
   * контент, который системе не нужен. Но именно в них крупнейший класс
   * потерь — площадка нашла запись по слову, а названия бренда в тексте нет
   * (прод, 2026-08-03: 9570 записей за шесть дней). Без сохранённого текста
   * ИИ-судья судить не может: судить нечего.
   *
   * Решение владельца 2026-08-03: контент публичный, храним. Срок остаётся
   * настройкой, а не константой, потому что это баланс между пользой для
   * судьи и объёмом чужих персональных данных у нас на диске.
   */
  subjectMatchCandidateRetentionDays: number
}

export const DEFAULT_RELEVANCE_CONFIDENCE_POLICY: RelevanceConfidencePolicy = {
  version: RELEVANCE_CONFIDENCE_POLICY_VERSION,
  minAutoAcceptConfidence: 0.7,
  reviewRetentionDays: 7,
  subjectMatchCandidateRetentionDays: 30,
}

export type ConfidenceBoundDecision = {
  status: "ACCEPTED" | "REVIEW" | "REJECTED" | "POLICY_DENIED" | "DELETED_AT_SOURCE"
  reason: string
  confidence: number
  matchedTerms: string[]
}

export function assertValidRelevanceConfidencePolicy(policy: RelevanceConfidencePolicy): void {
  if (!policy.version.trim()) throw new Error("relevance confidence policy version is required")
  if (!Number.isFinite(policy.minAutoAcceptConfidence)
    || policy.minAutoAcceptConfidence < 0
    || policy.minAutoAcceptConfidence > 1) {
    throw new Error("minAutoAcceptConfidence must be between 0 and 1")
  }
  if (!Number.isInteger(policy.reviewRetentionDays)
    || policy.reviewRetentionDays < 1
    || policy.reviewRetentionDays > 30) {
    throw new Error("reviewRetentionDays must be an integer between 1 and 30")
  }
  // Потолок в год — это не про место на диске (при сотне брендов там единицы
  // гигабайт), а про то, чтобы срок хранения чужого контента нельзя было
  // выставить «навсегда» опечаткой.
  if (!Number.isInteger(policy.subjectMatchCandidateRetentionDays)
    || policy.subjectMatchCandidateRetentionDays < 1
    || policy.subjectMatchCandidateRetentionDays > 365) {
    throw new Error("subjectMatchCandidateRetentionDays must be an integer between 1 and 365")
  }
}

export function applyRelevanceConfidencePolicy<T extends ConfidenceBoundDecision>(
  decision: T,
  policy: RelevanceConfidencePolicy = DEFAULT_RELEVANCE_CONFIDENCE_POLICY,
): T {
  assertValidRelevanceConfidencePolicy(policy)
  if (decision.status !== "ACCEPTED") return decision
  if (Number.isFinite(decision.confidence) && decision.confidence >= policy.minAutoAcceptConfidence) return decision
  return {
    ...decision,
    status: "REVIEW",
    reason: Number.isFinite(decision.confidence)
      ? "confidence_below_auto_accept_threshold"
      : "confidence_invalid",
    confidence: Number.isFinite(decision.confidence) ? Math.max(0, Math.min(1, decision.confidence)) : 0,
  }
}
