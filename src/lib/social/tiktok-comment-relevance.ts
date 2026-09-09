export const SOCIAL_COMMENT_RELEVANCE_VERSION = "social-comment-relevance-v2"
// Backwards-compatible export for older telemetry readers. New observations
// use the platform-neutral version above.
export const TIKTOK_COMMENT_RELEVANCE_VERSION = SOCIAL_COMMENT_RELEVANCE_VERSION

export type SocialCommentRelevanceReason =
  | "OWN_TENANT_TERM"
  | "ENABLED_SCENARIO_MATCH"
  | "SUBJECT_CONTEXT_MATCH"
  | "ENGAGEMENT_SIGNAL"
  | "REPLY_TO_ACTIONABLE_COMMENT"
  | "THREAD_CONTEXT_FOR_ACTIONABLE_DESCENDANT"
  | "NO_ACTIONABLE_SIGNAL"

// Owner decision 2026-07-19 (option 2): comments on a MATCHED publication are
// actionable not only on a keyword hit, but also when the comment itself
// carries a complaint / lead-intent / urgency / question signal. Lexicons
// mirror ai-triage.ts (az/ru/en) — keep in sync when triage patterns change.
// NOTE: \b is ASCII-only in JS regexes (Cyrillic/az letters are non-word
// chars), so non-Latin patterns use bare stems instead of word boundaries.

// Complaint / negative sentiment — the "негатив относящийся к нашим брендам"
// bucket. Kept as its own export so the cross-platform subject matcher can
// surface a negative comment in brand context (owned channel / matched parent)
// without also pulling in neutral questions or price chatter.
const COMPLAINT_SIGNAL_PATTERNS = [
  /\b(complaint|broken|not\s*working|bad\s*service|terrible|refund|angry|scam|fraud|worst|awful|horrible|disgusting|rude|useless|waste|never\s*again|cheat(ed|ing)?|ripoff|rip\s*off|liar|lying)\b/i,
  /(şikay|sikay|işləmir|islemir|xarab|problem|pis\s*xidm[eə]t|geri\s*qaytar|f[ıi]r[ıi]ldaq|b[eə]rbad|d[eə]hş[eə]t|r[eə]zil|aldat|keyfiyy[eə]tsiz|m[eə]suliyy[eə]tsiz|biab[ıi]r[cç][ıi]|nat[eə]miz|iyr[eə]nc|kobud|vaxt[ıi]\s*ke[cç]mi[sş]|z[eə]h[eə]r|palma\s*ya[gğ][ıi]?|pul.*qaytar)/i,
  /(жалоб|не\s*работает|плох(ой|ая|ое|ие)|ужасн|отврат|возврат|мошенник|обман|хамств|груб|отстой|кошмар|развод|некачествен|никогда\s*больше|верните\s*деньги|наду(л|ть|ва))/i,
]

// Lead intent, urgency and questions — actionable engagement that is not itself
// negative. Used only after a publication has already matched the monitored
// subject; it never turns arbitrary platform chatter into a brand mention.
const NON_COMPLAINT_ENGAGEMENT_PATTERNS = [
  // lead intent
  /\b(price|pricing|cost|demo|buy|quote|contact|call|whatsapp|number|trial|order)\b/i,
  /(qiym[eə]t|almaq|sifari[sş]|[eə]laq[eə]|elaqe|z[eə]ng|n[oö]mr[eə])/i,
  /(цена|стоимость|купить|демо|заказ|связаться|позвоните|номер|ватсап)/i,
  // urgency
  /\b(urgent|asap|immediately|emergency|sos)\b/i,
  /(t[eə]cili|d[eə]rhal|yard[ıi]m|k[oö]m[eə]k)/i,
  /(срочно|немедленно|экстренно|помогите)/i,
  // question
  /\?/,
  /\b(how\s|what\s|when\s|where\s|can\s+i\s|do\s+you\s)/i,
  /(nec[eə]\s|harada\s|hans[ıi]\s|olarm[ıi])/i,
  /(как\s|что\s|когда\s|где\s|можно\s|почему\s)/i,
]

const ENGAGEMENT_SIGNAL_PATTERNS = [...COMPLAINT_SIGNAL_PATTERNS, ...NON_COMPLAINT_ENGAGEMENT_PATTERNS]

/** Complaint / negative sentiment only (az/ru/en). */
export function hasCommentComplaintSignal(text: string | null | undefined): boolean {
  const value = String(text ?? "").trim()
  if (!value) return false
  return COMPLAINT_SIGNAL_PATTERNS.some(pattern => pattern.test(value))
}

export function hasCommentEngagementSignal(text: string | null | undefined): boolean {
  const value = String(text ?? "").trim()
  if (!value) return false
  return ENGAGEMENT_SIGNAL_PATTERNS.some(pattern => pattern.test(value))
}

export type SocialCommentRelevanceDecision = {
  externalId: string
  classification: "ACTIONABLE" | "CONTEXT" | "REJECTED"
  reason: SocialCommentRelevanceReason
}

export type SocialCommentRelevanceInput = {
  externalId: string
  parentExternalId?: string | null
  matchedTerm?: string | null
  enabledScenarioMatch?: boolean
  subjectContextMatch?: boolean
  engagementSignal?: boolean
}

export function classifySocialCommentThread(
  rows: readonly SocialCommentRelevanceInput[],
): SocialCommentRelevanceDecision[] {
  const byId = new Map(rows.map(row => [row.externalId, row]))
  if (byId.size !== rows.length || rows.some(row => !row.externalId.trim())) {
    throw new Error("Social comment relevance requires unique external IDs")
  }
  const actionable = new Map<string, SocialCommentRelevanceReason>()
  for (const row of rows) {
    if (row.matchedTerm?.trim()) actionable.set(row.externalId, "OWN_TENANT_TERM")
    else if (row.enabledScenarioMatch) actionable.set(row.externalId, "ENABLED_SCENARIO_MATCH")
    else if (row.subjectContextMatch) actionable.set(row.externalId, "SUBJECT_CONTEXT_MATCH")
    else if (row.engagementSignal) actionable.set(row.externalId, "ENGAGEMENT_SIGNAL")
  }
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (!actionable.has(row.externalId) && row.parentExternalId && actionable.has(row.parentExternalId)) {
        actionable.set(row.externalId, "REPLY_TO_ACTIONABLE_COMMENT")
        changed = true
      }
    }
  }
  const context = new Set<string>()
  for (const id of actionable.keys()) {
    let parentId = byId.get(id)?.parentExternalId ?? null
    const visited = new Set<string>()
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId)
      if (!actionable.has(parentId)) context.add(parentId)
      parentId = byId.get(parentId)?.parentExternalId ?? null
    }
  }
  return rows.map(row => actionable.has(row.externalId)
    ? { externalId: row.externalId, classification: "ACTIONABLE", reason: actionable.get(row.externalId)! }
    : context.has(row.externalId)
      ? { externalId: row.externalId, classification: "CONTEXT", reason: "THREAD_CONTEXT_FOR_ACTIONABLE_DESCENDANT" }
      : { externalId: row.externalId, classification: "REJECTED", reason: "NO_ACTIONABLE_SIGNAL" })
}

// Public aliases preserve existing imports while adapters migrate to the
// platform-neutral classifier.
export type TikTokCommentRelevanceReason = SocialCommentRelevanceReason
export type TikTokCommentRelevanceDecision = SocialCommentRelevanceDecision
export type TikTokCommentRelevanceInput = SocialCommentRelevanceInput
export const classifyTikTokCommentThread = classifySocialCommentThread
