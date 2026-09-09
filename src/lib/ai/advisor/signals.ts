import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import type { AdvisorAction, AdvisorCapability, AdvisorCollectorHealth, AdvisorDomainKey, AdvisorDryRunPreview, AdvisorFact, AdvisorImpactEstimate, AdvisorRollbackPreview, AdvisorSignal, AdvisorSignalConfidence, AdvisorSignalMetric, AdvisorSignalMetricKind, AdvisorSignalTimelineEvent, AdvisorSourceRef } from "./types"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const DAY_MS = 86_400_000

function daysBetween(now: Date, date?: Date | null): number {
  if (!date) return 999
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS))
}

function minutesUntil(now: Date, date?: Date | null): number | null {
  if (!date) return null
  return Math.round((date.getTime() - now.getTime()) / 60_000)
}

function daysUntil(now: Date, date?: Date | null): number {
  if (!date) return 999
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS)
}

function iso(now: Date): string {
  return now.toISOString()
}

function source(label: string, entityType: string, entityId: string, href: string): AdvisorSourceRef {
  return { label, entityType, entityId, href }
}

export function validateAdvisorSourceRefs(signal: Pick<AdvisorSignal, "id" | "sources">): string[] {
  const errors: string[] = []
  if (!Array.isArray(signal.sources) || signal.sources.length === 0) {
    return [`${signal.id}: missing source links`]
  }
  signal.sources.forEach((item, index) => {
    const prefix = `${signal.id}: source ${index + 1}`
    if (!item.label?.trim()) errors.push(`${prefix} is missing label`)
    if (!item.entityType?.trim()) errors.push(`${prefix} is missing entity type`)
    if (!item.entityId?.trim()) errors.push(`${prefix} is missing entity id`)
    if (!item.href?.trim()) {
      errors.push(`${prefix} is missing href`)
    } else if (item.href !== item.href.trim() || !item.href.startsWith("/") || item.href.startsWith("//")) {
      errors.push(`${prefix} has invalid href`)
    }
  })
  return errors
}

function assertAdvisorSignalSources(signals: AdvisorSignal[]) {
  const errors = signals.flatMap((signal) => validateAdvisorSourceRefs(signal))
  if (errors.length > 0) {
    throw new Error(`Advisor source validation failed: ${errors[0]}`)
  }
}

function fact(label: string, value: string | number | null | undefined): AdvisorFact {
  return { label, value: value == null || value === "" ? "—" : String(value) }
}

function parseMetricNumber(value: string): number | null {
  if (!value || value === "—") return null
  const normalized = value.replace(/,/g, "").replace(/%/g, "")
  const match = normalized.match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function formatMetric(kind: AdvisorSignalMetricKind, value: number, unit?: string): string {
  if (kind === "money") return `${value.toLocaleString()} ${unit || "AZN"}`
  if (kind === "percent") return `${value}%`
  if (kind === "minutes") return `${value} min`
  if (kind === "days") return `${value} d`
  return unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString()
}

function metric(kind: AdvisorSignalMetricKind, label: string, value: number, unit?: string): AdvisorSignalMetric {
  return { kind, label, value, unit, formatted: formatMetric(kind, value, unit) }
}

function metricFromFact(signal: AdvisorSignal, labels: string[], kind: AdvisorSignalMetricKind, unit?: string): AdvisorSignalMetric | null {
  const wanted = labels.map((label) => label.toLowerCase())
  const found = signal.facts.find((item) => wanted.includes(item.label.toLowerCase()))
  if (!found) return null
  const value = parseMetricNumber(found.value)
  return value == null ? null : metric(kind, found.label, value, unit)
}

export function deriveAdvisorSignalMetric(signal: AdvisorSignal): AdvisorSignalMetric {
  if (signal.amount != null && signal.amount > 0) {
    return metric("money", "Money at risk", signal.amount, signal.currency || "AZN")
  }
  return metricFromFact(signal, ["Overdue days", "Idle days", "Unsigned days", "Waiting days", "Age days"], "days", "days") ||
    metricFromFact(signal, ["Delay minutes", "Break minutes", "Open minutes", "SLA minutes remaining", "First response breach minutes", "Resolution breach minutes"], "minutes", "minutes") ||
    metricFromFact(signal, ["Completion", "Completion rate", "Compliance", "Probability"], "percent", "%") ||
    metricFromFact(signal, ["OOS items", "Open tickets", "High priority tickets", "Response gaps", "Overdue open tasks", "Planned actions this month", "Completed actions", "Sent", "Opened", "Clicked", "Visited"], "count") ||
    metricFromFact(signal, ["Score"], "score") ||
    metric("count", "Facts", signal.facts.length)
}

export function normalizeAdvisorSignalMetric(signal: AdvisorSignal): AdvisorSignal {
  return {
    ...signal,
    metric: signal.metric || deriveAdvisorSignalMetric(signal),
  }
}

export function deriveAdvisorSignalConfidence(signal: AdvisorSignal): AdvisorSignalConfidence {
  if (signal.sources.length >= 2 && signal.facts.length >= 3) {
    return { level: "high", reason: "Multiple source records and facts support this signal." }
  }
  if (signal.sources.length >= 1 && signal.facts.length >= 2) {
    return { level: "medium", reason: "A source record and supporting facts are available." }
  }
  return { level: "low", reason: "Signal has limited supporting facts and should be reviewed before action." }
}

export function deriveAdvisorSafetyNote(signal: AdvisorSignal): string {
  const risks = signal.recommendedActions.map((action) => action.risk)
  if (risks.includes("dangerous") || risks.includes("high")) {
    return "High-risk recommendation: approval is required before execution."
  }
  if (risks.includes("medium")) {
    return "Review prepared fields before approving this Advisor action."
  }
  if (risks.length > 0) {
    return "Safe internal recommendation; execution remains audited."
  }
  return "Read-only signal; no action is prepared."
}

function primarySignalDate(signal: AdvisorSignal): string {
  const dateFact = signal.facts.find((item) =>
    /due|valid|created|updated|signed|response|activity|end|started|completed/i.test(item.label) &&
    item.value !== "—"
  )
  if (!dateFact) return signal.detectedAt
  const parsed = new Date(dateFact.value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : signal.detectedAt
}

export function deriveAdvisorTimeline(signal: AdvisorSignal, checkedAt: string): AdvisorSignalTimelineEvent[] {
  const primarySource = signal.sources[0]
  const events: AdvisorSignalTimelineEvent[] = [
    {
      label: "Source observed",
      at: primarySignalDate(signal),
      description: primarySource
        ? `${primarySource.label} was read from ${primarySource.entityType}.`
        : `${signal.entityType}:${signal.entityId} was read by the Advisor collector.`,
      source: primarySource,
    },
    {
      label: "Signal detected",
      at: signal.detectedAt,
      description: signal.summary,
      source: primarySource,
    },
  ]

  const metric = signal.metric || deriveAdvisorSignalMetric(signal)
  if (metric) {
    events.push({
      label: "Impact measured",
      at: signal.detectedAt,
      description: `${metric.label}: ${metric.formatted}.`,
      source: primarySource,
    })
  }

  const action = signal.recommendedActions[0]
  if (action) {
    events.push({
      label: "Safe action prepared",
      at: checkedAt,
      description: `${action.label} is prepared as ${action.actionType} and requires approval before execution.`,
      source: primarySource,
    })
  }

  return events.slice(0, 5)
}

export function deriveAdvisorImpact(signal: AdvisorSignal): AdvisorImpactEstimate {
  const metric = signal.metric || deriveAdvisorSignalMetric(signal)
  const moneyAtRisk = signal.amount ?? (metric.kind === "money" ? metric.value : null)
  const severityBasis = signal.severity === "critical"
    ? "Critical because the signal is urgent, overdue, blocked or has high monetary exposure."
    : signal.severity === "high"
      ? "High because the signal is likely to affect revenue, SLA, route execution or manager accountability."
      : signal.severity === "medium"
        ? "Medium because the signal needs review before it becomes operational debt."
        : "Low because the recommendation is informational or low blast-radius."

  return {
    label: metric.label,
    value: metric.formatted,
    severity: signal.severity,
    basis: severityBasis,
    moneyAtRisk,
    currency: signal.currency || (metric.kind === "money" ? metric.unit || null : null),
  }
}

function actionCreates(actionType: string, payload: Record<string, unknown>): string[] {
  if (actionType.includes("task") || ["contract_review", "campaign_review", "kpi_plan_review", "flag_route_issue", "support_escalation"].includes(actionType)) {
    return [`Task: ${typeof payload.title === "string" ? payload.title : "Advisor follow-up"}`]
  }
  if (actionType.includes("alert") || actionType === "priority_update") {
    return [`Notification: ${typeof payload.title === "string" ? payload.title : "Advisor alert"}`]
  }
  if (actionType.includes("note")) {
    return [`Note: ${typeof payload.subject === "string" ? payload.subject : "Advisor note"}`]
  }
  if (actionType === "draft_followup" || actionType === "invoice_reminder") {
    return [`Draft task/reminder: ${typeof payload.subject === "string" ? payload.subject : typeof payload.title === "string" ? payload.title : "Advisor draft"}`]
  }
  return []
}

function actionUpdates(actionType: string, target: Pick<AdvisorSignal, "entityType" | "entityId">): string[] {
  if (actionType === "assign_task" || actionType === "assign_owner" || actionType === "assign_ticket_owner") {
    return [`Update owner assignment on ${target.entityType}:${target.entityId}`]
  }
  if (actionType === "priority_update") {
    return [`Update priority on ${target.entityType}:${target.entityId}`]
  }
  return []
}

function actionNotifications(actionType: string): string[] {
  if (actionType === "create_alert" || actionType === "stage_alert" || actionType === "support_escalation" || actionType === "priority_update") {
    return ["In-app notification to responsible managers"]
  }
  return []
}

function actionExternalSideEffects(actionType: string): string[] {
  if (actionType === "invoice_reminder" || actionType === "draft_followup" || actionType === "signature_reminder") {
    return ["No external message is sent automatically; Advisor prepares an internal task/draft for approval."]
  }
  return []
}

export function deriveAdvisorDryRunPreview(signal: AdvisorSignal): AdvisorDryRunPreview | undefined {
  const action = signal.recommendedActions[0]
  if (!action) return undefined
  const payload = action.payload || {}
  return {
    actionType: action.actionType,
    title: action.label,
    creates: actionCreates(action.actionType, payload),
    updates: actionUpdates(action.actionType, signal),
    notifications: actionNotifications(action.actionType),
    externalSideEffects: actionExternalSideEffects(action.actionType),
    payload: {
      ...payload,
      relatedType: typeof payload.relatedType === "string" ? payload.relatedType : signal.entityType,
      relatedId: typeof payload.relatedId === "string" ? payload.relatedId : signal.entityId,
    },
  }
}

export function deriveAdvisorRollbackPreview(signal: AdvisorSignal): AdvisorRollbackPreview {
  const action = signal.recommendedActions[0]
  if (!action) {
    return { mode: "not_required", summary: "No execution is prepared for this read-only signal.", steps: [] }
  }
  if (action.actionType === "assign_task" || action.actionType === "assign_owner" || action.actionType === "assign_ticket_owner" || action.actionType === "priority_update") {
    return {
      mode: "manual",
      summary: "This update changes an existing record and requires manual rollback from the record history if approved.",
      steps: ["Open the linked source record.", "Review the Advisor audit entry.", "Restore the previous owner or priority if needed."],
    }
  }
  return {
    mode: "automatic",
    summary: "This action creates an internal task, note, alert or draft. Rollback is low-risk because the created object can be closed, dismissed or deleted.",
    steps: ["Open the created Advisor task/note/alert.", "Close or delete it if the approval was wrong.", "Keep the approval/audit trail for traceability."],
  }
}

export function normalizeAdvisorSignalContract(input: {
  signal: AdvisorSignal
  collectorKey: AdvisorDomainKey
  checkedAt: string
  healthStatus?: AdvisorCollectorHealth["status"]
}): AdvisorSignal {
  const checked = new Date(input.checkedAt)
  const detected = new Date(input.signal.detectedAt)
  const ageMinutes = Number.isFinite(checked.getTime()) && Number.isFinite(detected.getTime())
    ? Math.max(0, Math.floor((checked.getTime() - detected.getTime()) / 60_000))
    : 0
  const signal = normalizeAdvisorSignalMetric({
    ...input.signal,
    collectorKey: input.signal.collectorKey || input.collectorKey,
    healthStatus: input.signal.healthStatus || input.healthStatus || "active",
    freshness: input.signal.freshness || {
      checkedAt: input.checkedAt,
      detectedAt: input.signal.detectedAt,
      ageMinutes,
    },
    confidence: input.signal.confidence || deriveAdvisorSignalConfidence(input.signal),
    safetyNote: input.signal.safetyNote ?? deriveAdvisorSafetyNote(input.signal),
  })
  return {
    ...signal,
    timeline: signal.timeline || deriveAdvisorTimeline(signal, input.checkedAt),
    impact: signal.impact || deriveAdvisorImpact(signal),
    dryRunPreview: signal.dryRunPreview || deriveAdvisorDryRunPreview(signal),
    rollbackPreview: signal.rollbackPreview || deriveAdvisorRollbackPreview(signal),
  }
}

function createTaskAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "create_task",
    label: "Create task",
    risk: "low",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function createAlertAction(title: string, description: string, relatedType: string, relatedId: string): AdvisorAction {
  return {
    actionType: "create_alert",
    label: "Create alert",
    risk: "low",
    payload: { title, description, relatedType, relatedId },
  }
}

function createNoteAction(subject: string, description: string, relatedType: string, relatedId: string): AdvisorAction {
  return {
    actionType: "create_note",
    label: "Create note",
    risk: "low",
    payload: { subject, description, relatedType, relatedId },
  }
}

function draftFollowUpAction(subject: string, body: string, relatedType: string, relatedId: string): AdvisorAction {
  return {
    actionType: "draft_followup",
    label: "Draft follow-up",
    risk: "medium",
    payload: { subject, body, relatedType, relatedId },
  }
}

function invoiceReminderAction(title: string, message: string, relatedType: string, relatedId: string): AdvisorAction {
  return {
    actionType: "invoice_reminder",
    label: "Invoice reminder",
    risk: "medium",
    payload: { title, message, relatedType, relatedId },
  }
}

function flagRouteIssueAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "flag_route_issue",
    label: "Flag route issue",
    risk: "low",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function suggestBudgetChangeAction(title: string, description: string, relatedType: string, relatedId: string): AdvisorAction {
  return {
    actionType: "suggest_budget_change",
    label: "Suggest budget review",
    risk: "medium",
    payload: { title, description, relatedType, relatedId },
  }
}

function contractReviewAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "contract_review",
    label: "Contract review",
    risk: "low",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function campaignReviewAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "campaign_review",
    label: "Campaign review",
    risk: "low",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function supportEscalationAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "support_escalation",
    label: "Support escalation",
    risk: "medium",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function assignTicketOwnerAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "assign_ticket_owner",
    label: "Assign ticket owner",
    risk: "medium",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

function priorityUpdateAction(title: string, description: string, relatedType: string, relatedId: string, priority: "high" | "urgent" | "critical" = "high"): AdvisorAction {
  return {
    actionType: "priority_update",
    label: "Update priority",
    risk: "medium",
    payload: { title, message: description, priority, relatedType, relatedId },
  }
}

function kpiPlanReviewAction(title: string, description: string, relatedType: string, relatedId: string, assignedTo?: string | null): AdvisorAction {
  return {
    actionType: "kpi_plan_review",
    label: "KPI plan review",
    risk: "low",
    payload: { title, description, relatedType, relatedId, assignedTo: assignedTo || null },
  }
}

interface KpiOwnerTaskRow {
  id: string
  assignedTo: string | null
  status: string
  dueDate: Date | null
  createdAt: Date
  completedAt: Date | null
  assignee?: { name: string | null; email?: string | null } | null
}

interface TaskRiskRow {
  id: string
  title: string
  status: string
  priority: string
  dueDate: Date | null
  createdAt: Date
  assignedTo: string | null
  relatedType: string | null
  relatedId: string | null
}

interface KpiOwnerAggregate {
  ownerId: string
  ownerLabel: string
  planned: number
  completed: number
  overdueOpen: number
  oldestOverdueDays: number
  responseGaps: number
  oldestResponseGapHours: number
}

interface KpiOwnerTicketRow {
  id: string
  assignedTo: string | null
  status: string
  createdAt: Date
  firstResponseAt: Date | null
  slaFirstResponseDueAt: Date | null
  assignee?: { name: string | null; email?: string | null } | null
}

interface RepeatedTicketRow {
  id: string
  ticketNumber: string
  subject: string
  priority: string
  status: string
  assignedTo: string | null
  companyId: string | null
  createdAt: Date
  company?: { name: string | null } | null
}

interface OpenVisitRow {
  id: string
  status: string
  checkInAt: Date
  agent: { name: string | null; userId: string | null }
  customer: { name: string | null }
}

interface RouteRiskRow {
  id: string
  name: string | null
  status: string
  totalPoints: number
  visitedPoints: number
  startedAt: Date | null
  agent: { name: string | null; userId: string | null }
  points?: Array<{ status: string; plannedTime: Date | null; visitedAt: Date | null; customer?: { name: string | null } | null }>
}

interface MtmPhotoReviewRow {
  id: string
  category: string | null
  status: string
  createdAt: Date
  agent: { name: string | null; userId: string | null }
  visitId: string | null
}

interface ColdLeadRow {
  id: string
  contactName: string
  companyName: string | null
  status: string
  priority: string
  score: number
  assignedTo: string | null
  estimatedValue: number | null
  createdAt: Date
  updatedAt: Date
}

interface PaymentOrderRow {
  id: string
  orderNumber: string
  counterpartyName: string
  amount: number
  currency: string
  purpose: string
  status: string
  createdBy: string | null
  approvedBy: string | null
  approvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface OverdueInvoiceRow {
  id: string
  invoiceNumber: string
  title: string
  status: string
  dueDate: Date | null
  balanceDue: unknown
  totalAmount: unknown
  currency: string
  company: { name: string | null } | null
  contactId: string | null
  contract: {
    id: string
    title: string
    status: string
    currentApprovalStage: number | null
    signedAt: Date | null
  } | null
}

interface OverdueBillRow {
  id: string
  billNumber: string
  vendorName: string
  title: string
  status: string
  dueDate: Date | null
  balanceDue: unknown
  totalAmount: unknown
  currency: string
  category: string | null
  createdBy: string | null
}

interface ContractRiskRow {
  id: string
  title: string
  contractNumber: string
  status: string
  endDate: Date | null
  valueAmount: unknown
  currency: string
  currentApprovalStage: number | null
  signedAt: Date | null
  createdBy: string | null
  updatedAt: Date
  company: { name: string | null } | null
}

interface IdleContactRow {
  id: string
  fullName: string
  email: string | null
  company: { name: string | null } | null
  lastActivityAt: Date | null
  createdAt: Date
}

interface StalledDealRow {
  id: string
  name: string
  stage: string
  valueAmount: unknown
  currency: string
  probability: number
  assignedTo: string | null
  expectedClose: Date | null
  stageChangedAt: Date | null
  updatedAt: Date
  company: { name: string | null } | null
}

interface HotLeadRow {
  id: string
  contactName: string
  companyName: string | null
  score: number
  estimatedValue: number | null
  createdAt: Date
}

interface IdleOfferRow {
  id: string
  offerNumber: string
  title: string
  totalAmount: number | null
  currency: string
  clientName: string | null
  validUntil: Date | null
  sentAt: Date | null
  updatedAt: Date
  dealId: string | null
}

interface IdleQuoteRow {
  id: string
  quoteNumber: string
  version: number
  status: string
  totalAmount: unknown
  currency: string
  customerName: string | null
  validUntil: Date | null
  sentAt: Date | null
  viewedAt: Date | null
  updatedAt: Date
  dealId: string | null
}

interface CampaignEngagementRow {
  id: string
  name: string
  status: string
  type: string
  totalSent: number
  totalOpened: number
  totalClicked: number
  updatedAt: Date
}

interface SlaTicketRow {
  id: string
  ticketNumber: string
  subject: string
  priority: string
  status: string
  assignedTo: string | null
  slaFirstResponseDueAt: Date | null
  slaDueAt: Date | null
  firstResponseAt: Date | null
  escalationLevel: number
  createdAt: Date
  company: { name: string | null } | null
}

function isActive(capabilities: AdvisorCapability[], key: AdvisorDomainKey): boolean {
  return capabilities.some((capability) => capability.key === key && capability.status === "active")
}

function domainLabel(capabilities: AdvisorCapability[], key: AdvisorDomainKey): string {
  return capabilities.find((capability) => capability.key === key)?.label || key
}

export async function collectAdvisorSignals(
  organizationId: string,
  capabilities: AdvisorCapability[],
  now = new Date(),
): Promise<AdvisorSignal[]> {
  return (await collectAdvisorSignalsWithHealth(organizationId, capabilities, now)).signals
}

type AdvisorCollector = {
  domain: AdvisorDomainKey
  run: (organizationId: string, capabilities: AdvisorCapability[], now: Date) => Promise<AdvisorSignal[]>
}

export async function collectAdvisorSignalsWithHealth(
  organizationId: string,
  capabilities: AdvisorCapability[],
  now = new Date(),
): Promise<{ signals: AdvisorSignal[]; health: AdvisorCollectorHealth[] }> {
  const collectors = [
    { domain: "crm", run: collectCrmSignals },
    { domain: "sales", run: collectSalesSignals },
    { domain: "contracts", run: collectContractSignals },
    { domain: "marketing", run: collectMarketingSignals },
    { domain: "tasks", run: collectTaskSignals },
    { domain: "finance", run: collectFinanceSignals },
    { domain: "support", run: collectSupportSignals },
    { domain: "routes", run: collectRouteSignals },
    { domain: "mtm", run: collectMtmSignals },
    { domain: "kpi", run: collectKpiSignals },
  ] satisfies AdvisorCollector[]
  const checkedAt = iso(now)
  const batches = await Promise.all(collectors.map((collector) => collectAdvisorDomainSignals({
    organizationId,
    capabilities,
    collector,
    now,
    checkedAt,
  })))
  const signals = batches.flatMap((batch) => batch.signals)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 80)
  return {
    signals,
    health: batches.map((batch) => batch.health),
  }
}

async function collectAdvisorDomainSignals(input: {
  organizationId: string
  capabilities: AdvisorCapability[]
  collector: AdvisorCollector
  now: Date
  checkedAt: string
}): Promise<{ signals: AdvisorSignal[]; health: AdvisorCollectorHealth }> {
  const capability = input.capabilities.find((item) => item.key === input.collector.domain)
  const domainLabel = capability?.label || input.collector.domain
  if (capability?.status === "locked" || !capability) {
    return {
      signals: [],
      health: {
        domain: input.collector.domain,
        domainLabel,
        status: "disabled",
        signalCount: 0,
        checkedAt: input.checkedAt,
        reason: capability?.reason || "Advisor module is not enabled for this tenant.",
      },
    }
  }
  if (capability.status === "no_access") {
    return {
      signals: [],
      health: {
        domain: input.collector.domain,
        domainLabel,
        status: "no_permission",
        signalCount: 0,
        checkedAt: input.checkedAt,
        reason: capability.reason || "Current user does not have access to this Advisor module.",
      },
    }
  }

  try {
    const signals = (await input.collector.run(input.organizationId, input.capabilities, input.now)).map((signal) => normalizeAdvisorSignalContract({
      signal,
      collectorKey: input.collector.domain,
      checkedAt: input.checkedAt,
      healthStatus: "active",
    }))
    assertAdvisorSignalSources(signals)
    return {
      signals,
      health: {
        domain: input.collector.domain,
        domainLabel,
        status: signals.length > 0 ? "active" : "no_data",
        signalCount: signals.length,
        checkedAt: input.checkedAt,
        reason: signals.length > 0 ? undefined : "Collector ran successfully and found no active signals.",
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown collector error"
    return {
      signals: [],
      health: {
        domain: input.collector.domain,
        domainLabel,
        status: "collector_failed",
        signalCount: 0,
        checkedAt: input.checkedAt,
        reason: message.slice(0, 180),
      },
    }
  }
}

function severityRank(severity: AdvisorSignal["severity"]): number {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1
}

async function collectCrmSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "crm")) return []
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      isActive: true,
      OR: [
        { lastActivityAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
        { lastActivityAt: null, createdAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
      ],
    },
    select: { id: true, fullName: true, email: true, company: { select: { name: true } }, lastActivityAt: true, createdAt: true },
    orderBy: { updatedAt: "asc" },
    take: 8,
  })
  return buildCrmIdleContactSignals(contacts as IdleContactRow[], capabilities, now)
}

export function buildCrmIdleContactSignals(
  contacts: IdleContactRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return contacts.map((contact) => {
    const idleDays = daysBetween(now, contact.lastActivityAt || contact.createdAt)
    return {
      id: `crm:contact_idle:${contact.id}`,
      domain: "crm",
      domainLabel: domainLabel(capabilities, "crm"),
      entityType: "contact",
      entityId: contact.id,
      title: `${contact.fullName} has no recent CRM activity`,
      summary: `No tracked activity for ${idleDays} days. Review ownership and next step.`,
      severity: idleDays >= 60 ? "high" : "medium",
      detectedAt: iso(now),
      facts: [fact("Idle days", idleDays), fact("Company", contact.company?.name), fact("Email", contact.email)],
      sources: [source(contact.fullName, "contact", contact.id, `/contacts/${contact.id}`)],
      recommendedActions: [
        createTaskAction(`Reconnect with ${contact.fullName}`, `No activity for ${idleDays} days. Confirm status and next step.`, "contact", contact.id),
      ],
    }
  })
}

async function collectSalesSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "sales")) return []
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(organizationId)
  const staleCutoff = new Date(now.getTime() - 14 * DAY_MS)
  const coldLeadCutoff = new Date(now.getTime() - 21 * DAY_MS)
  const [deals, leads, coldLeads, offers, quotes] = await Promise.all([
    prisma.deal.findMany({
      where: {
        organizationId,
        stage: { notIn: closedStages },
        OR: [{ stageChangedAt: { lt: staleCutoff } }, { stageChangedAt: null, updatedAt: { lt: staleCutoff } }],
      },
      select: { id: true, name: true, stage: true, valueAmount: true, currency: true, probability: true, assignedTo: true, expectedClose: true, stageChangedAt: true, updatedAt: true, company: { select: { name: true } } },
      orderBy: { updatedAt: "asc" },
      take: 10,
    }),
    prisma.lead.findMany({
      where: { organizationId, status: { notIn: ["converted", "lost"] }, score: { gte: 75 }, assignedTo: null },
      select: { id: true, contactName: true, companyName: true, score: true, estimatedValue: true, createdAt: true },
      orderBy: { score: "desc" },
      take: 6,
    }),
    prisma.lead.findMany({
      where: {
        organizationId,
        status: { in: ["new", "contacted", "qualified"] },
        score: { lte: 45 },
        updatedAt: { lt: coldLeadCutoff },
      },
      select: { id: true, contactName: true, companyName: true, status: true, priority: true, score: true, assignedTo: true, estimatedValue: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: 8,
    }),
    prisma.offer.findMany({
      where: {
        organizationId,
        status: "sent",
        OR: [
          { validUntil: { lt: now } },
          { sentAt: { lt: staleCutoff } },
          { sentAt: null, updatedAt: { lt: staleCutoff } },
        ],
      },
      select: { id: true, offerNumber: true, title: true, totalAmount: true, currency: true, clientName: true, validUntil: true, sentAt: true, updatedAt: true, dealId: true },
      orderBy: { updatedAt: "asc" },
      take: 8,
    }).catch(() => []),
    prisma.quote.findMany({
      where: {
        organizationId,
        status: { in: ["sent", "viewed"] },
        OR: [
          { validUntil: { lt: now } },
          { viewedAt: { lt: staleCutoff } },
          { sentAt: { lt: staleCutoff } },
          { sentAt: null, viewedAt: null, updatedAt: { lt: staleCutoff } },
        ],
      },
      select: { id: true, quoteNumber: true, version: true, status: true, totalAmount: true, currency: true, customerName: true, validUntil: true, sentAt: true, viewedAt: true, updatedAt: true, dealId: true },
      orderBy: { updatedAt: "asc" },
      take: 8,
    }).catch(() => []),
  ])
  const dealSignals = buildStalledDealSignals(deals as StalledDealRow[], capabilities, now)
  const leadSignals = buildHotUnassignedLeadSignals(leads as HotLeadRow[], capabilities, now)
  const coldLeadSignals = buildColdLeadSignals(coldLeads, capabilities, now)
  const offerSignals = buildIdleOfferSignals(offers as IdleOfferRow[], capabilities, now)
  const quoteSignals = buildIdleQuoteSignals(quotes as IdleQuoteRow[], capabilities, now)
  return [...dealSignals, ...leadSignals, ...coldLeadSignals, ...offerSignals, ...quoteSignals]
}

export function buildStalledDealSignals(
  deals: StalledDealRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return deals.map((deal) => {
    const idleDays = daysBetween(now, deal.stageChangedAt || deal.updatedAt)
    const amount = decimalToNumber(deal.valueAmount)
    return {
      id: `sales:stalled_deal:${deal.id}`,
      domain: "sales",
      domainLabel: domainLabel(capabilities, "sales"),
      entityType: "deal",
      entityId: deal.id,
      title: `${deal.name} is stalled in ${deal.stage}`,
      summary: `No stage movement for ${idleDays} days${deal.expectedClose && deal.expectedClose < now ? " and close date is overdue" : ""}.`,
      severity: idleDays >= 30 || (deal.expectedClose != null && deal.expectedClose < now) ? "critical" : "high",
      ownerId: deal.assignedTo,
      amount,
      currency: deal.currency,
      detectedAt: iso(now),
      facts: [fact("Stage", deal.stage), fact("Idle days", idleDays), fact("Probability", `${deal.probability}%`), fact("Value", `${amount.toLocaleString()} ${deal.currency}`), fact("Company", deal.company?.name)],
      sources: [source(deal.name, "deal", deal.id, `/deals/${deal.id}`)],
      recommendedActions: [
        createTaskAction(`Follow up: ${deal.name}`, `Deal has not moved for ${idleDays} days. Confirm next step and update close plan.`, "deal", deal.id, deal.assignedTo),
        createNoteAction(`Advisor risk: ${deal.name}`, `Stalled in ${deal.stage} for ${idleDays} days. Probability ${deal.probability}%, value ${amount.toLocaleString()} ${deal.currency}.`, "deal", deal.id),
        draftFollowUpAction(`Next step for ${deal.name}`, `Hi, checking in on the next step for ${deal.name}.`, "deal", deal.id),
      ],
    }
  })
}

export function buildHotUnassignedLeadSignals(
  leads: HotLeadRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return leads.map((lead) => ({
    id: `sales:hot_unassigned_lead:${lead.id}`,
    domain: "sales",
    domainLabel: domainLabel(capabilities, "sales"),
    entityType: "lead",
    entityId: lead.id,
    title: `${lead.contactName} is a hot lead without an owner`,
    summary: `Lead score is ${lead.score}, but no manager is assigned.`,
    severity: lead.score >= 90 ? "critical" : "high",
    amount: lead.estimatedValue || null,
    detectedAt: iso(now),
    facts: [fact("Score", lead.score), fact("Company", lead.companyName), fact("Estimated value", lead.estimatedValue)],
    sources: [source(lead.contactName, "lead", lead.id, `/leads/${lead.id}`)],
    recommendedActions: [createAlertAction(`Assign hot lead: ${lead.contactName}`, `Lead score ${lead.score}. Assign an owner today.`, "lead", lead.id)],
  }))
}

export function buildIdleOfferSignals(
  offers: IdleOfferRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return offers.map((offer) => {
    const idleDays = daysBetween(now, offer.sentAt || offer.updatedAt)
    const expired = offer.validUntil != null && offer.validUntil < now
    const amount = offer.totalAmount || 0
    return {
      id: `sales:idle_offer:${offer.id}`,
      domain: "sales",
      domainLabel: domainLabel(capabilities, "sales"),
      entityType: "offer",
      entityId: offer.id,
      title: `${offer.offerNumber} is waiting for client action`,
      summary: expired ? `Offer validity expired after ${idleDays} days without approval.` : `Offer was sent ${idleDays} days ago and has no approval yet.`,
      severity: expired || idleDays >= 30 || amount >= 10_000 ? "high" : "medium",
      amount,
      currency: offer.currency,
      detectedAt: iso(now),
      facts: [fact("Offer", offer.title), fact("Client", offer.clientName), fact("Idle days", idleDays), fact("Valid until", offer.validUntil?.toISOString()), fact("Amount", `${amount.toLocaleString()} ${offer.currency}`)],
      sources: [source(offer.offerNumber, "offer", offer.id, `/offers/${offer.id}`)],
      recommendedActions: [
        createTaskAction(`Follow up offer ${offer.offerNumber}`, `Offer has been waiting for client action for ${idleDays} days. Confirm decision, objections or next terms.`, "offer", offer.id),
        createNoteAction(`Advisor risk: ${offer.offerNumber}`, `Sent offer has no approval after ${idleDays} days. Amount ${amount.toLocaleString()} ${offer.currency}.`, "offer", offer.id),
      ],
    }
  })
}

export function buildIdleQuoteSignals(
  quotes: IdleQuoteRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return quotes.map((quote) => {
    const idleDays = daysBetween(now, quote.viewedAt || quote.sentAt || quote.updatedAt)
    const expired = quote.validUntil != null && quote.validUntil < now
    const amount = decimalToNumber(quote.totalAmount)
    return {
      id: `sales:idle_quote:${quote.id}`,
      domain: "sales",
      domainLabel: domainLabel(capabilities, "sales"),
      entityType: "quote",
      entityId: quote.id,
      title: `${quote.quoteNumber} v${quote.version} has no buyer decision`,
      summary: expired ? `Quote validity expired with status ${quote.status}.` : `Quote is ${quote.status} and has been idle for ${idleDays} days.`,
      severity: expired || idleDays >= 30 || amount >= 10_000 ? "high" : "medium",
      amount,
      currency: quote.currency,
      detectedAt: iso(now),
      facts: [fact("Status", quote.status), fact("Customer", quote.customerName), fact("Idle days", idleDays), fact("Valid until", quote.validUntil?.toISOString()), fact("Amount", `${amount.toLocaleString()} ${quote.currency}`)],
      sources: [source(`${quote.quoteNumber} v${quote.version}`, "quote", quote.id, `/quotes/${quote.id}`)],
      recommendedActions: [
        createTaskAction(`Follow up quote ${quote.quoteNumber}`, `Quote is ${quote.status} and has been idle for ${idleDays} days. Confirm buyer decision or revise terms.`, "quote", quote.id),
        createNoteAction(`Advisor risk: ${quote.quoteNumber}`, `Quote ${quote.status} without buyer decision for ${idleDays} days. Amount ${amount.toLocaleString()} ${quote.currency}.`, "quote", quote.id),
      ],
    }
  })
}

export function buildColdLeadSignals(
  leads: ColdLeadRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return leads.map((lead) => {
    const idleDays = daysBetween(now, lead.updatedAt || lead.createdAt)
    const value = lead.estimatedValue || null
    return {
      id: `sales:cold_lead:${lead.id}`,
      domain: "sales",
      domainLabel: domainLabel(capabilities, "sales"),
      entityType: "lead",
      entityId: lead.id,
      title: `${lead.contactName} is going cold`,
      summary: `Lead score is ${lead.score} and there has been no update for ${idleDays} days.`,
      severity: idleDays >= 45 || lead.score <= 20 ? "high" : "medium",
      ownerId: lead.assignedTo,
      amount: value,
      detectedAt: iso(now),
      facts: [
        fact("Status", lead.status),
        fact("Score", lead.score),
        fact("Idle days", idleDays),
        fact("Priority", lead.priority),
        fact("Company", lead.companyName),
      ],
      sources: [source(lead.contactName, "lead", lead.id, `/leads/${lead.id}`)],
      recommendedActions: [
        createTaskAction(`Re-engage lead: ${lead.contactName}`, `Lead is stale for ${idleDays} days with score ${lead.score}. Confirm fit, next step or close reason.`, "lead", lead.id, lead.assignedTo),
        draftFollowUpAction(`Checking next step with ${lead.contactName}`, `Hi, checking whether this is still relevant and what the best next step should be.`, "lead", lead.id),
      ],
    }
  })
}

async function collectContractSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "contracts")) return []
  const signatureCutoff = new Date(now.getTime() - 7 * DAY_MS)
  const contracts = await prisma.contract.findMany({
    where: {
      organizationId,
      status: { in: ["active", "approved", "pending_approval", "renewing"] },
      OR: [
        { endDate: { lte: new Date(now.getTime() + 45 * DAY_MS) } },
        { currentApprovalStage: { not: null } },
        { status: "approved", signedAt: null, updatedAt: { lt: signatureCutoff } },
      ],
    },
    select: { id: true, title: true, contractNumber: true, status: true, endDate: true, valueAmount: true, currency: true, currentApprovalStage: true, signedAt: true, createdBy: true, updatedAt: true, company: { select: { name: true } } },
    orderBy: { endDate: "asc" },
    take: 10,
  })
  return buildContractRiskSignals(contracts, capabilities, now)
}

export function buildContractRiskSignals(
  contracts: ContractRiskRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return contracts.map((contract) => {
    const remaining = daysUntil(now, contract.endDate)
    const approvalStuck = contract.currentApprovalStage != null && contract.status === "pending_approval"
    const signatureStuck = contract.status === "approved" && contract.signedAt == null && daysBetween(now, contract.updatedAt) >= 7
    const unsignedDays = daysBetween(now, contract.updatedAt)
    const amount = contract.valueAmount == null ? null : decimalToNumber(contract.valueAmount)
    const signalKind = approvalStuck ? "approval" : signatureStuck ? "signature" : "renewal"
    return {
      id: `contracts:${signalKind}:${contract.id}`,
      domain: "contracts",
      domainLabel: domainLabel(capabilities, "contracts"),
      entityType: "contract",
      entityId: contract.id,
      title: approvalStuck
        ? `${contract.title} is waiting for approval`
        : signatureStuck
          ? `${contract.title} is approved but unsigned`
          : `${contract.title} is near renewal`,
      summary: approvalStuck
        ? `Approval stage ${contract.currentApprovalStage} is open.`
        : signatureStuck
          ? `Contract has been approved for ${unsignedDays} days without signature.`
          : `Contract ends in ${remaining} days.`,
      severity: approvalStuck || signatureStuck || remaining <= 14 ? "high" : "medium",
      ownerId: contract.createdBy,
      amount,
      currency: contract.currency,
      detectedAt: iso(now),
      facts: [
        fact("Status", contract.status),
        fact("Contract #", contract.contractNumber),
        fact("Ends in days", remaining),
        fact("Unsigned days", signatureStuck ? unsignedDays : null),
        fact("Company", contract.company?.name),
      ],
      sources: [source(contract.title, "contract", contract.id, `/contracts/${contract.id}`)],
      recommendedActions: [
        contractReviewAction(
          `Review contract: ${contract.title}`,
          approvalStuck
            ? "Check approval status and unblock the next reviewer."
            : signatureStuck
              ? "Confirm signer status, envelope delivery and expected execution date."
              : "Prepare renewal plan before the contract end date.",
          "contract",
          contract.id,
          contract.createdBy,
        ),
      ],
    }
  })
}

async function collectMarketingSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "marketing")) return []
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId, status: { in: ["active", "sent", "scheduled"] } },
    select: { id: true, name: true, status: true, type: true, totalSent: true, totalOpened: true, totalClicked: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: 10,
  })
  return (campaigns as CampaignEngagementRow[])
    .filter((campaign) => campaign.totalSent > 50 && campaign.totalClicked === 0)
    .map((campaign) => ({
      id: `marketing:low_engagement:${campaign.id}`,
      domain: "marketing",
      domainLabel: domainLabel(capabilities, "marketing"),
      entityType: "campaign",
      entityId: campaign.id,
      title: `${campaign.name} has delivery without clicks`,
      summary: `${campaign.totalSent} sent and 0 clicks. Review segment, offer or channel.`,
      severity: campaign.totalSent >= 500 ? "high" : "medium",
      detectedAt: iso(now),
      facts: [fact("Channel", campaign.type), fact("Sent", campaign.totalSent), fact("Opened", campaign.totalOpened), fact("Clicked", campaign.totalClicked)],
      sources: [source(campaign.name, "campaign", campaign.id, `/campaigns/${campaign.id}`)],
      recommendedActions: [
        campaignReviewAction(`Review campaign: ${campaign.name}`, "Campaign has sends but no click response. Check segment and offer.", "campaign", campaign.id),
        createNoteAction(`Advisor risk: ${campaign.name}`, `${campaign.totalSent} sent, ${campaign.totalOpened} opened and 0 clicks. Review segment, offer or channel before increasing spend.`, "campaign", campaign.id),
        suggestBudgetChangeAction(
          `Budget review: ${campaign.name}`,
          `${campaign.totalSent} sent and 0 clicks. Pause budget increase until segment, channel and offer are reviewed.`,
          "campaign",
          campaign.id,
        ),
      ],
    }))
}

async function collectTaskSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "tasks")) return []
  const dueSoonCutoff = new Date(now.getTime() + DAY_MS)
  const tasks = await prisma.task.findMany({
    where: {
      organizationId,
      status: { notIn: ["completed", "done", "cancelled"] },
      OR: [
        { status: "blocked" },
        { dueDate: { lt: now } },
        { dueDate: { gte: now, lte: dueSoonCutoff } },
        { createdAt: { lt: new Date(now.getTime() - 21 * DAY_MS) } },
      ],
    },
    select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true, assignedTo: true, relatedType: true, relatedId: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 14,
  })
  return buildTaskRiskSignals(tasks, capabilities, now)
}

export function buildTaskRiskSignals(
  tasks: TaskRiskRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return tasks.map((task) => {
    const overdueDays = task.dueDate ? daysBetween(now, task.dueDate) : 0
    const dueInDays = task.dueDate ? daysUntil(now, task.dueDate) : 999
    const ageDays = daysBetween(now, task.createdAt)
    const overdue = task.dueDate != null && task.dueDate < now
    const dueSoon = task.dueDate != null && task.dueDate >= now && dueInDays <= 1
    const blocked = task.status.toLowerCase() === "blocked"
    return {
      id: `tasks:${blocked ? "blocked" : overdue ? "overdue" : dueSoon ? "due_soon" : "aging"}:${task.id}`,
      domain: "tasks",
      domainLabel: domainLabel(capabilities, "tasks"),
      entityType: "task",
      entityId: task.id,
      title: blocked ? `${task.title} is blocked` : overdue ? `${task.title} is overdue` : dueSoon ? `${task.title} is due soon` : `${task.title} is aging`,
      summary: blocked ? `Task is blocked and has been open for ${ageDays} days.` : overdue ? `Task is overdue by ${overdueDays} days.` : dueSoon ? `Task is due in ${dueInDays} day.` : `Task has been open for ${ageDays} days.`,
      severity: task.priority === "urgent" || overdueDays >= 7 || (blocked && task.priority === "high") ? "critical" : task.priority === "high" || overdueDays > 0 || blocked ? "high" : "medium",
      ownerId: task.assignedTo,
      detectedAt: iso(now),
      facts: [fact("Status", task.status), fact("Priority", task.priority), fact("Overdue days", overdueDays), fact("Due in days", dueSoon ? dueInDays : null), fact("Age days", ageDays)],
      sources: [source(task.title, "task", task.id, `/tasks/${task.id}`)],
      recommendedActions: [createAlertAction(`Unblock task: ${task.title}`, "Review owner, priority and due date.", "task", task.id)],
    }
  })
}

async function collectFinanceSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "finance")) return []
  const pendingApprovalCutoff = new Date(now.getTime() - 2 * DAY_MS)
  const approvedExecutionCutoff = new Date(now.getTime() - 3 * DAY_MS)
  const [invoices, bills, paymentOrders] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        OR: [{ dueDate: { lt: now } }, { balanceDue: { gt: 0 } }],
      },
      select: {
        id: true,
        invoiceNumber: true,
        title: true,
        status: true,
        dueDate: true,
        balanceDue: true,
        totalAmount: true,
        currency: true,
        company: { select: { name: true } },
        contactId: true,
        contract: { select: { id: true, title: true, status: true, currentApprovalStage: true, signedAt: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 14,
    }),
    prisma.bill.findMany({
      where: {
        organizationId,
        status: { in: ["pending", "partially_paid", "overdue"] },
        dueDate: { lt: now },
        balanceDue: { gt: 0 },
      },
      select: {
        id: true,
        billNumber: true,
        vendorName: true,
        title: true,
        status: true,
        dueDate: true,
        balanceDue: true,
        totalAmount: true,
        currency: true,
        category: true,
        createdBy: true,
      },
      orderBy: { dueDate: "asc" },
      take: 12,
    }),
    prisma.paymentOrder.findMany({
      where: {
        organizationId,
        OR: [
          { status: "pending_approval", createdAt: { lt: pendingApprovalCutoff } },
          { status: "approved", approvedAt: { lt: approvedExecutionCutoff } },
          { status: "approved", approvedAt: null, updatedAt: { lt: approvedExecutionCutoff } },
        ],
      },
      select: { id: true, orderNumber: true, counterpartyName: true, amount: true, currency: true, purpose: true, status: true, createdBy: true, approvedBy: true, approvedAt: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    }),
  ])
  return [
    ...buildOverdueInvoiceSignals(invoices, capabilities, now),
    ...buildOverdueBillSignals(bills, capabilities, now),
    ...buildPaymentOrderSignals(paymentOrders, capabilities, now),
  ]
}

export function buildOverdueInvoiceSignals(
  invoices: OverdueInvoiceRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return invoices
    .filter((invoice) => decimalToNumber(invoice.balanceDue) > 0 && invoice.dueDate && invoice.dueDate < now)
    .map((invoice) => {
      const balance = decimalToNumber(invoice.balanceDue)
      const overdueDays = daysBetween(now, invoice.dueDate)
      const contractBlocked = invoice.contract?.status === "pending_approval" ||
        (invoice.contract?.status === "approved" && invoice.contract.signedAt == null)
      const contractCause = invoice.contract
        ? invoice.contract.status === "pending_approval"
          ? ` Linked contract is still waiting for approval stage ${invoice.contract.currentApprovalStage ?? "unknown"}.`
          : invoice.contract.status === "approved" && invoice.contract.signedAt == null
            ? " Linked contract is approved but not signed."
            : ""
        : ""
      return {
        id: `finance:overdue_invoice:${invoice.id}`,
        domain: "finance",
        domainLabel: domainLabel(capabilities, "finance"),
        entityType: "invoice",
        entityId: invoice.id,
        title: `${invoice.invoiceNumber} is overdue`,
        summary: `${balance.toLocaleString()} ${invoice.currency} is still unpaid after ${overdueDays} days.${contractCause}`,
        severity: overdueDays >= 30 || balance >= 10_000 || contractBlocked ? "critical" : overdueDays >= 7 ? "high" : "medium",
        amount: balance,
        currency: invoice.currency,
        detectedAt: iso(now),
        facts: [
          fact("Status", invoice.status),
          fact("Balance due", `${balance.toLocaleString()} ${invoice.currency}`),
          fact("Overdue days", overdueDays),
          fact("Company", invoice.company?.name),
          fact("Contract status", invoice.contract?.status),
        ],
        sources: [
          source(invoice.invoiceNumber, "invoice", invoice.id, `/invoices/${invoice.id}`),
          ...(invoice.contract ? [source(invoice.contract.title, "contract", invoice.contract.id, `/contracts/${invoice.contract.id}`)] : []),
        ],
        recommendedActions: [
          createTaskAction(`Collect overdue invoice ${invoice.invoiceNumber}`, `Invoice is overdue by ${overdueDays} days. Confirm payment status and next reminder.`, "invoice", invoice.id),
          invoiceReminderAction(`Payment reminder for ${invoice.invoiceNumber}`, `Please review overdue invoice ${invoice.invoiceNumber}.`, "invoice", invoice.id),
        ],
      }
    })
}

export function buildOverdueBillSignals(
  bills: OverdueBillRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return bills
    .filter((bill) => decimalToNumber(bill.balanceDue) > 0 && bill.dueDate && bill.dueDate < now)
    .map((bill) => {
      const balance = decimalToNumber(bill.balanceDue)
      const overdueDays = daysBetween(now, bill.dueDate)
      return {
        id: `finance:overdue_bill:${bill.id}`,
        domain: "finance",
        domainLabel: domainLabel(capabilities, "finance"),
        entityType: "bill",
        entityId: bill.id,
        title: `${bill.billNumber} is overdue`,
        summary: `${balance.toLocaleString()} ${bill.currency} payable to ${bill.vendorName} is overdue by ${overdueDays} days.`,
        severity: overdueDays >= 30 || balance >= 10_000 ? "critical" : overdueDays >= 7 ? "high" : "medium",
        ownerId: bill.createdBy,
        amount: balance,
        currency: bill.currency,
        detectedAt: iso(now),
        facts: [
          fact("Status", bill.status),
          fact("Balance due", `${balance.toLocaleString()} ${bill.currency}`),
          fact("Overdue days", overdueDays),
          fact("Vendor", bill.vendorName),
          fact("Category", bill.category),
        ],
        sources: [source(bill.billNumber, "bill", bill.id, `/finance?tab=payables&billId=${bill.id}`)],
        recommendedActions: [
          createAlertAction(`Review overdue payable ${bill.billNumber}`, "Payable is overdue and may affect vendor commitments or cash-flow planning.", "bill", bill.id),
          createTaskAction(`Resolve overdue payable ${bill.billNumber}`, `Confirm payment plan for ${bill.vendorName} and update bill status.`, "bill", bill.id, bill.createdBy),
        ],
      }
    })
}

export function buildPaymentOrderSignals(
  orders: PaymentOrderRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return orders.map((order) => {
    const anchorDate = order.status === "approved" ? order.approvedAt || order.updatedAt : order.createdAt
    const waitingDays = daysBetween(now, anchorDate)
    const isExecutionRisk = order.status === "approved"
    return {
      id: `finance:payment_order:${order.id}`,
      domain: "finance",
      domainLabel: domainLabel(capabilities, "finance"),
      entityType: "payment_order",
      entityId: order.id,
      title: isExecutionRisk ? `${order.orderNumber} is approved but not executed` : `${order.orderNumber} waits for approval`,
      summary: isExecutionRisk
        ? `${order.amount.toLocaleString()} ${order.currency} has been approved for ${waitingDays} days without execution.`
        : `${order.amount.toLocaleString()} ${order.currency} has waited ${waitingDays} days for approval.`,
      severity: waitingDays >= 7 || order.amount >= 10_000 ? "high" : "medium",
      ownerId: isExecutionRisk ? order.approvedBy : order.createdBy,
      amount: order.amount,
      currency: order.currency,
      detectedAt: iso(now),
      facts: [
        fact("Status", order.status),
        fact("Counterparty", order.counterpartyName),
        fact("Amount", `${order.amount.toLocaleString()} ${order.currency}`),
        fact("Waiting days", waitingDays),
        fact("Purpose", order.purpose),
      ],
      sources: [source(order.orderNumber, "payment_order", order.id, `/finance?tab=payments&paymentOrderId=${order.id}`)],
      recommendedActions: [
        createAlertAction(`Review payment order ${order.orderNumber}`, "Payment order is stuck in the approval or execution flow.", "payment_order", order.id),
        createTaskAction(`Unblock payment order ${order.orderNumber}`, "Confirm approval, bank execution status and owner accountability.", "payment_order", order.id, isExecutionRisk ? order.approvedBy : order.createdBy),
      ],
    }
  })
}

async function collectSupportSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "support")) return []
  const agingTicketCutoff = new Date(now.getTime() - DAY_MS)
  const [tickets, repeatedTickets] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        organizationId,
        status: { notIn: ["resolved", "closed"] },
        OR: [
          { escalationLevel: { gt: 0 } },
          { slaFirstResponseDueAt: { lt: new Date(now.getTime() + 2 * 60 * 60 * 1000) } },
          { slaDueAt: { lt: new Date(now.getTime() + 4 * 60 * 60 * 1000) } },
          { createdAt: { lt: agingTicketCutoff } },
        ],
      },
      select: { id: true, ticketNumber: true, subject: true, priority: true, status: true, assignedTo: true, slaFirstResponseDueAt: true, slaDueAt: true, firstResponseAt: true, escalationLevel: true, createdAt: true, company: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    prisma.ticket.findMany({
      where: {
        organizationId,
        companyId: { not: null },
        status: { notIn: ["resolved", "closed"] },
        createdAt: { gte: new Date(now.getTime() - 14 * DAY_MS) },
      },
      select: { id: true, ticketNumber: true, subject: true, priority: true, status: true, assignedTo: true, companyId: true, createdAt: true, company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ])
  const slaSignals = buildSlaTicketSignals(tickets as SlaTicketRow[], capabilities, now)
  return [...slaSignals, ...buildRepeatedTicketSignals(repeatedTickets, capabilities, now)]
}

export function buildSlaTicketSignals(
  tickets: SlaTicketRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return tickets.map((ticket) => {
    const firstResponseBreach = !ticket.firstResponseAt && ticket.slaFirstResponseDueAt != null && ticket.slaFirstResponseDueAt < now
    const dueBreach = ticket.slaDueAt != null && ticket.slaDueAt < now
    const escalated = ticket.escalationLevel > 0
    const firstResponseMinutes = !ticket.firstResponseAt ? minutesUntil(now, ticket.slaFirstResponseDueAt) : null
    const resolutionMinutes = minutesUntil(now, ticket.slaDueAt)
    const ageDays = daysBetween(now, ticket.createdAt)
    const agingWithoutSla = !escalated && !firstResponseBreach && !dueBreach && firstResponseMinutes == null && resolutionMinutes == null && ageDays >= 1
    const slaMinuteFact = firstResponseBreach && firstResponseMinutes != null
      ? fact("First response breach minutes", Math.abs(firstResponseMinutes))
      : dueBreach && resolutionMinutes != null
        ? fact("Resolution breach minutes", Math.abs(resolutionMinutes))
        : firstResponseMinutes != null
          ? fact("SLA minutes remaining", Math.max(firstResponseMinutes, 0))
          : resolutionMinutes != null
            ? fact("SLA minutes remaining", Math.max(resolutionMinutes, 0))
            : null
    const needsPriorityUpdate = !["critical", "urgent", "high"].includes(ticket.priority)
    const actionContext = agingWithoutSla ? "this old open ticket" : "this ticket before the SLA is missed"
    const recommendedActions = [
      supportEscalationAction(`SLA risk: ${ticket.ticketNumber}`, `Escalate or assign ${actionContext}.`, "ticket", ticket.id, ticket.assignedTo),
      ...(!ticket.assignedTo ? [assignTicketOwnerAction(`Assign owner: ${ticket.ticketNumber}`, agingWithoutSla ? "Assign a support owner to close the old open ticket." : "Assign a support owner before the SLA is missed.", "ticket", ticket.id)] : []),
      ...(needsPriorityUpdate ? [priorityUpdateAction(`Raise priority: ${ticket.ticketNumber}`, agingWithoutSla ? "Raise ticket priority because the ticket is old and unresolved." : "Raise ticket priority because the SLA window is at risk.", "ticket", ticket.id, firstResponseBreach || dueBreach || escalated ? "urgent" : "high")] : []),
    ]
    const ticketState = escalated ? "escalated" : agingWithoutSla ? "aging" : "sla"
    return {
      id: `support:${ticketState}:${ticket.id}`,
      domain: "support",
      domainLabel: domainLabel(capabilities, "support"),
      entityType: "ticket",
      entityId: ticket.id,
      title: escalated ? `${ticket.ticketNumber} is escalated and unresolved` : agingWithoutSla ? `${ticket.ticketNumber} is aging` : `${ticket.ticketNumber} is at SLA risk`,
      summary: escalated ? `Ticket is at escalation level ${ticket.escalationLevel} and remains open.` : firstResponseBreach ? "First response SLA is breached." : dueBreach ? "Resolution SLA is breached." : agingWithoutSla ? `Ticket has been open for ${ageDays} ${ageDays === 1 ? "day" : "days"} without resolution.` : "SLA deadline is approaching.",
      severity: escalated || firstResponseBreach || dueBreach || ticket.priority === "critical" ? "critical" : ageDays >= 7 || ticket.priority === "high" ? "high" : "medium",
      ownerId: ticket.assignedTo,
      detectedAt: iso(now),
      facts: [
        fact("Status", ticket.status),
        fact("Priority", ticket.priority),
        fact("Escalation level", escalated ? ticket.escalationLevel : null),
        ...(agingWithoutSla ? [fact("Age days", ageDays)] : []),
        fact("Company", ticket.company?.name),
        fact("First response due", ticket.slaFirstResponseDueAt?.toISOString()),
        fact("SLA due", ticket.slaDueAt?.toISOString()),
        ...(slaMinuteFact ? [slaMinuteFact] : []),
      ],
      sources: [source(ticket.ticketNumber, "ticket", ticket.id, `/tickets/${ticket.id}`)],
      recommendedActions,
    }
  })
}

export function buildRepeatedTicketSignals(
  tickets: RepeatedTicketRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  const groups = new Map<string, {
    companyId: string
    companyName: string
    tickets: RepeatedTicketRow[]
    highPriority: number
  }>()

  for (const ticket of tickets) {
    if (!ticket.companyId) continue
    const group = groups.get(ticket.companyId) || {
      companyId: ticket.companyId,
      companyName: ticket.company?.name || ticket.companyId,
      tickets: [],
      highPriority: 0,
    }
    group.tickets.push(ticket)
    if (["critical", "urgent", "high"].includes(ticket.priority)) group.highPriority += 1
    groups.set(ticket.companyId, group)
  }

  return Array.from(groups.values())
    .filter((group) => group.tickets.length >= 3 || group.highPriority >= 2)
    .sort((a, b) => b.highPriority - a.highPriority || b.tickets.length - a.tickets.length)
    .slice(0, 8)
    .map((group) => {
      const latest = group.tickets[0]
      const title = `${group.companyName} has repeated open tickets`
      return {
        id: `support:repeated_company:${group.companyId}`,
        domain: "support",
        domainLabel: domainLabel(capabilities, "support"),
        entityType: "company",
        entityId: group.companyId,
        title,
        summary: `${group.tickets.length} open tickets from the same company in the last 14 days.`,
        severity: group.tickets.length >= 5 || group.highPriority >= 2 ? "high" : "medium",
        ownerId: latest?.assignedTo || null,
        detectedAt: iso(now),
        facts: [
          fact("Company", group.companyName),
          fact("Open tickets", group.tickets.length),
          fact("High priority tickets", group.highPriority),
          fact("Latest ticket", latest?.ticketNumber),
        ],
        sources: group.tickets.slice(0, 3).map((ticket) => source(ticket.ticketNumber, "ticket", ticket.id, `/tickets/${ticket.id}`)),
        recommendedActions: [
          supportEscalationAction(`Repeated support risk: ${group.companyName}`, "Review repeated tickets and identify the recurring customer issue.", "company", group.companyId, latest?.assignedTo),
          createTaskAction(`Review repeated tickets: ${group.companyName}`, "Identify root cause and assign owner for repeated support issues.", "company", group.companyId, latest?.assignedTo),
        ],
      }
    })
}

async function collectRouteSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "routes")) return []
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const [routes, openVisits] = await Promise.all([
    prisma.mtmRoute.findMany({
      where: {
        organizationId,
        deletedAt: null,
        date: today,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        totalPoints: true,
        visitedPoints: true,
        startedAt: true,
        agent: { select: { name: true, userId: true } },
        points: {
          where: {
            deletedAt: null,
            OR: [
              { visitedAt: { not: null } },
              { status: "PENDING", plannedTime: { lt: new Date(now.getTime() - 30 * 60 * 1000) } },
            ],
          },
          select: { status: true, plannedTime: true, visitedAt: true, customer: { select: { name: true } } },
          orderBy: [{ visitedAt: "desc" }, { plannedTime: "asc" }],
          take: 8,
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 12,
    }).catch(() => []),
    prisma.mtmVisit.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: "CHECKED_IN",
        checkInAt: { lt: new Date(now.getTime() - 90 * 60 * 1000) },
      },
      select: { id: true, status: true, checkInAt: true, agent: { select: { name: true, userId: true } }, customer: { select: { name: true } } },
      orderBy: { checkInAt: "asc" },
      take: 10,
    }).catch(() => []),
  ])
  return [...buildRouteRiskSignals(routes, capabilities, now), ...buildOpenVisitSignals(openVisits, capabilities, now)]
}

export function buildRouteRiskSignals(
  routes: RouteRiskRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return routes
    .filter((route) => route.status === "PLANNED" || route.visitedPoints < route.totalPoints)
    .map((route) => {
      const completion = route.totalPoints > 0 ? Math.round((route.visitedPoints / route.totalPoints) * 100) : 0
      const lastVisitedAt = route.points?.filter((point) => point.visitedAt).sort((a, b) => (b.visitedAt?.getTime() || 0) - (a.visitedAt?.getTime() || 0))[0]?.visitedAt || null
      const missedPoint = route.points
        ?.filter((point) => point.status === "PENDING" && point.plannedTime && point.plannedTime < now)
        .sort((a, b) => (a.plannedTime?.getTime() || 0) - (b.plannedTime?.getTime() || 0))[0] || null
      const breakMinutes = lastVisitedAt ? Math.max(0, Math.floor((now.getTime() - lastVisitedAt.getTime()) / 60000)) : 0
      const missedMinutes = missedPoint?.plannedTime ? Math.max(0, Math.floor((now.getTime() - missedPoint.plannedTime.getTime()) / 60000)) : 0
      const routeDeviation = missedPoint != null && missedMinutes >= 30
      const longBreak = route.status === "IN_PROGRESS" && route.visitedPoints > 0 && route.visitedPoints < route.totalPoints && breakMinutes >= 90
      const riskKind = routeDeviation ? "deviation" : longBreak ? "long_break" : "coverage"
      return {
        id: `routes:${riskKind}:${route.id}`,
        domain: "routes",
        domainLabel: domainLabel(capabilities, "routes"),
        entityType: "mtm_route",
        entityId: route.id,
        title: routeDeviation ? `${route.name || "Route"} missed a planned stop` : longBreak ? `${route.name || "Route"} has a long field break` : `${route.name || "Route"} is behind plan`,
        summary: routeDeviation
          ? `${missedPoint.customer?.name || "A planned stop"} is ${missedMinutes} minutes behind schedule.`
          : longBreak
            ? `No route point has been completed for ${breakMinutes} minutes.`
            : `${route.visitedPoints}/${route.totalPoints} points visited today.`,
        severity: routeDeviation ? "high" : longBreak ? "high" : route.status === "PLANNED" && now.getHours() >= 11 ? "critical" : completion < 50 && now.getHours() >= 15 ? "high" : "medium",
        ownerId: route.agent.userId,
        ownerLabel: route.agent.name,
        detectedAt: iso(now),
        facts: [
          fact("Agent", route.agent.name),
          fact("Status", route.status),
          fact("Visited", `${route.visitedPoints}/${route.totalPoints}`),
          fact("Completion", `${completion}%`),
          fact("Break minutes", longBreak ? breakMinutes : null),
          fact("Missed stop", routeDeviation ? missedPoint.customer?.name : null),
          fact("Delay minutes", routeDeviation ? missedMinutes : null),
        ],
        sources: [source(route.name || "Route", "mtm_route", route.id, `/mtm/routes?routeId=${route.id}`)],
        recommendedActions: [flagRouteIssueAction(
          `Route issue: ${route.name || route.agent.name}`,
          routeDeviation
            ? "A planned stop is late. Check route deviation, agent location and customer priority."
            : longBreak
              ? "Route has a long gap after the last visited point. Check agent status and next stop."
              : "Route is behind plan. Check skipped points and supervisor action.",
          "mtm_route",
          route.id,
          route.agent.userId,
        )],
      }
    })
}

export function buildOpenVisitSignals(
  visits: OpenVisitRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return visits
    .map((visit) => {
      const openMinutes = Math.max(0, Math.floor((now.getTime() - visit.checkInAt.getTime()) / 60000))
      const agentName = visit.agent.name || visit.agent.userId || "Field agent"
      const customerName = visit.customer.name || "Customer"
      return {
        id: `routes:open_visit:${visit.id}`,
        domain: "routes",
        domainLabel: domainLabel(capabilities, "routes"),
        entityType: "mtm_visit",
        entityId: visit.id,
        title: `${agentName} has a stale open visit`,
        summary: `Checked in at ${customerName} for ${openMinutes} minutes without checkout.`,
        severity: openMinutes >= 180 ? "high" : "medium",
        ownerId: visit.agent.userId,
        ownerLabel: agentName,
        detectedAt: iso(now),
        facts: [
          fact("Agent", agentName),
          fact("Customer", customerName),
          fact("Open minutes", openMinutes),
          fact("Status", visit.status),
        ],
        sources: [source(customerName, "mtm_visit", visit.id, `/mtm/visits?visitId=${visit.id}`)],
        recommendedActions: [
          flagRouteIssueAction(`Open visit needs checkout: ${customerName}`, "Check whether the field visit is still active or needs supervisor checkout.", "mtm_visit", visit.id, visit.agent.userId),
          createTaskAction(`Review open visit: ${customerName}`, "Confirm visit status, checkout timing and any skipped route points.", "mtm_visit", visit.id, visit.agent.userId),
        ],
      }
    })
}

async function collectMtmSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "mtm")) return []
  const photos = await prisma.mtmPhoto.findMany({
    where: { organizationId, status: { in: ["PENDING", "REJECTED"] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
    select: { id: true, category: true, status: true, createdAt: true, agent: { select: { name: true, userId: true } }, visitId: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  }).catch(() => [])
  return buildPhotoReviewSignals(photos, capabilities, now)
}

export function buildPhotoReviewSignals(
  photos: MtmPhotoReviewRow[],
  capabilities: AdvisorCapability[],
  now: Date,
): AdvisorSignal[] {
  return photos.map((photo) => ({
    id: `mtm:photo_review:${photo.id}`,
    domain: "mtm",
    domainLabel: domainLabel(capabilities, "mtm"),
    entityType: "mtm_photo",
    entityId: photo.id,
    title: photo.status === "REJECTED" ? "Visit photo was rejected" : "Visit photo needs review",
    summary: `Agent ${photo.agent.name || "Field agent"} has a ${photo.status.toLowerCase()} photo from the last 7 days.`,
    severity: photo.status === "REJECTED" ? "high" : "medium",
    ownerId: photo.agent.userId,
    ownerLabel: photo.agent.name,
    detectedAt: iso(now),
    facts: [fact("Agent", photo.agent.name), fact("Category", photo.category), fact("Status", photo.status)],
    sources: [source("Photo", "mtm_photo", photo.id, `/mtm/photos?photoId=${photo.id}`)],
    recommendedActions: [createTaskAction("Review visit photo", "Check photo quality and request a retake if needed.", "mtm_photo", photo.id, photo.agent.userId)],
  }))
}

async function collectKpiSignals(organizationId: string, capabilities: AdvisorCapability[], now: Date): Promise<AdvisorSignal[]> {
  if (!isActive(capabilities, "kpi")) return []
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const tasks = await prisma.task.findMany({
    where: {
      organizationId,
      assignedTo: { not: null },
      OR: [
        { createdAt: { gte: monthStart, lt: nextMonth } },
        { dueDate: { gte: monthStart, lt: nextMonth } },
        { completedAt: { gte: monthStart, lt: nextMonth } },
        { status: { notIn: ["completed", "done", "cancelled"] }, dueDate: { lt: now } },
      ],
    },
    select: {
      id: true,
      assignedTo: true,
      status: true,
      dueDate: true,
      createdAt: true,
      completedAt: true,
      assignee: { select: { name: true, email: true } },
    },
    take: 400,
  }).catch(() => [])
  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId,
      assignedTo: { not: null },
      firstResponseAt: null,
      status: { notIn: ["resolved", "closed", "cancelled"] },
      OR: [
        { slaFirstResponseDueAt: { lte: now } },
        { createdAt: { lt: new Date(now.getTime() - DAY_MS) } },
      ],
    },
    select: {
      id: true,
      assignedTo: true,
      status: true,
      createdAt: true,
      firstResponseAt: true,
      slaFirstResponseDueAt: true,
      assignee: { select: { name: true, email: true } },
    },
    take: 200,
  }).catch(() => [])

  return buildKpiOwnerSignals(tasks, capabilities, now, monthStart, tickets)
}

export function buildKpiOwnerSignals(
  tasks: KpiOwnerTaskRow[],
  capabilities: AdvisorCapability[],
  now: Date,
  monthStart = new Date(now.getFullYear(), now.getMonth(), 1),
  tickets: KpiOwnerTicketRow[] = [],
): AdvisorSignal[] {
  const aggregates = new Map<string, KpiOwnerAggregate>()
  for (const task of tasks) {
    if (!task.assignedTo) continue
    const owner = aggregates.get(task.assignedTo) || {
      ownerId: task.assignedTo,
      ownerLabel: task.assignee?.name || task.assignee?.email || task.assignedTo,
      planned: 0,
      completed: 0,
      overdueOpen: 0,
      oldestOverdueDays: 0,
      responseGaps: 0,
      oldestResponseGapHours: 0,
    }
    const dueThisMonth = task.dueDate != null && task.dueDate >= monthStart
    const createdThisMonth = task.createdAt >= monthStart
    const completedThisMonth = task.completedAt != null && task.completedAt >= monthStart
    const closed = ["completed", "done", "cancelled"].includes(task.status)
    if (dueThisMonth || createdThisMonth) owner.planned += 1
    if ((closed && task.status !== "cancelled") || completedThisMonth) owner.completed += 1
    if (!closed && task.dueDate != null && task.dueDate < now) {
      owner.overdueOpen += 1
      owner.oldestOverdueDays = Math.max(owner.oldestOverdueDays, daysBetween(now, task.dueDate))
    }
    aggregates.set(owner.ownerId, owner)
  }
  for (const ticket of tickets) {
    if (!ticket.assignedTo || ticket.firstResponseAt) continue
    const responseDueAt = ticket.slaFirstResponseDueAt || new Date(ticket.createdAt.getTime() + DAY_MS)
    if (responseDueAt > now) continue
    const owner = aggregates.get(ticket.assignedTo) || {
      ownerId: ticket.assignedTo,
      ownerLabel: ticket.assignee?.name || ticket.assignee?.email || ticket.assignedTo,
      planned: 0,
      completed: 0,
      overdueOpen: 0,
      oldestOverdueDays: 0,
      responseGaps: 0,
      oldestResponseGapHours: 0,
    }
    owner.responseGaps += 1
    owner.oldestResponseGapHours = Math.max(owner.oldestResponseGapHours, Math.round((now.getTime() - responseDueAt.getTime()) / 3600000))
    aggregates.set(owner.ownerId, owner)
  }

  return Array.from(aggregates.values())
    .filter((owner) => owner.responseGaps > 0 || owner.overdueOpen > 0 || (owner.planned > 0 && owner.completed / Math.max(owner.planned, 1) < 0.6))
    .sort((a, b) => b.responseGaps - a.responseGaps || b.overdueOpen - a.overdueOpen || a.completed / Math.max(a.planned, 1) - b.completed / Math.max(b.planned, 1))
    .slice(0, 8)
    .map((owner) => {
      const completionRate = owner.planned > 0 ? Math.round((owner.completed / owner.planned) * 100) : 0
      const overdueTaskLabel = owner.overdueOpen === 1 ? "task" : "tasks"
      const title = owner.overdueOpen > 0
        ? `${owner.ownerLabel} has ${owner.overdueOpen} overdue ${overdueTaskLabel}`
        : owner.responseGaps > 0
          ? `${owner.ownerLabel} has ${owner.responseGaps} response gaps`
        : `${owner.ownerLabel} is behind this month's action plan`
      return {
        id: `kpi:owner_plan:${owner.ownerId}`,
        domain: "kpi",
        domainLabel: domainLabel(capabilities, "kpi"),
        entityType: "user",
        entityId: owner.ownerId,
        title,
        summary: "Manager plan risk. Review monthly actions, overdue work, response gaps and owner scope.",
        severity: owner.overdueOpen >= 8 || owner.responseGaps >= 4 || (owner.planned >= 5 && completionRate < 40) ? "high" : "medium",
        ownerId: owner.ownerId,
        ownerLabel: owner.ownerLabel,
        detectedAt: iso(now),
        facts: [
          fact("Planned actions this month", owner.planned),
          fact("Completed actions", owner.completed),
          fact("Completion rate", `${completionRate}%`),
          fact("Overdue open tasks", owner.overdueOpen),
          fact("Oldest overdue days", owner.oldestOverdueDays),
          fact("Response gaps", owner.responseGaps),
          fact("Oldest response gap hours", owner.oldestResponseGapHours),
        ],
        sources: [
          source("Manager task scope", "user", owner.ownerId, `/tasks?assignedTo=${owner.ownerId}`),
          ...(owner.responseGaps > 0 ? [source("Manager ticket scope", "user", owner.ownerId, `/tickets?assignedTo=${owner.ownerId}`)] : []),
        ],
        recommendedActions: [kpiPlanReviewAction("Review manager action plan", "Check planned vs completed actions, overdue work, response gaps and redistribution needs.", "user", owner.ownerId, owner.ownerId)],
      }
    })
}
