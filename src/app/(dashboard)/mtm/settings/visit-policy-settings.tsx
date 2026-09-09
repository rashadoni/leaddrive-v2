"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Eye, EyeOff, LockKeyhole, Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const ACTION_KEYS = ["PHOTO", "PRESENTATION", "STOCK_CHECK", "VISIT_NOTE", "CHECKLIST", "FEEDBACK", "NEXT_ACTION"] as const
const MODES = ["REQUIRED", "OPTIONAL", "HIDDEN"] as const
const CATEGORIES = ["A", "B", "C", "D"] as const
const OBJECT_TYPES = ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"] as const

type ActionKey = typeof ACTION_KEYS[number]
type Mode = typeof MODES[number]

interface PolicyAction {
  actionKey: ActionKey
  mode: Mode
  minCount: number
  conditions: { customerCategories?: string[]; objectTypes?: string[] } | null
  allowWaiver: boolean
}

interface Policy {
  id?: string
  name: string
  teamId: string | null
  visitType: string
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  actions: PolicyAction[]
  team?: { id: string; name: string } | null
}

interface NamedEntity { id: string; name: string }

function dateInput(value: string | Date | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

function emptyPolicy(): Policy {
  return {
    name: "",
    teamId: null,
    visitType: "DEFAULT",
    priority: 100,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
    isActive: true,
    actions: ACTION_KEYS.map((actionKey) => ({
      actionKey,
      mode: "OPTIONAL",
      minCount: 1,
      conditions: null,
      allowWaiver: false,
    })),
  }
}

function normalizePolicy(policy: Policy): Policy {
  const configured = new Map(policy.actions.map((action) => [action.actionKey, action]))
  return {
    ...policy,
    effectiveFrom: dateInput(policy.effectiveFrom),
    effectiveTo: dateInput(policy.effectiveTo) || null,
    actions: ACTION_KEYS.map((actionKey) => configured.get(actionKey) ?? {
      actionKey,
      mode: "OPTIONAL",
      minCount: 1,
      conditions: null,
      allowWaiver: false,
    }),
  }
}

const fieldClass = "h-9 rounded-md border border-zinc-200 bg-background px-2.5 text-sm dark:border-zinc-700"

function modeCardClass(mode: Mode) {
  if (mode === "REQUIRED") return "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100"
  if (mode === "HIDDEN") return "border-zinc-300 bg-zinc-100/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
  return "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100"
}

function modeButtonClass(active: boolean, mode: Mode) {
  if (!active) return "border-zinc-200 bg-background text-muted-foreground hover:border-zinc-300 hover:bg-muted dark:border-zinc-800 dark:hover:border-zinc-700"
  if (mode === "REQUIRED") return "border-rose-600 bg-rose-600 text-white shadow-sm"
  if (mode === "HIDDEN") return "border-zinc-700 bg-zinc-800 text-white shadow-sm dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-950"
  return "border-sky-700 bg-sky-700 text-white shadow-sm"
}

function modeIcon(mode: Mode) {
  if (mode === "REQUIRED") return LockKeyhole
  if (mode === "HIDDEN") return EyeOff
  return Eye
}

export function VisitPolicySettings() {
  const t = useTranslations("mtmVisitPolicies")
  const [policies, setPolicies] = useState<Policy[]>([])
  const [teams, setTeams] = useState<NamedEntity[]>([])
  const [agents, setAgents] = useState<NamedEntity[]>([])
  const [customers, setCustomers] = useState<NamedEntity[]>([])
  const [selectedId, setSelectedId] = useState<string>("new")
  const [draft, setDraft] = useState<Policy>(emptyPolicy)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewAgentId, setPreviewAgentId] = useState("")
  const [previewCustomerId, setPreviewCustomerId] = useState("")
  const [preview, setPreview] = useState<{ sourcePolicyName: string | null; requirements: PolicyAction[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [policyRes, teamRes, agentRes, customerRes] = await Promise.all([
        fetch("/api/v1/mtm/visit-policies"),
        fetch("/api/v1/mtm/teams"),
        fetch("/api/v1/mtm/agents?status=ACTIVE&limit=200"),
        fetch("/api/v1/mtm/customers?status=ACTIVE&limit=200"),
      ])
      const [policyBody, teamBody, agentBody, customerBody] = await Promise.all([
        policyRes.json(), teamRes.json(), agentRes.json(), customerRes.json(),
      ])
      if (!policyRes.ok) throw new Error(policyBody?.error || t("loadFailed"))
      const nextPolicies = (policyBody.data?.policies ?? []).map(normalizePolicy)
      setPolicies(nextPolicies)
      setTeams(teamBody.data?.teams ?? [])
      setAgents(agentBody.data?.agents ?? [])
      setCustomers(customerBody.data?.customers ?? [])
      if (nextPolicies.length && selectedId === "new") {
        setSelectedId(nextPolicies[0].id as string)
        setDraft(nextPolicies[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [selectedId, t])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectPolicy = (id: string) => {
    setSelectedId(id)
    setPreview(null)
    setDraft(id === "new" ? emptyPolicy() : normalizePolicy(policies.find((policy) => policy.id === id) ?? emptyPolicy()))
  }

  const updateAction = (actionKey: ActionKey, patch: Partial<PolicyAction>) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => action.actionKey === actionKey ? { ...action, ...patch } : action),
    }))
  }

  const updateCondition = (action: PolicyAction, field: "customerCategories" | "objectTypes", value: string) => {
    const next = { ...(action.conditions ?? {}) }
    if (value) next[field] = [value]
    else delete next[field]
    updateAction(action.actionKey, { conditions: Object.keys(next).length ? next : null })
  }

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error(t("nameRequired"))
      return
    }
    setSaving(true)
    try {
      const url = draft.id ? `/api/v1/mtm/visit-policies/${draft.id}` : "/api/v1/mtm/visit-policies"
      const response = await fetch(url, {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          name: draft.name.trim(),
          visitType: draft.visitType.trim().toUpperCase() || "DEFAULT",
          effectiveFrom: new Date(`${draft.effectiveFrom}T00:00:00.000Z`).toISOString(),
          effectiveTo: draft.effectiveTo ? new Date(`${draft.effectiveTo}T23:59:59.999Z`).toISOString() : null,
          id: undefined,
          team: undefined,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("saveFailed"))
      const saved = normalizePolicy(body.data)
      setPolicies((current) => {
        const exists = current.some((policy) => policy.id === saved.id)
        return exists ? current.map((policy) => policy.id === saved.id ? saved : policy) : [saved, ...current]
      })
      setSelectedId(saved.id as string)
      setDraft(saved)
      toast.success(t("saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async () => {
    if (!draft.id) return
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/mtm/visit-policies/${draft.id}`, { method: "DELETE" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("deactivateFailed"))
      const saved = normalizePolicy(body.data)
      setPolicies((current) => current.map((policy) => policy.id === saved.id ? saved : policy))
      setDraft(saved)
      toast.success(t("deactivated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deactivateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const runPreview = async () => {
    if (!previewAgentId || !previewCustomerId) return
    setPreviewing(true)
    try {
      const response = await fetch("/api/v1/mtm/visit-policies/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: previewAgentId, customerId: previewCustomerId, visitType: draft.visitType || "DEFAULT" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("previewFailed"))
      setPreview(body.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("previewFailed"))
    } finally {
      setPreviewing(false)
    }
  }

  const activeCount = useMemo(() => policies.filter((policy) => policy.isActive).length, [policies])
  const selectedTeamName = useMemo(() => {
    if (!draft.teamId) return t("allTeams")
    return teams.find((team) => team.id === draft.teamId)?.name ?? t("teamUnknown")
  }, [draft.teamId, teams, t])
  const actionSummary = useMemo(() => ({
    required: draft.actions.filter((action) => action.mode === "REQUIRED").length,
    optional: draft.actions.filter((action) => action.mode === "OPTIONAL").length,
    hidden: draft.actions.filter((action) => action.mode === "HIDDEN").length,
  }), [draft.actions])
  const describeActionScope = (action: PolicyAction) => {
    const parts = []
    const category = action.conditions?.customerCategories?.[0]
    const objectType = action.conditions?.objectTypes?.[0]
    if (category) parts.push(t("appliesCategory", { category }))
    if (objectType) parts.push(t("appliesObject", { object: t(`objectTypes.${objectType}`) }))
    return parts.length ? parts.join(" · ") : t("appliesAll")
  }
  const describeAgentEffect = (action: PolicyAction) => {
    if (action.mode === "HIDDEN") return t("agentHidden")
    if (action.mode === "REQUIRED") {
      return action.allowWaiver
        ? t("agentRequiredWithReason", { count: action.minCount })
        : t("agentRequired", { count: action.minCount })
    }
    return t("agentOptional")
  }

  return (
    <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Settings2 className="h-4 w-4 text-muted-foreground" /> {t("title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{t("activeCount", { count: activeCount })}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => selectPolicy("new")}>
            <Plus className="mr-1 h-4 w-4" /> {t("newPolicy")}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label={t("policyList")} className="space-y-1">
          {loading ? <div className="h-32 animate-pulse rounded-md bg-muted" /> : policies.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">{t("empty")}</p>
          ) : policies.map((policy) => (
            <button
              key={policy.id}
              type="button"
              onClick={() => selectPolicy(policy.id as string)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedId === policy.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950" : "hover:bg-muted"}`}
            >
              <span className="min-w-0 truncate">{policy.name}</span>
              {!policy.isActive && <span className="text-[11px] opacity-60">{t("inactive")}</span>}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-background p-4 dark:border-zinc-800">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">{t("name")}</span>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t("team")}</span>
                <select value={draft.teamId ?? ""} onChange={(event) => setDraft({ ...draft, teamId: event.target.value || null })} className={`${fieldClass} w-full`}>
                  <option value="">{t("allTeams")}</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t("visitType")}</span>
                <Input value={draft.visitType} onChange={(event) => setDraft({ ...draft, visitType: event.target.value.toUpperCase() })} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t("effectiveFrom")}</span>
                <Input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t("effectiveTo")}</span>
                <Input type="date" value={draft.effectiveTo ?? ""} onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value || null })} className="h-9" />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-md border border-zinc-200 bg-muted/30 p-3 dark:border-zinc-800">
                <p className="text-xs font-medium text-muted-foreground">{t("policyAppliesTo")}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md border border-zinc-200 bg-background px-2 py-1 dark:border-zinc-800">{t("team")}: <strong>{selectedTeamName}</strong></span>
                  <span className="rounded-md border border-zinc-200 bg-background px-2 py-1 dark:border-zinc-800">{t("visitType")}: <strong>{draft.visitType || "DEFAULT"}</strong></span>
                  <span className="rounded-md border border-zinc-200 bg-background px-2 py-1 dark:border-zinc-800">{t("dates")}: <strong>{draft.effectiveFrom} - {draft.effectiveTo || t("noEndDate")}</strong></span>
                  <span className="rounded-md border border-zinc-200 bg-background px-2 py-1 dark:border-zinc-800">{t("priority")}: <strong>{draft.priority}</strong></span>
                </div>
              </div>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-200 text-center text-xs dark:border-zinc-800">
                <div className="bg-rose-50 px-2 py-3 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                  <div className="text-lg font-semibold tabular-nums">{actionSummary.required}</div>
                  <div>{t("summaryRequired")}</div>
                </div>
                <div className="border-x border-zinc-200 bg-sky-50 px-2 py-3 text-sky-800 dark:border-zinc-800 dark:bg-sky-950/30 dark:text-sky-200">
                  <div className="text-lg font-semibold tabular-nums">{actionSummary.optional}</div>
                  <div>{t("summaryOptional")}</div>
                </div>
                <div className="bg-zinc-100 px-2 py-3 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <div className="text-lg font-semibold tabular-nums">{actionSummary.hidden}</div>
                  <div>{t("summaryHidden")}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{t("agentRulesTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("agentRulesHint")}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {MODES.map((mode) => {
                  const Icon = modeIcon(mode)
                  return (
                    <span key={mode} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${modeCardClass(mode)}`}>
                      <Icon className="h-3.5 w-3.5" /> {t(`modeHelp.${mode}`)}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-3">
              {draft.actions.map((action) => {
                const ActiveIcon = modeIcon(action.mode)
                return (
                  <div key={action.actionKey} className={`rounded-lg border p-4 ${modeCardClass(action.mode)}`}>
                    <div className="grid gap-4 xl:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.7fr)]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ActiveIcon className="h-4 w-4 shrink-0" />
                          <h4 className="truncate text-sm font-semibold">{t(`actions.${action.actionKey}`)}</h4>
                        </div>
                        <p className="mt-2 text-xs leading-5 opacity-85">{describeAgentEffect(action)}</p>
                        <p className="mt-2 text-xs font-medium opacity-90">{describeActionScope(action)}</p>
                      </div>

                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          {MODES.map((mode) => {
                            const Icon = modeIcon(mode)
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => updateAction(action.actionKey, { mode })}
                                className={`rounded-md border px-3 py-2 text-left transition-colors ${modeButtonClass(action.mode === mode, mode)}`}
                              >
                                <span className="flex items-center gap-1.5 text-xs font-semibold">
                                  <Icon className="h-3.5 w-3.5" /> {t(`modes.${mode}`)}
                                </span>
                                <span className="mt-1 block text-[11px] leading-4 opacity-85">{t(`modeDescriptions.${mode}`)}</span>
                              </button>
                            )
                          })}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[110px_1fr_1fr_170px]">
                          <label className="space-y-1">
                            <span className="text-[11px] font-medium opacity-80">{t("minimum")}</span>
                            <Input type="number" min={1} max={100} value={action.minCount} onChange={(event) => updateAction(action.actionKey, { minCount: Math.max(1, Number(event.target.value) || 1) })} disabled={action.mode === "HIDDEN"} className="h-9 bg-background" />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] font-medium opacity-80">{t("category")}</span>
                            <select value={action.conditions?.customerCategories?.[0] ?? ""} onChange={(event) => updateCondition(action, "customerCategories", event.target.value)} className={`${fieldClass} w-full bg-background`}>
                              <option value="">{t("any")}</option>
                              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] font-medium opacity-80">{t("objectType")}</span>
                            <select value={action.conditions?.objectTypes?.[0] ?? ""} onChange={(event) => updateCondition(action, "objectTypes", event.target.value)} className={`${fieldClass} w-full bg-background`}>
                              <option value="">{t("any")}</option>
                              {OBJECT_TYPES.map((objectType) => <option key={objectType} value={objectType}>{t(`objectTypes.${objectType}`)}</option>)}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] font-medium opacity-80">{t("waiver")}</span>
                            <button
                              type="button"
                              onClick={() => updateAction(action.actionKey, { allowWaiver: !action.allowWaiver })}
                              disabled={action.mode === "HIDDEN"}
                              className={`flex h-9 w-full items-center justify-between rounded-md border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${action.allowWaiver ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-zinc-200 bg-background text-muted-foreground dark:border-zinc-800"}`}
                            >
                              <span>{action.allowWaiver ? t("waiverOn") : t("waiverOff")}</span>
                              <span className={`h-4 w-7 rounded-full p-0.5 transition-colors ${action.allowWaiver ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                                <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${action.allowWaiver ? "translate-x-3" : ""}`} />
                              </span>
                            </button>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("priority")}</span>
              <Input type="number" min={0} max={10000} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) || 0 })} className="h-9 w-28" />
            </label>
            <div className="flex gap-2">
              {draft.id && draft.isActive && (
                <Button type="button" variant="outline" size="sm" onClick={deactivate} disabled={saving}>
                  <Trash2 className="mr-1 h-4 w-4" /> {t("deactivate")}
                </Button>
              )}
              <Button type="button" size="sm" onClick={save} disabled={saving || !draft.isActive}>
                <Save className="mr-1 h-4 w-4" /> {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("previewTitle")}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("previewHint")}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <select value={previewAgentId} onChange={(event) => setPreviewAgentId(event.target.value)} className={`${fieldClass} w-full`} aria-label={t("previewAgent")}>
                <option value="">{t("previewAgent")}</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <select value={previewCustomerId} onChange={(event) => setPreviewCustomerId(event.target.value)} className={`${fieldClass} w-full`} aria-label={t("previewCustomer")}>
                <option value="">{t("previewCustomer")}</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={runPreview} disabled={previewing || !previewAgentId || !previewCustomerId}>
                {previewing ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
                {t("preview")}
              </Button>
            </div>
            {preview && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">{preview.sourcePolicyName ? t("previewSource", { name: preview.sourcePolicyName }) : t("previewDefault")}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {preview.requirements.map((item) => {
                    const Icon = item.mode === "REQUIRED" ? Check : modeIcon(item.mode)
                    return (
                      <span key={item.actionKey} className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${modeCardClass(item.mode)}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{t(`actions.${item.actionKey}`)}{item.mode !== "HIDDEN" && item.minCount > 1 ? ` ×${item.minCount}` : ""}</span>
                          <span className="block opacity-80">{t(`modes.${item.mode}`)}</span>
                        </span>
                    </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
