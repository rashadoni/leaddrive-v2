"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertCircle, Copy, Loader2, Plus, Save, Settings2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  MILESTONE_SEVERITY_SCOPES,
  secondsToDueWindow,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
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

interface DefinitionDraft {
  type: MilestoneType
  name: string
  severityTier: MilestoneSeverityScope
  dueValue: number
  dueUnit: DueWindowUnit
  isRequired: boolean
}

interface TemplateDraft {
  supportLevel: SupportLevel
  name: string
  description: string
  isActive: boolean
  definitions: DefinitionDraft[]
}

const DEFAULT_RULE: DefinitionDraft = {
  type: "first_response",
  name: "First response",
  severityTier: "all",
  dueValue: 4,
  dueUnit: "hours",
  isRequired: true,
}

function toDraft(template: EntitlementTemplate): TemplateDraft {
  return {
    supportLevel: template.supportLevel,
    name: template.name,
    description: template.description ?? "",
    isActive: template.isActive,
    definitions: template.definitions
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((definition) => {
        const due = secondsToDueWindow(definition.dueWithinSeconds)
        return {
          type: definition.type,
          name: definition.name,
          severityTier: (definition.severityTier ?? "all") as MilestoneSeverityScope,
          dueValue: due.value,
          dueUnit: due.unit,
          isRequired: definition.isRequired,
        }
      }),
  }
}

function emptyDraft(supportLevel: SupportLevel): TemplateDraft {
  return {
    supportLevel,
    name: supportLevel[0].toUpperCase() + supportLevel.slice(1),
    description: "",
    isActive: true,
    definitions: [{ ...DEFAULT_RULE }],
  }
}

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

export default function EntitlementTemplatesPage() {
  const t = useTranslations("slice2.entitlementTemplates")
  const te = useTranslations("slice2.entitlements")
  const tc = useTranslations("common")
  const [templates, setTemplates] = useState<EntitlementTemplate[]>([])
  const [activeLevel, setActiveLevel] = useState<SupportLevel>("standard")
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft("standard"))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTemplate = useMemo(
    () => templates.find((template) => template.supportLevel === activeLevel) ?? null,
    [activeLevel, templates],
  )

  useEffect(() => {
    let cancelled = false
    async function loadTemplates() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/v1/entitlement-templates")
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || t("loadFailed"))
        if (cancelled) return
        const nextTemplates = (json.templates ?? []) as EntitlementTemplate[]
        setTemplates(nextTemplates)
        const nextActive =
          nextTemplates.find((template) => template.supportLevel === "standard") ??
          nextTemplates[0]
        if (nextActive) {
          setActiveLevel(nextActive.supportLevel)
          setDraft(toDraft(nextActive))
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t("loadFailed")
        setError(message)
        toast.error(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTemplates()
    return () => {
      cancelled = true
    }
  }, [t])

  const draftInvalid = useMemo(() => {
    if (!draft.name.trim()) return true
    if (draft.isActive && draft.definitions.length === 0) return true
    return draft.definitions.some((definition) => {
      return !definition.name.trim() || !Number.isFinite(definition.dueValue) || definition.dueValue <= 0
    })
  }, [draft])

  const selectTemplate = (supportLevel: SupportLevel) => {
    setActiveLevel(supportLevel)
    const template = templates.find((item) => item.supportLevel === supportLevel)
    setDraft(template ? toDraft(template) : emptyDraft(supportLevel))
  }

  const updateDefinition = (index: number, patch: Partial<DefinitionDraft>) => {
    setDraft((current) => ({
      ...current,
      definitions: current.definitions.map((definition, i) =>
        i === index ? { ...definition, ...patch } : definition,
      ),
    }))
  }

  const addDefinition = () => {
    setDraft((current) => ({
      ...current,
      definitions: [...current.definitions, { ...DEFAULT_RULE }],
    }))
  }

  const removeDefinition = (index: number) => {
    setDraft((current) => ({
      ...current,
      definitions: current.definitions.filter((_, i) => i !== index),
    }))
  }

  const resetDraft = () => {
    if (activeTemplate) setDraft(toDraft(activeTemplate))
  }

  const saveTemplate = async () => {
    if (draftInvalid) {
      const message = t("invalidDraft")
      setError(message)
      toast.error(message)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/entitlement-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("saveFailed"))
      setTemplates((json.templates ?? []) as EntitlementTemplate[])
      const saved = (json.template ?? null) as EntitlementTemplate | null
      if (saved) {
        setActiveLevel(saved.supportLevel)
        setDraft(toDraft(saved))
      }
      toast.success(t("savedToast"))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("saveFailed")
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Settings2 className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button className="gap-2" onClick={saveTemplate} disabled={saving || loading || draftInvalid}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("save")}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("levels")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">{tc("loading")}</p>
            ) : (
              SUPPORT_LEVELS.map((level) => {
                const template = templates.find((item) => item.supportLevel === level)
                const selected = level === activeLevel
                return (
                  <button
                    key={level}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      selected ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"
                    }`}
                    onClick={() => selectTemplate(level)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{te(`supportLevels.${level}`)}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {template?.definitions.length ?? 0}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {template?.isActive ? t("active") : t("inactive")}
                    </p>
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("editorTitle", { level: te(`supportLevels.${activeLevel}`) })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border"
                />
                {t("templateActive")}
              </label>
            </div>

            <div className="space-y-2">
              <Label>{t("description")}</Label>
              <Textarea
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder={t("descriptionPlaceholder")}
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{t("rules")}</h2>
                  <p className="text-xs text-muted-foreground">{t("rulesHint")}</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addDefinition}>
                  <Plus className="h-4 w-4" />
                  {t("addRule")}
                </Button>
              </div>

              <div className="space-y-3">
                {draft.definitions.map((definition, index) => (
                  <div key={index} className="rounded-lg border bg-background p-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_minmax(150px,0.8fr)_110px_120px_auto]">
                      <div className="space-y-1">
                        <Label>{t("ruleName")}</Label>
                        <Input
                          value={definition.name}
                          onChange={(event) => updateDefinition(index, { name: event.target.value })}
                        />
                      </div>
                      <Select
                        label={t("milestoneType")}
                        value={definition.type}
                        onChange={(event) => updateDefinition(index, { type: asMilestoneType(event.target.value) })}
                      >
                        {MILESTONE_TYPES.map((type) => (
                          <option key={type} value={type}>{te(`milestoneTypes.${type}`)}</option>
                        ))}
                      </Select>
                      <Select
                        label={t("severity")}
                        value={definition.severityTier}
                        onChange={(event) => updateDefinition(index, { severityTier: asSeverityScope(event.target.value) })}
                      >
                        {MILESTONE_SEVERITY_SCOPES.map((severity) => (
                          <option key={severity} value={severity}>{te(`severityScopes.${severity}`)}</option>
                        ))}
                      </Select>
                      <div className="space-y-1">
                        <Label>{t("dueValue")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={definition.dueValue}
                          onChange={(event) => updateDefinition(index, { dueValue: Number(event.target.value) })}
                        />
                      </div>
                      <Select
                        label={t("dueUnit")}
                        value={definition.dueUnit}
                        onChange={(event) => updateDefinition(index, { dueUnit: asDueUnit(event.target.value) })}
                      >
                        <option value="minutes">{te("dueUnits.minutes")}</option>
                        <option value="hours">{te("dueUnits.hours")}</option>
                        <option value="days">{te("dueUnits.days")}</option>
                      </Select>
                      <div className="flex items-end justify-end gap-2">
                        <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={definition.isRequired}
                            onChange={(event) => updateDefinition(index, { isRequired: event.target.checked })}
                            className="h-4 w-4 rounded border"
                          />
                          {t("required")}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDefinition(index)}
                          title={t("deleteRule")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {draft.definitions.length === 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    {t("emptyRules")}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" className="gap-2" onClick={resetDraft} disabled={!activeTemplate || saving}>
                <Copy className="h-4 w-4" />
                {t("reset")}
              </Button>
              <Button type="button" className="gap-2" onClick={saveTemplate} disabled={saving || loading || draftInvalid}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
