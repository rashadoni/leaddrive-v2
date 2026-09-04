"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  MILESTONE_SEVERITY_SCOPES,
  dueWindowToSeconds,
  secondsToDueWindow,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  moveTemplateRule,
  parseStoredTemplateDraft,
  validateTemplateDraft,
  type TemplateDraft,
  type TemplateRuleDraft,
} from "@/lib/entitlement-process/template-draft"
import {
  MILESTONE_TYPES,
  SUPPORT_LEVELS,
  type MilestoneType,
  type SupportLevel,
} from "@/lib/entitlement-process/types"

interface TemplateDefinition {
  id: string
  type: MilestoneType
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  sortOrder: number
}

interface EntitlementTemplate {
  id: string
  supportLevel: SupportLevel
  name: string
  description: string | null
  isActive: boolean
  definitions: TemplateDefinition[]
}

interface TemplatePermissions {
  canWrite: boolean
}

const DEFAULT_ENGLISH_TEMPLATE_NAMES = new Set(["Basic", "Standard", "Premium", "Enterprise"])
const DEFAULT_ENGLISH_RULE_NAMES = new Set([
  "First response",
  "Resolution",
  "Problem identified",
  "Workaround delivered",
  "Critical first response",
  "High first response",
  "Critical problem identified",
  "Critical workaround",
  "Critical resolution",
  "High resolution",
  "Critical escalation",
  "High escalation",
])

function asMilestoneType(value: string): MilestoneType {
  return MILESTONE_TYPES.includes(value as MilestoneType) ? value as MilestoneType : "first_response"
}

function asSeverityScope(value: string): MilestoneSeverityScope {
  return MILESTONE_SEVERITY_SCOPES.includes(value as MilestoneSeverityScope)
    ? value as MilestoneSeverityScope
    : "all"
}

function asDueUnit(value: string): DueWindowUnit {
  return value === "minutes" || value === "hours" || value === "days" ? value : "hours"
}

function localizedRuleName(
  definition: Pick<TemplateDefinition, "name" | "type" | "severityTier">,
  te: ReturnType<typeof useTranslations>,
) {
  if (!DEFAULT_ENGLISH_RULE_NAMES.has(definition.name)) return definition.name
  const type = te(`milestoneTypes.${definition.type}`)
  return definition.severityTier
    ? `${te(`severityScopes.${definition.severityTier}`)} · ${type}`
    : type
}

function toDraft(template: EntitlementTemplate, te: ReturnType<typeof useTranslations>): TemplateDraft {
  return {
    supportLevel: template.supportLevel,
    name: DEFAULT_ENGLISH_TEMPLATE_NAMES.has(template.name)
      ? te(`supportLevels.${template.supportLevel}`)
      : template.name,
    description: template.description ?? "",
    isActive: template.isActive,
    definitions: template.definitions
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((definition) => {
        const due = secondsToDueWindow(definition.dueWithinSeconds)
        return {
          key: definition.id,
          type: definition.type,
          name: localizedRuleName(definition, te),
          severityTier: (definition.severityTier ?? "all") as MilestoneSeverityScope,
          dueValue: due.value,
          dueUnit: due.unit,
          isRequired: definition.isRequired,
        }
      }),
  }
}

function defaultRule(te: ReturnType<typeof useTranslations>, key: string): TemplateRuleDraft {
  return {
    key,
    type: "first_response",
    name: te("milestoneTypes.first_response"),
    severityTier: "all",
    dueValue: 4,
    dueUnit: "hours",
    isRequired: true,
  }
}

function emptyDraft(level: SupportLevel, te: ReturnType<typeof useTranslations>): TemplateDraft {
  return {
    supportLevel: level,
    name: te(`supportLevels.${level}`),
    description: "",
    isActive: true,
    definitions: [defaultRule(te, `new-${level}-0`)],
  }
}

function storageKey(orgId: string, level: SupportLevel) {
  return `leaddrive:entitlement-template-draft:${orgId}:${level}`
}

function nextRuleKey(level: SupportLevel) {
  return `new-${level}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function EntitlementTemplatesPage() {
  const t = useTranslations("slice2.entitlementTemplates")
  const te = useTranslations("slice2.entitlements")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [templates, setTemplates] = useState<EntitlementTemplate[]>([])
  const [permissions, setPermissions] = useState<TemplatePermissions>({ canWrite: false })
  const [activeLevel, setActiveLevel] = useState<SupportLevel>("standard")
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft("standard", te))
  const [baseline, setBaseline] = useState<TemplateDraft>(() => emptyDraft("standard", te))
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null)
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<TemplateRuleDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const activeTemplate = useMemo(
    () => templates.find((template) => template.supportLevel === activeLevel) ?? null,
    [activeLevel, templates],
  )
  const isDirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const draftIssue = useMemo(() => validateTemplateDraft(draft), [draft])

  const readStoredDraft = useCallback((level: SupportLevel) => {
    if (!orgId || typeof window === "undefined") return null
    try {
      return parseStoredTemplateDraft(window.sessionStorage.getItem(storageKey(orgId, level)), level)
    } catch {
      return null
    }
  }, [orgId])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/v1/entitlement-templates")
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || !Array.isArray(payload.templates)) {
        throw new Error(response.status === 403 ? t("permissionDenied") : t("loadFailed"))
      }
      const nextTemplates = payload.templates as EntitlementTemplate[]
      const nextActive = nextTemplates.find((template) => template.supportLevel === "standard") ?? nextTemplates[0]
      setTemplates(nextTemplates)
      setPermissions(payload.permissions ?? { canWrite: false })
      if (nextActive) {
        const saved = toDraft(nextActive, te)
        setActiveLevel(nextActive.supportLevel)
        setBaseline(saved)
        setDraft(readStoredDraft(nextActive.supportLevel) ?? saved)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [readStoredDraft, t, te])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (loading || !orgId || !permissions.canWrite || typeof window === "undefined") return
    try {
      const key = storageKey(orgId, activeLevel)
      if (isDirty) window.sessionStorage.setItem(key, JSON.stringify(draft))
      else window.sessionStorage.removeItem(key)
    } catch {
      // Editing continues in memory when browser storage is unavailable.
    }
  }, [activeLevel, draft, isDirty, loading, orgId, permissions.canWrite])

  const selectTemplate = (level: SupportLevel) => {
    if (level === activeLevel) return
    if (orgId && permissions.canWrite && isDirty && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(storageKey(orgId, activeLevel), JSON.stringify(draft))
      } catch {
        // The in-memory draft remains available if browser storage is unavailable.
      }
    }
    const template = templates.find((item) => item.supportLevel === level)
    const saved = template ? toDraft(template, te) : emptyDraft(level, te)
    setActiveLevel(level)
    setBaseline(saved)
    setDraft(readStoredDraft(level) ?? saved)
    setExpandedRuleKey(null)
    setError("")
  }

  const updateDraft = (patch: Partial<TemplateDraft>) => {
    if (!permissions.canWrite) return
    setDraft((current) => ({ ...current, ...patch }))
    setError("")
  }

  const updateDefinition = (key: string, patch: Partial<TemplateRuleDraft>) => {
    if (!permissions.canWrite) return
    setDraft((current) => ({
      ...current,
      definitions: current.definitions.map((definition) => definition.key === key
        ? { ...definition, ...patch }
        : definition),
    }))
    setError("")
  }

  const addDefinition = () => {
    if (!permissions.canWrite) return
    const definition = defaultRule(te, nextRuleKey(activeLevel))
    setDraft((current) => ({ ...current, definitions: [...current.definitions, definition] }))
    setExpandedRuleKey(definition.key)
  }

  const removeDefinition = async () => {
    if (!deleteRuleTarget) return
    setDraft((current) => ({
      ...current,
      definitions: current.definitions.filter((definition) => definition.key !== deleteRuleTarget.key),
    }))
    if (expandedRuleKey === deleteRuleTarget.key) setExpandedRuleKey(null)
    setDeleteRuleTarget(null)
  }

  const moveDefinition = (index: number, direction: -1 | 1) => {
    setDraft((current) => ({
      ...current,
      definitions: moveTemplateRule(current.definitions, index, direction),
    }))
  }

  const discardDraft = () => {
    const saved = activeTemplate ? toDraft(activeTemplate, te) : emptyDraft(activeLevel, te)
    setDraft(saved)
    setBaseline(saved)
    setExpandedRuleKey(null)
    setError("")
    if (orgId && typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(storageKey(orgId, activeLevel)) } catch { /* no-op */ }
    }
  }

  const saveTemplate = async () => {
    if (!permissions.canWrite || !isDirty || saving) return
    if (draftIssue) {
      setError(t(`validation.${draftIssue}`))
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/v1/entitlement-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supportLevel: draft.supportLevel,
          name: draft.name,
          description: draft.description,
          isActive: draft.isActive,
          definitions: draft.definitions.map(({ type, name, severityTier, dueValue, dueUnit, isRequired }) => ({
            type, name, severityTier, dueValue, dueUnit, isRequired,
          })),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = response.status === 403
          ? t("permissionDenied")
          : payload?.code === "TEMPLATE_DUPLICATE"
            ? t("validation.duplicate_rule")
            : payload?.code === "TEMPLATE_ACTIVE_EMPTY"
              ? t("validation.active_without_rules")
              : t("saveFailed")
        throw new Error(message)
      }
      const nextTemplates = Array.isArray(payload.templates) ? payload.templates as EntitlementTemplate[] : templates
      const savedTemplate = payload.template as EntitlementTemplate | undefined
      const savedDraft = savedTemplate ? toDraft(savedTemplate, te) : draft
      if (orgId && typeof window !== "undefined") {
        try { window.sessionStorage.removeItem(storageKey(orgId, activeLevel)) } catch { /* no-op */ }
      }
      setTemplates(nextTemplates)
      setDraft(savedDraft)
      setBaseline(savedDraft)
      setExpandedRuleKey(null)
      toast.success(t("savedToast"))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t("saveFailed")
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const statusText = !permissions.canWrite
    ? t("readOnlyHint")
    : saving
      ? t("saving")
      : !isDirty
        ? t("noChanges")
        : draftIssue
          ? t(`validation.${draftIssue}`)
          : t("draftSavedLocally")

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <Settings2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h1 className="truncate text-xl font-semibold tracking-tight">{t("title")}</h1><HelpButton slug="entitlements" /></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitleCompact")}</p>
        </div>
      </header>

      {error && templates.length > 0 && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><AlertCircle className="h-4 w-4 shrink-0 text-destructive" /><span className="min-w-0 flex-1">{error}</span></div>}

      <nav aria-label={t("levels")} className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist">
        {SUPPORT_LEVELS.map((level) => {
          const template = templates.find((item) => item.supportLevel === level)
          const selected = level === activeLevel
          const stored = selected && isDirty
          return (
            <button key={level} type="button" role="tab" aria-selected={selected} className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none ${selected ? "border-foreground bg-muted/30" : "hover:bg-muted/30"}`} onClick={() => selectTemplate(level)} disabled={loading}>
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{te(`supportLevels.${level}`)}</span><span className="text-xs text-muted-foreground">{template?.definitions.length ?? 0}</span></span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">{stored ? <><Clock3 className="h-3 w-3" />{t("draft")}</> : template?.isActive ? <><CheckCircle2 className="h-3 w-3" />{t("active")}</> : t("inactive")}</span>
            </button>
          )
        })}
      </nav>

      {loading ? (
        <div aria-busy="true" className="space-y-3 rounded-xl border p-4">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded bg-muted/30 motion-reduce:animate-none" />)}</div>
      ) : templates.length === 0 ? (
        <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-xl border p-6 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{error || t("loadFailed")}</p><Button variant="outline" className="mt-4 min-h-11" onClick={() => void loadTemplates()}><RotateCcw />{t("retry")}</Button></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-w-0 space-y-4">
            <section aria-labelledby="template-meta-title" className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><h2 id="template-meta-title" className="text-base font-semibold">{t("editorTitle", { level: te(`supportLevels.${activeLevel}`) })}</h2>{isDirty && <Badge variant="secondary" className="gap-1"><Clock3 className="h-3 w-3" />{t("draft")}</Badge>}</div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1"><Label htmlFor="template-name">{t("name")}</Label><Input id="template-name" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className="min-h-11" disabled={!permissions.canWrite} /></div>
                <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border px-3 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft({ isActive: event.target.checked })} className="h-4 w-4" disabled={!permissions.canWrite} />{t("templateActive")}</label>
              </div>
              <div className="mt-3 space-y-1"><Label htmlFor="template-description">{t("description")}</Label><Textarea id="template-description" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder={t("descriptionPlaceholder")} rows={2} disabled={!permissions.canWrite} /></div>
            </section>

            <section aria-labelledby="template-rules-title" className="rounded-xl border bg-card p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h2 id="template-rules-title" className="text-base font-semibold">{t("rules")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t("orderHint")}</p></div>
                {permissions.canWrite && <Button type="button" variant="outline" className="min-h-11" onClick={addDefinition} disabled={draft.definitions.length >= 30}><Plus />{t("addRule")}</Button>}
              </div>
              <div className="mt-3 divide-y rounded-lg border">
                {draft.definitions.map((definition, index) => {
                  const expanded = definition.key === expandedRuleKey
                  return (
                    <article key={definition.key}>
                      <div className="flex items-center gap-1 p-2">
                        <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={expanded} aria-controls={`template-rule-${index}`} onClick={() => setExpandedRuleKey(expanded ? null : definition.key)}>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{definition.name || t("unnamedRule")}</span><span className="block truncate text-xs text-muted-foreground">{te(`milestoneTypes.${definition.type}`)} · {te(`severityScopes.${definition.severityTier}`)} · {definition.dueValue} {te(`dueUnitsShort.${definition.dueUnit}`)}</span></span>
                          <Badge variant="outline" className="hidden sm:inline-flex">{definition.isRequired ? t("required") : t("optional")}</Badge>
                        </button>
                        {permissions.canWrite && <>
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("moveUpNamed", { name: definition.name || t("unnamedRule") })} onClick={() => moveDefinition(index, -1)} disabled={index === 0}><ArrowUp /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("moveDownNamed", { name: definition.name || t("unnamedRule") })} onClick={() => moveDefinition(index, 1)} disabled={index === draft.definitions.length - 1}><ArrowDown /></Button>
                          <Button type="button" variant="ghost" size="icon" className="hidden h-11 w-11 sm:inline-flex" aria-label={t("editRuleNamed", { name: definition.name || t("unnamedRule") })} onClick={() => setExpandedRuleKey(definition.key)}><Pencil /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("deleteRuleNamed", { name: definition.name || t("unnamedRule") })} onClick={() => setDeleteRuleTarget(definition)}><Trash2 /></Button>
                        </>}
                      </div>
                      {expanded && (
                        <RuleEditor
                          id={`template-rule-${index}`}
                          definition={definition}
                          index={index}
                          disabled={!permissions.canWrite}
                          t={t}
                          te={te}
                          onChange={(patch) => updateDefinition(definition.key, patch)}
                        />
                      )}
                    </article>
                  )
                })}
                {draft.definitions.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t("emptyRules")}</div>}
              </div>
            </section>
          </main>

          <TemplatePreview draft={draft} t={t} te={te} />
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{isDirty ? t("unsavedTitle") : t("savedTitle")}</p><p className={`text-xs ${draftIssue && isDirty ? "text-destructive" : "text-muted-foreground"}`}>{statusText}</p></div>
          {permissions.canWrite && <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11 flex-1 sm:flex-none" onClick={discardDraft} disabled={!isDirty || saving}>{t("discard")}</Button><Button type="button" className="min-h-11 flex-1 sm:flex-none" onClick={saveTemplate} disabled={!isDirty || Boolean(draftIssue) || saving}>{saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />}{t("save")}</Button></div>}
        </div>
      )}

      <ConfirmDialog open={Boolean(deleteRuleTarget)} onOpenChange={(open) => { if (!open) setDeleteRuleTarget(null) }} onConfirm={removeDefinition} title={t("deleteRuleTitle")} description={deleteRuleTarget ? t("deleteRuleDescription", { name: deleteRuleTarget.name || t("unnamedRule") }) : undefined} />
    </div>
  )
}

function RuleEditor({ id, definition, index, disabled, t, te, onChange }: {
  id: string
  definition: TemplateRuleDraft
  index: number
  disabled: boolean
  t: ReturnType<typeof useTranslations>
  te: ReturnType<typeof useTranslations>
  onChange: (patch: Partial<TemplateRuleDraft>) => void
}) {
  return (
    <div id={id} className="grid gap-3 border-t bg-muted/10 p-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${id}-name`}>{t("ruleName")}</Label><Input id={`${id}-name`} value={definition.name} onChange={(event) => onChange({ name: event.target.value })} className="min-h-11" disabled={disabled} data-dialog-initial-focus /></div>
      <Select label={t("milestoneType")} value={definition.type} onChange={(event) => onChange({ type: asMilestoneType(event.target.value), name: te(`milestoneTypes.${asMilestoneType(event.target.value)}`) })} className="min-h-11" disabled={disabled}>{MILESTONE_TYPES.map((type) => <option key={type} value={type}>{te(`milestoneTypes.${type}`)}</option>)}</Select>
      <Select label={t("severity")} value={definition.severityTier} onChange={(event) => onChange({ severityTier: asSeverityScope(event.target.value) })} className="min-h-11" disabled={disabled}>{MILESTONE_SEVERITY_SCOPES.map((severity) => <option key={severity} value={severity}>{te(`severityScopes.${severity}`)}</option>)}</Select>
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <div className="space-y-1"><Label htmlFor={`${id}-due`}>{t("dueValue")}</Label><Input id={`${id}-due`} type="number" min="1" value={definition.dueValue} onChange={(event) => onChange({ dueValue: Number(event.target.value) })} className="min-h-11" disabled={disabled} /></div>
        <Select label={t("dueUnit")} value={definition.dueUnit} onChange={(event) => onChange({ dueUnit: asDueUnit(event.target.value) })} className="min-h-11" disabled={disabled}><option value="minutes">{te("dueUnits.minutes")}</option><option value="hours">{te("dueUnits.hours")}</option><option value="days">{te("dueUnits.days")}</option></Select>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={definition.isRequired} onChange={(event) => onChange({ isRequired: event.target.checked })} className="h-4 w-4" disabled={disabled} />{t("required")}</label>
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("rulePosition", { position: index + 1 })}</p>
    </div>
  )
}

function TemplatePreview({ draft, t, te }: {
  draft: TemplateDraft
  t: ReturnType<typeof useTranslations>
  te: ReturnType<typeof useTranslations>
}) {
  const timeline = draft.definitions.map((definition, index) => {
    let seconds = Number.POSITIVE_INFINITY
    try { seconds = dueWindowToSeconds(definition.dueValue, definition.dueUnit) } catch { /* invalid items sort last */ }
    return { definition, index, seconds }
  }).sort((left, right) => left.seconds - right.seconds || left.index - right.index)
  const required = draft.definitions.filter((definition) => definition.isRequired).length
  return (
    <aside aria-labelledby="template-preview-title" className="h-fit rounded-xl border bg-card p-4 xl:sticky xl:top-4">
      <h2 id="template-preview-title" className="text-base font-semibold">{t("previewTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("previewSummary", { total: draft.definitions.length, required })}</p>
      {!draft.isActive && <p className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm">{t("previewInactive")}</p>}
      {timeline.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {timeline.map(({ definition }) => (
            <li key={definition.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm">
              <span className="font-medium tabular-nums">{definition.dueValue} {te(`dueUnitsShort.${definition.dueUnit}`)}</span>
              <span><span className="block font-medium">{definition.name || t("unnamedRule")}</span><span className="block text-xs text-muted-foreground">{te(`milestoneTypes.${definition.type}`)} · {te(`severityScopes.${definition.severityTier}`)} · {definition.isRequired ? t("required") : t("optional")}</span></span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 text-sm text-muted-foreground">{t("previewEmpty")}</p>}
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{t("previewBehavior")}</p>
    </aside>
  )
}
