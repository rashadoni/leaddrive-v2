"use client"

/**
 * Customer support terms.
 *
 * A support term binds one company to an SLA policy, support level, validity
 * window, milestone definitions, and milestone health. Draft/suspended terms
 * can be configured here before activation.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { formatDate as formatDateLocale } from "@/lib/format-date"
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
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Filter,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  Trash2,
  X,
  XCircle,
} from "lucide-react"

interface Milestones {
  overdue: number
  atRisk: number
  missed30d: number
  met7d: number
}

interface Entitlement {
  id: string
  companyId: string
  companyName: string
  slaPolicyId: string
  slaPolicyName: string
  supportLevel: string
  validFrom: string
  validTo: string | null
  status: string
  expiredAt: string | null
  cancelledAt: string | null
  notes: string | null
  definitionCount: number
  definitions: MilestoneDefinition[]
  daysUntilExpiry: number | null
  isExpiringSoon: boolean
  milestones: Milestones
}

interface MilestoneDefinition {
  id: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  createdAt: string
  updatedAt: string
}

interface CompanyOption {
  id: string
  name: string
  status: string
  category: string
  hasActiveEntitlement: boolean
}

interface SlaPolicyOption {
  id: string
  name: string
  priority: string
  firstResponseHours: number
  resolutionHours: number
  isDefault: boolean
}

interface EntitlementTemplateDefinition {
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
  definitions: EntitlementTemplateDefinition[]
}

interface EntitlementsResponse {
  createdEntitlementId?: string
  entitlements: Entitlement[]
  totalEntitlements: number
  activeCount: number
  expiringSoonCount: number
  overdueMilestones: number
  atRiskMilestones: number
  missed30d: number
  companies: CompanyOption[]
  slaPolicies: SlaPolicyOption[]
  templates: EntitlementTemplate[]
  permissions?: EntitlementPermissions
}

interface EntitlementPermissions {
  canRead: boolean
  canWrite: boolean
  canActivate: boolean
  canCancel: boolean
  canWaiveMilestone: boolean
}

interface FormState {
  companyId: string
  slaPolicyId: string
  supportLevel: "basic" | "standard" | "premium" | "enterprise"
  validFrom: string
  validTo: string
  notes: string
}

interface FiltersState {
  companyId: string
  status: string
  supportLevel: string
  slaPolicyId: string
  risk: string
}

interface MilestoneFormState {
  editingDefinitionId: string | null
  type: MilestoneType
  name: string
  severityTier: MilestoneSeverityScope
  dueValue: string
  dueUnit: DueWindowUnit
  isRequired: boolean
  template: SupportLevel
}

const SUPPORT_LEVEL_COLORS: Record<string, string> = {
  enterprise: "bg-purple-600 text-white",
  premium: "bg-blue-600 text-white",
  standard: "bg-slate-600 text-white",
  basic: "bg-slate-500 text-white",
}

const STATUS_BADGES: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  suspended: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  expired: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
}

const DEFAULT_ENTITLEMENT_PERMISSIONS: EntitlementPermissions = {
  canRead: false,
  canWrite: false,
  canActivate: false,
  canCancel: false,
  canWaiveMilestone: false,
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function dateInputValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : ""
}

function emptyForm(defaultSlaPolicyId = ""): FormState {
  return {
    companyId: "",
    slaPolicyId: defaultSlaPolicyId,
    supportLevel: "standard",
    validFrom: todayInputValue(),
    validTo: "",
    notes: "",
  }
}

function emptyFilters(): FiltersState {
  return {
    companyId: "",
    status: "",
    supportLevel: "",
    slaPolicyId: "",
    risk: "",
  }
}

function asSupportLevel(value: string): SupportLevel {
  return SUPPORT_LEVELS.includes(value as SupportLevel) ? value as SupportLevel : "standard"
}

function emptyMilestoneForm(supportLevel: string): MilestoneFormState {
  const level = asSupportLevel(supportLevel)
  return {
    editingDefinitionId: null,
    type: "first_response",
    name: "",
    severityTier: "all",
    dueValue: "4",
    dueUnit: "hours",
    isRequired: true,
    template: level,
  }
}

export default function EntitlementsPage() {
  const t = useTranslations("slice2.entitlements")
  const tc = useTranslations("slice2.common")
  const locale = useLocale()
  const formatDate = (iso: string | null): string =>
    iso ? formatDateLocale(iso, locale) : "—"
  const [data, setData] = useState<EntitlementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [milestoneLoadingKey, setMilestoneLoadingKey] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm())
  const [filters, setFilters] = useState<FiltersState>(() => emptyFilters())
  const [milestoneForms, setMilestoneForms] = useState<Record<string, MilestoneFormState>>({})
  const [highlightedEntitlementId, setHighlightedEntitlementId] = useState<string | null>(null)

  const fetchEntitlements = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/entitlements")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorFetchFailed"))
      setData(json)
      setError(null)
      const defaultPolicy = json.slaPolicies?.find((policy: SlaPolicyOption) => policy.isDefault)
        || json.slaPolicies?.[0]
      if (defaultPolicy) {
        setForm((current) => current.slaPolicyId ? current : emptyForm(defaultPolicy.id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [tc])

  useEffect(() => {
    fetchEntitlements()
  }, [fetchEntitlements])

  useEffect(() => {
    if (!highlightedEntitlementId) return
    const timeout = window.setTimeout(() => setHighlightedEntitlementId(null), 12_000)
    return () => window.clearTimeout(timeout)
  }, [highlightedEntitlementId])

  const selectedCompany = useMemo(
    () => data?.companies.find((company) => company.id === form.companyId) || null,
    [data?.companies, form.companyId],
  )
  const selectedSla = useMemo(
    () => data?.slaPolicies.find((policy) => policy.id === form.slaPolicyId) || null,
    [data?.slaPolicies, form.slaPolicyId],
  )
  const editingEntitlement = useMemo(
    () => data?.entitlements.find((entitlement) => entitlement.id === editingId) || null,
    [data?.entitlements, editingId],
  )
  const filteredEntitlements = useMemo(() => {
    const entitlements = data?.entitlements ?? []
    return entitlements.filter((entitlement) => {
      if (filters.companyId && entitlement.companyId !== filters.companyId) return false
      if (filters.status && entitlement.status !== filters.status) return false
      if (filters.supportLevel && entitlement.supportLevel !== filters.supportLevel) return false
      if (filters.slaPolicyId && entitlement.slaPolicyId !== filters.slaPolicyId) return false
      if (filters.risk === "expiring" && !entitlement.isExpiringSoon) return false
      if (filters.risk === "overdue" && entitlement.milestones.overdue === 0) return false
      if (filters.risk === "atRisk" && entitlement.milestones.atRisk === 0) return false
      return true
    })
  }, [data?.entitlements, filters])
  const permissions = data?.permissions ?? DEFAULT_ENTITLEMENT_PERMISSIONS
  const canSubmit = Boolean(
    permissions.canWrite && form.companyId && form.slaPolicyId && form.validFrom && !saving,
  )
  const hasNoSetupOptions =
    !loading && data !== null && (data.companies.length === 0 || data.slaPolicies.length === 0)
  const selectedSupportLevelName = t(`supportLevels.${form.supportLevel}`)
  const selectedSupportTemplate = data?.templates.find(
    (template) => template.supportLevel === form.supportLevel,
  ) ?? null
  const selectedSupportDefinitions = selectedSupportTemplate?.definitions ?? []
  const selectedSupportPreview = selectedSupportDefinitions.slice(0, 3)
  const selectedSupportHiddenRules =
    selectedSupportDefinitions.length - selectedSupportPreview.length

  const resetForm = useCallback((nextData = data) => {
    const defaultPolicy = nextData?.slaPolicies.find((policy) => policy.isDefault)
      || nextData?.slaPolicies[0]
    setEditingId(null)
    setForm(emptyForm(defaultPolicy?.id || ""))
  }, [data])

  const startCreate = useCallback(() => {
    if (!permissions.canWrite) {
      setError(t("permissionReadOnlyDesc"))
      return
    }
    resetForm()
    document.getElementById("support-term-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [permissions.canWrite, resetForm, t])

  const startEdit = useCallback((entitlement: Entitlement) => {
    if (!permissions.canWrite) {
      setError(t("permissionReadOnlyDesc"))
      return
    }
    setEditingId(entitlement.id)
    setError(null)
    setNotice(null)
    setForm({
      companyId: entitlement.companyId,
      slaPolicyId: entitlement.slaPolicyId,
      supportLevel: entitlement.supportLevel as FormState["supportLevel"],
      validFrom: dateInputValue(entitlement.validFrom),
      validTo: dateInputValue(entitlement.validTo),
      notes: entitlement.notes || "",
    })
    document.getElementById("support-term-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [permissions.canWrite, t])

  const getMilestoneForm = useCallback((entitlement: Entitlement) => (
    milestoneForms[entitlement.id] ?? emptyMilestoneForm(entitlement.supportLevel)
  ), [milestoneForms])

  const updateMilestoneForm = useCallback((
    entitlement: Entitlement,
    patch: Partial<MilestoneFormState>,
  ) => {
    setMilestoneForms((current) => ({
      ...current,
      [entitlement.id]: {
        ...(current[entitlement.id] ?? emptyMilestoneForm(entitlement.supportLevel)),
        ...patch,
      },
    }))
  }, [])

  const resetMilestoneForm = useCallback((entitlement: Entitlement) => {
    setMilestoneForms((current) => ({
      ...current,
      [entitlement.id]: emptyMilestoneForm(entitlement.supportLevel),
    }))
  }, [])

  const submitMilestoneDefinition = async (entitlement: Entitlement) => {
    if (!permissions.canWrite) {
      setError(t("permissionReadOnlyDesc"))
      return
    }
    const current = getMilestoneForm(entitlement)
    const dueValue = Number(current.dueValue)
    if (!Number.isFinite(dueValue) || dueValue <= 0) {
      setError(t("milestoneDueInvalid"))
      return
    }

    const loadingKey = `${entitlement.id}:definition`
    setMilestoneLoadingKey(loadingKey)
    setError(null)
    setNotice(null)
    try {
      const editingDefinitionId = current.editingDefinitionId
      const res = await fetch(
        editingDefinitionId
          ? `/api/v1/entitlements/${entitlement.id}/milestones/${editingDefinitionId}`
          : `/api/v1/entitlements/${entitlement.id}/milestones`,
        {
          method: editingDefinitionId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingDefinitionId
              ? {
                  name: current.name.trim() || t(`milestoneTypes.${current.type}`),
                  dueValue,
                  dueUnit: current.dueUnit,
                  isRequired: current.isRequired,
                }
              : {
                  mode: "definition",
                  type: current.type,
                  name: current.name.trim() || t(`milestoneTypes.${current.type}`),
                  severityTier: current.severityTier,
                  dueValue,
                  dueUnit: current.dueUnit,
                  isRequired: current.isRequired,
                },
          ),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("milestoneSaveFailed"))
      await fetchEntitlements()
      setNotice(editingDefinitionId ? t("milestoneUpdatedNotice") : t("milestoneCreatedNotice"))
      resetMilestoneForm(entitlement)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("milestoneSaveFailed"))
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  const applyMilestoneTemplate = async (entitlement: Entitlement) => {
    if (!permissions.canWrite) {
      setError(t("permissionReadOnlyDesc"))
      return
    }
    const current = getMilestoneForm(entitlement)
    const loadingKey = `${entitlement.id}:template`
    setMilestoneLoadingKey(loadingKey)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/entitlements/${entitlement.id}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "template", template: current.template }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("templateApplyFailed"))
      await fetchEntitlements()
      setNotice(t("templateAppliedNotice"))
      resetMilestoneForm(entitlement)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("templateApplyFailed"))
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  const editMilestoneDefinition = (entitlement: Entitlement, definition: MilestoneDefinition) => {
    const due = secondsToDueWindow(definition.dueWithinSeconds)
    updateMilestoneForm(entitlement, {
      editingDefinitionId: definition.id,
      type: definition.type as MilestoneType,
      name: definition.name,
      severityTier: (definition.severityTier ?? "all") as MilestoneSeverityScope,
      dueValue: String(due.value),
      dueUnit: due.unit,
      isRequired: definition.isRequired,
    })
  }

  const deleteMilestoneDefinition = async (entitlement: Entitlement, definition: MilestoneDefinition) => {
    if (!permissions.canWrite) {
      setError(t("permissionReadOnlyDesc"))
      return
    }
    if (!window.confirm(t("confirmDeleteMilestone"))) return
    const loadingKey = `${entitlement.id}:delete:${definition.id}`
    setMilestoneLoadingKey(loadingKey)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/entitlements/${entitlement.id}/milestones/${definition.id}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("milestoneDeleteFailed"))
      await fetchEntitlements()
      setNotice(t("milestoneDeletedNotice"))
      if (getMilestoneForm(entitlement).editingDefinitionId === definition.id) {
        resetMilestoneForm(entitlement)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("milestoneDeleteFailed"))
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  const submitEntitlement = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(
        editingId ? `/api/v1/entitlements/${editingId}` : "/api/v1/entitlements",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(editingId
              ? {}
              : {
                  companyId: form.companyId,
                  slaPolicyId: form.slaPolicyId,
                }),
            supportLevel: form.supportLevel,
            validFrom: form.validFrom,
            validTo: form.validTo || null,
            notes: form.notes.trim() || null,
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || (editingId ? t("updateFailed") : t("createFailed")))
      }
      if (editingId) {
        await fetchEntitlements()
        setNotice(t("updatedNotice"))
        resetForm()
      } else {
        const createdEntitlementId =
          typeof json.createdEntitlementId === "string" ? json.createdEntitlementId : null
        setData(json)
        setFilters(emptyFilters())
        setNotice(t("createdNotice"))
        resetForm(json)
        if (createdEntitlementId) {
          setHighlightedEntitlementId(createdEntitlementId)
          window.setTimeout(() => {
            document
              .getElementById(`support-term-${createdEntitlementId}`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" })
          }, 80)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId ? t("updateFailed") : t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  const runLifecycleAction = async (
    entitlement: Entitlement,
    action: "activate" | "suspend" | "resume" | "expire" | "cancel",
  ) => {
    const allowed = action === "cancel" ? permissions.canCancel : permissions.canActivate
    if (!allowed) {
      setError(t("permissionLifecycleDesc"))
      return
    }

    let cancellationReason: string | null = null
    if (action === "cancel") {
      cancellationReason = window.prompt(t("cancelReasonPrompt"), "")
      if (cancellationReason === null) return
      if (!cancellationReason.trim()) {
        setError(t("cancelReasonRequired"))
        return
      }
    }
    if (action === "expire" && !window.confirm(t("confirmExpire"))) return

    setActionLoadingId(entitlement.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/entitlements/${entitlement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(cancellationReason ? { cancellationReason: cancellationReason.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("lifecycleFailed"))
      await fetchEntitlements()
      setNotice(t(`actionNotices.${action}`))
      if (editingId === entitlement.id) resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("lifecycleFailed"))
    } finally {
      setActionLoadingId(null)
    }
  }

  return (
    <MotionPage className="p-6">
      <div className="mx-auto max-w-[96rem] space-y-6">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Shield className="h-7 w-7 text-primary" />
              {t("title")}
              <HelpButton slug="entitlements" variant="label" />
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          {permissions.canWrite && (
            <Button
              className="w-full gap-2 sm:w-auto"
              onClick={startCreate}
            >
              <Plus className="h-4 w-4" />
              {t("createButton")}
            </Button>
          )}
        </header>

        {error && (
          <MotionCard className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}
        {notice && (
          <MotionCard className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{notice}</p>
          </MotionCard>
        )}

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4">
            <MotionCard className="rounded-lg border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <MetricTile label={t("kpiActive")} value={data?.activeCount ?? 0} loading={loading} />
                <MetricTile
                  label={t("kpiExpiring30d")}
                  value={data?.expiringSoonCount ?? 0}
                  loading={loading}
                  icon={<Clock className="h-3.5 w-3.5" />}
                  hot={(data?.expiringSoonCount ?? 0) > 0}
                />
                <MetricTile
                  label={t("kpiOverdue")}
                  value={data?.overdueMilestones ?? 0}
                  loading={loading}
                  icon={<TimerOff className="h-3.5 w-3.5" />}
                  danger={(data?.overdueMilestones ?? 0) > 0}
                />
                <MetricTile
                  label={t("kpiAtRisk24h")}
                  value={data?.atRiskMilestones ?? 0}
                  loading={loading}
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  hot={(data?.atRiskMilestones ?? 0) > 0}
                />
                <MetricTile
                  label={t("kpiMissed30d")}
                  value={data?.missed30d ?? 0}
                  loading={loading}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  danger={(data?.missed30d ?? 0) > 0}
                />
              </div>
            </MotionCard>

            <MotionCard className="rounded-lg border bg-card p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t("howItWorksTitle")}</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {t("howItWorksDesc")}
                  </p>
                </div>
                <div className="shrink-0 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {t("draftFirstHint")}
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  t("stepCompany"),
                  t("stepSla"),
                  t("stepLevel"),
                  t("stepValidity"),
                  t("stepMilestones"),
                  t("stepActivate"),
                ].map((step, index) => (
                  <div key={step} className="flex min-h-12 items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </MotionCard>

            {data && data.entitlements.length > 0 && (
              <MotionCard className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{t("filtersTitle")}</h2>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters())}>
                    <RotateCcw className="h-4 w-4" />
                    {t("resetFilters")}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Select
                    label={t("company")}
                    value={filters.companyId}
                    onChange={(e) => setFilters((current) => ({ ...current, companyId: e.target.value }))}
                  >
                    <option value="">{t("allCompanies")}</option>
                    {data.companies.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </Select>
                  <Select
                    label={t("status")}
                    value={filters.status}
                    onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}
                  >
                    <option value="">{t("allStatuses")}</option>
                    {["draft", "active", "suspended", "expired", "cancelled"].map((status) => (
                      <option key={status} value={status}>{t(`statuses.${status}`)}</option>
                    ))}
                  </Select>
                  <Select
                    label={t("supportLevel")}
                    value={filters.supportLevel}
                    onChange={(e) => setFilters((current) => ({ ...current, supportLevel: e.target.value }))}
                  >
                    <option value="">{t("allSupportLevels")}</option>
                    {["basic", "standard", "premium", "enterprise"].map((level) => (
                      <option key={level} value={level}>{t(`supportLevels.${level}`)}</option>
                    ))}
                  </Select>
                  <Select
                    label={t("slaPolicy")}
                    value={filters.slaPolicyId}
                    onChange={(e) => setFilters((current) => ({ ...current, slaPolicyId: e.target.value }))}
                  >
                    <option value="">{t("allSlaPolicies")}</option>
                    {data.slaPolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>{policy.name}</option>
                    ))}
                  </Select>
                  <Select
                    label={t("risk")}
                    value={filters.risk}
                    onChange={(e) => setFilters((current) => ({ ...current, risk: e.target.value }))}
                  >
                    <option value="">{t("allRiskStates")}</option>
                    <option value="expiring">{t("riskExpiring")}</option>
                    <option value="overdue">{t("riskOverdue")}</option>
                    <option value="atRisk">{t("riskAtRisk")}</option>
                  </Select>
                </div>
              </MotionCard>
            )}

            {loading ? (
              <MotionCard className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
                {tc("loading")}
              </MotionCard>
            ) : data && data.entitlements.length === 0 ? (
              <MotionCard className="rounded-lg border bg-card p-8">
                <div className="mx-auto max-w-xl text-center">
                  <Building2 className="mx-auto mb-3 h-12 w-12 text-muted-foreground/60" />
                  <p className="font-medium">{t("emptyTitle")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t("emptyDesc")}
                  </p>
                  {permissions.canWrite ? (
                    <Button className="mt-4 gap-2" onClick={startCreate}>
                      <Plus className="h-4 w-4" />
                      {t("createButton")}
                    </Button>
                  ) : (
                    <p className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      {t("permissionReadOnlyDesc")}
                    </p>
                  )}
                </div>
              </MotionCard>
            ) : data ? (
              filteredEntitlements.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {filteredEntitlements.map((e) => (
                    <EntitlementCard
                      key={e.id}
                      entitlement={e}
                      formatDate={formatDate}
                      t={t}
                      onEdit={startEdit}
                      onLifecycleAction={runLifecycleAction}
                      milestoneForm={getMilestoneForm(e)}
                      milestoneLoadingKey={milestoneLoadingKey}
                      onMilestoneFormChange={(patch) => updateMilestoneForm(e, patch)}
                      onMilestoneFormReset={() => resetMilestoneForm(e)}
                      onMilestoneSubmit={() => submitMilestoneDefinition(e)}
                      onMilestoneTemplateApply={() => applyMilestoneTemplate(e)}
                      onMilestoneEdit={(definition) => editMilestoneDefinition(e, definition)}
                      onMilestoneDelete={(definition) => deleteMilestoneDefinition(e, definition)}
                      actionLoading={actionLoadingId === e.id}
                      permissions={permissions}
                      highlighted={highlightedEntitlementId === e.id}
                      templates={data.templates}
                    />
                  ))}
                </div>
              ) : (
                <MotionCard className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
                  {t("noFilterResults")}
                </MotionCard>
              )
            ) : null}
          </div>

          <MotionCard id="support-term-form" className="h-fit rounded-lg border bg-card p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {permissions.canWrite
                    ? editingId ? t("editFormTitle") : t("formTitle")
                    : t("permissionReadOnlyTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {permissions.canWrite
                    ? editingId ? t("editFormDesc") : t("formDesc")
                    : t("permissionReadOnlyDesc")}
                </p>
              </div>
              {editingId && (
                <Button variant="ghost" size="icon" onClick={() => resetForm()} title={t("cancelEdit")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {hasNoSetupOptions && permissions.canWrite && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {data?.companies.length === 0 ? t("missingCompanies") : t("missingSlaPolicies")}
              </div>
            )}

            {permissions.canWrite ? (
              <div className="space-y-4">
                <div className="grid gap-1 rounded-md border bg-muted/20 p-1 text-xs sm:grid-cols-3 2xl:grid-cols-1">
                  <span className="rounded bg-background px-2 py-1.5 text-center font-medium text-foreground">
                    1. {t("workflowBase")}
                  </span>
                  <span className="px-2 py-1.5 text-center text-muted-foreground">
                    2. {t("workflowRules")}
                  </span>
                  <span className="px-2 py-1.5 text-center text-muted-foreground">
                    3. {t("workflowActivate")}
                  </span>
                </div>

                <Select
                  label={t("company")}
                  value={form.companyId}
                  onChange={(e) => setForm((current) => ({ ...current, companyId: e.target.value }))}
                  disabled={loading || !data?.companies.length || Boolean(editingId)}
                >
                  <option value="">{t("selectCompany")}</option>
                  {data?.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}{company.hasActiveEntitlement ? ` · ${t("hasActiveTerm")}` : ""}
                    </option>
                  ))}
                </Select>

                <Select
                  label={t("slaPolicy")}
                  value={form.slaPolicyId}
                  onChange={(e) => setForm((current) => ({ ...current, slaPolicyId: e.target.value }))}
                  disabled={loading || !data?.slaPolicies.length || Boolean(editingId)}
                >
                  <option value="">{t("selectSlaPolicy")}</option>
                  {data?.slaPolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.name}{policy.isDefault ? ` · ${t("defaultPolicy")}` : ""}
                    </option>
                  ))}
                </Select>

                <Select
                  label={t("supportLevel")}
                  value={form.supportLevel}
                  onChange={(e) => setForm((current) => ({ ...current, supportLevel: e.target.value as FormState["supportLevel"] }))}
                >
                  <option value="basic">{t("supportLevels.basic")}</option>
                  <option value="standard">{t("supportLevels.standard")}</option>
                  <option value="premium">{t("supportLevels.premium")}</option>
                  <option value="enterprise">{t("supportLevels.enterprise")}</option>
                </Select>

                <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{t("supportLevelGuideTitle")}</p>
                    <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">
                      {t("supportLevelTemplateBadge", {
                        count: selectedSupportDefinitions.length,
                      })}
                    </span>
                  </div>
                  <p className="mt-1">
                    {t("supportLevelGuideDesc", { level: selectedSupportLevelName })}
                  </p>
                  <div className="mt-2 space-y-1">
                    {selectedSupportPreview.map((definition) => (
                      <div
                        key={`${definition.type}:${definition.severityTier ?? "all"}`}
                        className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1"
                      >
                        <span className="truncate">
                          {t(`milestoneTypes.${definition.type}`)}
                          {definition.severityTier
                            ? ` · ${t(`severityScopes.${definition.severityTier}`)}`
                            : ""}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-foreground">
                          {formatDueWindow(definition.dueWithinSeconds, t)}
                        </span>
                      </div>
                    ))}
                    {selectedSupportHiddenRules > 0 && (
                      <p className="px-2 pt-1">
                        {t("supportLevelMoreRules", { count: selectedSupportHiddenRules })}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 font-medium text-foreground">
                    {t("supportLevelAfterDraft")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                  <div className="space-y-1">
                    <Label>{t("validFrom")}</Label>
                    <Input
                      type="date"
                      value={form.validFrom}
                      onChange={(e) => setForm((current) => ({ ...current, validFrom: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("validTo")}</Label>
                    <Input
                      type="date"
                      value={form.validTo}
                      onChange={(e) => setForm((current) => ({ ...current, validTo: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>{t("notes")}</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                    placeholder={t("notesPlaceholder")}
                  />
                </div>

                <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                  {editingEntitlement ? (
                    <p>{t("editingHint", { company: editingEntitlement.companyName || t("unknownCompany") })}</p>
                  ) : selectedCompany ? (
                    <p>{t("selectedCompanyHint", { company: selectedCompany.name })}</p>
                  ) : (
                    <p>{t("companyHint")}</p>
                  )}
                  {selectedSla && (
                    <p className="mt-1">
                      {t("selectedSlaHint", {
                        first: selectedSla.firstResponseHours,
                        resolution: selectedSla.resolutionHours,
                      })}
                    </p>
                  )}
                </div>

                <Button className="w-full gap-2" onClick={submitEntitlement} disabled={!canSubmit || hasNoSetupOptions}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingId ? (
                    <Save className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {saving ? t("saving") : editingId ? t("saveChanges") : t("createDraft")}
                </Button>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                {t("permissionReadOnlyHint")}
              </div>
            )}
          </MotionCard>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("footerOverdue")}</p>
          <p>{t("footerEachEnt")}</p>
        </div>
      </div>
    </MotionPage>
  )
}

function MetricTile({
  label,
  value,
  loading,
  icon,
  hot,
  danger,
}: {
  label: string
  value: number
  loading: boolean
  icon?: ReactNode
  hot?: boolean
  danger?: boolean
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-12 animate-pulse rounded bg-muted" />
      ) : (
        <p className={`mt-1 text-xl font-bold ${danger ? "text-red-600" : hot ? "text-amber-600" : ""}`}>
          {value}
        </p>
      )}
    </div>
  )
}

function EntitlementCard({
  entitlement,
  formatDate,
  t,
  onEdit,
  onLifecycleAction,
  milestoneForm,
  milestoneLoadingKey,
  onMilestoneFormChange,
  onMilestoneFormReset,
  onMilestoneSubmit,
  onMilestoneTemplateApply,
  onMilestoneEdit,
  onMilestoneDelete,
  actionLoading,
  permissions,
  highlighted,
  templates,
}: {
  entitlement: Entitlement
  formatDate: (iso: string | null) => string
  t: ReturnType<typeof useTranslations>
  onEdit: (entitlement: Entitlement) => void
  onLifecycleAction: (
    entitlement: Entitlement,
    action: "activate" | "suspend" | "resume" | "expire" | "cancel",
  ) => void
  milestoneForm: MilestoneFormState
  milestoneLoadingKey: string | null
  onMilestoneFormChange: (patch: Partial<MilestoneFormState>) => void
  onMilestoneFormReset: () => void
  onMilestoneSubmit: () => void
  onMilestoneTemplateApply: () => void
  onMilestoneEdit: (definition: MilestoneDefinition) => void
  onMilestoneDelete: (definition: MilestoneDefinition) => void
  actionLoading: boolean
  permissions: EntitlementPermissions
  highlighted: boolean
  templates: EntitlementTemplate[]
}) {
  const hasOverdue = entitlement.milestones.overdue > 0
  const canEdit = permissions.canWrite && (entitlement.status === "draft" || entitlement.status === "suspended")
  const activationBlocked = entitlement.definitionCount === 0
  const actions =
    (entitlement.status === "draft"
      ? (["activate", "cancel"] as const)
      : entitlement.status === "active"
        ? (["suspend", "expire", "cancel"] as const)
        : entitlement.status === "suspended"
          ? (["resume", "expire", "cancel"] as const)
          : []
    ).filter((action) => action === "cancel" ? permissions.canCancel : permissions.canActivate)
  const stateClass = highlighted
    ? "border-primary/60 bg-primary/5 ring-2 ring-primary/20"
    : hasOverdue
      ? "border-red-500 bg-red-500/5"
      : entitlement.isExpiringSoon
        ? "border-amber-500 bg-amber-500/5"
        : ""
  return (
    <MotionCard
      id={`support-term-${entitlement.id}`}
      className={`scroll-mt-24 rounded-lg border bg-card p-5 transition-[border-color,background-color,box-shadow] duration-200 ${stateClass}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-lg font-semibold">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            {entitlement.companyName || t("unknownCompany")}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${SUPPORT_LEVEL_COLORS[entitlement.supportLevel] ?? SUPPORT_LEVEL_COLORS.standard}`}>
              {t.has(`supportLevels.${entitlement.supportLevel}`)
                ? t(`supportLevels.${entitlement.supportLevel}`)
                : entitlement.supportLevel}
            </span>
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGES[entitlement.status] ?? STATUS_BADGES.draft}`}>
              {t.has(`statuses.${entitlement.status}`)
                ? t(`statuses.${entitlement.status}`)
                : entitlement.status}
            </span>
          </div>
        </div>
        {hasOverdue ? (
          <span title={t("titleOverdue", { count: entitlement.milestones.overdue })} className="shrink-0">
            <ShieldAlert className="h-6 w-6 text-red-600" />
          </span>
        ) : entitlement.milestones.atRisk > 0 ? (
          <span title={t("titleAtRisk", { count: entitlement.milestones.atRisk })} className="shrink-0">
            <Shield className="h-6 w-6 text-amber-600" />
          </span>
        ) : entitlement.status === "active" ? (
          <span title={t("titleOnTrack")} className="shrink-0">
            <ShieldCheck className="h-6 w-6 text-green-600" />
          </span>
        ) : null}
      </div>

      <div className="mb-3 space-y-1 border-b pb-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("slaPolicy")}</span>
          <span className="truncate">{entitlement.slaPolicyName}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("valid")}</span>
          <span className="font-mono text-xs">
            {formatDate(entitlement.validFrom)}{" -> "}
            {entitlement.validTo ? formatDate(entitlement.validTo) : t("open")}
          </span>
        </div>
        {entitlement.isExpiringSoon && entitlement.daysUntilExpiry !== null && (
          <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
            <Clock className="h-3 w-3" />
            {t("expiresIn", { days: entitlement.daysUntilExpiry })}
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("milestoneDefs")}</span>
          <span>{entitlement.definitionCount}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <MilestoneCount label={t("overdue")} value={entitlement.milestones.overdue} danger />
        <MilestoneCount label={t("lt24h")} value={entitlement.milestones.atRisk} hot />
        <MilestoneCount label={t("met7d")} value={entitlement.milestones.met7d} success />
        <MilestoneCount label={t("missed30d")} value={entitlement.milestones.missed30d} danger />
      </div>

      {entitlement.milestones.met7d > 0 && !hasOverdue && entitlement.milestones.atRisk === 0 && (
        <div className="mt-3 flex items-center gap-1 border-t pt-3 text-xs text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-3 w-3" />
          {t("onTrack", { count: entitlement.milestones.met7d })}
        </div>
      )}

      {highlighted && entitlement.status === "draft" && (
        <div className="mt-3 rounded-md border border-primary/20 bg-background px-3 py-2 text-sm">
          <p className="font-medium">{t("draftCreatedFocusTitle")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("draftCreatedFocusDesc")}
          </p>
        </div>
      )}

      <MilestoneConstructor
        entitlement={entitlement}
        form={milestoneForm}
        loadingKey={milestoneLoadingKey}
        canEdit={canEdit}
        templates={templates}
        t={t}
        onFormChange={onMilestoneFormChange}
        onFormReset={onMilestoneFormReset}
        onSubmit={onMilestoneSubmit}
        onTemplateApply={onMilestoneTemplateApply}
        onEditDefinition={onMilestoneEdit}
        onDeleteDefinition={onMilestoneDelete}
      />

      {(canEdit || actions.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          {canEdit && (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onEdit(entitlement)}>
              <Pencil className="h-3.5 w-3.5" />
              {t("edit")}
            </Button>
          )}
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === "cancel" || action === "expire" ? "outline" : "secondary"}
              size="sm"
              className="gap-1"
              onClick={() => onLifecycleAction(entitlement, action)}
              disabled={actionLoading || ((action === "activate" || action === "resume") && activationBlocked)}
            >
              {actionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : action === "activate" || action === "resume" ? (
                <PlayCircle className="h-3.5 w-3.5" />
              ) : action === "suspend" ? (
                <PauseCircle className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {t(`actions.${action}`)}
            </Button>
          ))}
          {activationBlocked && actions.some((action) => action === "activate" || action === "resume") && (
            <p className="basis-full text-xs text-muted-foreground">
              {t("activationNeedsRules")}
            </p>
          )}
        </div>
      )}
    </MotionCard>
  )
}

function formatDueWindow(seconds: number, t: ReturnType<typeof useTranslations>) {
  const due = secondsToDueWindow(seconds)
  return `${due.value} ${t(`dueUnitsShort.${due.unit}`)}`
}

function MilestoneConstructor({
  entitlement,
  form,
  loadingKey,
  canEdit,
  templates,
  t,
  onFormChange,
  onFormReset,
  onSubmit,
  onTemplateApply,
  onEditDefinition,
  onDeleteDefinition,
}: {
  entitlement: Entitlement
  form: MilestoneFormState
  loadingKey: string | null
  canEdit: boolean
  templates: EntitlementTemplate[]
  t: ReturnType<typeof useTranslations>
  onFormChange: (patch: Partial<MilestoneFormState>) => void
  onFormReset: () => void
  onSubmit: () => void
  onTemplateApply: () => void
  onEditDefinition: (definition: MilestoneDefinition) => void
  onDeleteDefinition: (definition: MilestoneDefinition) => void
}) {
  const definitionLoading = loadingKey === `${entitlement.id}:definition`
  const templateLoading = loadingKey === `${entitlement.id}:template`
  const selectedTemplate = templates.find((template) => template.supportLevel === form.template)
  const templateDefinitionCount = selectedTemplate?.definitions.length ?? 0
  const templateUnavailable = !selectedTemplate?.isActive || templateDefinitionCount === 0
  const isEditingDefinition = Boolean(form.editingDefinitionId)

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">{t("milestoneConstructorTitle")}</h4>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t("milestoneCount", { count: entitlement.definitions.length })}
            </span>
          </div>
          {canEdit ? (
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-3">
              <Link href="/settings/entitlement-templates">
                <Settings2 className="h-3.5 w-3.5" />
                {t("editTemplates")}
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t("milestoneReadOnlyHint")}</span>
          )}
      </div>

      {canEdit && (
        <div className="space-y-3">
          {entitlement.definitions.length === 0 && (
            <>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-medium">{t("milestoneEmptyNextStepTitle")}</p>
                <p className="mt-1 text-xs leading-5">
                  {t("milestoneEmptyNextStepDesc", {
                    level: t(`supportLevels.${form.template}`),
                  })}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  label={t("template")}
                  value={form.template}
                  onChange={(e) => onFormChange({ template: asSupportLevel(e.target.value) })}
                >
                  {SUPPORT_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {t(`supportLevels.${level}`)}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 self-end"
                  onClick={onTemplateApply}
                  disabled={templateLoading || templateUnavailable}
                >
                  {templateLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {t("applyTemplate", {
                    count: templateDefinitionCount,
                    level: t(`supportLevels.${form.template}`),
                  })}
                </Button>
              </div>
            </>
          )}

          <div className="grid gap-2 lg:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("milestoneName")}</Label>
              <Input
                value={form.name}
                onChange={(e) => onFormChange({ name: e.target.value })}
                placeholder={t(`milestoneTypes.${form.type}`)}
              />
            </div>
            <Select
              label={t("milestoneType")}
              value={form.type}
              onChange={(e) => onFormChange({
                type: e.target.value as MilestoneType,
                name: "",
              })}
              disabled={isEditingDefinition}
            >
              {MILESTONE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`milestoneTypes.${type}`)}
                </option>
              ))}
            </Select>
            <Select
              label={t("severity")}
              value={form.severityTier}
              onChange={(e) => onFormChange({ severityTier: e.target.value as MilestoneSeverityScope })}
              disabled={isEditingDefinition}
            >
              {MILESTONE_SEVERITY_SCOPES.map((severity) => (
                <option key={severity} value={severity}>
                  {t(`severityScopes.${severity}`)}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2">
              <div className="space-y-1">
                <Label>{t("dueWindow")}</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.dueValue}
                  onChange={(e) => onFormChange({ dueValue: e.target.value })}
                />
              </div>
              <Select
                label={t("dueUnit")}
                value={form.dueUnit}
                onChange={(e) => onFormChange({ dueUnit: e.target.value as DueWindowUnit })}
              >
                <option value="minutes">{t("dueUnits.minutes")}</option>
                <option value="hours">{t("dueUnits.hours")}</option>
                <option value="days">{t("dueUnits.days")}</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-muted"
                checked={form.isRequired}
                onChange={(e) => onFormChange({ isRequired: e.target.checked })}
              />
              {t("requiredMilestone")}
            </label>
            <div className="flex flex-wrap gap-2">
              {isEditingDefinition && (
                <Button type="button" variant="ghost" size="sm" onClick={onFormReset}>
                  <X className="h-4 w-4" />
                  {t("cancelEdit")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="gap-2"
                onClick={onSubmit}
                disabled={definitionLoading}
              >
                {definitionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEditingDefinition ? (
                  <Save className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {isEditingDefinition ? t("saveMilestone") : t("addMilestone")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {entitlement.definitions.length > 0 ? (
        <div className="divide-y text-sm">
          {entitlement.definitions.map((definition) => {
            const deleteLoading = loadingKey === `${entitlement.id}:delete:${definition.id}`
            return (
              <div key={definition.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{definition.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`milestoneTypes.${definition.type}`)}
                    {" · "}
                    {t(`severityScopes.${definition.severityTier ?? "all"}`)}
                    {" · "}
                    {formatDueWindow(definition.dueWithinSeconds, t)}
                    {" · "}
                    {definition.isRequired ? t("required") : t("optional")}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditDefinition(definition)}
                    >
                      <Pencil className="h-4 w-4" />
                      {t("edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("deleteMilestone")}
                      onClick={() => onDeleteDefinition(definition)}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noMilestoneRules")}</p>
      )}
    </div>
  )
}

function MilestoneCount({
  label,
  value,
  danger,
  hot,
  success,
}: {
  label: string
  value: number
  danger?: boolean
  hot?: boolean
  success?: boolean
}) {
  const color = value > 0
    ? danger
      ? "text-red-600"
      : hot
        ? "text-amber-600"
        : success
          ? "text-green-600"
          : ""
    : success
      ? "text-green-600"
      : ""
  return (
    <div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  )
}
