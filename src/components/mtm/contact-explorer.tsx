"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRightLeft,
  Bookmark,
  Building2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Mail,
  Phone,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { MtmWorkflowGuide } from "@/components/mtm/mtm-workflow-guide"
import {
  ContactTransferDialog,
  type ContactTransferAgent,
} from "@/components/mtm/contact-transfer-dialog"
import { ContactTransferReceiptPanel } from "@/components/mtm/contact-transfer-receipt-panel"
import { ContactAssignmentDialog } from "@/components/mtm/contact-assignment-dialog"
import {
  applyContactTransferReconciliation,
  loadContactTransferReceipt,
  removeContactTransferReceipt,
  saveContactTransferReceipt,
  type ContactTransferReceipt,
  type ContactTransferReconciliation,
} from "@/lib/mtm/contact-transfer-receipt"
import {
  contactExplorerStateFromSearchParams,
  contactQuery,
  contactSavedViewFilters,
  contactSavedViewState,
  EMPTY_CONTACT_FILTERS,
  MTM_CONTACT_BULK_LIMIT,
  MTM_CONTACT_DEFAULT_COLUMNS,
  MTM_CONTACT_PAGE_SIZES,
  type ContactExplorerFilters,
} from "@/lib/mtm/contact-explorer"
import {
  appendMtmRouteAssignmentHandoff,
  mtmRouteAssignmentHandoffFromSearchParams,
} from "@/lib/mtm/route-links"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { createDateFormatter, type DateFormatter } from "@/lib/format-date"

type ContactAssignment = {
  id: string
  role: string
  agent: ContactTransferAgent
}

type ContactWorkplace = {
  id: string
  isPrimary: boolean
  customer: {
    id: string
    code: string | null
    name: string
    objectType: string
    category: string
    address: string | null
    city: string | null
    district: string | null
  }
}

type ContactRow = {
  id: string
  externalCode: string | null
  displayName: string
  type: string
  status: string
  specialtyCode: string | null
  specialtyName: string | null
  qualificationCategory: string | null
  profile: string | null
  category: string
  phone: string | null
  mobilePhone: string | null
  workPhone: string | null
  whatsappPhone: string | null
  email: string | null
  verificationStatus: string
  workplaces: ContactWorkplace[]
  agentAssignments: ContactAssignment[]
  visits: Array<{
    id: string
    status: string
    checkInAt: string
    checkOutAt: string | null
    outcome: string | null
  }>
  routePoints: Array<{
    id: string
    routeId: string
    plannedTime: string | null
    orderIndex: number
    route: {
      date: string
      status: string
    }
  }>
  coverage: ContactCoverage
}

type ContactCoverage = {
  available: boolean
  state: string
  period: { key: string; start: string; end: string }
  groupKey?: string
  groupLabel?: string
  requiredCoverage?: string
  actualMoi?: string
  target?: string
  actualCoverage?: string
  uncoveredMoi?: string
  explanation?: { summary: { ru: string; az: string; en: string } }
  policy?: { version: number; approvalReference: string | null } | null
  snapshot?: { id: string; frozenAt: string | null }
}

type ContactPayload = {
  contacts: ContactRow[]
  total: number
  page: number
  limit: number
  asOf: string
  timezone: string
  coveragePeriod: { key: string; start: string; end: string }
  transferSyncScopeKey: string
  availableAgents: ContactTransferAgent[]
  capabilities: {
    canManage: boolean
    canRequestChanges: boolean
    canTransfer: boolean
    actorAgentId: string | null
    actorRole: string
  }
}

type ContactFacets = {
  specialtyCodes: string[]
  profiles: string[]
  qualificationCategories: string[]
  regions: string[]
  administrativeDistricts: string[]
  localities: string[]
  cityDistricts: string[]
  organizationKinds: string[]
  objectTypes: string[]
  asOf: string
}

type ContactSavedView = {
  id: string
  name: string
  filters: unknown
  isDefault: boolean
  isShared: boolean
  canDelete: boolean
}

const ADVANCED_FILTER_KEYS: (keyof ContactExplorerFilters)[] = [
  "specialtyCode",
  "profile",
  "qualificationCategory",
  "region",
  "administrativeDistrict",
  "locality",
  "cityDistrict",
  "organizationKind",
  "objectType",
  "coveragePeriod",
]

const COVERAGE_STATE_KEYS = new Set([
  "COVERED",
  "GAP",
  "NOT_APPLICABLE",
  "NO_OWNER",
  "UNSIGNED_COVERAGE_POLICY",
  "COVERAGE_POLICY_SIGNATURE_INVALID",
  "NO_COVERAGE_SNAPSHOT",
  "COVERAGE_SNAPSHOT_INCOMPLETE",
  "NOT_IN_SNAPSHOT",
  "COVERAGE_ROW_INVALID",
  "COVERAGE_ROW_EXPLANATION_INVALID",
])

function FieldCheckbox({
  checked,
  indeterminate = false,
  label,
  testId,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  testId?: string
  onChange: (checked: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center md:min-h-9 md:min-w-9">
      <span className="sr-only">{label}</span>
      <input
        data-testid={testId}
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </label>
  )
}

function statusVariant(status: string): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success"
  if (status === "PROSPECT") return "warning"
  return "outline"
}

export function MtmContactExplorer() {
  const t = useTranslations("mtmContactExplorer")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initial = useMemo(() => contactExplorerStateFromSearchParams(new URLSearchParams(searchParams.toString())), []) // eslint-disable-line react-hooks/exhaustive-deps
  const routeAssignmentHandoff = useMemo(
    () => mtmRouteAssignmentHandoffFromSearchParams(searchParams),
    [searchParams],
  )
  const isRouteDoctorFlow = routeAssignmentHandoff?.direction === "DOCTOR"
  const [filters, setFilters] = useState<ContactExplorerFilters>(initial.filters)
  const [searchDraft, setSearchDraft] = useState(initial.filters.search)
  const [page, setPage] = useState(initial.page)
  const [limit, setLimit] = useState(initial.limit)
  const [payload, setPayload] = useState<ContactPayload | null>(null)
  const [facets, setFacets] = useState<ContactFacets | null>(null)
  const [facetsError, setFacetsError] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectingAll, setSelectingAll] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentMode, setAssignmentMode] = useState<"ASSIGN" | "UNASSIGN">("ASSIGN")
  const [refreshKey, setRefreshKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(
    ADVANCED_FILTER_KEYS.some((key) => Boolean(initial.filters[key])),
  )
  const [savedViews, setSavedViews] = useState<ContactSavedView[]>([])
  const [activeSavedViewId, setActiveSavedViewId] = useState("")
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [savedViewName, setSavedViewName] = useState("")
  const [savedViewDefault, setSavedViewDefault] = useState(false)
  const [savedViewsBusy, setSavedViewsBusy] = useState(false)
  const [transferReceipt, setTransferReceipt] = useState<ContactTransferReceipt | null>(null)
  const [transferReceiptStored, setTransferReceiptStored] = useState(false)
  const [transferReceiptBusy, setTransferReceiptBusy] = useState(false)
  const [online, setOnline] = useState(true)
  const initialUrlHadState = useRef(searchParams.toString().length > 0)
  const defaultSavedViewApplied = useRef(false)
  const visitDate = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium" }),
    [locale],
  )
  const visitDateTime = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )

  const query = useMemo(() => contactQuery(filters, page, limit), [filters, page, limit])
  const queryString = query.toString()
  const routeAwareQueryString = useMemo(
    () => appendMtmRouteAssignmentHandoff(new URLSearchParams(queryString), routeAssignmentHandoff).toString(),
    [queryString, routeAssignmentHandoff],
  )
  const returnHref = `${pathname}?${routeAwareQueryString}`

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts?${queryString}`, {
        headers: { Accept: "application/json" },
        signal,
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: ContactPayload
      } | null
      if (!response.ok || !body?.success || !body.data) throw new Error(body?.error || t("loadFailed"))
      setPayload(body.data)
      if (body.data.page !== page) setPage(body.data.page)
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return
      setError(loadError instanceof Error ? loadError.message : t("loadFailed"))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, queryString, t])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    setFacetsError("")
    void fetch("/api/v1/mtm/contacts/facets", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as {
          success?: boolean
          error?: string
          data?: ContactFacets
        } | null
        if (!response.ok || !body?.success || !body.data) throw new Error(body?.error || t("facetsLoadFailed"))
        setFacets(body.data)
      })
      .catch((facetsLoadError) => {
        if (facetsLoadError instanceof DOMException && facetsLoadError.name === "AbortError") return
        setFacetsError(facetsLoadError instanceof Error ? facetsLoadError.message : t("facetsLoadFailed"))
      })
    return () => controller.abort()
  }, [refreshKey, t])

  const applySavedView = useCallback((view: ContactSavedView) => {
    const restored = contactSavedViewState(view.filters)
    setFilters(restored.filters)
    setSearchDraft(restored.filters.search)
    setPage(1)
    setLimit(restored.limit)
    setSelected(new Set())
    setActiveSavedViewId(view.id)
    setAdvancedOpen(ADVANCED_FILTER_KEYS.some((key) => Boolean(restored.filters[key])))
  }, [])

  const loadSavedViews = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/v1/mtm/contacts/views", {
      headers: { Accept: "application/json" },
      signal,
    })
    const body = await response.json().catch(() => null) as {
      success?: boolean
      error?: string
      data?: { views: ContactSavedView[] }
    } | null
    if (!response.ok || !body?.success || !body.data) {
      throw new Error(body?.error || t("savedViewsLoadFailed"))
    }
    setSavedViews(body.data.views)
    if (!defaultSavedViewApplied.current && !initialUrlHadState.current) {
      defaultSavedViewApplied.current = true
      const defaultView = body.data.views.find((view) => view.isDefault)
      if (defaultView) applySavedView(defaultView)
    }
  }, [applySavedView, t])

  useEffect(() => {
    const controller = new AbortController()
    void loadSavedViews(controller.signal).catch((savedViewError) => {
      if (savedViewError instanceof DOMException && savedViewError.name === "AbortError") return
      toast.error(savedViewError instanceof Error ? savedViewError.message : t("savedViewsLoadFailed"))
    })
    return () => controller.abort()
  }, [loadSavedViews])

  useEffect(() => {
    router.replace(`${pathname}?${routeAwareQueryString}`, { scroll: false })
  }, [pathname, routeAwareQueryString, router])

  const transferScopeKey = payload?.transferSyncScopeKey ?? ""

  useEffect(() => {
    let active = true
    if (!transferScopeKey) {
      setTransferReceipt(null)
      setTransferReceiptStored(false)
      return () => { active = false }
    }
    void loadContactTransferReceipt(transferScopeKey).then((receipt) => {
      if (active) {
        setTransferReceipt(receipt)
        setTransferReceiptStored(Boolean(receipt))
      }
    })
    return () => { active = false }
  }, [transferScopeKey])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  const verifyTransferReceipt = useCallback(async (
    receipt: ContactTransferReceipt,
    notifyFailure = false,
  ) => {
    if (!navigator.onLine || receipt.scopeKey !== transferScopeKey) return
    setTransferReceiptBusy(true)
    try {
      const params = new URLSearchParams({ operationId: receipt.operationId })
      const response = await fetch(`/api/v1/mtm/contact-transfers?${params}`, {
        headers: { Accept: "application/json" },
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: ContactTransferReconciliation
      } | null
      if (!response.ok || !body?.success || !body.data) {
        throw new Error(body?.error || t("transferReceipt.verifyFailed"))
      }
      const next = applyContactTransferReconciliation(receipt, body.data)
      setTransferReceipt(next)
      const stored = await saveContactTransferReceipt(next)
      if (stored) setTransferReceiptStored(true)
    } catch (verifyError) {
      if (notifyFailure) {
        toast.error(verifyError instanceof Error ? verifyError.message : t("transferReceipt.verifyFailed"))
      }
    } finally {
      setTransferReceiptBusy(false)
    }
  }, [t, transferScopeKey])

  useEffect(() => {
    if (!online || !transferReceipt || transferReceipt.scopeKey !== transferScopeKey) return
    void verifyTransferReceipt(transferReceipt)
  }, [online, transferReceipt?.operationId, transferScopeKey, verifyTransferReceipt]) // eslint-disable-line react-hooks/exhaustive-deps

  const contacts = payload?.contacts ?? []
  const total = payload?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const pageIds = contacts.map((contact) => contact.id)
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length
  const fullPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const selectionScope = selected.size === 0
    ? t("selection.none")
    : selected.size === total && total <= MTM_CONTACT_BULK_LIMIT
      ? t("selection.allFiltered")
      : fullPageSelected && selected.size === pageIds.length
        ? t("selection.currentPage")
        : t("selection.custom")
  const advancedFilterCount = ADVANCED_FILTER_KEYS.filter((key) => Boolean(filters[key])).length
  const routeAssignmentAgent = (payload?.availableAgents ?? []).find((agent) => agent.id === routeAssignmentHandoff?.agentId)

  const updateFilter = (key: keyof ContactExplorerFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    if (key === "search") setSearchDraft(value)
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    updateFilter("search", searchDraft.trim())
  }

  const clearFilters = () => {
    setFilters(EMPTY_CONTACT_FILTERS)
    setSearchDraft("")
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  const saveCurrentView = async () => {
    const name = savedViewName.trim()
    if (!name) {
      toast.error(t("savedViewNameRequired"))
      return
    }
    setSavedViewsBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/contacts/views", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          filters: contactSavedViewFilters(filters, limit),
          columns: [...MTM_CONTACT_DEFAULT_COLUMNS],
          isDefault: savedViewDefault,
        }),
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: { view: ContactSavedView }
      } | null
      if (!response.ok || !body?.success || !body.data) {
        throw new Error(body?.error || t("savedViewSaveFailed"))
      }
      await loadSavedViews()
      setActiveSavedViewId(body.data.view.id)
      setSaveViewOpen(false)
      setSavedViewName("")
      setSavedViewDefault(false)
      toast.success(t("savedViewSaved"))
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : t("savedViewSaveFailed"))
    } finally {
      setSavedViewsBusy(false)
    }
  }

  const deleteActiveSavedView = async () => {
    const active = savedViews.find((view) => view.id === activeSavedViewId)
    if (!active?.canDelete) return
    setSavedViewsBusy(true)
    try {
      const response = await fetch(`/api/v1/mtm/contacts/views/${active.id}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      })
      const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!response.ok || !body?.success) throw new Error(body?.error || t("savedViewDeleteFailed"))
      setActiveSavedViewId("")
      await loadSavedViews()
      toast.success(t("savedViewDeleted"))
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : t("savedViewDeleteFailed"))
    } finally {
      setSavedViewsBusy(false)
    }
  }

  const togglePage = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of pageIds) checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  const toggleContact = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  const selectAllFiltered = async () => {
    if (total > MTM_CONTACT_BULK_LIMIT) {
      toast.error(t("bulkLimit", { count: MTM_CONTACT_BULK_LIMIT }))
      return
    }
    setSelectingAll(true)
    try {
      const allQuery = contactQuery(filters, 1, MTM_CONTACT_BULK_LIMIT)
      const response = await fetch(`/api/v1/mtm/contacts?${allQuery}`, { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: ContactPayload
      } | null
      if (!response.ok || !body?.success || !body.data) throw new Error(body?.error || t("selectAllFailed"))
      if (body.data.total > MTM_CONTACT_BULK_LIMIT) throw new Error(t("bulkLimit", { count: MTM_CONTACT_BULK_LIMIT }))
      setSelected(new Set(body.data.contacts.map((contact) => contact.id)))
    } catch (selectionError) {
      toast.error(selectionError instanceof Error ? selectionError.message : t("selectAllFailed"))
    } finally {
      setSelectingAll(false)
    }
  }

  const openTransfer = () => {
    if (selected.size > MTM_CONTACT_BULK_LIMIT) {
      toast.error(t("bulkLimit", { count: MTM_CONTACT_BULK_LIMIT }))
      return
    }
    if (!filters.ownerAgentId) {
      toast.error(t("transferOwnerRequired"))
      return
    }
    setTransferOpen(true)
  }

  const openAssignment = (mode: "ASSIGN" | "UNASSIGN") => {
    if (selected.size > MTM_CONTACT_BULK_LIMIT) {
      toast.error(t("bulkLimit", { count: MTM_CONTACT_BULK_LIMIT }))
      return
    }
    setAssignmentMode(mode)
    setAssignmentOpen(true)
  }

  const refresh = () => setRefreshKey((key) => key + 1)
  const activeSavedView = savedViews.find((view) => view.id === activeSavedViewId)

  return (
    <div data-testid="mtm-contact-explorer" aria-busy={loading} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <PageDescription icon={UsersRound} title={t("title")} description={t("subtitle")} />
          <HelpButton slug="mtm-contacts" variant="label" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("refresh")}
        </Button>
      </div>

      <MtmWorkflowGuide
        title={t("clarityGuide.title")}
        description={t("clarityGuide.description")}
        steps={[
          { title: t("search"), icon: Search },
          { title: t("workplace"), icon: Building2 },
          { title: t("assignAction"), icon: UserPlus },
        ]}
      />

      {isRouteDoctorFlow && routeAssignmentHandoff ? (
        <section data-testid="mtm-route-assignment-handoff" className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{t("routeFlowTitle")}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("routeFlowDescription", {
                agent: routeAssignmentAgent?.name ?? t("routeFlowEmployeeFallback"),
                date: routeAssignmentHandoff.date,
              })}
            </p>
          </div>
          <Button asChild type="button" variant="outline" className="min-h-11 shrink-0">
            <Link href={routeAssignmentHandoff.returnTo}>{t("routeFlowBack")}</Link>
          </Button>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <details className="group -mx-4 -mt-4 border-b border-zinc-200 dark:border-zinc-700">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium marker:hidden">
            <Bookmark className="h-4 w-4 text-muted-foreground" />
            {t("savedViews")}
            {activeSavedView ? <span className="max-w-[14rem] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary" title={activeSavedView.name}>{activeSavedView.name}</span> : null}
          </summary>
          <div className="flex flex-col gap-3 border-t border-zinc-200 p-4 dark:border-zinc-700 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 sm:max-w-md">
              <Label htmlFor="mtm-contact-saved-view" className="text-xs text-muted-foreground">{t("savedViews")}</Label>
              <Select
                id="mtm-contact-saved-view"
                value={activeSavedViewId}
                onChange={(event) => {
                  const view = savedViews.find((item) => item.id === event.target.value)
                  if (view) applySavedView(view)
                  else setActiveSavedViewId("")
                }}
                className="mt-1.5 min-h-11"
                disabled={savedViewsBusy}
              >
                <option value="">{t("savedViewsPlaceholder")}</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.isDefault ? `★ ${view.name}` : view.name}
                    {view.isShared ? ` · ${t("sharedView")}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              {savedViews.find((view) => view.id === activeSavedViewId)?.canDelete ? (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={savedViewsBusy} onClick={() => void deleteActiveSavedView()}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {t("deleteSavedView")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={savedViewsBusy}
                onClick={() => {
                  setSavedViewName("")
                  setSavedViewDefault(false)
                  setSaveViewOpen(true)
                }}
              >
                <Bookmark className="mr-1.5 h-4 w-4" />
                {t("saveCurrentView")}
              </Button>
            </div>
          </div>
        </details>
        <div className="mt-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("filters")}</h2>
        </div>
        <form onSubmit={submitSearch} className="mt-3 grid gap-3 lg:grid-cols-[minmax(14rem,2fr)_repeat(4,minmax(9rem,1fr))]">
          <div>
            <Label htmlFor="mtm-contact-search" className="text-xs text-muted-foreground">{t("searchLabel")}</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="mtm-contact-search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="min-h-11"
              />
              <Button type="submit" size="icon" className="min-h-11 min-w-11" aria-label={t("search")}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <FilterSelect id="mtm-contact-type" label={t("type")} value={filters.type} onChange={(value) => updateFilter("type", value)}>
            <option value="">{t("all")}</option>
            <option value="DOCTOR">{t("types.DOCTOR")}</option>
            <option value="PHARMACIST">{t("types.PHARMACIST")}</option>
            <option value="OTHER">{t("types.OTHER")}</option>
          </FilterSelect>
          <FilterSelect id="mtm-contact-status" label={t("status")} value={filters.status} onChange={(value) => updateFilter("status", value)}>
            <option value="">{t("all")}</option>
            {["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"].map((status) => (
              <option key={status} value={status}>{t(`statuses.${status}`)}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="mtm-contact-category" label={t("category")} value={filters.category} onChange={(value) => updateFilter("category", value)}>
            <option value="">{t("all")}</option>
            {["A", "B", "C", "D"].map((category) => <option key={category} value={category}>{category}</option>)}
          </FilterSelect>
          <FilterSelect id="mtm-contact-owner" label={t("owner")} value={filters.ownerAgentId} onChange={(value) => updateFilter("ownerAgentId", value)}>
            <option value="">{t("allAccessible")}</option>
            {(payload?.availableAgents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}{agent.status !== "ACTIVE" ? ` · ${t("agentInactive")}` : ""}
              </option>
            ))}
          </FilterSelect>
        </form>
        <div className="mt-3 max-w-xs">
          <FilterSelect id="mtm-contact-assignment-state" label={t("assignmentState")} value={filters.assignmentState} onChange={(value) => updateFilter("assignmentState", value)}>
            <option value="">{t("all")}</option>
            <option value="ASSIGNED">{t("assigned")}</option>
            <option value="UNASSIGNED">{t("unassigned")}</option>
          </FilterSelect>
        </div>
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
            {advancedOpen ? t("hideAdvanced") : t("showAdvanced")}
            {advancedFilterCount > 0 ? (
              <Badge variant="secondary" className="ml-2">{advancedFilterCount}</Badge>
            ) : null}
          </Button>
          {advancedOpen ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <FacetSelect id="mtm-contact-specialty" label={t("specialty")} value={filters.specialtyCode} values={facets?.specialtyCodes ?? []} onChange={(value) => updateFilter("specialtyCode", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-profile" label={t("profile")} value={filters.profile} values={facets?.profiles ?? []} onChange={(value) => updateFilter("profile", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-qualification" label={t("qualificationCategory")} value={filters.qualificationCategory} values={facets?.qualificationCategories ?? []} onChange={(value) => updateFilter("qualificationCategory", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-region" label={t("region")} value={filters.region} values={facets?.regions ?? []} onChange={(value) => updateFilter("region", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-admin-district" label={t("administrativeDistrict")} value={filters.administrativeDistrict} values={facets?.administrativeDistricts ?? []} onChange={(value) => updateFilter("administrativeDistrict", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-locality" label={t("locality")} value={filters.locality} values={facets?.localities ?? []} onChange={(value) => updateFilter("locality", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-city-district" label={t("cityDistrict")} value={filters.cityDistrict} values={facets?.cityDistricts ?? []} onChange={(value) => updateFilter("cityDistrict", value)} allLabel={t("all")} />
              <FacetSelect id="mtm-contact-organization-kind" label={t("organizationKind")} value={filters.organizationKind} values={facets?.organizationKinds ?? []} onChange={(value) => updateFilter("organizationKind", value)} allLabel={t("all")} />
              <FilterSelect id="mtm-contact-object-type" label={t("organizationType")} value={filters.objectType} onChange={(value) => updateFilter("objectType", value)}>
                <option value="">{t("all")}</option>
                {(facets?.objectTypes ?? []).map((value) => (
                  <option key={value} value={value}>{t(`objectTypes.${value}`)}</option>
                ))}
              </FilterSelect>
              <div>
                <Label htmlFor="mtm-contact-coverage-period" className="text-xs text-muted-foreground">{t("coveragePeriod")}</Label>
                <Input
                  id="mtm-contact-coverage-period"
                  type="month"
                  value={filters.coveragePeriod || payload?.coveragePeriod.key || ""}
                  onChange={(event) => updateFilter("coveragePeriod", event.target.value)}
                  className="mt-1.5 min-h-11"
                />
              </div>
            </div>
          ) : null}
          {facetsError ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{facetsError}</p> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <p className="text-xs text-muted-foreground">
            {t("asOf", { date: payload?.asOf ?? "—" })}
            {payload?.coveragePeriod ? ` · ${t("coveragePeriodRange", { start: payload.coveragePeriod.start, end: payload.coveragePeriod.end })}` : ""}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" />
            {t("clearFilters")}
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("found")} value={total} icon={UsersRound} />
        <Stat label={t("selected")} value={selected.size} icon={UserRound} />
        <Stat
          label={t("ownerFilter")}
          value={(payload?.availableAgents ?? []).find((agent) => agent.id === filters.ownerAgentId)?.name || t("allAccessible")}
          icon={Building2}
          text
        />
      </section>

      {transferReceipt ? (
        <ContactTransferReceiptPanel
          receipt={transferReceipt}
          online={online}
          storedOnDevice={transferReceiptStored}
          verifying={transferReceiptBusy}
          onVerify={() => void verifyTransferReceipt(transferReceipt, true)}
          onDismiss={() => {
            const scopeKey = transferReceipt.scopeKey
            setTransferReceipt(null)
            setTransferReceiptStored(false)
            void removeContactTransferReceipt(scopeKey)
          }}
        />
      ) : null}

      {selected.size > 0 ? (
        <section className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-background/95 p-3 shadow-lg backdrop-blur">
          <div>
            <p className="text-sm font-semibold">{t("selectionCount", { count: selected.size })}</p>
            <p className="text-xs text-muted-foreground">{selectionScope} · {t("assignmentBoundary")}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size < total && total <= MTM_CONTACT_BULK_LIMIT ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void selectAllFiltered()} disabled={selectingAll}>
                {selectingAll ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : null}
                {t("selectAllFiltered", { count: total })}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())}>{t("clearSelection")}</Button>
            {payload?.capabilities.canTransfer && isRouteDoctorFlow ? (
              <Button type="button" size="sm" onClick={() => openAssignment("ASSIGN")}>
                <UserPlus className="mr-1 h-4 w-4" />
                {t("routeFlowAssignAndReturn")}
              </Button>
            ) : payload?.capabilities.canTransfer ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => openAssignment("UNASSIGN")}>
                  <UserMinus className="mr-1 h-4 w-4" />
                  {t("unassignAction")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => openAssignment("ASSIGN")}>
                  <UserPlus className="mr-1 h-4 w-4" />
                  {t("assignAction")}
                </Button>
                <Button data-testid="mtm-contact-transfer-open" type="button" size="sm" onClick={openTransfer}>
                  <ArrowRightLeft className="mr-1 h-4 w-4" />
                  {t("transferAction")}
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={refresh}>{t("retry")}</Button>
        </section>
      ) : loading && !payload ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : contacts.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <UsersRound className="mx-auto h-7 w-7 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">{t("emptyTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
        </section>
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                checked={selected.has(contact.id)}
                returnHref={returnHref}
                onCheckedChange={(checked) => toggleContact(contact.id, checked)}
                visitDate={visitDate}
                visitDateTime={visitDateTime}
                t={t}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-card dark:border-zinc-700 lg:block">
            <table className="min-w-[1320px] w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-12">
                    <FieldCheckbox
                      checked={fullPageSelected}
                      indeterminate={selectedOnPage > 0 && !fullPageSelected}
                      label={fullPageSelected ? t("deselectPage") : t("selectPage")}
                      onChange={togglePage}
                    />
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("contact")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("professional")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("coverage")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("workplace")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("visitContext")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("communication")}</th>
                  <th scope="col" className="px-3 py-3 font-medium">{t("owner")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {contacts.map((contact) => {
                  const workplace = contact.workplaces.find((item) => item.isPrimary) ?? contact.workplaces[0]
                  const owner = contact.agentAssignments.find((assignment) => assignment.role === "PRIMARY")?.agent
                  const phone = contact.mobilePhone || contact.phone || contact.workPhone
                  const lastVisit = contact.visits[0]
                  const nextPoint = contact.routePoints[0]
                  return (
                    <tr key={contact.id} className="align-top hover:bg-muted/25">
                      <td>
                        <FieldCheckbox
                          checked={selected.has(contact.id)}
                          label={t("selectContact", { name: contact.displayName })}
                          testId={`mtm-contact-select-${contact.id}`}
                          onChange={(checked) => toggleContact(contact.id, checked)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/mtm/contacts/${contact.id}?returnTo=${encodeURIComponent(returnHref)}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {contact.displayName}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant={statusVariant(contact.status)}>{t(`statuses.${contact.status}`)}</Badge>
                          <Badge variant="outline">{t(`types.${contact.type}`)}</Badge>
                          <Badge variant="outline">{t("categoryShort", { category: contact.category })}</Badge>
                        </div>
                        {contact.externalCode ? <p className="mt-1 text-xs text-muted-foreground">{contact.externalCode}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{contact.specialtyName || contact.specialtyCode || "—"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[contact.profile, contact.qualificationCategory].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <ContactCoverageCell coverage={contact.coverage} t={t} />
                      </td>
                      <td className="px-3 py-3">
                        {workplace ? (
                          <>
                            <Link
                              href={`/mtm/customers/${workplace.customer.id}?returnTo=${encodeURIComponent(returnHref)}`}
                              className="font-medium hover:text-primary hover:underline"
                            >
                              {workplace.customer.name}
                            </Link>
                            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                              {[workplace.customer.city, workplace.customer.address].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </>
                        ) : <span className="text-muted-foreground">{t("noWorkplace")}</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1.5 text-xs">
                          <p>
                            <span className="text-muted-foreground">{t("lastVisit")}:</span>{" "}
                            {lastVisit ? (
                              <Link href={`/mtm/visits?visitId=${lastVisit.id}`} className="font-medium hover:text-primary hover:underline">
                                {visitDate.format(new Date(lastVisit.checkInAt))}
                              </Link>
                            ) : t("noVisitHistory")}
                          </p>
                          <p>
                            <span className="text-muted-foreground">{t("nextVisit")}:</span>{" "}
                            {nextPoint ? (
                              <Link href={`/mtm/routes?routeId=${nextPoint.routeId}`} className="font-medium hover:text-primary hover:underline">
                                {nextPoint.plannedTime
                                  ? visitDateTime.format(new Date(nextPoint.plannedTime))
                                  : visitDate.format(new Date(nextPoint.route.date))}
                              </Link>
                            ) : t("notPlanned")}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1.5 hover:text-primary"><Phone className="h-3.5 w-3.5" />{phone}</a> : null}
                        {contact.email ? <a href={`mailto:${contact.email}`} className="mt-1 flex items-center gap-1.5 hover:text-primary"><Mail className="h-3.5 w-3.5" />{contact.email}</a> : null}
                        {!phone && !contact.email ? <span className="text-muted-foreground">—</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        {owner ? (
                          <>
                            <p className="font-medium">{owner.name}</p>
                            {owner.status !== "ACTIVE" ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("agentInactive")}</p> : null}
                          </>
                        ) : <span className="text-muted-foreground">{t("unassigned")}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-card px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <Label htmlFor="mtm-contact-page-size" className="text-xs text-muted-foreground">{t("rowsPerPage")}</Label>
          <Select
            id="mtm-contact-page-size"
            value={String(limit)}
            onChange={(event) => {
              setLimit(Number(event.target.value))
              setPage(1)
              setSelected(new Set())
              setActiveSavedViewId("")
            }}
            className="h-9 w-20"
          >
            {MTM_CONTACT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{t("pageOf", { page, pages: pageCount })}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} aria-label={t("previousPage")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || loading} aria-label={t("nextPage")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <ContactTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        contactIds={[...selected]}
        sourceAgentId={filters.ownerAgentId}
        agents={payload?.availableAgents ?? []}
        asOf={payload?.asOf ?? ""}
        syncScopeKey={payload?.transferSyncScopeKey ?? ""}
        onCompleted={(receipt, storedOnDevice) => {
          setTransferReceipt(receipt)
          setTransferReceiptStored(storedOnDevice)
          if (!storedOnDevice) toast.warning(t("transferReceipt.storageFailed"))
          setSelected(new Set())
          refresh()
        }}
      />
      <ContactAssignmentDialog
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        mode={assignmentMode}
        contactIds={[...selected]}
        agents={payload?.availableAgents ?? []}
        asOf={payload?.asOf ?? ""}
        initialTargetAgentId={isRouteDoctorFlow ? routeAssignmentHandoff?.agentId : undefined}
        defaultReason={isRouteDoctorFlow ? t("routeFlowAssignmentReason") : undefined}
        onCompleted={(result) => {
          setSelected(new Set())
          refresh()
          if (isRouteDoctorFlow && assignmentMode === "ASSIGN" && result.summary.changed > 0 && routeAssignmentHandoff) {
            toast.success(t("routeFlowReturningToRoute", { count: result.summary.changed }))
            router.push(routeAssignmentHandoff.returnTo)
          }
        }}
      />
      <Dialog
        open={saveViewOpen}
        onOpenChange={(open) => {
          if (!savedViewsBusy) setSaveViewOpen(open)
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("saveViewTitle")}</DialogTitle>
          <DialogDescription>{t("saveViewDescription")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mtm-contact-saved-view-name">{t("savedViewName")}</Label>
            <Input
              id="mtm-contact-saved-view-name"
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
              maxLength={80}
              autoFocus
              placeholder={t("savedViewNamePlaceholder")}
              className="min-h-11"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 dark:border-zinc-700">
            <input
              type="checkbox"
              checked={savedViewDefault}
              onChange={(event) => setSavedViewDefault(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-primary"
            />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("makeDefaultView")}</span>
              <span className="text-xs text-muted-foreground">{t("makeDefaultViewHint")}</span>
            </span>
          </label>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={savedViewsBusy} onClick={() => setSaveViewOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={savedViewsBusy} onClick={() => void saveCurrentView()}>
            {savedViewsBusy ? t("savingView") : t("saveView")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 min-h-11">
        {children}
      </Select>
    </div>
  )
}

function FacetSelect({
  id,
  label,
  value,
  values,
  allLabel,
  onChange,
}: {
  id: string
  label: string
  value: string
  values: string[]
  allLabel: string
  onChange: (value: string) => void
}) {
  return (
    <FilterSelect id={id} label={label} value={value} onChange={onChange}>
      <option value="">{allLabel}</option>
      {values.map((option) => <option key={option} value={option}>{option}</option>)}
    </FilterSelect>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  text = false,
}: {
  label: string
  value: number | string
  icon: typeof UsersRound
  text?: boolean
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`mt-2 font-semibold ${text ? "truncate text-sm" : "text-2xl tabular-nums"}`}>{value}</p>
    </div>
  )
}

function ContactCard({
  contact,
  checked,
  returnHref,
  onCheckedChange,
  visitDate,
  visitDateTime,
  t,
}: {
  contact: ContactRow
  checked: boolean
  returnHref: string
  onCheckedChange: (checked: boolean) => void
  visitDate: DateFormatter
  visitDateTime: DateFormatter
  t: ReturnType<typeof useTranslations>
}) {
  const workplace = contact.workplaces.find((item) => item.isPrimary) ?? contact.workplaces[0]
  const owner = contact.agentAssignments.find((assignment) => assignment.role === "PRIMARY")?.agent
  const phone = contact.mobilePhone || contact.phone || contact.workPhone
  const lastVisit = contact.visits[0]
  const nextPoint = contact.routePoints[0]
  return (
    <article className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="flex items-start gap-3">
        <FieldCheckbox
          checked={checked}
          label={t("selectContact", { name: contact.displayName })}
          testId={`mtm-contact-select-${contact.id}`}
          onChange={onCheckedChange}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/mtm/contacts/${contact.id}?returnTo=${encodeURIComponent(returnHref)}`}
            className="text-base font-semibold text-primary hover:underline"
          >
            {contact.displayName}
          </Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={statusVariant(contact.status)}>{t(`statuses.${contact.status}`)}</Badge>
            <Badge variant="outline">{t(`types.${contact.type}`)}</Badge>
            <Badge variant="outline">{t("categoryShort", { category: contact.category })}</Badge>
          </div>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("professional")}</dt>
          <dd className="mt-1">{contact.specialtyName || contact.specialtyCode || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("owner")}</dt>
          <dd className="mt-1">{owner?.name || t("unassigned")}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{t("coverage")}</dt>
          <dd className="mt-1"><ContactCoverageCell coverage={contact.coverage} t={t} /></dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{t("workplace")}</dt>
          <dd className="mt-1">
            {workplace ? (
              <Link href={`/mtm/customers/${workplace.customer.id}?returnTo=${encodeURIComponent(returnHref)}`} className="hover:text-primary hover:underline">
                {workplace.customer.name}
              </Link>
            ) : t("noWorkplace")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("lastVisit")}</dt>
          <dd className="mt-1">
            {lastVisit ? (
              <Link href={`/mtm/visits?visitId=${lastVisit.id}`} className="hover:text-primary hover:underline">
                {visitDate.format(new Date(lastVisit.checkInAt))}
              </Link>
            ) : t("noVisitHistory")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("nextVisit")}</dt>
          <dd className="mt-1">
            {nextPoint ? (
              <Link href={`/mtm/routes?routeId=${nextPoint.routeId}`} className="hover:text-primary hover:underline">
                {nextPoint.plannedTime
                  ? visitDateTime.format(new Date(nextPoint.plannedTime))
                  : visitDate.format(new Date(nextPoint.route.date))}
              </Link>
            ) : t("notPlanned")}
          </dd>
        </div>
      </dl>
      {(phone || contact.email) ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          {phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone className="mr-1 h-4 w-4" />{t("call")}</a></Button> : null}
          {contact.email ? <Button asChild variant="outline" size="sm"><a href={`mailto:${contact.email}`}><Mail className="mr-1 h-4 w-4" />{t("email")}</a></Button> : null}
        </div>
      ) : null}
    </article>
  )
}

function ContactCoverageCell({
  coverage,
  t,
}: {
  coverage: ContactCoverage
  t: ReturnType<typeof useTranslations>
}) {
  const stateKey = COVERAGE_STATE_KEYS.has(coverage.state) ? coverage.state : "UNAVAILABLE"
  const variant = coverage.state === "COVERED"
    ? "success"
    : coverage.state === "GAP"
      ? "warning"
      : "outline"
  const proof = coverage.policy
    ? t("coverageProof", {
        version: coverage.policy.version,
        approval: coverage.policy.approvalReference || t("coverageApprovalMissing"),
      })
    : null
  return (
    <div className="max-w-56">
      <Badge variant={variant}>{t(`coverageStates.${stateKey}`)}</Badge>
      {coverage.available ? (
        <>
          <p className="mt-1.5 text-xs font-medium">
            {t("coverageValues", {
              actual: coverage.actualCoverage ?? "0",
              required: coverage.requiredCoverage ?? "0",
            })}
          </p>
          {coverage.state === "GAP" ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {t("coverageGap", { value: coverage.uncoveredMoi ?? "0" })}
            </p>
          ) : null}
          {coverage.groupLabel ? <p className="mt-1 text-xs text-muted-foreground">{coverage.groupLabel}</p> : null}
        </>
      ) : null}
      {proof ? <p className="mt-1 text-[11px] text-muted-foreground" title={proof}>{proof}</p> : null}
    </div>
  )
}
