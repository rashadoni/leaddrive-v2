import { useMemo, useState, type ReactNode, type RefObject } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, CheckCircle2, Clock3, FileText, Inbox, Loader2, Lock, MessageSquareText, MousePointer2, Search, ShieldCheck, Sparkles, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  advisorPreviewValue,
  buildAdvisorActionPreviewEntries,
  buildAdvisorEditablePayloadFields,
  type AdvisorActionEditableField,
  type AdvisorActionPreviewEntry,
} from "@/lib/ai/advisor/action-preview"
import type { AdvisorBriefingItem } from "@/lib/ai/advisor/briefing"
import type { AdvisorAction, AdvisorAnswer, AdvisorCapability, AdvisorCollectorHealth, AdvisorDomainKey, AdvisorSignal } from "@/lib/ai/advisor/types"

export interface AdvisorFactPreview {
  label: string
  value: string
}

export interface AdvisorSourcePreview {
  label: string
  entityType: string
  entityId: string
  href: string
}

export interface ShadowPayload extends Record<string, unknown> {
  advisor?: {
    actionLabel?: string
    title?: string
    summary?: string
    severity?: string
    domain?: string
    ownerId?: string | null
    ownerLabel?: string | null
    facts?: AdvisorFactPreview[]
    sources?: AdvisorSourcePreview[]
  }
  title?: string
  subject?: string
}

export interface ShadowEvidence {
  title?: string
  summary?: string
  facts?: AdvisorFactPreview[]
  sources?: AdvisorSourcePreview[]
  detectedAt?: string
}

export interface ShadowAction {
  id: string
  featureName: string
  entityType: string
  entityId: string
  actionType: string
  payload: ShadowPayload
  evidenceSnapshot?: ShadowEvidence | null
  riskLevel?: string
  approved: boolean | null
  executionStatus?: string
  failureReason?: string | null
  createdAt: string
  reviewedAt?: string | null
  reviewedBy?: string | null
  executedAt?: string | null
}

export interface AdvisorScenarioItem {
  key: string
  label: string
  description: string
  count: number
  value: string
  detail?: string
  tone?: "critical" | "money" | "healthy" | "info"
}

type AdvisorActionPanelCopy = {
  actionTrail: string
  pendingActions: string
  recentDecisions: string
  noPending: string
  noHistory: string
  historyFilters: string
  historyShowing: string
  allStatuses: string
  allDates: string
  allModules: string
  allOwners: string
  approvedStatus: string
  todayDate: string
  weekDate: string
  monthDate: string
  unassigned: string
  preview: string
  target: string
  approve: string
  reject: string
  edit: string
  save: string
  cancel: string
  evidence: string
  noEvidence: string
  reviewPreviewHint: string
  approvalQueueHelp: string
  reviewDetails: string
  executionTrail: string
  executionTrailDesc: string
  executionFailed: string
  editFields: string
  queuedStatus: string
  rejected: string
  executed: string
  failed: string
  executing: string
  actionTypes: Record<string, string>
  actionRisks: Record<string, string>
  severities: Record<string, string>
  domains: Record<string, string>
  previewFields: {
    taskTitle: string
    alertTitle: string
    noteSubject: string
    followupSubject: string
    budgetTitle: string
    description: string
    message: string
    body: string
    assignee: string
    priority: string
    amount: string
    relatedRecord: string
    company: string
    invoice: string
    daysOverdue: string
  }
}

type AdvisorActionDisplayLocalizers = {
  title?: (title: string) => string
  summary?: (summary: string) => string
  factLabel?: (fact: AdvisorFactPreview) => string
  factValue?: (fact: AdvisorFactPreview) => string
  previewValue?: (value: string) => string
}

function briefingToneClasses(tone?: AdvisorBriefingItem["tone"]) {
  if (tone === "critical") return "border-red-200 bg-red-50/70 text-red-900 hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200"
  if (tone === "money") return "border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:border-emerald-300 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200"
  if (tone === "info") return "border-blue-200 bg-blue-50/70 text-blue-900 hover:border-blue-300 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200"
  if (tone === "healthy") return "border-zinc-200 bg-zinc-50 text-zinc-900 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
  return "border-zinc-200 bg-background text-foreground hover:border-primary/50 dark:border-zinc-700"
}

function isTechnicalOwnerId(value?: string | null) {
  // A "technical" owner isn't a real display name: a CUID (c + 20+ chars) or a
  // bare numeric id (e.g. "1"/"5") that used to leak into the UI as the owner.
  if (typeof value !== "string") return false
  const v = value.trim()
  return /^c[a-z0-9]{20,}$/i.test(v) || /^\d+$/.test(v)
}

function displayOwnerLabel(signal: AdvisorSignal, fallback: string) {
  if (signal.ownerLabel && !isTechnicalOwnerId(signal.ownerLabel)) return signal.ownerLabel
  if (signal.ownerId && !isTechnicalOwnerId(signal.ownerId)) return signal.ownerId
  return fallback
}

function actionTimestamp(action: ShadowAction) {
  return Date.parse(action.executedAt || action.reviewedAt || action.createdAt)
}

function actionHistoryStatus(action: ShadowAction) {
  if (["queued", "executing", "executed", "failed", "rejected"].includes(action.executionStatus || "")) {
    return action.executionStatus || "pending"
  }
  if (action.approved === true) return "approved"
  if (action.approved === false) return "rejected"
  return "pending"
}

function actionModuleKey(action: ShadowAction) {
  return action.payload.advisor?.domain || action.entityType || "unknown"
}

function actionModuleLabel(action: ShadowAction, copy: AdvisorActionPanelCopy) {
  const key = actionModuleKey(action)
  return advisorEntityLabel(copy, key)
}

function actionOwnerOption(action: ShadowAction, unassigned: string) {
  const advisor = action.payload.advisor
  const ownerLabel = typeof advisor?.ownerLabel === "string" ? advisor.ownerLabel : null
  const ownerId = typeof advisor?.ownerId === "string" ? advisor.ownerId : null

  if (ownerLabel && !isTechnicalOwnerId(ownerLabel)) {
    return { key: ownerId || ownerLabel, label: ownerLabel }
  }
  if (ownerId && !isTechnicalOwnerId(ownerId)) {
    return { key: ownerId, label: ownerId }
  }
  return { key: "unassigned", label: unassigned }
}

function actionMatchesHistoryDate(action: ShadowAction, filter: string, now = Date.now()) {
  if (filter === "all") return true
  const ts = actionTimestamp(action)
  if (!Number.isFinite(ts)) return false
  if (filter === "today") {
    return new Date(ts).toDateString() === new Date(now).toDateString()
  }
  const days = filter === "week" ? 7 : 30
  return ts >= now - days * 24 * 60 * 60 * 1000
}

function filterHistoryActions(actions: ShadowAction[], filters: {
  status: string
  module: string
  owner: string
  date: string
}) {
  return actions.filter((action) => {
    if (filters.status !== "all" && actionHistoryStatus(action) !== filters.status) return false
    if (filters.module !== "all" && actionModuleKey(action) !== filters.module) return false
    if (filters.owner !== "all" && actionOwnerOption(action, "unassigned").key !== filters.owner) return false
    if (!actionMatchesHistoryDate(action, filters.date)) return false
    return true
  })
}

function scenarioToneClasses(tone: AdvisorScenarioItem["tone"]) {
  if (tone === "critical") return "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
  if (tone === "money") return "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
  if (tone === "healthy") return "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50"
  return "border-zinc-200 bg-card text-foreground hover:bg-muted/40 dark:border-zinc-700"
}

export function DailyBriefingStrip({
  title,
  emptyText,
  keyboardHint,
  items,
  onSelect,
}: {
  title: string
  emptyText: string
  keyboardHint: string
  items: AdvisorBriefingItem[]
  onSelect: (signalId: string) => void
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="hidden text-[11px] text-muted-foreground md:inline">{keyboardHint}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-background px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">{emptyText}</p>
      ) : (
        <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))]">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={!item.signalId}
              onClick={() => item.signalId && onSelect(item.signalId)}
              className={`min-h-[72px] min-w-0 rounded-lg border p-3 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${briefingToneClasses(item.tone)}`}
            >
              <div className="text-[11px] font-medium text-current/70">{item.label}</div>
              <div className="mt-1 text-lg font-semibold leading-none">{item.value}</div>
              <div className="mt-2 line-clamp-2 text-xs text-current/75">{item.detail}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function AdvisorScenarioLauncher({
  labels,
  dateScopes,
  selectedDateScope,
  scenarios,
  onScenarioSelect,
  onOpenModules,
  onDateScopeChange,
}: {
  labels: {
    title: string
    description: string
    noScenarios: string
    modules: string
    dateScope: string
  }
  dateScopes: Array<{ value: string; label: string }>
  selectedDateScope: string
  scenarios: AdvisorScenarioItem[]
  onScenarioSelect: (key: string) => void
  onOpenModules: () => void
  onDateScopeChange: (scope: string) => void
}) {
  const activeScenarios = scenarios.filter((scenario) => scenario.count > 0)
  return (
    <section className="rounded-2xl border border-orange-100/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,247,237,0.68),rgba(255,255,255,0.98))] p-4 shadow-sm dark:border-orange-900/35 dark:bg-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-3xl font-semibold leading-tight text-foreground">
            <Sparkles className="h-7 w-7 shrink-0 text-orange-600 dark:text-orange-300" />
            {labels.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{labels.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
            <span className="px-2 text-[11px] font-medium text-muted-foreground">{labels.dateScope}</span>
            {dateScopes.map((scope) => (
              <Button
                key={scope.value}
                type="button"
                size="sm"
                variant={selectedDateScope === scope.value ? "secondary" : "ghost"}
                className="h-7 rounded-full px-3"
                onClick={() => onDateScopeChange(scope.value)}
              >
                {scope.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" className="rounded-full bg-white/80 shadow-sm dark:bg-zinc-950/40" onClick={onOpenModules}>
            <BarChart3 className="h-3.5 w-3.5" />
            {labels.modules}
          </Button>
        </div>
      </div>

      {activeScenarios.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-zinc-200 bg-background px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">{labels.noScenarios}</p>
      ) : (
        <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          {activeScenarios.map((scenario) => (
            <button
              key={scenario.key}
              type="button"
              onClick={() => onScenarioSelect(scenario.key)}
              className={`group min-h-[148px] min-w-0 rounded-xl border p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 ${scenarioToneClasses(scenario.tone)}`}
            >
              <div className="flex h-full flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-xl font-semibold leading-tight">{scenario.label}</p>
                    <p className="mt-2 line-clamp-2 text-sm leading-5 text-current/75">{scenario.description}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 bg-white/75 text-current shadow-sm dark:bg-zinc-950/40">
                    {scenario.value}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  {scenario.detail ? <p className="min-w-0 truncate text-sm font-medium text-current/75">{scenario.detail}</p> : <span />}
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-current shadow-sm transition-transform group-hover:translate-x-0.5 dark:bg-zinc-950/40">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string | number
  tone?: "critical" | "money" | "healthy"
}) {
  const toneClasses = tone === "critical"
    ? {
      card: "border-red-200/80 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20",
      icon: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
      value: "text-red-700 dark:text-red-300",
    }
    : tone === "money" || tone === "healthy"
      ? {
        card: "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20",
        icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        value: "text-emerald-700 dark:text-emerald-300",
      }
      : {
        card: "border-zinc-200 bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/50",
        icon: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
        value: "text-foreground",
      }
  return (
    <div className={`group flex min-h-[92px] min-w-[10.5rem] flex-1 basis-[11rem] items-center gap-3 rounded-xl border px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${toneClasses.card}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${toneClasses.icon}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[12px] font-medium leading-tight text-muted-foreground">{label}</div>
        <div className={`mt-1 truncate text-2xl font-semibold leading-none tabular-nums ${toneClasses.value}`}>{value}</div>
      </div>
    </div>
  )
}

export function AdvisorKpiStrip({
  tiles,
}: {
  tiles: Array<{
    key: string
    icon: ReactNode
    label: string
    value: string | number
    tone?: "critical" | "money" | "healthy"
  }>
}) {
  return (
    <section className="rounded-2xl border border-orange-100/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,247,237,0.62),rgba(255,255,255,0.98))] p-2 shadow-sm dark:border-orange-900/35 dark:bg-card">
      <div className="flex flex-wrap gap-2">
        {tiles.map((tile) => (
          <SummaryTile
            key={tile.key}
            icon={tile.icon}
            label={tile.label}
            value={tile.value}
            tone={tile.tone}
          />
        ))}
      </div>
    </section>
  )
}

export function AdvisorGuidedFlow({
  labels,
}: {
  labels: {
    flow: string
    signalStep: string
    evidenceStep: string
    actionStep: string
    approvalStep: string
    approvalRequired: string
  }
}) {
  const steps = [
    { key: "signal", label: labels.signalStep, icon: <AlertTriangle className="h-4 w-4" /> },
    { key: "evidence", label: labels.evidenceStep, icon: <FileText className="h-4 w-4" /> },
    { key: "action", label: labels.actionStep, icon: <Inbox className="h-4 w-4" /> },
    { key: "approval", label: labels.approvalStep, icon: <ShieldCheck className="h-4 w-4" /> },
  ]

  return (
    <section className="rounded-2xl border border-orange-100/80 bg-white/90 p-3 shadow-sm dark:border-orange-900/35 dark:bg-card sm:p-4" data-tour-id="ai-actions-flow">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          {labels.flow}
        </Badge>
        <span className="text-xs font-medium text-muted-foreground">{labels.approvalRequired}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step.key} className="relative rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-orange-600 shadow-sm dark:bg-zinc-900 dark:text-orange-300">
                {step.icon}
              </span>
              <span className="min-w-0 truncate text-sm font-semibold">{step.label}</span>
            </div>
            {index < steps.length - 1 ? (
              <ArrowRight className="absolute -right-4 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-orange-400 sm:block" />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export function AdvisorCommandStrip({
  inputRef,
  question,
  asking,
  labels,
  dateScopes,
  selectedDateScope,
  commandFilters,
  selectedCommandFilter,
  commandFilterLabel,
  onQuestionChange,
  onSubmitQuestion,
  onOpenModules,
  onDateScopeChange,
  onCommandFilterChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  question: string
  asking: boolean
  labels: {
    askPlaceholder: string
    askButton: string
    modules: string
    dateScope: string
    quickFilters: string
    keyboardHint: string
  }
  dateScopes: Array<{ value: string; label: string }>
  selectedDateScope: string
  commandFilters: string[]
  selectedCommandFilter: string
  commandFilterLabel: (filter: string) => string
  onQuestionChange: (value: string) => void
  onSubmitQuestion: () => void
  onOpenModules: () => void
  onDateScopeChange: (scope: string) => void
  onCommandFilterChange: (filter: string) => void
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-700">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmitQuestion()
            }}
            placeholder={labels.askPlaceholder}
            className="h-10 pl-8"
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-background p-1 dark:border-zinc-700">
            <span className="px-2 text-[11px] font-medium text-muted-foreground">{labels.dateScope}</span>
            {dateScopes.map((scope) => (
              <Button
                key={scope.value}
                type="button"
                size="sm"
                variant={selectedDateScope === scope.value ? "secondary" : "ghost"}
                className="h-8 px-3"
                onClick={() => onDateScopeChange(scope.value)}
              >
                {scope.label}
              </Button>
            ))}
          </div>
          <Button onClick={onSubmitQuestion} disabled={asking || !question.trim()}>
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
            {labels.askButton}
          </Button>
          <Button variant="outline" onClick={onOpenModules}>
            <BarChart3 className="h-3.5 w-3.5" />
            {labels.modules}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{labels.quickFilters}</span>
        {commandFilters.map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={selectedCommandFilter === filter ? "secondary" : "outline"}
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => onCommandFilterChange(filter)}
          >
            {commandFilterLabel(filter)}
          </Button>
        ))}
        <span className="ml-auto hidden text-[11px] text-muted-foreground md:inline">{labels.keyboardHint}</span>
      </div>
    </section>
  )
}

export function AdvisorFilters({
  domains,
  owners,
  selectedDomain,
  selectedOwner,
  labels,
  onDomainChange,
  onOwnerChange,
}: {
  domains: Array<{ key: AdvisorDomainKey; label: string; count: number }>
  owners: Array<{ key: string; label: string; count: number }>
  selectedDomain: "all" | AdvisorDomainKey
  selectedOwner: string
  labels: {
    allModules: string
    allOwners: string
    unassigned: string
  }
  onDomainChange: (value: "all" | AdvisorDomainKey) => void
  onOwnerChange: (value: string) => void
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-1.5 pb-1">
        <Button size="sm" variant={selectedDomain === "all" ? "default" : "outline"} className="h-9" onClick={() => onDomainChange("all")}>
          {labels.allModules}
        </Button>
        {domains.slice(0, 10).map((domain) => (
          <Button
            key={domain.key}
            size="sm"
            variant={selectedDomain === domain.key ? "default" : "outline"}
            className="h-9"
            onClick={() => onDomainChange(domain.key)}
          >
            {domain.label}
            <span className="ml-1 text-[11px] opacity-70">{domain.count}</span>
          </Button>
        ))}
      </div>
      {owners.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pb-1">
          <Button size="sm" variant={selectedOwner === "all" ? "secondary" : "outline"} className="h-9" onClick={() => onOwnerChange("all")}>
            {labels.allOwners}
          </Button>
          {owners.slice(0, 8).map((owner) => (
            <Button
              key={owner.key}
              size="sm"
              variant={selectedOwner === owner.key ? "secondary" : "outline"}
              className="h-9"
              onClick={() => onOwnerChange(owner.key)}
            >
              {isTechnicalOwnerId(owner.label) ? labels.unassigned : owner.label}
              <span className="ml-1 text-[11px] opacity-70">{owner.count}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function RiskRow({
  signal,
  active,
  compact = false,
  displayTitle,
  displaySummary,
  activeLabel,
  openDetailLabel,
  onSelect,
  severityClassName,
  severityLabel,
  domainLabel,
  moneyLabel,
  actionTypeLabel,
  actionLabel,
}: {
  signal: AdvisorSignal
  active: boolean
  compact?: boolean
  displayTitle?: string
  displaySummary?: string
  activeLabel?: string
  openDetailLabel?: string
  onSelect: () => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  moneyLabel: (value: number, currency?: string | null) => string
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
}) {
  const primaryAction = signal.recommendedActions[0]
  const metricValue = signal.metric?.formatted || (signal.amount ? moneyLabel(signal.amount, signal.currency) : null)
  const title = displayTitle || signal.title
  const summary = displaySummary || signal.summary
  const selectedText = activeLabel || "Selected"
  const openText = openDetailLabel || "Open details"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${active ? selectedText : openText}: ${title}`}
      className={`group w-full rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 hover:-translate-y-0.5 hover:border-orange-300 hover:bg-orange-50/60 hover:shadow-sm dark:hover:bg-orange-950/10 ${active ? "border-orange-300 bg-orange-50/80 shadow-sm ring-1 ring-orange-200 dark:border-orange-900/60 dark:bg-orange-950/20 dark:ring-orange-900/50" : "border-zinc-200 bg-background dark:border-zinc-700"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={severityClassName(signal.severity)}>{severityLabel(signal.severity)}</Badge>
            <span className="text-[11px] text-muted-foreground">{domainLabel(signal.domain, signal.domainLabel)}</span>
            {metricValue ? <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{metricValue}</span> : null}
          </div>
          <p className="break-words text-sm font-medium text-foreground">{title}</p>
          {!compact && <p className="mt-1 break-words text-xs text-muted-foreground">{summary}</p>}
          {!compact && primaryAction ? (
            <p className="mt-2 inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-800 ring-1 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/50">
              <Inbox className="h-3 w-3 shrink-0" />
              <span className="truncate">{actionLabel?.(primaryAction, signal) || actionTypeLabel(primaryAction.actionType)}</span>
            </p>
          ) : null}
        </div>
        <span data-video-target="ai-actions-open-risk" className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors ${active ? "border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300" : "border-zinc-200 bg-background text-muted-foreground group-hover:border-orange-300 group-hover:text-foreground dark:border-zinc-700"}`}>
          {active ? <CheckCircle2 className="h-3 w-3" /> : null}
          <span className="max-w-[8.5rem] truncate">{active ? selectedText : openText}</span>
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  )
}

export function AdvisorSignalRail({
  inputRef,
  signals,
  totalSignals,
  capabilities,
  collectorHealth,
  selectedSignalId,
  query,
  domains,
  owners,
  selectedDomain,
  selectedOwner,
  labels,
  emptyLabels,
  onQueryChange,
  onDomainChange,
  onOwnerChange,
  onSelectSignal,
  severityClassName,
  severityLabel,
  domainLabel,
  moneyLabel,
  actionTypeLabel,
  signalTitle,
  signalSummary,
  actionLabel,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  signals: AdvisorSignal[]
  totalSignals: number
  capabilities: AdvisorCapability[]
  collectorHealth?: AdvisorCollectorHealth[]
  selectedSignalId?: string | null
  query: string
  domains: Array<{ key: AdvisorDomainKey; label: string; count: number }>
  owners: Array<{ key: string; label: string; count: number }>
  selectedDomain: "all" | AdvisorDomainKey
  selectedOwner: string
  labels: {
    needsAttention: string
    searchPlaceholder: string
    allModules: string
    allOwners: string
    unassigned: string
    selectedRisk: string
    openRiskDetails: string
  }
  emptyLabels: {
    emptyToday: string
    emptyFilteredTitle: string
    emptyFilteredReason: string
    emptyReasonUnknown: string
    emptyReasonNoAccess: string
    emptyReasonNoModules: string
    emptyReasonQuiet: string
    emptyReasonCollectorFailed: string
    clearFilters: string
    activeModulesCount: string
    lockedModulesCount: string
    noAccessModulesCount: string
    active: string
    noAccess: string
    locked: string
    collectorActive: string
    collectorNoData: string
    collectorFailed: string
    collectorModuleDisabled: string
    collectorNoPermission: string
  }
  onQueryChange: (value: string) => void
  onDomainChange: (value: "all" | AdvisorDomainKey) => void
  onOwnerChange: (value: string) => void
  onSelectSignal: (signal: AdvisorSignal) => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  moneyLabel: (value: number, currency?: string | null) => string
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  signalTitle?: (signal: AdvisorSignal) => string
  signalSummary?: (signal: AdvisorSignal) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-card sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{labels.needsAttention}</h2>
          <p className="text-xs text-muted-foreground">{signals.length} / {totalSignals}</p>
        </div>
        <div className="relative w-full min-w-0 sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchPlaceholder}
            className="h-9 w-full rounded-full border border-zinc-200 bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/60 dark:border-zinc-700 sm:w-72"
          />
        </div>
      </div>
      <AdvisorFilters
        domains={domains}
        owners={owners}
        selectedDomain={selectedDomain}
        selectedOwner={selectedOwner}
        labels={{
          allModules: labels.allModules,
          allOwners: labels.allOwners,
          unassigned: labels.unassigned,
        }}
        onDomainChange={onDomainChange}
        onOwnerChange={onOwnerChange}
      />
      {signals.length === 0 ? (
        <AdvisorEmptyState
          capabilities={capabilities}
          collectorHealth={collectorHealth}
          filtered={totalSignals > 0 && (query.trim().length > 0 || selectedDomain !== "all" || selectedOwner !== "all")}
          labels={emptyLabels}
          domainLabel={domainLabel}
          onClearFilters={() => {
            onQueryChange("")
            onDomainChange("all")
            onOwnerChange("all")
          }}
        />
      ) : (
        <div className="space-y-2">
          {signals.map((signal) => (
            <RiskRow
              key={signal.id}
              signal={signal}
              active={selectedSignalId === signal.id}
              displayTitle={signalTitle?.(signal)}
              displaySummary={signalSummary?.(signal)}
              activeLabel={labels.selectedRisk}
              openDetailLabel={labels.openRiskDetails}
              onSelect={() => onSelectSignal(signal)}
              severityClassName={severityClassName}
              severityLabel={severityLabel}
              domainLabel={domainLabel}
              moneyLabel={moneyLabel}
              actionTypeLabel={actionTypeLabel}
              actionLabel={actionLabel}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-background px-3 py-2 dark:border-zinc-700">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

function collectorHealthClasses(status: AdvisorCollectorHealth["status"]): string {
  if (status === "collector_failed") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
  if (status === "no_data") return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}

function collectorHealthLabel(health: AdvisorCollectorHealth, labels: {
  collectorActive: string
  collectorNoData: string
  collectorFailed: string
  collectorModuleDisabled: string
  collectorNoPermission: string
}) {
  if (health.status === "active") return labels.collectorActive
  if (health.status === "no_data") return labels.collectorNoData
  if (health.status === "collector_failed") return labels.collectorFailed
  if (health.status === "no_permission") return labels.collectorNoPermission
  return labels.collectorModuleDisabled
}

export function ModuleTile({
  capability,
  health,
  count,
  labels,
  domainLabel,
  onFilter,
}: {
  capability: AdvisorCapability
  health?: AdvisorCollectorHealth
  count: number
  labels: {
    signalsLabel: string
    active: string
    noAccess: string
    locked: string
    collectorActive: string
    collectorNoData: string
    collectorFailed: string
    collectorModuleDisabled: string
    collectorNoPermission: string
    moduleNoSignals: string
    moduleNoSignalsHint: string
    moduleBlockedHint: string
    moduleNoAccessHint: string
    filterModule: string
    openModule: string
  }
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  onFilter: (domain: AdvisorDomainKey) => void
}) {
  const active = capability.status === "active"
  const noSignals = active && count === 0
  const statusHint = active
    ? noSignals ? labels.moduleNoSignalsHint : `${count} ${labels.signalsLabel}`
    : capability.status === "no_access"
      ? labels.moduleNoAccessHint
      : labels.moduleBlockedHint
  return (
    <div className="rounded-lg border border-zinc-200 bg-background p-4 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{domainLabel(capability.key, capability.label)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{statusHint}</p>
          {health?.reason ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{health.reason}</p> : null}
          {!active && capability.reason ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{capability.reason}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant="outline" className={active ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}>
            {active ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Lock className="mr-1 h-3 w-3" />}
            {active ? labels.active : capability.status === "no_access" ? labels.noAccess : labels.locked}
          </Badge>
          {health ? (
            <Badge variant="outline" className={collectorHealthClasses(health.status)}>
              {health.status === "collector_failed" ? <AlertTriangle className="mr-1 h-3 w-3" /> : <BarChart3 className="mr-1 h-3 w-3" />}
              {collectorHealthLabel(health, labels)}
            </Badge>
          ) : null}
          {noSignals ? (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
              {labels.moduleNoSignals}
            </Badge>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onFilter(capability.key)}>
            {labels.filterModule}
          </Button>
          {capability.href ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={capability.href}>{labels.openModule}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AdvisorModuleCoverage({
  capabilities,
  collectorHealth,
  signals,
  labels,
  domainLabel,
  onFilter,
}: {
  capabilities: AdvisorCapability[]
  collectorHealth?: AdvisorCollectorHealth[]
  signals: AdvisorSignal[]
  labels: {
    moduleCoverage: string
    moduleCoverageDesc: string
    signalsLabel: string
    active: string
    noAccess: string
    locked: string
    collectorActive: string
    collectorNoData: string
    collectorFailed: string
    collectorModuleDisabled: string
    collectorNoPermission: string
    moduleNoSignals: string
    moduleNoSignalsHint: string
    moduleBlockedHint: string
    moduleNoAccessHint: string
    filterModule: string
    openModule: string
  }
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  onFilter: (domain: AdvisorDomainKey) => void
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{labels.moduleCoverage}</h2>
        <p className="text-sm text-muted-foreground">{labels.moduleCoverageDesc}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability) => (
          <ModuleTile
            key={capability.key}
            capability={capability}
            health={collectorHealth?.find((item) => item.domain === capability.key)}
            count={signals.filter((signal) => signal.domain === capability.key).length}
            labels={{
              signalsLabel: labels.signalsLabel,
              active: labels.active,
              noAccess: labels.noAccess,
              locked: labels.locked,
              collectorActive: labels.collectorActive,
              collectorNoData: labels.collectorNoData,
              collectorFailed: labels.collectorFailed,
              collectorModuleDisabled: labels.collectorModuleDisabled,
              collectorNoPermission: labels.collectorNoPermission,
              moduleNoSignals: labels.moduleNoSignals,
              moduleNoSignalsHint: labels.moduleNoSignalsHint,
              moduleBlockedHint: labels.moduleBlockedHint,
              moduleNoAccessHint: labels.moduleNoAccessHint,
              filterModule: labels.filterModule,
              openModule: labels.openModule,
            }}
            domainLabel={domainLabel}
            onFilter={onFilter}
          />
        ))}
      </div>
    </section>
  )
}

export function AdvisorAskPanel({
  inputRef,
  question,
  asking,
  selectedFilter,
  answer,
  queueingKey,
  matchedSignals,
  selectedSignalId,
  labels,
  filters,
  onQuestionChange,
  onAsk,
  onFilterPrompt,
  onSelectSignal,
  onQueue,
  severityClassName,
  severityLabel,
  domainLabel,
  moneyLabel,
  actionTypeLabel,
  intentLabel,
  metricKindLabel,
  dateScopeLabel,
  signalTitle,
  signalSummary,
  actionLabel,
  actionDescription,
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  question: string
  asking: boolean
  selectedFilter: string
  answer: AdvisorAnswer | null
  matchedSignals: AdvisorSignal[]
  selectedSignalId?: string | null
  labels: {
    quickQuestions: string
    askDesc: string
    askPlaceholder: string
    askButton: string
    matched: string
    answer: string
    groundedAnswer: string
    primaryRisk: string
    whatToDoNext: string
    openThisRisk: string
    queuePrimaryAction: string
    queryScope: string
    citations: string
    sources: string
    owner: string
    dateScope: string
    approvalRequired: string
    selectedRisk: string
    openRiskDetails: string
  }
  filters: Array<{ key: string; label: string }>
  onQuestionChange: (value: string) => void
  onAsk: (question?: string) => void
  onFilterPrompt: (key: string, label: string) => void
  onSelectSignal: (signal: AdvisorSignal) => void
  onQueue?: (signal: AdvisorSignal, action: AdvisorAction) => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  moneyLabel: (value: number, currency?: string | null) => string
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  intentLabel: (intent: string) => string
  metricKindLabel: (metric: string) => string
  dateScopeLabel: (scope: string) => string
  signalTitle: (signal: AdvisorSignal) => string
  signalSummary?: (signal: AdvisorSignal) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
  actionDescription?: (action: AdvisorAction, signal: AdvisorSignal) => string | null | undefined
  queueingKey?: string | null
}) {
  const primaryAnswerSignal = answer ? answer.signals?.[0] || matchedSignals[0] || null : null
  const primaryAnswerAction = primaryAnswerSignal?.recommendedActions[0] || null
  const primaryActionKey = primaryAnswerSignal && primaryAnswerAction ? `${primaryAnswerSignal.id}:${primaryAnswerAction.actionType}` : null
  const primaryActionText = primaryAnswerSignal && primaryAnswerAction
    ? actionLabel?.(primaryAnswerAction, primaryAnswerSignal) || actionTypeLabel(primaryAnswerAction.actionType)
    : null
  const primaryActionDescription = primaryAnswerSignal && primaryAnswerAction
    ? actionDescription?.(primaryAnswerAction, primaryAnswerSignal)
    : null
  const handleQueuePrimaryAction = primaryAnswerSignal && primaryAnswerAction && onQueue
    ? () => onQueue(primaryAnswerSignal, primaryAnswerAction)
    : null

  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <h2 className="text-base font-semibold">{labels.quickQuestions}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{labels.askDesc}</p>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAsk()
          }}
          placeholder={labels.askPlaceholder}
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-background px-3 text-sm outline-none focus:border-primary/60 dark:border-zinc-700"
        />
        <Button className="w-full sm:w-auto" onClick={() => onAsk()} disabled={asking || !question.trim()}>
          {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
          {labels.askButton}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Button
            key={filter.key}
            variant={selectedFilter === filter.key ? "default" : "outline"}
            size="sm"
            onClick={() => onFilterPrompt(filter.key, filter.label)}
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            {filter.label}
          </Button>
        ))}
      </div>
      {answer ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-background p-4 dark:border-zinc-700">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase text-muted-foreground">{labels.answer}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{intentLabel(answer.intent)}</Badge>
                <span className="text-xs text-muted-foreground">{labels.matched}: {answer.scope.returnedSignals}/{answer.scope.filteredSignals}</span>
                <span className="text-xs text-muted-foreground">{labels.citations}: {answer.sources.length}</span>
              </div>
            </div>
            {primaryAnswerSignal ? (
              <Button size="sm" variant="outline" onClick={() => onSelectSignal(primaryAnswerSignal)}>
                <ArrowUpRight className="h-3.5 w-3.5" />
                {labels.openThisRisk}
              </Button>
            ) : null}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{labels.queryScope}</Badge>
            {answer.scope.routing.domains.map((domain) => (
              <Badge key={`ask-domain:${domain}`} variant="outline">{domainLabel(domain, domain)}</Badge>
            ))}
            {answer.scope.routing.severities.map((severity) => (
              <Badge key={`ask-severity:${severity}`} variant="outline" className={severityClassName(severity)}>{severityLabel(severity)}</Badge>
            ))}
            {answer.scope.routing.metricKinds.map((metric) => (
              <Badge key={`ask-metric:${metric}`} variant="outline">{metricKindLabel(metric)}</Badge>
            ))}
            {answer.scope.routing.owner ? (
              <Badge variant="outline">{labels.owner}: {answer.scope.routing.owner.label}</Badge>
            ) : null}
            {answer.scope.routing.dateScope !== "all" ? (
              <Badge variant="outline">{labels.dateScope}: {dateScopeLabel(answer.scope.routing.dateScope)}</Badge>
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{labels.groundedAnswer}</h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{answer.answer}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {answer.facts.map((item) => <InfoPill key={`${item.label}:${item.value}`} label={item.label} value={item.value} />)}
              </div>
              {answer.sources.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-2 text-[11px] font-medium text-muted-foreground">{labels.sources}</p>
                  <div className="flex flex-wrap gap-2">
                    {answer.sources.map((item) => (
                      <Button key={`${item.entityType}:${item.entityId}`} variant="outline" size="sm" className="max-w-full min-w-0" asChild>
                        <Link href={item.href}>
                          <FileText className="h-3.5 w-3.5" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {primaryAnswerSignal ? (
              <div className="self-start rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={severityClassName(primaryAnswerSignal.severity)}>{severityLabel(primaryAnswerSignal.severity)}</Badge>
                  <span className="text-[11px] text-muted-foreground">{domainLabel(primaryAnswerSignal.domain, primaryAnswerSignal.domainLabel)}</span>
                </div>
                <p className="text-[11px] font-medium text-muted-foreground">{labels.primaryRisk}</p>
                <h4 className="mt-1 text-sm font-semibold leading-snug">{signalTitle(primaryAnswerSignal)}</h4>
                {signalSummary ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{signalSummary(primaryAnswerSignal)}</p> : null}
                {primaryActionText ? (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-background/80 p-3 dark:border-zinc-700">
                    <p className="text-[11px] font-medium text-muted-foreground">{labels.whatToDoNext}</p>
                    <p className="mt-1 text-sm font-semibold">{primaryActionText}</p>
                    {primaryActionDescription ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{primaryActionDescription}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        {labels.approvalRequired}
                      </Badge>
                      {handleQueuePrimaryAction ? (
                        <Button size="sm" onClick={handleQueuePrimaryAction} disabled={queueingKey === primaryActionKey}>
                          {queueingKey === primaryActionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
                          {labels.queuePrimaryAction}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {matchedSignals.slice(0, 8).map((signal) => (
          <RiskRow
            key={signal.id}
            signal={signal}
            active={selectedSignalId === signal.id}
            displayTitle={signalTitle(signal)}
            displaySummary={signalSummary?.(signal)}
            activeLabel={labels.selectedRisk}
            openDetailLabel={labels.openRiskDetails}
            onSelect={() => onSelectSignal(signal)}
            compact
            severityClassName={severityClassName}
            severityLabel={severityLabel}
            domainLabel={domainLabel}
            moneyLabel={moneyLabel}
            actionTypeLabel={actionTypeLabel}
            actionLabel={actionLabel}
          />
        ))}
      </div>
    </section>
  )
}

export function AdvisorAnswerSummaryCard({
  answer,
  selectedSignal,
  queueingKey,
  labels,
  onOpenAnswer,
  onOpenRisk,
  onQueue,
  severityClassName,
  severityLabel,
  domainLabel,
  actionTypeLabel,
  signalTitle,
  signalSummary,
  actionLabel,
  actionDescription,
}: {
  answer: AdvisorAnswer | null
  selectedSignal: AdvisorSignal | null
  queueingKey: string | null
  labels: {
    activeAnswer: string
    activeAnswerDesc: string
    answer: string
    primaryRisk: string
    whatToDoNext: string
    backToAnswer: string
    openThisRisk: string
    queuePrimaryAction: string
    approvalRequired: string
    matched: string
    citations: string
  }
  onOpenAnswer: () => void
  onOpenRisk: (signal: AdvisorSignal) => void
  onQueue: (signal: AdvisorSignal, action: AdvisorAction) => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  signalTitle: (signal: AdvisorSignal) => string
  signalSummary?: (signal: AdvisorSignal) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
  actionDescription?: (action: AdvisorAction, signal: AdvisorSignal) => string | null | undefined
}) {
  if (!answer) return null
  const primarySignal = answer.signals?.[0] || selectedSignal
  const primaryAction = primarySignal?.recommendedActions[0] || null
  const queueKey = primarySignal && primaryAction ? `${primarySignal.id}:${primaryAction.actionType}` : null
  const actionText = primarySignal && primaryAction
    ? actionLabel?.(primaryAction, primarySignal) || actionTypeLabel(primaryAction.actionType)
    : null
  const actionHelp = primarySignal && primaryAction ? actionDescription?.(primaryAction, primarySignal) : null

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-3 dark:border-primary/30 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-background text-primary">
              <MessageSquareText className="mr-1 h-3 w-3" />
              {labels.activeAnswer}
            </Badge>
            <span className="text-xs text-muted-foreground">{labels.matched}: {answer.scope.returnedSignals}/{answer.scope.filteredSignals}</span>
            <span className="text-xs text-muted-foreground">{labels.citations}: {answer.sources.length}</span>
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">{labels.activeAnswerDesc}</p>
          <p className="mt-2 line-clamp-3 max-w-4xl whitespace-pre-line text-sm leading-6 text-foreground">{answer.answer}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpenAnswer}>
            <MessageSquareText className="h-3.5 w-3.5" />
            {labels.backToAnswer}
          </Button>
          {primarySignal ? (
            <Button size="sm" variant="outline" onClick={() => onOpenRisk(primarySignal)}>
              <ArrowUpRight className="h-3.5 w-3.5" />
              {labels.openThisRisk}
            </Button>
          ) : null}
        </div>
      </div>

      {primarySignal ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
          <button
            type="button"
            onClick={() => onOpenRisk(primarySignal)}
            className="min-w-0 rounded-lg border border-zinc-200 bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 dark:border-zinc-700"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={severityClassName(primarySignal.severity)}>{severityLabel(primarySignal.severity)}</Badge>
              <span className="text-[11px] text-muted-foreground">{domainLabel(primarySignal.domain, primarySignal.domainLabel)}</span>
            </div>
            <p className="text-[11px] font-medium text-muted-foreground">{labels.primaryRisk}</p>
            <h3 className="mt-1 break-words text-sm font-semibold leading-snug">{signalTitle(primarySignal)}</h3>
            {signalSummary ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{signalSummary(primarySignal)}</p> : null}
          </button>
          <div className="min-w-0 rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
            <p className="text-[11px] font-medium text-muted-foreground">{labels.whatToDoNext}</p>
            {primaryAction && actionText ? (
              <>
                <p className="mt-1 break-words text-sm font-semibold">{actionText}</p>
                {actionHelp ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{actionHelp}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    {labels.approvalRequired}
                  </Badge>
                  <Button size="sm" onClick={() => onQueue(primarySignal, primaryAction)} disabled={queueingKey === queueKey}>
                    {queueingKey === queueKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
                    {labels.queuePrimaryAction}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{labels.approvalRequired}</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function AdvisorSignalDetail({
  signal,
  relatedSignals,
  queueingKey,
  labels,
  className = "",
  onSelectSignal,
  onQueue,
  severityClassName,
  severityLabel,
  domainLabel,
  moneyLabel,
  actionTypeLabel,
  actionRiskLabel,
  signalTitle,
  signalSummary,
  actionLabel,
  actionDescription,
  impactLabel,
  impactValue,
  impactBasis,
  previewText,
  rollbackModeLabel,
  routeSourceLabel,
  timelineLabel,
  timelineDescription,
  factLabel,
  factValue,
  metricLabel,
}: {
  signal: AdvisorSignal | null
  relatedSignals: AdvisorSignal[]
  queueingKey: string | null
  labels: {
    riskDetail: string
    selectRisk: string
    selectRiskTitle: string
    selectRiskReason: string
    selectRiskEvidence: string
    selectRiskAction: string
    selectRiskApproval: string
    signalStep: string
    evidenceStep: string
    actionStep: string
    approvalStep: string
    approvalRequired: string
    flow: string
    sources: string
    factsCount: string
    causalChain: string
    causalChainDesc: string
    linkedSignal: string
    owner: string
    amount: string
    revenueAtRisk: string
    severity: string
    why: string
    evidence: string
    actions: string
    preview: string
    routeSnapshot: string
    routeOwner: string
    routeStatus: string
    routeVisited: string
    routeMissedStop: string
    routeDelay: string
    routeLastActivity: string
    routeEvidenceLinks: string
    timeline: string
    impact: string
    impactBasis: string
    dryRun: string
    creates: string
    updates: string
    notifications: string
    externalSideEffects: string
    rollback: string
    rollbackMode: string
    nextStep: string
    target: string
    queueAction: string
    moreActions: string
    noPending: string
  }
  className?: string
  onSelectSignal: (signalId: string) => void
  onQueue: (signal: AdvisorSignal, action: AdvisorAction) => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  moneyLabel: (value: number, currency?: string | null) => string
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  actionRiskLabel: (risk: AdvisorAction["risk"] | string) => string
  signalTitle?: (signal: AdvisorSignal) => string
  signalSummary?: (signal: AdvisorSignal) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
  actionDescription?: (action: AdvisorAction, signal: AdvisorSignal) => string | null | undefined
  impactLabel?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
  impactValue?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
  impactBasis?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
  previewText?: (text: string, signal: AdvisorSignal) => string
  rollbackModeLabel?: (mode: NonNullable<AdvisorSignal["rollbackPreview"]>["mode"]) => string
  routeSourceLabel?: (entityType: string) => string
  timelineLabel?: (event: NonNullable<AdvisorSignal["timeline"]>[number], signal: AdvisorSignal) => string
  timelineDescription?: (event: NonNullable<AdvisorSignal["timeline"]>[number], signal: AdvisorSignal) => string
  factLabel?: (fact: AdvisorSignal["facts"][number], signal: AdvisorSignal) => string
  factValue?: (fact: AdvisorSignal["facts"][number], signal: AdvisorSignal) => string
  metricLabel?: (metric: NonNullable<AdvisorSignal["metric"]>, signal: AdvisorSignal) => string
}) {
  return (
    <aside className={`rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-card 2xl:sticky 2xl:top-4 2xl:self-start ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <ShieldCheck className="h-4 w-4 text-orange-600 dark:text-orange-300" />
        {labels.riskDetail}
      </h2>
      {!signal ? (
        <AdvisorDetailEmptyState labels={labels} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/30">
            <Badge variant="outline" className={severityClassName(signal.severity)}>{severityLabel(signal.severity)}</Badge>
            <h3 className="mt-2 text-lg font-semibold leading-tight">{signalTitle ? signalTitle(signal) : signal.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{signalSummary ? signalSummary(signal) : signal.summary}</p>
          </div>
          <RecommendedActionPanel
            labels={labels}
            signal={signal}
            queueingKey={queueingKey}
            onQueue={onQueue}
            actionTypeLabel={actionTypeLabel}
            actionRiskLabel={actionRiskLabel}
            actionLabel={actionLabel}
            actionDescription={actionDescription}
          />
          <SignalImpactPanel
            labels={labels}
            signal={signal}
            severityLabel={severityLabel}
            impactLabel={impactLabel}
            impactValue={impactValue}
            impactBasis={impactBasis}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {signal.ownerLabel || signal.ownerId ? <InfoPill label={labels.owner} value={displayOwnerLabel(signal, "—")} /> : null}
            {signal.metric ? <InfoPill label={metricLabel ? metricLabel(signal.metric, signal) : signal.metric.label} value={signal.metric.formatted} /> : signal.amount ? <InfoPill label={labels.amount} value={moneyLabel(signal.amount, signal.currency || "AZN")} /> : null}
            <InfoPill label={labels.severity} value={severityLabel(signal.severity)} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{labels.why}</h4>
            <div className="space-y-1.5">
              {signal.facts.map((item) => (
                <InfoPill
                  key={`${item.label}:${item.value}`}
                  label={factLabel ? factLabel(item, signal) : item.label}
                  value={factValue ? factValue(item, signal) : item.value}
                />
              ))}
            </div>
          </div>
          <details className="rounded-xl border border-zinc-200 bg-background p-3 dark:border-zinc-800">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
              <span>{labels.evidence}</span>
              <Badge variant="outline" className="text-[10px]">{signal.sources.length} {labels.sources.toLowerCase()}</Badge>
            </summary>
            <div className="mt-3 space-y-3">
              <SignalWorkflow
                labels={labels}
                signal={signal}
                domainLabel={domainLabel}
                actionLabel={actionLabel}
              />
              {relatedSignals.length > 0 ? (
                <RelatedSignalChain
                  labels={labels}
                  signals={relatedSignals}
                  onSelect={onSelectSignal}
                  severityClassName={severityClassName}
                  severityLabel={severityLabel}
                  domainLabel={domainLabel}
                  signalTitle={signalTitle}
                />
              ) : null}
              {signal.domain === "routes" || signal.domain === "mtm" ? <RouteEvidencePanel labels={labels} signal={signal} routeSourceLabel={routeSourceLabel} /> : null}
              <SignalTimelinePanel
                labels={labels}
                signal={signal}
                timelineLabel={timelineLabel}
                timelineDescription={timelineDescription}
              />
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{labels.sources}</h4>
                <div className="flex flex-wrap gap-2">
                  {signal.sources.map((item) => (
                    <Button key={`${item.entityType}:${item.entityId}`} variant="outline" size="sm" asChild>
                      <Link href={item.href}>
                        <FileText className="h-3.5 w-3.5" />
                        {item.label}
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </details>
          {signal.dryRunPreview || signal.rollbackPreview ? (
            <details className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-900/60 dark:bg-blue-950/10">
              <summary className="cursor-pointer text-sm font-semibold">{labels.preview}</summary>
              <div className="mt-3">
                <SignalDryRunPanel
                  labels={labels}
                  signal={signal}
                  actionTypeLabel={actionTypeLabel}
                  previewText={previewText}
                  rollbackModeLabel={rollbackModeLabel}
                />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </aside>
  )
}

function AdvisorDetailEmptyState({
  labels,
}: {
  labels: {
    selectRiskTitle: string
    selectRisk: string
    selectRiskReason: string
    selectRiskEvidence: string
    selectRiskAction: string
    selectRiskApproval: string
  }
}) {
  const steps = [
    { label: labels.selectRiskReason, icon: <AlertTriangle className="h-4 w-4" /> },
    { label: labels.selectRiskEvidence, icon: <FileText className="h-4 w-4" /> },
    { label: labels.selectRiskAction, icon: <Inbox className="h-4 w-4" /> },
    { label: labels.selectRiskApproval, icon: <ShieldCheck className="h-4 w-4" /> },
  ]

  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-muted/30 p-4 dark:border-zinc-700">
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MousePointer2 className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{labels.selectRiskTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{labels.selectRisk}</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step, index) => (
          <div key={step.label} className="flex items-center gap-2 rounded-md border border-zinc-200 bg-background px-3 py-2 text-xs dark:border-zinc-700">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{step.icon}</span>
            <span className="min-w-0 font-medium text-foreground">{index + 1}. {step.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalWorkflow({
  labels,
  signal,
  domainLabel,
  actionLabel,
}: {
  labels: {
    signalStep: string
    evidenceStep: string
    actionStep: string
    approvalStep: string
    approvalRequired: string
    flow: string
    sources: string
    factsCount: string
  }
  signal: AdvisorSignal
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
}) {
  const primaryAction = signal.recommendedActions[0]
  const steps = [
    { label: labels.signalStep, value: domainLabel(signal.domain, signal.domainLabel), icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { label: labels.evidenceStep, value: `${signal.facts.length} ${labels.factsCount}`, icon: <FileText className="h-3.5 w-3.5" /> },
    { label: labels.actionStep, value: primaryAction ? actionLabel?.(primaryAction, signal) || primaryAction.label : "—", icon: <Inbox className="h-3.5 w-3.5" /> },
    { label: labels.approvalStep, value: labels.approvalRequired, icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground">{labels.flow}</h4>
        <Badge variant="outline" className="text-[10px]">{signal.sources.length} {labels.sources.toLowerCase()}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step.label} className="min-w-0 rounded-md bg-muted/45 px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="text-primary">{step.icon}</span>
              <span>{index + 1}. {step.label}</span>
            </div>
            <p className="truncate text-xs font-semibold" title={step.value}>{step.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RelatedSignalChain({
  labels,
  signals,
  onSelect,
  severityClassName,
  severityLabel,
  domainLabel,
  signalTitle,
}: {
  labels: {
    causalChain: string
    causalChainDesc: string
    linkedSignal: string
  }
  signals: AdvisorSignal[]
  onSelect: (signalId: string) => void
  severityClassName: (severity: AdvisorSignal["severity"]) => string
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  signalTitle?: (signal: AdvisorSignal) => string
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground">{labels.causalChain}</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{labels.causalChainDesc}</p>
        </div>
        <Badge variant="outline" className="text-[10px]">{signals.length} {labels.linkedSignal.toLowerCase()}</Badge>
      </div>
      <div className="space-y-1.5">
        {signals.map((signal) => (
          <button
            key={signal.id}
            type="button"
            onClick={() => onSelect(signal.id)}
            className="flex w-full items-start justify-between gap-2 rounded-md border border-zinc-200 bg-muted/30 px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 dark:border-zinc-700"
          >
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={severityClassName(signal.severity)}>{severityLabel(signal.severity)}</Badge>
                <span className="text-[11px] text-muted-foreground">{domainLabel(signal.domain, signal.domainLabel)}</span>
              </div>
              <p className="line-clamp-2 text-xs font-medium text-foreground">{signalTitle ? signalTitle(signal) : signal.title}</p>
            </div>
            <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  )
}

function formatSignalDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function SignalTimelinePanel({
  labels,
  signal,
  timelineLabel,
  timelineDescription,
}: {
  labels: {
    timeline: string
  }
  signal: AdvisorSignal
  timelineLabel?: (event: NonNullable<AdvisorSignal["timeline"]>[number], signal: AdvisorSignal) => string
  timelineDescription?: (event: NonNullable<AdvisorSignal["timeline"]>[number], signal: AdvisorSignal) => string
}) {
  const timeline = signal.timeline || []
  if (timeline.length === 0) return null

  return (
    <div className="rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{labels.timeline}</h4>
      </div>
      <div className="space-y-2">
        {timeline.map((event, index) => (
          <div key={`${event.label}:${event.at}:${index}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
            <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/80" />
            <div className="min-w-0 rounded-md bg-muted/35 px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{timelineLabel ? timelineLabel(event, signal) : event.label}</p>
                <span className="text-[11px] text-muted-foreground">{formatSignalDate(event.at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{timelineDescription ? timelineDescription(event, signal) : event.description}</p>
              {event.source ? (
                <Button variant="link" size="sm" className="mt-1 h-auto px-0 py-0 text-xs" asChild>
                  <Link href={event.source.href}>{event.source.label}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalImpactPanel({
  labels,
  signal,
  severityLabel,
  impactLabel,
  impactValue,
  impactBasis,
}: {
  labels: {
    impact: string
    impactBasis: string
    revenueAtRisk: string
  }
  signal: AdvisorSignal
  severityLabel: (severity: AdvisorSignal["severity"]) => string
  impactLabel?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
  impactValue?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
  impactBasis?: (impact: NonNullable<AdvisorSignal["impact"]>, signal: AdvisorSignal) => string
}) {
  const impact = signal.impact
  if (!impact) return null
  const displayLabel = impactLabel ? impactLabel(impact, signal) : impact.label
  const displayValue = impactValue ? impactValue(impact, signal) : impact.value
  const displayBasis = impactBasis ? impactBasis(impact, signal) : impact.basis
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
          <h4 className="text-sm font-semibold">{labels.impact}</h4>
        </div>
        <Badge variant="outline" className="border-emerald-300 bg-background text-emerald-800 dark:border-emerald-800 dark:text-emerald-200">
          {severityLabel(impact.severity)}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InfoPill label={displayLabel} value={displayValue} />
        {impact.moneyAtRisk != null && impact.moneyAtRisk > 0 ? (
          <InfoPill label={labels.revenueAtRisk} value={`${impact.moneyAtRisk.toLocaleString()} ${impact.currency || signal.currency || "AZN"}`} />
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{labels.impactBasis}: </span>
        {displayBasis}
      </p>
    </div>
  )
}

function PreviewList({
  label,
  items,
  signal,
  previewText,
}: {
  label: string
  items?: string[]
  signal: AdvisorSignal
  previewText?: (text: string, signal: AdvisorSignal) => string
}) {
  if (!items || items.length === 0) return null
  return (
    <div className="rounded-md bg-muted/35 px-2.5 py-2">
      <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <ul className="space-y-1 text-xs">
        {items.map((item) => <li key={item}>{previewText ? previewText(item, signal) : item}</li>)}
      </ul>
    </div>
  )
}

function SignalDryRunPanel({
  labels,
  signal,
  actionTypeLabel,
  previewText,
  rollbackModeLabel,
}: {
  labels: {
    dryRun: string
    creates: string
    updates: string
    notifications: string
    externalSideEffects: string
    rollback: string
    rollbackMode: string
  }
  signal: AdvisorSignal
  actionTypeLabel?: (actionType: AdvisorAction["actionType"]) => string
  previewText?: (text: string, signal: AdvisorSignal) => string
  rollbackModeLabel?: (mode: NonNullable<AdvisorSignal["rollbackPreview"]>["mode"]) => string
}) {
  const preview = signal.dryRunPreview
  const rollback = signal.rollbackPreview
  if (!preview && !rollback) return null

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      {preview ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-700 dark:text-blue-300" />
              <h4 className="text-sm font-semibold">{labels.dryRun}</h4>
            </div>
            <Badge variant="outline" className="border-blue-300 bg-background text-blue-800 dark:border-blue-800 dark:text-blue-200">{actionTypeLabel?.(preview.actionType) || preview.actionType}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <PreviewList label={labels.creates} items={preview.creates} signal={signal} previewText={previewText} />
            <PreviewList label={labels.updates} items={preview.updates} signal={signal} previewText={previewText} />
            <PreviewList label={labels.notifications} items={preview.notifications} signal={signal} previewText={previewText} />
            <PreviewList label={labels.externalSideEffects} items={preview.externalSideEffects} signal={signal} previewText={previewText} />
          </div>
        </div>
      ) : null}
      {rollback ? (
        <div className="rounded-md border border-blue-200 bg-background p-2.5 dark:border-blue-900/60">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">{labels.rollback}</p>
            <span className="text-[11px] text-muted-foreground">{labels.rollbackMode}: {rollbackModeLabel ? rollbackModeLabel(rollback.mode) : rollback.mode}</span>
          </div>
          <p className="text-xs text-muted-foreground">{previewText ? previewText(rollback.summary, signal) : rollback.summary}</p>
          {rollback.steps.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
              {rollback.steps.map((step) => <li key={step}>{previewText ? previewText(step, signal) : step}</li>)}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function routeFactValue(signal: AdvisorSignal, labels: string[]) {
  const wanted = labels.map((label) => label.toLowerCase())
  return signal.facts.find((fact) => wanted.includes(fact.label.toLowerCase()))?.value || null
}

function parseRouteProgress(value: string | null) {
  if (!value) return null
  const match = value.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null
  const visited = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(visited) || !Number.isFinite(total) || total <= 0) return null
  return {
    visited,
    total,
    percent: Math.max(0, Math.min(100, Math.round((visited / total) * 100))),
  }
}

function routeOperationalSources(signal: AdvisorSignal) {
  const operationalTypes = new Set([
    "mtm_route",
    "mtm_visit",
    "mtm_photo",
  ])
  return signal.sources.filter((item) => operationalTypes.has(item.entityType))
}

function routeSourceLabel(entityType: string) {
  switch (entityType) {
    case "mtm_route":
      return "Route"
    case "mtm_visit":
      return "Visit"
    case "mtm_photo":
      return "Photo"
    default:
      return "Source"
  }
}

function RouteEvidencePanel({
  labels,
  signal,
  routeSourceLabel: routeSourceLabelOverride,
}: {
  labels: {
    routeSnapshot: string
    routeOwner: string
    routeStatus: string
    routeVisited: string
    routeMissedStop: string
    routeDelay: string
    routeLastActivity: string
    routeEvidenceLinks: string
  }
  signal: AdvisorSignal
  routeSourceLabel?: (entityType: string) => string
}) {
  const status = routeFactValue(signal, ["Status"])
  const visited = routeFactValue(signal, ["Visited"])
  const missedStop = routeFactValue(signal, ["Missed stop"])
  const delay = routeFactValue(signal, ["Delay minutes"])
  const lastActivity = routeFactValue(signal, ["Last visited at", "Last activity"])
  const owner = routeFactValue(signal, ["Agent", "Owner"]) || displayOwnerLabel(signal, "")
  const progress = parseRouteProgress(visited)
  const operationalSources = routeOperationalSources(signal)

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          <h4 className="text-sm font-semibold">{labels.routeSnapshot}</h4>
        </div>
        {progress ? <Badge variant="outline" className="border-amber-300 bg-background text-amber-800 dark:border-amber-800 dark:text-amber-200">{progress.percent}%</Badge> : null}
      </div>
      {progress ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{labels.routeVisited}</span>
            <span className="font-medium">{progress.visited}/{progress.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950">
            <div className="h-full rounded-full bg-amber-500 dark:bg-amber-400" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {owner ? <InfoPill label={labels.routeOwner} value={owner} /> : null}
        {status ? <InfoPill label={labels.routeStatus} value={status} /> : null}
        {missedStop ? <InfoPill label={labels.routeMissedStop} value={missedStop} /> : null}
        {delay ? <InfoPill label={labels.routeDelay} value={`${delay} min`} /> : null}
        {lastActivity ? <InfoPill label={labels.routeLastActivity} value={lastActivity} /> : null}
      </div>
      {operationalSources.length > 0 ? (
        <div className="mt-3 border-t border-amber-200/80 pt-3 dark:border-amber-900/60">
          <div className="mb-2 text-xs font-semibold uppercase text-amber-900/70 dark:text-amber-100/70">{labels.routeEvidenceLinks}</div>
          <div className="flex flex-wrap gap-2">
            {operationalSources.slice(0, 4).map((item) => (
              <Button
                key={`${item.entityType}:${item.entityId}`}
                variant="outline"
                size="sm"
                className="h-8 border-amber-300 bg-background/80 text-xs hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-950"
                asChild
              >
                <Link href={item.href}>
                  <span className="font-semibold">{routeSourceLabelOverride ? routeSourceLabelOverride(item.entityType) : routeSourceLabel(item.entityType)}</span>
                  <span className="max-w-[11rem] truncate text-muted-foreground">{item.label}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RecommendedActionPanel({
  labels,
  signal,
  queueingKey,
  onQueue,
  actionTypeLabel,
  actionRiskLabel,
  actionLabel,
  actionDescription,
}: {
  labels: {
    nextStep: string
    target: string
    approvalStep: string
    approvalRequired: string
    queueAction: string
    moreActions: string
    noPending: string
  }
  signal: AdvisorSignal
  queueingKey: string | null
  onQueue: (signal: AdvisorSignal, action: AdvisorAction) => void
  actionTypeLabel: (actionType: AdvisorAction["actionType"]) => string
  actionRiskLabel: (risk: AdvisorAction["risk"] | string) => string
  actionLabel?: (action: AdvisorAction, signal: AdvisorSignal) => string
  actionDescription?: (action: AdvisorAction, signal: AdvisorSignal) => string | null | undefined
}) {
  const [primaryAction, ...secondaryActions] = signal.recommendedActions
  if (!primaryAction) return <EmptyState text={labels.noPending} />
  const primaryKey = `${signal.id}:${primaryAction.actionType}`
  const primaryDescription = actionDescription?.(primaryAction, signal)

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-orange-200 bg-orange-50/70 p-3 shadow-sm dark:border-orange-900/50 dark:bg-orange-950/20">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-orange-200 bg-white text-orange-700 dark:border-orange-900/60 dark:bg-zinc-950/40 dark:text-orange-300">{labels.nextStep}</Badge>
              <span className="text-xs text-muted-foreground">{actionTypeLabel(primaryAction.actionType)} · {actionRiskLabel(primaryAction.risk)}</span>
            </div>
            <p className="text-sm font-semibold">{actionLabel?.(primaryAction, signal) || primaryAction.label}</p>
            {primaryDescription ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{primaryDescription}</p>
            ) : null}
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-orange-100 bg-white/70 p-2 dark:border-orange-900/40 dark:bg-zinc-950/30">
                <span className="text-muted-foreground">{labels.target}: </span>
                <span className="font-medium break-all">{signal.entityType}:{signal.entityId}</span>
              </div>
              <div className="min-w-0 rounded-lg border border-orange-100 bg-white/70 p-2 dark:border-orange-900/40 dark:bg-zinc-950/30">
                <span className="text-muted-foreground">{labels.approvalStep}: </span>
                <span className="font-medium break-words">{labels.approvalRequired}</span>
              </div>
            </div>
          </div>
          <Button size="sm" className="w-full rounded-full shadow-sm sm:w-auto" onClick={() => onQueue(signal, primaryAction)} disabled={queueingKey === primaryKey}>
            {queueingKey === primaryKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
            {labels.queueAction}
          </Button>
        </div>
      </div>
      {secondaryActions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{labels.moreActions}</p>
          {secondaryActions.map((action) => {
            const key = `${signal.id}:${action.actionType}`
            const description = actionDescription?.(action, signal)
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-background p-3 transition-colors hover:border-orange-200 dark:border-zinc-800 dark:hover:border-orange-900/60">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{actionLabel?.(action, signal) || action.label}</p>
                  <p className="text-xs text-muted-foreground">{actionTypeLabel(action.actionType)} · {actionRiskLabel(action.risk)}</p>
                  {description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p> : null}
                </div>
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => onQueue(signal, action)} disabled={queueingKey === key}>
                  {queueingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
                  {labels.queueAction}
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function actionSeverityClasses(severity?: string | null) {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
  if (severity === "high") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
  if (severity === "medium") return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}

function executionStatusClasses(status?: string | null) {
  if (status === "executed") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
  if (status === "executing") return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
  if (status === "queued" || status === "approved" || status === "pending") return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
  return "border-zinc-200 bg-background text-muted-foreground dark:border-zinc-700"
}

function executionStatusLabel(status: string | null | undefined, approved: boolean | null, copy: AdvisorActionPanelCopy) {
  if (approved === false || status === "rejected") return copy.rejected
  if (status === "executed") return copy.executed
  if (status === "failed") return copy.failed
  if (status === "executing") return copy.executing
  if (approved === true || status === "queued" || status === "approved" || status === "pending") return copy.queuedStatus
  return status ? actionTypeLabel(copy, status) : copy.queuedStatus
}

function actionTypeLabel(copy: AdvisorActionPanelCopy, actionType: string) {
  return copy.actionTypes[actionType] || actionType.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())
}

function advisorEntityLabel(copy: AdvisorActionPanelCopy, entityType: string) {
  const normalized = entityType.toLowerCase()
  return copy.domains[entityType] ||
    copy.domains[normalized] ||
    copy.actionTypes[entityType] ||
    copy.actionTypes[normalized] ||
    actionTypeLabel(copy, entityType)
}

function actionRiskLabel(copy: AdvisorActionPanelCopy, risk: AdvisorAction["risk"] | string) {
  return copy.actionRisks[risk] || risk
}

function actionLabel(action: ShadowAction, copy: AdvisorActionPanelCopy) {
  const advisor = action.payload?.advisor
  if (copy.actionTypes[action.actionType]) return copy.actionTypes[action.actionType]
  if (advisor?.actionLabel) return advisor.actionLabel
  return actionTypeLabel(copy, action.actionType)
}

export function actionTitle(action: ShadowAction) {
  const advisor = action.payload?.advisor
  if (advisor?.title) return advisor.title
  const title = action.payload?.title || action.payload?.subject || action.payload?.invoiceNumber || action.payload?.companyName || action.entityId
  return typeof title === "string" || typeof title === "number" ? String(title) : action.entityId
}

function isTechnicalId(value?: string | null) {
  return typeof value === "string" && /^c[a-z0-9]{16,}$/i.test(value)
}

function actionTargetLabel(action: ShadowAction, copy: AdvisorActionPanelCopy) {
  if (typeof action.payload.invoiceNumber === "string") return `${copy.previewFields.invoice} ${action.payload.invoiceNumber}`
  if (typeof action.payload.companyName === "string") return `${copy.previewFields.company} ${action.payload.companyName}`
  const relatedType = typeof action.payload.relatedType === "string" ? action.payload.relatedType : action.entityType
  const relatedId = typeof action.payload.relatedId === "string" ? action.payload.relatedId : action.entityId
  const entity = advisorEntityLabel(copy, relatedType)
  if (isTechnicalId(relatedId)) return entity
  return `${entity} ${relatedId}`
}

function actionDisplayTitle(action: ShadowAction, copy: AdvisorActionPanelCopy, localizers?: AdvisorActionDisplayLocalizers) {
  const title = actionTitle(action)
  if (title && title !== action.entityId) return localizers?.title ? localizers.title(title) : title
  return `${actionTypeLabel(copy, action.actionType)} · ${actionTargetLabel(action, copy)}`
}

function actionSummary(action: ShadowAction, localizers?: AdvisorActionDisplayLocalizers) {
  const summary = action.evidenceSnapshot?.summary || action.payload.advisor?.summary || ""
  return summary && localizers?.summary ? localizers.summary(summary) : summary
}

function actionFacts(action: ShadowAction): AdvisorFactPreview[] {
  return action.evidenceSnapshot?.facts?.length ? action.evidenceSnapshot.facts : action.payload.advisor?.facts || []
}

function actionSources(action: ShadowAction): AdvisorSourcePreview[] {
  return action.evidenceSnapshot?.sources?.length ? action.evidenceSnapshot.sources : action.payload.advisor?.sources || []
}

function actionPreviewEntries(action: ShadowAction, copy: AdvisorActionPanelCopy): AdvisorActionPreviewEntry[] {
  return buildAdvisorActionPreviewEntries({
    actionType: action.actionType,
    entityType: action.entityType,
    entityId: action.entityId,
    payload: action.payload,
  }, copy.previewFields)
}

function actionFallbackEvidenceFacts(action: ShadowAction, preview: AdvisorActionPreviewEntry[], copy: AdvisorActionPanelCopy): AdvisorFactPreview[] {
  const facts: AdvisorFactPreview[] = [
    { label: copy.target, value: actionTargetLabel(action, copy) },
  ]
  for (const item of preview.slice(0, 3)) {
    facts.push({ label: item.label, value: item.value })
  }
  return facts
}

function editablePayloadFields(action: ShadowAction, copy: AdvisorActionPanelCopy): AdvisorActionEditableField[] {
  return buildAdvisorEditablePayloadFields(action.actionType, action.payload, copy.previewFields)
    .filter((field) => !["relatedId", "relatedType"].includes(field.key))
}

export function parseDraftPayload(draft?: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(draft || "{}") as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function updateDraftPayloadField(draft: string | undefined, key: string, value: string) {
  const parsed = parseDraftPayload(draft) || {}
  return JSON.stringify({ ...parsed, [key]: value }, null, 2)
}

export function AdvisorActionTrailPanel({
  copy,
  pending,
  history,
  onReview,
  localizers,
  className = "",
}: {
  copy: AdvisorActionPanelCopy
  pending: ShadowAction[]
  history: ShadowAction[]
  onReview: (action: ShadowAction, decision: "approve" | "reject") => void
  localizers?: AdvisorActionDisplayLocalizers
  className?: string
}) {
  return (
    <aside className={`rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 2xl:sticky 2xl:top-4 2xl:self-start ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{copy.actionTrail}</h2>
          <p className="text-xs text-muted-foreground">{pending.length} {copy.pendingActions.toLowerCase()}</p>
        </div>
        <Badge variant="outline">{pending.length}</Badge>
      </div>
      <div className="space-y-2">
        {pending.length === 0 ? (
          <EmptyState text={copy.noPending} />
        ) : (
          pending.slice(0, 3).map((action) => (
            <ActionMiniCard key={action.id} action={action} copy={copy} onReview={onReview} localizers={localizers} />
          ))
        )}
      </div>
      <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{copy.recentDecisions}</h3>
        <div className="space-y-2">
          {history.slice(0, 3).map((action) => (
            <ActionMiniCard key={action.id} action={action} copy={copy} localizers={localizers} />
          ))}
          {history.length === 0 ? <p className="text-xs text-muted-foreground">{copy.noHistory}</p> : null}
        </div>
      </div>
    </aside>
  )
}

function ActionMiniCard({
  action,
  copy,
  onReview,
  localizers,
}: {
  action: ShadowAction
  copy: AdvisorActionPanelCopy
  onReview?: (action: ShadowAction, decision: "approve" | "reject") => void
  localizers?: AdvisorActionDisplayLocalizers
}) {
  const facts = actionFacts(action).slice(0, 2)
  const preview = actionPreviewEntries(action, copy).slice(0, 2)
  const summary = actionSummary(action, localizers)

  return (
    <div className="rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={executionStatusClasses(action.executionStatus)}>
          {executionStatusLabel(action.executionStatus, action.approved, copy)}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{actionTargetLabel(action, copy)}</span>
      </div>
      <p className="line-clamp-2 text-sm font-medium">{actionDisplayTitle(action, copy, localizers)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <Clock3 className="mr-1 inline h-3 w-3" />
        {new Date(action.executedAt || action.reviewedAt || action.createdAt).toLocaleString()}
      </p>
      {summary || facts.length > 0 ? (
        <div className="mt-2 rounded-md bg-muted/45 px-2.5 py-2">
          {summary ? <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p> : null}
          {facts.length > 0 ? (
            <div className="mt-2 grid gap-1">
              {facts.map((fact) => (
                <div key={`${action.id}:mini-fact:${fact.label}`} className="grid grid-cols-[82px_minmax(0,1fr)] gap-2 text-[11px]">
                  <span className="truncate text-muted-foreground">{localizers?.factLabel ? localizers.factLabel(fact) : fact.label}</span>
                  <span className="truncate font-medium" title={fact.value}>{localizers?.factValue ? localizers.factValue(fact) : fact.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 rounded-md border border-zinc-200 px-2.5 py-2 text-[11px] dark:border-zinc-700">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{copy.preview}</span>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{actionTypeLabel(copy, action.actionType)}</Badge>
        </div>
        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">{copy.target}</span>
          <span className="truncate font-medium" title={actionTargetLabel(action, copy)}>{actionTargetLabel(action, copy)}</span>
        </div>
        {preview.map((item) => (
          <div key={`${action.id}:mini-preview:${item.label}`} className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-2">
            <span className="truncate text-muted-foreground">{item.label}</span>
            <span className="truncate font-medium" title={item.value}>{localizers?.previewValue ? localizers.previewValue(item.value) : item.value}</span>
          </div>
        ))}
      </div>
      {action.failureReason ? (
        <p className="mt-2 line-clamp-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
          {action.failureReason}
        </p>
      ) : null}
      {onReview && action.approved === null ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onReview(action, "approve")}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {copy.approve}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 flex-1" onClick={() => onReview(action, "reject")}>
            <XCircle className="h-3.5 w-3.5" />
            {copy.reject}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function AdvisorActionExecutionTrail({
  copy,
  actions,
  localizers,
}: {
  copy: AdvisorActionPanelCopy
  actions: ShadowAction[]
  localizers?: AdvisorActionDisplayLocalizers
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-semibold">{copy.executionTrail}</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.executionTrailDesc}</p>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">{actions.length}</Badge>
      </div>
      {actions.length === 0 ? (
        <EmptyState text={copy.noHistory} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {actions.slice(0, 6).map((action) => (
            <ActionMiniCard key={action.id} action={action} copy={copy} localizers={localizers} />
          ))}
        </div>
      )}
    </section>
  )
}

function HistoryFilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ key: string; label: string; count?: number }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.key}
            type="button"
            size="sm"
            variant={value === option.key ? "secondary" : "outline"}
            className="h-8 px-2.5 text-xs"
            onClick={() => onChange(option.key)}
          >
            <span className="truncate">{option.label}</span>
            {typeof option.count === "number" ? <span className="text-muted-foreground">{option.count}</span> : null}
          </Button>
        ))}
      </div>
    </div>
  )
}

function countOptions(actions: ShadowAction[], keyFor: (action: ShadowAction) => { key: string; label: string }) {
  const counts = new Map<string, { label: string; count: number }>()
  for (const action of actions) {
    const option = keyFor(action)
    const current = counts.get(option.key)
    counts.set(option.key, { label: current?.label || option.label, count: (current?.count || 0) + 1 })
  }
  return Array.from(counts.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function AdvisorActionHistoryPanel({
  actions,
  empty,
  copy,
  localizers,
}: {
  actions: ShadowAction[]
  empty: string
  copy: AdvisorActionPanelCopy
  localizers?: AdvisorActionDisplayLocalizers
}) {
  const [statusFilter, setStatusFilter] = useState("all")
  const [moduleFilter, setModuleFilter] = useState("all")
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")

  const statusOptions = useMemo(() => {
    const counted = countOptions(actions, (action) => ({
      key: actionHistoryStatus(action),
      label: executionStatusLabel(action.executionStatus, action.approved, copy),
    }))
    return [{ key: "all", label: copy.allStatuses, count: actions.length }, ...counted]
  }, [actions, copy])

  const moduleOptions = useMemo(() => {
    return [
      { key: "all", label: copy.allModules, count: actions.length },
      ...countOptions(actions, (action) => ({ key: actionModuleKey(action), label: actionModuleLabel(action, copy) })),
    ]
  }, [actions, copy])

  const ownerOptions = useMemo(() => {
    return [
      { key: "all", label: copy.allOwners, count: actions.length },
      ...countOptions(actions, (action) => actionOwnerOption(action, copy.unassigned)),
    ]
  }, [actions, copy.unassigned, copy.allOwners])

  const filteredActions = useMemo(() => filterHistoryActions(actions, {
    status: statusFilter,
    module: moduleFilter,
    owner: ownerFilter,
    date: dateFilter,
  }), [actions, dateFilter, moduleFilter, ownerFilter, statusFilter])

  const showing = copy.historyShowing
    .replace("{shown}", String(filteredActions.length))
    .replace("{total}", String(actions.length))

  const historyStats = useMemo(() => {
    return actions.reduce(
      (acc, action) => {
        const status = actionHistoryStatus(action)
        if (status === "executed") acc.executed += 1
        else if (status === "failed") acc.failed += 1
        else if (status === "rejected") acc.rejected += 1
        else acc.waiting += 1
        return acc
      },
      { executed: 0, failed: 0, rejected: 0, waiting: 0 },
    )
  }, [actions])

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-700 ring-1 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/50">
              <Clock3 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{copy.recentDecisions}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{showing}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <HistoryStatBadge label={copy.executed} value={historyStats.executed} className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300" />
          <HistoryStatBadge label={copy.queuedStatus} value={historyStats.waiting} className="border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" />
          <HistoryStatBadge label={copy.rejected} value={historyStats.rejected} className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" />
          <HistoryStatBadge label={copy.failed} value={historyStats.failed} className="border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" />
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/30 lg:grid-cols-2">
        <HistoryFilterGroup
          label={copy.historyFilters}
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <HistoryFilterGroup
          label={copy.allDates}
          options={[
            { key: "all", label: copy.allDates },
            { key: "today", label: copy.todayDate },
            { key: "week", label: copy.weekDate },
            { key: "month", label: copy.monthDate },
          ]}
          value={dateFilter}
          onChange={setDateFilter}
        />
        <HistoryFilterGroup
          label={copy.allModules}
          options={moduleOptions}
          value={moduleFilter}
          onChange={setModuleFilter}
        />
        <HistoryFilterGroup
          label={copy.allOwners}
          options={ownerOptions}
          value={ownerFilter}
          onChange={setOwnerFilter}
        />
      </div>

      {filteredActions.length === 0 ? (
        <EmptyState text={actions.length === 0 ? empty : copy.noHistory} />
      ) : (
        <div className="space-y-3">
          {filteredActions.map((action, index) => (
            <HistoryDecisionCard
              key={action.id}
              action={action}
              copy={copy}
              index={index}
              localizers={localizers}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function HistoryStatBadge({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${className}`}>
      <p className="font-semibold leading-none">{value}</p>
      <p className="mt-1 whitespace-nowrap">{label}</p>
    </div>
  )
}

function HistoryDecisionCard({
  action,
  copy,
  index,
  localizers,
}: {
  action: ShadowAction
  copy: AdvisorActionPanelCopy
  index: number
  localizers?: AdvisorActionDisplayLocalizers
}) {
  const statusLabel = executionStatusLabel(action.executionStatus, action.approved, copy)
  const statusClass = executionStatusClasses(action.executionStatus)
  const owner = actionOwnerOption(action, copy.unassigned).label
  const summary = actionSummary(action, localizers)

  return (
    <article className="group rounded-2xl border border-zinc-200 bg-background p-4 transition-colors hover:border-orange-200 hover:bg-orange-50/25 dark:border-zinc-800 dark:hover:border-orange-900/50 dark:hover:bg-orange-950/10">
      <div className="grid gap-4 lg:grid-cols-[44px_minmax(0,1fr)_minmax(240px,0.42fr)]">
        <div className="flex lg:block">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
            {index + 1}
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-white/70 dark:bg-zinc-950/30">{actionLabel(action, copy)}</Badge>
            <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>
            {action.riskLevel ? <Badge variant="outline">{actionRiskLabel(copy, action.riskLevel)}</Badge> : null}
          </div>
          <h3 className="break-words text-base font-semibold leading-6">{actionDisplayTitle(action, copy, localizers)}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{actionModuleLabel(action, copy)}</span>
            <span>{owner}</span>
            <span>
              <Clock3 className="mr-1 inline h-3 w-3" />
              {new Date(action.executedAt || action.reviewedAt || action.createdAt).toLocaleString()}
            </span>
          </div>
          {summary ? <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{summary}</p> : null}
          {action.failureReason ? (
            <div className="mt-3 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">{copy.executionFailed}</p>
                <p className="mt-0.5 break-words">{action.failureReason}</p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/30">
          <p className="mb-2 text-xs font-semibold">{copy.preview}</p>
          <div className="space-y-2 text-xs">
            <div>
              <p className="text-muted-foreground">{copy.target}</p>
              <p className="mt-0.5 break-words font-medium">{actionTargetLabel(action, copy)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{copy.evidence}</p>
              <p className="mt-0.5 break-words font-medium">{actionFacts(action)[0]?.value || actionDisplayTitle(action, copy, localizers)}</p>
            </div>
          </div>
        </div>
      </div>
      <details className="mt-3 rounded-xl border border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-950/20">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-orange-700 dark:text-orange-300">
          {copy.reviewDetails}
        </summary>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <ActionDecisionPreview action={action} copy={copy} localizers={localizers} />
        </div>
      </details>
    </article>
  )
}

export function AdvisorActionList({
  actions,
  empty,
  copy,
  onReview,
  localizers,
  editingActionId,
  editDraft,
  onStartEdit,
  onEditFieldChange,
  onCancelEdit,
  onSaveEdit,
}: {
  actions: ShadowAction[]
  empty: string
  copy: AdvisorActionPanelCopy
  onReview?: (action: ShadowAction, decision: "approve" | "reject") => void
  localizers?: AdvisorActionDisplayLocalizers
  editingActionId?: string | null
  editDraft?: string
  onStartEdit?: (action: ShadowAction) => void
  onEditDraftChange?: (value: string) => void
  onEditFieldChange?: (key: string, value: string) => void
  onCancelEdit?: () => void
  onSaveEdit?: (action: ShadowAction) => void
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/50">
              {onReview ? <ShieldCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
            </span>
            <h2 className="text-lg font-semibold">{onReview ? copy.pendingActions : copy.recentDecisions}</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{onReview ? copy.approvalQueueHelp : copy.historyShowing.replace("{shown}", String(actions.length)).replace("{total}", String(actions.length))}</p>
        </div>
        <Badge variant="outline" className="border-orange-200 bg-orange-50 px-2.5 py-1 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300">{actions.length}</Badge>
      </div>
      {actions.length === 0 ? (
        <EmptyState text={empty} />
      ) : (
        <div className="space-y-3">
          {actions.map((action, index) => {
            const fields = editablePayloadFields(action, copy)
            const canEdit = fields.length > 0
            const isEditing = editingActionId === action.id && canEdit

            return (
              <div key={action.id} className={`rounded-2xl border p-4 transition-colors ${onReview && action.approved === null ? "border-orange-200 bg-orange-50/45 dark:border-orange-900/50 dark:bg-orange-950/15" : "border-zinc-200 bg-background dark:border-zinc-800"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={onReview ? "border-orange-200 bg-white/80 text-orange-700 dark:border-orange-900/60 dark:bg-zinc-950/40 dark:text-orange-300" : ""}>{actionLabel(action, copy)}</Badge>
                      <span className="text-[11px] text-muted-foreground">{actionTargetLabel(action, copy)}</span>
                      {action.riskLevel && <Badge variant="outline">{actionRiskLabel(copy, action.riskLevel)}</Badge>}
                      <Badge variant="outline" className={executionStatusClasses(action.executionStatus)}>
                        {executionStatusLabel(action.executionStatus, action.approved, copy)}
                      </Badge>
                    </div>
                    <p className="break-words text-base font-semibold">{actionDisplayTitle(action, copy, localizers)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Clock3 className="mr-1 inline h-3 w-3" />
                      {new Date(action.executedAt || action.reviewedAt || action.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {onReview && action.approved === null ? (
                    <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
                      {onStartEdit && canEdit ? (
                        <Button size="sm" variant="outline" className="w-full rounded-full bg-white/80 sm:w-auto dark:bg-zinc-950/40" onClick={() => onStartEdit(action)}>
                          <FileText className="h-3.5 w-3.5" />
                          {copy.edit}
                        </Button>
                      ) : null}
                      <Button size="sm" className="w-full rounded-full bg-orange-600 text-white shadow-sm hover:bg-orange-700 sm:w-auto" onClick={() => onReview(action, "approve")}><CheckCircle2 className="h-3.5 w-3.5" />{copy.approve}</Button>
                      <Button size="sm" variant="outline" className="w-full rounded-full bg-white/80 sm:w-auto dark:bg-zinc-950/40" onClick={() => onReview(action, "reject")}><XCircle className="h-3.5 w-3.5" />{copy.reject}</Button>
                    </div>
                  ) : null}
                </div>
                {action.failureReason ? (
                  <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <p className="font-medium">{copy.executionFailed}</p>
                      <p className="mt-0.5 break-words">{action.failureReason}</p>
                    </div>
                  </div>
                ) : null}
                {onReview ? (
                  <details className="mt-3 rounded-xl border border-orange-100 bg-white/75 dark:border-orange-900/40 dark:bg-zinc-950/30" open={index === 0 || isEditing}>
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-orange-700 dark:text-orange-300">
                      {copy.reviewDetails}
                    </summary>
                    <div className="border-t border-orange-100 p-3 dark:border-orange-900/40">
                      <ActionDecisionPreview action={action} copy={copy} localizers={localizers} />
                    </div>
                  </details>
                ) : (
                  <ActionDecisionPreview action={action} copy={copy} localizers={localizers} />
                )}
                {isEditing ? (
                  <div className="mt-3 space-y-3 rounded-xl border border-zinc-200 bg-muted/30 p-3 dark:border-zinc-800">
                    <ActionPayloadEditor
                      action={action}
                      copy={copy}
                      draft={editDraft || ""}
                      fields={fields}
                      onFieldChange={onEditFieldChange}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={onCancelEdit}>{copy.cancel}</Button>
                      <Button size="sm" onClick={() => onSaveEdit?.(action)}>{copy.save}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ActionPayloadEditor({
  action,
  copy,
  draft,
  fields,
  onFieldChange,
}: {
  action: ShadowAction
  copy: AdvisorActionPanelCopy
  draft: string
  fields: AdvisorActionEditableField[]
  onFieldChange?: (key: string, value: string) => void
}) {
  const parsed = parseDraftPayload(draft)

  if (fields.length === 0) return null

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.editFields}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((field) => {
            const value = advisorPreviewValue(parsed?.[field.key])
            const editableValue = value === "—" ? "" : value
            return (
              <label key={`${action.id}:edit:${field.key}`} className={field.kind === "textarea" ? "md:col-span-2" : ""}>
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{field.label}</span>
                {field.kind === "textarea" ? (
                  <Textarea
                    value={editableValue}
                    onChange={(event) => onFieldChange?.(field.key, event.target.value)}
                    className="min-h-24 resize-y bg-background"
                  />
                ) : (
                  <Input
                    value={editableValue}
                    onChange={(event) => onFieldChange?.(field.key, event.target.value)}
                    className="h-9 bg-background text-sm"
                  />
                )}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ActionDecisionPreview({
  action,
  copy,
  localizers,
}: {
  action: ShadowAction
  copy: AdvisorActionPanelCopy
  localizers?: AdvisorActionDisplayLocalizers
}) {
  const facts = actionFacts(action)
  const sources = actionSources(action)
  const preview = actionPreviewEntries(action, copy)
  const summary = actionSummary(action, localizers)
  const evidenceFacts = facts.length > 0 ? facts : actionFallbackEvidenceFacts(action, preview, copy)

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
      <div className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{copy.evidence}</span>
          {action.payload.advisor?.severity ? <Badge variant="outline" className={actionSeverityClasses(action.payload.advisor.severity)}>{copy.severities[action.payload.advisor.severity] || action.payload.advisor.severity}</Badge> : null}
          {action.payload.advisor?.domain ? <span className="text-[11px] text-muted-foreground">{copy.domains[action.payload.advisor.domain] || action.payload.advisor.domain}</span> : null}
        </div>
        {summary ? <p className="mb-2 text-xs text-muted-foreground">{summary}</p> : null}
        {evidenceFacts.length > 0 ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {evidenceFacts.slice(0, 4).map((fact) => (
              <div key={`${action.id}:${fact.label}:${fact.value}`} className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">{localizers?.factLabel ? localizers.factLabel(fact) : fact.label}: </span>
                <span className="font-medium">{localizers?.factValue ? localizers.factValue(fact) : fact.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
            <p>{copy.noEvidence}</p>
            <p className="mt-1">{copy.reviewPreviewHint}</p>
          </div>
        )}
        {sources.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {sources.slice(0, 3).map((source) => (
              <Button key={`${action.id}:${source.entityType}:${source.entityId}`} variant="outline" size="sm" className="h-7 px-2 text-[11px]" asChild>
                <Link href={source.href}>
                  <FileText className="h-3 w-3" />
                  {source.label}
                </Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{copy.preview}</span>
          <Badge variant="outline">{actionTypeLabel(copy, action.actionType)}</Badge>
        </div>
        <div className="mb-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">{copy.target}: </span>
          <span className="font-medium">{actionTargetLabel(action, copy)}</span>
        </div>
        <div className="space-y-1.5">
          {preview.map((item) => (
            <div key={`${action.id}:preview:${item.label}`} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="truncate font-medium" title={item.value}>{localizers?.previewValue ? localizers.previewValue(item.value) : item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`max-w-full animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800 ${className}`} />
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-background p-6 text-center text-sm text-muted-foreground dark:border-zinc-700">
      {text}
    </div>
  )
}

export function LoadingPanel() {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="min-w-0 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-9 w-40 rounded-full sm:w-56" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="min-w-0 rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-700">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <SkeletonBlock className="h-5 w-16 rounded-full" />
                <SkeletonBlock className="h-3 w-24" />
              </div>
              <SkeletonBlock className="h-4 w-3/4" />
              <SkeletonBlock className="mt-2 h-3 w-5/6" />
            </div>
          ))}
        </div>
      </section>
      <aside className="min-w-0 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <SkeletonBlock className="mb-4 h-5 w-28" />
        <SkeletonBlock className="h-6 w-20 rounded-full" />
        <SkeletonBlock className="mt-3 h-6 w-4/5" />
        <SkeletonBlock className="mt-2 h-4 w-full" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <SkeletonBlock className="h-14 rounded-lg" />
          <SkeletonBlock className="h-14 rounded-lg" />
        </div>
        <SkeletonBlock className="mt-4 h-24 rounded-lg" />
      </aside>
    </div>
  )
}

export function AdvisorEmptyState({
  capabilities,
  collectorHealth,
  filtered = false,
  labels,
  domainLabel,
  onClearFilters,
}: {
  capabilities: AdvisorCapability[]
  collectorHealth?: AdvisorCollectorHealth[]
  filtered?: boolean
  labels: {
    emptyToday: string
    emptyFilteredTitle: string
    emptyFilteredReason: string
    emptyReasonUnknown: string
    emptyReasonNoAccess: string
    emptyReasonNoModules: string
    emptyReasonQuiet: string
    emptyReasonCollectorFailed: string
    clearFilters: string
    activeModulesCount: string
    lockedModulesCount: string
    noAccessModulesCount: string
    active: string
    noAccess: string
    locked: string
    collectorActive: string
    collectorNoData: string
    collectorFailed: string
    collectorModuleDisabled: string
    collectorNoPermission: string
  }
  domainLabel: (domain: AdvisorDomainKey, fallback?: string) => string
  onClearFilters?: () => void
}) {
  const active = capabilities.filter((capability) => capability.status === "active")
  const locked = capabilities.filter((capability) => capability.status === "locked")
  const noAccess = capabilities.filter((capability) => capability.status === "no_access")
  const failedHealth = collectorHealth?.filter((health) => health.status === "collector_failed") || []
  const diagnostic = capabilities.length === 0
    ? labels.emptyReasonUnknown
    : failedHealth.length > 0
      ? labels.emptyReasonCollectorFailed
      : active.length === 0 && noAccess.length > 0
        ? labels.emptyReasonNoAccess
        : active.length === 0
          ? labels.emptyReasonNoModules
          : labels.emptyReasonQuiet
  const title = filtered ? labels.emptyFilteredTitle : labels.emptyToday
  const message = filtered ? labels.emptyFilteredReason : diagnostic

  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-background p-4 dark:border-zinc-700">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{message}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filtered && onClearFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
              {labels.clearFilters}
            </Button>
          ) : null}
          {failedHealth.length > 0 ? (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {failedHealth.length} {labels.collectorFailed}
            </Badge>
          ) : null}
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {active.length} {labels.activeModulesCount}
          </Badge>
          <Badge variant="outline">
            <Lock className="mr-1 h-3 w-3" />
            {locked.length} {labels.lockedModulesCount}
          </Badge>
          <Badge variant="outline">
            <XCircle className="mr-1 h-3 w-3" />
            {noAccess.length} {labels.noAccessModulesCount}
          </Badge>
        </div>
      </div>
      {capabilities.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {capabilities.map((capability) => (
            <div key={capability.key} className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{domainLabel(capability.key, capability.label)}</span>
                <span className={capability.status === "active" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                  {capability.status === "active" ? labels.active : capability.status === "no_access" ? labels.noAccess : labels.locked}
                </span>
              </div>
              {collectorHealth?.find((item) => item.domain === capability.key) ? (
                <p className="mt-1 line-clamp-1 text-muted-foreground">
                  {collectorHealthLabel(collectorHealth.find((item) => item.domain === capability.key)!, labels)}
                </p>
              ) : null}
              {capability.reason ? <p className="mt-1 line-clamp-1 text-muted-foreground">{capability.reason}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
