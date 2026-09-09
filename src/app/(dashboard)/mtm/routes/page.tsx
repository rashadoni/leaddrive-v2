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
import { MtmRouteWeekPlan } from "@/components/mtm/route-week-plan"
import { MtmRoutePlanningMatrix } from "@/components/mtm/route-planning-matrix"
import { MtmRouteApprovalQueue } from "@/components/mtm/route-approval-queue"
import { MtmRouteNeedsAttention } from "@/components/mtm/route-needs-attention"
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
  ArrowLeft, List, CalendarDays, Clock, Navigation, ChevronDown, Eye, X, Columns3, ClipboardCheck, Users, FileSpreadsheet, TableProperties,
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

type RouteViewMode = "list" | "matrix" | "week" | "calendar" | "approvals"

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

function routeAssignmentDirection(value: string | null): MtmRouteAssignmentDirection | undefined {
  return value === "DOCTOR" || value === "PHARMACY" || value === "ORGANIZATION" ? value : undefined
}

function routeViewMode(value: string | null): RouteViewMode | null {
  return value === "calendar" || value === "week" || value === "list" || value === "matrix" || value === "approvals"
    ? value
    : null
}

function canUseRouteView(mode: RouteViewMode, canReview: boolean) {
  return canReview || (mode !== "week" && mode !== "approvals")
}

export default function MtmRoutesPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const tf = useTranslations("mtmForms")
  const [routes, setRoutes] = useState<MtmRouteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderPreset, setBuilderPreset] = useState<RouteBuilderPreset | null>(null)
  const [editData, setEditData] = useState<MtmRouteRecord | undefined>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmRouteRecord | null>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("date_desc")
  const [viewMode, setViewMode] = useState<RouteViewMode>("calendar")
  const [viewPreferenceReady, setViewPreferenceReady] = useState(false)
  const [advancedViewsOpen, setAdvancedViewsOpen] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState<MtmRouteRecord | null>(null)
  const [routeDetailLoading, setRouteDetailLoading] = useState(false)
  const [focusedRouteUnavailable, setFocusedRouteUnavailable] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState<Date | null>(null)
  const [calendarRoutes, setCalendarRoutes] = useState<MtmRouteRecord[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState(false)
  const [calendarRefreshVersion, setCalendarRefreshVersion] = useState(0)
  const [approvalRefreshVersion, setApprovalRefreshVersion] = useState(0)
  const [removalPointId, setRemovalPointId] = useState<string | null>(null)
  const [removalReason, setRemovalReason] = useState("")
  const [requestingRemoval, setRequestingRemoval] = useState(false)
  const [capabilities, setCapabilities] = useState<RouteCapabilities>(EMPTY_ROUTE_CAPABILITIES)
  const [customerRequestOpen, setCustomerRequestOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [customerRequestRouteId, setCustomerRequestRouteId] = useState<string | undefined>()
  const [timezone, setTimezone] = useState("Asia/Baku")
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
    fetch("/api/v1/mtm/settings", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((result) => {
        if (!controller.signal.aborted && result.success && typeof result.data?.timezone === "string") setTimezone(result.data.timezone)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [orgId])

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
  const canEditRoute = (route: MtmRouteRecord) => route.status === "DRAFT"
    && route.historicalAccessOnly !== true
    && (capabilities.canReview || (capabilities.canCreateRoute && route.agentId === capabilities.actorAgentId))
  const preferredPlanningAgentId = !capabilities.canReview && capabilities.actorAgentId
    ? capabilities.actorAgentId
    : selectedRoute?.agentId
    ?? routes.find((route) => route.status === "IN_PROGRESS")?.agentId
    ?? routes[0]?.agentId
    ?? null
  const advancedViewActive = viewMode === "list" || viewMode === "matrix" || viewMode === "approvals"
  const primaryCalendarLabel = t(capabilities.canReview ? "viewTeamCalendar" : "viewMyCalendar")
  const planningToolsLabel = t(capabilities.canReview ? "controlAndReports" : "routePlanningTools")
  const advancedViewLabel = viewMode === "list"
    ? t(capabilities.canReview ? "viewList" : "viewMyRoutes")
    : viewMode === "matrix"
      ? t("viewMatrix")
      : viewMode === "approvals"
        ? t("viewApprovals")
        : planningToolsLabel

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
      <header data-testid="mtm-route-header" className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-700 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Route className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-6 text-foreground">{t("title")}</h1>
            <p className="text-sm leading-5 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <HelpButton slug="mtm-routes" className="shrink-0" />
        </div>
        <div data-testid="mtm-route-toolbar" className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center xl:w-auto">
          <nav data-testid="mtm-route-view-switcher" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label={t("primaryViews")}>
            <div className={`grid shrink-0 gap-1 rounded-xl border border-zinc-200 bg-muted/30 p-1 dark:border-zinc-700 ${capabilities.canReview ? "grid-cols-2" : "grid-cols-1"}`} role="group" aria-label={t("primaryViews")}>
              <Button data-testid="mtm-routes-view-calendar" aria-pressed={viewMode === "calendar"} variant={viewMode === "calendar" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => { setViewMode("calendar"); setAdvancedViewsOpen(false) }}><CalendarDays className="mr-1 h-4 w-4" />{primaryCalendarLabel}</Button>
              {capabilities.canReview ? <Button data-testid="mtm-routes-view-week" aria-pressed={viewMode === "week"} variant={viewMode === "week" ? "default" : "ghost"} size="sm" className="min-h-10 whitespace-nowrap rounded-lg px-3" onClick={() => { setViewMode("week"); setAdvancedViewsOpen(false) }}><Columns3 className="mr-1 h-4 w-4" />{t("viewWeek")}</Button> : null}
            </div>
            <details data-testid="mtm-routes-more-views" className="group relative shrink-0" open={advancedViewsOpen} onToggle={(event) => setAdvancedViewsOpen(event.currentTarget.open)}>
              <summary data-testid="mtm-routes-more-views-toggle" aria-label={advancedViewLabel} title={advancedViewLabel} className={`flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-10 [&::-webkit-details-marker]:hidden ${advancedViewActive ? "border-primary/35 bg-primary/5 text-primary" : "border-zinc-200 bg-card hover:bg-muted/60 dark:border-zinc-700"}`}>
                {advancedViewLabel}<ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 z-20 mt-2 grid min-w-56 gap-1 rounded-xl border border-zinc-200 bg-card p-2 shadow-lg dark:border-zinc-700">
                <Button data-testid="mtm-routes-view-list" aria-pressed={viewMode === "list"} variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" className="min-h-11 justify-start" onClick={() => { setViewMode("list"); setAdvancedViewsOpen(false) }}><List className="mr-2 h-4 w-4" />{t(capabilities.canReview ? "viewList" : "viewMyRoutes")}</Button>
                <Button data-testid="mtm-routes-view-matrix" aria-pressed={viewMode === "matrix"} variant={viewMode === "matrix" ? "secondary" : "ghost"} size="sm" className="min-h-11 justify-start" onClick={() => { setViewMode("matrix"); setAdvancedViewsOpen(false) }}><TableProperties className="mr-2 h-4 w-4" />{t("viewMatrix")}</Button>
                {capabilities.canReview ? <Button aria-pressed={viewMode === "approvals"} variant={viewMode === "approvals" ? "secondary" : "ghost"} size="sm" className="min-h-11 justify-start" onClick={() => { setViewMode("approvals"); setAdvancedViewsOpen(false) }}><ClipboardCheck className="mr-2 h-4 w-4" />{t("viewApprovals")}</Button> : null}
                {capabilities.canReview ? <Button data-testid="mtm-routes-excel-exchange" variant="ghost" size="sm" className="min-h-11 justify-start" onClick={() => { setExcelOpen(true); setAdvancedViewsOpen(false) }}><FileSpreadsheet className="mr-2 h-4 w-4" />{t("excelExchange")}</Button> : null}
              </div>
            </details>
          </nav>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {returnTarget ? <Button asChild variant="outline" className="min-h-11 whitespace-nowrap px-3 lg:min-h-10"><Link href={returnTarget.href}><ArrowLeft className="mr-1 h-4 w-4" />{t(returnTarget.label)}</Link></Button> : null}
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
        maxHeightClassName="max-h-dvh md:max-h-[min(52rem,calc(100dvh-2rem))]"
        hideClose
        mobileFullscreen
        mobileFullscreenBreakpoint="md"
      >
        <DialogTitle className="sr-only">{editData ? t("builderEditTitle") : t("builderNewTitle")}</DialogTitle>
        <div data-testid="mtm-route-builder-dialog" className="min-h-0 overflow-hidden">
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
            <div className="p-3 text-center"><Clock className="mx-auto mb-1 h-4 w-4 text-amber-500" /><div className="text-lg font-bold">{routeMetrics?.duration ? `${Math.floor(routeMetrics.duration / 60)}h ${routeMetrics.duration % 60}m` : "—"}</div><div className="text-[10px] text-muted-foreground">{t("duration")}</div></div>
            <div className="p-3 text-center"><MapPin className="mx-auto mb-1 h-4 w-4 text-fuchsia-500" /><div className="text-lg font-bold">{selectedRoute.totalPoints}</div><div className="text-[10px] text-muted-foreground">{t("points")}</div></div>
            <div className="p-3 text-center"><Route className="mx-auto mb-1 h-4 w-4 text-cyan-600" /><div className="text-lg font-bold">{selectedRoute.distanceKm ? `${selectedRoute.distanceKm} km` : "—"}</div><div className="text-[10px] text-muted-foreground">{t("distance")}</div></div>
          </div>
          {selectedRoutePoints.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" style={{ height: 300 }}><MtmRouteMap points={selectedRoutePoints} /></div>
          )}
          <MtmRouteTravelPanel
            route={selectedRoute}
            canCalculate={canEditRoute(selectedRoute)}
            locale={locale}
            orgId={orgId ? String(orgId) : undefined}
          />
          {selectedRoutePoints.length > 0 && (
            <div className="space-y-1">
              {[...selectedRoutePoints].sort((a: MtmRoutePoint, b: MtmRoutePoint) => a.orderIndex - b.orderIndex).map((p: MtmRoutePoint, i: number) => (
                <div key={p.id} className="border-b border-zinc-200 py-2 text-xs last:border-b-0 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${p.status === "VISITED" ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300" : p.status === "SKIPPED" ? "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                  <span className="flex-1">{p.customer?.name || "—"}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${p.status === "VISITED" ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-300" : p.status === "SKIPPED" ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-300" : "bg-muted/50 text-muted-foreground"}`}>{t(pointStatusLabelKey[p.status] ?? "pointStatusUnknown")}</span>
                  {p.changeRequests?.some((request) => request.changeType === "REMOVE_STOP") ? (
                    <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{t("removalPending")}</span>
                  ) : null}
                  {p.visitedAt && <span className="text-muted-foreground">{formatTime(new Date(p.visitedAt), locale)}</span>}
                  {selectedRoute.historicalAccessOnly !== true && (selectedRoute.status === "PLANNED" || selectedRoute.status === "IN_PROGRESS") && p.status !== "VISITED" && !p.changeRequests?.some((request) => request.changeType === "REMOVE_STOP") ? (
                    <Button variant="ghost" size="sm" onClick={() => { setRemovalPointId(p.id); setRemovalReason("") }}>{t("requestRemoval")}</Button>
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
              ))}
            </div>
          )}
            </section>
          </>
        ) : null}
      </Dialog>

      {viewMode === "list" ? (
        <>
          <div data-testid="mtm-route-status-filters" role="group" aria-label={t("routeSummary")} className="flex flex-wrap gap-2">
            <Button aria-pressed={activeFilter === "all"} variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{t("all")} ({routes.length})</Button>
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
            <div className="space-y-2">
              {filtered.map((route) => {
                const badge = statusBadge[route.status] || statusBadge.PLANNED
                const completion = route.totalPoints > 0 ? Math.round((route.visitedPoints / route.totalPoints) * 100) : 0
                return (
                  <article key={route.id} data-testid="mtm-route-list-item" data-route-id={route.id} data-route-status={route.status} className="rounded-lg border border-zinc-200 bg-card p-3 transition-colors hover:border-primary/40 dark:border-zinc-700">
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <User className="h-4 w-4 text-cyan-500" /><span className="font-medium text-sm">{route.agent?.name}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(new Date(route.date), locale)}</span>
                        {(route.assignments?.length ?? 0) > 1 ? <span className="text-xs text-muted-foreground">+{(route.assignments?.length ?? 1) - 1}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{mtmStatusLabel(statusT, "route", route.status)}</span>
                        {route.changeRequests?.length ? <span className="text-[10px] text-amber-700 dark:text-amber-300">{t("viewApprovals")}: {route.changeRequests.length}</span> : null}
                        <Button data-testid={`mtm-route-open-${route.id}`} variant="outline" size="sm" className="min-h-11" onClick={() => openRouteDetails(route)} aria-label={t("openRouteDetails", { employee: route.agent?.name ?? "—", date: formatDate(new Date(route.date), locale) })}>
                          <Eye className="mr-1 h-4 w-4" />{t("viewRoute")}
                        </Button>
                        {canEditRoute(route) ? (
                          <>
                            <Button variant="outline" size="sm" className="min-h-11" onClick={() => openRouteEditor(route)}><Pencil className="mr-1 h-3.5 w-3.5" />{t("edit")}</Button>
                            {route.status === "DRAFT" ? (
                              <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-destructive" title={t("delete")} aria-label={t("delete")} onClick={() => { setDeleteItem(route); setDeleteOpen(true) }}><Trash2 className="h-3.5 w-3.5" /></Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                    {route.name && <div className="text-xs text-muted-foreground mb-2">{route.name}</div>}
                    {/* Says the one thing the chip and the counters below do not:
                        nobody closed this route, the day simply ended. */}
                    {route.status === "INCOMPLETE" ? (
                      <div className="mb-2 text-xs text-orange-700 dark:text-orange-300">{t("incompleteReason")}</div>
                    ) : null}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {route.totalPoints} {t("points")}</span>
                        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> {route.visitedPoints} {t("visited")}</span>
                      </div>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${completion}%` }} /></div>
                      <span className="text-xs font-medium text-muted-foreground">{completion}%</span>
                    </div>
                    {route.points && route.points.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {route.points.map((p: MtmRoutePoint, i: number) => (
                          <span key={p.id} className={`text-[10px] px-1.5 py-0.5 rounded border ${p.status === "VISITED" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800" : p.status === "SKIPPED" ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-800" : "bg-muted/50 border-zinc-200 dark:border-zinc-700 text-muted-foreground"}`}>
                            {i + 1}. {p.customer?.name || "—"}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
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
          refreshVersion={calendarRefreshVersion}
          initialDate={plannerContext.date}
          onSelectRoute={openRouteDetails}
          onDateChange={(date) => updatePlannerContext({ date })}
          canCreateRoutes={capabilities.canCreateRoute}
          canManageAssignments={capabilities.canReview}
          selfAgentId={capabilities.actorAgentId}
          onCreateRoute={({ date, agentId }) => openNewRoute({ date, agentId, returnView: "week" })}
        />
      ) : viewMode === "approvals" ? (
        <div className="space-y-4">
          <MtmRouteNeedsAttention orgId={orgId ? String(orgId) : undefined} active refreshVersion={approvalRefreshVersion} />
          <MtmRouteApprovalQueue orgId={orgId ? String(orgId) : undefined} active onChanged={refreshApprovalViews} />
          <MtmCustomerRequestQueue orgId={orgId ? String(orgId) : undefined} active onChanged={refreshApprovalViews} />
        </div>
      ) : (
        <MtmRouteCalendar
          routes={calendarRoutes}
          month={calendarMonth}
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
