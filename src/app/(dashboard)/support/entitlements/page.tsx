"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Shield,
  Trash2,
} from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  MILESTONE_SEVERITY_SCOPES,
  secondsToDueWindow,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import { filterEntitlements, type EntitlementFilters } from "@/lib/entitlement-process/presentation"
import {
  MILESTONE_TYPES,
  SUPPORT_LEVELS,
  type MilestoneType,
  type SupportLevel,
} from "@/lib/entitlement-process/types"
import { formatDate as formatDateLocale } from "@/lib/format-date"

interface MilestoneHealth {
  overdue: number
  atRisk: number
  missed30d: number
  met7d: number
}

export interface Entitlement {
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
  milestones: MilestoneHealth
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

interface EntitlementPermissions {
  canRead: boolean
  canWrite: boolean
  canActivate: boolean
  canCancel: boolean
  canWaiveMilestone: boolean
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

interface FormState {
  companyId: string
  slaPolicyId: string
  supportLevel: SupportLevel
  validFrom: string
  validTo: string
  notes: string
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

type LifecycleAction = "activate" | "suspend" | "resume" | "expire" | "cancel"

interface LifecycleTarget {
  entitlement: Entitlement
  action: LifecycleAction
}

const DEFAULT_PERMISSIONS: EntitlementPermissions = {
  canRead: false,
  canWrite: false,
  canActivate: false,
  canCancel: false,
  canWaiveMilestone: false,
}

const ENTITLEMENT_STATUSES = ["draft", "active", "suspended", "expired", "cancelled"] as const

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

function emptyFilters(): EntitlementFilters {
  return { companyId: "", status: "", supportLevel: "", slaPolicyId: "", risk: "" }
}

function asSupportLevel(value: string): SupportLevel {
  return SUPPORT_LEVELS.includes(value as SupportLevel) ? value as SupportLevel : "standard"
}

function emptyMilestoneForm(level: string): MilestoneFormState {
  return {
    editingDefinitionId: null,
    type: "first_response",
    name: "",
    severityTier: "all",
    dueValue: "4",
    dueUnit: "hours",
    isRequired: true,
    template: asSupportLevel(level),
  }
}

function canEditEntitlement(entitlement: Entitlement, permissions: EntitlementPermissions) {
  return permissions.canWrite && ["draft", "suspended"].includes(entitlement.status)
}

function lifecycleActions(entitlement: Entitlement, permissions: EntitlementPermissions): LifecycleAction[] {
  const actions: LifecycleAction[] = entitlement.status === "draft"
    ? ["activate", "cancel"]
    : entitlement.status === "active"
      ? ["suspend", "expire", "cancel"]
      : entitlement.status === "suspended"
        ? ["resume", "expire", "cancel"]
        : []
  return actions.filter((action) => action === "cancel" ? permissions.canCancel : permissions.canActivate)
}

function formatDueWindow(seconds: number, t: ReturnType<typeof useTranslations>) {
  const due = secondsToDueWindow(seconds)
  return `${due.value} ${t(`dueUnitsShort.${due.unit}`)}`
}

export default function EntitlementsPage() {
  const t = useTranslations("slice2.entitlements")
  const tc = useTranslations("slice2.common")
  const common = useTranslations("common")
  const locale = useLocale()
  const [data, setData] = useState<EntitlementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [loadErrorRetryable, setLoadErrorRetryable] = useState(true)
  const [actionError, setActionError] = useState("")
  const [actionErrorRetryable, setActionErrorRetryable] = useState(true)
  const [notice, setNotice] = useState("")
  const [filters, setFilters] = useState<EntitlementFilters>(() => emptyFilters())

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [milestoneEditorOpen, setMilestoneEditorOpen] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [detailErrorRetryable, setDetailErrorRetryable] = useState(true)
  const [milestoneForm, setMilestoneForm] = useState<MilestoneFormState>(() => emptyMilestoneForm("standard"))
  const [milestoneLoadingKey, setMilestoneLoadingKey] = useState<string | null>(null)
  const [deleteDefinitionTarget, setDeleteDefinitionTarget] = useState<MilestoneDefinition | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm())
  const [formBaseline, setFormBaseline] = useState<FormState>(() => emptyForm())
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null)
  const [lifecycleReason, setLifecycleReason] = useState("")
  const [lifecycleError, setLifecycleError] = useState("")
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const desktopRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const mobileRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const listRef = useRef<HTMLElement>(null)
  const returnFocusId = useRef<string | null>(null)

  const restoreListFocus = useCallback(() => {
    const id = returnFocusId.current
    if (!id) return
    const candidates = [desktopRowRefs.current.get(id), mobileRowRefs.current.get(id)]
    const target = candidates.find((candidate) => candidate && candidate.getClientRects().length > 0)
      ?? candidates.find(Boolean)
    if (target) target.focus({ preventScroll: true })
    else listRef.current?.focus({ preventScroll: true })
    returnFocusId.current = null
  }, [])

  const formatDate = useCallback((iso: string | null) => (
    iso ? formatDateLocale(iso, locale) : "—"
  ), [locale])

  const localApiError = useCallback((response: Response, payload: { code?: string } | null, fallback: string) => {
    if (response.status === 403) return t("permissionApiError")
    switch (payload?.code) {
      case "ACTIVE_COMPANY_CONFLICT": return t("activeCompanyConflict")
      case "MILESTONE_REQUIRED": return t("activationNeedsRules")
      case "CANCELLATION_REASON_REQUIRED": return t("cancelReasonRequired")
      case "INVALID_VALIDITY": return t("validityRangeError")
      case "MILESTONE_DUPLICATE": return t("milestoneDuplicateError")
      case "MILESTONE_IN_USE": return t("milestoneInUseError")
      case "TERM_NOT_EDITABLE": return t("termNotEditableError")
      default: return fallback
    }
  }, [t])

  const fetchEntitlements = useCallback(async (background = false) => {
    let retryable = true
    if (background) setRefreshing(true)
    else {
      setLoading(true)
      setLoadError("")
      setLoadErrorRetryable(true)
    }
    try {
      const response = await fetch("/api/v1/entitlements")
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || !Array.isArray(payload.entitlements)) {
        retryable = response.status !== 403
        throw new Error(response.status === 403 ? t("permissionReadOnlyDesc") : tc("errorFetchFailed"))
      }
      setData(payload)
      setLoadError("")
      setLoadErrorRetryable(true)
      setActionError("")
      setActionErrorRetryable(true)
      return payload as EntitlementsResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : tc("errorFetchFailed")
      if (background) {
        setActionError(message)
        setActionErrorRetryable(retryable)
      } else {
        setLoadError(message)
        setLoadErrorRetryable(retryable)
      }
      return null
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t, tc])

  useEffect(() => {
    void fetchEntitlements()
  }, [fetchEntitlements])

  const permissions = data?.permissions ?? DEFAULT_PERMISSIONS
  const selectedEntitlement = useMemo(
    () => data?.entitlements.find((entitlement) => entitlement.id === selectedId) ?? null,
    [data?.entitlements, selectedId],
  )
  const editingEntitlement = useMemo(
    () => data?.entitlements.find((entitlement) => entitlement.id === editingId) ?? null,
    [data?.entitlements, editingId],
  )
  const filteredEntitlements = useMemo(
    () => filterEntitlements(data?.entitlements ?? [], filters),
    [data?.entitlements, filters],
  )
  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const uncoveredCompanies = data?.companies.filter(
    (company) => company.status === "active" && !company.hasActiveEntitlement,
  ).length ?? 0
  const attentionMilestones = (data?.atRiskMilestones ?? 0) + (data?.overdueMilestones ?? 0)
  const hasNoSetupOptions = Boolean(data && (data.companies.length === 0 || data.slaPolicies.length === 0))
  const isFormDirty = JSON.stringify(form) !== JSON.stringify(formBaseline)
  const bannerError = actionError || (data ? loadError : "")
  const bannerErrorRetryable = actionError ? actionErrorRetryable : loadErrorRetryable

  const defaultForm = useCallback((source = data) => {
    const defaultPolicy = source?.slaPolicies.find((policy) => policy.isDefault) ?? source?.slaPolicies[0]
    return emptyForm(defaultPolicy?.id ?? "")
  }, [data])

  const openCreate = () => {
    if (!permissions.canWrite) {
      setActionError(t("permissionReadOnlyDesc"))
      return
    }
    const next = defaultForm()
    setEditingId(null)
    setForm(next)
    setFormBaseline(next)
    setFormError("")
    setNotice("")
    setFormOpen(true)
  }

  const openEdit = (entitlement: Entitlement) => {
    if (!canEditEntitlement(entitlement, permissions)) {
      setActionError(t("termNotEditableError"))
      return
    }
    returnFocusId.current = entitlement.id
    const next: FormState = {
      companyId: entitlement.companyId,
      slaPolicyId: entitlement.slaPolicyId,
      supportLevel: asSupportLevel(entitlement.supportLevel),
      validFrom: dateInputValue(entitlement.validFrom),
      validTo: dateInputValue(entitlement.validTo),
      notes: entitlement.notes ?? "",
    }
    setEditingId(entitlement.id)
    setForm(next)
    setFormBaseline(next)
    setFormError("")
    setNotice("")
    setFormOpen(true)
  }

  const finishFormClose = () => {
    setFormOpen(false)
    setEditingId(null)
    setFormError("")
    window.requestAnimationFrame(restoreListFocus)
  }

  const requestFormClose = () => {
    if (isFormDirty && !saving) setDiscardOpen(true)
    else finishFormClose()
  }

  const submitEntitlement = async () => {
    if (!permissions.canWrite || saving) return
    if (!form.companyId || !form.slaPolicyId || !form.validFrom) {
      setFormError(t("requiredFieldsError"))
      return
    }
    if (form.validTo && form.validTo <= form.validFrom) {
      setFormError(t("validityRangeError"))
      return
    }
    setSaving(true)
    setFormError("")
    try {
      const response = await fetch(editingId ? `/api/v1/entitlements/${editingId}` : "/api/v1/entitlements", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? {} : { companyId: form.companyId, slaPolicyId: form.slaPolicyId }),
          supportLevel: form.supportLevel,
          validFrom: form.validFrom,
          validTo: form.validTo || null,
          notes: form.notes.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(localApiError(response, payload, editingId ? t("updateFailed") : t("createFailed")))
      }

      const createdId = typeof payload?.createdEntitlementId === "string" ? payload.createdEntitlementId : null
      if (editingId) await fetchEntitlements(true)
      else if (payload && Array.isArray(payload.entitlements)) setData(payload)
      setNotice(editingId ? t("updatedNotice") : t("createdNoticeCompact"))
      setFormBaseline(form)
      finishFormClose()
      const nextSelectedId = editingId ?? createdId
      if (nextSelectedId) {
        setSelectedId(nextSelectedId)
        setMilestoneEditorOpen(Boolean(createdId))
        const nextLevel = payload?.entitlements?.find((item: Entitlement) => item.id === nextSelectedId)?.supportLevel
          ?? form.supportLevel
        setMilestoneForm(emptyMilestoneForm(nextLevel))
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : editingId ? t("updateFailed") : t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  const openDetails = (entitlement: Entitlement) => {
    returnFocusId.current = entitlement.id
    setSelectedId(entitlement.id)
    setMilestoneEditorOpen(false)
    setMilestoneForm(emptyMilestoneForm(entitlement.supportLevel))
    setActionError("")
    setDetailError("")
    setDetailErrorRetryable(true)
  }

  const closeDetails = () => {
    setSelectedId(null)
    setMilestoneEditorOpen(false)
    window.requestAnimationFrame(restoreListFocus)
  }

  const editFromDetails = () => {
    if (!selectedEntitlement) return
    const entitlement = selectedEntitlement
    setSelectedId(null)
    setMilestoneEditorOpen(false)
    openEdit(entitlement)
  }

  const openLifecycle = (entitlement: Entitlement, action: LifecycleAction) => {
    setLifecycleTarget({ entitlement, action })
    setLifecycleReason("")
    setLifecycleError("")
    setNotice("")
  }

  const performLifecycle = async () => {
    if (!lifecycleTarget || actionLoadingId) return
    const { entitlement, action } = lifecycleTarget
    if (action === "cancel" && !lifecycleReason.trim()) {
      setLifecycleError(t("cancelReasonRequired"))
      return
    }
    setActionLoadingId(entitlement.id)
    setLifecycleError("")
    try {
      const response = await fetch(`/api/v1/entitlements/${entitlement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(lifecycleReason.trim() ? { reason: lifecycleReason.trim() } : {}),
          ...(action === "cancel" ? { cancellationReason: lifecycleReason.trim() } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localApiError(response, payload, t("lifecycleFailed")))
      await fetchEntitlements(true)
      setNotice(t(`actionNotices.${action}`))
      setLifecycleTarget(null)
      setLifecycleReason("")
      if (editingId === entitlement.id) finishFormClose()
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : t("lifecycleFailed"))
    } finally {
      setActionLoadingId(null)
    }
  }

  const submitMilestone = async () => {
    if (!selectedEntitlement || milestoneLoadingKey) return
    const dueValue = Number(milestoneForm.dueValue)
    if (!Number.isFinite(dueValue) || dueValue <= 0) {
      setDetailError(t("milestoneDueInvalid"))
      setDetailErrorRetryable(false)
      return
    }
    const severity = milestoneForm.severityTier === "all" ? null : milestoneForm.severityTier
    const duplicate = !milestoneForm.editingDefinitionId && selectedEntitlement.definitions.some(
      (definition) => definition.type === milestoneForm.type && definition.severityTier === severity,
    )
    if (duplicate) {
      setDetailError(t("milestoneDuplicateError"))
      setDetailErrorRetryable(false)
      return
    }

    setMilestoneLoadingKey("save")
    setDetailError("")
    setDetailErrorRetryable(true)
    setNotice("")
    try {
      const editingDefinitionId = milestoneForm.editingDefinitionId
      const response = await fetch(
        editingDefinitionId
          ? `/api/v1/entitlements/${selectedEntitlement.id}/milestones/${editingDefinitionId}`
          : `/api/v1/entitlements/${selectedEntitlement.id}/milestones`,
        {
          method: editingDefinitionId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingDefinitionId ? {
            name: milestoneForm.name.trim() || t(`milestoneTypes.${milestoneForm.type}`),
            dueValue,
            dueUnit: milestoneForm.dueUnit,
            isRequired: milestoneForm.isRequired,
          } : {
            mode: "definition",
            type: milestoneForm.type,
            name: milestoneForm.name.trim() || t(`milestoneTypes.${milestoneForm.type}`),
            severityTier: milestoneForm.severityTier,
            dueValue,
            dueUnit: milestoneForm.dueUnit,
            isRequired: milestoneForm.isRequired,
          }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setDetailErrorRetryable(response.status !== 403)
        throw new Error(localApiError(response, payload, t("milestoneSaveFailed")))
      }
      await fetchEntitlements(true)
      setNotice(editingDefinitionId ? t("milestoneUpdatedNotice") : t("milestoneCreatedNotice"))
      setMilestoneForm(emptyMilestoneForm(selectedEntitlement.supportLevel))
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : t("milestoneSaveFailed"))
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  const applyMilestoneTemplate = async () => {
    if (!selectedEntitlement || milestoneLoadingKey) return
    setMilestoneLoadingKey("template")
    setDetailError("")
    setDetailErrorRetryable(true)
    setNotice("")
    try {
      const response = await fetch(`/api/v1/entitlements/${selectedEntitlement.id}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "template", template: milestoneForm.template }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setDetailErrorRetryable(response.status !== 403)
        throw new Error(localApiError(response, payload, t("templateApplyFailed")))
      }
      await fetchEntitlements(true)
      setNotice(t("templateAppliedNotice"))
      setMilestoneForm(emptyMilestoneForm(selectedEntitlement.supportLevel))
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : t("templateApplyFailed"))
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  const editMilestone = (definition: MilestoneDefinition) => {
    const due = secondsToDueWindow(definition.dueWithinSeconds)
    setMilestoneForm({
      editingDefinitionId: definition.id,
      type: definition.type as MilestoneType,
      name: definition.name,
      severityTier: (definition.severityTier ?? "all") as MilestoneSeverityScope,
      dueValue: String(due.value),
      dueUnit: due.unit,
      isRequired: definition.isRequired,
      template: asSupportLevel(selectedEntitlement?.supportLevel ?? "standard"),
    })
    setMilestoneEditorOpen(true)
  }

  const deleteMilestone = async () => {
    if (!selectedEntitlement || !deleteDefinitionTarget) return
    setMilestoneLoadingKey(`delete:${deleteDefinitionTarget.id}`)
    try {
      const response = await fetch(
        `/api/v1/entitlements/${selectedEntitlement.id}/milestones/${deleteDefinitionTarget.id}`,
        { method: "DELETE" },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localApiError(response, payload, t("milestoneDeleteFailed")))
      await fetchEntitlements(true)
      setNotice(t("milestoneDeletedNotice"))
      if (milestoneForm.editingDefinitionId === deleteDefinitionTarget.id) {
        setMilestoneForm(emptyMilestoneForm(selectedEntitlement.supportLevel))
      }
      setDeleteDefinitionTarget(null)
    } finally {
      setMilestoneLoadingKey(null)
    }
  }

  return (
    <div
      className="space-y-4"
      data-testid="support-entitlements-workspace"
      data-state={loading ? "loading" : loadError && !data ? "error" : data?.entitlements.length === 0 ? "empty" : "ready"}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h1 className="truncate text-xl font-semibold tracking-tight">{t("title")}</h1>
            <HelpButton slug="entitlements" />
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitleCompact")}</p>
          {data && !permissions.canWrite && <p className="mt-1 text-xs text-muted-foreground" data-testid="support-entitlements-read-only">{t("permissionReadOnlyHint")}</p>}
        </div>
        {permissions.canWrite && (
          <Button className="min-h-11 shrink-0 bg-orange-700 text-white hover:bg-orange-800" onClick={openCreate} data-testid="support-entitlements-create"><Plus />{t("createButton")}</Button>
        )}
      </header>

      <details className="group rounded-lg border bg-muted/10 px-3 py-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{t("howItWorksTitle")}</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">{t("draftFirstHint")}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t pb-2 pt-3 text-sm text-muted-foreground">
          <p>{t("howItWorksDesc")}</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {["stepCompany", "stepSla", "stepLevel", "stepValidity", "stepMilestones", "stepActivate"].map((key, index) => (
              <li key={key} className="flex items-center gap-2"><span className="font-medium text-foreground">{index + 1}.</span>{t(key)}</li>
            ))}
          </ol>
        </div>
      </details>

      {(bannerError || notice) && (
        <div aria-live="polite" className="space-y-2">
          {bannerError && (
            <div role="alert" data-testid="support-entitlements-refresh-error" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1">{bannerError}</span>
              {bannerErrorRetryable && <Button variant="outline" className="min-h-11" onClick={() => void fetchEntitlements(Boolean(data))} data-testid="support-entitlements-refresh-retry"><RotateCcw />{t("retry")}</Button>}
            </div>
          )}
          {notice && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{notice}</span>
              <Button variant="ghost" className="min-h-11" onClick={() => setNotice("")}>{common("close")}</Button>
            </div>
          )}
        </div>
      )}

      <section aria-label={t("exceptionSummaryLabel")} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y py-2 text-xs text-muted-foreground">
        <button type="button" className="min-h-11 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setFilters((current) => ({ ...current, risk: "expiring" }))}>
          <strong className="mr-1 text-sm font-semibold text-foreground">{loading ? "—" : data?.expiringSoonCount ?? 0}</strong>{t("kpiExpiring30d")}
        </button>
        <button type="button" className="min-h-11 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setFilters((current) => ({ ...current, risk: "attention" }))}>
          <strong className="mr-1 text-sm font-semibold text-foreground">{loading ? "—" : attentionMilestones}</strong>{t("kpiNeedsAttention")}
        </button>
        <span className="flex min-h-11 items-center"><strong className="mr-1 text-sm font-semibold text-foreground">{loading ? "—" : uncoveredCompanies}</strong>{t("kpiUncovered")}</span>
        {refreshing && <span role="status" className="ml-auto flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{t("refreshing")}</span>}
      </section>

      {data && data.entitlements.length > 0 && (
        <EntitlementToolbar
          data={data}
          filters={filters}
          activeCount={activeFilterCount}
          resultCount={filteredEntitlements.length}
          t={t}
          onChange={setFilters}
          onReset={() => setFilters(emptyFilters())}
        />
      )}

      <section ref={listRef} tabIndex={-1} className="overflow-hidden rounded-xl border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("listLabel")} data-testid="support-entitlements-list">
        {loading ? (
          <div aria-busy="true" className="divide-y" data-testid="support-entitlements-loading">
            {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 animate-pulse bg-muted/30 motion-reduce:animate-none" />)}
          </div>
        ) : loadError && !data ? (
          <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center" data-testid="support-entitlements-load-error">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
            {loadErrorRetryable && <Button variant="outline" className="mt-4 min-h-11" onClick={() => void fetchEntitlements()} data-testid="support-entitlements-load-retry"><RotateCcw />{t("retry")}</Button>}
          </div>
        ) : data && data.entitlements.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center" data-testid="support-entitlements-empty-state">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">{t("emptyTitle")}</h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("emptyDesc")}</p>
            {permissions.canWrite && <Button className="mt-4 min-h-11 bg-orange-700 text-white hover:bg-orange-800" onClick={openCreate} data-testid="support-entitlements-empty-create"><Plus />{t("createButton")}</Button>}
          </div>
        ) : data && filteredEntitlements.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center" data-testid="support-entitlements-no-results">
            <p className="text-sm text-muted-foreground">{t("noFilterResults")}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => setFilters(emptyFilters())} data-testid="support-entitlements-reset-filters"><RotateCcw />{t("resetFilters")}</Button>
          </div>
        ) : data ? (
          <>
            <EntitlementTable
              entitlements={filteredEntitlements}
              permissions={permissions}
              formatDate={formatDate}
              t={t}
              rowRefs={desktopRowRefs}
              onOpen={openDetails}
              onEdit={openEdit}
            />
            <EntitlementMobileList
              entitlements={filteredEntitlements}
              permissions={permissions}
              formatDate={formatDate}
              t={t}
              rowRefs={mobileRowRefs}
              onOpen={openDetails}
              onEdit={openEdit}
            />
          </>
        ) : null}
      </section>

      <SupportTermFormSheet
        open={formOpen}
        editing={editingEntitlement}
        data={data}
        form={form}
        error={formError}
        saving={saving}
        hasNoSetupOptions={!editingId && hasNoSetupOptions}
        t={t}
        common={common}
        onChange={(patch) => { setForm((current) => ({ ...current, ...patch })); setFormError("") }}
        onClose={requestFormClose}
        onSubmit={submitEntitlement}
      />

      <EntitlementDetailSheet
        entitlement={selectedEntitlement}
        interactionBlocked={Boolean(lifecycleTarget || deleteDefinitionTarget)}
        permissions={permissions}
        templates={data?.templates ?? []}
        formatDate={formatDate}
        t={t}
        common={common}
        error={detailError || actionError}
        errorRetryable={detailError ? detailErrorRetryable : actionErrorRetryable}
        notice={notice}
        milestoneEditorOpen={milestoneEditorOpen}
        milestoneForm={milestoneForm}
        milestoneLoadingKey={milestoneLoadingKey}
        onClose={closeDetails}
        onEdit={editFromDetails}
        onLifecycle={(action) => selectedEntitlement && openLifecycle(selectedEntitlement, action)}
        onToggleMilestones={() => setMilestoneEditorOpen((current) => !current)}
        onRetry={() => { setDetailError(""); setDetailErrorRetryable(true); void fetchEntitlements(true) }}
        onMilestoneChange={(patch) => { setMilestoneForm((current) => ({ ...current, ...patch })); setDetailError(""); setDetailErrorRetryable(true) }}
        onMilestoneReset={() => selectedEntitlement && setMilestoneForm(emptyMilestoneForm(selectedEntitlement.supportLevel))}
        onMilestoneSubmit={submitMilestone}
        onTemplateApply={applyMilestoneTemplate}
        onMilestoneEdit={editMilestone}
        onMilestoneDelete={setDeleteDefinitionTarget}
      />

      <LifecycleDialog
        target={lifecycleTarget}
        reason={lifecycleReason}
        error={lifecycleError}
        loading={Boolean(actionLoadingId)}
        t={t}
        common={common}
        onReasonChange={(value) => { setLifecycleReason(value); setLifecycleError("") }}
        onClose={() => { if (!actionLoadingId) setLifecycleTarget(null) }}
        onConfirm={performLifecycle}
      />

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={async () => { setDiscardOpen(false); finishFormClose() }}
        title={t("discardTitle")}
        description={t("discardDescription")}
        confirmLabel={t("discardAction")}
      />
      {deleteDefinitionTarget && createPortal(
        <div data-testid="support-entitlement-delete-milestone-dialog">
          <ConfirmDialog
            open
            onOpenChange={(open) => { if (!open) setDeleteDefinitionTarget(null) }}
            onConfirm={deleteMilestone}
            title={t("deleteMilestoneTitle")}
            description={t("deleteMilestoneDescription", { name: deleteDefinitionTarget.name })}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

function EntitlementToolbar({
  data,
  filters,
  activeCount,
  resultCount,
  t,
  onChange,
  onReset,
}: {
  data: EntitlementsResponse
  filters: EntitlementFilters
  activeCount: number
  resultCount: number
  t: ReturnType<typeof useTranslations>
  onChange: (filters: EntitlementFilters) => void
  onReset: () => void
}) {
  const update = (patch: Partial<EntitlementFilters>) => onChange({ ...filters, ...patch })
  return (
    <section aria-label={t("filtersTitle")} className="rounded-xl border bg-card p-2" data-testid="support-entitlements-filters">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Select aria-label={t("company")} value={filters.companyId} onChange={(event) => update({ companyId: event.target.value })} className="min-h-11" data-testid="support-entitlements-filter-company">
          <option value="">{t("allCompanies")}</option>
          {data.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </Select>
        <Select aria-label={t("status")} value={filters.status} onChange={(event) => update({ status: event.target.value })} className="min-h-11" data-testid="support-entitlements-filter-status">
          <option value="">{t("allStatuses")}</option>
          {ENTITLEMENT_STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}
        </Select>
        <Select aria-label={t("supportLevel")} value={filters.supportLevel} onChange={(event) => update({ supportLevel: event.target.value })} className="min-h-11" data-testid="support-entitlements-filter-level">
          <option value="">{t("allSupportLevels")}</option>
          {SUPPORT_LEVELS.map((level) => <option key={level} value={level}>{t(`supportLevels.${level}`)}</option>)}
        </Select>
        <Select aria-label={t("slaPolicy")} value={filters.slaPolicyId} onChange={(event) => update({ slaPolicyId: event.target.value })} className="min-h-11" data-testid="support-entitlements-filter-sla">
          <option value="">{t("allSlaPolicies")}</option>
          {data.slaPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
        </Select>
        <Select aria-label={t("risk")} value={filters.risk} onChange={(event) => update({ risk: event.target.value })} className="min-h-11" data-testid="support-entitlements-filter-risk">
          <option value="">{t("allRiskStates")}</option>
          <option value="attention">{t("riskAttention")}</option>
          <option value="expiring">{t("riskExpiring")}</option>
          <option value="overdue">{t("riskOverdue")}</option>
          <option value="atRisk">{t("riskAtRisk")}</option>
        </Select>
      </div>
      <div className="mt-2 flex min-h-8 items-center justify-between gap-2 border-t px-1 pt-2 text-xs text-muted-foreground">
        <span>{t("resultCount", { count: resultCount })}{activeCount > 0 ? ` · ${t("filtersApplied", { count: activeCount })}` : ""}</span>
        {activeCount > 0 && <Button variant="ghost" className="min-h-11" onClick={onReset} data-testid="support-entitlements-toolbar-reset"><RotateCcw />{t("resetFilters")}</Button>}
      </div>
    </section>
  )
}

interface EntitlementListProps {
  entitlements: Entitlement[]
  permissions: EntitlementPermissions
  formatDate: (value: string | null) => string
  t: ReturnType<typeof useTranslations>
  rowRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  onOpen: (entitlement: Entitlement) => void
  onEdit: (entitlement: Entitlement) => void
}

function EntitlementTable({ entitlements, permissions, formatDate, t, rowRefs, onOpen, onEdit }: EntitlementListProps) {
  return (
    <div className="hidden overflow-x-auto xl:block" data-testid="support-entitlements-table">
      <table className="w-full min-w-[880px] text-sm">
        <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("company")}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("supportLevel")}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("slaPolicy")}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("valid")}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("milestoneHealth")}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("status")}</th>
            <th scope="col" className="w-14 px-2 py-2"><span className="sr-only">{t("actionsLabel")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {entitlements.map((entitlement) => (
            <tr key={entitlement.id} data-testid="support-entitlement-row" data-entitlement-id={entitlement.id}>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <button
                  ref={(node) => { if (node) rowRefs.current.set(entitlement.id, node); else rowRefs.current.delete(entitlement.id) }}
                  type="button"
                  className="min-h-11 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpen(entitlement)}
                  data-testid={`support-entitlement-open-${entitlement.id}`}
                >
                  {entitlement.companyName || t("unknownCompany")}
                </button>
              </th>
              <td className="px-3 py-2"><SupportLevelBadge level={entitlement.supportLevel} t={t} /></td>
              <td className="max-w-48 truncate px-3 py-2">{entitlement.slaPolicyName || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">{formatDate(entitlement.validFrom)} – {entitlement.validTo ? formatDate(entitlement.validTo) : t("open")}</td>
              <td className="px-3 py-2"><HealthLabel entitlement={entitlement} t={t} /></td>
              <td className="px-3 py-2"><StatusBadge status={entitlement.status} t={t} /></td>
              <td className="px-2 py-2"><RowActions entitlement={entitlement} permissions={permissions} t={t} onOpen={onOpen} onEdit={onEdit} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EntitlementMobileList({ entitlements, permissions, formatDate, t, rowRefs, onOpen, onEdit }: EntitlementListProps) {
  return (
    <div className="divide-y xl:hidden" data-testid="support-entitlements-mobile-list">
      {entitlements.map((entitlement) => (
        <article key={entitlement.id} className="p-3" data-testid="support-entitlement-row" data-entitlement-id={entitlement.id}>
          <div className="flex items-start gap-2">
            <button
              ref={(node) => { if (node) rowRefs.current.set(entitlement.id, node); else rowRefs.current.delete(entitlement.id) }}
              type="button"
              className="min-h-11 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(entitlement)}
              data-testid={`support-entitlement-open-${entitlement.id}`}
            >
              <span className="block truncate text-sm font-medium">{entitlement.companyName || t("unknownCompany")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{entitlement.slaPolicyName}</span>
            </button>
            <RowActions entitlement={entitlement} permissions={permissions} t={t} onOpen={onOpen} onEdit={onEdit} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2"><SupportLevelBadge level={entitlement.supportLevel} t={t} /><StatusBadge status={entitlement.status} t={t} /><HealthLabel entitlement={entitlement} t={t} /></div>
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">{formatDate(entitlement.validFrom)} – {entitlement.validTo ? formatDate(entitlement.validTo) : t("open")}</p>
        </article>
      ))}
    </div>
  )
}

function RowActions({ entitlement, permissions, t, onOpen, onEdit }: {
  entitlement: Entitlement
  permissions: EntitlementPermissions
  t: ReturnType<typeof useTranslations>
  onOpen: (entitlement: Entitlement) => void
  onEdit: (entitlement: Entitlement) => void
}) {
  const editable = canEditEntitlement(entitlement, permissions)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("actionsNamed", { company: entitlement.companyName || t("unknownCompany") })} data-testid={`support-entitlement-actions-${entitlement.id}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={() => onOpen(entitlement)} data-testid={`support-entitlement-details-${entitlement.id}`}><FileText />{t("openDetails")}</DropdownMenuItem>
        {editable && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" onSelect={() => onEdit(entitlement)} data-testid={`support-entitlement-edit-${entitlement.id}`}><Pencil />{t("edit")}</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SupportLevelBadge({ level, t }: { level: string; t: ReturnType<typeof useTranslations> }) {
  const known = SUPPORT_LEVELS.includes(level as SupportLevel)
  return <Badge variant="outline">{known ? t(`supportLevels.${level}`) : t("unknownSupportLevel")}</Badge>
}

function StatusBadge({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const known = ENTITLEMENT_STATUSES.includes(status as (typeof ENTITLEMENT_STATUSES)[number])
  const active = status === "active"
  return <Badge variant={active ? "outline" : "secondary"} className="gap-1">{active ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{known ? t(`statuses.${status}`) : t("unknownStatus")}</Badge>
}

function HealthLabel({ entitlement, t }: { entitlement: Entitlement; t: ReturnType<typeof useTranslations> }) {
  if (entitlement.milestones.overdue > 0) return <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><CircleAlert className="h-3.5 w-3.5" />{t("overdueCount", { count: entitlement.milestones.overdue })}</span>
  if (entitlement.milestones.atRisk > 0) return <span className="inline-flex items-center gap-1 text-xs font-medium"><CircleAlert className="h-3.5 w-3.5" />{t("atRiskCount", { count: entitlement.milestones.atRisk })}</span>
  if (entitlement.isExpiringSoon) return <span className="inline-flex items-center gap-1 text-xs"><Clock className="h-3.5 w-3.5" />{t("expiresIn", { days: entitlement.daysUntilExpiry ?? 0 })}</span>
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" />{t("onTrackCompact")}</span>
}

function SupportTermFormSheet({ open, editing, data, form, error, saving, hasNoSetupOptions, t, common, onChange, onClose, onSubmit }: {
  open: boolean
  editing: Entitlement | null
  data: EntitlementsResponse | null
  form: FormState
  error: string
  saving: boolean
  hasNoSetupOptions: boolean
  t: ReturnType<typeof useTranslations>
  common: ReturnType<typeof useTranslations>
  onChange: (patch: Partial<FormState>) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const selectedTemplate = data?.templates.find((template) => template.supportLevel === form.supportLevel)
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent closeLabel={common("close")} className="!h-[100dvh] !w-full !max-w-none overflow-y-auto p-0 sm:!w-[34rem] sm:!max-w-[90vw]" data-testid="support-entitlement-form-sheet">
        <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="flex min-h-full flex-col" data-testid="support-entitlement-form">
          <SheetHeader className="border-b px-4 pb-3 pr-16 pt-4">
            <SheetTitle>{editing ? t("editFormTitle") : t("formTitle")}</SheetTitle>
            <SheetDescription>{editing ? t("editFormDesc") : t("formDesc")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 p-4">
            {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="support-entitlement-form-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{error}</div>}
            {hasNoSetupOptions && <div role="alert" className="rounded-lg border bg-muted/20 p-3 text-sm" data-testid="support-entitlement-setup-blocked">{data?.companies.length === 0 ? t("missingCompanies") : t("missingSlaPolicies")}</div>}
            <Select label={t("company")} value={form.companyId} onChange={(event) => onChange({ companyId: event.target.value })} disabled={Boolean(editing) || !data?.companies.length} className="min-h-11" data-dialog-initial-focus data-testid="support-entitlement-company">
              <option value="">{t("selectCompany")}</option>
              {editing && !data?.companies.some((company) => company.id === editing.companyId) && <option value={editing.companyId}>{editing.companyName || t("unknownCompany")}</option>}
              {data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}{company.hasActiveEntitlement ? ` · ${t("hasActiveTerm")}` : ""}</option>)}
            </Select>
            <Select label={t("slaPolicy")} value={form.slaPolicyId} onChange={(event) => onChange({ slaPolicyId: event.target.value })} disabled={Boolean(editing) || !data?.slaPolicies.length} className="min-h-11" data-testid="support-entitlement-sla">
              <option value="">{t("selectSlaPolicy")}</option>
              {editing && !data?.slaPolicies.some((policy) => policy.id === editing.slaPolicyId) && <option value={editing.slaPolicyId}>{editing.slaPolicyName}</option>}
              {data?.slaPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}{policy.isDefault ? ` · ${t("defaultPolicy")}` : ""}</option>)}
            </Select>
            <Select label={t("supportLevel")} value={form.supportLevel} onChange={(event) => onChange({ supportLevel: asSupportLevel(event.target.value) })} className="min-h-11" data-testid="support-entitlement-level">
              {SUPPORT_LEVELS.map((level) => <option key={level} value={level}>{t(`supportLevels.${level}`)}</option>)}
            </Select>
            <details className="rounded-lg border bg-muted/10 p-3 text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("supportLevelTemplateBadge", { count: selectedTemplate?.definitions.length ?? 0 })}</summary>
              <p>{t("supportLevelGuideDesc", { level: t(`supportLevels.${form.supportLevel}`) })}</p>
              <ul className="mt-2 space-y-1">
                {selectedTemplate?.definitions.map((definition) => <li key={definition.id} className="flex justify-between gap-2"><span>{t(`milestoneTypes.${definition.type}`)}</span><span>{formatDueWindow(definition.dueWithinSeconds, t)}</span></li>)}
              </ul>
            </details>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="entitlement-valid-from">{t("validFrom")}</Label><Input id="entitlement-valid-from" type="date" value={form.validFrom} onChange={(event) => onChange({ validFrom: event.target.value })} className="min-h-11" required /></div>
              <div className="space-y-1"><Label htmlFor="entitlement-valid-to">{t("validTo")}</Label><Input id="entitlement-valid-to" type="date" value={form.validTo} onChange={(event) => onChange({ validTo: event.target.value })} className="min-h-11" min={form.validFrom} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="entitlement-notes">{t("notes")}</Label><Textarea id="entitlement-notes" value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder={t("notesPlaceholder")} rows={4} /></div>
            {editing && <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{t("editingHint", { company: editing.companyName || t("unknownCompany") })}</p>}
          </div>
          <SheetFooter className="sticky bottom-0 gap-2 border-t bg-background p-4">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={saving}>{common("cancel")}</Button>
            <Button type="submit" className="min-h-11 bg-orange-700 text-white hover:bg-orange-800" disabled={saving || hasNoSetupOptions} data-testid="support-entitlement-submit">{saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : editing ? <Save /> : <Plus />}{saving ? t("saving") : editing ? t("saveChanges") : t("createDraftCompact")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function EntitlementDetailSheet({ entitlement, interactionBlocked, permissions, templates, formatDate, t, common, error, errorRetryable, notice, milestoneEditorOpen, milestoneForm, milestoneLoadingKey, onClose, onEdit, onLifecycle, onToggleMilestones, onRetry, onMilestoneChange, onMilestoneReset, onMilestoneSubmit, onTemplateApply, onMilestoneEdit, onMilestoneDelete }: {
  entitlement: Entitlement | null
  interactionBlocked: boolean
  permissions: EntitlementPermissions
  templates: EntitlementTemplate[]
  formatDate: (value: string | null) => string
  t: ReturnType<typeof useTranslations>
  common: ReturnType<typeof useTranslations>
  error: string
  errorRetryable: boolean
  notice: string
  milestoneEditorOpen: boolean
  milestoneForm: MilestoneFormState
  milestoneLoadingKey: string | null
  onClose: () => void
  onEdit: () => void
  onLifecycle: (action: LifecycleAction) => void
  onToggleMilestones: () => void
  onRetry: () => void
  onMilestoneChange: (patch: Partial<MilestoneFormState>) => void
  onMilestoneReset: () => void
  onMilestoneSubmit: () => void
  onTemplateApply: () => void
  onMilestoneEdit: (definition: MilestoneDefinition) => void
  onMilestoneDelete: (definition: MilestoneDefinition) => void
}) {
  if (!entitlement) return null
  const editable = canEditEntitlement(entitlement, permissions)
  const actions = lifecycleActions(entitlement, permissions)
  return (
    <Sheet open onOpenChange={(open) => { if (!open && !interactionBlocked) onClose() }}>
      <SheetContent
        closeLabel={common("close")}
        inert={interactionBlocked ? true : undefined}
        aria-hidden={interactionBlocked ? true : undefined}
        onInteractOutside={(event) => { if (interactionBlocked) event.preventDefault() }}
        className={`!h-[100dvh] !w-full !max-w-none overflow-y-auto p-0 sm:!w-[42rem] sm:!max-w-[94vw] ${interactionBlocked ? "pointer-events-none" : ""}`}
        data-testid="support-entitlement-detail-sheet"
        data-entitlement-id={entitlement.id}
        data-interaction-blocked={interactionBlocked ? "true" : "false"}
      >
        <SheetHeader className="border-b px-4 pb-3 pr-16 pt-4">
          <SheetTitle>{entitlement.companyName || t("unknownCompany")}</SheetTitle>
          <SheetDescription>{t("detailDescription")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="support-entitlement-detail-error"><AlertCircle className="h-4 w-4 shrink-0 text-destructive" /><span className="min-w-0 flex-1">{error}</span>{errorRetryable && <Button variant="outline" className="min-h-11" onClick={onRetry} data-testid="support-entitlement-detail-retry"><RotateCcw />{t("retry")}</Button>}</div>}
          {notice && <div aria-live="polite" className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
          <div className="flex flex-wrap items-center gap-2"><SupportLevelBadge level={entitlement.supportLevel} t={t} /><StatusBadge status={entitlement.status} t={t} /><HealthLabel entitlement={entitlement} t={t} /></div>
          <dl className="grid gap-x-4 gap-y-3 border-y py-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">{t("slaPolicy")}</dt><dd className="mt-0.5 font-medium">{entitlement.slaPolicyName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("valid")}</dt><dd className="mt-0.5 tabular-nums">{formatDate(entitlement.validFrom)} – {entitlement.validTo ? formatDate(entitlement.validTo) : t("open")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("milestoneDefs")}</dt><dd className="mt-0.5 font-medium">{entitlement.definitionCount}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("milestoneHealth")}</dt><dd className="mt-0.5"><HealthLabel entitlement={entitlement} t={t} /></dd></div>
          </dl>
          <MilestoneSummary entitlement={entitlement} t={t} />
          {entitlement.notes && <section><h3 className="text-sm font-semibold">{t("notes")}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{entitlement.notes}</p></section>}
          {(editable || actions.length > 0) && (
            <section aria-label={t("lifecycleActionsLabel")} className="flex flex-wrap gap-2 border-t pt-4">
              {editable && <Button variant="outline" className="min-h-11" onClick={onEdit} data-testid="support-entitlement-edit"><Pencil />{t("edit")}</Button>}
              {actions.map((action) => <Button key={action} variant={action === "cancel" || action === "expire" ? "outline" : "secondary"} className="min-h-11" onClick={() => onLifecycle(action)} disabled={(action === "activate" || action === "resume") && entitlement.definitionCount === 0} data-testid={`support-entitlement-lifecycle-${action}`}>{t(`actions.${action}`)}</Button>)}
              {entitlement.definitionCount === 0 && actions.some((action) => action === "activate" || action === "resume") && <p className="basis-full text-xs text-muted-foreground">{t("activationNeedsRules")}</p>}
            </section>
          )}
          <section className="border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold">{t("milestoneConstructorTitle")}</h3><p className="mt-0.5 text-xs text-muted-foreground">{t("milestoneCount", { count: entitlement.definitionCount })}</p></div>
              {editable && <Button variant="outline" className="min-h-11" onClick={onToggleMilestones} data-testid="support-entitlement-manage-milestones"><Settings2 />{milestoneEditorOpen ? t("closeMilestoneEditor") : t("manageMilestones")}</Button>}
            </div>
            {milestoneEditorOpen && editable && (
              <MilestoneEditor
                entitlement={entitlement}
                templates={templates}
                form={milestoneForm}
                loadingKey={milestoneLoadingKey}
                t={t}
                onChange={onMilestoneChange}
                onReset={onMilestoneReset}
                onSubmit={onMilestoneSubmit}
                onTemplateApply={onTemplateApply}
                onEdit={onMilestoneEdit}
                onDelete={onMilestoneDelete}
              />
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MilestoneSummary({ entitlement, t }: { entitlement: Entitlement; t: ReturnType<typeof useTranslations> }) {
  return (
    <section aria-label={t("milestoneSummaryLabel")} data-testid="support-entitlement-milestone-summary">
      {entitlement.definitions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noMilestoneRules")}</p> : (
        <div className="divide-y rounded-lg border">
          {entitlement.definitions.map((definition) => (
            <div key={definition.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{definition.name}</p><p className="truncate text-xs text-muted-foreground">{t.has(`milestoneTypes.${definition.type}`) ? t(`milestoneTypes.${definition.type}`) : t("unknownMilestone")} · {t.has(`severityScopes.${definition.severityTier ?? "all"}`) ? t(`severityScopes.${definition.severityTier ?? "all"}`) : t("unknownSeverity")}</p></div>
              <span className="shrink-0 text-xs tabular-nums">{formatDueWindow(definition.dueWithinSeconds, t)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MilestoneEditor({ entitlement, templates, form, loadingKey, t, onChange, onReset, onSubmit, onTemplateApply, onEdit, onDelete }: {
  entitlement: Entitlement
  templates: EntitlementTemplate[]
  form: MilestoneFormState
  loadingKey: string | null
  t: ReturnType<typeof useTranslations>
  onChange: (patch: Partial<MilestoneFormState>) => void
  onReset: () => void
  onSubmit: () => void
  onTemplateApply: () => void
  onEdit: (definition: MilestoneDefinition) => void
  onDelete: (definition: MilestoneDefinition) => void
}) {
  const selectedTemplate = templates.find((template) => template.supportLevel === form.template)
  const templateUnavailable = !selectedTemplate?.isActive || !selectedTemplate.definitions.length
  const editing = Boolean(form.editingDefinitionId)
  return (
    <div className="mt-4 space-y-4 rounded-xl border bg-muted/10 p-3" data-testid="support-entitlement-milestone-editor">
      {entitlement.definitions.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select label={t("template")} value={form.template} onChange={(event) => onChange({ template: asSupportLevel(event.target.value) })} className="min-h-11">{SUPPORT_LEVELS.map((level) => <option key={level} value={level}>{t(`supportLevels.${level}`)}</option>)}</Select>
          <Button type="button" variant="outline" className="min-h-11 self-end" onClick={onTemplateApply} disabled={loadingKey === "template" || templateUnavailable}>{loadingKey === "template" ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Copy />}{t("applyTemplate", { count: selectedTemplate?.definitions.length ?? 0, level: t(`supportLevels.${form.template}`) })}</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="milestone-name">{t("milestoneName")}</Label><Input id="milestone-name" value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={t(`milestoneTypes.${form.type}`)} className="min-h-11" /></div>
        <Select label={t("milestoneType")} value={form.type} onChange={(event) => onChange({ type: event.target.value as MilestoneType, name: "" })} disabled={editing} className="min-h-11" data-testid="support-entitlement-milestone-type">{MILESTONE_TYPES.map((type) => <option key={type} value={type}>{t(`milestoneTypes.${type}`)}</option>)}</Select>
        <Select label={t("severity")} value={form.severityTier} onChange={(event) => onChange({ severityTier: event.target.value as MilestoneSeverityScope })} disabled={editing} className="min-h-11" data-testid="support-entitlement-milestone-severity">{MILESTONE_SEVERITY_SCOPES.map((severity) => <option key={severity} value={severity}>{t(`severityScopes.${severity}`)}</option>)}</Select>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
          <div className="space-y-1"><Label htmlFor="milestone-due">{t("dueWindow")}</Label><Input id="milestone-due" type="number" min="1" value={form.dueValue} onChange={(event) => onChange({ dueValue: event.target.value })} className="min-h-11" /></div>
          <Select label={t("dueUnit")} value={form.dueUnit} onChange={(event) => onChange({ dueUnit: event.target.value as DueWindowUnit })} className="min-h-11"><option value="minutes">{t("dueUnits.minutes")}</option><option value="hours">{t("dueUnits.hours")}</option><option value="days">{t("dueUnits.days")}</option></Select>
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.isRequired} onChange={(event) => onChange({ isRequired: event.target.checked })} className="h-4 w-4" />{t("requiredMilestone")}</label>
      <div className="flex flex-wrap justify-end gap-2">{editing && <Button type="button" variant="ghost" className="min-h-11" onClick={onReset}>{t("cancelEdit")}</Button>}<Button type="button" className="min-h-11 bg-orange-700 text-white hover:bg-orange-800" onClick={onSubmit} disabled={loadingKey === "save"} data-testid="support-entitlement-milestone-submit">{loadingKey === "save" ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : editing ? <Save /> : <Plus />}{editing ? t("saveMilestone") : t("addMilestone")}</Button></div>
      {entitlement.definitions.length > 0 && (
        <div className="divide-y border-t pt-2">
          {entitlement.definitions.map((definition) => <div key={definition.id} className="flex items-center gap-2 py-2" data-testid="support-entitlement-milestone-row" data-milestone-id={definition.id}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{definition.name}</p><p className="truncate text-xs text-muted-foreground">{formatDueWindow(definition.dueWithinSeconds, t)} · {definition.isRequired ? t("required") : t("optional")}</p></div><Button type="button" variant="ghost" className="min-h-11" onClick={() => onEdit(definition)} data-testid={`support-entitlement-milestone-edit-${definition.id}`}><Pencil />{t("edit")}</Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("deleteMilestoneNamed", { name: definition.name })} onClick={() => onDelete(definition)} disabled={loadingKey === `delete:${definition.id}`} data-testid={`support-entitlement-milestone-delete-${definition.id}`}><Trash2 /></Button></div>)}
        </div>
      )}
      <Button asChild variant="ghost" className="min-h-11"><Link href="/settings/entitlement-templates"><Settings2 />{t("editTemplates")}</Link></Button>
    </div>
  )
}

function LifecycleDialog({ target, reason, error, loading, t, common, onReasonChange, onClose, onConfirm }: {
  target: LifecycleTarget | null
  reason: string
  error: string
  loading: boolean
  t: ReturnType<typeof useTranslations>
  common: ReturnType<typeof useTranslations>
  onReasonChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  if (!target) return null
  const required = target.action === "cancel"
  return createPortal(
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} mobileFullscreen widthClassName="max-w-lg">
      <DialogHeader><DialogTitle>{t("lifecycleDialogTitle", { action: t(`actions.${target.action}`) })}</DialogTitle><DialogDescription>{t("lifecycleCurrentState", { company: target.entitlement.companyName || t("unknownCompany"), status: t(`statuses.${target.entitlement.status}`) })}</DialogDescription></DialogHeader>
      <DialogContent>
        <div className="space-y-4" data-testid="support-entitlement-lifecycle-dialog" data-action={target.action}>
          {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="support-entitlement-lifecycle-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{error}</div>}
          <section className="rounded-lg border bg-muted/20 p-3 text-sm"><h3 className="font-medium">{t("lifecycleImpactTitle")}</h3><p className="mt-1 text-muted-foreground">{t(`lifecycleImpact.${target.action}`, { company: target.entitlement.companyName || t("unknownCompany") })}</p></section>
          <div className="space-y-1"><Label htmlFor="lifecycle-reason">{required ? t("cancelReasonLabel") : t("lifecycleReasonOptional")}</Label><Textarea id="lifecycle-reason" data-dialog-initial-focus data-testid="support-entitlement-lifecycle-reason" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder={required ? t("cancelReasonPlaceholder") : t("lifecycleReasonPlaceholder")} rows={4} required={required} maxLength={1000} /><p className="text-xs text-muted-foreground">{t("lifecycleAuditHint")}</p></div>
          <p className="text-sm font-medium">{t("lifecycleConfirmQuestion", { action: t(`actions.${target.action}`).toLocaleLowerCase() })}</p>
        </div>
      </DialogContent>
      <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={loading}>{common("cancel")}</Button><Button type="button" variant={target.action === "cancel" || target.action === "expire" ? "destructive" : "default"} className={`min-h-11 ${target.action === "cancel" || target.action === "expire" ? "" : "bg-orange-700 text-white hover:bg-orange-800"}`} onClick={onConfirm} disabled={loading || (required && !reason.trim())} data-testid="support-entitlement-lifecycle-confirm">{loading && <Loader2 className="animate-spin motion-reduce:animate-none" />}{t("confirmLifecycleAction", { action: t(`actions.${target.action}`) })}</Button></DialogFooter>
    </Dialog>,
    document.body,
  )
}
