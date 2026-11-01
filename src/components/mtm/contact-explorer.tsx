"use client"

import { Hint, HintValue } from "@/components/hint"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRightLeft,
  Bookmark,
  CalendarPlus,
  Info,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  UsersRound,
} from "lucide-react"
import { openRowOnClick } from "@/lib/client/open-row"
import { toast } from "sonner"
import { MtmPageTitle } from "@/components/mtm/page-header"
import { HelpButton } from "@/components/help/help-button"
import {
  ContactTransferDialog,
  type ContactTransferAgent,
} from "@/components/mtm/contact-transfer-dialog"
import { ContactTransferReceiptPanel } from "@/components/mtm/contact-transfer-receipt-panel"
import {
  MtmFilterActions,
  MtmFilterDateField,
  MtmFilterGrid,
  MtmFilterMore,
  MtmFilterMultiField,
  MtmFilterReset,
  MtmFilterSelect,
  MtmFilterSearch,
  MtmFilterSelectField,
  MtmFilterTextField,
  MtmQuickChips,
  MtmResultLine,
  type MtmQuickChip,
} from "@/components/mtm/filter-bar"
import { MtmContactClassTag } from "@/components/mtm/contact-class-tag"
import { ContactAssignmentDialog } from "@/components/mtm/contact-assignment-dialog"
import { MtmContactCreateDialog } from "@/components/mtm/contact-create-dialog"
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
  contactFilterIsActive,
  contactQuery,
  contactSavedViewFilters,
  contactSavedViewState,
  EMPTY_CONTACT_FILTERS,
  MTM_CONTACT_BULK_LIMIT,
  MTM_CONTACT_DEFAULT_COLUMNS,
  MTM_CONTACT_PAGE_SIZES,
  type ContactExplorerFilters,
  type ContactTextFilterKey,
} from "@/lib/mtm/contact-explorer"
import {
  appendMtmRouteAssignmentHandoff,
  mtmRouteAssignmentHandoffFromSearchParams,
  mtmRoutePlanPageHref,
} from "@/lib/mtm/route-links"
import type { MtmClientQuickCounts } from "@/lib/mtm/client-list-quick"
import {
  effectiveContactCategoryCode,
  LEGACY_CONTACT_TYPES,
  localizedContactCategoryLabel,
  type ContactCategoryLabels,
} from "@/lib/mtm/contact-category-editor"
import { contactFieldVisibility, type MtmContactSwitchableField } from "@/lib/mtm/contact-field-visibility"
import { mtmApiErrorKey } from "@/lib/mtm/api-error-message"
import { contactClassOptions } from "@/lib/mtm/contact-classes"
import { contactListStateInUrl } from "@/lib/mtm/contact-create-request-link"
import { Badge } from "@/components/mtm/mtm-badge"
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
import { createDateFormatter, formatDate, type DateFormatter } from "@/lib/format-date"

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
  /** The assigned client category; null means "shown under the built-in type". */
  categoryCode: string | null
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
    agent?: { id: string; name: string } | null
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
  /** The chip in force, the month «без визита» is about, and how many each chip holds. */
  quick?: { filter: string | null; month: string; counts: MtmClientQuickCounts | null }
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
  /** The tenant's specialty list, then specialties contacts carry beyond it. */
  specialties?: string[]
  configuredSpecialties?: string[]
  /** The classes this tenant grades clients with (A, B, C, VIP…). */
  classes?: string[]
  /** Client fields this tenant switched off in MTM settings. */
  hiddenFields?: string[]
  profiles: string[]
  qualificationCategories: string[]
  regions: string[]
  administrativeDistricts: string[]
  localities: string[]
  cityDistricts: string[]
  organizationKinds: string[]
  objectTypes: string[]
  categories?: Array<{ code: string; labels: ContactCategoryLabels }>
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

/**
 * The named fields. On the Clients page all of them are behind «Ещё фильтры»
 * and the page opens on the search and the chips (owner, 2026-10-16, from a
 * picture: the first client was below the screen). An employee's own section
 * keeps the eight everyday fields in sight and the rest behind «Ещё».
 */
const PAGE_FIELD_KEYS: (keyof ContactExplorerFilters)[] = [
  "ownerAgentId",
  "specialties",
  "name",
  "address",
  "area",
  "workplace",
  "type",
  "status",
]
const ADVANCED_FILTER_KEYS: (keyof ContactExplorerFilters)[] = [
  "search",
  "assignmentState",
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

/** What each chip holds, under the cursor. */
const QUICK_HINT = {
  "": "hint.quickAll",
  NOT_VISITED: "hint.quickNotVisited",
  NOT_PLANNED: "hint.quickNotPlanned",
  UNASSIGNED: "hint.quickUnassigned",
} as const

/** On the Clients page: every named field — the search box is on the page itself. */
const FIELD_KEYS_BEHIND_MORE = [...PAGE_FIELD_KEYS, ...ADVANCED_FILTER_KEYS.filter((key) => key !== "search")]

/** States that say the tenant has no visit norms yet, not something about this client. */
const COVERAGE_WITHOUT_NORMS = new Set(["UNSIGNED_COVERAGE_POLICY", "NOT_APPLICABLE", "NO_OWNER"])

/** «Seymur Məmmədov» → «Seymur M.»: who was there, in a narrow column. */
function shortPersonName(name: string): string {
  const [first, second] = name.trim().split(/\s+/)
  return second ? `${first} ${second.charAt(0)}.` : name.trim()
}

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

type FieldVisibility = (field: MtmContactSwitchableField) => boolean

/** The first phone the tenant still shows: mobile, main, then work. */
function visiblePhone(contact: Pick<ContactRow, "mobilePhone" | "phone" | "workPhone">, shows: FieldVisibility): string | null {
  return (shows("mobilePhone") && contact.mobilePhone)
    || (shows("phone") && contact.phone)
    || (shows("workPhone") && contact.workPhone)
    || null
}

function specialtyLine(contact: Pick<ContactRow, "specialtyName" | "specialtyCode">, shows: FieldVisibility): string | null {
  return (shows("specialtyName") && contact.specialtyName)
    || (shows("specialtyCode") && contact.specialtyCode)
    || null
}

function statusVariant(status: string): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success"
  if (status === "PROSPECT") return "warning"
  return "outline"
}

/**
 * The explorer inside one employee's own section (/mtm/agents/[id]).
 * "assigned" lists that employee's clients and offers to detach or hand them
 * over; "candidates" lists everyone else so clients can be attached to them.
 * Saved views, the URL state and the route hand-off belong to the Clients
 * page and are switched off here.
 */
export type MtmContactExplorerAgentScope = {
  agent: ContactTransferAgent
  view: "assigned" | "candidates"
  /** Where a client or organization card opened from here returns to. */
  returnHref: string
  onTotal?: (total: number) => void
  onChanged?: () => void
}

/** «Nobody's clients» in the attach tab's «whose clients» field; an agent id otherwise. */
const WHOSE_NOBODY = "__nobody__"

function scopeBaseFilters(scope: MtmContactExplorerAgentScope | undefined): ContactExplorerFilters {
  if (!scope) return EMPTY_CONTACT_FILTERS
  // Attaching opens on every client the employee does not have yet (owner,
  // 2026-10-06: «нужно, чтобы были все клиенты, но в списке уже было указано,
  // какому агенту привязан клиент»). It used to open on clients nobody had —
  // an empty list wherever every client already had someone.
  return scope.view === "assigned"
    ? { ...EMPTY_CONTACT_FILTERS, specialties: [], ownerAgentId: scope.agent.id }
    : { ...EMPTY_CONTACT_FILTERS, specialties: [] }
}

export function MtmContactExplorer({ agentScope }: { agentScope?: MtmContactExplorerAgentScope } = {}) {
  const t = useTranslations("mtmContactExplorer")
  const tf = useTranslations("mtmFilters")
  const tApi = useTranslations("mtmApiErrors")
  // A refusal the API explains by `code` is shown in the reader's language; the
  // server's English `error` ("Forbidden") is the fallback, not the message.
  const refusalText = useCallback((status: number, body: { error?: string } | null, fallback: string) => {
    const key = mtmApiErrorKey(body, status)
    return key === "generic" ? body?.error || fallback : tApi(key)
  }, [tApi])
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scoped = Boolean(agentScope)
  const scopeAgentId = agentScope?.agent.id
  const scopeView = agentScope?.view
  const baseFilters = useMemo(() => scopeBaseFilters(agentScope), [scopeAgentId, scopeView]) // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => (agentScope
    ? { filters: baseFilters, page: 1, limit: 50 }
    : contactExplorerStateFromSearchParams(new URLSearchParams(searchParams.toString()))), []) // eslint-disable-line react-hooks/exhaustive-deps
  const routeAssignmentHandoff = useMemo(
    () => (scoped ? null : mtmRouteAssignmentHandoffFromSearchParams(searchParams)),
    [scoped, searchParams],
  )
  const isRouteDoctorFlow = routeAssignmentHandoff?.direction === "DOCTOR"
  const [filters, setFilters] = useState<ContactExplorerFilters>(initial.filters)
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
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(
    !agentScope && FIELD_KEYS_BEHIND_MORE.some((key) => contactFilterIsActive(initial.filters, key)),
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
  const initialUrlHadState = useRef(contactListStateInUrl(searchParams))
  const defaultSavedViewApplied = useRef(false)
  const visitDate = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium" }),
    [locale],
  )
  const visitDateTime = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )
  // «7 окт.» in the list: this year's dates need no year, older ones keep it.
  const visitDayThisYear = useMemo(() => createDateFormatter(locale, { day: "numeric", month: "short" }), [locale])
  const visitDay = useCallback((value: string) => {
    const date = new Date(value)
    return date.getFullYear() === new Date().getFullYear() ? visitDayThisYear.format(date) : visitDate.format(date)
  }, [visitDate, visitDayThisYear])

  // The tenant's own category names win; a code they no longer list (or the
  // list not loaded yet) falls back to the built-in type name.
  const categoryLabels = useMemo(
    () => new Map((facets?.categories ?? []).map((category) => [
      category.code,
      localizedContactCategoryLabel(category.labels, locale),
    ])),
    [facets?.categories, locale],
  )
  const categoryLabel = useCallback((contact: Pick<ContactRow, "type" | "categoryCode">) => (
    categoryLabels.get(effectiveContactCategoryCode(contact)) ?? t(`types.${contact.type}`)
  ), [categoryLabels, t])
  const categoryOptions = useMemo(() => (
    facets?.categories?.length
      ? facets.categories.map((category) => ({
          value: category.code,
          label: localizedContactCategoryLabel(category.labels, locale),
        }))
      : LEGACY_CONTACT_TYPES.map((type) => ({ value: type as string, label: t(`types.${type}`) }))
  ), [facets?.categories, locale, t])

  // Fields the tenant switched off are not columns, card lines or filters here.
  const shows = useMemo(() => contactFieldVisibility(facets?.hiddenFields), [facets?.hiddenFields])
  // Owner, 2026-10-04, in front of an employee's own list of 321 clients: «не
  // понятно, кому привязаны». Every row of a section therefore names the
  // employee, right after the client. The room comes from the coverage column,
  // which stays on the Clients page — a section answers «whose client is it».
  const showsCoverage = shows("coverage") && !scoped
  const ownerLabel = scoped ? t("agentScope.ownerColumn") : t("owner")
  const noOwnerLabel = scoped ? t("agentScope.noOwner") : t("unassigned")

  // The attach tab never offers a client the employee already has.
  const scopedQuery = useCallback((forPage: number, forLimit: number) => {
    const params = contactQuery(filters, forPage, forLimit)
    if (scopeView === "candidates" && scopeAgentId) params.set("notAgentId", scopeAgentId)
    return params
  }, [filters, scopeAgentId, scopeView])
  const query = useMemo(() => scopedQuery(page, limit), [scopedQuery, page, limit])
  const queryString = query.toString()
  const routeAwareQueryString = useMemo(
    () => appendMtmRouteAssignmentHandoff(new URLSearchParams(queryString), routeAssignmentHandoff).toString(),
    [queryString, routeAssignmentHandoff],
  )
  const returnHref = agentScope?.returnHref ?? `${pathname}?${routeAwareQueryString}`

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    try {
      // The Clients page asks how many each chip holds; a section does not show them.
      const response = await fetch(`/api/v1/mtm/contacts?${queryString}${scoped ? "" : "&withCounts=1"}`, {
        headers: { Accept: "application/json" },
        signal,
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: ContactPayload
      } | null
      if (!response.ok || !body?.success || !body.data) throw new Error(refusalText(response.status, body, t("loadFailed")))
      setPayload(body.data)
      if (body.data.page !== page) setPage(body.data.page)
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return
      setError(loadError instanceof Error ? loadError.message : t("loadFailed"))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, queryString, refusalText, scoped, t])

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
        if (!response.ok || !body?.success || !body.data) throw new Error(refusalText(response.status, body, t("facetsLoadFailed")))
        setFacets(body.data)
      })
      .catch((facetsLoadError) => {
        if (facetsLoadError instanceof DOMException && facetsLoadError.name === "AbortError") return
        setFacetsError(facetsLoadError instanceof Error ? facetsLoadError.message : t("facetsLoadFailed"))
      })
    return () => controller.abort()
  }, [refreshKey, refusalText, t])

  const applySavedView = useCallback((view: ContactSavedView) => {
    const restored = contactSavedViewState(view.filters)
    setFilters(restored.filters)
    setPage(1)
    setLimit(restored.limit)
    setSelected(new Set())
    setActiveSavedViewId(view.id)
    setAdvancedOpen(FIELD_KEYS_BEHIND_MORE.some((key) => contactFilterIsActive(restored.filters, key)))
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
    if (scoped) return
    const controller = new AbortController()
    void loadSavedViews(controller.signal).catch((savedViewError) => {
      if (savedViewError instanceof DOMException && savedViewError.name === "AbortError") return
      toast.error(savedViewError instanceof Error ? savedViewError.message : t("savedViewsLoadFailed"))
    })
    return () => controller.abort()
  }, [loadSavedViews, scoped])

  useEffect(() => {
    if (scoped) return
    router.replace(`${pathname}?${routeAwareQueryString}`, { scroll: false })
  }, [pathname, routeAwareQueryString, router, scoped])

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
  // "Active" is measured against what this view opens with: the Clients page's
  // empty filter, or a section's own owner / assignment-state.
  const filterIsActive = (key: keyof ContactExplorerFilters) => (
    key === "specialties" ? filters.specialties.length > 0 : filters[key] !== baseFilters[key]
  )
  // In a section the assignment state sits among the main fields, not behind «more».
  const advancedFilterCount = (scoped ? ADVANCED_FILTER_KEYS : FIELD_KEYS_BEHIND_MORE)
    .filter((key) => !(scoped && key === "assignmentState") && filterIsActive(key)).length
  const hasActiveFilters = (Object.keys(EMPTY_CONTACT_FILTERS) as (keyof ContactExplorerFilters)[])
    .some(filterIsActive)
  // «Найдено: 321» over an employee's list did not say whose clients they were.
  const resultLabel = !agentScope || !payload
    ? tf("found", { count: total })
    : agentScope.view === "assigned"
      ? t(hasActiveFilters ? "agentScope.assignedFound" : "agentScope.assignedTotal", { name: agentScope.agent.name, count: total })
      : hasActiveFilters ? tf("found", { count: total }) : t("agentScope.candidatesTotal", { name: agentScope.agent.name, count: total })
  const loadedTotal = payload?.total
  const reportTotal = agentScope?.onTotal
  useEffect(() => {
    // The section's tab counts the employee's clients, not a filtered subset.
    if (reportTotal && loadedTotal !== undefined && !hasActiveFilters) reportTotal(loadedTotal)
  }, [hasActiveFilters, loadedTotal, reportTotal])
  const routeAssignmentAgent = (payload?.availableAgents ?? []).find((agent) => agent.id === routeAssignmentHandoff?.agentId)

  // The chips over the list, each with how many it holds (the server counts).
  const quickCounts = payload?.quick?.counts ?? null
  const quickMonth = formatDate(`${payload?.quick?.month ?? new Date().toISOString().slice(0, 7)}-15T12:00:00.000Z`, locale, { month: "long", timeZone: "UTC" })
  const quickChips: MtmQuickChip[] = [
    { value: "", label: t("quick.all"), count: quickCounts?.all, testId: "mtm-contact-quick-all" },
    { value: "NOT_VISITED", label: t("quick.notVisited", { month: quickMonth }), count: quickCounts?.NOT_VISITED, testId: "mtm-contact-quick-not-visited" },
    { value: "NOT_PLANNED", label: t("quick.notPlanned"), count: quickCounts?.NOT_PLANNED, testId: "mtm-contact-quick-not-planned" },
    // Only where somebody has nobody: a chip that always says 0 is noise.
    ...((quickCounts?.UNASSIGNED ?? 0) > 0 || filters.quick === "UNASSIGNED"
      ? [{ value: "UNASSIGNED", label: t("quick.unassigned"), count: quickCounts?.UNASSIGNED, testId: "mtm-contact-quick-unassigned" }]
      : []),
  ]
  // The classes (A, B, VIP) on a line of their own, always (owner, 2026-10-21:
  // «я не заметил категории клиентов… нужно добавить в фильтр»). Every class the
  // tenant grades with, with how many hold it: «0» says the class is there and
  // nobody has it yet — on Zeytun all 321 doctors were B, and the chips that
  // showed only from two classes up never appeared.
  const classCounts = new Map((quickCounts?.categories ?? []).map((entry) => [entry.category, entry.count]))
  const classChips: MtmQuickChip[] = [
    { value: "", label: t("all"), count: quickCounts ? [...classCounts.values()].reduce((sum, count) => sum + count, 0) : undefined, testId: "mtm-contact-quick-category-all" },
    ...[...new Set<string>([...contactClassOptions(facets?.classes, filters.category), ...classCounts.keys()])].map((category) => ({
      value: category,
      label: category,
      count: quickCounts ? classCounts.get(category) ?? 0 : undefined,
      testId: `mtm-contact-quick-category-${category}`,
    })),
  ]
  // Without signed visit norms every row said «Правило не подписано»: one line
  // says it instead, and the column comes back when a norm is in force.
  const coverageWithoutNorms = showsCoverage && contacts.length > 0
    && contacts.every((contact) => COVERAGE_WITHOUT_NORMS.has(contact.coverage.state))
    && contacts.some((contact) => contact.coverage.state === "UNSIGNED_COVERAGE_POLICY")
  const showsCoverageColumn = showsCoverage && !coverageWithoutNorms
  // «Связь» only when somebody on the page has a phone or an e-mail.
  const showsCommunication = contacts.some((contact) => visiblePhone(contact, shows) || (shows("email") && contact.email))
  // The client category («Həkim») in the row only where the page mixes them.
  const mixedCategories = new Set(contacts.map((contact) => categoryLabel(contact))).size > 1
  const routeHref = (contact: ContactRow): string | null => {
    const workplace = contact.workplaces.find((item) => item.isPrimary) ?? contact.workplaces[0]
    if (!workplace) return null
    const owner = contact.agentAssignments.find((assignment) => assignment.role === "PRIMARY") ?? contact.agentAssignments[0]
    return mtmRoutePlanPageHref({ customerId: workplace.customer.id, contactId: contact.id, agentId: owner?.agent.id })
  }

  const updateFilter = (key: ContactTextFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  // The attach tab's single «whose clients» field over the two filters the
  // list API knows: nobody's, one colleague's, or everyone's.
  const otherAgents = (payload?.availableAgents ?? []).filter((agent) => agent.id !== scopeAgentId)
  const whoseValue = filters.ownerAgentId || (filters.assignmentState === "UNASSIGNED" ? WHOSE_NOBODY : "")
  const updateWhose = (value: string) => {
    setFilters((current) => ({
      ...current,
      ownerAgentId: value === WHOSE_NOBODY ? "" : value,
      assignmentState: value === WHOSE_NOBODY ? "UNASSIGNED" : "",
    }))
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  const updateSpecialties = (specialties: string[]) => {
    setFilters((current) => ({ ...current, specialties }))
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  const clearFilters = () => {
    setFilters({ ...baseFilters, specialties: [] })
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
      const allQuery = scopedQuery(1, MTM_CONTACT_BULK_LIMIT)
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
      {scoped ? null : (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <MtmPageTitle title={t("title")} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1">
            <MtmFilterSelect testId="mtm-contact-saved-view" label={tf("view")} value={activeSavedViewId} allLabel={t("savedViewsPlaceholder")} clearable={false}
              onChange={(value) => {
                const view = savedViews.find((item) => item.id === value)
                if (view) applySavedView(view)
                else setActiveSavedViewId("")
              }}
              options={savedViews.map((view) => ({ value: view.id, label: `${view.isDefault ? "★ " : ""}${view.name}${view.isShared ? ` · ${t("sharedView")}` : ""}` }))} />
            <Hint wrap text={t("hint.saveView")}>
              <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1.5 px-3" aria-label={t("saveCurrentView")} disabled={savedViewsBusy}
                onClick={() => {
                  setSavedViewName("")
                  setSavedViewDefault(false)
                  setSaveViewOpen(true)
                }}>
                <Bookmark className="h-4 w-4" aria-hidden="true" />
                {t("saveViewShort")}
              </Button>
            </Hint>
            {activeSavedView?.canDelete ? (
              <Hint wrap text={t("hint.deleteView")}>
                <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1.5 px-3 text-destructive" aria-label={t("deleteSavedView")} disabled={savedViewsBusy} onClick={() => void deleteActiveSavedView()}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t("deleteViewShort")}
                </Button>
              </Hint>
            ) : null}
          </span>
          <Hint text={t("hint.createClient")}>
            <Button type="button" size="sm" className="min-h-11" onClick={() => setCreateOpen(true)}>
              <UserRoundPlus className="mr-1.5 h-4 w-4" />
              {t("createClient")}
            </Button>
          </Hint>
          <Hint wrap text={t("hint.refresh")}>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
          </Hint>
          <HelpButton slug="mtm-contacts" variant="quiet" />
        </div>
      </div>
      )}

      {/* What this list is, in a sentence, before anything else on the tab —
          and how to change it only for someone who may. */}
      {agentScope ? (
        <section data-testid="mtm-agent-scope-explainer" className="flex items-start gap-3 rounded-xl border border-l-4 border-border border-l-primary bg-card p-4">
          {agentScope.view === "assigned"
            ? <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            : <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{t(`agentScope.${agentScope.view}Title`, { name: agentScope.agent.name })}</h2>
            {payload?.capabilities.canTransfer ? (
              <p className="mt-1 text-sm text-muted-foreground">{t(`agentScope.${agentScope.view}How`, { name: agentScope.agent.name })}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isRouteDoctorFlow && routeAssignmentHandoff ? (
        <section data-testid="mtm-route-assignment-handoff" className="flex flex-col gap-3 rounded-xl border border-l-4 border-border border-l-primary bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
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

      {/* Owner 2026-10-02, on the row of fifteen pills that stood here: «он не
          интуитивен и не юзер френдли», with a screenshot of the filter he
          wants — a named field per thing you look by. Eight fields on the
          page; the rest behind «Ещё фильтры», and the reference dropdowns only
          for a tenant whose data fills them (on prod nobody's did). */}
      <section data-testid="mtm-contact-filters" className="space-y-3">
        {/* Owner, 2026-10-16, from a picture: the Clients page opens on one
            search and the chips — «Все», «Без визита за октябрь», «Не
            запланированы» — with how many each holds; the named fields he
            asked for on 2026-10-02 are one click away under «Ещё фильтры». */}
        {scoped ? null : (
          <div data-testid="mtm-contact-toolbar" className="flex flex-wrap items-center gap-2">
            <MtmFilterSearch testId="mtm-contact-search" value={filters.search} onChange={(value) => updateFilter("search", value)} placeholder={t("searchPlaceholder")} label={t("filterAnywhere")} clearLabel={tf("clear")} />
            <MtmQuickChips label={t("quick.label")} chips={quickChips} value={filters.quick} onChange={(value) => updateFilter("quick", value)}
              renderChip={(chip, element) => <Hint text={t(QUICK_HINT[chip.value as keyof typeof QUICK_HINT] ?? "hint.quickAll", { month: quickMonth })}>{element}</Hint>} />
            <span className="ml-auto flex items-center gap-1">
              <MtmFilterMore testId="mtm-contact-more-filters" open={advancedOpen} onToggle={() => setAdvancedOpen((open) => !open)} count={advancedFilterCount} label={tf("more")} />
              <MtmFilterReset testId="mtm-contact-clear-filters" show={hasActiveFilters} onReset={clearFilters} label={tf("reset")} />
            </span>
          </div>
        )}
        {scoped ? null : (
          <div data-testid="mtm-contact-class-row" className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">{t("category")}</span>
            <MtmQuickChips label={t("category")} chips={classChips} value={filters.category} onChange={(value) => updateFilter("category", value === filters.category ? "" : value)}
              renderChip={(chip, element) => chip.value ? <Hint text={t("hint.quickCategory", { category: chip.value })}>{element}</Hint> : element} />
          </div>
        )}
        {scoped || advancedOpen ? (
          <MtmFilterGrid>
          {/* In an employee's own list the owner is that employee: nothing to choose.
              When attaching, the question is whose clients to look through, and
              it is one question: nobody's, or a named colleague's. Two fields
              («owner» and «assignment state») could contradict each other —
              a colleague chosen while the state still said «nobody's» found
              nothing. */}
          {scopeView === "candidates" ? (
            <MtmFilterSelectField testId="mtm-contact-whose" label={t("agentScope.whichClients")} value={whoseValue} onChange={updateWhose} allLabel={t("agentScope.whichClientsAll")}
              options={[
                { value: WHOSE_NOBODY, label: t("agentScope.whichClientsFree") },
                ...otherAgents.map((agent) => ({ value: agent.id, label: t("agentScope.whichClientsOf", { name: agent.status !== "ACTIVE" ? `${agent.name} · ${t("agentInactive")}` : agent.name }) })),
              ]} />
          ) : scoped ? null : (
            <Hint wrap text={t("hint.owner")}>
              <MtmFilterSelectField testId="mtm-contact-owner" label={t("owner")} value={filters.ownerAgentId} onChange={(value) => updateFilter("ownerAgentId", value)} allLabel={t("allAccessible")}
                options={otherAgents.map((agent) => ({ value: agent.id, label: agent.status !== "ACTIVE" ? `${agent.name} · ${t("agentInactive")}` : agent.name }))} />
            </Hint>
          )}
          {shows("specialtyName") || filters.specialties.length > 0 ? (
            <MtmFilterMultiField testId="mtm-contact-specialties" label={t("filterSpecialties")} values={filters.specialties} onChange={updateSpecialties} allLabel={t("all")}
              searchPlaceholder={t("filterSpecialtySearch")} emptyLabel={t("filterNothingFound")} clearLabel={tf("clear")}
              options={(facets?.specialties ?? []).map((value) => ({ value, label: value }))} />
          ) : null}
          <MtmFilterTextField testId="mtm-contact-name" label={t("filterClientName")} placeholder={t("filterNamePlaceholder")} value={filters.name} onChange={(value) => updateFilter("name", value)} clearLabel={tf("clear")} />
          <MtmFilterTextField testId="mtm-contact-address" label={t("filterAddress")} placeholder={t("filterAddressPlaceholder")} value={filters.address} onChange={(value) => updateFilter("address", value)} clearLabel={tf("clear")} />
          <MtmFilterTextField testId="mtm-contact-area" label={t("filterArea")} placeholder={t("filterAreaPlaceholder")} value={filters.area} onChange={(value) => updateFilter("area", value)} clearLabel={tf("clear")} />
          <MtmFilterTextField testId="mtm-contact-workplace" label={t("filterWorkplace")} placeholder={t("filterNamePlaceholder")} value={filters.workplace} onChange={(value) => updateFilter("workplace", value)} clearLabel={tf("clear")} />
          <MtmFilterSelectField testId="mtm-contact-type" label={t("type")} value={filters.type} onChange={(value) => updateFilter("type", value)} allLabel={t("all")}
            options={categoryOptions} />
          <MtmFilterSelectField testId="mtm-contact-status" label={t("status")} value={filters.status} onChange={(value) => updateFilter("status", value)} allLabel={t("all")}
            options={["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"].map((status) => ({ value: status, label: t(`statuses.${status}`) }))} />
          {scoped ? (
            <Hint wrap text={t("hint.category")}>
              <MtmFilterSelectField testId="mtm-contact-category" label={t("category")} value={filters.category} onChange={(value) => updateFilter("category", value)} allLabel={t("all")}
                options={contactClassOptions(facets?.classes, filters.category).map((category) => ({ value: category, label: category }))} />
            </Hint>
          ) : null}
          {advancedOpen ? (
            <>
              {scoped ? null : (
                <Hint wrap text={t("hint.assignmentState")}>
                  <MtmFilterSelectField testId="mtm-contact-assignment-state" label={t("assignmentState")} value={filters.assignmentState} onChange={(value) => updateFilter("assignmentState", value)} allLabel={t("all")}
                    options={[{ value: "ASSIGNED", label: t("assigned") }, { value: "UNASSIGNED", label: t("unassigned") }]} />
                </Hint>
              )}
              {scoped ? (
                <MtmFilterTextField testId="mtm-contact-search" label={t("filterAnywhere")} placeholder={t("searchPlaceholder")} value={filters.search} onChange={(value) => updateFilter("search", value)} clearLabel={tf("clear")} />
              ) : null}
              {([
                ["profile", "profile", facets?.profiles],
                ["qualificationCategory", "qualificationCategory", facets?.qualificationCategories],
                ["region", "region", facets?.regions],
                ["administrativeDistrict", "administrativeDistrict", facets?.administrativeDistricts],
                ["locality", "locality", facets?.localities],
                ["cityDistrict", "cityDistrict", facets?.cityDistricts],
                ["organizationKind", "organizationKind", facets?.organizationKinds],
              ] as const).map(([key, labelKey, values]) => {
                // A reference dropdown with nothing to choose is noise: it
                // shows only where the tenant's data fills it — and not for a
                // field the tenant switched off — or while it is set.
                const offered = (values?.length ?? 0) > 0
                  && (key === "profile" || key === "qualificationCategory" ? shows(key) : true)
                return offered || filters[key] ? (
                  <MtmFilterSelectField key={key} testId={`mtm-contact-${key}`} label={t(labelKey)} value={filters[key]} onChange={(value) => updateFilter(key, value)} allLabel={t("all")}
                    options={(values ?? []).map((value) => ({ value, label: value }))} />
                ) : null
              })}
              {(facets?.objectTypes.length ?? 0) > 0 || filters.objectType ? (
                <MtmFilterSelectField testId="mtm-contact-object-type" label={t("organizationType")} value={filters.objectType} onChange={(value) => updateFilter("objectType", value)} allLabel={t("all")}
                  options={(facets?.objectTypes ?? []).map((value) => ({ value, label: t(`objectTypes.${value}`) }))} />
              ) : null}
              {shows("coverage") || filters.coveragePeriod ? (
                <Hint wrap text={t("hint.coveragePeriod")}>
                  <MtmFilterDateField testId="mtm-contact-coverage-period" type="month" label={t("coveragePeriod")} active={Boolean(filters.coveragePeriod)} value={filters.coveragePeriod || payload?.coveragePeriod.key || ""} onChange={(value) => updateFilter("coveragePeriod", value)} />
                </Hint>
              ) : null}
            </>
          ) : null}
        </MtmFilterGrid>
        ) : null}
        {facetsError && facetsError !== error ? <p className="text-xs text-amber-700 dark:text-amber-300">{facetsError}</p> : null}
        {scoped ? (
          <MtmFilterActions>
            <MtmFilterMore testId="mtm-contact-more-filters" open={advancedOpen} onToggle={() => setAdvancedOpen((open) => !open)} count={advancedFilterCount} label={tf("more")} />
            <MtmFilterReset testId="mtm-contact-clear-filters" show={hasActiveFilters} onReset={clearFilters} label={tf("reset")} />
          </MtmFilterActions>
        ) : null}
        {coverageWithoutNorms ? (
          <div data-testid="mtm-contact-coverage-unsigned" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t("coverageUnsignedBanner")}</span>
            {payload?.capabilities.actorRole === "ADMIN" ? (
              <Hint text={t("hint.coverageUnsignedAction")}>
                <Link href="/mtm/settings?tab=admin" className="font-semibold text-primary hover:underline">{t("coverageUnsignedAction")}</Link>
              </Hint>
            ) : null}
          </div>
        ) : null}
        <MtmResultLine
          aside={scoped ? undefined : <HintValue text={t("hint.asOf")}>
            {t("asOf", { date: payload?.asOf ?? "—" })}
            {payload?.coveragePeriod && showsCoverageColumn ? ` · ${t("coveragePeriodRange", { start: payload.coveragePeriod.start, end: payload.coveragePeriod.end })}` : ""}
          </HintValue>}
        >
          <span data-testid="mtm-contact-result-count" className="font-medium text-foreground">{resultLabel}</span>
        </MtmResultLine>
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
            <p className="text-sm font-semibold">{t(scoped ? "agentScope.selected" : "selectionCount", { count: selected.size })}</p>
            <p className="text-xs text-muted-foreground">{scoped ? t("agentScope.selectionNote") : `${selectionScope} · ${t("assignmentBoundary")}`}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size < total && total <= MTM_CONTACT_BULK_LIMIT ? (
              <Hint wrap text={t("hint.selectAll")}>
                <Button type="button" variant="outline" size="sm" onClick={() => void selectAllFiltered()} disabled={selectingAll}>
                  {selectingAll ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t("selectAllFiltered", { count: total })}
                </Button>
              </Hint>
            ) : null}
            <Hint text={t("hint.clearSelection")}><Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())}>{t("clearSelection")}</Button></Hint>
            {payload?.capabilities.canTransfer && isRouteDoctorFlow ? (
              <Hint text={t("hint.routeFlowAssign")}>
                <Button type="button" size="sm" onClick={() => openAssignment("ASSIGN")}>
                  <UserPlus className="mr-1 h-4 w-4" />
                  {t("routeFlowAssignAndReturn")}
                </Button>
              </Hint>
            ) : payload?.capabilities.canTransfer && agentScope?.view === "candidates" ? (
              <Hint text={t("hint.scopeAssign")}>
                <Button data-testid="mtm-agent-scope-assign" type="button" size="sm" className="min-h-11" onClick={() => openAssignment("ASSIGN")}>
                  <UserPlus className="mr-1 h-4 w-4" />
                  {t("agentScope.assignTo", { name: agentScope.agent.name })}
                </Button>
              </Hint>
            ) : payload?.capabilities.canTransfer && agentScope ? (
              <>
                <Hint text={t("hint.scopeTransfer")}>
                  <Button data-testid="mtm-agent-scope-transfer" type="button" variant="outline" size="sm" className="min-h-11" onClick={openTransfer}>
                    <ArrowRightLeft className="mr-1 h-4 w-4" />
                    {t("agentScope.transferToOther")}
                  </Button>
                </Hint>
                <Hint text={t("hint.scopeUnassign")}>
                  <Button data-testid="mtm-agent-scope-unassign" type="button" size="sm" className="min-h-11" onClick={() => openAssignment("UNASSIGN")}>
                    <UserMinus className="mr-1 h-4 w-4" />
                    {t("agentScope.unassignFrom", { name: agentScope.agent.name })}
                  </Button>
                </Hint>
              </>
            ) : payload?.capabilities.canTransfer ? (
              <>
                <Hint text={t("hint.unassign")}>
                  <Button type="button" variant="outline" size="sm" onClick={() => openAssignment("UNASSIGN")}>
                    <UserMinus className="mr-1 h-4 w-4" />
                    {t("unassignAction")}
                  </Button>
                </Hint>
                <Hint text={t("hint.assign")}>
                  <Button type="button" variant="outline" size="sm" onClick={() => openAssignment("ASSIGN")}>
                    <UserPlus className="mr-1 h-4 w-4" />
                    {t("assignAction")}
                  </Button>
                </Hint>
                <Hint text={t("hint.transfer")}>
                  <Button data-testid="mtm-contact-transfer-open" type="button" size="sm" onClick={openTransfer}>
                    <ArrowRightLeft className="mr-1 h-4 w-4" />
                    {t("transferAction")}
                  </Button>
                </Hint>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="rounded-xl border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-6 text-center">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={refresh}>{t("retry")}</Button>
        </section>
      ) : loading && !payload ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : contacts.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-border">
          <UsersRound className="mx-auto h-7 w-7 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">{agentScope && !hasActiveFilters ? t(`agentScope.${agentScope.view}EmptyTitle`, { name: agentScope.agent.name }) : t("emptyTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{agentScope && !hasActiveFilters ? t(`agentScope.${agentScope.view}EmptyDescription`) : t("emptyDescription")}</p>
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
                categoryLabel={categoryLabel(contact)}
                shows={shows}
                showsCoverage={showsCoverageColumn}
                planHref={routeHref(contact)}
                ownerLabel={ownerLabel}
                noOwnerLabel={noOwnerLabel}
                t={t}
              />
            ))}
          </div>
          {/* One line a client (owner, 2026-10-16, from a picture): who, where,
              when last and by whom, when next, whose — and «В маршрут». The
              table fits the screen: no sideways scrolling, no column of «—». */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card lg:block">
            <table data-testid="mtm-contact-table" className="w-full table-fixed text-sm">
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
                  {/* Fixed shares of the width: the row never pushes «В маршрут» off the screen. */}
                  <th scope="col" className="px-3 py-2.5 font-medium">{t("contact")}</th>
                  {scoped ? <th scope="col" className="w-[15%] px-3 py-2.5 font-medium"><HintValue text={t("hint.colOwner")}>{ownerLabel}</HintValue></th> : null}
                  {/* The class in a column of its own, always (owner, 2026-10-21). */}
                  <th scope="col" className="w-[6.5rem] px-3 py-2.5 font-medium"><HintValue text={t("hint.category")}>{t("category")}</HintValue></th>
                  {showsCoverageColumn ? <th scope="col" className="w-[14%] px-3 py-2.5 font-medium"><HintValue text={t("hint.colCoverage")}>{t("coverage")}</HintValue></th> : null}
                  <th scope="col" className="w-[22%] px-3 py-2.5 font-medium">{t("workplace")}</th>
                  <th scope="col" className="w-[13%] px-3 py-2.5 font-medium"><HintValue text={t("hint.colLastVisit")}>{t("lastVisit")}</HintValue></th>
                  <th scope="col" className="w-[10%] px-3 py-2.5 font-medium"><HintValue text={t("hint.colNextVisit")}>{t("nextVisit")}</HintValue></th>
                  {showsCommunication ? <th scope="col" className="w-[13%] px-3 py-2.5 font-medium">{t("communication")}</th> : null}
                  {scoped ? null : <th scope="col" className="w-[15%] px-3 py-2.5 font-medium"><HintValue text={t("hint.colOwner")}>{ownerLabel}</HintValue></th>}
                  <th scope="col" className="w-[9.5rem] px-3 py-2.5"><span className="sr-only">{t("rowActions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((contact) => {
                  const workplace = contact.workplaces.find((item) => item.isPrimary) ?? contact.workplaces[0]
                  const owners = contactEmployees(contact)
                  const phone = visiblePhone(contact, shows)
                  const email = shows("email") ? contact.email : null
                  const lastVisit = contact.visits[0]
                  const nextPoint = contact.routePoints[0]
                  const planHref = routeHref(contact)
                  const detail = [
                    specialtyLine(contact, shows),
                    professionDetail(contact, shows),
                    mixedCategories ? categoryLabel(contact) : null,
                    contact.externalCode && shows("externalCode") ? contact.externalCode : null,
                  ].filter(Boolean).join(" · ")
                  const ownerCell = (
                    <td className="px-3 py-2" data-testid={`mtm-contact-owner-${contact.id}`}>
                      {owners.length > 0 ? owners.map((owner) => (
                        <p key={owner.id} className="truncate [&+p]:mt-1" title={owner.name}>
                          {owner.name}
                          {owner.status !== "ACTIVE" ? <span className="mt-0.5 block text-xs font-normal text-amber-700 dark:text-amber-300">{t("agentInactive")}</span> : null}
                        </p>
                      )) : <span className="text-muted-foreground">{noOwnerLabel}</span>}
                    </td>
                  )
                  return (
                    <tr key={contact.id} className="cursor-pointer hover:bg-muted/25" onClick={(event) => openRowOnClick(event, `/mtm/contacts/${contact.id}?returnTo=${encodeURIComponent(returnHref)}`, (href) => router.push(href))}>
                      <td>
                        <FieldCheckbox
                          checked={selected.has(contact.id)}
                          label={t("selectContact", { name: contact.displayName })}
                          testId={`mtm-contact-select-${contact.id}`}
                          onChange={(checked) => toggleContact(contact.id, checked)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Link
                            href={`/mtm/contacts/${contact.id}?returnTo=${encodeURIComponent(returnHref)}`}
                            className="truncate font-semibold text-primary hover:underline"
                          >
                            {contact.displayName}
                          </Link>
                          {contact.status !== "ACTIVE" ? <Badge variant={statusVariant(contact.status)}>{t(`statuses.${contact.status}`)}</Badge> : null}
                        </span>
                        {detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={detail}>{detail}</p> : null}
                      </td>
                      {scoped ? ownerCell : null}
                      <td className="px-3 py-2" data-testid={`mtm-contact-class-${contact.id}`}>
                        <MtmContactClassTag category={contact.category} />
                      </td>
                      {showsCoverageColumn ? (
                        <td className="px-3 py-2">
                          <ContactCoverageCell coverage={contact.coverage} t={t} />
                        </td>
                      ) : null}
                      <td className="px-3 py-2">
                        {workplace ? (
                          <>
                            <Link
                              href={`/mtm/customers/${workplace.customer.id}?returnTo=${encodeURIComponent(returnHref)}`}
                              className="block truncate font-medium hover:text-primary hover:underline"
                            >
                              {workplace.customer.name}
                            </Link>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {[workplace.customer.city, workplace.customer.address].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </>
                        ) : <span className="text-muted-foreground">{t("noWorkplace")}</span>}
                      </td>
                      <td className="px-3 py-2" data-testid={`mtm-contact-last-visit-${contact.id}`}>
                        {lastVisit ? (
                          <Link href={`/mtm/visits?visitId=${lastVisit.id}`} className="block truncate hover:text-primary hover:underline">
                            <span className="font-medium">{visitDay(lastVisit.checkInAt)}</span>
                            {lastVisit.agent ? <span className="text-muted-foreground"> · {shortPersonName(lastVisit.agent.name)}</span> : null}
                          </Link>
                        ) : <span className="font-semibold text-orange-600 dark:text-orange-400">{t("noVisitHistory")}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" data-testid={`mtm-contact-next-visit-${contact.id}`}>
                        {nextPoint ? (
                          <Link href={`/mtm/routes?routeId=${nextPoint.routeId}`} className="font-medium hover:text-primary hover:underline">
                            {visitDay(nextPoint.plannedTime ?? nextPoint.route.date)}
                          </Link>
                        ) : <span className="text-muted-foreground">{t("notPlanned")}</span>}
                      </td>
                      {showsCommunication ? (
                        <td className="px-3 py-2">
                          {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1.5 whitespace-nowrap hover:text-primary"><Phone className="h-3.5 w-3.5" />{phone}</a> : null}
                          {email ? <a href={`mailto:${email}`} className="mt-1 flex items-center gap-1.5 hover:text-primary"><Mail className="h-3.5 w-3.5" />{email}</a> : null}
                          {!phone && !email ? <span className="text-muted-foreground">—</span> : null}
                        </td>
                      ) : null}
                      {scoped ? null : ownerCell}
                      <td className="px-3 py-2 text-right">
                        {planHref ? (
                          <Hint text={t("hint.addToRoute")}>
                            <Button asChild variant="outline" size="sm" className="min-h-9 whitespace-nowrap">
                              <Link href={planHref} data-testid={`mtm-contact-add-to-route-${contact.id}`} aria-label={t("addToRouteFor", { name: contact.displayName })}>
                                <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                                {t("addToRoute")}
                              </Link>
                            </Button>
                          </Hint>
                        ) : (
                          <Hint wrap text={t("hint.addToRouteNoWorkplace")}>
                            <Button variant="outline" size="sm" className="min-h-9 whitespace-nowrap" disabled>
                              <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                              {t("addToRoute")}
                            </Button>
                          </Hint>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
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
          <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t("previousPage")}
          </Button>
          <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || loading}>
            {t("nextPage")}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
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
          agentScope?.onChanged?.()
        }}
      />
      <ContactAssignmentDialog
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        mode={assignmentMode}
        contactIds={[...selected]}
        agents={payload?.availableAgents ?? []}
        asOf={payload?.asOf ?? ""}
        initialTargetAgentId={agentScope?.view === "candidates" ? agentScope.agent.id : isRouteDoctorFlow ? routeAssignmentHandoff?.agentId : undefined}
        // In a section «detach» means this employee; on the Clients page the
        // employee the list is narrowed to, or — with none chosen — everyone.
        sourceAgentId={agentScope ? agentScope.agent.id : filters.ownerAgentId || undefined}
        lockTargetAgent={agentScope?.view === "candidates"}
        defaultReason={agentScope
          ? t(assignmentMode === "ASSIGN" ? "agentScope.assignReason" : "agentScope.unassignReason", { name: agentScope.agent.name })
          : isRouteDoctorFlow ? t("routeFlowAssignmentReason") : undefined}
        onCompleted={(result) => {
          setSelected(new Set())
          refresh()
          agentScope?.onChanged?.()
          if (isRouteDoctorFlow && assignmentMode === "ASSIGN" && result.summary.changed > 0 && routeAssignmentHandoff) {
            toast.success(t("routeFlowReturningToRoute", { count: result.summary.changed }))
            router.push(routeAssignmentHandoff.returnTo)
          }
        }}
      />
      <MtmContactCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        specialties={facets?.configuredSpecialties}
        hiddenFields={facets?.hiddenFields}
        onCreated={() => {
          setPage(1)
          refresh()
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
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3">
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

/**
 * Everyone the client is attached to today, the responsible one first. A
 * client may have several employees (owner, 2026-10-06), and the list said one.
 */
function contactEmployees(contact: ContactRow): ContactAssignment["agent"][] {
  const seen = new Set<string>()
  return [...contact.agentAssignments]
    .sort((left, right) => Number(right.role === "PRIMARY") - Number(left.role === "PRIMARY"))
    .map((assignment) => assignment.agent)
    .filter((agent) => !seen.has(agent.id) && Boolean(seen.add(agent.id)))
}

/** Profile and qualification under the specialty; empty for most tenants, and then not a dash in every row. */
function professionDetail(contact: ContactRow, shows: FieldVisibility): string {
  return [shows("profile") && contact.profile, shows("qualificationCategory") && contact.qualificationCategory].filter(Boolean).join(" · ")
}

function ContactCard({
  contact,
  checked,
  returnHref,
  onCheckedChange,
  visitDate,
  visitDateTime,
  categoryLabel,
  shows,
  showsCoverage,
  ownerLabel,
  noOwnerLabel,
  planHref,
  t,
}: {
  contact: ContactRow
  checked: boolean
  returnHref: string
  onCheckedChange: (checked: boolean) => void
  visitDate: DateFormatter
  visitDateTime: DateFormatter
  categoryLabel: string
  shows: FieldVisibility
  showsCoverage: boolean
  ownerLabel: string
  noOwnerLabel: string
  planHref: string | null
  t: ReturnType<typeof useTranslations>
}) {
  const workplace = contact.workplaces.find((item) => item.isPrimary) ?? contact.workplaces[0]
  const owners = contactEmployees(contact)
  const phone = visiblePhone(contact, shows)
  const email = shows("email") ? contact.email : null
  const lastVisit = contact.visits[0]
  const nextPoint = contact.routePoints[0]
  return (
    <article className="rounded-xl border border-border bg-card p-4">
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
            {contact.status !== "ACTIVE" ? <Badge variant={statusVariant(contact.status)}>{t(`statuses.${contact.status}`)}</Badge> : null}
            <Badge variant="outline">{categoryLabel}</Badge>
            <Badge variant="outline">{t("categoryShort", { category: contact.category })}</Badge>
          </div>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {shows("specialtyName") || shows("specialtyCode") ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("professional")}</dt>
            <dd className="mt-1">{specialtyLine(contact, shows) || "—"}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{ownerLabel}</dt>
          <dd className="mt-1">{owners.map((owner) => owner.name).join(", ") || noOwnerLabel}</dd>
        </div>
        {showsCoverage ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("coverage")}</dt>
            <dd className="mt-1"><ContactCoverageCell coverage={contact.coverage} t={t} /></dd>
          </div>
        ) : null}
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
                {lastVisit.agent ? <span className="text-muted-foreground"> · {shortPersonName(lastVisit.agent.name)}</span> : null}
              </Link>
            ) : <span className="font-semibold text-orange-600 dark:text-orange-400">{t("noVisitHistory")}</span>}
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
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        {planHref ? (
          <Button asChild size="sm" className="min-h-11"><Link href={planHref}><CalendarPlus className="mr-1 h-4 w-4" aria-hidden="true" />{t("addToRoute")}</Link></Button>
        ) : null}
        {phone ? <Button asChild variant="outline" size="sm" className="min-h-11"><a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone className="mr-1 h-4 w-4" />{t("call")}</a></Button> : null}
        {email ? <Button asChild variant="outline" size="sm" className="min-h-11"><a href={`mailto:${email}`}><Mail className="mr-1 h-4 w-4" />{t("email")}</a></Button> : null}
      </div>
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
      {proof ? <p className="mt-1 text-xs text-muted-foreground" title={proof}>{proof}</p> : null}
    </div>
  )
}
