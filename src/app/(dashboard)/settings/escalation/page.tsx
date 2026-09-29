"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  ESCALATION_ACTION_TYPES,
  ESCALATION_OFFSET_UNITS,
  ESCALATION_TARGETS,
  ESCALATION_TRIGGER_TYPES,
  MAX_ESCALATION_OFFSET_MINUTES,
  escalationConflictGroups,
  findEscalationConflict,
  minutesToOffset,
  offsetToMinutes,
  ruleActionFromDraft,
  triggerTimeFromDeadline,
  type EscalationActionType,
  type EscalationOffsetUnit,
  type EscalationRule,
  type EscalationRuleDraft,
  type EscalationTarget,
  type EscalationTriggerType,
} from "@/lib/escalation-rules/presentation"

type RuleStatusFilter = "all" | "active" | "inactive" | "conflict"
type FormMode = "create" | "edit" | "duplicate"

const EMPTY_DRAFT: EscalationRuleDraft = {
  name: "",
  triggerType: "first_response_breach",
  offsetValue: 0,
  offsetUnit: "minutes",
  level: 1,
  actionType: "notify",
  actionTarget: "manager",
  isActive: true,
}

function draftFromRule(rule: EscalationRule): EscalationRuleDraft {
  const offset = minutesToOffset(rule.triggerMinutes)
  return {
    name: rule.name,
    triggerType: rule.triggerType,
    offsetValue: offset.value,
    offsetUnit: offset.unit,
    level: rule.level,
    actionType: rule.actions[0]?.type ?? "notify",
    actionTarget: rule.actions[0]?.target ?? "manager",
    isActive: rule.isActive,
  }
}

function localInputValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function RuleSentence({ draft }: { draft: EscalationRuleDraft }) {
  const t = useTranslations("escalationRules")
  const duration = t(`duration.${draft.offsetUnit}`, { count: draft.offsetValue })
  const trigger = draft.triggerType === "resolution_warning"
    ? t("sentenceBefore", { duration })
    : draft.triggerType === "first_response_breach"
      ? t("sentenceAfterFirstResponse", { duration })
      : t("sentenceAfterResolution", { duration })
  const action = draft.actionType === "notify"
    ? t("sentenceNotify", { target: t(`targets.${draft.actionTarget}`) })
    : t(`sentenceActions.${draft.actionType}`)
  return <span>{t("sentence", { trigger, action, level: draft.level })}</span>
}

function RuleFormDialog({ open, mode, sourceRule, rules, onOpenChange, onSaved }: {
  open: boolean
  mode: FormMode
  sourceRule: EscalationRule | null
  rules: EscalationRule[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useTranslations("escalationRules")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [draft, setDraft] = useState<EscalationRuleDraft>(EMPTY_DRAFT)
  const [sampleDeadline, setSampleDeadline] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    const next = sourceRule ? draftFromRule(sourceRule) : { ...EMPTY_DRAFT }
    if (mode === "duplicate" && sourceRule) {
      next.name = t("copyName", { name: sourceRule.name })
      next.isActive = false
    }
    setDraft(next)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setMinutes(0, 0, 0)
    setSampleDeadline(localInputValue(tomorrow))
    setError("")
  }, [mode, open, sourceRule, t])

  const minutes = offsetToMinutes(draft.offsetValue, draft.offsetUnit)
  const conflict = findEscalationConflict(rules, draft, mode === "edit" ? sourceRule?.id : undefined)
  const sampleDate = sampleDeadline ? new Date(sampleDeadline) : null
  const simulated = sampleDate && !Number.isNaN(sampleDate.getTime())
    ? triggerTimeFromDeadline(sampleDate, draft.triggerType, minutes)
    : null
  const offsetInvalid = draft.offsetValue < 0 || !Number.isFinite(draft.offsetValue) || minutes < 0 || minutes > MAX_ESCALATION_OFFSET_MINUTES
  const valid = draft.name.trim().length > 0 && !offsetInvalid && !conflict

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError("")
    try {
      const editing = mode === "edit" && sourceRule
      const response = await fetch(editing ? `/api/v1/escalation-rules/${sourceRule.id}` : "/api/v1/escalation-rules", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          triggerType: draft.triggerType,
          triggerMinutes: minutes,
          level: draft.level,
          actions: [ruleActionFromDraft(draft)],
          isActive: draft.isActive,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.code === "ESCALATION_RULE_CONFLICT" ? t("conflictBlocked") : t("saveFailed"))
      onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const title = mode === "edit" ? t("editRuleTitle") : mode === "duplicate" ? t("duplicateRuleTitle") : t("createEscalationRule")
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <form onSubmit={submit} data-testid="escalation-rule-form" data-mode={mode}>
        <DialogContent>
          {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <div className="grid gap-4">
            <div className="space-y-1"><Label htmlFor="escalation-name">{t("ruleName")}</Label><Input id="escalation-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t("ruleNamePlaceholder")} className="min-h-11" required data-dialog-initial-focus data-testid="escalation-rule-name" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t("triggerType")} value={draft.triggerType} onChange={(event) => setDraft((current) => ({ ...current, triggerType: event.target.value as EscalationTriggerType }))} className="min-h-11">{ESCALATION_TRIGGER_TYPES.map((trigger) => <option key={trigger} value={trigger}>{t(`triggers.${trigger}`)}</option>)}</Select>
              <Select label={t("escalationLevel")} value={String(draft.level)} onChange={(event) => setDraft((current) => ({ ...current, level: Number(event.target.value) }))} className="min-h-11">{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{t("levelOption", { level })}</option>)}</Select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
              <div className="space-y-1"><Label htmlFor="escalation-offset">{draft.triggerType === "resolution_warning" ? t("timeBefore") : t("timeAfter")}</Label><Input id="escalation-offset" type="number" min={0} max={draft.offsetUnit === "days" ? 365 : draft.offsetUnit === "hours" ? 8760 : MAX_ESCALATION_OFFSET_MINUTES} step={draft.offsetUnit === "minutes" ? 1 : 0.5} value={draft.offsetValue} onChange={(event) => setDraft((current) => ({ ...current, offsetValue: Number(event.target.value) }))} className="min-h-11" />{offsetInvalid && <p role="alert" className="text-xs text-destructive">{t("offsetInvalid")}</p>}</div>
              <Select label={t("durationUnit")} value={draft.offsetUnit} onChange={(event) => setDraft((current) => ({ ...current, offsetUnit: event.target.value as EscalationOffsetUnit }))} className="min-h-11">{ESCALATION_OFFSET_UNITS.map((unit) => <option key={unit} value={unit}>{t(`units.${unit}`)}</option>)}</Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t("action")} value={draft.actionType} onChange={(event) => setDraft((current) => ({ ...current, actionType: event.target.value as EscalationActionType }))} className="min-h-11">{ESCALATION_ACTION_TYPES.map((action) => <option key={action} value={action}>{t(`actions.${action}`)}</option>)}</Select>
              {draft.actionType === "notify" && <Select label={t("notifyTarget")} value={draft.actionTarget} onChange={(event) => setDraft((current) => ({ ...current, actionTarget: event.target.value as EscalationTarget }))} className="min-h-11">{ESCALATION_TARGETS.map((target) => <option key={target} value={target}>{t(`targets.${target}`)}</option>)}</Select>}
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm"><Switch checked={draft.isActive} onCheckedChange={(isActive) => setDraft((current) => ({ ...current, isActive }))} aria-label={t("activeRule")} className="h-6 w-11" data-testid="escalation-rule-form-active" />{t("activeRule")}<span className="ml-auto text-xs text-muted-foreground">{draft.isActive ? t("active") : t("inactive")}</span></label>

            <section aria-labelledby="rule-preview-title" className="rounded-xl border bg-muted/10 p-3" data-testid="escalation-rule-preview">
              <h3 id="rule-preview-title" className="text-sm font-semibold">{t("previewTitle")}</h3>
              <p className="mt-2 text-sm"><RuleSentence draft={draft} /></p>
              <p className="mt-1 text-xs text-muted-foreground">{t("orderBehavior")}</p>
              <div className="mt-3 space-y-1"><Label htmlFor="sample-deadline" className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />{t("sampleDeadline")}</Label><Input id="sample-deadline" type="datetime-local" value={sampleDeadline} onChange={(event) => setSampleDeadline(event.target.value)} className="min-h-11" /></div>
              {simulated && <p className="mt-2 text-sm font-medium">{t("simulationResult", { time: simulated.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>}
            </section>
            {conflict && <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm" data-testid="escalation-rule-conflict"><AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />{t("conflictWarning", { name: conflict.name })}</p>}
          </div>
        </DialogContent>
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={saving}>{tc("cancel")}</Button><Button type="submit" className="min-h-11" disabled={!valid || saving} data-testid="escalation-rule-save">{saving ? <><Loader2 className="animate-spin motion-reduce:animate-none" />{tc("saving")}</> : mode === "edit" ? tc("save") : t("createRule")}</Button></DialogFooter>
      </form>
    </Dialog>
  )
}

export default function EscalationSettingsPage() {
  const t = useTranslations("escalationRules")
  useAutoTour("escalationSettings")
  const [rules, setRules] = useState<EscalationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [errorRetryable, setErrorRetryable] = useState(true)
  const [canWrite, setCanWrite] = useState(false)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("all")
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>("create")
  const [sourceRule, setSourceRule] = useState<EscalationRule | null>(null)
  const [deleteRule, setDeleteRule] = useState<EscalationRule | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError("")
    setErrorRetryable(true)
    let retryable = true
    try {
      const response = await fetch("/api/v1/escalation-rules")
      const payload = await response.json().catch(() => null)
      retryable = response.status !== 403
      if (!response.ok || !Array.isArray(payload?.data)) throw new Error(response.status === 403 ? t("permissionDenied") : t("loadFailed"))
      setRules(payload.data)
      setCanWrite(Boolean(payload.permissions?.canWrite))
      setErrorRetryable(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("loadFailed"))
      setErrorRetryable(retryable)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void fetchRules() }, [fetchRules])

  const conflictIds = useMemo(() => new Set(escalationConflictGroups(rules).flatMap((group) => group.map((rule) => rule.id))), [rules])
  const visibleRules = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rules.filter((rule) => {
      if (needle && !`${rule.name} ${rule.triggerType} ${rule.actions.map((action) => action.type).join(" ")}`.toLowerCase().includes(needle)) return false
      if (statusFilter === "active" && !rule.isActive) return false
      if (statusFilter === "inactive" && rule.isActive) return false
      if (statusFilter === "conflict" && !conflictIds.has(rule.id)) return false
      return true
    })
  }, [conflictIds, query, rules, statusFilter])

  const openForm = (mode: FormMode, rule: EscalationRule | null = null) => {
    setFormMode(mode)
    setSourceRule(rule)
    setFormOpen(true)
  }

  const toggleRule = async (rule: EscalationRule) => {
    if (!canWrite || savingId) return
    const previous = rules
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, isActive: !item.isActive } : item))
    setSavingId(rule.id)
    setStatus(null)
    try {
      const response = await fetch(`/api/v1/escalation-rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !rule.isActive }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.code === "ESCALATION_RULE_CONFLICT" ? t("conflictBlocked") : t("saveFailed"))
      setStatus({ kind: "success", text: rule.isActive ? t("ruleDisabled", { name: rule.name }) : t("ruleEnabled", { name: rule.name }) })
      void fetchRules()
    } catch (caught) {
      setRules(previous)
      setStatus({ kind: "error", text: caught instanceof Error ? caught.message : t("toggleRolledBack") })
    } finally {
      setSavingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteRule) return
    const response = await fetch(`/api/v1/escalation-rules/${deleteRule.id}`, { method: "DELETE" })
    if (!response.ok) throw new Error(t("deleteFailed"))
    setStatus({ kind: "success", text: t("ruleDeleted", { name: deleteRule.name }) })
    setDeleteRule(null)
    await fetchRules()
  }

  return (
    <SupportPageShell
      data-testid="escalation-rules-workspace"
      data-state={loading ? "loading" : error ? "error" : "ready"}
      data-write={canWrite ? "allowed" : "read-only"}
      title={<span data-tour-id="escalation-header">{t("title")}</span>}
      description={t("subtitleCompact")}
      leading={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
      utilities={<><TourReplayButton tourId="escalationSettings" className="min-h-11 px-2" /><HelpButton slug="escalation" className="h-11 w-11 shrink-0" /></>}
      actions={canWrite ? <Button className="min-h-11 w-full shrink-0 sm:w-auto" onClick={() => openForm("create")} data-tour-id="escalation-new"><Plus />{t("newRule")}</Button> : undefined}
    >

      {!loading && !error && <section aria-label={t("summaryTitle")} className="grid divide-y rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="escalation-rules-summary"><div className="p-3"><p className="text-lg font-semibold tabular-nums">{rules.length}</p><p className="text-xs text-muted-foreground">{t("totalRules")}</p></div><div className="p-3"><p className="text-lg font-semibold tabular-nums">{rules.filter((rule) => rule.isActive).length}</p><p className="text-xs text-muted-foreground">{t("activeRules")}</p></div><div className="p-3"><p className="text-lg font-semibold tabular-nums">{conflictIds.size}</p><p className="text-xs text-muted-foreground">{t("conflictingRules")}</p></div></section>}

      {status && <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${status.kind === "error" ? "border-destructive/30" : ""}`} data-testid="escalation-rules-status" data-kind={status.kind}>{status.kind === "error" ? <AlertCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4" />}{status.text}</div>}

      {!loading && !error && <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_12rem]" data-testid="escalation-rules-filters"><label className="relative"><span className="sr-only">{t("searchRules")}</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchRules")} className="min-h-11 pl-9" data-testid="escalation-rules-search" /></label><Select aria-label={t("filterRules")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RuleStatusFilter)} className="min-h-11" data-testid="escalation-rules-filter"><option value="all">{t("filterAll")}</option><option value="active">{t("filterActive")}</option><option value="inactive">{t("filterInactive")}</option><option value="conflict">{t("filterConflict")}</option></Select></div>}

      {loading ? <div aria-busy="true" className="space-y-2 rounded-xl border p-3" data-testid="escalation-rules-loading">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/30 motion-reduce:animate-none" />)}</div> : error ? <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-xl border p-6 text-center" data-testid="escalation-rules-error" data-retryable={errorRetryable ? "true" : "false"}><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{error}</p>{errorRetryable && <Button variant="outline" className="mt-4 min-h-11" onClick={() => void fetchRules()} data-testid="escalation-rules-retry"><RotateCcw />{t("retry")}</Button>}</div> : rules.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border p-6 text-center" data-testid="escalation-rules-empty"><AlertTriangle className="h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">{t("noRules")}</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">{t("noRulesDesc")}</p>{canWrite && <Button className="mt-4 min-h-11" onClick={() => openForm("create")} data-testid="escalation-rule-create-first"><Plus />{t("createFirstRule")}</Button>}</div> : visibleRules.length === 0 ? <div className="rounded-xl border p-8 text-center" data-testid="escalation-rules-filter-empty"><p className="text-sm font-medium">{t("noRuleResults")}</p><Button variant="ghost" className="mt-2 min-h-11" onClick={() => { setQuery(""); setStatusFilter("all") }} data-testid="escalation-rules-reset-filters">{t("resetFilters")}</Button></div> : (
        <section aria-label={t("rulesList")} className="divide-y rounded-xl border bg-card" data-tour-id="escalation-list" data-testid="escalation-rules-list">
          {visibleRules.map((rule) => {
            const draft = draftFromRule(rule)
            const conflict = conflictIds.has(rule.id)
            return <article key={rule.id} className="grid gap-3 p-3 lg:grid-cols-[4rem_minmax(0,1fr)_auto] lg:items-center" data-testid="escalation-rule-row" data-rule-id={rule.id} data-conflict={conflict ? "true" : "false"}><div><Badge variant="outline">L{rule.level}</Badge></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{rule.name}</h2><span className="text-xs text-muted-foreground">{rule.isActive ? t("active") : t("inactive")}</span>{conflict && <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{t("conflict")}</span>}</div><p className="mt-1 text-sm text-muted-foreground"><RuleSentence draft={draft} /></p></div><div className="flex flex-wrap items-center gap-1">{canWrite && <label className="flex min-h-11 items-center gap-2 px-2 text-xs"><Switch checked={rule.isActive} onCheckedChange={() => void toggleRule(rule)} disabled={savingId === rule.id} aria-label={rule.isActive ? t("disableNamed", { name: rule.name }) : t("enableNamed", { name: rule.name })} className="h-6 w-11" data-testid="escalation-rule-toggle" />{savingId === rule.id && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}</label>}{canWrite && <><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("editNamed", { name: rule.name })} onClick={() => openForm("edit", rule)} data-testid="escalation-rule-edit"><Pencil /></Button><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("duplicateNamed", { name: rule.name })} onClick={() => openForm("duplicate", rule)} data-testid="escalation-rule-duplicate"><Copy /></Button><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("deleteNamed", { name: rule.name })} onClick={() => setDeleteRule(rule)} data-testid="escalation-rule-delete"><Trash2 /></Button></>}</div></article>
          })}
        </section>
      )}
      {!canWrite && !loading && !error && <p className="rounded-lg border p-3 text-sm text-muted-foreground" data-testid="escalation-rules-read-only">{t("readOnlyHint")}</p>}

      <RuleFormDialog open={formOpen} mode={formMode} sourceRule={sourceRule} rules={rules} onOpenChange={(open) => { setFormOpen(open); if (!open) setSourceRule(null) }} onSaved={() => { setStatus({ kind: "success", text: formMode === "edit" ? t("ruleSaved") : t("ruleCreated") }); void fetchRules() }} />
      <ConfirmDialog open={Boolean(deleteRule)} onOpenChange={(open) => { if (!open) setDeleteRule(null) }} onConfirm={confirmDelete} title={t("deleteTitle")} description={deleteRule ? t("deleteDescription", { name: deleteRule.name }) : undefined} />
    </SupportPageShell>
  )
}
