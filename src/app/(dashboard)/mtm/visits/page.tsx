"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Timer,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { MtmVisitForm } from "@/components/mtm/visit-form"
import { MtmWorkflowGuide } from "@/components/mtm/mtm-workflow-guide"
import { PageDescription } from "@/components/page-description"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { formatDateTime } from "@/lib/format-date"
import {
  isOwnVisitExecution,
  isVisitGoneResponse,
  selectActiveVisitId,
  visitApiErrorKey,
  visitPlaceSummary,
  visitStatusKey,
  visitStillOpenFromResponse,
} from "@/lib/mtm/visit-review"
import { VisitReviewPanel, formatDistance, visitStatusClasses, type ReviewedVisitFacts } from "./visit-review-panel"
import { VisitWorkspace } from "./visit-workspace"

type MtmVisitRow = {
  id: string
  canMutate?: boolean
  agentId?: string | null
  customerId?: string | null
  status: "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | string
  checkInAt: string
  checkOutAt?: string | null
  duration?: number | null
  checkInLat?: number | null
  checkInLng?: number | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  notes?: string | null
  agent?: { id: string; name: string | null } | null
  customer?: {
    id: string
    name: string | null
    address?: string | null
    city?: string | null
    latitude?: number | null
    longitude?: number | null
    geofenceRadius?: number | null
  } | null
}

type ActiveVisitRow = {
  id: string
  agentId?: string | null
  checkInAt: string
  agent?: { id: string; name: string | null } | null
  customer?: { id: string; name: string | null; address?: string | null } | null
}

type VisitViewer = { agentId: string | null; role: string }

type HistoryRange = "today" | "7d" | "30d" | "all"

type VisitMeta = {
  total: number | null
  totalExact: boolean
  sourceTruncated: boolean
  candidateLimit: number | null
  timezone: string
  geofenceRadius: number | null
}

const HISTORY_RANGES = [
  { value: "today", label: "rangeToday" },
  { value: "7d", label: "range7Days" },
  { value: "30d", label: "range30Days" },
  { value: "all", label: "rangeAll" },
] as const

const VISIT_FILTER_LABELS = {
  CHECKED_IN: "filterCheckedIn",
  CHECKED_OUT: "filterCheckedOut",
} as const

/** Background refresh cadence while the tab is visible (audit 2026-09-14, item 3). */
const LIVE_REFRESH_MS = 30_000

/** Open visits listed above the history; the rest are one filter away. */
const TEAM_ACTIVE_PREVIEW_LIMIT = 8

function operationalWeekReturnHref(value: string | null): string | null {
  return value === "/mtm" || value?.startsWith("/mtm?") ? value : null
}

export default function MtmVisitsPage() {
  const { data: session } = useSession()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("mtmVisitsPage")
  const tf = useTranslations("mtmForms")
  const tw = useTranslations("mtmVisitWorkspace")
  const [visits, setVisits] = useState<MtmVisitRow[]>([])
  const [meta, setMeta] = useState<VisitMeta>({
    total: null,
    totalExact: false,
    sourceTruncated: false,
    candidateLimit: null,
    timezone: "UTC",
    geofenceRadius: null,
  })
  const [activeVisits, setActiveVisits] = useState<ActiveVisitRow[]>([])
  const [viewer, setViewer] = useState<VisitViewer | null>(null)
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [focusedVisitUnavailable, setFocusedVisitUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<MtmVisitRow | undefined>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmVisitRow | null>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("date_desc")
  const [historyRange, setHistoryRange] = useState<HistoryRange>("today")
  const orgId = session?.user?.organizationId
  const focusedVisitId = searchParams.get("visitId")
  const returnHref = operationalWeekReturnHref(searchParams.get("returnTo"))
  const visitRequestRef = useRef<{ id: number; identity: string; controller: AbortController | null; pending: boolean }>({
    id: 0,
    identity: "",
    controller: null,
    pending: false,
  })
  const activeVisitRequestRef = useRef<{ id: number; identity: string; controller: AbortController | null }>({
    id: 0,
    identity: "",
    controller: null,
  })
  const [activeResolved, setActiveResolved] = useState(false)
  const activeVisitIdRef = useRef<string | null>(null)
  const activeVisitsRef = useRef<ActiveVisitRow[]>([])
  const visitsRef = useRef<MtmVisitRow[]>([])
  const focusedVisitIdRef = useRef<string | null>(focusedVisitId)
  const focusSelectedRef = useRef<string | null>(null)
  const lastRefreshAtRef = useRef(0)
  const viewerKey = String(session?.user?.id ?? session?.user?.email ?? "")
  const tCommon = useTranslations("mtmCommon")
  // The list does not depend on which visit is open: opening a row must not reload 200 rows.
  const listIdentityKey = `${String(orgId ?? "")}:${viewerKey}:${historyRange}`
  const activeIdentityKey = `${String(orgId ?? "")}:${viewerKey}`

  useEffect(() => {
    activeVisitIdRef.current = activeVisitId
  }, [activeVisitId])
  useEffect(() => {
    activeVisitsRef.current = activeVisits
  }, [activeVisits])
  useEffect(() => {
    visitsRef.current = visits
  }, [visits])
  useEffect(() => {
    focusedVisitIdRef.current = focusedVisitId
  }, [focusedVisitId])

  /**
   * `silent` is the background refresh: it keeps open dialogs, shows no
   * loading state and no error toast, and never replaces a user-triggered
   * load that is still in flight.
   */
  const fetchVisits = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (silent && visitRequestRef.current.pending) return
    visitRequestRef.current.controller?.abort()
    const requestId = visitRequestRef.current.id + 1
    const controller = new AbortController()
    visitRequestRef.current = { id: requestId, identity: listIdentityKey, controller, pending: true }
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && visitRequestRef.current.id === requestId
      && visitRequestRef.current.identity === listIdentityKey
      && visitRequestRef.current.controller === controller
    )

    if (!silent) {
      setEditData(undefined)
      setFormOpen(false)
      setDeleteItem(null)
      setDeleteOpen(false)
      setLoading(true)
    }

    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const res = await fetch(`/api/v1/mtm/visits?limit=200&range=${historyRange}`, { headers, signal: controller.signal })
      const result = await res.json().catch(() => null)
      if (!isCurrentRequest()) return
      if (!res.ok || !result?.success) {
        // A failed list says nothing about the focused visit; keep what is on screen.
        if (!silent) toast.error(t("loadFailed"))
        return
      }

      const listed: MtmVisitRow[] = result.data.visits || []
      setVisits((current) => {
        // A focused visit outside this period stays pinned on top instead of vanishing.
        const focusedId = focusedVisitIdRef.current
        const pinned = focusedId && !listed.some((visit) => visit.id === focusedId)
          ? current.find((visit) => visit.id === focusedId)
          : undefined
        return pinned ? [pinned, ...listed] : listed
      })
      setMeta({
        total: typeof result.data.total === "number" ? result.data.total : null,
        totalExact: result.data.totalExact === true,
        sourceTruncated: result.data.sourceTruncated === true,
        candidateLimit: typeof result.data.candidateLimit === "number" ? result.data.candidateLimit : null,
        timezone: typeof result.data.timezone === "string" ? result.data.timezone : "UTC",
        geofenceRadius: typeof result.data.geofenceRadius === "number" ? result.data.geofenceRadius : null,
      })
    } catch (error) {
      if (!isCurrentRequest() || (error as { name?: string })?.name === "AbortError") return
      if (!silent) toast.error(t("loadFailed"))
    } finally {
      if (visitRequestRef.current.controller === controller) visitRequestRef.current.pending = false
      if (isCurrentRequest() && !silent) setLoading(false)
    }
  }, [historyRange, listIdentityKey, orgId, t])

  /**
   * The focused row, once per opened visit. Skipped when the list already
   * holds it — the review panel keeps its status current from then on.
   * Only 403/404 mark it unavailable; a transient failure keeps the review.
   */
  const fetchFocusedVisit = useCallback(async (visitId: string, signal: AbortSignal) => {
    if (visitsRef.current.some((visit) => visit.id === visitId)) return
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const response = await fetch(`/api/v1/mtm/visits/${encodeURIComponent(visitId)}`, { headers, signal })
      const body = await response.json().catch(() => null)
      if (signal.aborted) return
      if (isVisitGoneResponse(response.status)) {
        setFocusedVisitUnavailable(true)
        setVisits((rows) => rows.filter((visit) => visit.id !== visitId))
        return
      }
      if (!response.ok || !body?.success || body.data?.id !== visitId) return
      const focusedVisit = body.data as MtmVisitRow
      setVisits((rows) => rows.some((visit) => visit.id === visitId)
        ? rows.map((visit) => visit.id === visitId ? focusedVisit : visit)
        : [focusedVisit, ...rows])
    } catch {
      // Transient: the review panel shows its own retry state.
    }
  }, [orgId])

  /** Resolves with the ids that left the open-visit list, so the caller can decide whether the history needs a reload. */
  const fetchActiveVisits = useCallback(async (): Promise<string[]> => {
    activeVisitRequestRef.current.controller?.abort()
    const requestId = activeVisitRequestRef.current.id + 1
    const controller = new AbortController()
    activeVisitRequestRef.current = { id: requestId, identity: activeIdentityKey, controller }
    const previousActiveVisitId = activeVisitIdRef.current
    const previousRows = activeVisitsRef.current
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && activeVisitRequestRef.current.id === requestId
      && activeVisitRequestRef.current.identity === activeIdentityKey
      && activeVisitRequestRef.current.controller === controller
    )

    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const res = await fetch("/api/v1/mtm/visits/active", { headers, signal: controller.signal })
      const body = await res.json().catch(() => null)
      if (!isCurrentRequest() || !res.ok || !body?.success) return []
      const nextViewer: VisitViewer | null = body.data.viewer ?? null
      const isOwn = (visit: ActiveVisitRow) => isOwnVisitExecution(nextViewer, { agentId: visit.agentId, status: "CHECKED_IN" })
      let next: ActiveVisitRow[] = body.data.visits ?? []

      // Missing from the capped list is not proof the visit ended. Ask for
      // that one visit before closing the workspace the agent is typing in.
      const previousRow = previousActiveVisitId ? previousRows.find((visit) => visit.id === previousActiveVisitId) : undefined
      if (previousRow && isOwn(previousRow) && !next.some((visit) => visit.id === previousRow.id)) {
        let stillOpen = true
        try {
          const response = await fetch(`/api/v1/mtm/visits/${encodeURIComponent(previousRow.id)}`, { headers, signal: controller.signal })
          stillOpen = visitStillOpenFromResponse(response.status, await response.json().catch(() => null))
        } catch {
          stillOpen = true
        }
        if (!isCurrentRequest()) return []
        if (stillOpen) next = [previousRow, ...next]
      }

      const nextActiveVisitId = selectActiveVisitId({
        ownOpenVisitIds: next.filter(isOwn).map((visit) => visit.id),
        currentId: previousActiveVisitId,
        focusedId: focusedVisitIdRef.current,
      })
      setActiveVisits(next)
      setViewer(nextViewer)
      activeVisitIdRef.current = nextActiveVisitId
      setActiveVisitId(nextActiveVisitId)
      const nextIds = new Set(next.map((visit) => visit.id))
      return previousRows.filter((visit) => !nextIds.has(visit.id)).map((visit) => visit.id)
    } catch (error) {
      if (!isCurrentRequest() || (error as { name?: string })?.name === "AbortError") return []
      // History remains available when the active-visit endpoint is temporarily unavailable.
      return []
    } finally {
      // Resolved either way: without an answer the viewer is treated as an office user.
      if (isCurrentRequest()) setActiveResolved(true)
    }
  }, [activeIdentityKey, orgId])

  useEffect(() => {
    void fetchVisits()
    return () => visitRequestRef.current.controller?.abort()
  }, [fetchVisits])

  useEffect(() => {
    void fetchActiveVisits()
    return () => activeVisitRequestRef.current.controller?.abort()
  }, [fetchActiveVisits])

  useEffect(() => {
    setFocusedVisitUnavailable(false)
    if (!focusedVisitId) return
    const controller = new AbortController()
    void fetchFocusedVisit(focusedVisitId, controller.signal)
    return () => controller.abort()
  }, [fetchFocusedVisit, focusedVisitId])

  // Opening one of the viewer's own open visits selects its workspace — once
  // per opened visit, so a refresh never overrides a later manual switch.
  useEffect(() => {
    if (!focusedVisitId || focusSelectedRef.current === focusedVisitId) return
    const own = activeVisits.some((visit) => visit.id === focusedVisitId && isOwnVisitExecution(viewer, { agentId: visit.agentId, status: "CHECKED_IN" }))
    if (!own) return
    focusSelectedRef.current = focusedVisitId
    activeVisitIdRef.current = focusedVisitId
    setActiveVisitId(focusedVisitId)
  }, [activeVisits, focusedVisitId, viewer])

  // Live refresh: a visit that finishes in the field must not stay "in
  // progress" on this screen until someone reloads it. A background tick is
  // cheap on purpose: open visits and the focused review every time; the
  // history list only for today, or when an open visit it shows has ended.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (now - lastRefreshAtRef.current < 2_000) return
      lastRefreshAtRef.current = now
      const listIsLive = historyRange === "today"
      if (listIsLive) void fetchVisits({ silent: true })
      void fetchActiveVisits().then((departedIds) => {
        if (listIsLive || departedIds.length === 0) return
        const shownOpen = visitsRef.current.some((visit) => visit.status === "CHECKED_IN" && departedIds.includes(visit.id))
        if (shownOpen) void fetchVisits({ silent: true })
      })
      setRefreshTick((tick) => tick + 1)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh()
    }
    const interval = window.setInterval(refresh, LIVE_REFRESH_MS)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [fetchActiveVisits, fetchVisits, historyRange])

  /** The review already fetched the visit; the history row follows it without a request of its own. */
  const applyReviewedVisit = useCallback((facts: ReviewedVisitFacts) => {
    setVisits((rows) => {
      const row = rows.find((visit) => visit.id === facts.id)
      if (!row) return rows
      const changed = row.status !== facts.status
        || (row.checkOutAt ?? null) !== facts.checkOutAt
        || (row.duration ?? null) !== facts.duration
        || (row.checkOutLat ?? null) !== facts.checkOutLat
        || (row.checkOutLng ?? null) !== facts.checkOutLng
      return changed ? rows.map((visit) => visit.id === facts.id ? { ...visit, ...facts } : visit) : rows
    })
  }, [])

  const visitHref = useCallback((visitId: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (visitId) params.set("visitId", visitId)
    else params.delete("visitId")
    const query = params.toString()
    return query ? `/mtm/visits?${query}` : "/mtm/visits"
  }, [searchParams])

  const filtered = visits.filter((visit) => {
    if (activeFilter !== "all" && visit.status !== activeFilter) return false
    if (!search) return true
    const query = search.toLowerCase()
    return Boolean(
      visit.agent?.name?.toLowerCase().includes(query)
      || visit.customer?.name?.toLowerCase().includes(query)
      || visit.customer?.address?.toLowerCase().includes(query),
    )
  }).sort((left, right) => {
    if (sortBy === "date_asc") return new Date(left.checkInAt).getTime() - new Date(right.checkInAt).getTime()
    if (sortBy === "duration") return (right.duration || 0) - (left.duration || 0)
    return new Date(right.checkInAt).getTime() - new Date(left.checkInAt).getTime()
  })

  const statusCounts: Record<string, number> = {}
  for (const visit of visits) statusCounts[visit.status] = (statusCounts[visit.status] || 0) + 1
  const focusedVisit = focusedVisitId ? visits.find((visit) => visit.id === focusedVisitId) || null : null
  const visitsWithDuration = visits.filter((visit) => visit.duration != null)
  const averageDuration = visitsWithDuration.length > 0
    ? Math.round(visitsWithDuration.reduce((sum, visit) => sum + (visit.duration || 0), 0) / visitsWithDuration.length)
    : 0
  const confirmedGps = visits.filter((visit) => visitPlaceSummary(visit, meta.geofenceRadius).verdict === "at_point").length
  const displayedTotal = meta.totalExact && meta.total != null ? meta.total : visits.length
  const ownActiveVisits = activeVisits.filter((visit) => isOwnVisitExecution(viewer, { agentId: visit.agentId, status: "CHECKED_IN" }))
  const teamActiveVisits = activeVisits.filter((visit) => !ownActiveVisits.includes(visit))
  const focusedOwnExecution = Boolean(focusedVisitId && ownActiveVisits.some((visit) => visit.id === focusedVisitId))
  // Until the viewer is known, an agent's own ?visitId must not flash the office review.
  const focusPending = Boolean(focusedVisitId && !activeResolved && !focusedVisitUnavailable)
  const showReview = Boolean(focusedVisitId && activeResolved && !focusedOwnExecution && !focusedVisitUnavailable)
  // The three-step guide teaches how to execute a visit; office users review.
  const showGuide = viewer?.role === "AGENT"
  const subtitle = !activeResolved ? t("subtitleNeutral") : viewer?.role === "AGENT" ? t("subtitleAgent") : t("subtitle")

  function refreshAll() {
    void fetchVisits()
    void fetchActiveVisits()
    setRefreshTick((tick) => tick + 1)
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/visits/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) {
      const key = visitApiErrorKey(res.status, await res.json().catch(() => null))
      throw new Error(key ? tw(`errors.${key}` as never) : t("deleteFailed"))
    }
    void fetchVisits()
    void fetchActiveVisits()
  }

  function openEdit(visit: MtmVisitRow) {
    setEditData(visit)
    setFormOpen(true)
  }

  function requestDelete(visit: MtmVisitRow) {
    setDeleteItem(visit)
    setDeleteOpen(true)
  }

  function openVisit(visitId: string) {
    router.push(visitHref(visitId))
  }

  function statusBadge(visit: { status: string }) {
    const Icon = visit.status === "CHECKED_IN"
      ? Clock
      : visit.status === "CHECKED_OUT"
        ? CheckCircle2
        : visit.status === "CANCELLED"
          ? XCircle
          : AlertTriangle
    return (
      <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${visitStatusClasses(visit.status)}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {t(visitStatusKey(visit.status))}
      </span>
    )
  }

  /**
   * Check-in AND check-out against the customer's own geofence. The worst fact
   * wins: being elsewhere, then a check-out without a fix.
   */
  function gpsBadge(visit: MtmVisitRow) {
    const place = visitPlaceSummary(visit, meta.geofenceRadius)
    if (place.verdict === "no_gps" || place.verdict === "no_pin") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {place.verdict === "no_pin" ? t("gpsNoPin") : t("gpsUnavailable")}
        </span>
      )
    }
    const confirmed = place.verdict === "at_point"
    const label = place.verdict === "checkout_gps_missing"
      ? t("gpsCheckoutMissing")
      : place.verdict === "checkin_gps_missing"
        ? t("gpsCheckinMissing")
        : confirmed
        ? t("gpsConfirmed")
        : `${t("gpsOutside")} · ${formatDistance(t, place.distanceMeters ?? 0)}`
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${confirmed ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {confirmed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </span>
    )
  }

  function visitActions(visit: MtmVisitRow, showEditLabel: boolean) {
    if (visit.canMutate !== true) return null
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size={showEditLabel ? "sm" : "icon"}
          className="min-h-11 min-w-11"
          onClick={() => openEdit(visit)}
          aria-label={t("edit")}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {showEditLabel ? <span className="ml-2">{t("editShort")}</span> : null}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("moreActions")}>
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => requestDelete(visit)}>
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  function formattedDate(value: string | null | undefined): string {
    if (!value) return "—"
    return formatDateTime(value, locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: meta.timezone,
    }) || "—"
  }

  // Never while an own workspace is open: this early return would unmount it.
  if (loading && visits.length === 0 && activeVisits.length === 0) {
    return (
      <div className="space-y-6">
        <PageDescription icon={CheckSquare} title={t("title")} description={subtitle} />
        <div className="animate-pulse space-y-4 motion-reduce:animate-none">
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-80 rounded-2xl bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8" data-testid="mtm-visits-guided-history">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <PageDescription icon={CheckSquare} title={t("title")} description={subtitle} />
          <HelpButton slug="mtm-visits" variant="label" />
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {returnHref ? (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={returnHref}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("returnToOperationalWeek")}
              </Link>
            </Button>
          ) : null}
          <Button className="min-h-11" onClick={() => { setEditData(undefined); setFormOpen(true) }}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("add")}
          </Button>
        </div>
      </div>

      {showGuide ? (
        <MtmWorkflowGuide
          dismissId="visits-clarity-guide"
          viewerKey={viewerKey}
          dismissLabel={tCommon("hintDismiss")}
          title={t("clarityGuide.title")}
          description={t("clarityGuide.description")}
          steps={[
            { title: t("activeVisitTitle"), description: t("activeVisitHint"), icon: Clock },
            { title: t("historyTitle"), description: t("historyHint"), icon: Search },
            { title: t("add"), description: t("editShort"), icon: Pencil },
          ]}
        />
      ) : null}

      {focusedVisitUnavailable && focusedVisitId ? (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t("focusedUnavailable")}
        </div>
      ) : null}

      {focusPending ? (
        <div role="status" aria-label={t("loading")} className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" data-testid="mtm-visit-focus-pending" />
      ) : null}

      {showReview && focusedVisitId ? (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <VisitReviewPanel
            key={focusedVisitId}
            visitId={focusedVisitId}
            refreshToken={refreshTick}
            closeHref={visitHref(null)}
            onVisitLoaded={applyReviewedVisit}
          />
          <AdvisorRecordWidget entityType="mtm_visit" entityId={focusedVisitId} orgId={orgId ? String(orgId) : undefined} title={t("advisorRisk")} />
        </div>
      ) : null}

      {ownActiveVisits.length > 0 && activeVisitId ? (
        <section className="rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="active-visit-title">
          <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-950" aria-hidden="true" />
                <h2 id="active-visit-title" className="font-semibold text-foreground">{t("activeVisitTitle")}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("activeVisitHint")}</p>
            </div>
            {ownActiveVisits.length > 1 ? (
              <label className="grid gap-1 text-sm font-medium">
                <span>{t("activeVisits", { count: ownActiveVisits.length })}</span>
                <select
                  value={activeVisitId}
                  onChange={(event) => setActiveVisitId(event.target.value)}
                  className="min-h-11 min-w-64 rounded-lg border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"
                >
                  {ownActiveVisits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {visit.customer?.name || t("unknownCustomer")} — {visit.agent?.name || t("unknownAgent")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {/* key: switching visits must not carry one visit's form state into another. */}
          <VisitWorkspace
            key={activeVisitId}
            visitId={activeVisitId}
            onCompleted={refreshAll}
            canReschedule={viewer?.role === "ADMIN" || viewer?.role === "MANAGER" || viewer?.role === "SUPERVISOR"}
          />
        </section>
      ) : null}

      {teamActiveVisits.length > 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="team-active-visits-title">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-950" aria-hidden="true" />
              <h2 id="team-active-visits-title" className="font-semibold text-foreground">{t("teamActiveTitle", { count: teamActiveVisits.length })}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("teamActiveHint")}</p>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {teamActiveVisits.slice(0, TEAM_ACTIVE_PREVIEW_LIMIT).map((visit) => (
              <li key={visit.id}>
                <Link
                  href={visitHref(visit.id)}
                  aria-current={visit.id === focusedVisitId ? "true" : undefined}
                  className={`flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 sm:px-5 ${visit.id === focusedVisitId ? "bg-primary/5" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{visit.customer?.name || t("unknownCustomer")}</span>
                    <span className="block truncate text-sm text-muted-foreground">{visit.agent?.name || t("unknownAgent")} · {t("activeSince", { time: formattedDate(visit.checkInAt) })}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {teamActiveVisits.length > TEAM_ACTIVE_PREVIEW_LIMIT ? (
            <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-10"
                onClick={() => {
                  setHistoryRange("all")
                  setActiveFilter("CHECKED_IN")
                  document.getElementById("visit-history-title")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
              >
                {t("teamActiveMore", { count: teamActiveVisits.length - TEAM_ACTIVE_PREVIEW_LIMIT })}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="visit-history-title">
        <header className="space-y-4 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="visit-history-title" className="text-lg font-semibold text-foreground">{t("historyTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("historyHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:flex" role="group" aria-label={t("rangeLabel")}>
              {HISTORY_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={historyRange === range.value}
                  className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${historyRange === range.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setHistoryRange(range.value)}
                >
                  {t(range.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-4">
            <div className="bg-card p-3 sm:p-4">
              <p className="text-xs font-medium text-muted-foreground">{t("statTotal")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{displayedTotal}</p>
            </div>
            <div className="bg-card p-3 sm:p-4">
              <p className="text-xs font-medium text-muted-foreground">{t("statCheckedOut")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{statusCounts.CHECKED_OUT || 0}</p>
            </div>
            <div className="bg-card p-3 sm:p-4">
              <p className="text-xs font-medium text-muted-foreground">{t("statAvgDuration")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{averageDuration} <span className="text-sm font-medium text-muted-foreground">{t("min")}</span></p>
            </div>
            <div className="bg-card p-3 sm:p-4">
              <p className="text-xs font-medium text-muted-foreground">{t("statGpsConfirmed")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{confirmedGps}</p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[auto_minmax(18rem,1fr)_12rem] xl:items-center">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("statusFilterLabel")}>
              <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" className="min-h-10" onClick={() => setActiveFilter("all")}>
                {t("all")} ({visits.length})
              </Button>
              {(["CHECKED_IN", "CHECKED_OUT"] as const).map((status) => (
                <Button key={status} variant={activeFilter === status ? "default" : "outline"} size="sm" className="min-h-10" onClick={() => setActiveFilter(status)}>
                  {t(VISIT_FILTER_LABELS[status])} ({statusCounts[status] || 0})
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input placeholder={t("searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" />
            </div>
            <Select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="min-h-11 w-full">
              <option value="date_desc">{t("sortDateDesc")}</option>
              <option value="date_asc">{t("sortDateAsc")}</option>
              <option value="duration">{t("sortDuration")}</option>
            </Select>
          </div>

          {meta.sourceTruncated ? (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
              {t("resultBounded", { shown: visits.length, limit: meta.candidateLimit || 2_000 })}
            </p>
          ) : meta.totalExact && meta.total != null && meta.total > visits.length ? (
            <p role="status" className="text-xs text-muted-foreground">{t("resultPartial", { shown: visits.length, total: meta.total })}</p>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">{t("resultCount", { count: filtered.length })}</p>
          )}
        </header>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" role="status">{t("loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-muted p-3"><CheckSquare className="h-6 w-6 text-muted-foreground" aria-hidden="true" /></div>
            <div>
              <p className="font-semibold text-foreground">{visits.length === 0 ? t("emptyForRange") : t("noResults")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{visits.length === 0 ? t("emptyForRangeHint") : t("noResultsHint")}</p>
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-5">
            <div className="hidden overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 xl:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">{t("colCustomer")}</th>
                    <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
                    <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                    <th className="px-4 py-3 font-medium">{t("colTiming")}</th>
                    <th className="px-4 py-3 font-medium">{t("colDuration")}</th>
                    <th className="px-4 py-3 font-medium">{t("colGps")}</th>
                    <th className="w-28 px-3 py-3"><span className="sr-only">{t("actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((visit) => {
                    const isFocused = focusedVisit?.id === visit.id
                    return (
                      <tr
                        key={visit.id}
                        onClick={() => openVisit(visit.id)}
                        aria-selected={isFocused}
                        className={`cursor-pointer border-b last:border-0 hover:bg-muted/30 ${isFocused ? "bg-primary/5 outline outline-1 -outline-offset-1 outline-primary/40" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <Link href={visitHref(visit.id)} onClick={(event) => event.stopPropagation()} className="font-semibold text-foreground hover:underline">
                            {visit.customer?.name || t("unknownCustomer")}
                          </Link>
                          <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">{visit.customer?.address || t("noAddress")}</p>
                        </td>
                        <td className="px-4 py-3 text-foreground">{visit.agent?.name || t("unknownAgent")}</td>
                        <td className="px-4 py-3">{statusBadge(visit)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{formattedDate(visit.checkInAt)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{visit.checkOutAt ? t("finishedAt", { time: formattedDate(visit.checkOutAt) }) : t("notFinished")}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{visit.duration != null ? `${visit.duration} ${t("min")}` : "—"}</td>
                        <td className="px-4 py-3">{gpsBadge(visit)}</td>
                        {/* Menu items render in a portal but their clicks still bubble through React to the row. */}
                        <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>{visitActions(visit, false)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 xl:hidden" data-testid="mtm-visit-mobile-cards">
              {filtered.map((visit) => {
                const isFocused = focusedVisit?.id === visit.id
                return (
                  <article key={visit.id} className={`rounded-xl border bg-background p-4 ${isFocused ? "border-primary ring-1 ring-primary/30" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <Link href={visitHref(visit.id)} className="block" aria-current={isFocused ? "true" : undefined}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-foreground">{visit.customer?.name || t("unknownCustomer")}</h3>
                          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <span>{visit.customer?.address || t("noAddress")}</span>
                          </p>
                        </div>
                        {statusBadge(visit)}
                      </div>

                      <dl className="mt-4 grid gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800 sm:grid-cols-2">
                        <div>
                          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="h-3.5 w-3.5" aria-hidden="true" />{t("colAgent")}</dt>
                          <dd className="mt-1 text-sm font-medium text-foreground">{visit.agent?.name || t("unknownAgent")}</dd>
                        </div>
                        <div>
                          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t("colCheckIn")}</dt>
                          <dd className="mt-1 text-sm font-medium text-foreground">{formattedDate(visit.checkInAt)}</dd>
                        </div>
                        <div>
                          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Timer className="h-3.5 w-3.5" aria-hidden="true" />{t("colDuration")}</dt>
                          <dd className="mt-1 text-sm font-medium text-foreground">{visit.duration != null ? `${visit.duration} ${t("min")}` : t("notFinished")}</dd>
                        </div>
                        <div>
                          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />{t("colGps")}</dt>
                          <dd className="mt-1">{gpsBadge(visit)}</dd>
                        </div>
                      </dl>
                    </Link>

                    {visit.canMutate === true ? <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">{visitActions(visit, true)}</div> : null}
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <MtmVisitForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={refreshAll}
        initialData={editData}
        orgId={orgId ? String(orgId) : undefined}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
        title={t("delete")}
        itemName={deleteItem?.customer?.name || tf("thisVisit")}
      />
    </div>
  )
}
