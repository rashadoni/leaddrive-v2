import type { ModuleId } from "@/lib/modules"

export type AdvisorDomainKey =
  | "crm"
  | "sales"
  | "contracts"
  | "marketing"
  | "tasks"
  | "finance"
  | "support"
  | "routes"
  | "mtm"
  | "kpi"

export type AdvisorSeverity = "critical" | "high" | "medium" | "low"
export type AdvisorCapabilityStatus = "active" | "locked" | "no_access"
export type AdvisorActionRisk = "low" | "medium" | "high" | "dangerous"
export type AdvisorCollectorStatus = "active" | "no_data" | "disabled" | "no_permission" | "collector_failed"

export interface AdvisorCapability {
  key: AdvisorDomainKey
  label: string
  moduleId: ModuleId
  status: AdvisorCapabilityStatus
  reason?: string
  href?: string
}

export interface AdvisorCollectorHealth {
  domain: AdvisorDomainKey
  domainLabel: string
  status: AdvisorCollectorStatus
  signalCount: number
  checkedAt: string
  reason?: string
}

export interface AdvisorSourceRef {
  label: string
  entityType: string
  entityId: string
  href: string
}

export interface AdvisorFact {
  label: string
  value: string
}

export type AdvisorSignalMetricKind = "money" | "days" | "minutes" | "percent" | "count" | "score"

export interface AdvisorSignalMetric {
  kind: AdvisorSignalMetricKind
  label: string
  value: number
  unit?: string
  formatted: string
}

export interface AdvisorSignalFreshness {
  checkedAt: string
  detectedAt: string
  ageMinutes: number
}

export interface AdvisorSignalConfidence {
  level: "high" | "medium" | "low"
  reason: string
}

export interface AdvisorSignalTimelineEvent {
  label: string
  at: string
  description: string
  source?: AdvisorSourceRef
}

export interface AdvisorImpactEstimate {
  label: string
  value: string
  severity: AdvisorSeverity
  basis: string
  moneyAtRisk?: number | null
  currency?: string | null
}

export interface AdvisorDryRunPreview {
  actionType: string
  title: string
  creates?: string[]
  updates?: string[]
  notifications?: string[]
  externalSideEffects?: string[]
  payload: Record<string, unknown>
}

export interface AdvisorRollbackPreview {
  mode: "automatic" | "manual" | "not_required"
  summary: string
  steps: string[]
}

export interface AdvisorAction {
  actionType: string
  label: string
  risk: AdvisorActionRisk
  payload: Record<string, unknown>
}

export interface AdvisorSignal {
  id: string
  domain: AdvisorDomainKey
  domainLabel: string
  entityType: string
  entityId: string
  title: string
  summary: string
  severity: AdvisorSeverity
  ownerId?: string | null
  ownerLabel?: string | null
  amount?: number | null
  currency?: string | null
  metric?: AdvisorSignalMetric | null
  collectorKey?: AdvisorDomainKey
  healthStatus?: AdvisorCollectorStatus
  freshness?: AdvisorSignalFreshness
  confidence?: AdvisorSignalConfidence
  safetyNote?: string | null
  timeline?: AdvisorSignalTimelineEvent[]
  impact?: AdvisorImpactEstimate
  dryRunPreview?: AdvisorDryRunPreview
  rollbackPreview?: AdvisorRollbackPreview
  detectedAt: string
  facts: AdvisorFact[]
  sources: AdvisorSourceRef[]
  recommendedActions: AdvisorAction[]
}

export interface AdvisorOverview {
  totalSignals: number
  critical: number
  high: number
  medium: number
  low: number
  revenueAtRisk: number
  pendingActions: number
}

export interface AdvisorPayload {
  capabilities: AdvisorCapability[]
  collectorHealth: AdvisorCollectorHealth[]
  overview: AdvisorOverview
  signals: AdvisorSignal[]
}

export type AdvisorQueryIntent = "overview" | "money" | "routes" | "support" | "tasks" | "sales" | "contracts" | "marketing" | "field" | "kpi"
export type AdvisorQueryDateScope = "all" | "today" | "week" | "month"

export interface AdvisorQueryRouting {
  intent: AdvisorQueryIntent
  domains: AdvisorDomainKey[]
  severities: AdvisorSeverity[]
  metricKinds: AdvisorSignalMetricKind[]
  owner?: {
    key: string
    label: string
  }
  dateScope: AdvisorQueryDateScope
  terms: string[]
}

export interface AdvisorAnswer {
  intent: AdvisorQueryIntent
  answer: string
  facts: AdvisorFact[]
  sources: AdvisorSourceRef[]
  recommendations: AdvisorAction[]
  signals: AdvisorSignal[]
  scope: {
    organizationId: string
    userId: string
    role: string
    domains: AdvisorDomainKey[]
    totalSignals: number
    filteredSignals: number
    returnedSignals: number
    routing: AdvisorQueryRouting
    generatedAt: string
  }
}
