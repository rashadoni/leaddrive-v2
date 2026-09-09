"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CheckSquare,
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
import { calculateDistance } from "@/lib/geo-utils"
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
  notes?: string | null
  agent?: { id: string; name: string | null } | null
  customer?: {
    id: string
    name: string | null
    address?: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
}

type ActiveVisitRow = {
  id: string
  checkInAt: string
  agent?: { id: string; name: string | null } | null
  customer?: { id: string; name: string | null; address?: string | null } | null
}

type HistoryRange = "today" | "7d" | "30d" | "all"

type VisitMeta = {
  total: number | null
  totalExact: boolean
  sourceTruncated: boolean
  candidateLimit: number | null
  timezone: string
}

type GpsEvidence = {
  state: "confirmed" | "outside" | "unavailable"
  distance: number | null
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

function operationalWeekReturnHref(value: string | null): string | null {
  return value === "/mtm" || value?.startsWith("/mtm?") ? value : null
}

function visitStatusKey(status: string): "statusInProgress" | "statusCompleted" | "statusCancelled" | "statusUnknown" {
  if (status === "CHECKED_IN") return "statusInProgress"
  if (status === "CHECKED_OUT") return "statusCompleted"
  if (status === "CANCELLED") return "statusCancelled"
  return "statusUnknown"
}

function visitStatusClasses(status: string): string {
  if (status === "CHECKED_IN") return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
  if (status === "CHECKED_OUT") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
  if (status === "CANCELLED") return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}

function gpsEvidence(visit: MtmVisitRow): GpsEvidence {
  if (
    visit.checkInLat == null
    || visit.checkInLng == null
    || visit.customer?.latitude == null
    || visit.customer?.longitude == null
  ) {
    return { state: "unavailable", distance: null }
  }

  const distance = Math.round(calculateDistance(
    visit.checkInLat,
    visit.checkInLng,
    visit.customer.latitude,
    visit.customer.longitude,
  ))
  return { state: distance <= 100 ? "confirmed" : "outside", distance }
}

function distanceLabel(distance: number): string {
  return distance < 1_000 ? `${distance} m` : `${(distance / 1_000).toFixed(1)} km`
}

export default function MtmVisitsPage() {
  const { data: session } = useSession()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const t = useTranslations("mtmVisitsPage")
  const tf = useTranslations("mtmForms")
  const [visits, setVisits] = useState<MtmVisitRow[]>([])
  const [meta, setMeta] = useState<VisitMeta>({
    total: null,
    totalExact: false,
    sourceTruncated: false,
    candidateLimit: null,
    timezone: "UTC",
  })
  const [activeVisits, setActiveVisits] = useState<ActiveVisitRow[]>([])
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [focusedVisitUnavailable, setFocusedVisitUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
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
  const visitRequestRef = useRef<{ id: number; identity: string; controller: AbortController | null }>({
    id: 0,
    identity: "",
    controller: null,
  })
  const activeVisitRequestRef = useRef<{ id: number; identity: string; controller: AbortController | null }>({
    id: 0,
    identity: "",
    controller: null,
  })
  const activeVisitIdRef = useRef<string | null>(null)
  const viewerKey = String(session?.user?.id ?? session?.user?.email ?? "")
  const tCommon = useTranslations("mtmCommon")
  const visitIdentityKey = `${String(orgId ?? "")}:${viewerKey}:${focusedVisitId ?? ""}:${historyRange}`

  useEffect(() => {
    activeVisitIdRef.current = activeVisitId
  }, [activeVisitId])

  const fetchVisits = useCallback(async () => {
    visitRequestRef.current.controller?.abort()
    const requestId = visitRequestRef.current.id + 1
    const controller = new AbortController()
    visitRequestRef.current = { id: requestId, identity: visitIdentityKey, controller }
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && visitRequestRef.current.id === requestId
      && visitRequestRef.current.identity === visitIdentityKey
      && visitRequestRef.current.controller === controller
    )

    setEditData(undefined)
    setFormOpen(false)
    setDeleteItem(null)
    setDeleteOpen(false)
    setFocusedVisitUnavailable(false)
    setLoading(true)

    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const [res, focusedResponse] = await Promise.all([
        fetch(`/api/v1/mtm/visits?limit=200&range=${historyRange}`, { headers, signal: controller.signal }),
        focusedVisitId
          ? fetch(`/api/v1/mtm/visits/${encodeURIComponent(focusedVisitId)}`, { headers, signal: controller.signal })
          : Promise.resolve(null),
      ])
      const result = await res.json().catch(() => null)
      if (!isCurrentRequest()) return
      if (!res.ok || !result?.success) {
        setFocusedVisitUnavailable(Boolean(focusedVisitId))
        toast.error(t("loadFailed"))
        return
      }

      let nextVisits: MtmVisitRow[] = result.data.visits || []
      let focusedUnavailable = false
      if (focusedResponse) {
        const focusedResult = await focusedResponse.json().catch(() => null)
        if (!isCurrentRequest()) return
        if (focusedResponse.ok && focusedResult?.success && focusedResult.data?.id === focusedVisitId) {
          const focusedVisit = focusedResult.data as MtmVisitRow
          nextVisits = nextVisits.some((visit) => visit.id === focusedVisit.id)
            ? nextVisits.map((visit) => visit.id === focusedVisit.id ? focusedVisit : visit)
            : [focusedVisit, ...nextVisits]
        } else {
          focusedUnavailable = true
          nextVisits = nextVisits.filter((visit) => visit.id !== focusedVisitId)
        }
      }

      if (!isCurrentRequest()) return
      setVisits(nextVisits)
      setMeta({
        total: typeof result.data.total === "number" ? result.data.total : null,
        totalExact: result.data.totalExact === true,
        sourceTruncated: result.data.sourceTruncated === true,
        candidateLimit: typeof result.data.candidateLimit === "number" ? result.data.candidateLimit : null,
        timezone: typeof result.data.timezone === "string" ? result.data.timezone : "UTC",
      })
      setFocusedVisitUnavailable(focusedUnavailable)
    } catch (error) {
      if (!isCurrentRequest() || (error as { name?: string })?.name === "AbortError") return
      setFocusedVisitUnavailable(Boolean(focusedVisitId))
      toast.error(t("loadFailed"))
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [focusedVisitId, historyRange, orgId, t, visitIdentityKey])

  const fetchActiveVisits = useCallback(async () => {
    activeVisitRequestRef.current.controller?.abort()
    const requestId = activeVisitRequestRef.current.id + 1
    const controller = new AbortController()
    activeVisitRequestRef.current = { id: requestId, identity: visitIdentityKey, controller }
    const previousActiveVisitId = activeVisitIdRef.current
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && activeVisitRequestRef.current.id === requestId
      && activeVisitRequestRef.current.identity === visitIdentityKey
      && activeVisitRequestRef.current.controller === controller
    )

    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const res = await fetch("/api/v1/mtm/visits/active", { headers, signal: controller.signal })
      const body = await res.json().catch(() => null)
      if (!isCurrentRequest() || !res.ok || !body?.success) return
      const next: ActiveVisitRow[] = body.data.visits ?? []
      const nextActiveVisitId = focusedVisitId && next.some((visit) => visit.id === focusedVisitId)
        ? focusedVisitId
        : previousActiveVisitId && next.some((visit) => visit.id === previousActiveVisitId)
          ? previousActiveVisitId
          : next[0]?.id ?? null
      setActiveVisits(next)
      activeVisitIdRef.current = nextActiveVisitId
      setActiveVisitId(nextActiveVisitId)
    } catch (error) {
      if (!isCurrentRequest() || (error as { name?: string })?.name === "AbortError") return
      // History remains available when the active-visit endpoint is temporarily unavailable.
    }
  }, [focusedVisitId, orgId, visitIdentityKey])

  useEffect(() => {
    void fetchVisits()
    void fetchActiveVisits()
    return () => {
      visitRequestRef.current.controller?.abort()
      activeVisitRequestRef.current.controller?.abort()
    }
  }, [fetchActiveVisits, fetchVisits])

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
  const confirmedGps = visits.filter((visit) => gpsEvidence(visit).state === "confirmed").length
  const displayedTotal = meta.totalExact && meta.total != null ? meta.total : visits.length

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/visits/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json()).error || t("deleteFailed"))
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

  function statusBadge(visit: MtmVisitRow) {
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

  function gpsBadge(visit: MtmVisitRow) {
    const evidence = gpsEvidence(visit)
    if (evidence.state === "unavailable") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {t("gpsUnavailable")}
        </span>
      )
    }
    const confirmed = evidence.state === "confirmed"
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${confirmed ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {confirmed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        {t(confirmed ? "gpsConfirmed" : "gpsOutside")} · {distanceLabel(evidence.distance || 0)}
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

  if (loading && visits.length === 0) {
    return (
      <div className="space-y-6">
        <PageDescription icon={CheckSquare} title={t("title")} description={t("subtitle")} />
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
          <PageDescription icon={CheckSquare} title={t("title")} description={t("subtitle")} />
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

      {focusedVisitUnavailable && focusedVisitId ? (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t("focusedUnavailable")}
        </div>
      ) : null}

      {activeVisits.length > 0 && activeVisitId ? (
        <section className="overflow-hidden rounded-2xl border border-blue-200 bg-card shadow-sm dark:border-blue-900" aria-labelledby="active-visit-title">
          <div className="flex flex-col gap-3 border-b border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-950" aria-hidden="true" />
                <h2 id="active-visit-title" className="font-semibold text-foreground">{t("activeVisitTitle")}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("activeVisitHint")}</p>
            </div>
            {activeVisits.length > 1 ? (
              <label className="grid gap-1 text-sm font-medium">
                <span>{t("activeVisits", { count: activeVisits.length })}</span>
                <select
                  value={activeVisitId}
                  onChange={(event) => setActiveVisitId(event.target.value)}
                  className="min-h-11 min-w-64 rounded-lg border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"
                >
                  {activeVisits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {visit.customer?.name || t("unknownCustomer")} — {visit.agent?.name || t("unknownAgent")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="p-3 sm:p-5">
            <VisitWorkspace visitId={activeVisitId} onCompleted={() => { void fetchVisits(); void fetchActiveVisits() }} />
          </div>
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
          <div className={`grid gap-4 p-3 sm:p-5 ${focusedVisit ? "2xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <div>
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
                        <tr key={visit.id} className={`border-b last:border-0 hover:bg-muted/30 ${isFocused ? "bg-primary/5 outline outline-1 -outline-offset-1 outline-primary/40" : ""}`}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground">{visit.customer?.name || t("unknownCustomer")}</p>
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
                          <td className="px-3 py-2">{visitActions(visit, false)}</td>
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

                      <dl className="mt-4 grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-2">
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

                      {visit.canMutate === true ? <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">{visitActions(visit, true)}</div> : null}
                    </article>
                  )
                })}
              </div>
            </div>

            {focusedVisit ? (
              <AdvisorRecordWidget entityType="mtm_visit" entityId={focusedVisit.id} orgId={orgId ? String(orgId) : undefined} title={t("advisorRisk")} />
            ) : null}
          </div>
        )}
      </section>

      <MtmVisitForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => { void fetchVisits(); void fetchActiveVisits() }}
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
