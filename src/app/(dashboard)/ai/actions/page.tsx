"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { HelpButton } from "@/components/help/help-button"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import {
  AdvisorActionExecutionTrail,
  AdvisorActionHistoryPanel,
  AdvisorActionList,
  AdvisorActionTrailPanel,
  AdvisorAnswerSummaryCard,
  AdvisorAskPanel,
  AdvisorGuidedFlow,
  AdvisorKpiStrip,
  AdvisorModuleCoverage,
  AdvisorScenarioLauncher,
  AdvisorSignalDetail,
  AdvisorSignalRail,
  DailyBriefingStrip,
  LoadingPanel,
  actionTitle,
  parseDraftPayload,
  updateDraftPayloadField,
  type AdvisorScenarioItem,
  type ShadowAction,
} from "@/components/ai/advisor-center-widgets"
import type { AdvisorBriefingItem } from "@/lib/ai/advisor/briefing"
import type { AdvisorAction, AdvisorAnswer, AdvisorDomainKey, AdvisorPayload, AdvisorQueryDateScope, AdvisorQueryIntent, AdvisorSignal, AdvisorSignalMetricKind } from "@/lib/ai/advisor/types"

type AdvisorAskFilter = "all" | "money" | "routes" | "support" | "kpi" | "sales" | "tasks" | "contracts" | "marketing"
type AdvisorTab = "today" | "detail" | "ask" | "modules" | "queue" | "history"
type AdvisorDateScope = "active" | "today" | "week"
type AdvisorCommandFilter = "all" | "money" | "routes" | "sla" | "overdue" | "unassigned" | "critical"
type AdvisorScenarioKey = "money" | "sales" | "tasks" | "support" | "contracts" | "routes" | "kpi" | "marketing"
const ADVISOR_TABS: AdvisorTab[] = ["today", "detail", "ask", "modules", "queue", "history"]
const ADVISOR_DOMAINS: AdvisorDomainKey[] = ["crm", "sales", "contracts", "marketing", "tasks", "finance", "support", "routes", "mtm", "kpi"]
const ADVISOR_DATE_SCOPES: AdvisorDateScope[] = ["active", "today", "week"]

function parseAdvisorTab(value: string | null): AdvisorTab {
  return value && ADVISOR_TABS.includes(value as AdvisorTab) ? value as AdvisorTab : "today"
}

function parseAdvisorDomain(value: string | null): "all" | AdvisorDomainKey {
  return value && ADVISOR_DOMAINS.includes(value as AdvisorDomainKey) ? value as AdvisorDomainKey : "all"
}

function parseAdvisorDateScope(value: string | null): AdvisorDateScope {
  return value && ADVISOR_DATE_SCOPES.includes(value as AdvisorDateScope) ? value as AdvisorDateScope : "active"
}

function isAdvisorDataStale(lastRefreshedAt: string | null, nowMs: number) {
  if (!lastRefreshedAt) return false
  const refreshedAt = new Date(lastRefreshedAt).getTime()
  if (!Number.isFinite(refreshedAt)) return false
  return nowMs - refreshedAt > 10 * 60 * 1000
}

function matchesAdvisorDateScope(signal: AdvisorSignal, scope: AdvisorDateScope, nowMs: number) {
  if (scope === "active") return true
  const detectedAt = new Date(signal.detectedAt).getTime()
  if (!Number.isFinite(detectedAt)) return true
  if (scope === "week") return nowMs - detectedAt <= 7 * 24 * 60 * 60 * 1000
  const now = new Date(nowMs)
  const detected = new Date(detectedAt)
  return now.getFullYear() === detected.getFullYear() &&
    now.getMonth() === detected.getMonth() &&
    now.getDate() === detected.getDate()
}

const COPY = {
  en: {
    title: "AI Advisor",
    subtitle: "CRM-backed operating signals for daily decisions, evidence and safe next steps.",
    today: "Today",
    detail: "Detail",
    lastUpdated: "Updated",
    neverUpdated: "Not loaded yet",
    staleData: "Stale data",
    modules: "Modules",
    ask: "Ask",
    queue: "Approval Queue",
    history: "History",
    refresh: "Refresh",
    dateScope: "Scope",
    scopeActive: "Active",
    scopeToday: "Today",
    scopeWeek: "7 days",
    totalRisks: "Open risks",
    critical: "Critical",
    revenueAtRisk: "Money at risk",
    pendingActions: "Pending actions",
    activeCoverage: "Active modules",
    failedExecutions: "Failed executions",
    actionTrail: "Action trail",
    executionTrail: "Execution trail",
    executionTrailDesc: "Approved actions refresh here until the executor marks them executed or failed.",
    recentDecisions: "Recent decisions",
    historyFilters: "Status filters",
    historyShowing: "Showing {shown} of {total}",
    allStatuses: "All statuses",
    allDates: "All dates",
    approvedStatus: "Approved",
    todayDate: "Today",
    weekDate: "7 days",
    monthDate: "30 days",
    allModules: "All modules",
    allOwners: "All owners",
    needsAttention: "Needs attention",
    riskDetail: "Risk detail",
    selectRisk: "Select a risk to see evidence, sources and recommended actions.",
    selectRiskTitle: "Choose a risk from the list",
    selectRiskReason: "Why it matters",
    selectRiskEvidence: "Evidence and sources",
    selectRiskAction: "Recommended next step",
    selectRiskApproval: "Approval before execution",
    why: "Why this matters",
    sources: "Sources",
    actions: "Recommended actions",
    queueAction: "Queue action",
    queued: "Action queued for approval",
    actionFailed: "Action failed",
    queueFailed: "Could not queue action",
    askFailed: "Advisor question failed",
    editFailed: "Could not save changes",
    active: "Active",
    locked: "Locked",
    noAccess: "No access",
    moduleCoverage: "Advisor coverage by module",
    moduleCoverageDesc: "The Advisor opens as one AI center and shows which business domains are active or blocked for this tenant.",
    quickQuestions: "Quick questions",
    askDesc: "Use these prompts to narrow today's risks. Answers stay grounded in the detected signals on this page.",
    askPlaceholder: "Ask about today's risks",
    askButton: "Ask Advisor",
    launcherTitle: "What should we review?",
    launcherDesc: "Choose a live business scenario. Advisor filters the risks, opens the most relevant signal and prepares the grounded answer.",
    launcherEmpty: "No Advisor scenarios are available for the current scope.",
    manualAsk: "Write a custom question",
    manualAskHint: "Use this when you need a precise owner, period or risk that is not covered by the ready scenarios.",
    scenarioSales: "Sales risks",
    scenarioSalesDesc: "Stalled deals, idle quotes and cold CRM records.",
    scenarioMoney: "Money risk",
    scenarioMoneyDesc: "Invoices, payments, contracts and revenue at risk.",
    scenarioTasks: "Overdue work",
    scenarioTasksDesc: "Tasks that are late, aging or blocking execution.",
    scenarioSupport: "SLA / tickets",
    scenarioSupportDesc: "Support risks, SLA warnings and repeated complaints.",
    scenarioContracts: "Contracts",
    scenarioContractsDesc: "Approvals, signatures and contract blockers.",
    scenarioRoutes: "Routes / field",
    scenarioRoutesDesc: "Route, visit and check-in issues.",
    scenarioKpi: "Manager plan",
    scenarioKpiDesc: "Owners and managers behind monthly activity targets.",
    scenarioMarketing: "Marketing",
    scenarioMarketingDesc: "Campaigns or channels that need review.",
    answer: "Answer",
    groundedAnswer: "Advisor answer",
    primaryRisk: "Primary risk to review",
    whatToDoNext: "What to do next",
    openThisRisk: "Open this risk",
    activeAnswer: "Active Advisor answer",
    activeAnswerDesc: "The last answer stays attached to the current risk list, so the next action is visible without switching tabs.",
    backToAnswer: "Back to answer",
    queuePrimaryAction: "Queue primary action",
    queryScope: "Query scope",
    citations: "Citations",
    matched: "Matched signals",
    allRisks: "All risks",
    moneyRisk: "Where is money at risk?",
    salesRisk: "Which sales items are stalled?",
    taskRisk: "Which tasks are overdue?",
    contractRisk: "Which contracts need attention?",
    marketingRisk: "Which campaigns are underperforming?",
    routeRisk: "Which routes need attention?",
    supportRisk: "Which SLA risks are open?",
    managerRisk: "Which managers are behind plan?",
    emptyToday: "No active advisor signals for the enabled modules.",
    emptyFilteredTitle: "Filters hide all current risks.",
    emptyFilteredReason: "Clear search, module or owner filters to return to the full Advisor list.",
    emptyCoverageHint: "Coverage status",
    emptyReasonQuiet: "Enabled modules are connected, but no active risks match the current filters.",
    emptyReasonNoModules: "No Advisor modules are active for this tenant. Enable CRM, sales, contracts, marketing, tasks, finance, ticketing, routes, MTM or analytics modules to start receiving signals.",
    emptyReasonNoAccess: "Your current role cannot access the enabled Advisor modules. Ask an admin to review module permissions.",
    emptyReasonUnknown: "Advisor coverage is not loaded yet. Refresh the page or check tenant module setup.",
    emptyReasonCollectorFailed: "One or more Advisor data collectors failed. Check module setup or refresh later.",
    clearFilters: "Clear filters",
    activeModulesCount: "active",
    lockedModulesCount: "locked",
    noAccessModulesCount: "no access",
    collectorActive: "Collector active",
    collectorNoData: "No data",
    collectorFailed: "Collector failed",
    collectorModuleDisabled: "Module disabled",
    collectorNoPermission: "No permission",
    moduleNoSignals: "Connected, no active risks now",
    moduleNoSignalsHint: "Collector is active. Nothing needs operator action for this module under the current scope.",
    moduleBlockedHint: "Enable the module or collector before Advisor can produce signals here.",
    moduleNoAccessHint: "Your role cannot read this module's Advisor signals.",
    approve: "Approve",
    reject: "Reject",
    edit: "Edit fields",
    save: "Save",
    cancel: "Cancel",
    invalidJson: "Could not prepare these changes. Close the editor and try again.",
    editFields: "Fields you can edit",
    noPending: "No pending actions.",
    noHistory: "No reviewed actions yet.",
    approvalQueueHelp: "Review the evidence and preview before approving. Advisor only executes after this approval step.",
    reviewDetails: "Evidence and preview",
    evidence: "Evidence",
    preview: "Action preview",
    target: "Target",
    noEvidence: "No separate evidence record is attached.",
    reviewPreviewHint: "This older action has no saved evidence summary, so review the action preview before approving.",
    approved: "Approved",
    rejected: "Rejected",
    queuedStatus: "Queued",
    executing: "Executing",
    executed: "Executed",
    failed: "Failed",
    executionFailed: "Execution failed",
    owner: "Owner",
    amount: "Amount",
    severity: "Severity",
    view: "View",
    selectedRisk: "Open on right",
    openRiskDetails: "Open details",
    filterModule: "Show risks",
    openModule: "Open module",
    searchPlaceholder: "Search signals, modules, companies",
    flow: "Decision flow",
    signalStep: "Signal",
    evidenceStep: "Evidence",
    actionStep: "Next step",
    approvalStep: "Approval",
    nextStep: "Next step",
    approvalRequired: "Requires approval",
    moreActions: "Other options",
    factsCount: "facts",
    signalsLabel: "signals",
    unassigned: "Unassigned",
    routeSnapshot: "Route snapshot",
    routeOwner: "Owner",
    routeStatus: "Status",
    routeVisited: "Visited",
    routeMissedStop: "Missed stop",
    routeDelay: "Delay",
    routeLastActivity: "Last activity",
    routeEvidenceLinks: "Operational links",
    quickFilters: "Quick filters",
    filterAll: "All",
    filterMoney: "Money",
    filterRoutes: "Routes",
    filterSla: "SLA",
    filterOverdue: "Overdue",
    filterUnassigned: "No owner",
    keyboardHint: "/ search, arrows scan",
    dailyBriefing: "Daily briefing",
    briefingEmpty: "No urgent Advisor changes match the current filters.",
    briefingCritical: "Critical/high",
    briefingMoney: "Money",
    briefingRoutes: "Routes/field",
    briefingSla: "SLA",
    briefingKpi: "Manager plan",
    causalChain: "Related chain",
    causalChainDesc: "Signals linked by the same record, source or proposed action.",
    linkedSignal: "Linked signal",
    timeline: "Timeline",
    impact: "Impact",
    impactBasis: "Basis",
    dryRun: "Dry run preview",
    creates: "Creates",
    updates: "Updates",
    notifications: "Notifications",
    externalSideEffects: "External effects",
    rollback: "Rollback",
    rollbackMode: "Rollback mode",
    previewFields: {
      taskTitle: "Task",
      alertTitle: "Alert",
      noteSubject: "Note",
      followupSubject: "Subject",
      budgetTitle: "Budget review",
      description: "Description",
      message: "Message",
      body: "Draft",
      assignee: "Assignee",
      priority: "Priority",
      amount: "Amount",
      relatedRecord: "Related record",
      company: "Company",
      invoice: "Invoice",
      daysOverdue: "Days overdue",
    },
    domains: {
      crm: "CRM",
      sales: "Sales",
      contracts: "Contracts",
      marketing: "Marketing",
      tasks: "Tasks & Projects",
      finance: "Finance",
      support: "Ticketing",
      routes: "Routes",
      mtm: "Routes & Field",
      kpi: "KPI / Managers",
    },
    severities: {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    actionRisks: {
      low: "Low risk",
      medium: "Medium risk",
      high: "High risk",
      dangerous: "Dangerous",
    },
    actionTypes: {
      create_task: "Create task",
      create_alert: "Create alert",
      create_note: "Create note",
      draft_followup: "Draft follow-up",
      suggest_budget_change: "Suggest budget review",
      enrollJourney: "Start collection journey",
      enroll_journey: "Start collection journey",
      "Enroll journey": "Start collection journey",
      "enroll journey": "Start collection journey",
      deal: "Deal",
      company: "Company",
      contact: "Contact",
      invoice: "Invoice",
    },
  },
  ru: {
    title: "AI советник",
    subtitle: "Операционные CRM-сигналы для ежедневных решений, доказательств и безопасных следующих шагов.",
    today: "Сегодня",
    detail: "Детали",
    lastUpdated: "Обновлено",
    neverUpdated: "Еще не загружено",
    staleData: "Данные устарели",
    modules: "Модули",
    ask: "Спросить",
    queue: "Очередь согласования",
    history: "История",
    refresh: "Обновить",
    dateScope: "Период",
    scopeActive: "Активные",
    scopeToday: "Сегодня",
    scopeWeek: "7 дней",
    totalRisks: "Открытые риски",
    critical: "Критичные",
    revenueAtRisk: "Деньги под риском",
    pendingActions: "Действия на согласовании",
    activeCoverage: "Активные модули",
    failedExecutions: "Ошибки исполнения",
    actionTrail: "Ход действий",
    executionTrail: "Ход исполнения",
    executionTrailDesc: "Одобренные действия обновляются здесь, пока executor не отметит их выполненными или ошибочными.",
    recentDecisions: "Последние решения",
    historyFilters: "Фильтры статуса",
    historyShowing: "Показано {shown} из {total}",
    allStatuses: "Все статусы",
    allDates: "Все даты",
    approvedStatus: "Одобрено",
    todayDate: "Сегодня",
    weekDate: "7 дней",
    monthDate: "30 дней",
    allModules: "Все модули",
    allOwners: "Все владельцы",
    needsAttention: "Требует внимания",
    riskDetail: "Детали риска",
    selectRisk: "Выберите риск, чтобы увидеть доказательства, источники и рекомендованные действия.",
    selectRiskTitle: "Выберите риск слева",
    selectRiskReason: "Почему важно",
    selectRiskEvidence: "Доказательства и источники",
    selectRiskAction: "Рекомендованный шаг",
    selectRiskApproval: "Согласование перед исполнением",
    why: "Почему это важно",
    sources: "Источники",
    actions: "Рекомендованные действия",
    queueAction: "Добавить в очередь",
    queued: "Действие добавлено на согласование",
    actionFailed: "Действие не выполнено",
    queueFailed: "Не удалось добавить действие в очередь",
    askFailed: "Не удалось получить ответ Advisor",
    editFailed: "Не удалось сохранить изменения",
    active: "Активен",
    locked: "Закрыт",
    noAccess: "Нет доступа",
    moduleCoverage: "Покрытие Advisor по модулям",
    moduleCoverageDesc: "Advisor открывается как единый AI-центр и показывает, какие бизнес-направления активны или заблокированы для организации.",
    quickQuestions: "Быстрые вопросы",
    askDesc: "Эти вопросы сужают сегодняшние риски. Ответы опираются только на сигналы, найденные на странице.",
    askPlaceholder: "Спросите про сегодняшние риски",
    askButton: "Спросить Advisor",
    launcherTitle: "Что посмотрим?",
    launcherDesc: "Выберите живой бизнес-сценарий. Advisor отфильтрует риски, откроет самый важный сигнал и подготовит ответ с источниками.",
    launcherEmpty: "Для текущего периода нет доступных сценариев Advisor.",
    manualAsk: "Написать свой вопрос",
    manualAskHint: "Используйте это для точного владельца, периода или риска, которого нет в готовых сценариях.",
    scenarioSales: "Риски продаж",
    scenarioSalesDesc: "Зависшие сделки, ожидающие коммерческие предложения и холодные CRM-записи.",
    scenarioMoney: "Деньги под риском",
    scenarioMoneyDesc: "Счета, оплаты, контракты и выручка под риском.",
    scenarioTasks: "Просроченная работа",
    scenarioTasksDesc: "Задачи, которые опаздывают, стареют или блокируют исполнение.",
    scenarioSupport: "SLA / тикеты",
    scenarioSupportDesc: "Риски поддержки, SLA-предупреждения и повторные жалобы.",
    scenarioContracts: "Контракты",
    scenarioContractsDesc: "Согласования, подписи и блокеры по договорам.",
    scenarioRoutes: "Маршруты / поле",
    scenarioRoutesDesc: "Маршруты, визиты, полки и проблемы с планограммами.",
    scenarioKpi: "План менеджеров",
    scenarioKpiDesc: "Владельцы и менеджеры, которые отстают от месячного плана.",
    scenarioMarketing: "Маркетинг",
    scenarioMarketingDesc: "Кампании или каналы, которым нужен пересмотр.",
    answer: "Ответ",
    groundedAnswer: "Ответ Advisor",
    primaryRisk: "Главный риск для разбора",
    whatToDoNext: "Что сделать дальше",
    openThisRisk: "Открыть этот риск",
    activeAnswer: "Активный ответ Advisor",
    activeAnswerDesc: "Последний ответ закреплен рядом с текущим списком рисков, поэтому следующий шаг виден без перехода между вкладками.",
    backToAnswer: "Вернуться к ответу",
    queuePrimaryAction: "Поставить главный шаг в очередь",
    queryScope: "Фокус вопроса",
    citations: "Источники",
    matched: "Найденные сигналы",
    allRisks: "Все риски",
    moneyRisk: "Где деньги под риском?",
    salesRisk: "Какие продажи зависли?",
    taskRisk: "Какие задачи просрочены?",
    contractRisk: "Какие контракты требуют внимания?",
    marketingRisk: "Какие кампании проседают?",
    routeRisk: "Какие маршруты требуют внимания?",
    supportRisk: "Какие SLA-риски открыты?",
    managerRisk: "Какие менеджеры отстают от плана?",
    emptyToday: "Нет активных сигналов Advisor по подключенным модулям.",
    emptyFilteredTitle: "Фильтры скрыли все текущие риски.",
    emptyFilteredReason: "Сбросьте поиск, модуль или владельца, чтобы вернуться ко всему списку Advisor.",
    emptyCoverageHint: "Статус покрытия",
    emptyReasonQuiet: "Подключенные модули доступны, но под текущие фильтры нет активных рисков.",
    emptyReasonNoModules: "Для организации нет активных модулей Advisor. Включите CRM, продажи, контракты, маркетинг, задачи, финансы, тикетинг, маршруты, MTM или аналитику, чтобы получать сигналы.",
    emptyReasonNoAccess: "У вашей роли нет доступа к подключенным модулям Advisor. Попросите администратора проверить права.",
    emptyReasonUnknown: "Покрытие Advisor еще не загружено. Обновите страницу или проверьте настройку модулей организации.",
    emptyReasonCollectorFailed: "Не удалось загрузить один или несколько источников Advisor. Проверьте настройку модулей или обновите позже.",
    clearFilters: "Сбросить фильтры",
    activeModulesCount: "активно",
    lockedModulesCount: "закрыто",
    noAccessModulesCount: "нет доступа",
    collectorActive: "Источник активен",
    collectorNoData: "Нет данных",
    collectorFailed: "Ошибка источника",
    collectorModuleDisabled: "Модуль выключен",
    collectorNoPermission: "Нет доступа",
    moduleNoSignals: "Подключено, активных рисков нет",
    moduleNoSignalsHint: "Источник активен. В текущем периоде по этому модулю нет действий для оператора.",
    moduleBlockedHint: "Включите модуль или источник, чтобы Advisor начал формировать здесь сигналы.",
    moduleNoAccessHint: "У вашей роли нет доступа к Advisor-сигналам этого модуля.",
    approve: "Одобрить",
    reject: "Отклонить",
    edit: "Править поля",
    save: "Сохранить",
    cancel: "Отмена",
    invalidJson: "Не удалось подготовить изменения. Закройте форму и попробуйте снова.",
    editFields: "Поля, которые можно править",
    noPending: "Нет действий на согласовании.",
    noHistory: "Истории согласований пока нет.",
    approvalQueueHelp: "Проверьте доказательства и предпросмотр перед одобрением. Advisor выполнит действие только после этого шага согласования.",
    reviewDetails: "Доказательства и предпросмотр",
    evidence: "Доказательства",
    preview: "Что будет сделано",
    target: "Объект",
    noEvidence: "Отдельная запись доказательств не приложена.",
    reviewPreviewHint: "У этого старого действия нет сохраненной сводки доказательств. Перед подтверждением проверьте предпросмотр действия.",
    approved: "Одобрено",
    rejected: "Отклонено",
    queuedStatus: "В очереди",
    executing: "Выполняется",
    executed: "Выполнено",
    failed: "Ошибка",
    executionFailed: "Ошибка исполнения",
    owner: "Владелец",
    amount: "Сумма",
    severity: "Риск",
    view: "Открыть",
    selectedRisk: "Открыто справа",
    openRiskDetails: "Открыть детали",
    filterModule: "Показать риски",
    openModule: "Открыть модуль",
    searchPlaceholder: "Поиск по рискам, модулям, компаниям",
    flow: "Ход решения",
    signalStep: "Сигнал",
    evidenceStep: "Доказательства",
    actionStep: "Следующий шаг",
    approvalStep: "Согласование",
    nextStep: "Следующий шаг",
    approvalRequired: "Требует согласования",
    moreActions: "Другие варианты",
    factsCount: "фактов",
    signalsLabel: "сигналов",
    unassigned: "Без владельца",
    routeSnapshot: "Срез маршрута",
    routeOwner: "Владелец",
    routeStatus: "Статус",
    routeVisited: "Визиты",
    routeMissedStop: "Пропущенная точка",
    routeDelay: "Задержка",
    routeLastActivity: "Последняя активность",
    routeEvidenceLinks: "Операционные ссылки",
    quickFilters: "Быстрые фильтры",
    filterAll: "Все",
    filterMoney: "Деньги",
    filterRoutes: "Маршруты",
    filterSla: "SLA",
    filterOverdue: "Просрочки",
    filterUnassigned: "Без владельца",
    keyboardHint: "/ поиск, стрелки выбор",
    dailyBriefing: "Ежедневная сводка",
    briefingEmpty: "Под текущие фильтры нет срочных изменений Advisor.",
    briefingCritical: "Критично/высоко",
    briefingMoney: "Деньги",
    briefingRoutes: "Маршруты/поле",
    briefingSla: "SLA",
    briefingKpi: "План менеджеров",
    causalChain: "Связанная цепочка",
    causalChainDesc: "Сигналы связаны общей записью, источником или предложенным действием.",
    linkedSignal: "Связанный сигнал",
    timeline: "Хронология",
    impact: "Влияние",
    impactBasis: "Основание",
    dryRun: "Предпросмотр без исполнения",
    creates: "Создает",
    updates: "Обновляет",
    notifications: "Уведомления",
    externalSideEffects: "Внешние эффекты",
    rollback: "Откат",
    rollbackMode: "Режим отката",
    previewFields: {
      taskTitle: "Задача",
      alertTitle: "Уведомление",
      noteSubject: "Заметка",
      followupSubject: "Тема",
      budgetTitle: "Пересмотр бюджета",
      description: "Описание",
      message: "Сообщение",
      body: "Черновик",
      assignee: "Исполнитель",
      priority: "Приоритет",
      amount: "Сумма",
      relatedRecord: "Связанная запись",
      company: "Компания",
      invoice: "Счет",
      daysOverdue: "Дней просрочки",
    },
    domains: {
      crm: "CRM",
      sales: "Продажи",
      contracts: "Контракты",
      marketing: "Маркетинг",
      tasks: "Задачи и проекты",
      finance: "Финансы",
      support: "Тикетинг",
      routes: "Маршруты",
      mtm: "MTM / Поле",
      kpi: "KPI / Менеджеры",
    },
    severities: {
      critical: "Критичный",
      high: "Высокий",
      medium: "Средний",
      low: "Низкий",
    },
    actionRisks: {
      low: "Низкий риск",
      medium: "Средний риск",
      high: "Высокий риск",
      dangerous: "Опасное действие",
    },
    actionTypes: {
      create_task: "Создать задачу",
      create_alert: "Создать уведомление",
      create_note: "Создать заметку",
      draft_followup: "Подготовить ответ",
      suggest_budget_change: "Предложить пересмотр бюджета",
      enrollJourney: "Запустить маршрут взыскания",
      enroll_journey: "Запустить маршрут взыскания",
      "Enroll journey": "Запустить маршрут взыскания",
      "enroll journey": "Запустить маршрут взыскания",
      deal: "Сделка",
      company: "Компания",
      contact: "Контакт",
      invoice: "Счет",
    },
  },
  az: {
    title: "AI məsləhətçi",
    subtitle: "Gündəlik qərarlar, sübutlar və təhlükəsiz növbəti addımlar üçün CRM əsaslı əməliyyat siqnalları.",
    today: "Bu gün",
    detail: "Detal",
    lastUpdated: "Yeniləndi",
    neverUpdated: "Hələ yüklənməyib",
    staleData: "Məlumat köhnəlib",
    modules: "Modullar",
    ask: "Soruş",
    queue: "Təsdiq növbəsi",
    history: "Tarixçə",
    refresh: "Yenilə",
    dateScope: "Dövr",
    scopeActive: "Aktiv",
    scopeToday: "Bu gün",
    scopeWeek: "7 gün",
    totalRisks: "Açıq risklər",
    critical: "Kritik",
    revenueAtRisk: "Risk altında məbləğ",
    pendingActions: "Təsdiq gözləyən",
    activeCoverage: "Aktiv modullar",
    failedExecutions: "İcra xətaları",
    actionTrail: "Əməliyyat izi",
    executionTrail: "İcra izi",
    executionTrailDesc: "Təsdiqlənmiş əməliyyatlar executor onları icra edildi və ya xəta kimi işarələyənə qədər burada yenilənir.",
    recentDecisions: "Son qərarlar",
    historyFilters: "Status filtrləri",
    historyShowing: "{total} içindən {shown} göstərilir",
    allStatuses: "Bütün statuslar",
    allDates: "Bütün tarixlər",
    approvedStatus: "Təsdiqləndi",
    todayDate: "Bu gün",
    weekDate: "7 gün",
    monthDate: "30 gün",
    allModules: "Bütün modullar",
    allOwners: "Bütün sahiblər",
    needsAttention: "Diqqət tələb edir",
    riskDetail: "Risk detalları",
    selectRisk: "Sübutları, mənbələri və tövsiyə olunan əməliyyatları görmək üçün risk seçin.",
    selectRiskTitle: "Soldan risk seçin",
    selectRiskReason: "Niyə vacibdir",
    selectRiskEvidence: "Sübutlar və mənbələr",
    selectRiskAction: "Tövsiyə olunan addım",
    selectRiskApproval: "İcradan əvvəl təsdiq",
    why: "Niyə vacibdir",
    sources: "Mənbələr",
    actions: "Tövsiyə olunan əməliyyatlar",
    queueAction: "Növbəyə əlavə et",
    queued: "Əməliyyat təsdiq üçün növbəyə əlavə edildi",
    actionFailed: "Əməliyyat alınmadı",
    queueFailed: "Əməliyyatı növbəyə əlavə etmək olmadı",
    askFailed: "Advisor cavabı alınmadı",
    editFailed: "Dəyişiklikləri saxlamaq olmadı",
    active: "Aktiv",
    locked: "Bağlı",
    noAccess: "Giriş yoxdur",
    moduleCoverage: "Advisor modul əhatəsi",
    moduleCoverageDesc: "Advisor vahid AI mərkəzi kimi açılır və tenant üçün hansı biznes domenlərinin aktiv və ya bloklandığını göstərir.",
    quickQuestions: "Sürətli suallar",
    askDesc: "Bu suallar bugünkü riskləri daraldır. Cavablar yalnız bu səhifədə tapılan siqnallara əsaslanır.",
    askPlaceholder: "Bugünkü risklər haqqında soruşun",
    askButton: "Advisor-dan soruş",
    launcherTitle: "Nəyə baxaq?",
    launcherDesc: "Canlı biznes ssenarisi seçin. Advisor riskləri süzəcək, ən uyğun siqnalı açacaq və mənbəli cavabı hazırlayacaq.",
    launcherEmpty: "Cari dövr üçün Advisor ssenarisi yoxdur.",
    manualAsk: "Öz sualını yaz",
    manualAskHint: "Hazır ssenaridə olmayan konkret sahib, dövr və ya risk üçün istifadə edin.",
    scenarioSales: "Satış riskləri",
    scenarioSalesDesc: "Dayanmış sövdələşmələr, gözləyən təkliflər və soyuyan CRM qeydləri.",
    scenarioMoney: "Pul riski",
    scenarioMoneyDesc: "Risk altında olan invoice, ödəniş, müqavilə və gəlir.",
    scenarioTasks: "Gecikmiş işlər",
    scenarioTasksDesc: "Gecikən, köhnələn və icranı bloklayan tapşırıqlar.",
    scenarioSupport: "SLA / tiketlər",
    scenarioSupportDesc: "Dəstək riskləri, SLA xəbərdarlıqları və təkrar şikayətlər.",
    scenarioContracts: "Müqavilələr",
    scenarioContractsDesc: "Təsdiq, imza və müqavilə blokları.",
    scenarioRoutes: "Marşrut / sahə",
    scenarioRoutesDesc: "Marşrut, ziyarət və check-in problemləri.",
    scenarioKpi: "Menecer planı",
    scenarioKpiDesc: "Aylıq aktivlik planından geri qalan sahiblər və menecerlər.",
    scenarioMarketing: "Marketinq",
    scenarioMarketingDesc: "Baxış tələb edən kampaniya və kanallar.",
    answer: "Cavab",
    groundedAnswer: "Advisor cavabı",
    primaryRisk: "Baxılmalı əsas risk",
    whatToDoNext: "Növbəti nə edilməlidir",
    openThisRisk: "Bu riski aç",
    activeAnswer: "Aktiv Advisor cavabı",
    activeAnswerDesc: "Son cavab cari risk siyahısına bağlı qalır, ona görə növbəti addım tab dəyişmədən görünür.",
    backToAnswer: "Cavaba qayıt",
    queuePrimaryAction: "Əsas addımı növbəyə əlavə et",
    queryScope: "Sorğu fokusu",
    citations: "Mənbələr",
    matched: "Tapılan siqnallar",
    allRisks: "Bütün risklər",
    moneyRisk: "Pul harada risk altındadır?",
    salesRisk: "Hansı satış işləri dayanıb?",
    taskRisk: "Hansı tapşırıqlar gecikir?",
    contractRisk: "Hansı müqavilələr diqqət tələb edir?",
    marketingRisk: "Hansı kampaniyalar zəifdir?",
    routeRisk: "Hansı marşrutlara diqqət lazımdır?",
    supportRisk: "Hansı SLA riskləri açıqdır?",
    managerRisk: "Hansı menecerlər plandan geri qalır?",
    emptyToday: "Qoşulmuş modullar üzrə aktiv Advisor siqnalı yoxdur.",
    emptyFilteredTitle: "Filtrlər bütün cari riskləri gizlədir.",
    emptyFilteredReason: "Tam Advisor siyahısına qayıtmaq üçün axtarış, modul və ya sahib filtrini sıfırlayın.",
    emptyCoverageHint: "Əhatə statusu",
    emptyReasonQuiet: "Qoşulmuş modullar aktivdir, amma cari filtrlərə uyğun aktiv risk yoxdur.",
    emptyReasonNoModules: "Bu təşkilat üçün aktiv Advisor modulu yoxdur. Siqnallar üçün CRM, satış, müqavilə, marketinq, tapşırıqlar, maliyyə, tiketlər, marşrutlar, MTM və ya analitika modullarını aktiv edin.",
    emptyReasonNoAccess: "Cari rolunuz qoşulmuş Advisor modullarına daxil ola bilmir. Admin modul icazələrini yoxlamalıdır.",
    emptyReasonUnknown: "Advisor əhatəsi hələ yüklənməyib. Səhifəni yeniləyin və ya təşkilatın modul ayarlarını yoxlayın.",
    emptyReasonCollectorFailed: "Bir və ya bir neçə Advisor mənbəsi yüklənmədi. Modul ayarlarını yoxlayın və ya sonra yeniləyin.",
    clearFilters: "Filtrləri sıfırla",
    activeModulesCount: "aktiv",
    lockedModulesCount: "bağlı",
    noAccessModulesCount: "giriş yoxdur",
    collectorActive: "Mənbə aktivdir",
    collectorNoData: "Məlumat yoxdur",
    collectorFailed: "Mənbə xətası",
    collectorModuleDisabled: "Modul söndürülüb",
    collectorNoPermission: "Giriş yoxdur",
    moduleNoSignals: "Qoşulub, aktiv risk yoxdur",
    moduleNoSignalsHint: "Mənbə aktivdir. Cari dövrdə bu modul üzrə operator addımı tələb olunmur.",
    moduleBlockedHint: "Advisor-un burada siqnal yaratması üçün modulu və ya mənbəni aktiv edin.",
    moduleNoAccessHint: "Rolunuz bu modulun Advisor siqnallarını oxuya bilmir.",
    approve: "Təsdiqlə",
    reject: "Rədd et",
    edit: "Sahələri düzəlt",
    save: "Yadda saxla",
    cancel: "Ləğv et",
    invalidJson: "Dəyişiklikləri hazırlamaq olmadı. Formanı bağlayıb yenidən yoxlayın.",
    editFields: "Düzəldə biləcəyiniz sahələr",
    noPending: "Təsdiq gözləyən əməliyyat yoxdur.",
    noHistory: "Təsdiq tarixçəsi hələ yoxdur.",
    approvalQueueHelp: "Təsdiqdən əvvəl sübutları və ön baxışı yoxlayın. Advisor əməliyyatı yalnız bu təsdiq addımından sonra icra edir.",
    reviewDetails: "Sübut və ön baxış",
    evidence: "Sübutlar",
    preview: "Nə ediləcək",
    target: "Obyekt",
    noEvidence: "Ayrıca sübut qeydi əlavə edilməyib.",
    reviewPreviewHint: "Bu köhnə əməliyyatda saxlanmış sübut xülasəsi yoxdur. Təsdiqdən əvvəl əməliyyat ön baxışını yoxlayın.",
    approved: "Təsdiqləndi",
    rejected: "Rədd edildi",
    queuedStatus: "Növbədə",
    executing: "İcra olunur",
    executed: "İcra edildi",
    failed: "Xəta",
    executionFailed: "İcra xətası",
    owner: "Sahib",
    amount: "Məbləğ",
    severity: "Risk",
    view: "Aç",
    selectedRisk: "Detallar sağdadır",
    openRiskDetails: "Detalları aç",
    filterModule: "Riskləri göstər",
    openModule: "Modulu aç",
    searchPlaceholder: "Risk, modul və şirkətlərdə axtar",
    flow: "Qərar axını",
    signalStep: "Siqnal",
    evidenceStep: "Sübut",
    actionStep: "Növbəti addım",
    approvalStep: "Təsdiq",
    nextStep: "Növbəti addım",
    approvalRequired: "Təsdiq tələb edir",
    moreActions: "Digər variantlar",
    factsCount: "fakt",
    signalsLabel: "siqnal",
    unassigned: "Sahibsiz",
    routeSnapshot: "Marşrut xülasəsi",
    routeOwner: "Sahib",
    routeStatus: "Status",
    routeVisited: "Ziyarət",
    routeMissedStop: "Buraxılmış nöqtə",
    routeDelay: "Gecikmə",
    routeLastActivity: "Son aktivlik",
    routeEvidenceLinks: "Əməliyyat keçidləri",
    quickFilters: "Sürətli filtrlər",
    filterAll: "Hamısı",
    filterMoney: "Pul",
    filterRoutes: "Marşrutlar",
    filterSla: "SLA",
    filterOverdue: "Gecikən",
    filterUnassigned: "Sahibsiz",
    keyboardHint: "/ axtar, oxlar seçim",
    dailyBriefing: "Gündəlik xülasə",
    briefingEmpty: "Cari filtrlərə uyğun təcili Advisor dəyişikliyi yoxdur.",
    briefingCritical: "Kritik/yüksək",
    briefingMoney: "Pul",
    briefingRoutes: "Marşrut/sahə",
    briefingSla: "SLA",
    briefingKpi: "Menecer planı",
    causalChain: "Əlaqəli zəncir",
    causalChainDesc: "Siqnallar eyni qeyd, mənbə və ya təklif olunan əməliyyatla bağlıdır.",
    linkedSignal: "Əlaqəli siqnal",
    timeline: "Zaman xətti",
    impact: "Təsir",
    impactBasis: "Əsas",
    dryRun: "İcradan əvvəl baxış",
    creates: "Yaradacaq",
    updates: "Yeniləyəcək",
    notifications: "Bildirişlər",
    externalSideEffects: "Xarici təsirlər",
    rollback: "Geri qaytarma",
    rollbackMode: "Geri qaytarma rejimi",
    previewFields: {
      taskTitle: "Tapşırıq",
      alertTitle: "Xəbərdarlıq",
      noteSubject: "Qeyd",
      followupSubject: "Mövzu",
      budgetTitle: "Büdcə baxışı",
      description: "Təsvir",
      message: "Mesaj",
      body: "Qaralama",
      assignee: "İcraçı",
      priority: "Prioritet",
      amount: "Məbləğ",
      relatedRecord: "Əlaqəli qeyd",
      company: "Şirkət",
      invoice: "Faktura",
      daysOverdue: "Gecikmə günü",
    },
    domains: {
      crm: "CRM",
      sales: "Satış",
      contracts: "Müqavilələr",
      marketing: "Marketinq",
      tasks: "Tapşırıqlar və layihələr",
      finance: "Maliyyə",
      support: "Tiketlər",
      routes: "Marşrutlar",
      mtm: "MTM / Sahə",
      kpi: "KPI / Menecerlər",
    },
    severities: {
      critical: "Kritik",
      high: "Yüksək",
      medium: "Orta",
      low: "Aşağı",
    },
    actionRisks: {
      low: "Aşağı risk",
      medium: "Orta risk",
      high: "Yüksək risk",
      dangerous: "Təhlükəli əməliyyat",
    },
    actionTypes: {
      create_task: "Tapşırıq yarat",
      create_alert: "Xəbərdarlıq yarat",
      create_note: "Qeyd yarat",
      draft_followup: "Cavab qaralaması hazırla",
      suggest_budget_change: "Büdcə baxışını təklif et",
      enrollJourney: "Ödəniş izləmə marşrutunu başlat",
      enroll_journey: "Ödəniş izləmə marşrutunu başlat",
      "Enroll journey": "Ödəniş izləmə marşrutunu başlat",
      "enroll journey": "Ödəniş izləmə marşrutunu başlat",
      deal: "Sövdələşmə",
      company: "Şirkət",
      contact: "Kontakt",
      invoice: "Faktura",
    },
  },
}

function useCopy() {
  const locale = useLocale()
  return COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : "en"] as typeof COPY.en
}

function toAskFilter(intent: AdvisorAnswer["intent"]): AdvisorAskFilter {
  if (intent === "money") return "money"
  if (intent === "routes" || intent === "field") return "routes"
  if (intent === "support") return "support"
  if (intent === "kpi") return "kpi"
  if (intent === "sales") return "sales"
  if (intent === "tasks") return "tasks"
  if (intent === "contracts") return "contracts"
  if (intent === "marketing") return "marketing"
  return "all"
}

function severityClasses(severity: AdvisorSignal["severity"]) {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
  if (severity === "high") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
  if (severity === "medium") return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}

function formatMoney(value: number, currency = "AZN") {
  return `${Math.round(value).toLocaleString()} ${currency}`
}

function domainLabelFor(copy: (typeof COPY)["en"], key: AdvisorDomainKey, fallback?: string) {
  return copy.domains[key] || fallback || key
}

function severityLabelFor(copy: (typeof COPY)["en"], severity: AdvisorSignal["severity"]) {
  return copy.severities[severity] || severity
}

function actionTypeLabelFor(copy: (typeof COPY)["en"], actionType: string) {
  return copy.actionTypes[actionType as keyof typeof copy.actionTypes] || actionType.replace(/_/g, " ")
}

function actionRiskLabelFor(copy: (typeof COPY)["en"], risk: AdvisorAction["risk"] | string) {
  return copy.actionRisks[risk as keyof typeof copy.actionRisks] || risk
}

function intentLabelFor(copy: (typeof COPY)["en"], intent: string) {
  const labels: Record<AdvisorQueryIntent, string> = {
    overview: copy.allRisks,
    money: copy.scenarioMoney,
    routes: copy.scenarioRoutes,
    support: copy.scenarioSupport,
    tasks: copy.scenarioTasks,
    sales: copy.scenarioSales,
    contracts: copy.scenarioContracts,
    marketing: copy.scenarioMarketing,
    field: copy.scenarioRoutes,
    kpi: copy.scenarioKpi,
  }
  return labels[intent as AdvisorQueryIntent] || intent
}

function metricKindLabelFor(locale: string, metric: string) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<AdvisorSignalMetricKind, Record<"en" | "ru" | "az", string>> = {
    money: { en: "Money", ru: "Деньги", az: "Pul" },
    days: { en: "Days", ru: "Дни", az: "Gün" },
    minutes: { en: "Minutes", ru: "Минуты", az: "Dəqiqə" },
    percent: { en: "Percent", ru: "Процент", az: "Faiz" },
    count: { en: "Count", ru: "Количество", az: "Say" },
    score: { en: "Score", ru: "Оценка", az: "Skor" },
  }
  return labels[metric as AdvisorSignalMetricKind]?.[lang] || metric
}

function queryDateScopeLabelFor(locale: string, scope: string) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<AdvisorQueryDateScope, Record<"en" | "ru" | "az", string>> = {
    all: { en: "All time", ru: "Весь период", az: "Bütün dövr" },
    today: { en: "Today", ru: "Сегодня", az: "Bu gün" },
    week: { en: "7 days", ru: "7 дней", az: "7 gün" },
    month: { en: "Month", ru: "Месяц", az: "Ay" },
  }
  return labels[scope as AdvisorQueryDateScope]?.[lang] || scope
}

function advisorStatusLabelFor(locale: string, status: string) {
  const key = status.toLowerCase()
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<string, Record<"en" | "ru" | "az", string>> = {
    viewed: { en: "viewed", ru: "просмотрено", az: "baxılıb" },
    sent: { en: "sent", ru: "отправлено", az: "göndərilib" },
    accepted: { en: "accepted", ru: "принято", az: "qəbul edilib" },
    rejected: { en: "rejected", ru: "отклонено", az: "rədd edilib" },
    expired: { en: "expired", ru: "истекло", az: "müddəti bitib" },
    draft: { en: "draft", ru: "черновик", az: "qaralama" },
  }
  return labels[key]?.[lang] || status
}

function advisorSignalTitleTextFor(locale: string, title: string) {
  const noBuyerDecision = title.match(/^(.+?) has no buyer decision$/i)
  if (noBuyerDecision) {
    if (locale === "az") return `${noBuyerDecision[1]} üzrə alıcı qərarı yoxdur`
    if (locale === "ru") return `По ${noBuyerDecision[1]} нет решения покупателя`
  }
  const overdue = title.match(/^(.+?) has (\d+) overdue tasks?$/i)
  if (overdue) {
    if (locale === "az") return `${overdue[1]} üzrə ${overdue[2]} gecikmiş tapşırıq var`
    if (locale === "ru") return `У ${overdue[1]} ${overdue[2]} просроченных задач`
  }
  const responseGaps = title.match(/^(.+?) has (\d+) response gaps$/i)
  if (responseGaps) {
    if (locale === "az") return `${responseGaps[1]} üzrə ${responseGaps[2]} cavab gecikməsi var`
    if (locale === "ru") return `У ${responseGaps[1]} ${responseGaps[2]} задержки ответа`
  }
  const noRecentCrm = title.match(/^(.+?) has no recent CRM activity$/i)
  if (noRecentCrm) {
    if (locale === "az") return `${noRecentCrm[1]} üzrə son CRM aktivliyi yoxdur`
    if (locale === "ru") return `У ${noRecentCrm[1]} нет недавней CRM-активности`
  }
  const approvedFollowUp = title.match(/^(.+?) approved follow-up pattern$/i)
  if (approvedFollowUp) {
    if (locale === "az") return `${approvedFollowUp[1]} üzrə təsdiqlənmiş təqib nümunəsi`
    if (locale === "ru") return `${approvedFollowUp[1]}: подтвержденный сценарий follow-up`
  }
  const repeatedSupport = title.match(/^(.+?) repeated support complaints$/i)
  if (repeatedSupport) {
    if (locale === "az") return `${repeatedSupport[1]} üzrə təkrarlanan dəstək şikayətləri`
    if (locale === "ru") return `${repeatedSupport[1]}: повторные жалобы в поддержку`
  }
  const repeatedOpenTickets = title.match(/^(.+?) has repeated open tickets$/i)
  if (repeatedOpenTickets) {
    if (locale === "az") return `${repeatedOpenTickets[1]} üzrə təkrarlanan açıq tikətlər var`
    if (locale === "ru") return `У ${repeatedOpenTickets[1]} повторные открытые тикеты`
  }
  const approvedFollowUpTask = title.match(/^(.+?) Approved follow-up task$/i)
  if (approvedFollowUpTask) {
    if (locale === "az") return `${approvedFollowUpTask[1]} üzrə təsdiqlənmiş təqib tapşırığı`
    if (locale === "ru") return `${approvedFollowUpTask[1]}: подтвержденная follow-up задача`
  }
  const repeatedSupportEscalation = title.match(/^(.+?) Escalate repeated support complaints$/i)
  if (repeatedSupportEscalation) {
    if (locale === "az") return `${repeatedSupportEscalation[1]} üzrə təkrarlanan şikayətləri eskalasiya et`
    if (locale === "ru") return `${repeatedSupportEscalation[1]}: эскалировать повторные жалобы`
  }
  const behindPlan = title.match(/^(.+?) is behind this month's action plan$/i)
  if (behindPlan) {
    if (locale === "az") return `${behindPlan[1]} bu ayın əməliyyat planından geri qalır`
    if (locale === "ru") return `${behindPlan[1]} отстает от плана действий за месяц`
  }
  const overdueItem = title.match(/^(.+?) is overdue$/i)
  if (overdueItem) {
    if (locale === "az") return `${overdueItem[1]} gecikir`
    if (locale === "ru") return `${overdueItem[1]} просрочено`
  }
  const stalledDeal = title.match(/^(.+?) is stalled(?: in (.+))?$/i)
  if (stalledDeal) {
    if (locale === "az") return stalledDeal[2] ? `${stalledDeal[1]} "${stalledDeal[2]}" mərhələsində dayanıb` : `${stalledDeal[1]} dayanıb`
    if (locale === "ru") return stalledDeal[2] ? `${stalledDeal[1]} завис на этапе "${stalledDeal[2]}"` : `${stalledDeal[1]} завис`
  }
  const noClicks = title.match(/^(.+?) has delivery without clicks$/i)
  if (noClicks) {
    if (locale === "az") return `${noClicks[1]} göndərilib, klik yoxdur`
    if (locale === "ru") return `${noClicks[1]} отправлена, но кликов нет`
  }
  const slaRisk = title.match(/^(.+?) is at SLA risk$/i)
  if (slaRisk) {
    if (locale === "az") return `${slaRisk[1]} SLA riski altındadır`
    if (locale === "ru") return `${slaRisk[1]} под SLA-риском`
  }
  const escalated = title.match(/^(.+?) is escalated and unresolved$/i)
  if (escalated) {
    if (locale === "az") return `${escalated[1]} eskalasiya olunub və həll edilməyib`
    if (locale === "ru") return `${escalated[1]} эскалирован и не решен`
  }
  const blocked = title.match(/^(.+?) is blocked$/i)
  if (blocked) {
    if (locale === "az") return `${blocked[1]} bloklanıb`
    if (locale === "ru") return `${blocked[1]} заблокировано`
  }
  const dueSoon = title.match(/^(.+?) is due soon$/i)
  if (dueSoon) {
    if (locale === "az") return `${dueSoon[1]} üzrə müddət yaxınlaşır`
    if (locale === "ru") return `${dueSoon[1]} скоро к сроку`
  }
  const aging = title.match(/^(.+?) is aging$/i)
  if (aging) {
    if (locale === "az") return `${aging[1]} uzun müddətdir açıqdır`
    if (locale === "ru") return `${aging[1]} давно открыто`
  }
  return title
}

function advisorSignalTitleFor(locale: string, signal: AdvisorSignal) {
  return advisorSignalTitleTextFor(locale, signal.title)
}

function advisorSignalSummaryTextFor(locale: string, summary: string) {
  const quoteExpired = summary.match(/^Quote validity expired with status (.+)\.$/i)
  if (quoteExpired) {
    const status = advisorStatusLabelFor(locale, quoteExpired[1])
    if (locale === "az") return `Təklifin etibarlılıq müddəti bitib. Status: ${status}.`
    if (locale === "ru") return `Срок действия коммерческого предложения истек. Статус: ${status}.`
  }
  const quoteIdle = summary.match(/^Quote is (.+) and has been idle for (\d+) days\.$/i)
  if (quoteIdle) {
    const status = advisorStatusLabelFor(locale, quoteIdle[1])
    if (locale === "az") return `Təklif ${status} statusundadır və ${quoteIdle[2]} gündür hərəkətsizdir.`
    if (locale === "ru") return `Предложение в статусе ${status} и без движения ${quoteIdle[2]} дн.`
  }
  const noStageMovement = summary.match(/^No stage movement for (\d+) days( and close date is overdue)?\.$/i)
  if (noStageMovement) {
    if (locale === "az") return `${noStageMovement[1]} gündür mərhələ dəyişməyib${noStageMovement[2] ? " və bağlanış tarixi gecikib" : ""}.`
    if (locale === "ru") return `${noStageMovement[1]} дн. нет движения по этапу${noStageMovement[2] ? ", дата закрытия просрочена" : ""}.`
  }
  const noTrackedActivity = summary.match(/^No tracked activity for (\d+) days\. Review ownership and next step\.$/i)
  if (noTrackedActivity) {
    if (locale === "az") return `${noTrackedActivity[1]} gündür izlənən aktivlik yoxdur. Sahibliyi və növbəti addımı yoxlayın.`
    if (locale === "ru") return `${noTrackedActivity[1]} дн. нет отслеженной активности. Проверьте владельца и следующий шаг.`
  }
  if (summary === "Managers repeatedly approved this follow-up pattern.") {
    if (locale === "az") return "Menecerlər bu təqib nümunəsini bir neçə dəfə təsdiqləyib."
    if (locale === "ru") return "Менеджеры несколько раз подтверждали этот follow-up сценарий."
  }
  if (summary === "Rejected demo action remains visible in history.") {
    if (locale === "az") return "Rədd edilmiş demo əməliyyatı tarixçədə görünür."
    if (locale === "ru") return "Отклоненное demo-действие остается видимым в истории."
  }
  const taskOverdue = summary.match(/^Task is overdue by (\d+) days\.$/i)
  if (taskOverdue) {
    if (locale === "az") return `Tapşırıq ${taskOverdue[1]} gündür gecikir.`
    if (locale === "ru") return `Задача просрочена на ${taskOverdue[1]} дн.`
  }
  const taskDueSoon = summary.match(/^Task is due in (\d+) day\.$/i)
  if (taskDueSoon) {
    if (locale === "az") return `Tapşırığın müddətinə ${taskDueSoon[1]} gün qalıb.`
    if (locale === "ru") return `До срока задачи ${taskDueSoon[1]} дн.`
  }
  return summary
}

function advisorSignalSummaryFor(locale: string, signal: AdvisorSignal) {
  return advisorSignalSummaryTextFor(locale, signal.summary)
}

function advisorActionLabelFor(locale: string, action: AdvisorAction, copy: (typeof COPY)["en"]) {
  const label = action.label
  const reconnectContact = label.match(/^Reconnect with (.+)$/i)
  if (reconnectContact) {
    if (locale === "az") return `${reconnectContact[1]} ilə əlaqəni yenilə`
    if (locale === "ru") return `Возобновить контакт с ${reconnectContact[1]}`
  }
  const followUpQuote = label.match(/^Follow up quote (.+)$/i)
  if (followUpQuote) {
    if (locale === "az") return `${followUpQuote[1]} üzrə alıcı qərarını yoxla`
    if (locale === "ru") return `Проверить решение покупателя по ${followUpQuote[1]}`
  }
  const followUpDeal = label.match(/^Follow up: (.+)$/i)
  if (followUpDeal) {
    if (locale === "az") return `${followUpDeal[1]} üzrə növbəti addımı yoxla`
    if (locale === "ru") return `Проверить следующий шаг по ${followUpDeal[1]}`
  }
  const nextStepDeal = label.match(/^Next step for (.+)$/i)
  if (nextStepDeal) {
    if (locale === "az") return `${nextStepDeal[1]} üzrə növbəti addım`
    if (locale === "ru") return `Следующий шаг по ${nextStepDeal[1]}`
  }
  const advisorRiskNote = label.match(/^Advisor risk: (.+)$/i)
  if (advisorRiskNote) {
    if (locale === "az") return `Advisor riski: ${advisorRiskNote[1]}`
    if (locale === "ru") return `Риск Advisor: ${advisorRiskNote[1]}`
  }
  return actionTypeLabelFor(copy, action.actionType)
}

function advisorActionDescriptionFor(locale: string, description: string) {
  const noActivityTask = description.match(/^No activity for (\d+) days\. Confirm status and next step\.$/i)
  if (noActivityTask) {
    if (locale === "az") return `${noActivityTask[1]} gündür aktivlik yoxdur. Statusu və növbəti addımı təsdiqləyin.`
    if (locale === "ru") return `${noActivityTask[1]} дн. нет активности. Подтвердите статус и следующий шаг.`
  }
  if (description === "Demo executed action for Advisor history.") {
    if (locale === "az") return "Advisor tarixçəsi üçün demo icra əməliyyatı."
    if (locale === "ru") return "Demo-действие выполнено для истории Advisor."
  }
  if (description === "Review support trend before escalating.") {
    if (locale === "az") return "Eskalasiya etməzdən əvvəl dəstək trendini yoxlayın."
    if (locale === "ru") return "Проверьте тренд поддержки перед эскалацией."
  }
  const quoteBuyerDecisionTask = description.match(/^Quote is (.+) and has been idle for (\d+) days\. Confirm buyer decision or revise terms\.$/i)
  if (quoteBuyerDecisionTask) {
    const status = advisorStatusLabelFor(locale, quoteBuyerDecisionTask[1])
    if (locale === "az") return `Təklif ${status} statusundadır və ${quoteBuyerDecisionTask[2]} gündür hərəkətsizdir. Alıcı qərarını təsdiqləyin və ya şərtləri yeniləyin.`
    if (locale === "ru") return `Предложение в статусе ${status} и без движения ${quoteBuyerDecisionTask[2]} дн. Подтвердите решение покупателя или обновите условия.`
  }
  const stalledDealTask = description.match(/^Deal has not moved for (\d+) days\. Confirm next step and update close plan\.$/i)
  if (stalledDealTask) {
    if (locale === "az") return `Sövdələşmə ${stalledDealTask[1]} gündür irəliləmir. Növbəti addımı təsdiqləyin və bağlanış planını yeniləyin.`
    if (locale === "ru") return `Сделка не двигается ${stalledDealTask[1]} дн. Подтвердите следующий шаг и обновите план закрытия.`
  }
  const stalledDealNote = description.match(/^Stalled in (.+) for (\d+) days\. Probability (.+)%, value (.+)\.$/i)
  if (stalledDealNote) {
    if (locale === "az") return `${stalledDealNote[1]} mərhələsində ${stalledDealNote[2]} gündür dayanıb. Ehtimal ${stalledDealNote[3]}%, dəyər ${stalledDealNote[4]}.`
    if (locale === "ru") return `Зависла на этапе ${stalledDealNote[1]} ${stalledDealNote[2]} дн. Вероятность ${stalledDealNote[3]}%, сумма ${stalledDealNote[4]}.`
  }
  const dealFollowUpDraft = description.match(/^Hi, checking in on the next step for (.+)\.$/i)
  if (dealFollowUpDraft) {
    if (locale === "az") return `Salam, ${dealFollowUpDraft[1]} üzrə növbəti addımı dəqiqləşdirirəm.`
    if (locale === "ru") return `Здравствуйте, уточняю следующий шаг по ${dealFollowUpDraft[1]}.`
  }
  return description
}

function advisorRecommendedActionDescriptionFor(locale: string, action: AdvisorAction) {
  const payload = action.payload || {}
  const raw = ["description", "summary", "message", "body"]
    .map((key) => payload[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
  return raw ? advisorActionDescriptionFor(locale, raw) : null
}

function advisorFormattedValueFor(locale: string, value: string) {
  const days = value.match(/^(\d+(?:\.\d+)?)\s+days?$/i)
  if (days) {
    if (locale === "az") return `${days[1]} gün`
    if (locale === "ru") return `${days[1]} дн.`
  }
  const minutes = value.match(/^(\d+(?:\.\d+)?)\s+min(?:utes?)?$/i)
  if (minutes) {
    if (locale === "az") return `${minutes[1]} dəq.`
    if (locale === "ru") return `${minutes[1]} мин.`
  }
  return value
}

function advisorImpactLabelFor(locale: string, impact: NonNullable<AdvisorSignal["impact"]>) {
  return advisorMetricLabelFor(locale, impact.label)
}

function advisorImpactValueFor(locale: string, impact: NonNullable<AdvisorSignal["impact"]>) {
  return advisorFormattedValueFor(locale, impact.value)
}

function advisorImpactBasisFor(locale: string, impact: NonNullable<AdvisorSignal["impact"]>) {
  const basis = impact.basis
  if (basis === "Critical because the signal is urgent, overdue, blocked or has high monetary exposure.") {
    if (locale === "az") return "Kritikdir, çünki siqnal təcili, gecikmiş, bloklanmış və ya yüksək məbləğ riski daşıyır."
    if (locale === "ru") return "Критично, потому что сигнал срочный, просроченный, заблокированный или несет высокий денежный риск."
  }
  if (basis === "High because the signal is likely to affect revenue, SLA, route execution or manager accountability.") {
    if (locale === "az") return "Yüksəkdir, çünki gəlirə, SLA-ya, marşrut icrasına və ya menecer məsuliyyətinə təsir edə bilər."
    if (locale === "ru") return "Высокий риск, потому что может повлиять на выручку, SLA, исполнение маршрутов или ответственность менеджера."
  }
  if (basis === "Medium because the signal needs review before it becomes operational debt.") {
    if (locale === "az") return "Orta riskdir, çünki əməliyyat borcuna çevrilməzdən əvvəl baxılmalıdır."
    if (locale === "ru") return "Средний риск, потому что сигнал нужно разобрать до того, как он станет операционным долгом."
  }
  if (basis === "Low because the recommendation is informational or low blast-radius.") {
    if (locale === "az") return "Aşağı riskdir, çünki tövsiyə məlumat xarakterlidir və təsir sahəsi kiçikdir."
    if (locale === "ru") return "Низкий риск, потому что рекомендация информационная или с малой зоной влияния."
  }
  return advisorActionDescriptionFor(locale, basis)
}

function advisorPreviewTextFor(locale: string, text: string) {
  const task = text.match(/^Task: (.+)$/i)
  if (task) {
    if (locale === "az") return `Tapşırıq: ${task[1]}`
    if (locale === "ru") return `Задача: ${task[1]}`
  }
  const notification = text.match(/^Notification: (.+)$/i)
  if (notification) {
    if (locale === "az") return `Bildiriş: ${notification[1]}`
    if (locale === "ru") return `Уведомление: ${notification[1]}`
  }
  const note = text.match(/^Note: (.+)$/i)
  if (note) {
    if (locale === "az") return `Qeyd: ${note[1]}`
    if (locale === "ru") return `Заметка: ${note[1]}`
  }
  const draft = text.match(/^Draft task\/reminder: (.+)$/i)
  if (draft) {
    if (locale === "az") return `Tapşırıq/xatırlatma qaralaması: ${draft[1]}`
    if (locale === "ru") return `Черновик задачи/напоминания: ${draft[1]}`
  }
  const ownerUpdate = text.match(/^Update owner assignment on ([^:]+):(.+)$/i)
  if (ownerUpdate) {
    const entity = advisorEntityTypeLabelFor(locale, ownerUpdate[1])
    if (locale === "az") return `${entity} üzrə sahib təyinatını yenilə: ${ownerUpdate[2]}`
    if (locale === "ru") return `Обновить владельца для ${entity}: ${ownerUpdate[2]}`
  }
  const priorityUpdate = text.match(/^Update priority on ([^:]+):(.+)$/i)
  if (priorityUpdate) {
    const entity = advisorEntityTypeLabelFor(locale, priorityUpdate[1])
    if (locale === "az") return `${entity} üzrə prioriteti yenilə: ${priorityUpdate[2]}`
    if (locale === "ru") return `Обновить приоритет для ${entity}: ${priorityUpdate[2]}`
  }
  if (text === "In-app notification to responsible managers") {
    if (locale === "az") return "Məsul menecerlərə daxili bildiriş"
    if (locale === "ru") return "Внутреннее уведомление ответственным менеджерам"
  }
  if (text === "No external message is sent automatically; Advisor prepares an internal task/draft for approval.") {
    if (locale === "az") return "Xarici mesaj avtomatik göndərilmir; Advisor təsdiq üçün daxili tapşırıq/qaralama hazırlayır."
    if (locale === "ru") return "Внешнее сообщение автоматически не отправляется; Advisor готовит внутреннюю задачу/черновик на согласование."
  }
  if (text === "No execution is prepared for this read-only signal.") {
    if (locale === "az") return "Yalnız baxış üçün olan bu siqnalda icra hazırlanmayıb."
    if (locale === "ru") return "Для этого сигнала только для просмотра действие не подготовлено."
  }
  if (text === "This update changes an existing record and requires manual rollback from the record history if approved.") {
    if (locale === "az") return "Bu dəyişiklik mövcud qeydi yeniləyir; təsdiqlənsə, geri dönüş qeyd tarixçəsindən əl ilə edilməlidir."
    if (locale === "ru") return "Это изменение обновляет существующую запись; после согласования откат выполняется вручную из истории записи."
  }
  if (text === "This action creates an internal task, note, alert or draft. Rollback is low-risk because the created object can be closed, dismissed or deleted.") {
    if (locale === "az") return "Bu əməliyyat daxili tapşırıq, qeyd, xəbərdarlıq və ya qaralama yaradır. Obyekt bağlana, rədd edilə və ya silinə bildiyi üçün geri dönüş riski aşağıdır."
    if (locale === "ru") return "Это действие создает внутреннюю задачу, заметку, уведомление или черновик. Откат низкорисковый: созданный объект можно закрыть, отклонить или удалить."
  }
  if (text === "Open the linked source record.") {
    if (locale === "az") return "Əlaqəli mənbə qeydini açın."
    if (locale === "ru") return "Откройте связанную исходную запись."
  }
  if (text === "Review the Advisor audit entry.") {
    if (locale === "az") return "Advisor audit qeydini yoxlayın."
    if (locale === "ru") return "Проверьте запись аудита Advisor."
  }
  if (text === "Restore the previous owner or priority if needed.") {
    if (locale === "az") return "Lazımdırsa əvvəlki sahibi və ya prioriteti bərpa edin."
    if (locale === "ru") return "При необходимости восстановите прежнего владельца или приоритет."
  }
  if (text === "Open the created Advisor task/note/alert.") {
    if (locale === "az") return "Yaradılmış Advisor tapşırığını/qeydini/xəbərdarlığını açın."
    if (locale === "ru") return "Откройте созданную Advisor задачу, заметку или уведомление."
  }
  if (text === "Close or delete it if the approval was wrong.") {
    if (locale === "az") return "Təsdiq səhv idisə onu bağlayın və ya silin."
    if (locale === "ru") return "Закройте или удалите объект, если согласование было ошибочным."
  }
  if (text === "Keep the approval/audit trail for traceability.") {
    if (locale === "az") return "İzlənə bilməsi üçün təsdiq/audit tarixçəsini saxlayın."
    if (locale === "ru") return "Сохраните цепочку согласования и аудита для прослеживаемости."
  }
  return advisorActionDescriptionFor(locale, advisorFormattedValueFor(locale, text))
}

function advisorDisplayTextFor(locale: string, text: string) {
  const normalized = text.trim().toLowerCase()
  if (normalized === "deal") {
    if (locale === "az") return "sövdələşmə"
    if (locale === "ru") return "сделка"
  }
  if (normalized === "company") {
    if (locale === "az") return "şirkət"
    if (locale === "ru") return "компания"
  }
  if (normalized === "contact") {
    if (locale === "az") return "kontakt"
    if (locale === "ru") return "контакт"
  }
  if (normalized === "invoice") {
    if (locale === "az") return "faktura"
    if (locale === "ru") return "счет"
  }
  const title = advisorSignalTitleTextFor(locale, text)
  if (title !== text) return title
  const summary = advisorSignalSummaryTextFor(locale, text)
  if (summary !== text) return summary
  const actionDescription = advisorActionDescriptionFor(locale, text)
  if (actionDescription !== text) return actionDescription
  return advisorPreviewTextFor(locale, text)
}

function advisorAnswerTextFor(locale: string, answer: AdvisorAnswer) {
  if (answer.signals.length === 0) return advisorDisplayTextFor(locale, answer.answer)
  const matched = answer.scope.returnedSignals || answer.signals.length
  const top = answer.signals
    .slice(0, 3)
    .map((signal, index) => `${index + 1}. ${advisorSignalTitleFor(locale, signal)}`)
    .join("\n")

  if (locale === "az") {
    return `${matched} risk tapıldı.\nƏvvəl bunlara baxın:\n${top}`
  }
  if (locale === "ru") {
    return `Найдено рисков: ${matched}.\nСначала проверьте:\n${top}`
  }
  return `Found ${matched} matching risk${matched === 1 ? "" : "s"}.\nReview first:\n${top}`
}

function advisorRollbackModeFor(locale: string, mode: NonNullable<AdvisorSignal["rollbackPreview"]>["mode"]) {
  if (mode === "automatic") {
    if (locale === "az") return "avtomatik"
    if (locale === "ru") return "автоматический"
  }
  if (mode === "manual") {
    if (locale === "az") return "əl ilə"
    if (locale === "ru") return "ручной"
  }
  if (mode === "not_required") {
    if (locale === "az") return "tələb olunmur"
    if (locale === "ru") return "не требуется"
  }
  return mode
}

function advisorRouteSourceLabelFor(locale: string, entityType: string) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<string, Record<"en" | "ru" | "az", string>> = {
    mtm_route: { en: "Route", ru: "Маршрут", az: "Marşrut" },
    mtm_visit: { en: "Visit", ru: "Визит", az: "Vizit" },
    mtm_photo: { en: "Photo", ru: "Фото", az: "Foto" },
    mtm_order: { en: "Order", ru: "Заказ", az: "Sifariş" },
  }
  return labels[entityType]?.[lang] || (lang === "ru" ? "Источник" : lang === "az" ? "Mənbə" : "Source")
}

function advisorFactLabelFor(locale: string, fact: AdvisorSignal["facts"][number]) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<string, Record<"en" | "ru" | "az", string>> = {
    Stage: { en: "Stage", ru: "Этап", az: "Mərhələ" },
    Status: { en: "Status", ru: "Статус", az: "Status" },
    Customer: { en: "Customer", ru: "Клиент", az: "Müştəri" },
    Company: { en: "Company", ru: "Компания", az: "Şirkət" },
    "Idle days": { en: "Idle days", ru: "Дней без движения", az: "Hərəkətsiz günlər" },
    Probability: { en: "Probability", ru: "Вероятность", az: "Ehtimal" },
    Value: { en: "Value", ru: "Сумма", az: "Dəyər" },
    Amount: { en: "Amount", ru: "Сумма", az: "Məbləğ" },
    "Valid until": { en: "Valid until", ru: "Действует до", az: "Etibarlıdır" },
    Email: { en: "Email", ru: "Email", az: "Email" },
    "Stage age": { en: "Stage age", ru: "Возраст этапа", az: "Mərhələ yaşı" },
    "Expected close": { en: "Expected close", ru: "Ожидаемое закрытие", az: "Gözlənilən bağlanış" },
    "Repeated tickets": { en: "Repeated tickets", ru: "Повторные тикеты", az: "Təkrarlanan tiketlər" },
  }
  return labels[fact.label]?.[lang] || fact.label
}

function advisorFactValueFor(locale: string, fact: AdvisorSignal["facts"][number]) {
  if (fact.label === "Status") return advisorStatusLabelFor(locale, fact.value)
  if (fact.value.toLowerCase() === "overdue") {
    if (locale === "az") return "gecikib"
    if (locale === "ru") return "просрочено"
  }
  return advisorFormattedValueFor(locale, fact.value)
}

function advisorEntityTypeLabelFor(locale: string, entityType: string) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<string, Record<"en" | "ru" | "az", string>> = {
    quote: { en: "quote", ru: "коммерческого предложения", az: "təklif" },
    offer: { en: "offer", ru: "предложения", az: "təklif" },
    deal: { en: "deal", ru: "сделки", az: "sövdələşmə" },
    task: { en: "task", ru: "задачи", az: "tapşırıq" },
    invoice: { en: "invoice", ru: "счета", az: "faktura" },
    bill: { en: "bill", ru: "счета к оплате", az: "ödəniş hesabı" },
    ticket: { en: "ticket", ru: "тикета", az: "tiket" },
  }
  return labels[entityType]?.[lang] || entityType
}

function advisorMetricLabelFor(locale: string, metricLabel: string) {
  const label = metricLabel.toLowerCase()
  if (label === "money at risk") {
    if (locale === "az") return "Risk altında məbləğ"
    if (locale === "ru") return "Деньги под риском"
  }
  if (label === "idle days") {
    if (locale === "az") return "Hərəkətsiz günlər"
    if (locale === "ru") return "Дней без движения"
  }
  return metricLabel
}

function advisorTimelineLabelFor(locale: string, label: string) {
  const lang = locale === "az" ? "az" : locale === "ru" ? "ru" : "en"
  const labels: Record<string, Record<"en" | "ru" | "az", string>> = {
    "Source observed": { en: "Source observed", ru: "Источник прочитан", az: "Mənbə oxundu" },
    "Signal detected": { en: "Signal detected", ru: "Сигнал найден", az: "Siqnal tapıldı" },
    "Impact measured": { en: "Impact measured", ru: "Влияние рассчитано", az: "Təsir hesablandı" },
    "Safe action prepared": { en: "Safe action prepared", ru: "Безопасное действие подготовлено", az: "Təhlükəsiz əməliyyat hazırlandı" },
  }
  return labels[label]?.[lang] || label
}

function advisorTimelineDescriptionFor(
  locale: string,
  event: NonNullable<AdvisorSignal["timeline"]>[number],
  signal: AdvisorSignal,
  copy: (typeof COPY)["en"],
) {
  if (event.label === "Source observed") {
    const source = event.source
    if (source) {
      const entity = advisorEntityTypeLabelFor(locale, source.entityType)
      if (locale === "az") return `${source.label} ${entity} mənbəsindən oxundu.`
      if (locale === "ru") return `${source.label} прочитан из ${entity}.`
    }
    const entity = advisorEntityTypeLabelFor(locale, signal.entityType)
    if (locale === "az") return `${entity} ${signal.entityId} Advisor toplayıcısı tərəfindən oxundu.`
    if (locale === "ru") return `${entity} ${signal.entityId} прочитан сборщиком Advisor.`
  }
  if (event.label === "Signal detected") return advisorSignalSummaryFor(locale, signal)
  if (event.label === "Impact measured") {
    const metric = signal.metric
    if (metric) return `${advisorMetricLabelFor(locale, metric.label)}: ${advisorFormattedValueFor(locale, metric.formatted)}.`
  }
  if (event.label === "Safe action prepared") {
    const action = signal.recommendedActions[0]
    if (action) {
      const actionText = advisorActionLabelFor(locale, action, copy)
      if (locale === "az") return `${actionText} hazırlanıb və icradan əvvəl təsdiq tələb edir.`
      if (locale === "ru") return `${actionText} подготовлено и требует согласования перед выполнением.`
    }
  }
  const localizedDescription = advisorActionDescriptionFor(locale, event.description)
  if (localizedDescription !== event.description) return localizedDescription
  return advisorSignalSummaryFor(locale, { ...signal, summary: event.description })
}

function signalText(signal: AdvisorSignal) {
  return [
    signal.title,
    signal.summary,
    signal.domainLabel,
    signal.ownerLabel,
    ...signal.facts.map((factItem) => `${factItem.label} ${factItem.value}`),
  ].filter(Boolean).join(" ").toLowerCase()
}

function matchesCommandFilter(signal: AdvisorSignal, filter: AdvisorCommandFilter) {
  if (filter === "all") return true
  if (filter === "money") return (signal.amount || 0) > 0 || ["finance", "sales", "contracts"].includes(signal.domain)
  if (filter === "routes") return signal.domain === "routes" || signal.domain === "mtm"
  if (filter === "sla") return signal.domain === "support" && signalText(signal).includes("sla")
  if (filter === "overdue") return /overdue|due|просроч|gecik/i.test(signalText(signal))
  if (filter === "unassigned") return !signal.ownerId && !signal.ownerLabel
  return signal.severity === "critical"
}

// A signal's owner "key": the display NAME when it's a real name (not a bare
// numeric id — which used to leak in as chips like "1"/"5" — and not empty),
// otherwise a single "unassigned" bucket. Used for BOTH the owner filter chips
// and the owner filter itself so they stay in sync (and name-less owners no
// longer show as numbers or produce duplicate "Sahibsiz" chips).
function ownerKeyOf(signal: AdvisorSignal) {
  const name = (signal.ownerLabel || "").trim()
  return name.length > 0 && !/^\d+$/.test(name) ? name : "unassigned"
}

const ADVISOR_SCENARIO_KEYS: AdvisorScenarioKey[] = ["money", "sales", "tasks", "support", "contracts", "routes", "kpi", "marketing"]

function signalsForScenario(key: AdvisorScenarioKey, signals: AdvisorSignal[]) {
  if (key === "money") return signals.filter((signal) => (signal.amount || 0) > 0 || ["finance", "sales", "contracts"].includes(signal.domain))
  if (key === "sales") return signals.filter((signal) => signal.domain === "sales" || signal.domain === "crm")
  if (key === "tasks") return signals.filter((signal) => signal.domain === "tasks")
  if (key === "support") return signals.filter((signal) => signal.domain === "support")
  if (key === "contracts") return signals.filter((signal) => signal.domain === "contracts")
  if (key === "routes") return signals.filter((signal) => signal.domain === "routes" || signal.domain === "mtm")
  if (key === "kpi") return signals.filter((signal) => signal.domain === "kpi")
  return signals.filter((signal) => signal.domain === "marketing")
}

function scenarioAskFilter(key: AdvisorScenarioKey): AdvisorAskFilter {
  if (key === "money") return "money"
  if (key === "routes") return "routes"
  if (key === "support") return "support"
  if (key === "kpi") return "kpi"
  if (key === "sales") return "sales"
  if (key === "tasks") return "tasks"
  if (key === "contracts") return "contracts"
  return "marketing"
}

function scenarioDomain(key: AdvisorScenarioKey): "all" | AdvisorDomainKey {
  if (key === "tasks" || key === "support" || key === "contracts" || key === "kpi" || key === "marketing") return key
  return "all"
}

function scenarioCommandFilter(key: AdvisorScenarioKey): AdvisorCommandFilter {
  if (key === "money") return "money"
  if (key === "routes") return "routes"
  return "all"
}

function scenarioTone(key: AdvisorScenarioKey): AdvisorScenarioItem["tone"] {
  if (key === "money") return "money"
  if (key === "support" || key === "tasks") return "critical"
  if (key === "kpi") return "healthy"
  return "info"
}

function scenarioLabel(copy: (typeof COPY)["en"], key: AdvisorScenarioKey) {
  const labels: Record<AdvisorScenarioKey, { label: string; description: string; question: string }> = {
    money: { label: copy.scenarioMoney, description: copy.scenarioMoneyDesc, question: copy.moneyRisk },
    sales: { label: copy.scenarioSales, description: copy.scenarioSalesDesc, question: copy.salesRisk },
    tasks: { label: copy.scenarioTasks, description: copy.scenarioTasksDesc, question: copy.taskRisk },
    support: { label: copy.scenarioSupport, description: copy.scenarioSupportDesc, question: copy.supportRisk },
    contracts: { label: copy.scenarioContracts, description: copy.scenarioContractsDesc, question: copy.contractRisk },
    routes: { label: copy.scenarioRoutes, description: copy.scenarioRoutesDesc, question: copy.routeRisk },
    kpi: { label: copy.scenarioKpi, description: copy.scenarioKpiDesc, question: copy.managerRisk },
    marketing: { label: copy.scenarioMarketing, description: copy.scenarioMarketingDesc, question: copy.marketingRisk },
  }
  return labels[key]
}

function buildAdvisorScenarios(signals: AdvisorSignal[], copy: (typeof COPY)["en"], locale: string): AdvisorScenarioItem[] {
  return ADVISOR_SCENARIO_KEYS.map((key) => {
    const scenarioSignals = signalsForScenario(key, signals)
    const moneyAtRisk = scenarioSignals.reduce((sum, signal) => sum + (signal.amount || 0), 0)
    const label = scenarioLabel(copy, key)
    return {
      key,
      label: label.label,
      description: label.description,
      count: scenarioSignals.length,
      value: key === "money" && moneyAtRisk > 0 ? formatMoney(moneyAtRisk, scenarioSignals[0]?.currency || "AZN") : String(scenarioSignals.length),
      detail: scenarioSignals[0] ? advisorSignalTitleFor(locale, scenarioSignals[0]) : undefined,
      tone: scenarioTone(key),
    }
  })
}

function buildAdvisorBriefing(signals: AdvisorSignal[], copy: (typeof COPY)["en"], locale: string): AdvisorBriefingItem[] {
  const items: AdvisorBriefingItem[] = []
  const criticalSignals = signals.filter((signal) => signal.severity === "critical" || signal.severity === "high")
  const moneySignals = signals.filter((signal) => (signal.amount || 0) > 0)
  const routeSignals = signals.filter((signal) => signal.domain === "routes" || signal.domain === "mtm")
  const slaSignals = signals.filter((signal) => signal.domain === "support" && signalText(signal).includes("sla"))
  const kpiSignals = signals.filter((signal) => signal.domain === "kpi")
  const moneyAtRisk = moneySignals.reduce((sum, signal) => sum + (signal.amount || 0), 0)

  if (criticalSignals.length > 0) {
    items.push({
      key: "critical",
      label: copy.briefingCritical,
      value: String(criticalSignals.length),
      detail: advisorSignalTitleFor(locale, criticalSignals[0]),
      signalId: criticalSignals[0].id,
      tone: "critical",
    })
  }
  if (moneyAtRisk > 0) {
    items.push({
      key: "money",
      label: copy.briefingMoney,
      value: formatMoney(moneyAtRisk, moneySignals[0]?.currency || "AZN"),
      detail: moneySignals[0] ? advisorSignalTitleFor(locale, moneySignals[0]) : copy.revenueAtRisk,
      signalId: moneySignals[0]?.id,
      tone: "money",
    })
  }
  if (routeSignals.length > 0) {
    items.push({
      key: "routes",
      label: copy.briefingRoutes,
      value: String(routeSignals.length),
      detail: advisorSignalTitleFor(locale, routeSignals[0]),
      signalId: routeSignals[0].id,
      tone: "info",
    })
  }
  if (slaSignals.length > 0) {
    items.push({
      key: "sla",
      label: copy.briefingSla,
      value: String(slaSignals.length),
      detail: advisorSignalTitleFor(locale, slaSignals[0]),
      signalId: slaSignals[0].id,
      tone: "critical",
    })
  }
  if (kpiSignals.length > 0) {
    items.push({
      key: "kpi",
      label: copy.briefingKpi,
      value: String(kpiSignals.length),
      detail: advisorSignalTitleFor(locale, kpiSignals[0]),
      signalId: kpiSignals[0].id,
      tone: "healthy",
    })
  }
  return items.slice(0, 5)
}

function signalRelationKeys(signal: AdvisorSignal) {
  const keys = new Set<string>([`${signal.entityType}:${signal.entityId}`])
  for (const sourceRef of signal.sources) {
    keys.add(`${sourceRef.entityType}:${sourceRef.entityId}`)
  }
  for (const action of signal.recommendedActions) {
    const relatedType = action.payload.relatedType
    const relatedId = action.payload.relatedId
    if (typeof relatedType === "string" && typeof relatedId === "string") {
      keys.add(`${relatedType}:${relatedId}`)
    }
  }
  return keys
}

function relatedSignalScore(baseKeys: Set<string>, signal: AdvisorSignal) {
  let score = 0
  for (const key of signalRelationKeys(signal)) {
    if (baseKeys.has(key)) score += 1
  }
  return score
}

function buildRelatedSignalChain(signal: AdvisorSignal, signals: AdvisorSignal[]) {
  const baseKeys = signalRelationKeys(signal)
  return signals
    .filter((candidate) => candidate.id !== signal.id)
    .map((candidate) => ({
      signal: candidate,
      score: relatedSignalScore(baseKeys, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || severityRankForUi(b.signal.severity) - severityRankForUi(a.signal.severity))
    .slice(0, 4)
    .map((item) => item.signal)
}

function severityRankForUi(severity: AdvisorSignal["severity"]) {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === "input" || tagName === "textarea" || target.isContentEditable
}

async function fetchJsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return data as T
}

export default function AiActionsPage() {
  const { data: session } = useSession()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const copy = useCopy()
  useAutoTour("aiActions")
  const commandInputRef = useRef<HTMLInputElement>(null)
  const signalSearchRef = useRef<HTMLInputElement>(null)
  const advisorTabsRef = useRef<HTMLDivElement>(null)

  const user = session?.user as { organizationId?: string } | undefined
  const orgId = user?.organizationId
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (orgId) headers["x-organization-id"] = orgId

  const [advisor, setAdvisor] = useState<AdvisorPayload | null>(null)
  const [pending, setPending] = useState<ShadowAction[]>([])
  const [history, setHistory] = useState<ShadowAction[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [activeTab, setActiveTab] = useState<AdvisorTab>(() => parseAdvisorTab(searchParams.get("tab")))
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("signal"))
  const [query, setQuery] = useState("")
  const [askFilter, setAskFilter] = useState<AdvisorAskFilter>("all")
  const [selectedDomain, setSelectedDomain] = useState<"all" | AdvisorDomainKey>(() => parseAdvisorDomain(searchParams.get("domain")))
  const [selectedOwner, setSelectedOwner] = useState(() => searchParams.get("owner") || "all")
  const [queueingKey, setQueueingKey] = useState<string | null>(null)
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [askQuestion, setAskQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<AdvisorAnswer | null>(null)
  const [asking, setAsking] = useState(false)
  const [dateScope, setDateScope] = useState<AdvisorDateScope>(() => parseAdvisorDateScope(searchParams.get("scope")))
  const [commandFilter, setCommandFilter] = useState<AdvisorCommandFilter>("all")

  const dateScopedSignals = useMemo(() => {
    return (advisor?.signals || []).filter((signal) => matchesAdvisorDateScope(signal, dateScope, nowMs))
  }, [advisor?.signals, dateScope, nowMs])
  const scenarioItems = useMemo(() => buildAdvisorScenarios(dateScopedSignals, copy, locale), [copy, dateScopedSignals, locale])

  useEffect(() => {
    if (!advisor) return
    const signals = advisor.signals || []

    if (selectedDomain !== "all" && !signals.some((signal) => signal.domain === selectedDomain)) {
      setSelectedDomain("all")
    }
    if (selectedOwner !== "all" && !signals.some((signal) => ownerKeyOf(signal) === selectedOwner)) {
      setSelectedOwner("all")
    }
    if (selectedId && !signals.some((signal) => signal.id === selectedId)) {
      setSelectedId(null)
    }
  }, [advisor, selectedDomain, selectedId, selectedOwner])

  const visibleSignals = useMemo(() => {
    let list = dateScopedSignals
    list = list.filter((signal) => matchesCommandFilter(signal, commandFilter))
    if (selectedDomain !== "all") list = list.filter((signal) => signal.domain === selectedDomain)
    if (selectedOwner !== "all") list = list.filter((signal) => ownerKeyOf(signal) === selectedOwner)
    if (askFilter === "money") list = list.filter((signal) => (signal.amount || 0) > 0 || signal.domain === "finance" || signal.domain === "sales" || signal.domain === "contracts")
    if (askFilter === "sales") list = list.filter((signal) => signal.domain === "sales" || signal.domain === "crm")
    if (askFilter === "tasks") list = list.filter((signal) => signal.domain === "tasks")
    if (askFilter === "contracts") list = list.filter((signal) => signal.domain === "contracts")
    if (askFilter === "marketing") list = list.filter((signal) => signal.domain === "marketing")
    if (askFilter === "routes") list = list.filter((signal) => signal.domain === "routes" || signal.domain === "mtm")
    if (askFilter === "support") list = list.filter((signal) => signal.domain === "support")
    if (askFilter === "kpi") list = list.filter((signal) => signal.domain === "kpi")
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((signal) => signalText(signal).includes(q))
    }
    return list
  }, [askFilter, commandFilter, dateScopedSignals, query, selectedDomain, selectedOwner])

  const selectedSignal = useMemo(() => {
    if (!visibleSignals.length) return null
    return visibleSignals.find((signal) => signal.id === selectedId) || visibleSignals[0]
  }, [selectedId, visibleSignals])
  const selectedRelatedSignals = useMemo(() => {
    return selectedSignal ? buildRelatedSignalChain(selectedSignal, visibleSignals) : []
  }, [selectedSignal, visibleSignals])
  const briefingItems = useMemo(() => buildAdvisorBriefing(visibleSignals, copy, locale), [copy, locale, visibleSignals])
  const askMatchedSignals = useMemo(() => {
    return askAnswer?.signals?.length ? askAnswer.signals : visibleSignals.slice(0, 8)
  }, [askAnswer?.signals, visibleSignals])
  const localizedAskAnswer = useMemo(() => {
    return askAnswer ? { ...askAnswer, answer: advisorAnswerTextFor(locale, askAnswer) } : null
  }, [askAnswer, locale])

  useEffect(() => {
    if (!visibleSignals.length) return
    if (!selectedId || !visibleSignals.some((signal) => signal.id === selectedId)) {
      setSelectedId(visibleSignals[0].id)
    }
  }, [selectedId, visibleSignals])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const setParam = (key: string, value: string | null) => {
      if (value) params.set(key, value)
      else params.delete(key)
    }

    setParam("tab", activeTab === "today" ? null : activeTab)
    setParam("domain", selectedDomain === "all" ? null : selectedDomain)
    setParam("owner", selectedOwner === "all" ? null : selectedOwner)
    setParam("scope", dateScope === "active" ? null : dateScope)
    setParam("signal", selectedId)

    const nextQuery = params.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery !== currentQuery) {
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false })
    }
  }, [activeTab, dateScope, pathname, router, searchParams, selectedDomain, selectedId, selectedOwner])

  const domainOptions = useMemo(() => {
    const counts = new Map<AdvisorDomainKey, number>()
    for (const signal of advisor?.signals || []) counts.set(signal.domain, (counts.get(signal.domain) || 0) + 1)
    return Array.from(counts.entries()).map(([key, count]) => ({
      key,
      count,
      label: advisor?.capabilities.find((capability) => capability.key === key)?.label || key,
    })).sort((a, b) => b.count - a.count)
  }, [advisor?.capabilities, advisor?.signals])

  const ownerOptions = useMemo(() => {
    const owners = new Map<string, { label: string; count: number }>()
    for (const signal of advisor?.signals || []) {
      // Key MUST match the owner filter (ownerKeyOf, used in visibleSignals):
      // a real owner keys by its display NAME; everyone without a real name
      // (empty, or a bare numeric id that used to leak in as "1"/"5" chips)
      // collapses into a single "unassigned" bucket instead of many "Sahibsiz".
      const key = ownerKeyOf(signal)
      const label = key === "unassigned" ? copy.unassigned : key
      const current = owners.get(key)
      owners.set(key, { label, count: (current?.count || 0) + 1 })
    }
    return Array.from(owners.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [advisor?.signals, copy.unassigned])

  const hasInFlightActions = useMemo(() => {
    return history.some((action) => {
      const status = action.executionStatus || "queued"
      return action.approved === true && ["queued", "approved", "pending", "executing"].includes(status)
    })
  }, [history])
  const executionTrailActions = useMemo(() => {
    return history.filter((action) => action.approved === true || action.executionStatus === "executing" || action.executionStatus === "failed")
  }, [history])
  const staleData = isAdvisorDataStale(lastRefreshedAt, nowMs)
  const activeModuleCount = advisor?.capabilities.filter((capability) => capability.status === "active").length || 0
  const failedExecutionCount = history.filter((action) => action.executionStatus === "failed").length

  const load = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    try {
      const [advisorRes, pendingRes, historyRes] = await Promise.all([
        fetch("/api/v1/ai/advisor/signals", { headers }).then((r) => r.json()).catch(() => null),
        fetch("/api/v1/ai-shadow-actions?status=pending&limit=50", { headers }).then((r) => r.json()).catch(() => null),
        fetch("/api/v1/ai-shadow-actions?status=reviewed&limit=40", { headers }).then((r) => r.json()).catch(() => null),
      ])
      if (advisorRes?.data) {
        setAdvisor(advisorRes.data)
        setSelectedId((current) => current || advisorRes.data.signals?.[0]?.id || null)
      }
      setPending(pendingRes?.data || [])
      setHistory((historyRes?.data || []).sort((a: ShadowAction, b: ShadowAction) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime()))
      const refreshedAt = new Date().toISOString()
      setLastRefreshedAt(refreshedAt)
      if (typeof window !== "undefined") localStorage.setItem("aiActionsLastSeen", refreshedAt)
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (!hasInFlightActions) return
    const interval = window.setInterval(() => {
      void load({ silent: true })
    }, 15000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInFlightActions, orgId])

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(interval)
  }, [])

  const reviewAction = async (action: ShadowAction, decision: "approve" | "reject") => {
    const previousPending = pending
    setPending((items) => items.filter((item) => item.id !== action.id))
    try {
      await fetchJsonOrThrow<{ data: ShadowAction }>("/api/v1/ai-shadow-actions", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ actionId: action.id, decision }),
      })
      toast(decision === "approve" ? copy.approved : copy.rejected, { description: actionTitle(action) })
      await load()
    } catch (error) {
      setPending(previousPending)
      toast(copy.actionFailed, { description: error instanceof Error ? error.message : actionTitle(action) })
      await load()
    }
  }

  const startEditAction = (action: ShadowAction) => {
    setEditingActionId(action.id)
    setEditDraft(JSON.stringify(action.payload || {}, null, 2))
  }

  const updateEditDraftField = (key: string, value: string) => {
    setEditDraft((draft) => updateDraftPayloadField(draft, key, value))
  }

  const saveEditedAction = async (action: ShadowAction) => {
    const editedPayload = parseDraftPayload(editDraft)
    if (!editedPayload) {
      toast(copy.invalidJson)
      return
    }
    try {
      await fetchJsonOrThrow<{ data: ShadowAction }>("/api/v1/ai-shadow-actions", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ actionId: action.id, decision: "edit", editedPayload }),
      })
      setEditingActionId(null)
      setEditDraft("")
      await load()
    } catch (error) {
      toast(copy.editFailed, { description: error instanceof Error ? error.message : actionTitle(action) })
    }
  }

  const scrollToTodaySection = () => {
    if (typeof window === "undefined") return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        advisorTabsRef.current?.scrollIntoView({ behavior, block: "start" })
      })
    })
  }

  const selectSignal = (signalId: string, options: { openDetailOnSmall?: boolean } = {}) => {
    setSelectedId(signalId)
    if (
      options.openDetailOnSmall &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      setActiveTab("detail")
    }
  }

  useEffect(() => {
    const handleAdvisorKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "/" && !isTextEditingTarget(event.target)) {
        event.preventDefault()
        commandInputRef.current?.focus()
        commandInputRef.current?.select()
        return
      }
      if (isTextEditingTarget(event.target)) return
      if (activeTab !== "today" || visibleSignals.length === 0) return

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const currentIndex = Math.max(0, visibleSignals.findIndex((signal) => signal.id === selectedId))
        const direction = event.key === "ArrowDown" ? 1 : -1
        const nextIndex = (currentIndex + direction + visibleSignals.length) % visibleSignals.length
        setSelectedId(visibleSignals[nextIndex].id)
      }

      if (event.key === "Enter" && selectedSignal) {
        event.preventDefault()
        setSelectedId(selectedSignal.id)
        if (window.matchMedia("(max-width: 767px)").matches) {
          setActiveTab("detail")
        }
      }
    }

    window.addEventListener("keydown", handleAdvisorKeyboard)
    return () => window.removeEventListener("keydown", handleAdvisorKeyboard)
  }, [activeTab, selectedId, selectedSignal, visibleSignals])

  const queueRecommendedAction = async (signal: AdvisorSignal, action: AdvisorAction) => {
    const key = `${signal.id}:${action.actionType}`
    const actionText = advisorActionLabelFor(locale, action, copy)
    setQueueingKey(key)
    try {
      const res = await fetchJsonOrThrow<{ data?: ShadowAction }>("/api/v1/ai/advisor/actions", {
        method: "POST",
        headers,
        body: JSON.stringify({ signal, action }),
      })
      const queuedAction = res?.data
      if (queuedAction) {
        setPending((items) => items.some((item) => item.id === queuedAction.id) ? items : [queuedAction, ...items])
        toast(copy.queued, { description: actionText })
        await load({ silent: true })
      }
    } catch (error) {
      toast(copy.queueFailed, { description: error instanceof Error ? error.message : actionText })
    } finally {
      setQueueingKey(null)
    }
  }

  const askAdvisor = async (question = askQuestion) => {
    const text = question.trim()
    if (!text) return
    setAskQuestion(text)
    setAsking(true)
    try {
      const res = await fetchJsonOrThrow<{ data?: AdvisorAnswer }>("/api/v1/ai/advisor/query", {
        method: "POST",
        headers,
        body: JSON.stringify({ question: text, locale }),
      })
      if (res?.data) {
        setAskAnswer(res.data)
        setAskFilter(toAskFilter(res.data.intent))
        setSelectedId(res.data.signals?.[0]?.id || selectedId)
      }
    } catch (error) {
      toast(copy.askFailed, { description: error instanceof Error ? error.message : text })
    } finally {
      setAsking(false)
    }
  }

  const selectAdvisorScenario = (key: string) => {
    if (!ADVISOR_SCENARIO_KEYS.includes(key as AdvisorScenarioKey)) return
    const scenarioKey = key as AdvisorScenarioKey
    const matches = signalsForScenario(scenarioKey, dateScopedSignals)
    const label = scenarioLabel(copy, scenarioKey)
    setAskFilter(scenarioAskFilter(scenarioKey))
    setCommandFilter(scenarioCommandFilter(scenarioKey))
    setSelectedDomain(scenarioDomain(scenarioKey))
    setSelectedOwner("all")
    setQuery("")
    setAskQuestion(label.question)
    if (matches[0]?.id) setSelectedId(matches[0].id)
    setActiveTab("ask")
    void askAdvisor(label.question)
  }

  return (
    <div className="space-y-5" data-advisor-loaded={loading ? "false" : "true"}>
      <section className="overflow-hidden rounded-2xl border border-orange-100/80 bg-[radial-gradient(circle_at_top_left,rgba(244,81,8,0.14),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,247,237,0.76),rgba(255,255,255,0.98))] p-4 shadow-sm dark:border-orange-900/40 dark:bg-card sm:p-5" data-tour-id="ai-actions-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-orange-200 bg-white/80 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300">
                <Sparkles className="h-3.5 w-3.5" />
                {copy.flow}
              </Badge>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {copy.approvalRequired}
              </Badge>
              <Badge variant="outline" className="border-zinc-200 bg-white/70 text-muted-foreground dark:border-zinc-800 dark:bg-zinc-950/40">
                <Inbox className="h-3.5 w-3.5" />
                {advisor?.overview.pendingActions ?? pending.length} {copy.pendingActions.toLowerCase()}
              </Badge>
            </div>
            <h1 className="flex flex-wrap items-center gap-2 text-3xl font-semibold leading-tight tracking-normal text-foreground">
              <Sparkles className="h-7 w-7 text-orange-600 dark:text-orange-300" />
              {copy.title}
              <TourReplayButton tourId="aiActions" />
              <HelpButton slug="ai-actions" variant="label" />
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
          </div>
          <div className="w-full rounded-xl border border-white/70 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/45 sm:w-auto sm:min-w-[230px]">
            <div className="flex flex-wrap items-center justify-between gap-3 sm:block">
              <div className="text-xs text-muted-foreground">
                <p>{copy.lastUpdated}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {staleData ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                      <Clock3 className="h-3 w-3" />
                      {copy.staleData}
                    </Badge>
                  ) : null}
                  <p className="text-base font-semibold text-foreground tabular-nums">{lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : copy.neverUpdated}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {copy.refresh}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div data-tour-id="ai-actions-kpis">
        <AdvisorKpiStrip
          tiles={[
            { key: "total", icon: <AlertTriangle className="h-4 w-4" />, label: copy.totalRisks, value: advisor?.overview.totalSignals ?? 0 },
            { key: "critical", icon: <ShieldCheck className="h-4 w-4" />, label: copy.critical, value: advisor?.overview.critical ?? 0, tone: "critical" },
            { key: "money", icon: <BarChart3 className="h-4 w-4" />, label: copy.revenueAtRisk, value: formatMoney(advisor?.overview.revenueAtRisk || 0), tone: "money" },
            { key: "pending", icon: <Inbox className="h-4 w-4" />, label: copy.pendingActions, value: advisor?.overview.pendingActions ?? pending.length },
            { key: "coverage", icon: <CheckCircle2 className="h-4 w-4" />, label: copy.activeCoverage, value: activeModuleCount, tone: "healthy" },
            { key: "failed", icon: <XCircle className="h-4 w-4" />, label: copy.failedExecutions, value: failedExecutionCount, tone: failedExecutionCount > 0 ? "critical" : undefined },
          ]}
        />
      </div>

      <AdvisorGuidedFlow
        labels={{
          flow: copy.flow,
          signalStep: copy.signalStep,
          evidenceStep: copy.evidenceStep,
          actionStep: copy.actionStep,
          approvalStep: copy.approvalStep,
          approvalRequired: copy.approvalRequired,
        }}
      />

      <Tabs ref={advisorTabsRef} value={activeTab} onValueChange={(value) => setActiveTab(parseAdvisorTab(value))} className="scroll-mt-4 space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-full border border-zinc-200 bg-white/90 p-1 shadow-sm dark:border-zinc-800 dark:bg-card" data-tour-id="ai-actions-tabs">
          <TabsTrigger value="today" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm">{copy.today}</TabsTrigger>
          <TabsTrigger value="detail" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm md:hidden">{copy.detail}</TabsTrigger>
          <TabsTrigger value="ask" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm">{copy.ask}</TabsTrigger>
          <TabsTrigger value="modules" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm">{copy.modules}</TabsTrigger>
          <TabsTrigger value="queue" data-video-target="ai-actions-tab-queue" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm">{copy.queue}</TabsTrigger>
          <TabsTrigger value="history" data-video-target="ai-actions-tab-history" className="rounded-full px-4 data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-sm">{copy.history}</TabsTrigger>
        </TabsList>

        <TabsContent value="ask" className="mt-0 space-y-4">
          <AdvisorScenarioLauncher
            labels={{
              title: copy.launcherTitle,
              description: copy.launcherDesc,
              noScenarios: copy.launcherEmpty,
              modules: copy.modules,
              dateScope: copy.dateScope,
            }}
            dateScopes={[
              { value: "active", label: copy.scopeActive },
              { value: "today", label: copy.scopeToday },
              { value: "week", label: copy.scopeWeek },
            ]}
            selectedDateScope={dateScope}
            scenarios={scenarioItems}
            onScenarioSelect={selectAdvisorScenario}
            onOpenModules={() => setActiveTab("modules")}
            onDateScopeChange={(scope) => setDateScope(scope as AdvisorDateScope)}
          />

          <AdvisorAskPanel
            inputRef={commandInputRef}
            question={askQuestion}
            asking={asking}
            selectedFilter={askFilter}
            answer={localizedAskAnswer}
            queueingKey={queueingKey}
            matchedSignals={askMatchedSignals}
            selectedSignalId={selectedSignal?.id}
            labels={{
              quickQuestions: copy.quickQuestions,
              askDesc: copy.askDesc,
              askPlaceholder: copy.askPlaceholder,
              askButton: copy.askButton,
              matched: copy.matched,
              answer: copy.answer,
              groundedAnswer: copy.groundedAnswer,
              primaryRisk: copy.primaryRisk,
              whatToDoNext: copy.whatToDoNext,
              openThisRisk: copy.openThisRisk,
              queuePrimaryAction: copy.queuePrimaryAction,
              queryScope: copy.queryScope,
              citations: copy.citations,
              sources: copy.sources,
              owner: copy.owner,
              dateScope: copy.dateScope,
              approvalRequired: copy.approvalRequired,
              selectedRisk: copy.selectedRisk,
              openRiskDetails: copy.openRiskDetails,
            }}
            filters={[
              { key: "all", label: copy.allRisks },
              { key: "money", label: copy.moneyRisk },
              { key: "sales", label: copy.salesRisk },
              { key: "tasks", label: copy.taskRisk },
              { key: "contracts", label: copy.contractRisk },
              { key: "marketing", label: copy.marketingRisk },
              { key: "routes", label: copy.routeRisk },
              { key: "support", label: copy.supportRisk },
              { key: "kpi", label: copy.managerRisk },
            ]}
            onQuestionChange={setAskQuestion}
            onAsk={(question) => askAdvisor(question)}
            onFilterPrompt={(key, label) => {
              setAskFilter(key as AdvisorAskFilter)
              setAskQuestion(label)
              askAdvisor(label)
            }}
            onQueue={queueRecommendedAction}
            onSelectSignal={(signal) => {
              setSelectedDomain(signal.domain)
              setSelectedOwner("all")
              setDateScope("active")
              setActiveTab("today")
              selectSignal(signal.id, { openDetailOnSmall: true })
              scrollToTodaySection()
            }}
            severityClassName={severityClasses}
            severityLabel={(severity) => severityLabelFor(copy, severity)}
            domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
            moneyLabel={(value, currency) => formatMoney(value, currency || "AZN")}
            actionTypeLabel={(actionType) => actionTypeLabelFor(copy, actionType)}
            intentLabel={(intent) => intentLabelFor(copy, intent)}
            metricKindLabel={(metric) => metricKindLabelFor(locale, metric)}
            dateScopeLabel={(scope) => queryDateScopeLabelFor(locale, scope)}
            signalTitle={(signal) => advisorSignalTitleFor(locale, signal)}
            signalSummary={(signal) => advisorSignalSummaryFor(locale, signal)}
            actionLabel={(action) => advisorActionLabelFor(locale, action, copy)}
            actionDescription={(action) => advisorRecommendedActionDescriptionFor(locale, action)}
          />

          <DailyBriefingStrip
            title={copy.dailyBriefing}
            emptyText={copy.briefingEmpty}
            keyboardHint={copy.keyboardHint}
            items={briefingItems}
            onSelect={(signalId) => {
              setActiveTab("today")
              selectSignal(signalId)
              scrollToTodaySection()
            }}
          />
        </TabsContent>

        <TabsContent value="today" className="mt-0 space-y-4">
          {loading ? (
            <LoadingPanel />
          ) : (
            <>
            <AdvisorScenarioLauncher
              labels={{
                title: copy.launcherTitle,
                description: copy.launcherDesc,
                noScenarios: copy.launcherEmpty,
                modules: copy.modules,
                dateScope: copy.dateScope,
              }}
              dateScopes={[
                { value: "active", label: copy.scopeActive },
                { value: "today", label: copy.scopeToday },
                { value: "week", label: copy.scopeWeek },
              ]}
              selectedDateScope={dateScope}
              scenarios={scenarioItems}
              onScenarioSelect={selectAdvisorScenario}
              onOpenModules={() => setActiveTab("modules")}
              onDateScopeChange={(scope) => setDateScope(scope as AdvisorDateScope)}
            />
            <AdvisorAnswerSummaryCard
              answer={localizedAskAnswer}
              selectedSignal={selectedSignal}
              queueingKey={queueingKey}
              labels={{
                activeAnswer: copy.activeAnswer,
                activeAnswerDesc: copy.activeAnswerDesc,
                answer: copy.answer,
                primaryRisk: copy.primaryRisk,
                whatToDoNext: copy.whatToDoNext,
                backToAnswer: copy.backToAnswer,
                openThisRisk: copy.openThisRisk,
                queuePrimaryAction: copy.queuePrimaryAction,
                approvalRequired: copy.approvalRequired,
                matched: copy.matched,
                citations: copy.citations,
              }}
              onOpenAnswer={() => setActiveTab("ask")}
              onOpenRisk={(signal) => selectSignal(signal.id, { openDetailOnSmall: true })}
              onQueue={queueRecommendedAction}
              severityClassName={severityClasses}
              severityLabel={(severity) => severityLabelFor(copy, severity)}
              domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
              actionTypeLabel={(actionType) => actionTypeLabelFor(copy, actionType)}
              signalTitle={(signal) => advisorSignalTitleFor(locale, signal)}
              signalSummary={(signal) => advisorSignalSummaryFor(locale, signal)}
              actionLabel={(action) => advisorActionLabelFor(locale, action, copy)}
              actionDescription={(action) => advisorRecommendedActionDescriptionFor(locale, action)}
            />
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] 2xl:grid-cols-[minmax(340px,0.95fr)_minmax(380px,1fr)_minmax(300px,0.72fr)]">
              <div data-tour-id="ai-actions-rail">
                <AdvisorSignalRail
                  inputRef={signalSearchRef}
                  signals={visibleSignals}
                  totalSignals={advisor?.signals.length || 0}
                  capabilities={advisor?.capabilities || []}
                  collectorHealth={advisor?.collectorHealth || []}
                  selectedSignalId={selectedSignal?.id}
                  query={query}
                  domains={domainOptions}
                  owners={ownerOptions}
                  selectedDomain={selectedDomain}
                  selectedOwner={selectedOwner}
                  labels={{
                    needsAttention: copy.needsAttention,
                    searchPlaceholder: copy.searchPlaceholder,
                    allModules: copy.allModules,
                    allOwners: copy.allOwners,
                    unassigned: copy.unassigned,
                    selectedRisk: copy.selectedRisk,
                    openRiskDetails: copy.openRiskDetails,
                  }}
                  emptyLabels={{
                    emptyToday: copy.emptyToday,
                    emptyFilteredTitle: copy.emptyFilteredTitle,
                    emptyFilteredReason: copy.emptyFilteredReason,
                    emptyReasonUnknown: copy.emptyReasonUnknown,
                    emptyReasonNoAccess: copy.emptyReasonNoAccess,
                    emptyReasonNoModules: copy.emptyReasonNoModules,
                    emptyReasonQuiet: copy.emptyReasonQuiet,
                    emptyReasonCollectorFailed: copy.emptyReasonCollectorFailed,
                    clearFilters: copy.clearFilters,
                    activeModulesCount: copy.activeModulesCount,
                    lockedModulesCount: copy.lockedModulesCount,
                    noAccessModulesCount: copy.noAccessModulesCount,
                    active: copy.active,
                    noAccess: copy.noAccess,
                    locked: copy.locked,
                    collectorActive: copy.collectorActive,
                    collectorNoData: copy.collectorNoData,
                    collectorFailed: copy.collectorFailed,
                    collectorModuleDisabled: copy.collectorModuleDisabled,
                    collectorNoPermission: copy.collectorNoPermission,
                  }}
                  onQueryChange={setQuery}
                  onDomainChange={setSelectedDomain}
                  onOwnerChange={setSelectedOwner}
                  onSelectSignal={(signal) => selectSignal(signal.id, { openDetailOnSmall: true })}
                  severityClassName={severityClasses}
                  severityLabel={(severity) => severityLabelFor(copy, severity)}
                  domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
                  moneyLabel={(value, currency) => formatMoney(value, currency || "AZN")}
                  actionTypeLabel={(actionType) => actionTypeLabelFor(copy, actionType)}
                  signalTitle={(signal) => advisorSignalTitleFor(locale, signal)}
                  signalSummary={(signal) => advisorSignalSummaryFor(locale, signal)}
                  actionLabel={(action) => advisorActionLabelFor(locale, action, copy)}
                />
              </div>
              <div data-tour-id="ai-actions-detail">
                <AdvisorSignalDetail
                  signal={selectedSignal}
                  relatedSignals={selectedRelatedSignals}
                  className="hidden md:block"
                queueingKey={queueingKey}
                labels={{
                  riskDetail: copy.riskDetail,
                  selectRisk: copy.selectRisk,
                  selectRiskTitle: copy.selectRiskTitle,
                  selectRiskReason: copy.selectRiskReason,
                  selectRiskEvidence: copy.selectRiskEvidence,
                  selectRiskAction: copy.selectRiskAction,
                  selectRiskApproval: copy.selectRiskApproval,
                  signalStep: copy.signalStep,
                  evidenceStep: copy.evidenceStep,
                  actionStep: copy.actionStep,
                  approvalStep: copy.approvalStep,
                  approvalRequired: copy.approvalRequired,
                  flow: copy.flow,
                  sources: copy.sources,
                  factsCount: copy.factsCount,
                  causalChain: copy.causalChain,
                  causalChainDesc: copy.causalChainDesc,
                  linkedSignal: copy.linkedSignal,
                  owner: copy.owner,
                  amount: copy.amount,
                  revenueAtRisk: copy.revenueAtRisk,
                  severity: copy.severity,
                  why: copy.why,
                  evidence: copy.evidence,
                  actions: copy.actions,
                  preview: copy.preview,
                  routeSnapshot: copy.routeSnapshot,
                  routeOwner: copy.routeOwner,
                  routeStatus: copy.routeStatus,
                  routeVisited: copy.routeVisited,
                  routeMissedStop: copy.routeMissedStop,
                  routeDelay: copy.routeDelay,
                  routeLastActivity: copy.routeLastActivity,
                  routeEvidenceLinks: copy.routeEvidenceLinks,
                  timeline: copy.timeline,
                  impact: copy.impact,
                  impactBasis: copy.impactBasis,
                  dryRun: copy.dryRun,
                  creates: copy.creates,
                  updates: copy.updates,
                  notifications: copy.notifications,
                  externalSideEffects: copy.externalSideEffects,
                  rollback: copy.rollback,
                  rollbackMode: copy.rollbackMode,
                  nextStep: copy.nextStep,
                  target: copy.target,
                  queueAction: copy.queueAction,
                  moreActions: copy.moreActions,
                  noPending: copy.noPending,
                }}
                onSelectSignal={selectSignal}
                onQueue={queueRecommendedAction}
                severityClassName={severityClasses}
                severityLabel={(severity) => severityLabelFor(copy, severity)}
                domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
                moneyLabel={(value, currency) => formatMoney(value, currency || "AZN")}
                actionTypeLabel={(actionType) => actionTypeLabelFor(copy, actionType)}
                actionRiskLabel={(risk) => actionRiskLabelFor(copy, risk)}
                signalTitle={(signal) => advisorSignalTitleFor(locale, signal)}
                signalSummary={(signal) => advisorSignalSummaryFor(locale, signal)}
                actionLabel={(action) => advisorActionLabelFor(locale, action, copy)}
                actionDescription={(action) => advisorRecommendedActionDescriptionFor(locale, action)}
                impactLabel={(impact) => advisorImpactLabelFor(locale, impact)}
                impactValue={(impact) => advisorImpactValueFor(locale, impact)}
                impactBasis={(impact) => advisorImpactBasisFor(locale, impact)}
                previewText={(text) => advisorPreviewTextFor(locale, text)}
                rollbackModeLabel={(mode) => advisorRollbackModeFor(locale, mode)}
                routeSourceLabel={(entityType) => advisorRouteSourceLabelFor(locale, entityType)}
                timelineLabel={(event) => advisorTimelineLabelFor(locale, event.label)}
                timelineDescription={(event, signal) => advisorTimelineDescriptionFor(locale, event, signal, copy)}
                factLabel={(fact) => advisorFactLabelFor(locale, fact)}
                factValue={(fact) => advisorFactValueFor(locale, fact)}
                metricLabel={(metric) => advisorMetricLabelFor(locale, metric.label)}
                />
              </div>
              <AdvisorActionTrailPanel
                className="hidden 2xl:block"
                copy={copy}
                pending={pending}
                history={history}
                onReview={reviewAction}
                localizers={{
                  title: (title) => advisorDisplayTextFor(locale, title),
                  summary: (summary) => advisorDisplayTextFor(locale, summary),
                  factLabel: (fact) => advisorFactLabelFor(locale, fact),
                  factValue: (fact) => advisorFactValueFor(locale, fact),
                  previewValue: (value) => advisorDisplayTextFor(locale, value),
                }}
              />
            </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="detail" className="mt-0">
          <AdvisorSignalDetail
            signal={selectedSignal}
            relatedSignals={selectedRelatedSignals}
            queueingKey={queueingKey}
            labels={{
              riskDetail: copy.riskDetail,
              selectRisk: copy.selectRisk,
              selectRiskTitle: copy.selectRiskTitle,
              selectRiskReason: copy.selectRiskReason,
              selectRiskEvidence: copy.selectRiskEvidence,
              selectRiskAction: copy.selectRiskAction,
              selectRiskApproval: copy.selectRiskApproval,
              signalStep: copy.signalStep,
              evidenceStep: copy.evidenceStep,
              actionStep: copy.actionStep,
              approvalStep: copy.approvalStep,
              approvalRequired: copy.approvalRequired,
              flow: copy.flow,
              sources: copy.sources,
              factsCount: copy.factsCount,
              causalChain: copy.causalChain,
              causalChainDesc: copy.causalChainDesc,
              linkedSignal: copy.linkedSignal,
              owner: copy.owner,
              amount: copy.amount,
              revenueAtRisk: copy.revenueAtRisk,
              severity: copy.severity,
              why: copy.why,
              evidence: copy.evidence,
              actions: copy.actions,
              preview: copy.preview,
              routeSnapshot: copy.routeSnapshot,
              routeOwner: copy.routeOwner,
              routeStatus: copy.routeStatus,
              routeVisited: copy.routeVisited,
              routeMissedStop: copy.routeMissedStop,
              routeDelay: copy.routeDelay,
              routeLastActivity: copy.routeLastActivity,
              routeEvidenceLinks: copy.routeEvidenceLinks,
              timeline: copy.timeline,
              impact: copy.impact,
              impactBasis: copy.impactBasis,
              dryRun: copy.dryRun,
              creates: copy.creates,
              updates: copy.updates,
              notifications: copy.notifications,
              externalSideEffects: copy.externalSideEffects,
              rollback: copy.rollback,
              rollbackMode: copy.rollbackMode,
              nextStep: copy.nextStep,
              target: copy.target,
              queueAction: copy.queueAction,
              moreActions: copy.moreActions,
              noPending: copy.noPending,
            }}
            onSelectSignal={selectSignal}
            onQueue={queueRecommendedAction}
            severityClassName={severityClasses}
            severityLabel={(severity) => severityLabelFor(copy, severity)}
            domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
            moneyLabel={(value, currency) => formatMoney(value, currency || "AZN")}
            actionTypeLabel={(actionType) => actionTypeLabelFor(copy, actionType)}
            actionRiskLabel={(risk) => actionRiskLabelFor(copy, risk)}
            signalTitle={(signal) => advisorSignalTitleFor(locale, signal)}
            signalSummary={(signal) => advisorSignalSummaryFor(locale, signal)}
            actionLabel={(action) => advisorActionLabelFor(locale, action, copy)}
            actionDescription={(action) => advisorRecommendedActionDescriptionFor(locale, action)}
            impactLabel={(impact) => advisorImpactLabelFor(locale, impact)}
            impactValue={(impact) => advisorImpactValueFor(locale, impact)}
            impactBasis={(impact) => advisorImpactBasisFor(locale, impact)}
            previewText={(text) => advisorPreviewTextFor(locale, text)}
            rollbackModeLabel={(mode) => advisorRollbackModeFor(locale, mode)}
            routeSourceLabel={(entityType) => advisorRouteSourceLabelFor(locale, entityType)}
            timelineLabel={(event) => advisorTimelineLabelFor(locale, event.label)}
            timelineDescription={(event, signal) => advisorTimelineDescriptionFor(locale, event, signal, copy)}
            factLabel={(fact) => advisorFactLabelFor(locale, fact)}
            factValue={(fact) => advisorFactValueFor(locale, fact)}
            metricLabel={(metric) => advisorMetricLabelFor(locale, metric.label)}
          />
        </TabsContent>

        <TabsContent value="modules" className="mt-0">
          <AdvisorModuleCoverage
            capabilities={advisor?.capabilities || []}
            collectorHealth={advisor?.collectorHealth || []}
            signals={advisor?.signals || []}
            labels={{
              moduleCoverage: copy.moduleCoverage,
              moduleCoverageDesc: copy.moduleCoverageDesc,
              signalsLabel: copy.signalsLabel,
              active: copy.active,
              noAccess: copy.noAccess,
              locked: copy.locked,
              collectorActive: copy.collectorActive,
              collectorNoData: copy.collectorNoData,
              collectorFailed: copy.collectorFailed,
              collectorModuleDisabled: copy.collectorModuleDisabled,
              collectorNoPermission: copy.collectorNoPermission,
              moduleNoSignals: copy.moduleNoSignals,
              moduleNoSignalsHint: copy.moduleNoSignalsHint,
              moduleBlockedHint: copy.moduleBlockedHint,
              moduleNoAccessHint: copy.moduleNoAccessHint,
              filterModule: copy.filterModule,
              openModule: copy.openModule,
            }}
            domainLabel={(domain, fallback) => domainLabelFor(copy, domain, fallback)}
            onFilter={(domain) => {
              setSelectedDomain(domain)
              setActiveTab("today")
            }}
          />
        </TabsContent>

        <TabsContent value="queue" className="mt-0">
          <div className="space-y-4">
            <AdvisorActionList
              actions={pending}
              empty={copy.noPending}
              copy={copy}
              onReview={reviewAction}
              editingActionId={editingActionId}
              editDraft={editDraft}
              onStartEdit={startEditAction}
              onEditDraftChange={setEditDraft}
              onEditFieldChange={updateEditDraftField}
              localizers={{
                title: (title) => advisorDisplayTextFor(locale, title),
                summary: (summary) => advisorDisplayTextFor(locale, summary),
                factLabel: (fact) => advisorFactLabelFor(locale, fact),
                factValue: (fact) => advisorFactValueFor(locale, fact),
                previewValue: (value) => advisorDisplayTextFor(locale, value),
              }}
              onCancelEdit={() => {
                setEditingActionId(null)
                setEditDraft("")
              }}
              onSaveEdit={saveEditedAction}
            />
            <AdvisorActionExecutionTrail
              copy={copy}
              actions={executionTrailActions}
              localizers={{
                title: (title) => advisorDisplayTextFor(locale, title),
                summary: (summary) => advisorDisplayTextFor(locale, summary),
                factLabel: (fact) => advisorFactLabelFor(locale, fact),
                factValue: (fact) => advisorFactValueFor(locale, fact),
                previewValue: (value) => advisorDisplayTextFor(locale, value),
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <AdvisorActionHistoryPanel
            actions={history}
            empty={copy.noHistory}
            copy={copy}
            localizers={{
              title: (title) => advisorDisplayTextFor(locale, title),
              summary: (summary) => advisorDisplayTextFor(locale, summary),
              factLabel: (fact) => advisorFactLabelFor(locale, fact),
              factValue: (fact) => advisorFactValueFor(locale, fact),
              previewValue: (value) => advisorDisplayTextFor(locale, value),
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
