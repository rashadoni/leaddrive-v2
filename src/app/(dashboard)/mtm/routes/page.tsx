"use client"

import { useCallback, useEffect, useState, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { HelpButton } from "@/components/help/help-button"
import { MtmRouteBuilder } from "@/components/mtm/route-builder"
import { MtmRouteCalendar } from "@/components/mtm/route-calendar"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { MtmRouteWeekPlan } from "@/components/mtm/route-week-plan"
import { MtmRoutePlanningMatrix } from "@/components/mtm/route-planning-matrix"
import { MtmRouteApprovalQueue } from "@/components/mtm/route-approval-queue"
import { MtmRouteTravelPanel } from "@/components/mtm/route-travel-panel"
import { MtmCustomerCreateRequestPanel } from "@/components/mtm/customer-create-request-panel"
import { MtmCustomerRequestQueue } from "@/components/mtm/customer-request-queue"
import { MtmExcelExchangePanel } from "@/components/mtm/excel-exchange-panel"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import dynamic from "next/dynamic"
import type { MtmRouteAssignment, MtmRoutePoint, MtmRouteRecord } from "@/components/mtm/route-types"
import {
  Route, MapPin, User, CheckCircle2, Plus, Pencil, Trash2, Search, Send,
  ArrowLeft, List, CalendarDays, Clock, Navigation, RefreshCw, X, Columns3, ClipboardCheck, Users, UserRound, FileSpreadsheet, TableProperties,
  Camera, PenLine, StickyNote, ArrowDownUp,
} from "lucide-react"
import { mtmRouteReturnTarget, type MtmRouteAssignmentDirection } from "@/lib/mtm/route-links"
import { fetchMtmRoutesInRange } from "@/lib/mtm/route-range-client"
import {
  emptyMtmRoutePlannerContext,
  mergeMtmRoutePlannerContext,
  mtmRoutePlannerContextStorageKey,
  mtmRoutePlannerContextsEqual,
  parseMtmRoutePlannerContext,
  type MtmRoutePlannerContext,
  type MtmRoutePlannerContextPatch,
} from "@/lib/mtm/route-planner-context"
import { formatDate, formatTime } from "@/lib/format-date"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { MtmAgentPeriodView } from "@/components/mtm/agent-period-view"
import { isMtmRouteShortOfPlan } from "@/lib/mtm/calendar-day-summary"
import { mtmCalendarDayKey } from "@/lib/mtm/calendar-day-tone"
import { mtmDurationParts, summarizeMtmRouteExecution } from "@/lib/mtm/route-point-execution"
import { visitPlaceSummary } from "@/lib/mtm/visit-place-check"
import { VisitPlaceBadge } from "@/components/mtm/visit-place-badge"

const MtmRouteMap = dynamic(() => import("@/components/mtm/route-map"), { ssr: false })

const statusBadge: Record<string, { className: string }> = {
  DRAFT: { className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  PLANNED: { className: "bg-muted text-foreground/70" },
  IN_PROGRESS: { className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  COMPLETED: { className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300" },
  INCOMPLETE: { className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" },
  CANCELLED: { className: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300" },
}


const pointStatusLabelKey: Partial<Record<MtmRoutePoint["status"], "pointStatusPending" | "pointStatusVisited" | "pointStatusSkipped">> = {
  PENDING: "pointStatusPending",
  VISITED: "pointStatusVisited",
  SKIPPED: "pointStatusSkipped",
}

type RouteViewMode = "list" | "matrix" | "week" | "calendar" | "approvals" | "agent"

interface RouteBuilderPreset {
  date?: string
  agentId?: string
  direction?: MtmRouteAssignmentDirection
  returnView: RouteViewMode
  plannerContext?: MtmRoutePlannerContext
}

type DayPlannerLaunch = {
  date: string
  agentId?: string | null
  direction?: MtmRouteAssignmentDirection | null
  search?: string
  routeId?: string | null
}

type RouteCapabilities = {
  canCreateRoute: boolean
  canPublish: boolean
  canReview: boolean
  canRequestCustomer: boolean
  actorAgentId: string | null
}

const EMPTY_ROUTE_CAPABILITIES: RouteCapabilities = {
  canCreateRoute: false,
  canPublish: false,
  canReview: false,
  canRequestCustomer: false,
  actorAgentId: null,
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/**
 * «Not visited» is a verdict, so it needs the moment to have passed: the route
 * is closed, or the stop's planned time is behind us. Review of #205: stops
 * planned for later today on a running route already read «Not visited».
 */
function isStopOverdue(point: MtmRoutePoint, routeStatus: MtmRouteRecord["status"], now = Date.now()): boolean {
  if (point.status !== "PENDING") return false
  if (routeStatus === "COMPLETED" || routeStatus === "INCOMPLETE" || routeStatus === "CANCELLED") return true
  if (routeStatus !== "IN_PROGRESS" && routeStatus !== "PLANNED") return false
  const planned = point.plannedTime ? Date.parse(point.plannedTime) : Number.NaN
  return Number.isFinite(planned) && planned < now
}

function routeAssignmentDirection(value: string | null): MtmRouteAssignmentDirection | undefined {
  return value === "DOCTOR" || value === "PHARMACY" || value === "ORGANIZATION" ? value : undefined
}

function routeViewMode(value: string | null): RouteViewMode | null {
  return value === "calendar" || value === "week" || value === "list" || value === "matrix" || value === "approvals" || value === "agent"
    ? value
    : null
}

function canUseRouteView(mode: RouteViewMode, canReview: boolean) {
  return canReview || (mode !== "week" && mode !== "approvals")
}

/**
 * Owner 2026-09-23: «remove the calendar from this section and make a separate
 * Calendar section, opening on the team calendar». Both surfaces are the same
 * workspace — the routes, their planner and their dialogs — so the section
 * only decides which views it offers and which one it opens on.
 */
export function MtmRoutesWorkspace({ surface = "routes" }: { surface?: "routes" | "calendar" } = {}) {
  const calendarSurface = surface === "calendar"
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const tPlace = useTranslations("mtmPlaceCheck")
  const tf = useTranslations("mtmForms")
  const [routes, setRoutes] = useState<MtmRouteRecord[]>([])
  // The server's count for the same filter. The chip read «Hamısı (200)» —
  // the page size — while 432 routes existed (audit 2026-09-14).
  const [routesTotal, setRoutesTotal] = useState(0)
  // Routes audit 2026-09-26: «son 200 / 482» — the rest were unreachable.
  const [routesPage, setRoutesPage] = useState(1)
  const [routesLoadingMore, setRoutesLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderPreset, setBuilderPreset] = useState<RouteBuilderPreset | null>(null)
  const [editData, setEditData] = useState<MtmRouteRecord | undefined>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmRouteRecord | null>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("date_desc")
  const [viewMode, setViewMode] = useState<RouteViewMode>(calendarSurface ? "calendar" : "list")
  const [viewPreferenceReady, setViewPreferenceReady] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState<MtmRouteRecord | null>(null)
  const [routeDetailLoading, setRouteDetailLoading] = useState(false)
  const [focusedRouteUnavailable, setFocusedRouteUnavailable] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState<Date | null>(null)
  const [calendarRoutes, setCalendarRoutes] = useState<MtmRouteRecord[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState(false)
  const [calendarRefreshVersion, setCalendarRefreshVersion] = useState(0)
  const [approvalRefreshVersion, setApprovalRefreshVersion] = useState(0)
  // Routes audit 2026-09-26, «Согласования»: with nothing pending the tab
  // showed three blocks each saying «nothing» — the first titled «Требует
  // внимания» — and with something pending the tab itself did not say so.
  const [approvalCounts, setApprovalCounts] = useState<{ routeChanges: number; customerRequests: number } | null>(null)
  const [removalPointId, setRemovalPointId] = useState<string | null>(null)
  const [removalReason, setRemovalReason] = useState("")
  const [requestingRemoval, setRequestingRemoval] = useState(false)
  const [capabilities, setCapabilities] = useState<RouteCapabilities>(EMPTY_ROUTE_CAPABILITIES)
  const [customerRequestOpen, setCustomerRequestOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [customerRequestRouteId, setCustomerRequestRouteId] = useState<string | undefined>()
  const [timezone, setTimezone] = useState("Asia/Baku")
  const [workCalendarEnforced, setWorkCalendarEnforced] = useState(false)
  const [workCalendarOverrides, setWorkCalendarOverrides] = useState<WorkCalendarOverride[]>([])
  // Загружены ли исключения на самом деле. Пустой список сам по себе не
  // отличает «у тенанта их нет» от «запрос не вернулся»: полевому агенту этот
  // эндпоинт отказывает по роли всегда.
  const [workCalendarKnown, setWorkCalendarKnown] = useState(false)
  const [plannerContext, setPlannerContext] = useState<MtmRoutePlannerContext>(() => emptyMtmRoutePlannerContext())
  const [plannerContextReady, setPlannerContextReady] = useState(false)
  useEffect(() => { setCalendarMonth(new Date()) }, [])
  const orgId = session?.user?.organizationId
  const requestedRouteId = searchParams.get("routeId")
  const requestedCustomerId = searchParams.get("customerId")
  const requestedContactId = searchParams.get("contactId")
  const requestedPlanningAgentId = searchParams.get("planAgentId")?.trim() || null
  const requestedPlanningDate = searchParams.get("planDate")
  const requestedPlanningDirection = routeAssignmentDirection(searchParams.get("planDirection"))
  const requestedViewMode = routeViewMode(searchParams.get("view"))
  const returnTarget = mtmRouteReturnTarget(searchParams.get("returnTo"))
  const handledCustomerPrefill = useRef("")
  const handledPlanningHandoff = useRef("")
  const selectedRouteRef = useRef<MtmRouteRecord | null>(null)
  const routeDetailRequestRef = useRef<{ id: string; controller: AbortController | null }>({
    id: "",
    controller: null,
  })
  const routeRequestRef = useRef<{ id: number; identity: string; controller: AbortController | null }>({
    id: 0,
    identity: "",
    controller: null,
  })
  const viewerKey = String(session?.user?.id ?? session?.user?.email ?? "")
  const viewPreferenceKey = orgId && viewerKey
    ? `leaddrive:mtm:routes:view:${String(orgId)}:${viewerKey}`
    : ""
  const plannerContextStorageKey = orgId && viewerKey
    ? mtmRoutePlannerContextStorageKey(String(orgId), viewerKey)
    : ""
  const routeIdentityKey = `${String(orgId ?? "")}:${viewerKey}:${requestedRouteId ?? ""}`

  useEffect(() => {
    selectedRouteRef.current = selectedRoute
  }, [selectedRoute])

  useEffect(() => {
    setPlannerContextReady(false)
    if (!plannerContextStorageKey) {
      setPlannerContext(emptyMtmRoutePlannerContext())
      setPlannerContextReady(true)
      return
    }
    try {
      setPlannerContext(parseMtmRoutePlannerContext(window.sessionStorage.getItem(plannerContextStorageKey)))
    } catch {
      setPlannerContext(emptyMtmRoutePlannerContext())
    } finally {
      setPlannerContextReady(true)
    }
  }, [plannerContextStorageKey])

  useEffect(() => {
    if (!plannerContextReady || !plannerContextStorageKey) return
    try {
      window.sessionStorage.setItem(plannerContextStorageKey, JSON.stringify(plannerContext))
    } catch {
      // The planner remains usable when session storage is blocked; only context continuity is lost.
    }
  }, [plannerContext, plannerContextReady, plannerContextStorageKey])

  useEffect(() => {
    if (!plannerContext.date) return
    const selectedDate = new Date(`${plannerContext.date}T12:00:00`)
    if (Number.isNaN(selectedDate.getTime())) return
    setCalendarMonth((current) => {
      if (current && current.getFullYear() === selectedDate.getFullYear() && current.getMonth() === selectedDate.getMonth()) {
        return current
      }
      return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    })
  }, [plannerContext.date])

  const updatePlannerContext = useCallback((patch: MtmRoutePlannerContextPatch) => {
    setPlannerContext((current) => {
      const next = mergeMtmRoutePlannerContext(current, patch)
      return mtmRoutePlannerContextsEqual(current, next) ? current : next
    })
  }, [])

  const fetchRoutes = useCallback(async () => {
    routeRequestRef.current.controller?.abort()
    routeDetailRequestRef.current.controller?.abort()
    routeDetailRequestRef.current = { id: "", controller: null }
    const requestId = routeRequestRef.current.id + 1
    const controller = new AbortController()
    routeRequestRef.current = { id: requestId, identity: routeIdentityKey, controller }
    const previousSelectedId = selectedRouteRef.current?.id ?? null
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && routeRequestRef.current.id === requestId
      && routeRequestRef.current.identity === routeIdentityKey
      && routeRequestRef.current.controller === controller
    )

    selectedRouteRef.current = null
    setRoutes([])
    setSelectedRoute(null)
    setRouteDetailLoading(false)
    setEditData(undefined)
    if (!requestedCustomerId) setBuilderOpen(false)
    setDeleteItem(null)
    setDeleteOpen(false)
    setCustomerRequestOpen(false)
    setCustomerRequestRouteId(undefined)
    setExcelOpen(false)
    setRemovalPointId(null)
    setRemovalReason("")
    setFocusedRouteUnavailable(false)
    setCapabilities(EMPTY_ROUTE_CAPABILITIES)
    setLoading(true)

    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const [res, focusedResponse] = await Promise.all([
        fetch("/api/v1/mtm/routes?limit=200", { headers, signal: controller.signal }),
        requestedRouteId
          ? fetch(`/api/v1/mtm/routes/${encodeURIComponent(requestedRouteId)}`, { headers, signal: controller.signal })
          : Promise.resolve(null),
      ])
      const r = await res.json().catch(() => null)
      if (!isCurrentRequest()) return
      if (!res.ok || !r?.success) {
        setFocusedRouteUnavailable(Boolean(requestedRouteId))
        toast.error(`Failed to load routes: ${r?.error || "Unknown error"}`)
        return
      }

      let nextRoutes: MtmRouteRecord[] = r.data.routes || []
      let focusedUnavailable = false
      if (focusedResponse) {
        const focusedResult = await focusedResponse.json().catch(() => null)
        if (!isCurrentRequest()) return
        if (focusedResponse.ok && focusedResult?.success && focusedResult.data?.id === requestedRouteId) {
          const focusedRoute = focusedResult.data as MtmRouteRecord
          nextRoutes = nextRoutes.some((route) => route.id === focusedRoute.id)
            ? nextRoutes.map((route) => route.id === focusedRoute.id ? focusedRoute : route)
            : [focusedRoute, ...nextRoutes]
        } else {
          focusedUnavailable = true
          nextRoutes = nextRoutes.filter((route) => route.id !== requestedRouteId)
        }
      }

      if (!isCurrentRequest()) return
      const routeToRestore = requestedRouteId ?? previousSelectedId
      const nextSelectedRoute = routeToRestore
        ? nextRoutes.find((route) => route.id === routeToRestore) ?? null
        : null
      setRoutes(nextRoutes)
      setRoutesPage(1)
      setRoutesTotal(Number.isFinite(Number(r.data.total)) ? Number(r.data.total) : nextRoutes.length)
      setCapabilities(r.data.capabilities ?? EMPTY_ROUTE_CAPABILITIES)
      setFocusedRouteUnavailable(focusedUnavailable)
      selectedRouteRef.current = nextSelectedRoute
      setSelectedRoute(nextSelectedRoute)
      if (requestedRouteId && nextSelectedRoute) setViewMode("list")
      return nextRoutes
    } catch (e) {
      if (!isCurrentRequest() || (e as { name?: string })?.name === "AbortError") return
      setFocusedRouteUnavailable(Boolean(requestedRouteId))
      toast.error(`Failed to load routes: ${e instanceof Error ? e.message : "Network error"}`)
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [orgId, requestedCustomerId, requestedRouteId, routeIdentityKey])

  async function loadMoreRoutes() {
    const requestId = routeRequestRef.current.id
    const nextPage = routesPage + 1
    setRoutesLoadingMore(true)
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const response = await fetch(`/api/v1/mtm/routes?limit=200&page=${nextPage}`, { headers })
      const result = await response.json().catch(() => null)
      // A reload in between started the list over; this page belongs to the old one.
      if (routeRequestRef.current.id !== requestId) return
      if (!response.ok || !result?.success) {
        toast.error(t("loadMoreRoutesFailed"))
        return
      }
      const more = (result.data.routes ?? []) as MtmRouteRecord[]
      setRoutes((current) => {
        const known = new Set(current.map((route) => route.id))
        return [...current, ...more.filter((route) => !known.has(route.id))]
      })
      setRoutesPage(nextPage)
      if (Number.isFinite(Number(result.data.total))) setRoutesTotal(Number(result.data.total))
    } catch {
      if (routeRequestRef.current.id === requestId) toast.error(t("loadMoreRoutesFailed"))
    } finally {
      setRoutesLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!capabilities.canReview) return
    const controller = new AbortController()
    fetch("/api/v1/mtm/routes/needs-attention", { headers: orgId ? { "x-organization-id": String(orgId) } : {}, signal: controller.signal })
      .then((response) => response.json().then((result) => ({ ok: response.ok, result })))
      .then(({ ok, result }) => {
        const categories = result?.data?.categories
        // Unknown is not «nothing to approve»: the queues then load on their own.
        setApprovalCounts(ok && categories ? { routeChanges: Number(categories.routeChanges?.count) || 0, customerRequests: Number(categories.customerRequests?.count) || 0 } : null)
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setApprovalCounts(null)
      })
    return () => controller.abort()
  }, [approvalRefreshVersion, capabilities.canReview, orgId])

  const refreshRoutes = useCallback(async () => {
    const result = await fetchRoutes()
    setCalendarRefreshVersion((current) => current + 1)
    return result
  }, [fetchRoutes])

  const refreshRouteViews = useCallback(async () => {
    await refreshRoutes()
  }, [refreshRoutes])

  const refreshApprovalViews = useCallback(async () => {
    setApprovalRefreshVersion((current) => current + 1)
    await refreshRouteViews()
  }, [refreshRouteViews])

  useEffect(() => {
    void fetchRoutes()
    return () => {
      routeRequestRef.current.controller?.abort()
      routeDetailRequestRef.current.controller?.abort()
    }
  }, [fetchRoutes])

  useEffect(() => {
    if (loading || !viewPreferenceKey) return

    setViewPreferenceReady(false)
    if (requestedRouteId) {
      setViewMode("list")
      setViewPreferenceReady(true)
      return
    }
    if (requestedViewMode) {
      setViewMode(canUseRouteView(requestedViewMode, capabilities.canReview) ? requestedViewMode : "calendar")
      setViewPreferenceReady(true)
      return
    }
    if (requestedCustomerId || requestedContactId || requestedPlanningAgentId) {
      setViewPreferenceReady(true)
      return
    }

    try {
      const savedView = routeViewMode(window.localStorage.getItem(viewPreferenceKey))
      if (savedView && canUseRouteView(savedView, capabilities.canReview)) setViewMode(savedView)
      else if (savedView) window.localStorage.removeItem(viewPreferenceKey)
    } catch {
      // Storage can be unavailable in hardened browsers; calendar remains the safe default.
    }
    setViewPreferenceReady(true)
  }, [capabilities.canReview, loading, requestedContactId, requestedCustomerId, requestedPlanningAgentId, requestedRouteId, requestedViewMode, viewPreferenceKey])

  useEffect(() => {
    if (!viewPreferenceReady || !viewPreferenceKey) return
    if (requestedRouteId || requestedViewMode || requestedCustomerId || requestedContactId || requestedPlanningAgentId) return
    try {
      window.localStorage.setItem(viewPreferenceKey, viewMode)
    } catch {
      // The view still works when storage is blocked; only cross-visit memory is lost.
    }
  }, [requestedContactId, requestedCustomerId, requestedPlanningAgentId, requestedRouteId, requestedViewMode, viewMode, viewPreferenceKey, viewPreferenceReady])

  useEffect(() => {
    if (!calendarMonth) return
    const controller = new AbortController()
    const start = localDateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1))
    const endExclusive = localDateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))
    setCalendarLoading(true)
    setCalendarError(false)
    fetchMtmRoutesInRange({ start, endExclusive, orgId: orgId ? String(orgId) : undefined, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setCalendarRoutes(result)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && (error as { name?: string })?.name !== "AbortError") {
          setCalendarRoutes([])
          setCalendarError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCalendarLoading(false)
      })
    return () => controller.abort()
  }, [calendarMonth, calendarRefreshVersion, orgId])

  useEffect(() => {
    if (!requestedCustomerId || requestedRouteId || !capabilities.canCreateRoute) {
      if (!requestedCustomerId) handledCustomerPrefill.current = ""
      return
    }
    const prefillKey = `${String(orgId ?? "")}:${viewerKey}:${requestedCustomerId}:${requestedContactId ?? ""}`
    if (handledCustomerPrefill.current === prefillKey) return
    handledCustomerPrefill.current = prefillKey
    setEditData(undefined)
    setBuilderPreset({ returnView: "list", plannerContext })
    setBuilderOpen(true)
  }, [capabilities.canCreateRoute, orgId, plannerContext, requestedContactId, requestedCustomerId, requestedRouteId, viewerKey])

  useEffect(() => {
    if (!requestedPlanningAgentId || requestedRouteId || requestedCustomerId || !capabilities.canCreateRoute) {
      if (!requestedPlanningAgentId) handledPlanningHandoff.current = ""
      return
    }
    const prefillKey = `${String(orgId ?? "")}:${viewerKey}:${requestedPlanningAgentId}:${requestedPlanningDate ?? ""}:${requestedPlanningDirection ?? ""}`
    if (handledPlanningHandoff.current === prefillKey) return
    handledPlanningHandoff.current = prefillKey
    const handoffContext = mergeMtmRoutePlannerContext(plannerContext, {
      date: requestedPlanningDate ?? plannerContext.date,
      agentId: requestedPlanningAgentId,
      direction: requestedPlanningDirection ?? plannerContext.direction,
    })
    updatePlannerContext(handoffContext)
    setEditData(undefined)
    setBuilderPreset({
      date: handoffContext.date ?? localDateKey(new Date()),
      agentId: requestedPlanningAgentId,
      direction: handoffContext.direction ?? undefined,
      returnView: "list",
      plannerContext: handoffContext,
    })
    setBuilderOpen(true)
  }, [capabilities.canCreateRoute, orgId, plannerContext, requestedCustomerId, requestedPlanningAgentId, requestedPlanningDate, requestedPlanningDirection, requestedRouteId, updatePlannerContext, viewerKey])

  const clearRoutePrefill = useCallback(() => {
    if (!requestedCustomerId && !requestedContactId && !requestedPlanningAgentId && !requestedPlanningDate && !requestedPlanningDirection) return
    const next = new URLSearchParams(searchParams.toString())
    next.delete("customerId")
    next.delete("contactId")
    next.delete("planAgentId")
    next.delete("planDate")
    next.delete("planDirection")
    const query = next.toString()
    router.replace(query ? `/mtm/routes?${query}` : "/mtm/routes", { scroll: false })
  }, [requestedContactId, requestedCustomerId, requestedPlanningAgentId, requestedPlanningDate, requestedPlanningDirection, router, searchParams])

  useEffect(() => {
    const controller = new AbortController()
    setTimezone("Asia/Baku")
    setWorkCalendarEnforced(false)
    fetch("/api/v1/mtm/settings", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((result) => {
        if (controller.signal.aborted || !result.success) return
        if (typeof result.data?.timezone === "string") setTimezone(result.data.timezone)
        setWorkCalendarEnforced(result.data?.enforceWorkCalendarForRoutes === true)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [orgId])

  // Overrides for the visible grid. Shading degrades to nothing on failure:
  // the endpoint sits behind the Workforce HRM module, and a tenant without it
  // must still get a working calendar rather than a 403 turned into a blank
  // screen. Empty overrides simply mean "weekends only".
  useEffect(() => {
    if (!orgId || !workCalendarEnforced || !calendarMonth) {
      setWorkCalendarOverrides([])
      setWorkCalendarKnown(false)
      return
    }
    // Сбрасываем на каждый месяц: иначе прежние данные секунду выдаются за
    // данные нового месяца, и та же суббота успевает мигнуть выходным.
    setWorkCalendarKnown(false)
    const controller = new AbortController()
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
    const start = new Date(first)
    start.setDate(start.getDate() - 7)
    const endExclusive = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
    endExclusive.setDate(endExclusive.getDate() + 7)
    const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    fetch(`/api/v1/mtm/work-calendar?start=${key(start)}&endExclusive=${key(endExclusive)}`, {
      headers: { "x-organization-id": String(orgId) },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (controller.signal.aborted) return
        const ok = result?.success === true && Array.isArray(result.data?.days)
        setWorkCalendarOverrides(ok ? result.data.days : [])
        // Только успех делает пустой список утверждением. Отказ по роли и
        // сетевая ошибка оставляют «не знаю».
        setWorkCalendarKnown(ok)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [orgId, calendarMonth, workCalendarEnforced])

  useEffect(() => {
    if (!requestedRouteId || routes.length === 0) return
    const route = routes.find((item) => item.id === requestedRouteId)
    if (!route) return
    updatePlannerContext({
      date: route.date.slice(0, 10),
      agentId: route.agentId ?? plannerContext.agentId,
    })
    setSelectedRoute(route)
    setViewMode("list")
  }, [plannerContext.agentId, requestedRouteId, routes, updatePlannerContext])

  const selectedRouteId = selectedRoute?.id
  useEffect(() => {
    if (!selectedRouteId) return
    const refreshed = routes.find((route) => route.id === selectedRouteId)
    if (refreshed) {
      setSelectedRoute((current) => current?.id === selectedRouteId ? refreshed : current)
    }
  }, [routes, selectedRouteId])

  const todayKey = mtmCalendarDayKey(new Date())
  const approvalTotal = approvalCounts ? approvalCounts.routeChanges + approvalCounts.customerRequests : 0
  const filtered = routes.filter(r => {
    if (activeFilter !== "all" && r.status !== activeFilter) return false
    if (search) {
      const s = search.toLowerCase()
      if (!r.agent?.name?.toLowerCase().includes(s) && !r.name?.toLowerCase().includes(s)) return false
    }
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case "date_desc": return new Date(b.date).getTime() - new Date(a.date).getTime()
      case "date_asc": return new Date(a.date).getTime() - new Date(b.date).getTime()
      case "status": return (a.status || "").localeCompare(b.status || "")
      default: return 0
    }
  })

  const statusCounts: Record<string, number> = {}
  for (const r of routes) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/routes/${deleteItem.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
    if (!res.ok) throw new Error((await res.json()).error || "Failed to delete")
    void refreshRoutes()
    if (selectedRoute?.id === deleteItem.id) setSelectedRoute(null)
  }

  async function publishRoute(route: MtmRouteRecord) {
    const res = await fetch(`/api/v1/mtm/routes/${route.id}/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      },
      body: JSON.stringify({ expectedVersion: route.version }),
    })
    const result = await res.json()
    if (!res.ok) {
      toast.error(result.code === "ROUTE_VERSION_CONFLICT"
        ? t("versionConflict")
        : result.error || t("publishFailed"))
      return
    }
    toast.success(t("publishSuccess"))
    await refreshRoutes()
    setSelectedRoute((current) => current?.id === route.id ? {
      ...current,
      status: "PLANNED",
      version: result.data?.version ?? current.version,
      publishedVersion: result.data?.publishedVersion ?? current.publishedVersion,
    } : current)
  }

  async function requestStopRemoval(routeId: string, routePointId: string) {
    if (removalReason.trim().length < 3) return
    setRequestingRemoval(true)
    try {
      const response = await fetch(`/api/v1/mtm/routes/${routeId}/change-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ changeType: "REMOVE_STOP", routePointId, reason: removalReason.trim() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t("requestFailed"))
      toast.success(t("requestSubmitted"))
      setRemovalPointId(null)
      setRemovalReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("requestFailed"))
    } finally {
      setRequestingRemoval(false)
    }
  }

  function closeRouteBuilder() {
    setBuilderOpen(false)
    setEditData(undefined)
    setBuilderPreset(null)
    clearRoutePrefill()
  }

  function closeRouteDetails() {
    routeDetailRequestRef.current.controller?.abort()
    routeDetailRequestRef.current = { id: "", controller: null }
    setRouteDetailLoading(false)
    setSelectedRoute(null)
    setRemovalPointId(null)
    setRemovalReason("")
  }

  function openNewRoute(preset: Omit<RouteBuilderPreset, "returnView"> & { returnView?: RouteViewMode } = {}) {
    if (!capabilities.canCreateRoute) {
      toast.error(t("selfPlanningDisabled"))
      return
    }
    closeRouteDetails()
    setEditData(undefined)
    const nextPlannerContext = preset.plannerContext ?? mergeMtmRoutePlannerContext(plannerContext, {
      date: preset.date ?? plannerContext.date,
      agentId: preset.agentId ?? plannerContext.agentId ?? (capabilities.canReview ? null : capabilities.actorAgentId),
      direction: preset.direction ?? plannerContext.direction,
    })
    updatePlannerContext(nextPlannerContext)
    setBuilderPreset({
      date: preset.date ?? nextPlannerContext.date ?? undefined,
      agentId: preset.agentId ?? nextPlannerContext.agentId ?? (capabilities.canReview ? undefined : capabilities.actorAgentId ?? undefined),
      direction: preset.direction ?? nextPlannerContext.direction ?? undefined,
      returnView: preset.returnView ?? viewMode,
      plannerContext: nextPlannerContext,
    })
    setBuilderOpen(true)
  }

  function openRouteEditor(route: MtmRouteRecord) {
    closeRouteDetails()
    const nextPlannerContext = mergeMtmRoutePlannerContext(plannerContext, {
      date: route.date.slice(0, 10),
      agentId: route.agentId ?? plannerContext.agentId,
    })
    updatePlannerContext(nextPlannerContext)
    setEditData(route)
    setBuilderPreset({ returnView: viewMode, plannerContext: nextPlannerContext })
    setBuilderOpen(true)
  }

  async function hydrateRouteDetail(route: MtmRouteRecord) {
    routeDetailRequestRef.current.controller?.abort()
    const controller = new AbortController()
    routeDetailRequestRef.current = { id: route.id, controller }
    setRouteDetailLoading(true)

    try {
      const response = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(route.id)}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      if (
        controller.signal.aborted
        || routeDetailRequestRef.current.controller !== controller
        || !response.ok
        || !result?.success
        || result.data?.id !== route.id
      ) return

      const detail = result.data as MtmRouteRecord
      setRoutes((current) => current.map((item) => item.id === detail.id ? detail : item))
      setSelectedRoute((current) => current?.id === detail.id ? detail : current)
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") {
        // Keep the already-scoped list projection visible when the optional
        // detail enrichment fails. Opening a route must not depend on a map.
      }
    } finally {
      if (routeDetailRequestRef.current.controller === controller) setRouteDetailLoading(false)
    }
  }

  function openRouteDetails(route: MtmRouteRecord) {
    updatePlannerContext({
      date: route.date.slice(0, 10),
      agentId: route.agentId ?? plannerContext.agentId,
    })
    setSelectedRoute(route)
    void hydrateRouteDetail(route)
  }

  async function openDayPlannerFromMatrix(input: DayPlannerLaunch) {
    const nextPlannerContext = mergeMtmRoutePlannerContext(plannerContext, {
      date: input.date,
      agentId: input.agentId ?? plannerContext.agentId,
      direction: input.direction ?? plannerContext.direction,
      search: input.search ?? plannerContext.search,
    })
    updatePlannerContext(nextPlannerContext)

    if (!input.routeId) {
      openNewRoute({
        date: nextPlannerContext.date ?? input.date,
        agentId: nextPlannerContext.agentId ?? undefined,
        direction: nextPlannerContext.direction ?? undefined,
        returnView: "matrix",
        plannerContext: nextPlannerContext,
      })
      return
    }

    try {
      const response = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(input.routeId)}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success || !result.data) throw new Error("MTM_ROUTE_LOAD_FAILED")
      closeRouteDetails()
      setEditData(result.data as MtmRouteRecord)
      setBuilderPreset({ returnView: "matrix", plannerContext: nextPlannerContext })
      setBuilderOpen(true)
    } catch {
      toast.error(t("matrixLoadFailed"))
    }
  }

  const routeMetrics = useMemo(() => {
    if (!selectedRoute) return null
    const completion = selectedRoute.totalPoints > 0 ? Math.round((selectedRoute.visitedPoints / selectedRoute.totalPoints) * 100) : 0
    const duration = selectedRoute.startedAt && selectedRoute.completedAt
      ? Math.round((new Date(selectedRoute.completedAt).getTime() - new Date(selectedRoute.startedAt).getTime()) / 60000) : null
    return { completion, duration }
  }, [selectedRoute])
  const selectedRoutePoints = selectedRoute?.points ?? []
  const selectedRouteExecution = useMemo(
    () => summarizeMtmRouteExecution(selectedRoute?.points ?? []),
    [selectedRoute],
  )
  const tenantTime = (value: string | null | undefined) =>
    value ? formatTime(new Date(value), locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : ""
  const durationLabel = (minutes: number) => {
    const parts = mtmDurationParts(minutes)
    return parts.hours > 0
      ? t("stopFact.durationHoursMinutes", parts)
      : t("stopFact.durationMinutes", { minutes: parts.minutes })
  }
  // Published and started routes open the builder's published-edit mode for
  // managers, supervisors and admins; the server re-checks scope and locks
  // stops with field history (PUT /api/v1/mtm/routes/[id]).
  const canEditRoute = (route: MtmRouteRecord) => route.historicalAccessOnly !== true && (
    route.status === "DRAFT"
      ? capabilities.canReview || (capabilities.canCreateRoute && route.agentId === capabilities.actorAgentId)
      : (route.status === "PLANNED" || route.status === "IN_PROGRESS") && capabilities.canReview
  )
  const preferredPlanningAgentId = !capabilities.canReview && capabilities.actorAgentId
    ? capabilities.actorAgentId
    : selectedRoute?.agentId
    ?? routes.find((route) => route.status === "IN_PROGRESS")?.agentId
    ?? routes[0]?.agentId
    ?? null
  const primaryCalendarLabel = t(capabilities.canReview ? "viewTeamCalendar" : "viewMyCalendar")

  if (loading) return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex animate-pulse flex-col gap-3 border-b border-zinc-200 pb-3 motion-reduce:animate-none dark:border-zinc-700 xl:flex-row xl:items-center">
        <div className="flex-1 space-y-2"><div className="h-5 w-28 rounded bg-muted" /><div className="h-4 w-72 max-w-full rounded bg-muted" /></div>
        <div className="flex gap-2"><div className="h-11 w-32 rounded-xl bg-muted" /><div className="h-11 w-32 rounded-xl bg-muted" /><div className="h-11 w-40 rounded-xl bg-muted" /></div>
      </div>
      <div className="h-[34rem] animate-pulse rounded-xl border border-zinc-200 bg-muted/50 motion-reduce:animate-none dark:border-zinc-700" />
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Prod 2026-09-26 at 1568 px: with six view tabs in one row next to the
          heading, the row wrapped and its second line lay over the heading.
          The heading keeps its own line; the tabs and actions take the next. */}
      <header data-testid="mtm-route-header" className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Route className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-6 text-foreground">{t(calendarSurface ? "calendarTitle" : "title")}</h1>
          </div>
          {/*
            Audit W-05 / task C5. Measured on the owner's screen at 1470x675:
            the first row of data began at y=312, so 46 % of the window was
            spent before anything to work with. Part of that was this line,
            and it was the fourth place saying the same thing — the module tab
            strip already highlights "Marşrutlar", the heading repeats it, and
            the help article behind this button explains the page properly.
            The Definition of Done puts the explanation behind "?", which is
            where it now lives.
          */}
          <HelpButton slug="mtm-routes" className="shrink-0" />
        </div>
        <div data-testid="mtm-route-toolbar" className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center">
          {/* Owner 2026-09-25: «if I as the architect can't make sense of it, an
              ordinary user won't». Four views hid behind a dropdown next to two
              visible ones; every view is now its own tab in one row, and the
              Excel exchange is a button with words, not a menu item. */}
          <nav data-testid="mtm-route-view-switcher" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label={t("primaryViews")}>
            <div data-testid="mtm-route-view-tabs" className="flex min-w-0 flex-wrap gap-1 rounded-xl border border-zinc-200 bg-muted/30 p-1 dark:border-zinc-700" role="group" aria-label={t("primaryViews")}>
              {calendarSurface ? <Button data-testid="mtm-routes-view-calendar" aria-pressed={viewMode === "calendar"} variant={viewMode === "calendar" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("calendar")}><CalendarDays className="mr-1 h-4 w-4" />{primaryCalendarLabel}</Button> : null}
              {calendarSurface && capabilities.canReview ? <Button data-testid="mtm-routes-view-week" aria-pressed={viewMode === "week"} variant={viewMode === "week" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("week")}><Columns3 className="mr-1 h-4 w-4" />{t("viewWeek")}</Button> : null}
              <Button data-testid="mtm-routes-view-list" aria-pressed={viewMode === "list"} variant={viewMode === "list" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("list")}><List className="mr-1 h-4 w-4" />{t(capabilities.canReview ? "viewList" : "viewMyRoutes")}</Button>
              <Button data-testid="mtm-routes-view-matrix" aria-pressed={viewMode === "matrix"} variant={viewMode === "matrix" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("matrix")}><TableProperties className="mr-1 h-4 w-4" />{t("viewMatrix")}</Button>
              {/* Owner 2026-09-25: one agent over any period, not only a week. */}
              <Button data-testid="mtm-routes-view-agent" aria-pressed={viewMode === "agent"} variant={viewMode === "agent" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("agent")}><UserRound className="mr-1 h-4 w-4" />{t("viewAgentPeriod")}</Button>
              {capabilities.canReview ? <Button data-testid="mtm-routes-view-approvals" aria-pressed={viewMode === "approvals"} variant={viewMode === "approvals" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => setViewMode("approvals")}><ClipboardCheck className="mr-1 h-4 w-4" />{t("viewApprovals")}{approvalTotal > 0 ? <span data-testid="mtm-routes-approvals-count" className="ml-1.5 min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{approvalTotal}</span> : null}</Button> : null}
            </div>
          </nav>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {returnTarget ? <Button asChild variant="outline" className="min-h-11 whitespace-nowrap px-3 lg:min-h-10"><Link href={returnTarget.href}><ArrowLeft className="mr-1 h-4 w-4" />{t(returnTarget.label)}</Link></Button> : null}
            {capabilities.canReview ? <Button data-testid="mtm-routes-excel-exchange" variant="outline" className="min-h-11 whitespace-nowrap px-3 lg:min-h-10" onClick={() => setExcelOpen(true)}><FileSpreadsheet className="mr-1 h-4 w-4" />{t("excelExchange")}</Button> : null}
            <Button data-testid="mtm-route-builder-open" className="min-h-11 flex-1 whitespace-nowrap px-4 sm:flex-none lg:min-h-10" onClick={() => openNewRoute()} disabled={!capabilities.canCreateRoute} title={!capabilities.canCreateRoute ? t("selfPlanningDisabled") : undefined}><Plus className="mr-1 h-4 w-4" /> {t("add")}</Button>
          </div>
        </div>
      </header>

      {!capabilities.canCreateRoute ? (
        <p data-testid="mtm-route-self-planning-disabled" role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {t("selfPlanningDisabled")}
        </p>
      ) : null}

      {focusedRouteUnavailable && requestedRouteId ? (
        <div role="status" className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t("focusedUnavailable")}
        </div>
      ) : null}

      <Dialog
        open={builderOpen}
        onOpenChange={(open) => { if (!open) closeRouteBuilder() }}
        widthClassName="max-w-6xl"
        maxHeightClassName="max-h-dvh min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]"
        hideClose
        mobileFullscreen
        mobileFullscreenBreakpoint="tablet"
      >
        <DialogTitle className="sr-only">{editData ? t("builderEditTitle") : t("builderNewTitle")}</DialogTitle>
        <div data-testid="mtm-route-builder-dialog" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <MtmRouteBuilder
            open={builderOpen}
            initialData={editData}
            initialDate={editData ? undefined : builderPreset?.date}
            initialAgentId={editData ? undefined : builderPreset?.agentId}
            initialDirection={editData ? undefined : builderPreset?.direction}
            initialPlannerContext={builderPreset?.plannerContext}
            initialCustomerId={editData ? null : requestedCustomerId}
            initialContactId={editData ? null : requestedContactId}
            orgId={orgId ? String(orgId) : undefined}
            viewerKey={viewerKey || undefined}
            timezone={timezone}
            canPublish={capabilities.canPublish}
            canManageAssignments={capabilities.canReview}
            canRequestCustomer={capabilities.canRequestCustomer}
            onClose={closeRouteBuilder}
            onSaved={async () => {
              const returnView = builderPreset?.returnView ?? viewMode
              await refreshRoutes()
              setBuilderPreset(null)
              setViewMode(returnView)
            }}
            onPlannerContextChange={updatePlannerContext}
            onOpenExisting={(routeId) => {
              const route = routes.find((item) => item.id === routeId)
              closeRouteBuilder()
              if (route) openRouteDetails(route)
              setViewMode("list")
            }}
            onRequestCustomer={(routeId) => {
              setCustomerRequestRouteId(routeId)
              setCustomerRequestOpen(true)
            }}
          />
        </div>
      </Dialog>

      <MtmCustomerCreateRequestPanel
        open={customerRequestOpen}
        routeId={customerRequestRouteId}
        orgId={orgId ? String(orgId) : undefined}
        onClose={() => setCustomerRequestOpen(false)}
        onRouteChanged={refreshRouteViews}
      />

      <MtmExcelExchangePanel
        open={excelOpen}
        orgId={orgId ? String(orgId) : undefined}
        onClose={() => setExcelOpen(false)}
        onApplied={refreshRouteViews}
      />

      {/* Route details stay in the current context instead of opening above the list. */}
      <Dialog
        open={selectedRoute !== null}
        onOpenChange={(open) => { if (!open) closeRouteDetails() }}
        widthClassName="max-w-5xl"
        maxHeightClassName="max-h-[calc(100dvh-2rem)]"
        hideClose
      >
        {selectedRoute ? (
          <>
            <DialogTitle className="sr-only">{t("viewRoute")}</DialogTitle>
            <section data-testid="mtm-route-detail-dialog" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-card px-4 py-3 outline-none sm:px-6" aria-busy={routeDetailLoading}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{selectedRoute.name || selectedRoute.agent?.name} — {formatDate(new Date(selectedRoute.date), locale)}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{t("assignedAgents")}:</span>
                <span>{selectedRoute.assignments?.map((assignment: MtmRouteAssignment) => assignment.agent?.name).filter(Boolean).join(", ") || selectedRoute.agent?.name}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {capabilities.canRequestCustomer && selectedRoute.historicalAccessOnly !== true ? <Button size="sm" variant="outline" onClick={() => { setCustomerRequestRouteId(selectedRoute.id); setCustomerRequestOpen(true) }}>
                <User className="mr-1 h-4 w-4" />{t("requestNewCustomer")}
              </Button> : null}
              {canEditRoute(selectedRoute) ? (
                <>
                  <Button data-testid="mtm-route-edit" size="sm" variant="outline" onClick={() => openRouteEditor(selectedRoute)}><Pencil className="mr-1 h-4 w-4" />{t("edit")}</Button>
                  {selectedRoute.status === "DRAFT" && capabilities.canPublish ? <Button data-testid="mtm-route-publish" size="sm" onClick={() => publishRoute(selectedRoute)}><Send className="mr-1 h-4 w-4" />{t("publishRoute")}</Button> : null}
                </>
              ) : null}
              <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={closeRouteDetails} title={t("closeRouteDetails")} aria-label={t("closeRouteDetails")}><X className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700 sm:grid-cols-5 sm:divide-y-0">
            <div className="p-3 text-center"><CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-green-500" /><div className="text-lg font-bold">{selectedRoute.visitedPoints}/{selectedRoute.totalPoints}</div><div className="text-[10px] text-muted-foreground">{t("completed")}</div></div>
            <div className="p-3 text-center"><Navigation className="mx-auto mb-1 h-4 w-4 text-blue-500" /><div className="text-lg font-bold">{routeMetrics?.completion ?? 0}%</div><div className="text-[10px] text-muted-foreground">{t("execution")}</div></div>
            <div className="p-3 text-center"><Clock className="mx-auto mb-1 h-4 w-4 text-amber-500" /><div className="text-lg font-bold">{routeMetrics?.duration ? durationLabel(routeMetrics.duration) : "—"}</div><div className="text-[10px] text-muted-foreground">{t("duration")}</div></div>
            <div className="p-3 text-center"><MapPin className="mx-auto mb-1 h-4 w-4 text-fuchsia-500" /><div className="text-lg font-bold">{selectedRoute.totalPoints}</div><div className="text-[10px] text-muted-foreground">{t("points")}</div></div>
            <div className="p-3 text-center"><Route className="mx-auto mb-1 h-4 w-4 text-cyan-600" /><div className="text-lg font-bold">{selectedRoute.distanceKm ? `${selectedRoute.distanceKm} km` : "—"}</div><div className="text-[10px] text-muted-foreground">{t("distance")}</div></div>
          </div>
          {selectedRoutePoints.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" style={{ height: 360 }}><MtmRouteMap points={selectedRoutePoints} timezone={timezone} /></div>
          )}
          <MtmRouteTravelPanel
            route={selectedRoute}
            canCalculate={selectedRoute.status === "DRAFT" && canEditRoute(selectedRoute)}
            locale={locale}
            orgId={orgId ? String(orgId) : undefined}
          />
          {selectedRoutePoints.length > 0 && (
            <div className="space-y-1">
              {[...selectedRoutePoints].sort((a: MtmRoutePoint, b: MtmRoutePoint) => a.orderIndex - b.orderIndex).map((p: MtmRoutePoint, i: number) => {
                // Plan versus fact (audit 2026-09-14): the row used to show one
                // time — the check-out — and nothing about lateness, order,
                // zone or what was collected.
                const fact = selectedRouteExecution.points.find((item) => item.pointId === p.id)
                const visit = fact?.visit ?? null
                // The rule of the visit review (visitPlaceSummary): the detail
                // payload already resolved the customer's radius or the
                // organization default into geofenceRadiusMeters.
                // A co-participant outside the reader's scope comes with its
                // coordinates withheld: that is not "no GPS", so no verdict.
                const place = visit && !visit.locationHidden ? visitPlaceSummary({
                  ...visit,
                  customer: { latitude: p.customer?.latitude, longitude: p.customer?.longitude, geofenceRadius: p.geofenceRadiusMeters ?? p.customer?.geofenceRadius },
                }) : null
                return (
                <div key={p.id} data-testid="mtm-route-detail-stop" className="border-b border-zinc-200 py-2 text-xs last:border-b-0 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${p.status === "VISITED" ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300" : p.status === "SKIPPED" ? "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 font-medium">
                    {visit ? (
                      <Link className="hover:underline" href={`/mtm/visits?visitId=${encodeURIComponent(visit.id)}`}>{p.customer?.name || "—"}</Link>
                    ) : (p.customer?.name || "—")}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${p.status === "VISITED" ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-300" : p.status === "SKIPPED" ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-300" : "bg-muted/50 text-muted-foreground"}`}>{t(pointStatusLabelKey[p.status] ?? "pointStatusUnknown")}</span>
                  {p.changeRequests?.some((request) => request.changeType === "REMOVE_STOP") ? (
                    <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{t("removalPending")}</span>
                  ) : null}
                  {selectedRoute.historicalAccessOnly !== true && (selectedRoute.status === "PLANNED" || selectedRoute.status === "IN_PROGRESS") && p.status !== "VISITED" && !p.changeRequests?.some((request) => request.changeType === "REMOVE_STOP") ? (
                    <Button variant="ghost" size="sm" onClick={() => { setRemovalPointId(p.id); setRemovalReason("") }}>{t("requestRemoval")}</Button>
                  ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-muted-foreground">
                    <span>{p.plannedTime ? t("stopFact.planned", { time: tenantTime(p.plannedTime) }) : t("stopFact.notPlanned")}</span>
                    {fact?.checkInAt && visit ? (
                      <span className="font-medium text-foreground">
                        {fact.checkOutAt
                          ? t("stopFact.fact", { from: tenantTime(fact.checkInAt), to: tenantTime(fact.checkOutAt) })
                          : t("stopFact.factOpen", { from: tenantTime(fact.checkInAt) })}
                        {fact.durationMinutes !== null ? ` · ${durationLabel(fact.durationMinutes)}` : ""}
                      </span>
                    ) : p.visitedAt ? (
                      <span>{t("stopFact.closedAt", { time: tenantTime(p.visitedAt) })}</span>
                    ) : isStopOverdue(p, selectedRoute.status) ? (
                      <span>{t("stopFact.notVisited")}</span>
                    ) : null}
                    {fact?.timing === "LATE" && fact.delayMinutes !== null ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{t("stopFact.late", { delay: durationLabel(fact.delayMinutes) })}</span>
                    ) : fact?.timing === "EARLY" && fact.delayMinutes !== null ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{t("stopFact.early", { delay: durationLabel(Math.abs(fact.delayMinutes)) })}</span>
                    ) : fact?.timing === "ON_TIME" ? (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/20 dark:text-green-300">{t("stopFact.onTime")}</span>
                    ) : null}
                    {fact?.outOfOrder && fact.actualSequence !== null ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><ArrowDownUp className="h-3 w-3" />{t("stopFact.outOfOrder", { actual: fact.actualSequence })}</span>
                    ) : null}
                    {visit?.locationHidden ? (
                      <span data-place-verdict="location_hidden" className="text-[10px] text-muted-foreground">{tPlace("locationHidden")}</span>
                    ) : place ? <VisitPlaceBadge place={place} size="xs" /> : null}
                    {visit?.photoCount ? (
                      <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{t("stopFact.photos", { count: visit.photoCount })}</span>
                    ) : null}
                    {visit?.hasSignature ? (
                      <span className="inline-flex items-center" title={t("stopFact.signature")} aria-label={t("stopFact.signature")}><PenLine className="h-3 w-3" /></span>
                    ) : null}
                    {visit?.hasNote ? (
                      <span className="inline-flex items-center" title={t("stopFact.note")} aria-label={t("stopFact.note")}><StickyNote className="h-3 w-3" /></span>
                    ) : null}
                    {visit ? (
                      <Link className="ml-auto text-primary hover:underline" href={`/mtm/visits?visitId=${encodeURIComponent(visit.id)}`}>{t("stopFact.openVisit")}</Link>
                    ) : null}
                  </div>
                  {removalPointId === p.id ? (
                    <div className="mt-2 flex flex-col gap-2 pl-7 sm:flex-row">
                      <Input value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} placeholder={t("removalReason")} />
                      <Button size="sm" onClick={() => requestStopRemoval(selectedRoute.id, p.id)} disabled={requestingRemoval || removalReason.trim().length < 3}>{t("submitRequest")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemovalPointId(null)}>{t("cancelBuilder")}</Button>
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>
          )}
            </section>
          </>
        ) : null}
      </Dialog>

      {viewMode === "list" ? (
        <>
          <div data-testid="mtm-route-status-filters" role="group" aria-label={t("routeSummary")} className="flex flex-wrap gap-2">
            <Button aria-pressed={activeFilter === "all"} variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{routesTotal > routes.length ? t("allLatest", { shown: routes.length, total: routesTotal }) : `${t("all")} (${routes.length})`}</Button>
            {(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE", "CANCELLED"] as const).map(s => (
              <Button key={s} aria-pressed={activeFilter === s} variant={activeFilter === s ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(s)}>
                {mtmStatusLabel(statusT, "route", s)} ({statusCounts[s] || 0})
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input data-testid="mtm-route-list-search" placeholder={t("searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[160px]">
              <option value="date_desc">{t("sortDateDesc")}</option>
              <option value="date_asc">{t("sortDateAsc")}</option>
              <option value="status">{t("sortStatus")}</option>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{routes.length === 0 ? t("empty") : t("noResults")}</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((route) => {
                const badge = statusBadge[route.status] || statusBadge.PLANNED
                const completion = route.totalPoints > 0 ? Math.round((route.visitedPoints / route.totalPoints) * 100) : 0
                const shortOfPlan = isMtmRouteShortOfPlan(route, route.date.slice(0, 10) < todayKey)
                // Routes audit 2026-09-26: a card took half a screen — three
                // buttons and every stop as a chip. One row now: who, when,
                // what came of it; the stops are one click away in the route.
                const stopsLine = route.name || (route.points ?? []).slice(0, 3).map((point) => point.customer?.name).filter(Boolean).join(", ")
                return (
                  <article key={route.id} data-testid="mtm-route-list-item" data-route-id={route.id} data-route-status={route.status} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-card px-3 py-2 transition-colors hover:border-primary/40 dark:border-zinc-700 sm:flex-row sm:items-center sm:gap-4">
                    <button
                      type="button"
                      data-testid={`mtm-route-open-${route.id}`}
                      className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openRouteDetails(route)}
                      aria-label={t("openRouteDetails", { employee: route.agent?.name ?? "—", date: formatDate(new Date(route.date), locale) })}
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-foreground">{route.agent?.name ?? "—"}</span>
                        {(route.assignments?.length ?? 0) > 1 ? <span className="text-xs text-muted-foreground">+{(route.assignments?.length ?? 1) - 1}</span> : null}
                        <span className="text-sm capitalize text-muted-foreground">{formatDate(new Date(route.date), locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                      </span>
                      {stopsLine ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stopsLine}</span> : null}
                      {/* Says the one thing the chip and the counters do not:
                          nobody closed this route, the day simply ended. */}
                      {route.status === "INCOMPLETE" ? (
                        <span className="mt-0.5 block text-xs text-orange-700 dark:text-orange-300">{t("incompleteReason")}</span>
                      ) : null}
                    </button>
                    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-2 text-xs" title={`${completion}%`}>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className={`block h-full rounded-full ${shortOfPlan ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${completion}%` }} /></span>
                        <span className="font-medium tabular-nums">{route.visitedPoints}/{route.totalPoints}</span>
                      </span>
                      {shortOfPlan ? (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("weekStopsMissed", { count: route.totalPoints - route.visitedPoints })}</span>
                      ) : null}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{mtmStatusLabel(statusT, "route", route.status)}</span>
                      {route.changeRequests?.length ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("viewApprovals")}: {route.changeRequests.length}</span> : null}
                      {canEditRoute(route) ? (
                        <span className="flex items-center">
                          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" title={t("edit")} aria-label={t("edit")} onClick={() => openRouteEditor(route)}><Pencil className="h-4 w-4" /></Button>
                          {route.status === "DRAFT" ? (
                            <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-destructive" title={t("delete")} aria-label={t("delete")} onClick={() => { setDeleteItem(route); setDeleteOpen(true) }}><Trash2 className="h-4 w-4" /></Button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {routesTotal > routes.length ? (
            <div className="flex justify-center">
              <Button data-testid="mtm-route-list-load-more" variant="outline" className="min-h-11" disabled={routesLoadingMore} onClick={() => void loadMoreRoutes()}>
                {routesLoadingMore ? <RefreshCw className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                {t("loadMoreRoutes", { count: Math.min(200, routesTotal - routes.length) })}
              </Button>
            </div>
          ) : null}
        </>
      ) : viewMode === "matrix" ? (
        <MtmRoutePlanningMatrix
          orgId={orgId ? String(orgId) : undefined}
          timezone={timezone}
          preferredAgentId={plannerContext.agentId ?? preferredPlanningAgentId}
          preferredStartDate={plannerContext.date}
          preferredDirection={plannerContext.direction ?? undefined}
          canManageAssignments={capabilities.canReview}
          canCreateRoutes={capabilities.canCreateRoute}
          selfAgentId={capabilities.actorAgentId}
          onPlannerContextChange={updatePlannerContext}
          onOpenDayPlanner={openDayPlannerFromMatrix}
        />
      ) : viewMode === "week" ? (
        <MtmRouteWeekPlan
          orgId={orgId ? String(orgId) : undefined}
          locale={locale}
          timezone={timezone}
          refreshVersion={calendarRefreshVersion}
          initialDate={plannerContext.date}
          onSelectRoute={openRouteDetails}
          onDateChange={(date) => updatePlannerContext({ date })}
          canCreateRoutes={capabilities.canCreateRoute}
          canManageAssignments={capabilities.canReview}
          selfAgentId={capabilities.actorAgentId}
          onCreateRoute={({ date, agentId }) => openNewRoute({ date, agentId, returnView: "week" })}
        />
      ) : viewMode === "agent" ? (
        <MtmAgentPeriodView timezone={timezone} initialAgentId={capabilities.canReview ? searchParams.get("agentId") : capabilities.actorAgentId} />
      ) : viewMode === "approvals" ? (
        approvalCounts && approvalTotal === 0 ? (
          <div data-testid="mtm-approvals-empty" role="status" className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-card px-4 py-4 text-sm dark:border-zinc-700">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {t("needsAttentionClearDescription")}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Only the queue that has something in it; both while the count is unknown. */}
            {!approvalCounts || approvalCounts.routeChanges > 0 ? <MtmRouteApprovalQueue orgId={orgId ? String(orgId) : undefined} active onChanged={refreshApprovalViews} /> : null}
            {!approvalCounts || approvalCounts.customerRequests > 0 ? <MtmCustomerRequestQueue orgId={orgId ? String(orgId) : undefined} active onChanged={refreshApprovalViews} /> : null}
          </div>
        )
      ) : (
        <MtmRouteCalendar
          routes={calendarRoutes}
          month={calendarMonth}
          workCalendarOverrides={workCalendarOverrides}
          workCalendarKnown={workCalendarKnown}
          workCalendarEnforced={workCalendarEnforced}
          selectedDate={plannerContext.date}
          locale={locale}
          loading={calendarLoading}
          error={calendarError}
          onMonthChange={setCalendarMonth}
          onSelectedDateChange={(date) => updatePlannerContext({ date })}
          onRetry={() => setCalendarRefreshVersion((current) => current + 1)}
          onSelectRoute={openRouteDetails}
          canCreateRoutes={capabilities.canCreateRoute}
          onCreateRoute={(date) => openNewRoute({ date, returnView: "calendar" })}
        />
      )}

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem?.name || tf("thisRoute")} />
    </div>
  )
}

export default function MtmRoutesPage() {
  return <MtmRoutesWorkspace />
}
