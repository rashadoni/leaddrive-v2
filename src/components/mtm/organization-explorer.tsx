"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Bookmark,
  Building2,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Download,
  Filter,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { MtmWorkflowGuide } from "@/components/mtm/mtm-workflow-guide"
import { MtmCustomerForm } from "@/components/mtm/customer-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
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
import { Textarea } from "@/components/ui/textarea"
import {
  EMPTY_ORGANIZATION_FILTERS,
  MTM_ORGANIZATION_BULK_LIMIT,
  MTM_ORGANIZATION_COLUMN_MAX_WIDTH,
  MTM_ORGANIZATION_COLUMN_MIN_WIDTH,
  MTM_ORGANIZATION_COLUMNS,
  MTM_ORGANIZATION_DEFAULT_COLUMNS,
  MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS,
  MTM_ORGANIZATION_PAGE_SIZES,
  type OrganizationColumn,
  type OrganizationDensity,
  OrganizationExplorerFilters,
  organizationFacetQuery,
  organizationFiltersFromSearchParams,
  organizationQuery,
  organizationSavedViewFilters,
  organizationSavedViewState,
  selectionScopeLabel,
  updatePageSelection,
} from "@/lib/mtm/organization-explorer"
import {
  appendMtmRouteAssignmentHandoff,
  mtmRouteAssignmentHandoffFromSearchParams,
  mtmRoutePlanningHref,
} from "@/lib/mtm/route-links"
import { createDateFormatter } from "@/lib/format-date"

type Agent = {
  id: string
  name: string
  role: string
}

type Assignment = {
  id: string
  role: string
  agent: Agent
}

type AttributeLabels = { ru: string; az: string; en: string }

type OrganizationAttributeFact = {
  medicalCategoryCode: string | null
  medicalCategoryLabels: AttributeLabels | null
  licenseStatus: "LICENSED" | "UNLICENSED" | "NOT_REQUIRED" | null
  licenseLabels: AttributeLabels | null
  polygonCode: string | null
  polygonLabels: AttributeLabels | null
  package: {
    version: number
    rowsHash: string
    approvalReference: string
    sourceSystem: string
    sourceReference: string | null
    sourceObservedAt: string
    effectiveFrom: string
    signedAt: string
  }
}

type Organization = {
  id: string
  code: string | null
  name: string
  objectType: string
  category: string
  status: string
  address: string | null
  region: string | null
  administrativeDistrict: string | null
  locality: string | null
  cityDistrict: string | null
  city: string | null
  district: string | null
  specialization: string | null
  organizationKind: string | null
  territoryCode: string | null
  phone: string | null
  contactPerson: string | null
  managingManager: Agent | null
  agentAssignments: Assignment[]
  attributeFacts: OrganizationAttributeFact[]
  visits: Array<{
    id: string
    checkInAt: string
    agent: { id: string; name: string }
  }>
  routePoints: Array<{
    id: string
    routeId: string
    plannedTime: string | null
    orderIndex: number
    route: { date: string; status: string }
  }>
  latitude: number | null
  longitude: number | null
  _count: {
    contactWorkplaces: number
    visits: number
  }
}

type Facets = {
  region: string[]
  administrativeDistrict: string[]
  locality: string[]
  cityDistrict: string[]
  city: string[]
  specialization: string[]
  organizationKind: string[]
  territoryCode: string[]
  medicalCategories: Array<{ code: string; labels: AttributeLabels | null }>
  licenseStatuses: Array<{ code: string; labels: AttributeLabels | null }>
  polygons: Array<{ code: string; labels: AttributeLabels | null }>
  managers: Agent[]
  assignableAgents: Agent[]
  asOf: string
}

function attributeLabel(labels: AttributeLabels | null | undefined, locale: string, fallback: string): string {
  if (!labels) return fallback
  if (locale.startsWith("az")) return labels.az
  if (locale.startsWith("ru")) return labels.ru
  return labels.en
}

type OrganizationListPayload = {
  organizations: Organization[]
  total: number
  page: number
  limit: number
  asOf: string
  timezone: string
  effectiveScope: "ALL" | "MINE"
  capabilities: {
    canManage: boolean
    canRequestChanges: boolean
    actorAgentId: string | null
    actorRole: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT"
  }
}

type OrganizationSavedView = {
  id: string
  name: string
  filters: unknown
  isDefault: boolean
  isShared: boolean
  canDelete: boolean
}

type AssignmentIssue =
  | "ORGANIZATION_NOT_AVAILABLE"
  | "ORGANIZATION_INACTIVE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "TARGET_ALREADY_ASSIGNED"
  | "NO_PRIMARY_ASSIGNMENT"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

type AssignmentPreview = {
  previewToken: string
  effectiveFrom: string
  targetAgent: Agent | null
  summary: {
    selected: number
    assignable: number
    excluded: number
    unassigned: number
    openVisitConflicts: number
    routePlanConflicts: number
    changed?: number
  }
  rows: Array<{
    organizationId: string
    name: string | null
    issues: AssignmentIssue[]
    assignable: boolean
    openVisitCount: number
    plannedRouteCount: number
  }>
}

type AssignmentResult = {
  summary: AssignmentPreview["summary"] & { changed: number }
  excluded: AssignmentPreview["rows"]
}

function localDateKey(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function csvCell(value: unknown): string {
  const text = String(value ?? "")
  return `"${text.replaceAll("\"", "\"\"")}"`
}

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
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center md:min-h-9 md:min-w-9">
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </label>
  )
}

function FacetSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  allLabel: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 md:min-h-9"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </div>
  )
}

export function MtmOrganizationExplorer({ orgId }: { orgId?: string }) {
  const t = useTranslations("mtmCustomers")
  const tx = useTranslations("mtmCustomers")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeAssignmentHandoff = useMemo(
    () => mtmRouteAssignmentHandoffFromSearchParams(searchParams),
    [searchParams],
  )
  const isRouteOrganizationFlow = Boolean(
    routeAssignmentHandoff && routeAssignmentHandoff.direction !== "DOCTOR",
  )
  const [filters, setFilters] = useState<OrganizationExplorerFilters>(
    EMPTY_ORGANIZATION_FILTERS,
  )
  const [searchDraft, setSearchDraft] = useState("")
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(50)
  const [data, setData] = useState<OrganizationListPayload | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectingAll, setSelectingAll] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<Organization | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Organization | null>(null)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentMode, setAssignmentMode] = useState<"ASSIGN" | "UNASSIGN">("ASSIGN")
  const [targetAgentId, setTargetAgentId] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState(localDateKey)
  const [assignmentReason, setAssignmentReason] = useState("")
  const [preview, setPreview] = useState<AssignmentPreview | null>(null)
  const [assignmentResult, setAssignmentResult] = useState<AssignmentResult | null>(null)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentIdempotencyKey, setAssignmentIdempotencyKey] = useState("")
  const [savedViews, setSavedViews] = useState<OrganizationSavedView[]>([])
  const [activeSavedViewId, setActiveSavedViewId] = useState("")
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [savedViewName, setSavedViewName] = useState("")
  const [savedViewDefault, setSavedViewDefault] = useState(false)
  const [savedViewsBusy, setSavedViewsBusy] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<OrganizationColumn[]>([
    ...MTM_ORGANIZATION_DEFAULT_COLUMNS,
  ])
  const [density, setDensity] = useState<OrganizationDensity>("COMFORTABLE")
  const [columnWidths, setColumnWidths] = useState<Record<OrganizationColumn, number>>({
    ...MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS,
  })
  const [exportBusy, setExportBusy] = useState(false)
  const initialized = useRef(false)
  const initialUrlHadState = useRef(false)
  const defaultSavedViewApplied = useRef(false)
  const latestListRequest = useRef(0)
  const latestFacetRequest = useRef(0)

  const requestHeaders = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": orgId } : {},
    [orgId],
  )

  useEffect(() => {
    if (initialized.current || typeof window === "undefined") return
    initialized.current = true
    const params = new URLSearchParams(window.location.search)
    initialUrlHadState.current = params.size > 0
    const restored = organizationFiltersFromSearchParams(params)
    setFilters(restored)
    setSearchDraft(restored.search)
    const restoredPage = Number.parseInt(params.get("page") ?? "1", 10)
    const restoredLimit = Number.parseInt(params.get("limit") ?? "50", 10)
    if (restoredPage > 1) setPage(restoredPage)
    if (MTM_ORGANIZATION_PAGE_SIZES.includes(
      restoredLimit as (typeof MTM_ORGANIZATION_PAGE_SIZES)[number],
    )) {
      setLimit(restoredLimit)
    }
  }, [])

  const applySavedView = useCallback((view: OrganizationSavedView) => {
    const restored = organizationSavedViewState(view.filters)
    setFilters(restored.filters)
    setSearchDraft(restored.filters.search)
    setPage(1)
    setLimit(restored.limit)
    setVisibleColumns(restored.columns)
    setDensity(restored.density)
    setColumnWidths(restored.columnWidths)
    setSelected(new Set())
    setActiveSavedViewId(view.id)
  }, [])

  const loadSavedViews = useCallback(async () => {
    const response = await fetch("/api/v1/mtm/organizations/views", {
      headers: requestHeaders,
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || tx("explorer.savedViewsLoadError"))
    }
    const views = payload.data.views as OrganizationSavedView[]
    setSavedViews(views)
    if (!defaultSavedViewApplied.current && !initialUrlHadState.current) {
      defaultSavedViewApplied.current = true
      const defaultView = views.find((view) => view.isDefault)
      if (defaultView) applySavedView(defaultView)
    }
  }, [applySavedView, requestHeaders, tx])

  const loadFacets = useCallback(async () => {
    const requestId = latestFacetRequest.current + 1
    latestFacetRequest.current = requestId
    const params = organizationFacetQuery(filters)
    const response = await fetch(`/api/v1/mtm/organizations/facets?${params}`, {
      headers: requestHeaders,
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      if (latestFacetRequest.current !== requestId) return
      throw new Error(payload.error || tx("explorer.facetsError"))
    }
    if (latestFacetRequest.current !== requestId) return
    setFacets(payload.data)
  }, [filters, requestHeaders, tx])

  const loadOrganizations = useCallback(async () => {
    const requestId = latestListRequest.current + 1
    latestListRequest.current = requestId
    setLoading(true)
    setLoadError("")
    const params = organizationQuery(filters, page, limit)
    try {
      const response = await fetch(`/api/v1/mtm/organizations?${params}`, {
        headers: requestHeaders,
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || tx("explorer.loadError"))
      }
      if (latestListRequest.current !== requestId) return
      setData(payload.data)
      if (typeof window !== "undefined") {
        const browserParams = appendMtmRouteAssignmentHandoff(
          new URLSearchParams(params),
          routeAssignmentHandoff,
        )
        window.history.replaceState(null, "", `${window.location.pathname}?${browserParams}`)
      }
    } catch (error) {
      if (latestListRequest.current !== requestId) return
      setLoadError(error instanceof Error ? error.message : tx("explorer.loadError"))
    } finally {
      if (latestListRequest.current === requestId) setLoading(false)
    }
  }, [filters, limit, page, requestHeaders, routeAssignmentHandoff, tx])

  useEffect(() => {
    void loadFacets().catch((error) => {
      toast.error(error instanceof Error ? error.message : tx("explorer.facetsError"))
    })
  }, [loadFacets, tx])

  useEffect(() => {
    void loadSavedViews().catch((error) => {
      toast.error(error instanceof Error ? error.message : tx("explorer.savedViewsLoadError"))
    })
  }, [loadSavedViews, tx])

  useEffect(() => {
    void loadOrganizations()
  }, [loadOrganizations])

  const organizations = data?.organizations ?? []
  const total = data?.total ?? 0
  const pageIds = useMemo(
    () => organizations.map((organization) => organization.id),
    [organizations],
  )
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const selectionScope = selectionScopeLabel({
    selectedCount: selected.size,
    currentPageSelected: selectedOnPage,
    currentPageCount: pageIds.length,
    total,
  })
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const activeAdvancedCount = [
    filters.region,
    filters.administrativeDistrict,
    filters.locality,
    filters.cityDistrict,
    filters.specialization,
    filters.organizationKind,
    filters.territoryCode,
    filters.medicalCategoryCode,
    filters.licenseStatus,
    filters.polygonCode,
    filters.managingManagerId,
    filters.assignedAgentId,
  ].filter(Boolean).length
  const assignedOnPage = organizations.filter(
    (organization) => organization.agentAssignments.length > 0,
  ).length
  const activeFilterLabels = useMemo(() => {
    const items: string[] = []
    const add = (label: string, value: string | null | undefined) => {
      if (value) items.push(`${label}: ${value}`)
    }
    const attributeValue = (
      options: Array<{ code: string; labels: AttributeLabels | null }> | undefined,
      code: string,
      fallback: string,
    ) => code ? attributeLabel(options?.find((item) => item.code === code)?.labels, locale, fallback) : ""

    add(tx("explorer.searchLabel"), filters.search)
    add(tx("explorer.scopeTitle"), filters.scope === "ALL"
      ? tx("explorer.scopeAll")
      : filters.scope === "MINE" ? tx("explorer.scopeMine") : "")
    add(tx("explorer.category"), filters.category)
    add(tx("explorer.status"), filters.status ? tx(`explorer.statuses.${filters.status}`) : "")
    add(tx("explorer.assignment"), filters.assignmentState ? tx(`explorer.assignmentStates.${filters.assignmentState}`) : "")
    add(tx("explorer.objectType"), filters.objectType ? tx(`explorer.objectTypes.${filters.objectType}`) : "")
    add(tx("explorer.region"), filters.region)
    add(tx("explorer.administrativeDistrict"), filters.administrativeDistrict)
    add(tx("explorer.locality"), filters.locality)
    add(tx("explorer.cityDistrict"), filters.cityDistrict)
    add(tx("explorer.specialization"), filters.specialization)
    add(tx("explorer.organizationKind"), filters.organizationKind)
    add(tx("explorer.territory"), filters.territoryCode)
    add(tx("explorer.medicalCategory"), attributeValue(facets?.medicalCategories, filters.medicalCategoryCode, filters.medicalCategoryCode))
    add(tx("explorer.license"), attributeValue(
      facets?.licenseStatuses,
      filters.licenseStatus,
      filters.licenseStatus ? tx(`explorer.licenseStatuses.${filters.licenseStatus}`) : "",
    ))
    add(tx("explorer.polygon"), attributeValue(facets?.polygons, filters.polygonCode, filters.polygonCode))
    add(tx("explorer.manager"), facets?.managers.find((agent) => agent.id === filters.managingManagerId)?.name ?? filters.managingManagerId)
    add(tx("explorer.owner"), facets?.assignableAgents.find((agent) => agent.id === filters.assignedAgentId)?.name ?? filters.assignedAgentId)
    return items
  }, [facets, filters, locale, tx])

  function setFilter<K extends keyof OrganizationExplorerFilters>(
    key: K,
    value: OrganizationExplorerFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    setFilter("search", searchDraft.trim())
  }

  function clearFilters() {
    setFilters(EMPTY_ORGANIZATION_FILTERS)
    setSearchDraft("")
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  async function saveCurrentView() {
    const name = savedViewName.trim()
    if (!name) {
      toast.error(tx("explorer.savedViewNameRequired"))
      return
    }
    setSavedViewsBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/organizations/views", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          filters: organizationSavedViewFilters(filters, limit, density, columnWidths),
          columns: visibleColumns,
          isDefault: savedViewDefault,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || tx("explorer.savedViewSaveError"))
      }
      await loadSavedViews()
      setActiveSavedViewId(payload.data.view.id)
      setSaveViewOpen(false)
      setSavedViewName("")
      setSavedViewDefault(false)
      toast.success(tx("explorer.savedViewSaved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("explorer.savedViewSaveError"))
    } finally {
      setSavedViewsBusy(false)
    }
  }

  async function deleteActiveSavedView() {
    const active = savedViews.find((view) => view.id === activeSavedViewId)
    if (!active?.canDelete) return
    setSavedViewsBusy(true)
    try {
      const response = await fetch(`/api/v1/mtm/organizations/views/${active.id}`, {
        method: "DELETE",
        headers: requestHeaders,
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || tx("explorer.savedViewDeleteError"))
      }
      setActiveSavedViewId("")
      await loadSavedViews()
      toast.success(tx("explorer.savedViewDeleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("explorer.savedViewDeleteError"))
    } finally {
      setSavedViewsBusy(false)
    }
  }

  async function selectAllFiltered() {
    if (total > MTM_ORGANIZATION_BULK_LIMIT) {
      toast.error(tx("explorer.bulkLimit", { count: MTM_ORGANIZATION_BULK_LIMIT }))
      return
    }
    setSelectingAll(true)
    try {
      const allIds: string[] = []
      const requestCount = Math.max(1, Math.ceil(total / 200))
      for (let requestPage = 1; requestPage <= requestCount; requestPage += 1) {
        const params = organizationQuery(filters, requestPage, 200)
        const response = await fetch(`/api/v1/mtm/organizations?${params}`, {
          headers: requestHeaders,
        })
        const payload = await response.json()
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || tx("explorer.selectAllError"))
        }
        allIds.push(...payload.data.organizations.map((item: Organization) => item.id))
      }
      setSelected(new Set(allIds))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("explorer.selectAllError"))
    } finally {
      setSelectingAll(false)
    }
  }

  function openAssignment(mode: "ASSIGN" | "UNASSIGN") {
    setAssignmentMode(mode)
    setTargetAgentId(mode === "ASSIGN" && isRouteOrganizationFlow ? routeAssignmentHandoff?.agentId ?? "" : "")
    setEffectiveFrom(data?.asOf ?? localDateKey())
    setAssignmentReason(mode === "ASSIGN" && isRouteOrganizationFlow ? tx("explorer.routeFlowAssignmentReason") : "")
    setPreview(null)
    setAssignmentResult(null)
    setAssignmentIdempotencyKey(crypto.randomUUID())
    setAssignmentOpen(true)
  }

  async function requestAssignmentPreview() {
    if (selected.size === 0) return
    if (assignmentMode === "ASSIGN" && !targetAgentId) {
      toast.error(tx("explorer.targetRequired"))
      return
    }
    if (assignmentReason.trim().length < 3) {
      toast.error(tx("explorer.reasonRequired"))
      return
    }
    setAssignmentBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/organization-assignments/preview", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationIds: [...selected],
          mode: assignmentMode,
          targetAgentId: assignmentMode === "ASSIGN" ? targetAgentId : null,
          effectiveFrom,
          reason: assignmentReason.trim(),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || tx("explorer.previewError"))
      }
      setPreview(payload.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("explorer.previewError"))
    } finally {
      setAssignmentBusy(false)
    }
  }

  async function applyAssignment() {
    if (!preview) return
    setAssignmentBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/organization-assignments", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationIds: [...selected],
          mode: assignmentMode,
          targetAgentId: assignmentMode === "ASSIGN" ? targetAgentId : null,
          effectiveFrom,
          reason: assignmentReason.trim(),
          previewToken: preview.previewToken,
          idempotencyKey: assignmentIdempotencyKey,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || tx("explorer.applyError"))
      }
      setAssignmentResult(payload.data)
      setSelected(new Set())
      void Promise.allSettled([loadOrganizations(), loadFacets()])
      if (
        isRouteOrganizationFlow
        && assignmentMode === "ASSIGN"
        && payload.data?.summary?.changed > 0
        && routeAssignmentHandoff
      ) {
        toast.success(tx("explorer.routeFlowReturningToRoute", { count: payload.data.summary.changed }))
        router.push(routeAssignmentHandoff.returnTo)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : tx("explorer.applyError")
      toast.error(message)
      setPreview(null)
    } finally {
      setAssignmentBusy(false)
    }
  }

  function columnLabel(column: OrganizationColumn): string {
    return tx(`explorer.columns.${column}`)
  }

  function columnValue(organization: Organization, column: OrganizationColumn): string | number | null {
    switch (column) {
      case "code": return organization.code
      case "organization": return [organization.name, organization.address].filter(Boolean).join(" — ")
      case "type": return organization.organizationKind || tx(`explorer.objectTypes.${organization.objectType}`)
      case "category": return [organization.category, organization.specialization].filter(Boolean).join(" — ")
      case "medicalCategory": {
        const attribute = organization.attributeFacts[0]
        return attribute?.medicalCategoryCode
          ? attributeLabel(attribute.medicalCategoryLabels, locale, attribute.medicalCategoryCode)
          : null
      }
      case "license": {
        const attribute = organization.attributeFacts[0]
        return attribute?.licenseStatus
          ? attributeLabel(attribute.licenseLabels, locale, tx(`explorer.licenseStatuses.${attribute.licenseStatus}`))
          : null
      }
      case "location": return [organization.locality || organization.city, organization.region].filter(Boolean).join(", ")
      case "owner": return organization.agentAssignments.map((item) => item.agent.name).join("; ") || tx("explorer.free")
      case "lastVisit": return organization.visits[0]?.checkInAt ?? null
      case "nextVisit": return organization.routePoints[0]?.plannedTime
        ?? organization.routePoints[0]?.route.date
        ?? null
      case "activity": return tx("explorer.mobileActivity", {
        contacts: organization._count.contactWorkplaces,
        visits: organization._count.visits,
      })
    }
  }

  function downloadOrganizations(rowsToExport: Organization[], fileName: string) {
    const rows = [
      visibleColumns.map(columnLabel),
      ...rowsToExport.map((organization) => visibleColumns.map((column) => columnValue(organization, column))),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    const anchor = document.createElement("a")
    anchor.href = URL.createObjectURL(blob)
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  async function exportAllFiltered() {
    if (total > MTM_ORGANIZATION_BULK_LIMIT) {
      toast.error(tx("explorer.exportFilteredLimit", { count: MTM_ORGANIZATION_BULK_LIMIT }))
      return
    }
    setExportBusy(true)
    try {
      const allRows: Organization[] = []
      const requestCount = Math.max(1, Math.ceil(total / 200))
      for (let requestPage = 1; requestPage <= requestCount; requestPage += 1) {
        const params = organizationQuery(filters, requestPage, 200)
        const response = await fetch(`/api/v1/mtm/organizations?${params}`, { headers: requestHeaders })
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error || tx("explorer.exportError"))
        allRows.push(...payload.data.organizations)
      }
      downloadOrganizations(allRows, "mtm-organizations-filtered.csv")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx("explorer.exportError"))
    } finally {
      setExportBusy(false)
    }
  }

  function toggleColumn(column: OrganizationColumn, checked: boolean) {
    if (column === "organization") return
    setVisibleColumns((current) => {
      if (!checked) return current.filter((entry) => entry !== column)
      if (current.includes(column)) return current
      if (column === "code") return [column, ...current]
      return [...current, column]
    })
    setActiveSavedViewId("")
  }

  function moveColumn(column: OrganizationColumn, direction: -1 | 1) {
    setVisibleColumns((current) => {
      const index = current.indexOf(column)
      const target = index + direction
      const fixedColumns = current.filter((entry) => entry === "code" || entry === "organization").length
      if (index < fixedColumns || target < fixedColumns || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setActiveSavedViewId("")
  }

  function resizeColumn(column: OrganizationColumn, delta: number) {
    setColumnWidths((current) => ({
      ...current,
      [column]: Math.min(
        MTM_ORGANIZATION_COLUMN_MAX_WIDTH,
        Math.max(MTM_ORGANIZATION_COLUMN_MIN_WIDTH, current[column] + delta),
      ),
    }))
    setActiveSavedViewId("")
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const response = await fetch(`/api/v1/mtm/organizations/${deleteItem.id}`, {
      method: "DELETE",
      headers: requestHeaders,
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || tx("explorer.deleteError"))
    await loadOrganizations()
  }

  const formatNumber = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const visitDate = useMemo(() => createDateFormatter(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }), [locale])
  const visitDateTime = useMemo(() => createDateFormatter(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }), [locale])
  const selectionColumnWidth = 72
  const actionColumnWidth = 288
  const gridWidth = visibleColumns.reduce((sum, column) => sum + columnWidths[column], selectionColumnWidth + actionColumnWidth)
  const organizationStickyLeft = selectionColumnWidth + (visibleColumns.includes("code") ? columnWidths.code : 0)
  const densityCellClass = density === "COMPACT" ? "px-2 py-1.5" : "px-3 py-3"
  const densitySubtextClass = density === "COMPACT" ? "text-[11px] leading-4" : "text-xs leading-5"
  const columnStyle = (column: OrganizationColumn): CSSProperties => ({
    width: columnWidths[column],
    minWidth: columnWidths[column],
    maxWidth: columnWidths[column],
    ...(column === "code" ? { position: "sticky", left: selectionColumnWidth, zIndex: 12 } : {}),
    ...(column === "organization" ? { position: "sticky", left: organizationStickyLeft, zIndex: 11 } : {}),
  })

  function handleGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-grid-cell]")
    if (!cell) return
    const row = Number(cell.dataset.row)
    const column = Number(cell.dataset.column)
    let nextRow = row
    let nextColumn = column
    if (event.key === "ArrowDown") nextRow += 1
    else if (event.key === "ArrowUp") nextRow -= 1
    else if (event.key === "ArrowRight") nextColumn += 1
    else if (event.key === "ArrowLeft") nextColumn -= 1
    else if (event.key === "Home") nextColumn = 0
    else if (event.key === "End") nextColumn = visibleColumns.length - 1
    else return
    const next = event.currentTarget.querySelector<HTMLElement>(
      `[data-grid-cell][data-row="${nextRow}"][data-column="${nextColumn}"]`,
    )
    if (!next) return
    event.preventDefault()
    next.focus()
  }
  const categoryOptions = ["A", "B", "C", "D"].map((value) => ({
    value,
    label: tx(`explorer.categories.${value}`),
  }))
  const listReturnPath = `${pathname}?${appendMtmRouteAssignmentHandoff(
    new URLSearchParams(organizationQuery(filters, page, limit)),
    routeAssignmentHandoff,
  ).toString()}`
  const organizationHref = (id: string) =>
    `/mtm/customers/${id}?returnTo=${encodeURIComponent(listReturnPath)}`
  const routePlanningHref = (id: string) => mtmRoutePlanningHref({
    customerId: id,
    returnTo: listReturnPath,
  })
  const selectedOrganizationId = selected.size === 1
    ? selected.values().next().value ?? null
    : null
  const routeAssignmentAgent = facets?.assignableAgents.find((agent) => agent.id === routeAssignmentHandoff?.agentId)
  const effectiveScope = filters.scope || data?.effectiveScope || "ALL"
  const hasNarrowingFilters = activeFilterLabels.length > (filters.scope ? 1 : 0)
  const emptyMineAssignmentGap = effectiveScope === "MINE" && !hasNarrowingFilters
  const canOpenAllScope = data?.capabilities.actorRole !== "AGENT"
  const activeSavedView = savedViews.find((view) => view.id === activeSavedViewId)

  function setExplorerScope(scope: "ALL" | "MINE") {
    setFilters((current) => ({
      ...current,
      scope,
      assignedAgentId: "",
      assignmentState: "",
    }))
    setPage(1)
    setSelected(new Set())
    setActiveSavedViewId("")
  }

  return (
    <div
      data-testid="mtm-organization-explorer"
      data-effective-scope={effectiveScope}
      aria-busy={loading}
      className="space-y-4"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <PageDescription
            icon={Building2}
            title={tx("explorer.title")}
            description={tx("explorer.subtitle")}
          />
          <HelpButton slug="mtm-customers" variant="label" />
        </div>
        <div className="flex flex-wrap gap-2">
          <details className="group relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground marker:hidden md:min-h-9">
              <Download className="mr-2 h-4 w-4" />
              {tx("explorer.exportOptions")}
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 grid w-72 gap-2 rounded-xl border border-zinc-200 bg-card p-2 shadow-xl dark:border-zinc-700">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 justify-start"
                onClick={() => downloadOrganizations(organizations, `mtm-organizations-page-${page}.csv`)}
                disabled={organizations.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                {tx("explorer.exportPage")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 justify-start"
                onClick={() => void exportAllFiltered()}
                disabled={organizations.length === 0 || exportBusy}
                title={total > MTM_ORGANIZATION_BULK_LIMIT ? tx("explorer.exportFilteredLimit", { count: MTM_ORGANIZATION_BULK_LIMIT }) : undefined}
              >
                <Download className="mr-2 h-4 w-4" />
                {exportBusy ? tx("explorer.exporting") : tx("explorer.exportFiltered")}
              </Button>
            </div>
          </details>
          {data?.capabilities.canManage ? (
            <Button
              size="sm"
              className="min-h-11 md:min-h-9"
              onClick={() => {
                setEditData(undefined)
                setFormOpen(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          ) : null}
        </div>
      </div>

      <MtmWorkflowGuide
        title={tx("explorer.clarityGuide.title")}
        description={tx("explorer.clarityGuide.description")}
        steps={[
          { title: tx("explorer.search"), icon: Search },
          { title: tx("explorer.scopeTitle"), icon: UserRoundCheck },
          { title: tx("explorer.addToRoute"), icon: CalendarPlus },
        ]}
      />

      {isRouteOrganizationFlow && routeAssignmentHandoff ? (
        <section data-testid="mtm-route-assignment-handoff" className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{tx("explorer.routeFlowTitle")}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {tx("explorer.routeFlowDescription", {
                agent: routeAssignmentAgent?.name ?? tx("explorer.routeFlowEmployeeFallback"),
                date: routeAssignmentHandoff.date,
              })}
            </p>
          </div>
          <Button asChild type="button" variant="outline" className="min-h-11 shrink-0">
            <Link href={routeAssignmentHandoff.returnTo}>{tx("explorer.routeFlowBack")}</Link>
          </Button>
        </section>
      ) : null}

      <section
        aria-label={tx("explorer.summary")}
        className="grid grid-cols-2 divide-x divide-y rounded-xl border border-zinc-200 bg-card dark:border-zinc-700 sm:grid-cols-4 sm:divide-y-0"
      >
        {[
          [tx("explorer.found"), formatNumber.format(total)],
          [tx("explorer.selected"), formatNumber.format(selected.size)],
          [tx("explorer.assignedOnPage"), formatNumber.format(assignedOnPage)],
          [tx("explorer.unassignedOnPage"), formatNumber.format(organizations.length - assignedOnPage)],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </section>

      <section
        aria-label={tx("explorer.scopeTitle")}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-sm font-semibold">{tx("explorer.scopeTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {tx(effectiveScope === "MINE" ? "explorer.scopeMineHint" : "explorer.scopeAllHint")}
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label={tx("explorer.scopeTitle")}>
          <Button
            type="button"
            variant={effectiveScope === "ALL" ? "default" : "outline"}
            className="min-h-11 md:min-h-9"
            onClick={() => setExplorerScope("ALL")}
          >
            {tx("explorer.scopeAll")}
          </Button>
          {data?.capabilities.actorAgentId ? (
            <Button
              type="button"
              variant={effectiveScope === "MINE" ? "default" : "outline"}
              className="min-h-11 md:min-h-9"
              onClick={() => setExplorerScope("MINE")}
            >
              {tx("explorer.scopeMine")}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
        <details className="group border-b border-zinc-200 dark:border-zinc-700">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium marker:hidden">
            <Bookmark className="h-4 w-4 text-muted-foreground" />
            {tx("explorer.savedViews")}
            {activeSavedView ? <span className="max-w-[14rem] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary" title={activeSavedView.name}>{activeSavedView.name}</span> : null}
          </summary>
          <div className="flex flex-col gap-3 border-t border-zinc-200 p-3 dark:border-zinc-700 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-md">
              <Label htmlFor="organization-saved-view" className="text-xs text-muted-foreground">
                {tx("explorer.savedViews")}
              </Label>
              <Select
                id="organization-saved-view"
                value={activeSavedViewId}
                onChange={(event) => {
                  const view = savedViews.find((item) => item.id === event.target.value)
                  if (view) applySavedView(view)
                  else setActiveSavedViewId("")
                }}
                className="min-h-11 md:min-h-9"
                disabled={savedViewsBusy}
              >
                <option value="">{tx("explorer.savedViewsPlaceholder")}</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.isDefault ? `★ ${view.name}` : view.name}
                    {view.isShared ? ` · ${tx("explorer.sharedView")}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              {savedViews.find((view) => view.id === activeSavedViewId)?.canDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-destructive md:min-h-9"
                  disabled={savedViewsBusy}
                  onClick={() => void deleteActiveSavedView()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tx("explorer.deleteSavedView")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-9"
                disabled={savedViewsBusy}
                onClick={() => {
                  setSavedViewName("")
                  setSavedViewDefault(false)
                  setSaveViewOpen(true)
                }}
              >
                <Bookmark className="mr-2 h-4 w-4" />
                {tx("explorer.saveCurrentView")}
              </Button>
            </div>
          </div>
        </details>
        <form
          onSubmit={submitSearch}
          className="flex flex-col gap-3 border-b border-zinc-200 p-3 dark:border-zinc-700 lg:flex-row lg:items-end"
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="organization-search" className="text-xs text-muted-foreground">
              {tx("explorer.searchLabel")}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="organization-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={tx("explorer.searchPlaceholder")}
                  className="min-h-11 pl-9 md:min-h-9"
                />
              </div>
              <Button type="submit" className="min-h-11 md:min-h-9">
                {tx("explorer.search")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[42rem]">
            <FacetSelect
              id="organization-category"
              label={tx("explorer.category")}
              value={filters.category}
              allLabel={tx("explorer.all")}
              options={categoryOptions}
              onChange={(value) => setFilter("category", value)}
            />
            <FacetSelect
              id="organization-status"
              label={tx("explorer.status")}
              value={filters.status}
              allLabel={tx("explorer.all")}
              options={["ACTIVE", "INACTIVE", "PROSPECT"].map((value) => ({
                value,
                label: tx(`explorer.statuses.${value}`),
              }))}
              onChange={(value) => setFilter("status", value)}
            />
            <FacetSelect
              id="organization-assignment"
              label={tx("explorer.assignment")}
              value={filters.assignmentState}
              allLabel={tx("explorer.all")}
              options={["ASSIGNED", "UNASSIGNED"].map((value) => ({
                value,
                label: tx(`explorer.assignmentStates.${value}`),
              }))}
              onChange={(value) => setFilter("assignmentState", value)}
            />
            <FacetSelect
              id="organization-object-type"
              label={tx("explorer.objectType")}
              value={filters.objectType}
              allLabel={tx("explorer.all")}
              options={["PHARMACY", "CLINIC", "STORE", "OTHER"].map((value) => ({
                value,
                label: tx(`explorer.objectTypes.${value}`),
              }))}
              onChange={(value) => setFilter("objectType", value)}
            />
          </div>
        </form>

        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium marker:hidden">
            <span className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {tx("explorer.advancedFilters")}
              {activeAdvancedCount > 0 ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {activeAdvancedCount}
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">{tx("explorer.show")}</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">{tx("explorer.hide")}</span>
          </summary>
          <div className="grid gap-3 border-t border-zinc-200 p-3 dark:border-zinc-700 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <FacetSelect id="organization-region" label={tx("explorer.region")} value={filters.region} allLabel={tx("explorer.all")} options={(facets?.region ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("region", value)} />
            <FacetSelect id="organization-administrative-district" label={tx("explorer.administrativeDistrict")} value={filters.administrativeDistrict} allLabel={tx("explorer.all")} options={(facets?.administrativeDistrict ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("administrativeDistrict", value)} />
            <FacetSelect id="organization-locality" label={tx("explorer.locality")} value={filters.locality} allLabel={tx("explorer.all")} options={(facets?.locality ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("locality", value)} />
            <FacetSelect id="organization-city-district" label={tx("explorer.cityDistrict")} value={filters.cityDistrict} allLabel={tx("explorer.all")} options={(facets?.cityDistrict ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("cityDistrict", value)} />
            <FacetSelect id="organization-specialization" label={tx("explorer.specialization")} value={filters.specialization} allLabel={tx("explorer.all")} options={(facets?.specialization ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("specialization", value)} />
            <FacetSelect id="organization-kind" label={tx("explorer.organizationKind")} value={filters.organizationKind} allLabel={tx("explorer.all")} options={(facets?.organizationKind ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("organizationKind", value)} />
            <FacetSelect id="organization-territory" label={tx("explorer.territory")} value={filters.territoryCode} allLabel={tx("explorer.all")} options={(facets?.territoryCode ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilter("territoryCode", value)} />
            <FacetSelect id="organization-medical-category" label={tx("explorer.medicalCategory")} value={filters.medicalCategoryCode} allLabel={tx("explorer.all")} options={(facets?.medicalCategories ?? []).map((item) => ({ value: item.code, label: attributeLabel(item.labels, locale, item.code) }))} onChange={(value) => setFilter("medicalCategoryCode", value)} />
            <FacetSelect id="organization-license" label={tx("explorer.license")} value={filters.licenseStatus} allLabel={tx("explorer.all")} options={(facets?.licenseStatuses ?? []).map((item) => ({ value: item.code, label: attributeLabel(item.labels, locale, tx(`explorer.licenseStatuses.${item.code}`)) }))} onChange={(value) => setFilter("licenseStatus", value)} />
            <FacetSelect id="organization-polygon" label={tx("explorer.polygon")} value={filters.polygonCode} allLabel={tx("explorer.all")} options={(facets?.polygons ?? []).map((item) => ({ value: item.code, label: attributeLabel(item.labels, locale, item.code) }))} onChange={(value) => setFilter("polygonCode", value)} />
            <FacetSelect id="organization-manager" label={tx("explorer.manager")} value={filters.managingManagerId} allLabel={tx("explorer.all")} options={(facets?.managers ?? []).map((agent) => ({ value: agent.id, label: agent.name }))} onChange={(value) => setFilter("managingManagerId", value)} />
            <FacetSelect id="organization-agent" label={tx("explorer.owner")} value={filters.assignedAgentId} allLabel={tx("explorer.all")} options={(facets?.assignableAgents ?? []).map((agent) => ({ value: agent.id, label: agent.name }))} onChange={(value) => setFilter("assignedAgentId", value)} />
            <div className="flex items-end">
              <Button type="button" variant="ghost" className="min-h-11 w-full md:min-h-9" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                {tx("explorer.clearFilters")}
              </Button>
            </div>
          </div>
        </details>
      </section>

      {selected.size > 0 ? (
        <section
          aria-live="polite"
          className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {tx("explorer.selectionCount", { count: selected.size })}
            </p>
            <p className="text-xs text-muted-foreground">
              {tx(`explorer.selectionScopes.${selectionScope}`)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedOrganizationId && !isRouteOrganizationFlow ? (
              <Button asChild size="sm" className="min-h-11 md:min-h-9">
                <Link href={routePlanningHref(selectedOrganizationId)}>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  {tx("explorer.addToRoute")}
                </Link>
              </Button>
            ) : null}
            {selectionScope !== "ALL_FILTERED" && total <= MTM_ORGANIZATION_BULK_LIMIT ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-9"
                disabled={selectingAll}
                onClick={() => void selectAllFiltered()}
              >
                {selectingAll ? tx("explorer.selectingAll") : tx("explorer.selectAllFiltered", { count: total })}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="min-h-11 md:min-h-9" onClick={() => setSelected(new Set())}>
              {tx("explorer.clearSelection")}
            </Button>
            {data?.capabilities.canManage && isRouteOrganizationFlow ? (
              <Button data-testid="mtm-organization-assign-open" size="sm" className="min-h-11 md:min-h-9" onClick={() => openAssignment("ASSIGN")}>
                <UserRoundCheck className="mr-2 h-4 w-4" />
                {tx("explorer.routeFlowAssignAndReturn")}
              </Button>
            ) : data?.capabilities.canManage ? (
              <>
                <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={() => openAssignment("UNASSIGN")}>
                  {tx("explorer.unassign")}
                </Button>
                <Button data-testid="mtm-organization-assign-open" size="sm" className="min-h-11 md:min-h-9" onClick={() => openAssignment("ASSIGN")}>
                  <UserRoundCheck className="mr-2 h-4 w-4" />
                  {tx("explorer.assign")}
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{tx("explorer.asOf", { date: data?.asOf ?? facets?.asOf ?? "—" })}</span>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            onClick={() => void Promise.allSettled([loadOrganizations(), loadFacets()])}
            aria-label={tx("explorer.refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FacetSelect
            id="organization-sort"
            label={tx("explorer.sort")}
            value={filters.sort}
            allLabel={tx("explorer.all")}
            options={[
              { value: "name", label: tx("explorer.sorts.name") },
              { value: "updatedAt", label: tx("explorer.sorts.updatedAt") },
              { value: "city", label: tx("explorer.sorts.city") },
              { value: "category", label: tx("explorer.sorts.category") },
              { value: "status", label: tx("explorer.sorts.status") },
            ]}
            onChange={(value) => {
              if (value) setFilter("sort", value as OrganizationExplorerFilters["sort"])
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            onClick={() => setFilter("direction", filters.direction === "asc" ? "desc" : "asc")}
            aria-label={filters.direction === "asc" ? tx("explorer.descending") : tx("explorer.ascending")}
          >
            {filters.direction === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
          </Button>
          <details className="group relative">
            <summary
              className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium marker:hidden md:min-h-9"
              data-testid="mtm-organization-grid-settings"
            >
              <span>{tx("explorer.configureGrid")}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {tx(`explorer.densities.${density}`)}
              </span>
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] border border-zinc-200 bg-popover p-3 text-popover-foreground shadow-lg dark:border-zinc-700">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-700">
                <span className="text-sm font-semibold">{tx("explorer.density")}</span>
                <div className="flex gap-1" role="group" aria-label={tx("explorer.density")}>
                  {(["COMPACT", "COMFORTABLE"] as OrganizationDensity[]).map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={density === value ? "default" : "outline"}
                      className="min-h-9"
                      data-testid={`mtm-organization-density-${value.toLowerCase()}`}
                      aria-pressed={density === value}
                      onClick={() => {
                        setDensity(value)
                        setActiveSavedViewId("")
                      }}
                    >
                      {tx(`explorer.densities.${value}`)}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-1" aria-label={tx("explorer.visibleColumns")}>
                {MTM_ORGANIZATION_COLUMNS.map((column) => {
                  const visible = visibleColumns.includes(column)
                  const position = visibleColumns.indexOf(column)
                  const fixedCount = visibleColumns.filter((entry) => entry === "code" || entry === "organization").length
                  return (
                    <div key={column} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-zinc-100 py-1 last:border-0 dark:border-zinc-800">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={visible}
                          disabled={column === "organization"}
                          onChange={(event) => toggleColumn(column, event.target.checked)}
                          className="h-4 w-4 rounded border-zinc-300 accent-primary"
                        />
                        <span className="truncate">{columnLabel(column)}</span>
                      </label>
                      <div className="flex" aria-label={tx("explorer.columnOrder", { column: columnLabel(column) })}>
                        <Button type="button" variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" disabled={!visible || position < fixedCount} onClick={() => moveColumn(column, -1)} aria-label={tx("explorer.moveColumnLeft", { column: columnLabel(column) })}>←</Button>
                        <Button type="button" variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" disabled={!visible || position < fixedCount || position >= visibleColumns.length - 1} onClick={() => moveColumn(column, 1)} aria-label={tx("explorer.moveColumnRight", { column: columnLabel(column) })}>→</Button>
                      </div>
                      <div className="flex items-center" aria-label={tx("explorer.columnWidth", { column: columnLabel(column), width: columnWidths[column] })}>
                        <Button type="button" variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" disabled={columnWidths[column] <= MTM_ORGANIZATION_COLUMN_MIN_WIDTH} onClick={() => resizeColumn(column, -24)} aria-label={tx("explorer.narrowColumn", { column: columnLabel(column) })}>−</Button>
                        <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">{columnWidths[column]}</span>
                        <Button type="button" variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" disabled={columnWidths[column] >= MTM_ORGANIZATION_COLUMN_MAX_WIDTH} onClick={() => resizeColumn(column, 24)} aria-label={tx("explorer.widenColumn", { column: columnLabel(column) })}>+</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{tx("explorer.gridSettingsHint")}</p>
            </div>
          </details>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{tx("explorer.optionalAttributesHint")}</p>

      {loading ? (
        <div className="space-y-2" aria-label={tx("explorer.loading")}>
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : loadError ? (
        <div className="grid min-h-52 place-items-center rounded-xl border border-zinc-200 bg-card p-6 text-center dark:border-zinc-700">
          <div className="grid max-w-md gap-3">
            <p className="font-semibold">{tx("explorer.loadFailed")}</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" onClick={() => void loadOrganizations()}>{tx("explorer.retry")}</Button>
          </div>
        </div>
      ) : organizations.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-xl border border-zinc-200 bg-card p-6 text-center dark:border-zinc-700">
          <div className="grid max-w-md gap-3">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">
              {tx(emptyMineAssignmentGap ? "explorer.emptyMineTitle" : "explorer.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {tx(emptyMineAssignmentGap
                ? canOpenAllScope ? "explorer.emptyMineDescription" : "explorer.emptyMineAgentDescription"
                : "explorer.emptyDescription")}
            </p>
            {activeFilterLabels.length > 0 ? (
              <div aria-label={tx("explorer.emptyActiveFilters")} className="flex flex-wrap justify-center gap-1.5">
                {activeFilterLabels.map((label) => (
                  <span key={label} className="rounded-full border border-zinc-200 bg-muted/60 px-2 py-1 text-xs text-muted-foreground dark:border-zinc-700">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            {emptyMineAssignmentGap && canOpenAllScope ? (
              <Button
                type="button"
                onClick={() => setExplorerScope("ALL")}
                data-testid="mtm-organizations-open-all"
              >
                {tx("explorer.openAllOrganizations")}
              </Button>
            ) : hasNarrowingFilters ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                {tx("explorer.clearFilters")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700 md:block">
            <div data-testid="mtm-organization-grid-scroll" className="max-h-[62vh] overflow-auto">
              <table
                className={`w-full table-fixed border-collapse ${density === "COMPACT" ? "text-xs" : "text-sm"}`}
                style={{ minWidth: gridWidth }}
                onKeyDown={handleGridKeyDown}
                aria-label={tx("explorer.gridLabel")}
                data-density={density}
              >
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                    <th className="sticky left-0 z-20 bg-muted px-1" style={{ width: selectionColumnWidth, minWidth: selectionColumnWidth }}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="pl-2 text-[10px] font-semibold text-muted-foreground">№</span>
                        <FieldCheckbox
                          checked={allPageSelected}
                          indeterminate={selectedOnPage > 0 && !allPageSelected}
                          label={allPageSelected ? tx("explorer.deselectPage") : tx("explorer.selectPage")}
                          onChange={(checked) => setSelected((current) => updatePageSelection(current, pageIds, checked))}
                        />
                      </div>
                    </th>
                    {visibleColumns.map((column) => (
                      <th key={column} data-column={column} className={`${densityCellClass} bg-muted text-xs font-semibold`} style={columnStyle(column)} scope="col">
                        {columnLabel(column)}
                      </th>
                    ))}
                    <th data-column="actions" className="bg-muted px-3 py-2 text-right text-xs font-semibold xl:sticky xl:right-0 xl:z-20" style={{ width: actionColumnWidth, minWidth: actionColumnWidth }}>
                      {tx("explorer.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization, rowIndex) => {
                    const lastVisit = organization.visits[0]
                    const nextVisit = organization.routePoints[0]
                    const attributes = organization.attributeFacts[0]
                    return (
                      <tr
                        key={organization.id}
                        className="group border-b border-zinc-200 align-top transition-colors last:border-0 hover:bg-muted/40 dark:border-zinc-700"
                        style={{ contentVisibility: "auto", containIntrinsicSize: density === "COMPACT" ? "44px" : "64px" }}
                      >
                        <td className="sticky left-0 z-20 bg-card px-1 group-hover:bg-muted" style={{ width: selectionColumnWidth, minWidth: selectionColumnWidth }}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="pl-2 text-[10px] tabular-nums text-muted-foreground">{(page - 1) * limit + rowIndex + 1}</span>
                            <FieldCheckbox
                              checked={selected.has(organization.id)}
                              testId={`mtm-organization-select-${organization.id}`}
                              label={tx("explorer.selectOrganization", { name: organization.name })}
                              onChange={(checked) => setSelected((current) => {
                                const next = new Set(current)
                                if (checked) next.add(organization.id)
                                else next.delete(organization.id)
                                return next
                              })}
                            />
                          </div>
                        </td>
                        {visibleColumns.map((column, columnIndex) => (
                          <td
                            key={column}
                            className={`${densityCellClass} ${column === "code" || column === "organization" ? "bg-card group-hover:bg-muted" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                            style={columnStyle(column)}
                            tabIndex={columnIndex === 0 ? 0 : -1}
                            data-grid-cell
                            data-row={rowIndex}
                            data-column={columnIndex}
                          >
                            {column === "code" ? (
                              <span className="font-medium tabular-nums">{organization.code || "—"}</span>
                            ) : column === "organization" ? (
                              <div className="grid min-w-0 gap-0.5">
                                <Link href={organizationHref(organization.id)} className="truncate font-semibold underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  {organization.name}
                                </Link>
                                <span className={`${densitySubtextClass} line-clamp-2 text-muted-foreground`}>{organization.address || "—"}</span>
                              </div>
                            ) : column === "type" ? (
                              <span className="line-clamp-2">{organization.organizationKind || tx(`explorer.objectTypes.${organization.objectType}`)}</span>
                            ) : column === "category" ? (
                              <div className="grid gap-0.5">
                                <span className="font-medium">{organization.category}</span>
                                {organization.specialization ? <span className={`${densitySubtextClass} truncate text-muted-foreground`}>{organization.specialization}</span> : null}
                              </div>
                            ) : column === "medicalCategory" ? (
                              attributes?.medicalCategoryCode ? (
                                <span title={tx("explorer.signedAttributeSource", { source: attributes.package.sourceSystem, version: attributes.package.version })}>
                                  {attributeLabel(attributes.medicalCategoryLabels, locale, attributes.medicalCategoryCode)}
                                </span>
                              ) : <span className="text-muted-foreground" title={tx("explorer.optionalAttributesHint")}>{tx("explorer.notProvided")}</span>
                            ) : column === "license" ? (
                              attributes?.licenseStatus ? (
                                <span title={tx("explorer.signedAttributeSource", { source: attributes.package.sourceSystem, version: attributes.package.version })}>
                                  {attributeLabel(attributes.licenseLabels, locale, tx(`explorer.licenseStatuses.${attributes.licenseStatus}`))}
                                </span>
                              ) : <span className="text-muted-foreground" title={tx("explorer.optionalAttributesHint")}>{tx("explorer.notProvided")}</span>
                            ) : column === "location" ? (
                              <div className="flex min-w-0 items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                                <span className="line-clamp-2">{[organization.locality || organization.city, organization.region].filter(Boolean).join(", ") || "—"}</span>
                              </div>
                            ) : column === "owner" ? (
                              organization.agentAssignments.length > 0 ? (
                                <div className="grid gap-0.5">
                                  {organization.agentAssignments.map((assignment) => <span key={assignment.id} className="truncate">{assignment.agent.name}</span>)}
                                </div>
                              ) : <span className="font-medium text-amber-800 dark:text-amber-300">{tx("explorer.free")}</span>
                            ) : column === "lastVisit" ? (
                              lastVisit ? (
                                <Link href={`/mtm/visits?visitId=${encodeURIComponent(lastVisit.id)}&returnTo=${encodeURIComponent(listReturnPath)}`} className="grid gap-0.5 tabular-nums hover:text-primary hover:underline">
                                  <span>{visitDate.format(new Date(lastVisit.checkInAt))}</span>
                                  <span className={`${densitySubtextClass} truncate text-muted-foreground`}>{lastVisit.agent.name}</span>
                                </Link>
                              ) : <span className="text-muted-foreground">{tx("explorer.noVisits")}</span>
                            ) : column === "nextVisit" ? (
                              nextVisit ? (
                                <Link href={`/mtm/routes?routeId=${encodeURIComponent(nextVisit.routeId)}&returnTo=${encodeURIComponent(listReturnPath)}`} className="grid gap-0.5 tabular-nums hover:text-primary hover:underline">
                                  <span>{nextVisit.plannedTime
                                    ? visitDateTime.format(new Date(nextVisit.plannedTime))
                                    : visitDate.format(new Date(nextVisit.route.date))}</span>
                                  <span className={`${densitySubtextClass} truncate text-muted-foreground`}>{tx(`explorer.routeStatuses.${nextVisit.route.status}`)}</span>
                                </Link>
                              ) : <span className="text-muted-foreground">{tx("explorer.notPlanned")}</span>
                            ) : (
                              <div className={`${densitySubtextClass} grid gap-0.5 tabular-nums text-muted-foreground`}>
                                <span>{tx("explorer.contactsCount", { count: organization._count.contactWorkplaces })}</span>
                                <span>{tx("explorer.visitsCount", { count: organization._count.visits })}</span>
                              </div>
                            )}
                          </td>
                        ))}
                        <td className="bg-card px-2 py-1 group-hover:bg-muted xl:sticky xl:right-0 xl:z-20" style={{ width: actionColumnWidth, minWidth: actionColumnWidth }}>
                          <div className="flex justify-end gap-1">
                            <Button asChild variant="outline" size="sm" className="min-h-11 whitespace-nowrap md:min-h-9">
                              <Link
                                href={routePlanningHref(organization.id)}
                                aria-label={tx("explorer.addToRouteFor", { name: organization.name })}
                                data-testid={`mtm-add-organization-to-route-${organization.id}`}
                              >
                                <CalendarPlus className="mr-2 h-4 w-4" />
                                {tx("explorer.addToRoute")}
                              </Link>
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                              <Link href={organizationHref(organization.id)} aria-label={tx("explorer.openOrganization", { name: organization.name })}>
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                            {data?.capabilities.canManage ? (
                              <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
                                aria-label={tx("explorer.editOrganization", { name: organization.name })}
                                onClick={() => {
                                  setEditData(organization)
                                  setFormOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11 text-destructive md:min-h-9 md:min-w-9"
                                aria-label={tx("explorer.deleteOrganization", { name: organization.name })}
                                onClick={() => {
                                  setDeleteItem(organization)
                                  setDeleteOpen(true)
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-2 md:hidden">
            <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-card px-2 dark:border-zinc-700">
              <span className="px-2 text-sm font-medium">{tx("explorer.pageSelection")}</span>
              <FieldCheckbox
                checked={allPageSelected}
                indeterminate={selectedOnPage > 0 && !allPageSelected}
                label={allPageSelected ? tx("explorer.deselectPage") : tx("explorer.selectPage")}
                onChange={(checked) => setSelected((current) => updatePageSelection(current, pageIds, checked))}
              />
            </div>
            {organizations.map((organization, rowIndex) => {
              const owners = organization.agentAssignments.map((item) => item.agent.name)
              const lastVisit = organization.visits[0]
              const nextVisit = organization.routePoints[0]
              const attributes = organization.attributeFacts[0]
              return (
                <article key={organization.id} data-testid="mtm-organization-card" className="rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                  <div className="flex items-start gap-2">
                    <FieldCheckbox
                      checked={selected.has(organization.id)}
                      testId={`mtm-organization-select-${organization.id}`}
                      label={tx("explorer.selectOrganization", { name: organization.name })}
                      onChange={(checked) => setSelected((current) => {
                        const next = new Set(current)
                        if (checked) next.add(organization.id)
                        else next.delete(organization.id)
                        return next
                      })}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">
                        <Link
                          href={organizationHref(organization.id)}
                          className="underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {organization.name}
                        </Link>
                      </h3>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {tx("explorer.mobileRowIdentity", {
                          row: (page - 1) * limit + rowIndex + 1,
                          code: organization.code || "—",
                        })}
                      </p>
                    </div>
                    <div className="flex">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11"
                      >
                        <Link
                          href={organizationHref(organization.id)}
                          aria-label={tx("explorer.openOrganization", { name: organization.name })}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                      {data?.capabilities.canManage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11"
                          aria-label={tx("explorer.editOrganization", { name: organization.name })}
                          onClick={() => {
                            setEditData(organization)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.type")}</dt>
                      <dd>{organization.organizationKind || tx(`explorer.objectTypes.${organization.objectType}`)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.classification")}</dt>
                      <dd>{[organization.category, organization.specialization].filter(Boolean).join(" · ") || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.medicalCategory")}</dt>
                      <dd title={attributes?.medicalCategoryCode ? undefined : tx("explorer.optionalAttributesHint")}>
                        {attributes?.medicalCategoryCode ? attributeLabel(attributes.medicalCategoryLabels, locale, attributes.medicalCategoryCode) : tx("explorer.notProvided")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.license")}</dt>
                      <dd title={attributes?.licenseStatus ? undefined : tx("explorer.optionalAttributesHint")}>
                        {attributes?.licenseStatus ? attributeLabel(attributes.licenseLabels, locale, tx(`explorer.licenseStatuses.${attributes.licenseStatus}`)) : tx("explorer.notProvided")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.polygon")}</dt>
                      <dd>{attributes?.polygonCode ? attributeLabel(attributes.polygonLabels, locale, attributes.polygonCode) : tx("explorer.notProvided")}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.address")}</dt>
                      <dd>{organization.address || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.owner")}</dt>
                      <dd>{owners.join(", ") || tx("explorer.free")}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.columns.lastVisit")}</dt>
                      <dd>
                        {lastVisit ? (
                          <Link
                            href={`/mtm/visits?visitId=${encodeURIComponent(lastVisit.id)}&returnTo=${encodeURIComponent(listReturnPath)}`}
                            className="inline-flex min-h-11 items-center gap-2 tabular-nums text-primary underline-offset-4 hover:underline"
                          >
                            {visitDate.format(new Date(lastVisit.checkInAt))}
                            <span className="text-xs text-muted-foreground">{lastVisit.agent.name}</span>
                          </Link>
                        ) : tx("explorer.noVisits")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.columns.nextVisit")}</dt>
                      <dd>
                        {nextVisit ? (
                          <Link
                            href={`/mtm/routes?routeId=${encodeURIComponent(nextVisit.routeId)}&returnTo=${encodeURIComponent(listReturnPath)}`}
                            className="inline-flex min-h-11 items-center gap-2 tabular-nums text-primary underline-offset-4 hover:underline"
                          >
                            {nextVisit.plannedTime
                              ? visitDateTime.format(new Date(nextVisit.plannedTime))
                              : visitDate.format(new Date(nextVisit.route.date))}
                          </Link>
                        ) : tx("explorer.notPlanned")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted-foreground">{tx("explorer.activity")}</dt>
                      <dd>{tx("explorer.mobileActivity", {
                        contacts: organization._count.contactWorkplaces,
                        visits: organization._count.visits,
                      })}</dd>
                    </div>
                  </dl>
                  <div className={`mt-3 grid gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700 ${effectiveScope === "MINE" ? "grid-cols-2" : "grid-cols-1"}`}>
                    {effectiveScope === "MINE" ? (
                      organization.latitude !== null && organization.longitude !== null ? (
                        <Button asChild variant="outline" className="min-h-11">
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${organization.latitude},${organization.longitude}`)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Navigation className="mr-2 h-4 w-4" />
                            {tx("explorer.navigate")}
                          </a>
                        </Button>
                      ) : (
                        <Button variant="outline" className="min-h-11" disabled title={tx("explorer.coordinatesMissing")}>
                          <Navigation className="mr-2 h-4 w-4" />
                          {tx("explorer.navigate")}
                        </Button>
                      )
                    ) : null}
                    <Button asChild className="min-h-11">
                      <Link
                        href={routePlanningHref(organization.id)}
                        aria-label={tx("explorer.addToRouteFor", { name: organization.name })}
                      >
                        <CalendarPlus className="mr-2 h-4 w-4" />
                        {tx("explorer.addToRoute")}
                      </Link>
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <nav aria-label={tx("explorer.pagination")} className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="organization-page-size" className="text-sm text-muted-foreground">{tx("explorer.rowsPerPage")}</Label>
          <Select
            id="organization-page-size"
            value={String(limit)}
            onChange={(event) => {
              setLimit(Number(event.target.value))
              setPage(1)
              setSelected(new Set())
              setActiveSavedViewId("")
            }}
            className="min-h-11 w-20 md:min-h-9"
          >
            {MTM_ORGANIZATION_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="text-sm tabular-nums text-muted-foreground">
            {tx("explorer.pageOf", { page, pages: pageCount })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            aria-label={tx("explorer.previousPage")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            aria-label={tx("explorer.nextPage")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </nav>

      <MtmCustomerForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => void Promise.allSettled([loadOrganizations(), loadFacets()])}
        initialData={editData}
        orgId={orgId}
        apiBasePath="/api/v1/mtm/organizations"
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
        title={t("delete")}
        itemName={deleteItem?.name}
      />

      <Dialog
        open={saveViewOpen}
        onOpenChange={(open) => {
          if (!savedViewsBusy) setSaveViewOpen(open)
        }}
      >
        <DialogHeader>
          <DialogTitle>{tx("explorer.saveViewTitle")}</DialogTitle>
          <DialogDescription>{tx("explorer.saveViewDescription")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="saved-view-name">{tx("explorer.savedViewName")}</Label>
            <Input
              id="saved-view-name"
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
              maxLength={80}
              autoFocus
              className="min-h-11"
              placeholder={tx("explorer.savedViewNamePlaceholder")}
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
              <span className="text-sm font-medium">{tx("explorer.makeDefaultView")}</span>
              <span className="text-xs text-muted-foreground">{tx("explorer.makeDefaultViewHint")}</span>
            </span>
          </label>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" disabled={savedViewsBusy} onClick={() => setSaveViewOpen(false)}>
            {tx("explorer.cancel")}
          </Button>
          <Button disabled={savedViewsBusy} onClick={() => void saveCurrentView()}>
            {savedViewsBusy ? tx("explorer.savingView") : tx("explorer.saveView")}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={assignmentOpen}
        onOpenChange={(open) => {
          if (!assignmentBusy) setAssignmentOpen(open)
        }}
        widthClassName="max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{isRouteOrganizationFlow && assignmentMode === "ASSIGN" ? tx("explorer.routeFlowAssignTitle") : assignmentMode === "ASSIGN" ? tx("explorer.assignTitle") : tx("explorer.unassignTitle")}</DialogTitle>
          <DialogDescription>
            {assignmentResult
              ? tx("explorer.resultDescription")
              : preview
                ? tx("explorer.previewDescription")
                : isRouteOrganizationFlow && assignmentMode === "ASSIGN"
                  ? tx("explorer.routeFlowAssignmentDescription", { count: selected.size })
                  : tx("explorer.assignmentDescription", { count: selected.size })}
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-5">
          <div data-testid="mtm-organization-assignment-dialog">
          {assignmentResult ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 divide-x rounded-xl border border-zinc-200 dark:border-zinc-700">
                <div className="grid gap-1 p-3">
                  <span className="text-xs text-muted-foreground">{tx("explorer.changed")}</span>
                  <strong className="text-2xl tabular-nums">{assignmentResult.summary.changed}</strong>
                </div>
                <div className="grid gap-1 p-3">
                  <span className="text-xs text-muted-foreground">{tx("explorer.excluded")}</span>
                  <strong className="text-2xl tabular-nums">{assignmentResult.summary.excluded}</strong>
                </div>
                <div className="grid gap-1 p-3">
                  <span className="text-xs text-muted-foreground">{tx("explorer.selected")}</span>
                  <strong className="text-2xl tabular-nums">{assignmentResult.summary.selected}</strong>
                </div>
              </div>
              {assignmentResult.excluded.length > 0 ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-semibold">{tx("explorer.excludedOrganizations")}</h3>
                  {assignmentResult.excluded.map((row) => (
                    <div key={row.organizationId} className="rounded-lg bg-muted p-3 text-sm">
                      <p className="font-medium">{row.name || row.organizationId}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.issues.map((issue) => tx(`explorer.issues.${issue}`)).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 divide-x divide-y rounded-xl border border-zinc-200 dark:border-zinc-700 sm:grid-cols-4 sm:divide-y-0">
                {[
                  [tx("explorer.selected"), preview.summary.selected],
                  [tx("explorer.canChange"), preview.summary.assignable],
                  [tx("explorer.excluded"), preview.summary.excluded],
                  [tx("explorer.routeConflicts"), preview.summary.routePlanConflicts],
                ].map(([label, value]) => (
                  <div key={String(label)} className="grid gap-1 p-3">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <strong className="text-2xl tabular-nums">{value}</strong>
                  </div>
                ))}
              </div>
              {preview.rows.some((row) => !row.assignable) ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-semibold">{tx("explorer.reviewConflicts")}</h3>
                  <div className="max-h-64 space-y-2 overflow-auto pr-1">
                    {preview.rows.filter((row) => !row.assignable).map((row) => (
                      <div key={row.organizationId} className="rounded-lg bg-muted p-3 text-sm">
                        <p className="font-medium">{row.name || row.organizationId}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.issues.map((issue) => tx(`explorer.issues.${issue}`)).join(" · ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                  <UserRoundCheck className="h-5 w-5 flex-none" />
                  {tx("explorer.noConflicts")}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {assignmentMode === "ASSIGN" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="assignment-agent">{tx("explorer.newOwner")}</Label>
                  <Select
                    id="assignment-agent"
                    value={targetAgentId}
                    onChange={(event) => setTargetAgentId(event.target.value)}
                    className="min-h-11"
                  >
                    <option value="">{tx("explorer.chooseOwner")}</option>
                    {(facets?.assignableAgents ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="assignment-date">{tx("explorer.effectiveFrom")}</Label>
                <Input
                  id="assignment-date"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  className="min-h-11"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="assignment-reason">{tx("explorer.reason")}</Label>
                <Textarea
                  id="assignment-reason"
                  value={assignmentReason}
                  onChange={(event) => setAssignmentReason(event.target.value)}
                  placeholder={tx("explorer.reasonPlaceholder")}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">{tx("explorer.reasonHint")}</p>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <UsersRound className="mr-2 inline h-4 w-4" />
                {tx("explorer.previewRequired")}
              </div>
            </div>
          )}
          </div>
        </DialogContent>
        <DialogFooter className="flex-col-reverse sm:flex-row">
          {assignmentResult ? (
            <Button onClick={() => setAssignmentOpen(false)}>{tx("explorer.closeResult")}</Button>
          ) : preview ? (
            <>
              <Button
                variant="outline"
                disabled={assignmentBusy}
                onClick={() => {
                  setPreview(null)
                  setAssignmentIdempotencyKey(crypto.randomUUID())
                }}
              >
                {tx("explorer.changeParameters")}
              </Button>
              <Button
                disabled={assignmentBusy || preview.summary.assignable === 0}
                onClick={() => void applyAssignment()}
              >
                {assignmentBusy ? tx("explorer.applying") : assignmentMode === "ASSIGN" ? tx("explorer.applyAssignment") : tx("explorer.applyUnassignment")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={assignmentBusy} onClick={() => setAssignmentOpen(false)}>
                {tx("explorer.keepSelection")}
              </Button>
              <Button disabled={assignmentBusy} onClick={() => void requestAssignmentPreview()}>
                {assignmentBusy ? tx("explorer.buildingPreview") : tx("explorer.reviewBeforeApply")}
              </Button>
            </>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  )
}
