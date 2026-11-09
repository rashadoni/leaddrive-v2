/**
 * What a staff question in Da Vinci is about — by its words, without a model.
 *
 * Until 2026-11-09 this was a Haiku call in front of every answer of an
 * organisation with more than one Da Vinci agent (LeadDrive Inc., ATS Food,
 * Service Desk): measured on prod it took 1.1–1.6 s of the 1.7–2.2 s before
 * the first word. The owner chose "by words" (2026-11-09): the answer starts
 * at once, and a question with no clear words goes to the general agent —
 * which answers anything, with the same CRM tools, so a miss costs little.
 *
 * Words are matched at a word start, in Russian, Azerbaijani and English. A
 * question that names two areas equally ("отчёт по продажам") goes to the
 * general agent: no area wins.
 */

export const INTENT_CATEGORIES = [
  "sales_inquiry",    // Deals, pipeline, leads, prices, discounts
  "support_request",  // Tickets, complaints, errors
  "billing_question", // Invoices, payments, subscriptions
  "marketing_info",   // Campaigns, mailings, audiences
  "data_analysis",    // Reports, statistics, forecasts
  "general",          // Anything else
] as const

export type Intent = typeof INTENT_CATEGORIES[number]

/** Word starts (regex fragments); `(?!\p{L})` closes a word that must end there. */
const WORDS: Record<Exclude<Intent, "general">, readonly string[]> = {
  sales_inquiry: [
    // ru
    "сделк", "продаж", "продал", "воронк", "лид(?:ы|а|ов|ам|ами|ах|у|ом|е)?(?!\\p{L})", "коммерческ", "кп(?!\\p{L})",
    "цен(?:а|ы|у|е|ой|ам|ами|ах)?(?!\\p{L})", "ценообразован", "прайс", "скидк",
    // az
    "satış", "sövdələş", "qiymət", "endirim", "kommersiya", "huni", "lid(?:lər\\p{L}*|i|in|ə|də|dən)?(?!\\p{L})",
    // en
    "deals?(?!\\p{L})", "sales?(?!\\p{L})", "selling", "pipeline", "leads?(?!\\p{L})", "pric(?:e|es|ing)(?!\\p{L})",
    "discount", "quot(?:e|es|ation)", "opportunit", "upsell",
  ],
  support_request: [
    "тикет", "обращени", "жалоб", "проблем", "ошибк", "баг(?:и|ов|а)?(?!\\p{L})", "не работа", "сломал",
    "поддержк", "инцидент", "sla(?!\\p{L})",
    "tiket", "müraciət", "şikayət", "problem", "xəta", "işləmir", "dəstək", "insident",
    "tickets?(?!\\p{L})", "complain", "issues?(?!\\p{L})", "bugs?(?!\\p{L})", "errors?(?!\\p{L})", "broken",
    "support", "not working", "doesn'?t work", "incident",
  ],
  billing_question: [
    "сч[её]т-фактур", "сч[её]т(?:а|ов|у|ом|е)? на оплату", "инвойс", "оплат", "плат[её]ж", "подписк", "задолженн",
    "биллинг", "дебитор",
    "faktura", "ödəniş", "borc", "abunə", "debitor",
    "invoic", "payments?(?!\\p{L})", "billing", "subscription", "refund", "receivable",
  ],
  marketing_info: [
    "маркетинг", "кампани", "рассылк", "сегмент", "аудитори", "реклам", "соцсет", "лендинг", "таргет", "smm(?!\\p{L})",
    "marketinq", "kampaniya", "reklam", "seqment", "auditoriya", "sosial şəbək", "göndəriş",
    "marketing", "campaign", "newsletter", "segment", "audience", "advert", "ads(?!\\p{L})", "social media",
    "landing", "mailing",
  ],
  data_analysis: [
    "аналитик", "отч[её]т", "статистик", "прогноз", "дашборд", "метрик", "kpi(?!\\p{L})", "динамик", "конверси", "тренд",
    "analitika", "hesabat", "statistika", "proqnoz", "göstərici", "dinamika", "konversiya", "trend",
    "analytic", "reports?(?!\\p{L})", "statistic", "forecast", "dashboard", "metric", "trends?(?!\\p{L})", "conversion",
  ],
}

const PATTERNS = Object.entries(WORDS).map(([intent, words]) => ({
  intent: intent as Intent,
  words: words.map((word) => new RegExp(`(?<!\\p{L})${word}`, "u")),
}))

export function classifyIntent(message: string): { intent: Intent; confidence: number } {
  // "İ".toLowerCase() is "i" + a combining dot; drop the dot so "İş" matches "iş".
  const text = String(message).toLowerCase().replace(/̇/g, "")
  let best: Intent = "general"
  let bestScore = 0
  let tied = false
  for (const { intent, words } of PATTERNS) {
    const score = words.filter((word) => word.test(text)).length
    if (score > bestScore) {
      best = intent
      bestScore = score
      tied = false
    } else if (score > 0 && score === bestScore) {
      tied = true
    }
  }
  if (bestScore === 0 || tied) return { intent: "general", confidence: 0.5 }
  return { intent: best, confidence: Math.min(0.9, 0.5 + 0.2 * bestScore) }
}
