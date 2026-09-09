import type { Tool } from "@anthropic-ai/sdk/resources/messages"
import { z } from "zod"
import { ANALYTICS_PERIODS } from "./analytics-period"
import { SECTION_GUIDE } from "@/lib/ai/voice/section-guide"
import { VOICE_SECTION_KEYS, VOICE_SECTIONS } from "@/lib/ai/voice/sections"
import { navItemPathname, navItems } from "@/lib/nav-items"
import ruMessages from "../../../messages/ru.json"
import enMessages from "../../../messages/en.json"
import azMessages from "../../../messages/az.json"

export const CHAT_ANALYTICS_TOOL_NAMES = [
  "get_crm_period_report",
  "get_crm_ranking",
  "get_kpi_arena",
  "explain_crm_section",
] as const

export type ChatAnalyticsToolName = (typeof CHAT_ANALYTICS_TOOL_NAMES)[number]

export const PERIOD_REPORT_METRICS = [
  "leads_created",
  "deals_created",
  "sales_won",
  "quotes_created",
  "quotes_sent",
  "quotes_accepted",
  "tasks_completed",
  "tickets_resolved",
] as const

export const CRM_RANKING_METRICS = [
  "won_deals",
  "answered_leads_by_call",
  "created_leads",
  "completed_tasks",
  "resolved_tickets",
  "created_quotes",
] as const

export const KPI_GROUPS = ["sales", "mtm", "tickets", "projects", "tasks"] as const
export const KPI_PERIODS = ["day", "week", "month", "quarter", "year", "all"] as const
// Explain every safe, menu-derived section for which the audited server guide
// has evidence. Sensitive navigation destinations excluded by VOICE_SECTIONS
// are deliberately not advertised as callable assistant knowledge.
export const CRM_SECTION_GUIDE_KEYS = VOICE_SECTION_KEYS
  .filter((key) => Boolean(SECTION_GUIDE[key]))
  .sort()

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
const periodFields = {
  period: z.enum(ANALYTICS_PERIODS),
  dateFrom: dateKey.optional(),
  dateTo: dateKey.optional(),
}

function validateCustomPeriod(
  value: { period: string; dateFrom?: string; dateTo?: string },
  ctx: z.RefinementCtx,
) {
  if (value.period === "custom" && (!value.dateFrom || !value.dateTo)) {
    ctx.addIssue({ code: "custom", message: "Custom period requires dateFrom and dateTo" })
  }
  if (value.period !== "custom" && (value.dateFrom || value.dateTo)) {
    ctx.addIssue({ code: "custom", message: "dateFrom/dateTo are only valid with period=custom" })
  }
}

export const CHAT_ANALYTICS_TOOL_SCHEMAS = {
  get_crm_period_report: z
    .object({
      metric: z.enum(PERIOD_REPORT_METRICS),
      ...periodFields,
    })
    .strict()
    .superRefine(validateCustomPeriod),
  get_crm_ranking: z
    .object({
      metric: z.enum(CRM_RANKING_METRICS),
      direction: z.enum(["top", "bottom"]).default("top"),
      limit: z.number().int().min(1).max(10).default(5),
      ...periodFields,
    })
    .strict()
    .superRefine(validateCustomPeriod),
  get_kpi_arena: z
    .object({
      group: z.enum(KPI_GROUPS),
      period: z.enum(KPI_PERIODS),
      direction: z.enum(["top", "bottom"]).default("top"),
      sortBy: z.enum(["kpi", "volume"]).default("kpi"),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  explain_crm_section: z.object({ section: z.string().trim().min(2).max(80) }).strict(),
} satisfies Record<ChatAnalyticsToolName, z.ZodTypeAny>

const periodProperties = {
  period: {
    type: "string" as const,
    enum: [...ANALYTICS_PERIODS],
    description: "today/yesterday are user-local calendar days; this_week/this_month are calendar-to-now; last_7_days/last_30_days are rolling windows; custom uses inclusive dateFrom/dateTo; all_time means all recorded history",
  },
  dateFrom: { type: "string" as const, description: "YYYY-MM-DD, required only for custom" },
  dateTo: { type: "string" as const, description: "YYYY-MM-DD inclusive, required only for custom" },
}

export const CHAT_ANALYTICS_TOOLS: Tool[] = [
  {
    name: "get_crm_period_report",
    description:
      "Return an exact, timezone-bounded CRM count/report. MUST be used for how-many, report, statistics, today, week, month, named/custom-date questions. Metric meanings: leads_created/deals_created/quotes_created use createdAt; sales_won uses recorded won pipeline transitions; quotes_sent uses sentAt; quotes_accepted uses acceptedAt; tasks_completed uses completedAt; tickets_resolved uses resolvedAt. Never estimate a count.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        metric: { type: "string", enum: [...PERIOD_REPORT_METRICS] },
        ...periodProperties,
      },
      required: ["metric", "period"],
    },
  },
  {
    name: "get_crm_ranking",
    description:
      "Rank employees with recorded activity by a proven CRM event in an exact timezone-bounded period. MUST be used for who did most/least/top/bottom comparisons. A bottom result is the lowest NON-ZERO recorded participant; the tool cannot call someone with no event an absolute least performer. won_deals uses recorded won transitions; answered_leads_by_call counts DISTINCT leads with answered outbound human CallLog rows (startedAt/userId/leadId); created_leads uses createdAt/current assignedTo (not creator); completed_tasks uses completedAt/assignedTo; resolved_tickets uses resolvedAt/assignedTo; created_quotes uses createdAt/createdBy. Preserve all attribution and coverage caveats.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        metric: { type: "string", enum: [...CRM_RANKING_METRICS] },
        direction: { type: "string", enum: ["top", "bottom"] },
        limit: { type: "number", minimum: 1, maximum: 10 },
        ...periodProperties,
      },
      required: ["metric", "period"],
    },
  },
  {
    name: "get_kpi_arena",
    description:
      "Read the same normalized employee ranking shown in LeadDrive KPI Arena. Use for KPI/Arena rank, attainment, status, or volume questions. Sales is quota-based and always applies the current quarter; other groups use the Arena's own documented period semantics. Never substitute this for an exact custom-date CRM event report.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        group: { type: "string", enum: [...KPI_GROUPS] },
        period: { type: "string", enum: [...KPI_PERIODS] },
        direction: { type: "string", enum: ["top", "bottom"] },
        sortBy: { type: "string", enum: ["kpi", "volume"] },
        limit: { type: "number", minimum: 1, maximum: 10 },
      },
      required: ["group", "period"],
    },
  },
  {
    name: "explain_crm_section",
    description:
      "Explain a LeadDrive CRM section from the server-maintained product guide. Use for 'what is this section/how does it work' questions. For KPI Arena pass section='leaderboard' (aliases such as 'KPI Arena' are also accepted).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        section: {
          type: "string",
          enum: CRM_SECTION_GUIDE_KEYS,
          description: "Server-maintained menu section key. Visible-name examples: KPI Arena = leaderboard; Отчёты/Reports/Hesabatlar = reports; Конструктор отчётов/Report Builder/Hesabat qurucusu = reports_builder; Журнал активности MTM/MTM Activity/MTM fəaliyyət jurnalı = mtm_activity.",
        },
      },
      required: ["section"],
    },
  },
]

export function isChatAnalyticsToolName(value: string): value is ChatAnalyticsToolName {
  return (CHAT_ANALYTICS_TOOL_NAMES as readonly string[]).includes(value)
}

/**
 * A narrow deterministic router for questions where an unsupported free-text
 * answer would be dangerous. It only forces a tool for clear CRM analytics or
 * section-help intent; ordinary conversation remains model-routed.
 */
/**
 * Whether the message states a period the server can parse on its own.
 *
 * The date is a placeholder: only the presence of a window matters here, not
 * where it lands. Callers that need the resolved range use the parser directly.
 */
export function messageCarriesExplicitPeriod(message: string): boolean {
  return explicitPeriodFromMessage(analyticsMatchText(message), "2000-01-01") !== null
}

export function requiredChatAnalyticsTool(message: string): ChatAnalyticsToolName | null {
  const text = message.toLocaleLowerCase("ru-RU").replace(/[‐‑‒–—]/g, "-").trim()
  if (!text) return null

  const sectionHelp = /(что\s+(?:это|за|такое)|объясни(?:те)?|как\s+(?:работает|устроен|пользоваться)|расскажи\s+(?:про|о)|для\s+чего|what\s+is|how\s+(?:does|to\s+use)|tell\s+me\s+about|\bexplain\b|nədir|necə\s+(?:işləyir|istifadə)|haqqında\s+danış|bu\s+hansı\s+bölmə)/u.test(text)
  const sectionWord = /(раздел|section|bölmə|kpi\s*-?\s*(?:arena|арена|arenası)|leaderboard)/u.test(text)
  const knownSection = expectedSectionKey(analyticsMatchText(text)) !== null
  const implicitSectionHelp = /(что\s+(?:это|такое)|расскажи\s+(?:про|о)|what\s+is|tell\s+me\s+about|nədir|haqqında\s+danış)/u.test(text)
  if ((sectionHelp && sectionWord) || (implicitSectionHelp && knownSection)) return "explain_crm_section"

  const ranking = /((?:кто|who|which\s+(?:employee|manager|agent|person))[^.!?]{0,80}(?:больше|меньше|лучше|хуже|эффективн|результативн|наибольш|наименьш|максим|миним|\bmost\b|\bleast\b|\bfewest\b|\bfewer\b|\bmore\b|\bbest\b|\bworst\b|effective|productive|highest|lowest|maximum|minimum|rank(?:s|ed)?\s+(?:first|last))|у\s+кого|наибольш|наименьш|максим|миним|топ|лидер|аутсайдер|рейтинг|сам(?:ый|ая|ые)\s+(?:больш|мал|лучш|худш|эффективн|результативн)|\btop\b|\bbottom\b|\bmost\b|\bleast\b|\bfewest\b|\bfewer\b|\bbest\b|\bworst\b|effective|productive|highest|lowest|maximum|minimum|\branking\b|who\s+has|kimdə|kim\s+daha|reytinq|ən\s+(?:çox|az|yaxşı|pis|səmərəli|məhsuldar))/u.test(text)
  const kpiArena = /(kpi\s*-?\s*(?:arena|арена|arenası)|leaderboard|рейтинг\s+kpi)/u.test(text)
  if (kpiArena && ranking) return "get_kpi_arena"
  if (ranking) return "get_crm_ranking"

  const crmEntity = /(лид|сдел(?:к|ок)|продаж|коммерческ|предложен|котиров|задач|тикет|обращен|lead|deal|opportunit|sale|quote|proposal|task|ticket|lid|sövdələş|satış|təklif|tapşır|bilet)/u.test(text)
  const monthName = "(?:январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[йяе]|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*|january|february|march|april|may|june|july|august|september|october|november|december|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)"
  const explicitCalendarDate = new RegExp(
    `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\d{1,2}\\s+${monthName}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2}|(?:за|в|на|for|in|during)\\s+${monthName})`,
    "u",
  ).test(text)
  const resolvedPeriodIntent = explicitPeriodFromMessage(analyticsMatchText(text), "2000-01-01") !== null
  const unsupportedPriorPeriod = /(?:(?:прошл|предыдущ)\p{L}*\s+(?:недел\p{L}*|квартал\p{L}*|год\p{L}*)|(?:last|previous|past)\s+(?:week|quarter|year)|(?:keçən|əvvəlki)\s+(?:həftə\p{L}*|rüb\p{L}*|il\p{L}*))/u.test(text)
  const reportIntent = explicitCalendarDate || resolvedPeriodIntent || unsupportedPriorPeriod || /(сколько|количеств|число|итог|всего|сводк|отч[её]т|статистик|сегодня|вчера|выруч|доход|сумм|средн|процент|конверси|динамик|тренд|сравн|за\s+прошл\p{L}*\s+недел\p{L}*|(?:^|\s)(?:с|по)\s+\d{1,4}|\bq[1-4]\b|\b[iv]{1,3}\s+квартал|\b20\d{2}\b|\bytd\b|\bmtd\b|\bwtd\b|\bqtd\b|с\s+начала\s+(?:года|месяца|недели|квартала)|how\s+many|\bcount\b|number\s+of|\btotal\b|summary|report|statistic|today|yesterday|revenue|amount|average|percent|rate|conversion|trend|growth|compare|versus|last\s+week|year\s+to\s+date|month\s+to\s+date|week\s+to\s+date|quarter\s+to\s+date|neçə|\bsay\b|cəmi|ümumi|xülasə|icmal|hesabat|statistika|gəlir|məbləğ|orta|faiz|müqayisə|bu\s+gün|dünən)/u.test(text)
  if (crmEntity && reportIntent) return "get_crm_period_report"

  return null
}

/** A single deterministic reply cannot safely satisfy two evidence classes. */
export function hasMixedChatAnalyticsIntent(message: string): boolean {
  const text = analyticsMatchText(message).trim()
  const sectionWord = /(раздел|section|bolme|kpi\s*-?\s*(?:arena|арена|arenasi)|leaderboard)/u.test(text)
  const broadSectionHelp = /(что\s+(?:это|за|такое)|объясни(?:те)?|как\s+(?:работает|устроен|пользоваться)|расскажи\s+(?:про|о)|для\s+чего|what\s+is|how\s+(?:does|to\s+use)|tell\s+me\s+about|\bexplain\b|nedir|nece\s+(?:isleyir|istifade)|haqqinda\s+danis)/u.test(text)
  const implicitSectionHelp = /(что\s+(?:это|такое)|расскажи\s+(?:про|о)|what\s+is|tell\s+me\s+about|nedir|haqqinda\s+danis)/u.test(text)
  const sectionHelp = (sectionWord && broadSectionHelp)
    || (implicitSectionHelp && expectedSectionKey(text) !== null)
  const ranking = /(?:кто|who|which\s+(?:employee|manager|agent|person)|у\s+кого|kim)[^.!?]{0,100}(?:больше|меньше|лучше|хуже|наибольш|наименьш|\bmost\b|\bleast\b|\bfewest\b|\bbest\b|\bworst\b|rank(?:s|ed)?\s+(?:first|last)|en\s+(?:cox|az|yaxsi|pis))/u.test(text)
    || /(?:покажи|show|goster)[^.!?]{0,50}(?:топ|рейтинг|\btop\b|\bbottom\b|ranking|reytinq)/u.test(text)
  const explicitNumeric = /(?:сколько|количеств|число|итог|how\s+many|\bcount\b|number\s+of|\btotal\b|nece|cemi|umumi)/u.test(text)
  // In a phrase such as "больше всего" the word "всего" is part of a
  // ranking superlative, not a second request for a numeric total.
  const numeric = explicitNumeric || (!ranking && /(?:^|\s)всего(?:\s|$)/u.test(text))

  const metricFamilies = [
    /(?:лид|lead|lid)/u,
    /(?:сдел|продаж|deal|opportunit|sale|sovdeles|satis)/u,
    /(?:предлож|котиров|quote|proposal|teklif)/u,
    /(?:задач|task|tapsir)/u,
    /(?:тикет|обращен|ticket|bilet)/u,
  ].filter((pattern) => pattern.test(text)).length

  if (metricFamilies > 1 && (numeric || ranking || sectionHelp)) return true
  if (sectionHelp && (ranking || numeric)) return true
  if (ranking && explicitNumeric) return true
  return false
}

type ExpectedPeriod = {
  period: string
  dateFrom?: string
  dateTo?: string
}

const MONTH_ALIASES: Array<[RegExp, number]> = [
  [/^(?:январ|january|yanvar)/u, 1],
  [/^(?:феврал|february|fevral)/u, 2],
  [/^(?:март|march|mart)/u, 3],
  [/^(?:апрел|april|aprel)/u, 4],
  [/^(?:май|мая|мае|may)/u, 5],
  [/^(?:июн|june|iyun)/u, 6],
  [/^(?:июл|july|iyul)/u, 7],
  [/^(?:август|august|avqust)/u, 8],
  [/^(?:сентябр|september|sentyabr)/u, 9],
  [/^(?:октябр|october|oktyabr)/u, 10],
  [/^(?:ноябр|november|noyabr)/u, 11],
  [/^(?:декабр|december|dekabr)/u, 12],
]

const MONTH_TOKEN = "(?:январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[йяе]|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*|january|february|march|april|may|june|july|august|september|october|november|december|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)"

export function analyticsMatchText(message: string): string {
  return message
    .toLocaleLowerCase("ru-RU")
    // NFKD turns Cyrillic `й` into `и` + combining breve. Preserve the
    // letter before stripping diacritics, otherwise `май` becomes `маи` and
    // exact month/section bindings silently fail open.
    .replace(/й/g, "\uE000")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\uE000/g, "й")
    .replace(/[əә]/g, "e")
    .replace(/ı/g, "i")
    .replace(/[‐‑‒–—]/g, "-")
}

function calendarDateKey(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day))
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) return null
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
}

function monthNumber(token: string): number | null {
  return MONTH_ALIASES.find(([pattern]) => pattern.test(token))?.[1] ?? null
}

function explicitPeriodFromMessage(text: string, currentDate: string): ExpectedPeriod | null {
  const currentYear = Number(currentDate.slice(0, 4))
  const currentMonth = Number(currentDate.slice(5, 7))
  if (!Number.isInteger(currentYear) || !Number.isInteger(currentMonth)) return null
  const explicitTextYear = /(?<!\d)(20\d{2})(?!\d)/u.exec(text)?.[1]
  const inferredYear = (month: number, suppliedYear?: string): number => {
    if (suppliedYear) return suppliedYear.length === 2 ? 2000 + Number(suppliedYear) : Number(suppliedYear)
    // A month later than the current local month means the most recent past
    // occurrence, never an unsupported future report silently chosen by the
    // model (e.g. December asked in January => previous December).
    return month > currentMonth ? currentYear - 1 : currentYear
  }

  const isoDates = [...text.matchAll(/(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/gu)].map((match) => match[1])
  if (isoDates.length > 0) {
    return {
      period: "custom",
      dateFrom: isoDates[0],
      dateTo: isoDates[1] ?? isoDates[0],
    }
  }

  const numericDates = [...text.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?(?!\d)/gu)]
    .map((match) => {
      const suppliedYear = match[3]
      const month = Number(match[2])
      return calendarDateKey(inferredYear(month, suppliedYear), month, Number(match[1]))
    })
    .filter((value): value is string => Boolean(value))
  if (numericDates.length > 0) {
    return {
      period: "custom",
      dateFrom: numericDates[0],
      dateTo: numericDates[1] ?? numericDates[0],
    }
  }

  const ruRange = new RegExp(`(?:^|\\s)с\\s+(\\d{1,2})\\s+по\\s+(\\d{1,2})\\s+(${MONTH_TOKEN})(?:\\s+(\\d{4}))?`, "u").exec(text)
  if (ruRange) {
    const month = monthNumber(ruRange[3])
    const year = inferredYear(month ?? 0, ruRange[4])
    const from = month ? calendarDateKey(year, month, Number(ruRange[1])) : null
    const to = month ? calendarDateKey(year, month, Number(ruRange[2])) : null
    if (from && to) return { period: "custom", dateFrom: from, dateTo: to }
  }

  const namedDates: Array<{ index: number; key: string }> = []
  const dayMonthPattern = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th|-?го)?\\s+(?:of\\s+)?(${MONTH_TOKEN})(?:da|de|dan|den|a|e)?(?:\\s+(\\d{4}))?`, "gu")
  for (const match of text.matchAll(dayMonthPattern)) {
    const month = monthNumber(match[2])
    const key = month
      ? calendarDateKey(inferredYear(month, match[3]), month, Number(match[1]))
      : null
    if (key) namedDates.push({ index: match.index, key })
  }
  const monthDayPattern = new RegExp(`(?:^|\\s)(${MONTH_TOKEN})(?:in|un)?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th|-d[ea])?(?:,?\\s+(\\d{4}))?`, "gu")
  for (const match of text.matchAll(monthDayPattern)) {
    const month = monthNumber(match[1])
    const key = month
      ? calendarDateKey(inferredYear(month, match[3]), month, Number(match[2]))
      : null
    if (key) namedDates.push({ index: match.index, key })
  }
  if (namedDates.length > 0) {
    namedDates.sort((a, b) => a.index - b.index)
    return {
      period: "custom",
      dateFrom: namedDates[0].key,
      dateTo: namedDates[namedDates.length - 1].key,
    }
  }

  const namedMonth = new RegExp(`(?:^|\\s)(?:за|в|на|for|in|during)\\s+(${MONTH_TOKEN})(?:\\s+(\\d{4}))?(?=$|[^\\p{L}\\p{N}])`, "u").exec(text)
  if (namedMonth) {
    const month = monthNumber(namedMonth[1])
    const year = inferredYear(month ?? 0, namedMonth[2])
    if (month) {
      const from = calendarDateKey(year, month, 1)
      const to = calendarDateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
      if (from && to) return { period: "custom", dateFrom: from, dateTo: to }
    }
  }

  // Month-first labels ("August lead count") and Azerbaijani locative forms
  // ("Avqustda", "avqust ayında") are common report phrasing too.
  const bareMonth = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${MONTH_TOKEN})(?:da|de|ta|te|\\s+ayinda)?(?:\\s*,?\\s*(20\\d{2}))?(?=$|[^\\p{L}\\p{N}])`, "u").exec(text)
  const modalMay = bareMonth?.[1] === "may" && /\bmay\s+(?:have|be|not|also|still|already|yet)\b/u.test(text)
  if (bareMonth && !modalMay) {
    const month = monthNumber(bareMonth[1])
    const year = inferredYear(month ?? 0, bareMonth[2] ?? explicitTextYear)
    if (month) {
      const from = calendarDateKey(year, month, 1)
      const to = calendarDateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
      if (from && to) return { period: "custom", dateFrom: from, dateTo: to }
    }
  }

  if (/(?:\bytd\b|year\s+to\s+date|с\s+начала\s+года|ilin\s+evvelinden)/u.test(text)) {
    return { period: "this_year" }
  }
  if (/(?:\bmtd\b|month\s+to\s+date|с\s+начала\s+месяца|ayin\s+evvelinden)/u.test(text)) {
    return { period: "this_month" }
  }
  if (/(?:\bwtd\b|week\s+to\s+date|с\s+начала\s+недели|heftenin\s+evvelinden)/u.test(text)) {
    return { period: "this_week" }
  }
  if (/(?:\bqtd\b|quarter\s+to\s+date|с\s+начала\s+квартала|rubun\s+evvelinden)/u.test(text)) {
    return { period: "this_quarter" }
  }

  const quarterMatch = /(?:\bq([1-4])\b|(?<!\d)([1-4])(?:-?(?:й|ыи|ои|го|ci|cu))?\s+(?:квартал|quarter|rub)|\b(i|ii|iii|iv)\s+(?:квартал|quarter|rub)|\b(перв\p{L}*|втор\p{L}*|трет\p{L}*|четверт\p{L}*|first|second|third|fourth|birinci|ikinci|ucuncu|dorduncu)\s+(?:квартал|quarter|rub))/u.exec(text)
  if (quarterMatch) {
    const token = quarterMatch[3] ?? quarterMatch[4] ?? ""
    const quarterFromWord = /^(?:i|перв|first|birinci)/u.test(token)
      ? 1
      : /^(?:ii|втор|second|ikinci)/u.test(token)
        ? 2
        : /^(?:iii|трет|third|ucuncu)/u.test(token)
          ? 3
          : /^(?:iv|четверт|fourth|dorduncu)/u.test(token)
            ? 4
            : 0
    const quarter = Number(quarterMatch[1] ?? quarterMatch[2] ?? quarterFromWord)
    const startMonth = (quarter - 1) * 3 + 1
    const explicitYear = /(?<!\d)(20\d{2})(?!\d)/u.exec(text)?.[1]
    const year = inferredYear(startMonth, explicitYear)
    const endMonth = startMonth + 2
    const from = calendarDateKey(year, startMonth, 1)
    const to = calendarDateKey(year, endMonth, new Date(Date.UTC(year, endMonth, 0)).getUTCDate())
    if (from && to) return { period: "custom", dateFrom: from, dateTo: to }
  }

  const standaloneYear = explicitTextYear
  if (standaloneYear) {
    return {
      period: "custom",
      dateFrom: `${standaloneYear}-01-01`,
      dateTo: `${standaloneYear}-12-31`,
    }
  }

  if (/(?:сегодня|(?:эт\p{L}*|текущ\p{L}*)\s+день|today|(?:this|current)\s+day|(?:bu|cari)\s+gun|bugun)/u.test(text)) return { period: "today" }
  if (/(?:вчера|yesterday|dunen)/u.test(text)) return { period: "yesterday" }
  if (/(?:на\s+этой\s+неделе|(?:на|за|в)\s+(?:эт\p{L}*|текущ\p{L}*)\s+недел\p{L}*|текущ\p{L}*\s+недел\p{L}*|(?:this|current)\s+week|bu\s+hefte|cari\s+hefte)/u.test(text)) return { period: "this_week" }
  if (/(?:за\s+недел|последн\p{L}*\s+7\s+дн|last\s+7\s+days|past\s+week|son\s+7\s+gun)/u.test(text)) return { period: "last_7_days" }
  if (/(?:(?:в|на|за)\s+(?:эт\p{L}*|текущ\p{L}*)\s+месяц\p{L}*|текущ\p{L}*\s+месяц\p{L}*|(?:this|current)\s+month|(?:bu|cari)\s+ay)/u.test(text)) return { period: "this_month" }
  if (/(?:за\s+месяц|последн\p{L}*\s+30\s+дн|last\s+30\s+days|past\s+month|son\s+30\s+gun)/u.test(text)) return { period: "last_30_days" }
  if (/(?:(?:за\s+)?(?:прошл|предыдущ)\p{L}*\s+месяц\p{L}*|(?:last|previous|prior)\s+month|(?:kecen|evvelki)\s+ay)/u.test(text)) return { period: "last_month" }
  if (/(?:(?:в|на|за)?\s*(?:эт\p{L}*|текущ\p{L}*)\s+квартал\p{L}*|(?:this|current)\s+quarter|(?:bu|cari)\s+rub)/u.test(text)) return { period: "this_quarter" }
  if (/(?:(?:в|на|за)?\s*(?:эт\p{L}*|текущ\p{L}*)\s+год\p{L}*|(?:this|current)\s+year|(?:bu|cari)\s+il)/u.test(text)) return { period: "this_year" }
  if (/(?:за\s+все\s+время|всего|all\s+time|\btotal\b|butun\s+dovr|\bcemi\b|\bumumi\b)/u.test(text)) return { period: "all_time" }
  return null
}

function expectedPeriodMetric(text: string): string | null {
  if (/(?:коммерческ\p{L}*\s+предлож|предлож\p{L}*|котиров|quote|proposal|teklif)/u.test(text)) {
    if (/(?:принят\p{L}*|accepted|qebul)/u.test(text)) return "quotes_accepted"
    if (/(?:отправ\p{L}*|sent|gonder)/u.test(text)) return "quotes_sent"
    return "quotes_created"
  }
  if (/(?:задач|task|tapsir)/u.test(text)) return "tasks_completed"
  if (/(?:тикет|обращен|ticket|bilet)/u.test(text)) return "tickets_resolved"
  if (/(?:лид|lead|lid)/u.test(text)) return "leads_created"
  if (/(?:продаж|sale|satis|выигр|успешн\p{L}*\s+сдел|won|qazan\p{L}*)/u.test(text)) return "sales_won"
  if (/(?:сдел(?:к|ок)|deal|opportunit|sovdeles)/u.test(text)) return "deals_created"
  return null
}

function hasUnsupportedPeriodEvent(text: string): boolean {
  const created = /(?:созда|создан|завед|зарегистрир|\bcreat(?:e|ed|ion)\b|\bopen(?:ed)?\b|yarad|acil)/u.test(text)
  const completed = /(?:выполн|заверш|\bcomplet(?:e|ed|ion)\b|\bfinish(?:ed)?\b|yerine\s+yetir|bitir|tamamla)/u.test(text)
  const resolved = /(?:реш[её]н|разреш[её]н|закрыт\p{L}*\s+(?:тикет|обращен)|\bresolved?\b|\bclosed?\s+(?:ticket|case)|hell|bagl)/u.test(text)
  const converted = /(?:конверт|преобраз|квалифицир|дисквалифицир|\bconvert(?:ed|ion)?\b|\bqualif(?:y|ied|ication)\b|\bdisqualif(?:y|ied|ication)\b|cevril|donus|ixtisas)/u.test(text)
  const lost = /(?:проигр|потерян|\blost\b|uduz)/u.test(text)
  const unsupportedQuoteState = /(?:отклон|отказ|чернов|ист[её]к|просроч|\breject(?:ed|ion)?\b|\bdrafts?\b|\bexpired?\b|redd|qaralama|muddet)/u.test(text)
  const contacted = /(?:связ|контакт|дозвон|ответил|\bcontact(?:ed)?\b|\breach(?:ed)?\b|\banswered\b|elaqe|cavab)/u.test(text)

  if (/(?:задач|task|tapsir)/u.test(text)) return created || !completed
  if (/(?:тикет|обращен|ticket|bilet)/u.test(text)) return created || !resolved
  if (/(?:лид|lead|lid)/u.test(text) && (converted || contacted)) return true
  if (/(?:сдел(?:к|ок)|deal|opportunit|sovdeles)/u.test(text) && lost) return true
  if (/(?:предлож|quote|proposal|teklif)/u.test(text) && unsupportedQuoteState) return true
  return false
}

function hasUnsupportedAnalyticsFilter(text: string, allowKpiVolume = false): boolean {
  // Current aggregate tools deliberately expose only event + period (+ rank
  // direction). Any requested source, amount, priority, segment, category or
  // other record filter must not be silently dropped.
  if (/(?:facebook|instagram|whatsapp|telegram|linkedin|tiktok|google\s+ads?|e-?mail|соцсет|с\s+сайт|из\s+сайт|источник|\bsource\b|\bchannel\b|канал|mənbə|kanal)/u.test(text)) return true
  if (/(?:приоритет|сроч|\bpriority\b|\burgent\b|high[-\s]+priority|low[-\s]+priority|prioritet|təcili)/u.test(text)) return true
  if (/(?:enterprise|корпоратив|vip|\bbilling\b|биллинг|технич\p{L}*|\btechnical\b|категор|\bcategory\b|сегмент|\bsegment\b|müəssisə|texniki|kateqoriya|seqment)/u.test(text)) return true
  if (/(?:\bmy\b|\bmine\b|\bdid\s+i\b|\bour\s+team\b|\bteam\s+[\p{L}\p{N}_-]+|\bdepartment\b|(?:^|[^\p{L}\p{N}])(?:мой|мои|моя|моих|мою)(?=$|[^\p{L}\p{N}])|(?:^|\s)я\s+(?:выполн|созда|реш|выигр)|команд\p{L}*|отдел\p{L}*|\bmenim\b|bizim\s+komanda|komanda\p{L}*)/u.test(text)) return true
  if (/(?:средн|медиан|процент|конверси|динамик|тренд|рост|сравн|разниц|average|mean|median|percentage|\brate\b|conversion|trend|growth|compare|versus|\bvs\.?\b|difference|orta|faiz|konversiya|trend|artım|müqayisə)/u.test(text)) return true
  if (!allowKpiVolume && /(?:выруч|доход|сумм|стоимост|revenue|amount|value|gəlir|məbləğ|dəyər)/u.test(text)) return true
  if (/(?:по\s+(?:дням|неделям|месяцам|источник|менеджер|команд|отдел)|\bby\s+(?:day|week|month|source|manager|team|department)\b|gunler\s+uzre|hefteler\s+uzre|aylar\s+uzre)/u.test(text)) return true
  if (/(?:high[-\s]+value|low[-\s]+value|крупн\p{L}*\s+сдел|дорог\p{L}*\s+сдел|yuksek\s+deyer)/u.test(text)) return true
  if (/(?:(?:свыше|более|менее|дороже|дешевле|\bover\b|\bunder\b|\babove\b|\bbelow\b|more\s+than|less\s+than)\s*(?:[$€₼₽£]|\d)|(?:[$€₼₽£]|\b(?:usd|azn|eur|rub|манат|доллар|евро)\b)\s*\d)/u.test(text)) return true
  return false
}

function expectedRankingMetric(text: string): string | null {
  if (/(?:задач|task|tapsir)/u.test(text)) return "completed_tasks"
  if (/(?:тикет|обращен|ticket|bilet)/u.test(text)) return "resolved_tickets"
  if (/(?:коммерческ\p{L}*\s+предлож|предлож\p{L}*|quote|proposal|teklif)/u.test(text)) return "created_quotes"
  if (/(?:лид|lead|lid)/u.test(text)) {
    if (/(?:связ|контакт|дозвон|ответ|reach|contact|answered|elaqe|cavab)/u.test(text)) {
      return "answered_leads_by_call"
    }
    return "created_leads"
  }
  if (/(?:сдел(?:к|ок)|продаж|deal|sale|sovdeles|satis)/u.test(text)) return "won_deals"
  return null
}

function hasUnsupportedRankingEvent(text: string): boolean {
  const created = /(?:созда|создан|завед|зарегистрир|\bcreat(?:e|ed|or|ion)\b|yarad)/u.test(text)
  const completed = /(?:выполн|заверш|\bcomplet(?:e|ed|ion)\b|\bfinish(?:ed)?\b|yerine\s+yetir|bitir|tamamla)/u.test(text)
  const resolved = /(?:реш[её]н|разреш[её]н|закрыл\p{L}*\s+(?:тикет|обращен)|\bresolved?\b|\bclosed?\s+(?:ticket|case)|hell|bagl)/u.test(text)
  const won = /(?:выигр|успешн|заключил|продал|\bwon\b|\bsold\b|qazan)/u.test(text)
  const currentState = /(?:открыт|активн|просроч|нереш[её]н|неразреш|\bopen\b|\bactive\b|\boverdue\b|\bunresolved\b|\bpending\b)/u.test(text)
  const quoteNonCreated = /(?:отправ|принят|отклон|ист[её]к|\bsent\b|\baccepted\b|\brejected\b|\bexpired\b|gonder|qebul|redd|muddet)/u.test(text)

  if (currentState) return true
  if (/(?:задач|task|tapsir)/u.test(text)) return created || !completed
  if (/(?:тикет|обращен|ticket|bilet)/u.test(text)) return created || !resolved
  if (/(?:сдел(?:к|ок)|продаж|deal|opportunit|sale|sovdeles|satis)/u.test(text)) return created || !won
  // `created_leads` is attributed to the lead's current assignee, not its
  // historical creator. Refuse wording that asks who actually created it.
  if (/(?:лид|lead|lid)/u.test(text) && created) return true
  if (/(?:предлож|quote|proposal|teklif)/u.test(text) && quoteNonCreated) return true
  return false
}

function expectedDirection(text: string): "top" | "bottom" | null {
  if (/(?:меньше|хуже|наименьш|миним|аутсайдер|сам\p{L}*\s+(?:мал|худш)|\bbottom\b|\bleast\b|\bfewest\b|\bfewer\b|\bworst\b|lowest|minimum|rank(?:s|ed)?\s+last|en\s+(?:az|pis))/u.test(text)) return "bottom"
  if (/(?:больше|лучше|эффективн|результативн|наибольш|максим|топ|лидер|сам\p{L}*\s+(?:больш|лучш|эффективн|результативн)|\btop\b|\bmost\b|\bmore\b|\bbest\b|effective|productive|highest|maximum|rank(?:s|ed)?\s+first|en\s+(?:cox|yaxsi|semere|mehsuldar)|daha\s+(?:semere|mehsuldar|effektiv|yaxsi))/u.test(text)) return "top"
  return null
}

function expectedKpiGroup(text: string): string | null {
  if (/(?:продаж|сдел(?:к|ок)|выигр|sales?|deals?|opportunit|won|satis|sovdeles|qazan)/u.test(text)) return "sales"
  if (/(?:\bmtm\b|мтм)/u.test(text)) return "mtm"
  if (/(?:тикет|обращен|support|ticket|bilet)/u.test(text)) return "tickets"
  if (/(?:проект|project|layihe)/u.test(text)) return "projects"
  if (/(?:задач|task|tapsir)/u.test(text)) return "tasks"
  return null
}

function expectedKpiPeriod(text: string): string | null {
  if (/(?:сегодня|за\s+день|today|daily|bu\s+gun)/u.test(text)) return "day"
  if (/(?:недел|week|hefte)/u.test(text)) return "week"
  if (/(?:месяц|month|\bay\b)/u.test(text)) return "month"
  if (/(?:квартал|quarter|rub)/u.test(text)) return "quarter"
  if (/(?:\bгод|year|\bil\b)/u.test(text)) return "year"
  if (/(?:все\s+время|all\s+time|butun\s+dovr)/u.test(text)) return "all"
  return null
}

function expectedKpiSortBy(text: string): "kpi" | "volume" | null {
  if (/(?:по\s+объ[её]му|объ[её]м\s+продаж|выруч|доход|сумм|by\s+volume|sales\s+volume|revenue|amount|hecme\s+gore|satis\s+hecmi|gelir|mebleg)/u.test(text)) return "volume"
  if (/(?:по\s+kpi|by\s+kpi|kpi\s+uzre)/u.test(text)) return "kpi"

  // "Who completed the most tasks" asks for the recorded event count, not
  // the Arena's normalized KPI score. Lock that natural wording to volume so
  // the model cannot silently return a different leader via sortBy=kpi.
  const activity = /(?:задач|task|tapsir|тикет|обращен|ticket|bilet|проект|project|layihe|сдел(?:к|ок)|продаж|deal|sale|sovdeles|satis)/u
  const quantity = /(?:больше|меньше|наибольш|наименьш|максим|миним|\bmost\b|\bleast\b|\bfewest\b|\bfewer\b|\bmore\b|highest|lowest|en\s+cox|en\s+az)/u
  const completed = /(?:выполн|заверш|реш[её]н|закры|выигр|completed?|resolved?|closed|won|yerine\s+yetir|tamamla|hell|qazan)/u
  if (activity.test(text) && quantity.test(text) && completed.test(text)) return "volume"
  // The Arena's primary score is the only safe default when the user does not
  // ask for a concrete event count.
  return "kpi"
}

function hasUnsupportedKpiEvent(text: string): boolean {
  const created = /(?:созда|создан|завед|зарегистрир|\bcreat(?:e|ed|ion)\b|yarad)/u.test(text)
  const sentOrAccepted = /(?:отправ|принят|\bsent\b|\baccepted\b|gonder|qebul)/u.test(text)
  if (/(?:задач|task|tapsir)/u.test(text) && created) return true
  if (/(?:тикет|обращен|ticket|bilet)/u.test(text) && created) return true
  if (/(?:предлож|quote|proposal|teklif)/u.test(text) && sentOrAccepted) return true
  // Sales Arena `volume` is won currency amount, not number of deals. A user
  // asking who won the most deals must use the event ranking tool instead.
  if (/(?:сдел(?:к|ок)|deals?|opportunit|sovdeles)/u.test(text)
    && /(?:больше|меньше|\bmost\b|\bfewest\b|en\s+(?:cox|az))/u.test(text)
    && !/(?:выруч|доход|сумм|объ[её]м\s+продаж|revenue|sales\s+volume|amount|mebleg|gelir)/u.test(text)) {
    return true
  }
  return false
}

function explicitRankingLimit(text: string): number | null {
  const match = /(?:\btop|\bbottom|топ|ilk|son)\s*(10|[1-9])\b/u.exec(text)
  return match ? Number(match[1]) : null
}

type NavMessages = { nav?: Record<string, unknown> }

function sectionAliasKey(value: string): string {
  return analyticsMatchText(value)
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function containsWholeAlias(text: string, alias: string): boolean {
  let index = text.indexOf(alias)
  while (index >= 0) {
    const before = index === 0 ? "" : text[index - 1]
    const afterIndex = index + alias.length
    const after = afterIndex >= text.length ? "" : text[afterIndex]
    if ((!before || !/[\p{L}\p{N}_]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after))) {
      return true
    }
    index = text.indexOf(alias, index + 1)
  }
  return false
}

const CANONICAL_SECTION_ALIASES = new Map<string, string>([
  ["kpi arena", "leaderboard"],
  ["kpi арена", "leaderboard"],
  ["kpi arenası", "leaderboard"],
  ["отчеты", "reports"],
  ["reports", "reports"],
  ["hesabatlar", "reports"],
  ["инвойсы", "invoices"],
  ["счета", "invoices"],
  ["invoices", "invoices"],
  ["fakturalar", "invoices"],
].map(([alias, key]) => [sectionAliasKey(alias), key]))

const SECTION_ALIAS_ENTRIES: Array<{ alias: string; key: string }> = (() => {
  const pathToKey = new Map(
    Object.entries(VOICE_SECTIONS).map(([key, href]) => [navItemPathname(href), key]),
  )
  const aliases = new Map<string, Set<string>>()
  const add = (aliasValue: unknown, key: string) => {
    if (typeof aliasValue !== "string") return
    const alias = sectionAliasKey(aliasValue)
    if (alias.length < 2) return
    const keys = aliases.get(alias) ?? new Set<string>()
    keys.add(key)
    aliases.set(alias, keys)
  }
  const translations = [ruMessages, enMessages, azMessages] as NavMessages[]
  for (const [key, href] of Object.entries(VOICE_SECTIONS)) {
    add(key.replaceAll("_", " "), key)
    add(navItemPathname(href).replace(/^\//, "").replaceAll("/", " "), key)
  }
  for (const item of navItems) {
    const key = pathToKey.get(navItemPathname(item.href))
    if (!key || !SECTION_GUIDE[key]) continue
    add(item.tKey, key)
    for (const messages of translations) add(messages.nav?.[item.tKey], key)
  }
  add("KPI Arena", "leaderboard")
  add("KPI-арена", "leaderboard")
  add("KPI Arenası", "leaderboard")
  return [...aliases.entries()]
    .filter(([, keys]) => keys.size === 1)
    .map(([alias, keys]) => ({ alias, key: [...keys][0] }))
    .sort((a, b) => b.alias.length - a.alias.length)
})()

function expectedSectionKey(text: string): string | null {
  const normalized = sectionAliasKey(text)
  const canonical = [...CANONICAL_SECTION_ALIASES.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => containsWholeAlias(normalized, alias))
  if (canonical) return canonical[1]
  return SECTION_ALIAS_ENTRIES.find(({ alias }) => containsWholeAlias(normalized, alias))?.key ?? null
}

function normalizedInputSection(value: unknown): string {
  const text = analyticsMatchText(String(value ?? "")).trim()
  return expectedSectionKey(text) ?? text.replace(/^\/+/, "").replace(/[\s/]+/g, "_")
}

function matchesExpectedPeriod(input: Record<string, unknown>, expected: ExpectedPeriod | null): boolean {
  // A forced numeric question without a server-parsed period is ambiguous.
  // Never let the model invent one and then present the result as verified.
  if (!expected) return false
  if (input.period !== expected.period) return false
  if (expected.period !== "custom") return true
  return input.dateFrom === expected.dateFrom && input.dateTo === expected.dateTo
}

/**
 * The model may choose wording, but it cannot redefine a forced CRM question.
 * Reject a tool call when an unambiguous entity, period, direction or section
 * in the user message disagrees with model-controlled arguments.
 */
export function chatAnalyticsInputMatchesRequest(
  message: string,
  tool: ChatAnalyticsToolName,
  input: Record<string, unknown>,
  currentDate: string,
): boolean {
  const text = analyticsMatchText(message)
  const unsupportedHistoricalPeriod = /(?:(?:прошл|предыдущ)\p{L}*\s+(?:недел\p{L}*|квартал\p{L}*|год\p{L}*)|(?:last|previous|past)\s+(?:week|quarter|year)|(?:kecen|evvelki)\s+(?:hefte\p{L}*|rub\p{L}*|il\p{L}*))/u.test(text)
  if (tool === "get_crm_period_report") {
    if (unsupportedHistoricalPeriod) return false
    if (hasUnsupportedAnalyticsFilter(text)) return false
    if (hasUnsupportedPeriodEvent(text)) return false
    if (/(?:открыт\p{L}*|активн\p{L}*|просроч\p{L}*|нереш[её]н\p{L}*|неразреш\p{L}*|open|active|overdue|unresolved|pending)/u.test(text)) {
      return false
    }
    // A generic "closed deal" is not proof of a win: the deal may have been
    // lost. No current period metric represents all terminal deals.
    if (/(?:закрыт\p{L}*\s+сдел|closed\s+(?:deal|opportunit))/u.test(text)
      && !/(?:выигр|успешн|won|qazan)/u.test(text)) {
      return false
    }
    const metric = expectedPeriodMetric(text)
    return (!metric || input.metric === metric)
      && matchesExpectedPeriod(input, explicitPeriodFromMessage(text, currentDate))
  }
  if (tool === "get_crm_ranking") {
    if (unsupportedHistoricalPeriod) return false
    if (hasUnsupportedAnalyticsFilter(text)) return false
    if (hasUnsupportedRankingEvent(text)) return false
    // "Opportunities" alone does not say whether the user means created,
    // currently owned, or won deals. This ranking tool only has a proven won
    // event, so refuse to silently substitute it without an explicit win cue.
    if (/(?:opportunit)/u.test(text) && !/(?:won|closed\s+won|qazan)/u.test(text)) {
      return false
    }
    const metric = expectedRankingMetric(text)
    const direction = expectedDirection(text)
    const limit = explicitRankingLimit(text)
    return Boolean(metric && direction)
      && input.metric === metric
      && input.direction === direction
      && (limit === null || input.limit === limit)
      && matchesExpectedPeriod(input, explicitPeriodFromMessage(text, currentDate))
  }
  if (tool === "get_kpi_arena") {
    // Arena presets describe its current day/week/month/quarter/year. A prior
    // calendar period or yesterday cannot be represented by this tool, so do
    // not relabel it as the current period.
    if (/(?:вчера|yesterday|dunen|(?:прошл|предыдущ)\p{L}*\s+(?:недел\p{L}*|месяц\p{L}*|квартал\p{L}*|год\p{L}*)|(?:last|previous|past)\s+(?:week|month|quarter|year)|(?:kecen|evvelki)\s+(?:hefte\p{L}*|ay|rub\p{L}*|il\p{L}*))/u.test(text)) {
      return false
    }
    if (hasUnsupportedAnalyticsFilter(text, true) || hasUnsupportedKpiEvent(text)) return false
    const direction = expectedDirection(text)
    const group = expectedKpiGroup(text)
    const period = expectedKpiPeriod(text)
    const sortBy = expectedKpiSortBy(text)
    const limit = explicitRankingLimit(text)
    if (group === "sales" && period !== "quarter") return false
    return Boolean(direction && group && period && sortBy)
      && input.direction === direction
      && input.group === group
      && input.period === period
      && input.sortBy === sortBy
      && (limit === null || input.limit === limit)
  }
  if (tool === "explain_crm_section") {
    const section = expectedSectionKey(text)
    return Boolean(section && normalizedInputSection(input.section) === section)
  }
  return true
}
