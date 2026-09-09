import { prisma } from "@/lib/prisma"
import { getFieldPermissions } from "@/lib/field-filter"
import { checkAiBudget } from "@/lib/ai/budget"
import { isManagerOrAbove } from "@/lib/constants"
import { buildAdvisorCapabilities, featuresToModuleMap, mergeAdvisorModuleMaps, normalizeOrgModules, type AdvisorOrgContext } from "./capabilities"
import { collectAdvisorSignalsWithHealth, normalizeAdvisorSignalMetric } from "./signals"
import type { AdvisorAnswer, AdvisorDomainKey, AdvisorFact, AdvisorOverview, AdvisorPayload, AdvisorQueryDateScope, AdvisorQueryIntent, AdvisorQueryRouting, AdvisorSeverity, AdvisorSignal, AdvisorSignalMetricKind, AdvisorSourceRef } from "./types"

const DEFAULT_ADVISOR_DAILY_REQUEST_LIMIT = 300

export interface AdvisorSignalFilters {
  entityType?: string | null
  entityId?: string | null
  domain?: AdvisorDomainKey | null
  severity?: AdvisorSeverity | null
}

export interface AdvisorAuditScope {
  userId?: string
  role?: string
  intent: AdvisorQueryIntent
  domains: AdvisorDomainKey[]
  routing?: AdvisorQueryRouting
  totalSignals: number
  filteredSignals: number
  returnedSignals: number
  sources: AdvisorSourceRef[]
}

export async function getAdvisorOrgContext(organizationId: string): Promise<AdvisorOrgContext> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, addons: true, modules: true, features: true },
  })
  return {
    plan: org?.plan || "starter",
    addons: org?.addons || [],
    modules: mergeAdvisorModuleMaps(featuresToModuleMap(org?.features), normalizeOrgModules(org?.modules)),
  }
}

export async function getAdvisorPayload(
  organizationId: string,
  role?: string,
  userId?: string,
  options: { syncAlerts?: boolean } = {},
): Promise<AdvisorPayload> {
  const org = await getAdvisorOrgContext(organizationId)
  const capabilities = buildAdvisorCapabilities(org, role)
  const [collection, pendingActions] = await Promise.all([
    collectAdvisorSignalsWithHealth(organizationId, capabilities),
    prisma.aiShadowAction.count({ where: { organizationId, approved: null } }).catch(() => 0),
  ])
  const signals = collection.signals
  const scopedSignals = role && userId ? scopeSignalsForUser(signals, role, userId) : signals
  const visibleSignals = role ? await redactSignalsForRole(organizationId, role, scopedSignals) : scopedSignals
  if (options.syncAlerts) {
    await syncAdvisorProactiveAlerts(organizationId, visibleSignals)
  }
  return {
    capabilities,
    collectorHealth: collection.health,
    overview: buildOverview(visibleSignals, pendingActions),
    signals: visibleSignals,
  }
}

export function buildOverview(signals: AdvisorSignal[], pendingActions: number): AdvisorOverview {
  return {
    totalSignals: signals.length,
    critical: signals.filter((signal) => signal.severity === "critical").length,
    high: signals.filter((signal) => signal.severity === "high").length,
    medium: signals.filter((signal) => signal.severity === "medium").length,
    low: signals.filter((signal) => signal.severity === "low").length,
    revenueAtRisk: signals.reduce((sum, signal) => sum + (signal.amount || 0), 0),
    pendingActions,
  }
}

export function filterAdvisorPayload(payload: AdvisorPayload, filters: AdvisorSignalFilters): AdvisorPayload {
  const signals = payload.signals.filter((signal) => {
    if (filters.entityType || filters.entityId) {
      const primaryMatches =
        (!filters.entityType || signal.entityType === filters.entityType) &&
        (!filters.entityId || signal.entityId === filters.entityId)
      const sourceMatches = signal.sources.some((source) =>
        (!filters.entityType || source.entityType === filters.entityType) &&
        (!filters.entityId || source.entityId === filters.entityId)
      )
      if (!primaryMatches && !sourceMatches) return false
    }
    if (filters.domain && signal.domain !== filters.domain) return false
    if (filters.severity && signal.severity !== filters.severity) return false
    return true
  })

  if (
    signals.length === payload.signals.length &&
    !filters.entityType &&
    !filters.entityId &&
    !filters.domain &&
    !filters.severity
  ) {
    return payload
  }

  return {
    ...payload,
    overview: buildOverview(signals, payload.overview.pendingActions),
    signals,
  }
}

export function scopeSignalsForUser(signals: AdvisorSignal[], role: string, userId: string): AdvisorSignal[] {
  if (isManagerOrAbove(role)) return signals
  return signals.filter((signal) => {
    if (signal.ownerId === userId) return true
    if (signal.entityType === "user" && signal.entityId === userId) return true
    return false
  })
}

export function inferAdvisorIntent(question: string): AdvisorQueryIntent {
  const q = question.toLowerCase()
  if (/(money|cash|revenue|invoice|payment|finance|budget|overdue|amount|сумм|деньг|оплат|счет|счёт|borc|pul|ödəniş|maliyy)/i.test(q)) return "money"
  if (/(route|visit|field|mtm|photo|logistics|delivery|shipment|warehouse|маршрут|визит|логист|достав|склад|sahə|marşrut|çatdır|anbar)/i.test(q)) return "routes"
  if (/(support|ticket|sla|complaint|тикет|жалоб|поддерж|şikayət|dəstək)/i.test(q)) return "support"
  if (/(manager|owner|kpi|plan|monthly|completion|performance|менеджер|руковод|план|месяц|kpi|эффектив|menecer|aylıq|plan|performans|tamamlan)/i.test(q)) return "kpi"
  if (/(task|overdue|aging|задач|просроч|tapşırıq|gecik)/i.test(q)) return "tasks"
  if (/(deal|lead|sales|pipeline|quote|offer|proposal|лид|сделк|продаж|кп|предлож|təklif|satış)/i.test(q)) return "sales"
  if (/(contract|renewal|approval|контракт|договор|согласован|müqavil|təsdiq)/i.test(q)) return "contracts"
  if (/(campaign|marketing|click|segment|кампан|маркет|klik|seqment)/i.test(q)) return "marketing"
  if (/(field|mtm|photo|фото|foto)/i.test(q)) return "field"
  return "overview"
}

const ADVISOR_INTENT_DOMAINS: Record<AdvisorQueryIntent, AdvisorDomainKey[]> = {
  overview: [],
  money: ["finance", "sales", "contracts"],
  routes: ["routes", "mtm"],
  support: ["support"],
  tasks: ["tasks", "kpi"],
  sales: ["sales", "crm"],
  contracts: ["contracts"],
  marketing: ["marketing"],
  field: ["routes", "mtm"],
  kpi: ["kpi", "tasks"],
}

function inferQuestionSeverities(question: string): AdvisorSeverity[] {
  const q = searchableText([question])
  const severities: AdvisorSeverity[] = []
  if (/(critical|критич|kritik)/i.test(q)) severities.push("critical")
  if (/(high|высок|yuksək|yuksek)/i.test(q)) severities.push("high")
  if (/(medium|средн|orta)/i.test(q)) severities.push("medium")
  if (/(low|низк|aşağı|asagi)/i.test(q)) severities.push("low")
  return severities
}

function inferQuestionMetricKinds(question: string): AdvisorSignalMetricKind[] {
  const q = searchableText([question])
  const kinds = new Set<AdvisorSignalMetricKind>()
  if (/(money|cash|revenue|invoice|payment|amount|budget|деньг|сумм|оплат|счет|счёт|pul|maliyy|ödəniş)/i.test(q)) kinds.add("money")
  if (/(day|days|overdue|просроч|дн|gecik|gun|gün)/i.test(q)) kinds.add("days")
  if (/(minute|minutes|sla|delay|late|минут|задерж|gec|dəqiq)/i.test(q)) kinds.add("minutes")
  if (/(percent|percentage|completion|compliance|процент|выполн|uyğunluq|faiz)/i.test(q)) kinds.add("percent")
  if (/(count|how many|сколько|колич|say|neçə|nece)/i.test(q)) kinds.add("count")
  if (/(score|kpi|балл|рейтинг|skor)/i.test(q)) kinds.add("score")
  return Array.from(kinds)
}

function inferQuestionDateScope(question: string): AdvisorQueryDateScope {
  const q = searchableText([question])
  if (/(today|сегодня|bugun|bugün)/i.test(q)) return "today"
  if (/(week|7 days|seven days|недел|7 дней|həftə|hefte)/i.test(q)) return "week"
  if (/(month|monthly|30 days|месяц|месяч|ayliq|aylıq)/i.test(q)) return "month"
  return "all"
}

function inferQuestionOwner(question: string, signals: AdvisorSignal[]): AdvisorQueryRouting["owner"] {
  const q = searchableText([question])
  if (/(unassigned|no owner|without owner|без владельца|без ответственного|sahibsiz)/i.test(q)) {
    return { key: "unassigned", label: "Unassigned" }
  }
  for (const signal of signals) {
    const candidates = [signal.ownerLabel, signal.ownerId].filter(Boolean) as string[]
    for (const candidate of candidates) {
      const normalized = searchableText([candidate])
      if (normalized.length >= 3 && q.includes(normalized)) {
        return { key: signal.ownerId || signal.ownerLabel || candidate, label: signal.ownerLabel || candidate }
      }
    }
  }
  return undefined
}

export function inferAdvisorQueryRouting(question: string, signals: AdvisorSignal[] = []): AdvisorQueryRouting {
  const intent = inferAdvisorIntent(question)
  return {
    intent,
    domains: ADVISOR_INTENT_DOMAINS[intent],
    severities: inferQuestionSeverities(question),
    metricKinds: inferQuestionMetricKinds(question),
    owner: inferQuestionOwner(question, signals),
    dateScope: inferQuestionDateScope(question),
    terms: questionTerms(question),
  }
}

export async function checkAdvisorQueryGovernance(organizationId: string): Promise<{
  allowed: boolean
  reason?: string
  limit?: number
  used?: number
}> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [budget, org, used] = await Promise.all([
    checkAiBudget(organizationId),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    }),
    prisma.aiInteractionLog.count({
      where: {
        organizationId,
        agentType: "advisor",
        createdAt: { gte: todayStart },
      },
    }),
  ])

  if (!budget.allowed) {
    return {
      allowed: false,
      reason: `Daily AI budget exceeded: $${budget.spent}/$${budget.limit}`,
      limit: budget.limit,
      used: budget.spent,
    }
  }

  const settings = (org?.settings as Record<string, unknown>) || {}
  const limit = typeof settings.aiAdvisorDailyRequestLimit === "number"
    ? settings.aiAdvisorDailyRequestLimit
    : DEFAULT_ADVISOR_DAILY_REQUEST_LIMIT

  if (used >= limit) {
    return {
      allowed: false,
      reason: `Daily Advisor request limit exceeded: ${used}/${limit}`,
      limit,
      used,
    }
  }

  return { allowed: true, limit, used }
}

export async function answerAdvisorQuestion(input: {
  organizationId: string
  userId: string
  role: string
  question: string
  locale?: string
}): Promise<AdvisorAnswer> {
  const payload = await getAdvisorPayload(input.organizationId, input.role, input.userId)
  const routing = inferAdvisorQueryRouting(input.question, payload.signals)
  const intent = routing.intent
  const routedSignals = filterSignalsForQueryRouting(payload.signals, routing)
  const signals = rankSignalsForQuestion(input.question, routedSignals)
  const topSignals = signals.slice(0, 10)
  const facts = summarizeFacts(topSignals, payload.overview, input.locale)
  const sources = uniqueSources(topSignals.flatMap((signal) => signal.sources)).slice(0, 12)
  const recommendations = topSignals.flatMap((signal) => signal.recommendedActions).slice(0, 10)
  const domains = routing.domains.length > 0 ? routing.domains : Array.from(new Set(topSignals.map((signal) => signal.domain)))
  const generatedAt = new Date().toISOString()

  const answer = buildAnswerText(topSignals, input.locale)

  await logAdvisorInteraction({
    organizationId: input.organizationId,
    userMessage: input.question,
    aiResponse: answer,
    toolsCalled: buildAdvisorAuditTools({
      userId: input.userId,
      role: input.role,
      intent,
      domains,
      routing,
      totalSignals: payload.signals.length,
      filteredSignals: signals.length,
      returnedSignals: topSignals.length,
      sources,
    }),
  })

  return {
    intent,
    answer,
    facts,
    sources,
    recommendations,
    signals: topSignals,
    scope: {
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      domains,
      totalSignals: payload.signals.length,
      filteredSignals: signals.length,
      returnedSignals: topSignals.length,
      routing,
      generatedAt,
    },
  }
}

export async function redactSignalsForRole(organizationId: string, role: string, signals: AdvisorSignal[]): Promise<AdvisorSignal[]> {
  const permissionCache = new Map<string, Record<string, string>>()
  const getPerms = async (entityType: string) => {
    const mapped = fieldPermissionEntity(entityType)
    if (!mapped) return {}
    const cached = permissionCache.get(mapped)
    if (cached) return cached
    const perms = await getFieldPermissions(organizationId, role, mapped)
    permissionCache.set(mapped, perms)
    return perms
  }

  const out: AdvisorSignal[] = []
  for (const signal of signals) {
    const perms = await getPerms(signal.entityType)
    const hidden = hiddenFieldsForSignal(signal, perms)
    if (hidden.size === 0) {
      out.push(signal)
      continue
    }
    const hideAmount = shouldHideAmount(signal, hidden)
    out.push(normalizeAdvisorSignalMetric({
      ...signal,
      metric: null,
      amount: hideAmount ? null : signal.amount,
      summary: hideAmount ? redactSensitiveText(signal.summary) : signal.summary,
      facts: signal.facts.filter((item) => !hidden.has(factFieldName(item.label))),
      recommendedActions: hideAmount
        ? signal.recommendedActions.map((action) => ({
          ...action,
          payload: redactActionPayload(action.payload),
        }))
        : signal.recommendedActions,
    }))
  }
  return out
}

export async function syncAdvisorProactiveAlerts(organizationId: string, signals: AdvisorSignal[]): Promise<void> {
  const alertSignals = signals.filter((signal) => signal.severity === "critical" || signal.severity === "high").slice(0, 20)
  await Promise.all(alertSignals.map(async (signal) => {
    const existing = await prisma.proactiveAlert.findFirst({
      where: {
        organizationId,
        triggerType: "custom",
        entityType: signal.entityType,
        entityId: signal.entityId,
        dismissedAt: null,
      },
      select: { id: true },
    }).catch(() => null)
    if (existing) return
    await prisma.proactiveAlert.create({
      data: {
        organizationId,
        triggerType: "custom",
        severity: signal.severity === "critical" ? "critical" : "warning",
        entityType: signal.entityType,
        entityId: signal.entityId,
        message: signal.title,
        context: {
          advisor: true,
          advisorSignalId: signal.id,
          domain: signal.domain,
          summary: signal.summary,
          facts: signal.facts,
          sources: signal.sources,
          detectedAt: signal.detectedAt,
        },
      },
    }).catch(() => null)
  }))
}

async function logAdvisorInteraction(input: {
  organizationId: string
  userMessage: string
  aiResponse: string
  toolsCalled: string[]
}) {
  await prisma.aiInteractionLog.create({
    data: {
      organizationId: input.organizationId,
      userMessage: redactAdvisorAuditText(input.userMessage).slice(0, 500),
      aiResponse: redactAdvisorAuditText(input.aiResponse).slice(0, 1000),
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "deterministic-advisor-v1",
      toolsCalled: input.toolsCalled,
      agentType: "advisor",
      isCopilot: true,
    },
  }).catch(() => null)
}

export function redactAdvisorAuditText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g, "[redacted-phone]")
}

export function buildAdvisorAuditTools(scope: AdvisorAuditScope): string[] {
  const domains = scope.domains.length > 0 ? scope.domains.join(",") : "none"
  const sourceRefs = uniqueSources(scope.sources)
    .slice(0, 8)
    .map((source) => `source:${source.entityType}:${source.entityId}`)

  return [
    "advisor_signals",
    `user:${scope.userId || "unknown"}`,
    `role:${scope.role || "unknown"}`,
    `intent:${scope.intent}`,
    `domains:${domains}`,
    `signals:${scope.returnedSignals}/${scope.filteredSignals}/${scope.totalSignals}`,
    ...(scope.routing ? [
      `route:date:${scope.routing.dateScope}`,
      ...(scope.routing.severities.length > 0 ? [`route:severity:${scope.routing.severities.join(",")}`] : []),
      ...(scope.routing.metricKinds.length > 0 ? [`route:metric:${scope.routing.metricKinds.join(",")}`] : []),
      ...(scope.routing.owner ? [`route:owner:${scope.routing.owner.key}`] : []),
    ] : []),
    ...sourceRefs,
  ]
}

function filterSignalsForIntent(signals: AdvisorSignal[], intent: AdvisorQueryIntent): AdvisorSignal[] {
  if (intent === "overview") return signals
  return signals.filter((signal) => ADVISOR_INTENT_DOMAINS[intent].includes(signal.domain))
}

function matchesRoutingDateScope(signal: AdvisorSignal, dateScope: AdvisorQueryDateScope, now = Date.now()) {
  if (dateScope === "all") return true
  const detectedAt = Date.parse(signal.freshness?.detectedAt || signal.detectedAt)
  if (!Number.isFinite(detectedAt)) return false
  if (dateScope === "today") return new Date(detectedAt).toDateString() === new Date(now).toDateString()
  const days = dateScope === "week" ? 7 : 30
  return detectedAt >= now - days * 24 * 60 * 60 * 1000
}

function matchesRoutingOwner(signal: AdvisorSignal, owner: AdvisorQueryRouting["owner"]) {
  if (!owner) return true
  if (owner.key === "unassigned") return !signal.ownerId && !signal.ownerLabel
  return signal.ownerId === owner.key || signal.ownerLabel === owner.key || signal.ownerLabel === owner.label
}

function matchesRoutingMetric(signal: AdvisorSignal, metricKinds: AdvisorSignalMetricKind[]) {
  if (metricKinds.length === 0) return true
  if (metricKinds.includes("money") && (signal.amount || 0) > 0) return true
  if (metricKinds.includes("money") && ["finance", "sales", "contracts"].includes(signal.domain)) return true
  if (metricKinds.includes("minutes") && signal.domain === "support") {
    const text = searchableText([
      signal.title,
      signal.summary,
      signal.entityType,
      ...signal.facts.map((fact) => `${fact.label} ${fact.value}`),
    ])
    if (/(sla|ticket|response|escalation)/i.test(text)) return true
  }
  if (metricKinds.includes("count") && ["support", "kpi", "tasks"].includes(signal.domain)) return true
  if (metricKinds.includes("score") && signal.domain === "kpi") return true
  return Boolean(signal.metric?.kind && metricKinds.includes(signal.metric.kind))
}

export function filterSignalsForQueryRouting(signals: AdvisorSignal[], routing: AdvisorQueryRouting): AdvisorSignal[] {
  return filterSignalsForIntent(signals, routing.intent).filter((signal) => {
    if (routing.severities.length > 0 && !routing.severities.includes(signal.severity)) return false
    if (!matchesRoutingOwner(signal, routing.owner)) return false
    if (!matchesRoutingDateScope(signal, routing.dateScope)) return false
    if (!matchesRoutingMetric(signal, routing.metricKinds)) return false
    return true
  })
}

function rankSignalsForQuestion(question: string, signals: AdvisorSignal[]): AdvisorSignal[] {
  const terms = questionTerms(question)
  if (terms.length === 0) return signals
  return signals
    .map((signal, index) => ({ signal, index, score: signalQuestionScore(signal, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.signal)
}

function questionTerms(question: string): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "are", "which", "what", "where", "who", "why", "how", "about", "today",
    "какие", "какой", "что", "где", "кто", "как", "почему", "про", "для", "или", "это",
    "hansi", "hansı", "ne", "nə", "harada", "kim", "nece", "necə", "ucun", "üçün", "bugun", "bugün",
  ])
  const seen = new Set<string>()
  const terms = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9а-яёəğıöşüç]+/iu)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stopWords.has(term))

  return terms.filter((term) => {
    if (seen.has(term)) return false
    seen.add(term)
    return true
  }).slice(0, 12)
}

function signalQuestionScore(signal: AdvisorSignal, terms: string[]): number {
  const title = searchableText([signal.title])
  const summary = searchableText([signal.summary])
  const facts = searchableText(signal.facts.map((fact) => `${fact.label} ${fact.value}`))
  const sources = searchableText(signal.sources.map((source) => `${source.label} ${source.entityType}`))
  const domain = searchableText([signal.domain, signal.domainLabel, signal.entityType])

  return terms.reduce((score, term) => {
    let next = score
    if (title.includes(term)) next += 5
    if (summary.includes(term)) next += 3
    if (facts.includes(term)) next += 2
    if (sources.includes(term)) next += 2
    if (domain.includes(term)) next += 1
    return next
  }, 0)
}

function searchableText(values: Array<string | null | undefined>): string {
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

function advisorText(locale: string | undefined, key: "matchedRisks" | "critical" | "high" | "moneyAtRisk" | "intent" | "totalOpenRisks" | "matched" | "topPriorities") {
  if (locale === "az") {
    return {
      matchedRisks: "Tapılan risklər",
      critical: "Kritik",
      high: "Yüksək",
      moneyAtRisk: "Risk altında məbləğ",
      intent: "Niyyət",
      totalOpenRisks: "Ümumi açıq risklər",
      matched: "Tapıldı",
      topPriorities: "Əsas prioritetlər",
    }[key]
  }
  if (locale === "en") {
    return {
      matchedRisks: "Matched risks",
      critical: "Critical",
      high: "High",
      moneyAtRisk: "Money at risk",
      intent: "Intent",
      totalOpenRisks: "Total open risks",
      matched: "Matched",
      topPriorities: "Top priorities",
    }[key]
  }
  return {
    matchedRisks: "Найденные риски",
    critical: "Критичные",
    high: "Высокие",
    moneyAtRisk: "Деньги под риском",
    intent: "Интент",
    totalOpenRisks: "Всего открытых рисков",
    matched: "Найдено",
    topPriorities: "Главные приоритеты",
  }[key]
}

function localizeAdvisorSignalTitle(signal: AdvisorSignal, locale?: string): string {
  const title = signal.title
  const overdue = title.match(/^(.+?) has (\d+) overdue tasks?$/i)
  if (overdue) {
    if (locale === "az") return `${overdue[1]} üzrə ${overdue[2]} gecikmiş tapşırıq var`
    if (locale === "en") return title
    return `У ${overdue[1]} ${overdue[2]} просроченных задач`
  }
  const responseGaps = title.match(/^(.+?) has (\d+) response gaps$/i)
  if (responseGaps) {
    if (locale === "az") return `${responseGaps[1]} üzrə ${responseGaps[2]} cavab gecikməsi var`
    if (locale === "en") return title
    return `У ${responseGaps[1]} ${responseGaps[2]} задержки ответа`
  }
  const repeatedOpenTickets = title.match(/^(.+?) has repeated open tickets$/i)
  if (repeatedOpenTickets) {
    if (locale === "az") return `${repeatedOpenTickets[1]} üzrə təkrarlanan açıq tikətlər var`
    if (locale === "en") return title
    return `У ${repeatedOpenTickets[1]} повторные открытые тикеты`
  }
  const behindPlan = title.match(/^(.+?) is behind this month's action plan$/i)
  if (behindPlan) {
    if (locale === "az") return `${behindPlan[1]} bu ayın əməliyyat planından geri qalır`
    if (locale === "en") return title
    return `${behindPlan[1]} отстает от плана действий за месяц`
  }
  const overdueItem = title.match(/^(.+?) is overdue$/i)
  if (overdueItem) {
    if (locale === "az") return `${overdueItem[1]} gecikir`
    if (locale === "en") return title
    return `${overdueItem[1]} просрочено`
  }
  const stalledDeal = title.match(/^(.+?) is stalled(?: in (.+))?$/i)
  if (stalledDeal) {
    if (locale === "az") return stalledDeal[2] ? `${stalledDeal[1]} "${stalledDeal[2]}" mərhələsində dayanıb` : `${stalledDeal[1]} dayanıb`
    if (locale === "en") return title
    return stalledDeal[2] ? `${stalledDeal[1]} завис на этапе "${stalledDeal[2]}"` : `${stalledDeal[1]} завис`
  }
  const noClicks = title.match(/^(.+?) has delivery without clicks$/i)
  if (noClicks) {
    if (locale === "az") return `${noClicks[1]} göndərilib, klik yoxdur`
    if (locale === "en") return title
    return `${noClicks[1]} отправлена, но кликов нет`
  }
  const slaRisk = title.match(/^(.+?) is at SLA risk$/i)
  if (slaRisk) {
    if (locale === "az") return `${slaRisk[1]} SLA riski altındadır`
    if (locale === "en") return title
    return `${slaRisk[1]} под SLA-риском`
  }
  const escalated = title.match(/^(.+?) is escalated and unresolved$/i)
  if (escalated) {
    if (locale === "az") return `${escalated[1]} eskalasiya olunub və həll edilməyib`
    if (locale === "en") return title
    return `${escalated[1]} эскалирован и не решен`
  }
  const blocked = title.match(/^(.+?) is blocked$/i)
  if (blocked) {
    if (locale === "az") return `${blocked[1]} bloklanıb`
    if (locale === "en") return title
    return `${blocked[1]} заблокировано`
  }
  const dueSoon = title.match(/^(.+?) is due soon$/i)
  if (dueSoon) {
    if (locale === "az") return `${dueSoon[1]} üzrə müddət yaxınlaşır`
    if (locale === "en") return title
    return `${dueSoon[1]} скоро к сроку`
  }
  const aging = title.match(/^(.+?) is aging$/i)
  if (aging) {
    if (locale === "az") return `${aging[1]} uzun müddətdir açıqdır`
    if (locale === "en") return title
    return `${aging[1]} давно открыто`
  }
  return title
}

function summarizeFacts(signals: AdvisorSignal[], overview: AdvisorOverview, locale?: string): AdvisorFact[] {
  const critical = signals.filter((signal) => signal.severity === "critical").length
  const high = signals.filter((signal) => signal.severity === "high").length
  const revenue = signals.reduce((sum, signal) => sum + (signal.amount || 0), 0)
  return [
    { label: advisorText(locale, "matchedRisks"), value: String(signals.length) },
    { label: advisorText(locale, "critical"), value: String(critical) },
    { label: advisorText(locale, "high"), value: String(high) },
    { label: advisorText(locale, "moneyAtRisk"), value: `${Math.round(revenue || overview.revenueAtRisk).toLocaleString()} AZN` },
  ]
}

function uniqueSources(sources: AdvisorSourceRef[]): AdvisorSourceRef[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.entityType}:${source.entityId}:${source.href}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildAnswerText(signals: AdvisorSignal[], locale?: string): string {
  if (signals.length === 0) {
    return locale === "az"
      ? "Bu sual üzrə uyğun aktiv risk tapılmadı. Cari filtr və aktiv modullar üzrə siqnal yoxdur."
      : locale === "en"
        ? "No active risks matched this question. There are no matching signals in the current filters and active modules."
        : "По этому вопросу активных рисков не найдено. В текущем фильтре и активных модулях подходящих сигналов нет."
  }
  const top = signals.slice(0, 3).map((signal, index) => `${index + 1}. ${localizeAdvisorSignalTitle(signal, locale)}`).join("\n")
  if (locale === "az") return `${signals.length} risk tapıldı.\nƏvvəl bunlara baxın:\n${top}`
  if (locale === "en") return `Found ${signals.length} matching risk${signals.length === 1 ? "" : "s"}.\nReview first:\n${top}`
  return `Найдено рисков: ${signals.length}.\nСначала проверьте:\n${top}`
}

function fieldPermissionEntity(entityType: string): string | null {
  if (entityType === "contact") return "contact"
  if (entityType === "deal") return "deal"
  if (entityType === "lead") return "lead"
  if (entityType === "ticket") return "ticket"
  if (entityType === "task") return "task"
  if (entityType === "company") return "company"
  if (entityType === "contract") return "contract"
  if (entityType === "invoice") return "invoice"
  if (entityType === "bill") return "bill"
  if (entityType === "payment_order") return "payment_order"
  if (entityType === "offer") return "offer"
  if (entityType === "quote") return "quote"
  if (entityType === "campaign") return "campaign"
  if (entityType === "mtm_route") return "mtm_route"
  if (entityType === "mtm_visit") return "mtm_visit"
  if (entityType === "mtm_photo") return "mtm_photo"
  return null
}

function hiddenFieldsForSignal(signal: AdvisorSignal, permissions: Record<string, string>): Set<string> {
  const hidden = new Set<string>()
  for (const [field, access] of Object.entries(permissions)) {
    if (access === "hidden") hidden.add(field)
  }
  if (signal.entityType === "deal" && permissions.valueAmount === "hidden") hidden.add("amount")
  if (signal.entityType === "lead" && permissions.estimatedValue === "hidden") hidden.add("amount")
  if (signal.entityType === "contract" && permissions.valueAmount === "hidden") hidden.add("amount")
  if ((signal.entityType === "invoice" || signal.entityType === "bill") && permissions.balanceDue === "hidden") hidden.add("amount")
  if ((signal.entityType === "invoice" || signal.entityType === "bill") && permissions.totalAmount === "hidden") hidden.add("amount")
  if (signal.entityType === "payment_order" && permissions.amount === "hidden") hidden.add("amount")
  if ((signal.entityType === "offer" || signal.entityType === "quote") && permissions.totalAmount === "hidden") hidden.add("amount")
  return hidden
}

function factFieldName(label: string): string {
  const normalized = label.toLowerCase()
  if (normalized.includes("email")) return "email"
  if (normalized.includes("value")) return "valueAmount"
  if (normalized.includes("estimated")) return "estimatedValue"
  if (normalized.includes("balance")) return "balanceDue"
  if (normalized.includes("agent")) return "agentId"
  if (normalized.includes("customer") || normalized.includes("missed stop")) return "customerId"
  if (normalized.includes("visited") || normalized.includes("completion")) return "visitedPoints"
  if (normalized.includes("open minutes")) return "duration"
  if (normalized.includes("total")) return "totalAmount"
  if (normalized.includes("amount")) return "amount"
  if (normalized.includes("probability")) return "probability"
  return normalized.replace(/[^a-z0-9]/g, "")
}

function shouldHideAmount(signal: AdvisorSignal, hidden: Set<string>): boolean {
  return hidden.has("amount") ||
    (signal.entityType === "deal" && hidden.has("valueAmount")) ||
    (signal.entityType === "lead" && hidden.has("estimatedValue")) ||
    (signal.entityType === "contract" && hidden.has("valueAmount")) ||
    ((signal.entityType === "invoice" || signal.entityType === "bill") && (hidden.has("balanceDue") || hidden.has("totalAmount"))) ||
    (signal.entityType === "payment_order" && hidden.has("amount")) ||
    ((signal.entityType === "offer" || signal.entityType === "quote") && (hidden.has("totalAmount") || hidden.has("amount")))
}

function redactActionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactPayloadValue(payload) as Record<string, unknown>
}

function redactPayloadValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(redactPayloadValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactPayloadValue(item)])
    )
  }
  return value
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b\d[\d,.\s]*(?:AZN|USD|EUR|GBP|₼|\$|€|£)\b/gi, "[hidden amount]")
    .replace(/(?:AZN|USD|EUR|GBP|₼|\$|€|£)\s*\d[\d,.\s]*/gi, "[hidden amount]")
}
