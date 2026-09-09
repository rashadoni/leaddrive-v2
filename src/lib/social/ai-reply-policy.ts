export const SOCIAL_AI_REGENERATE_REASONS = [
  "too_long",
  "too_formal",
  "wrong_tone",
  "wrong_language",
  "softer",
  "brand_binding_changed",
] as const

export type SocialAiRegenerateReason = (typeof SOCIAL_AI_REGENERATE_REASONS)[number]

export interface SocialAiTopicDecision {
  blocked: boolean
  reason: string | null
}

const HUMAN_REVIEW_DRAFT_REASONS = new Set([
  "price_dispute",
  "complaint",
  "aggressive_conflict",
])

const AZ_HINTS = [
  "salam", "sagol", "təşəkkür", "tesekkur", "elaqe", "əlaqə", "zəhmət", "zehmet",
  "müştəri", "musteri", "qiymət", "qiymet", "nömrə", "nomre", "yazın", "yazin",
  // Common ASCII/transliterated Azerbaijani from public social comments.
  // Without these signals the fallback classifier labels them as English and
  // the default AZ feed filter hides a comment immediately after acceptance.
  "corek", "magaza", "mesuliyyetsiz", "mosennik", "sehv", "etmiremse",
  "saxlamaga", "icazesi", "artiq", "olmali", "yoxdur", "bunlar", "getmeyin",
  "vaxti kecib", "sroku kecib",
]

const RU_HINTS = [
  "привет", "спасибо", "цена", "номер", "позвоните", "жалоба", "почему",
  "когда", "отправьте", "напишите", "заказ", "клиент",
]

const FORBIDDEN_PATTERNS: Array<{ reason: string; patterns: RegExp[] }> = [
  {
    reason: "price_dispute",
    patterns: [
      /\b(price|cost|expensive|cheap|refund|discount)\b/i,
      /\b(qiym[eə]t|bahad[ıi]r|endir[iı]m|geri\s*qaytar)\b/i,
      /\b(цена|дорого|скидк|возврат|дешев)\b/i,
    ],
  },
  {
    reason: "complaint",
    patterns: [
      /\b(complaint|complain|broken|not\s*working|bad\s*service)\b/i,
      /(şikay|sikay|islemir|işləmir|pis\s*xidmet|pis\s*xidmət)/i,
      /(жалоб|не\s*работает|плохой\s*сервис|ужасн)/i,
    ],
  },
  {
    reason: "legal_or_medical",
    patterns: [
      /\b(lawyer|legal|court|sue|medical|doctor|diagnosis|treatment)\b/i,
      /\b(h[uü]quq|m[eə]hk[eə]m[eə]|v[eə]kil|tibbi|h[eə]kim|m[uü]alic[eə])\b/i,
      /\b(юрист|суд|адвокат|медицин|врач|диагноз|лечение)\b/i,
    ],
  },
  {
    reason: "personal_data",
    patterns: [
      /\b(passport|fin\s*code|id\s*card|ssn|credit\s*card)\b/i,
      /\b(passport|ş[eə]xsiyy[eə]t|fin\s*kod|kart\s*n[oö]mr[eə]si)\b/i,
      /\b(паспорт|персональн|карт[аы]\s*\d|инн|пин)\b/i,
    ],
  },
  {
    reason: "aggressive_conflict",
    patterns: [
      /\b(scam|fraud|liar|thief|hate|angry)\b/i,
      /\b(d[əe]l[eə]duz|f[ıi]r[ıi]ldaq|yalan[cç][ıi]|nifr[eə]t)\b/i,
      /(мошенник|обман|вор|ненавиж|лжец)/i,
    ],
  },
  {
    // Явные угрозы, насилие, doxxing — всегда к человеку.
    reason: "threat",
    patterns: [
      /\b(kill|murder|bomb|shoot|stab|assault|threaten|doxx?|harass)\b/i,
      // Azerbaijani letters aren't ASCII \w, so \b anchors misfire — match stems.
      /([öo]ld[uü]r|q[əe]tl\b|partlad|t[əe]hdid|z[oə]rlama)/i,
      /(убью|убить|взорв|застрел|зарежу|угрож|расправ|изнасил)/i,
    ],
  },
  {
    // Политические темы — высокий репутационный риск, только человек.
    reason: "political",
    patterns: [
      /\b(election|referendum|president|parliament|political\s*party|protest\s*(march|action)|sanction)\b/i,
      /\b(se[çc]ki|referendum|prezident|parlament|siyasi\s*partiya|etiraz\s*aksiya|sanksiya)\b/i,
      /(выбор[ыа]\b|референдум|президент|парламент|политическ|митинг|санкци)/i,
    ],
  },
  {
    // Финансовые/инвестиционные советы — регуляторный риск, только человек.
    reason: "financial_advice",
    patterns: [
      /\b(invest(ment|ing)?|stocks?|shares|crypto|bitcoin|trading|loan\s*(rate|advice)|financial\s*advice)\b/i,
      /\b(investisiya|birja|kripto|bitcoin|maliyy[əe]\s*m[əe]sl[əe]h[əe]t)\b/i,
      /(инвестиц|инвестир|бирж|крипто|биткоин|вложени[ея]|финансов\w*\s*совет)/i,
    ],
  },
  {
    // Prompt injection в untrusted социальном тексте — не выполнять инструкции.
    reason: "prompt_injection",
    patterns: [
      /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instruction|prompt|message)/i,
      /disregard\s+(all\s+|the\s+)?(previous|prior|above)\s+/i,
      /(system|developer)\s*prompt|you\s+are\s+now\s+(a|an|the)\b|act\s+as\s+(an?\s+)?(admin|system|developer|dan)\b|reveal\s+(your\s+)?(system\s+)?prompt/i,
      /(игнорируй|забудь)\s+(все\s+)?(предыдущие|прежние|прошлые)\s+(инструкц|указан|сообщен)/i,
      /(əvv[əe]lki|[əe]vv[əe]lki)\s+.*(g[öo]st[əe]ri[şs]|t[əe]limat).*(iqnor|unut)/i,
    ],
  },
]

export function detectSocialReplyLanguage(text: string): "az" | "ru" | "en" {
  const normalized = text.toLocaleLowerCase("az")
  if (/[а-яё]/i.test(text) || RU_HINTS.some((hint) => normalized.includes(hint))) return "ru"
  if (/[əƏıİöÖüÜğĞşŞçÇ]/.test(text) || AZ_HINTS.some((hint) => normalized.includes(hint))) return "az"
  return "en"
}

export function classifySocialAiTopic(text: string): SocialAiTopicDecision {
  for (const group of FORBIDDEN_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(text))) {
      return { blocked: true, reason: group.reason }
    }
  }
  return { blocked: false, reason: null }
}

/**
 * Some reputation incidents are unsafe for unattended automation but still
 * benefit from a carefully constrained draft that a human must review.
 * Threats, regulated advice, personal data, legal/medical matters and prompt
 * injection remain hard-blocked and never reach the drafting model.
 */
export function canDraftSocialReplyForHumanReview(topic: SocialAiTopicDecision): boolean {
  return !topic.blocked || Boolean(topic.reason && HUMAN_REVIEW_DRAFT_REASONS.has(topic.reason))
}

export function isHardBlockedSocialReplyTopic(topic: SocialAiTopicDecision): boolean {
  return topic.blocked && !canDraftSocialReplyForHumanReview(topic)
}

export function shouldDryRunAutoSendSocialReply(sentiment: string | null | undefined, topic: SocialAiTopicDecision): boolean {
  return sentiment === "positive" && !topic.blocked
}
