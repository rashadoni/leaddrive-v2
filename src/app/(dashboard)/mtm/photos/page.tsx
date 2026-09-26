"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { formatDateTime } from "@/lib/format-date"
import { mtmPhotoPeriodStart, type MtmPhotoPeriod } from "@/lib/mtm/photo-period"
import { nextWiderPeriod } from "@/lib/mtm/empty-period-fallback"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { mtmPhotoThumbnailUrl, type MtmPhotoThumbnailWidth } from "@/lib/mtm/photo-thumbnail-url"
import { PhotoThumbnailImg } from "@/components/mtm/photo-thumbnail-img"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Dialog, DialogTitle } from "@/components/ui/dialog"
import { Camera, Check, X, Trash2, Clock, CheckCircle2, XCircle, LayoutGrid, Columns, CheckSquare, ImageOff, ExternalLink } from "lucide-react"

const statusColors: Record<string, string> = { PENDING: "bg-amber-100 text-amber-700", APPROVED: "bg-green-100 text-green-700", REJECTED: "bg-red-100 text-red-600" }

type MtmPhotoRow = {
  id: string
  url?: string | null
  status: "PENDING" | "APPROVED" | "REJECTED" | string
  category?: string | null
  createdAt: string
  likes?: number | null
  dislikes?: number | null
  agent?: { id: string; name: string | null } | null
  visit?: { id: string; customer?: { name: string | null } | null } | null
}

type PhotoPeriod = MtmPhotoPeriod
/** Narrowest to widest, exactly as the select offers them. */
const PHOTO_PERIOD_ORDER: readonly PhotoPeriod[] = ["today", "week", "all"]

/** The control's own wording, so the notice names periods exactly as the options do. */
function periodLabelKey(period: PhotoPeriod): string {
  return period === "today" ? "periodToday" : period === "week" ? "periodWeek" : "periodAll"
}

/**
 * A tile whose file is gone says so, instead of a browser's broken-image icon.
 * Prod audit 2026-09-14: 196 of the 200 newest tiles were seeded rows whose
 * files return 404, and the manager saw a wall of broken pictures.
 */
function PhotoImage({ photo, className, missingLabel, onMissing, missing, thumbnailWidth = 480 }: {
  photo: MtmPhotoRow
  /** Tiles load a server-resized copy; only the lightbox loads the original. */
  thumbnailWidth?: MtmPhotoThumbnailWidth
  className: string
  missingLabel: string
  onMissing: (id: string) => void
  missing: boolean
}) {
  if (!photo.url || missing) {
    return (
      <span data-testid="mtm-photo-missing" className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
        {photo.url ? <ImageOff className="h-7 w-7" aria-hidden="true" /> : <Camera className="h-7 w-7" aria-hidden="true" />}
        {photo.url ? <span className="px-2 text-center text-[11px]">{missingLabel}</span> : null}
      </span>
    )
  }
  // A transient 503/429 from the thumbnail proxy is retried once inside
  // PhotoThumbnailImg; only a repeated failure marks the file missing.
  return <PhotoThumbnailImg src={mtmPhotoThumbnailUrl(photo.url, thumbnailWidth)} alt="" width={thumbnailWidth} height={thumbnailWidth} loading="lazy" decoding="async" className={className} onFinalError={() => onMissing(photo.id)} />
}

const PHOTO_FILTER_LABELS = {
  PENDING: "filterPending",
  APPROVED: "filterApproved",
  REJECTED: "filterRejected",
} as const

export default function MtmPhotosPage() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const t = useTranslations("mtmPhotosPage")
  const tf = useTranslations("mtmForms")
  // A5: статус — идентификатор, а не текст для человека. Раньше страница
  // печатала PENDING и «Photo approved» по-английски в любом интерфейсе.
  const ts = useTranslations("mtmStatus")
  const locale = useLocale()
  const [photos, setPhotos] = useState<MtmPhotoRow[]>([])
  const [total, setTotal] = useState(0)
  // Land on this week's photos: the newest rows of a tenant can be seeded
  // placeholders, and "all" is one click away.
  const [period, setPeriod] = useState<PhotoPeriod>("week")
  // Audit 2026-09-21: the page opened on «Эта неделя» with four zeros while
  // 1367 photos were stored, and asked the manager to widen it themselves.
  const [periodChosenByUser, setPeriodChosenByUser] = useState(false)
  const [widenedFrom, setWidenedFrom] = useState<PhotoPeriod | null>(null)
  const [agentFilter, setAgentFilter] = useState("")
  const [knownAgents, setKnownAgents] = useState<Map<string, string>>(() => new Map())
  // Same source of "today" as every other MTM screen: the organization's
  // timezone from MTM settings, not the browser clock (review of #205).
  const [timezone, setTimezone] = useState("Asia/Baku")
  const [missingFiles, setMissingFiles] = useState<Set<string>>(() => new Set())
  const [lightboxPhoto, setLightboxPhoto] = useState<MtmPhotoRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmPhotoRow | null>(null)
  const [activeFilter, setActiveFilter] = useState("all")
  // Audit 2026-09-26: the counters added up the newest 200 photos, not the
  // period — «all» read 200 while 1367 were stored. The server counts now.
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [countsKey, setCountsKey] = useState("")
  const photoRequestRef = useRef(0)
  const [sortBy, setSortBy] = useState("date_desc")
  const [viewMode, setViewMode] = useState<"gallery" | "compare" | "batch">("gallery")
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set())
  const [compareLeft, setCompareLeft] = useState<MtmPhotoRow | null>(null)
  const [compareRight, setCompareRight] = useState<MtmPhotoRow | null>(null)
  const orgId = session?.user?.organizationId
  const focusedPhotoId = searchParams.get("photoId")

  const queryKey = `${period}|${agentFilter}|${activeFilter}|${timezone}`
  const fetchPhotos = useCallback(async () => {
    const requestId = ++photoRequestRef.current
    const key = `${period}|${agentFilter}|${activeFilter}|${timezone}`
    try {
      // Employee, period and status are filtered on the server, so each of
      // them reaches past the newest 200 rows instead of filtering inside them.
      const params = new URLSearchParams({ limit: "200" })
      if (agentFilter) params.set("agentId", agentFilter)
      if (activeFilter !== "all") params.set("status", activeFilter)
      if (period !== "all") params.set("since", new Date(mtmPhotoPeriodStart(period, new Date(), timezone)).toISOString())
      const res = await fetch(`/api/v1/mtm/photos?${params.toString()}`, { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      const r = await res.json()
      if (requestId !== photoRequestRef.current) return
      if (!res.ok || !r.success) {
        toast.error(`Failed to load photos: ${r.error || "Unknown error"}`)
      } else {
        const rows: MtmPhotoRow[] = r.data.photos || []
        setPhotos(rows)
        setTotal(Number.isFinite(Number(r.data.total)) ? Number(r.data.total) : rows.length)
        setStatusCounts(r.data.byStatus && typeof r.data.byStatus === "object" ? r.data.byStatus : {})
        setCountsKey(key)
        // Photo authors not in the roster (left the team) stay choosable.
        setKnownAgents((current) => {
          const next = new Map(current)
          for (const row of rows) if (row.agent?.id && !next.has(row.agent.id)) next.set(row.agent.id, row.agent.name || "—")
          return next.size === current.size ? current : next
        })
      }
    } catch (e) {
      toast.error(`Failed to load photos: ${e instanceof Error ? e.message : "Network error"}`)
    } finally {
      if (requestId === photoRequestRef.current) setLoading(false)
    }
  }, [activeFilter, agentFilter, orgId, period, timezone])

  useEffect(() => { fetchPhotos() }, [fetchPhotos])

  useEffect(() => {
    const controller = new AbortController()
    const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
    fetch("/api/v1/mtm/settings", { headers, signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!controller.signal.aborted && typeof result?.data?.timezone === "string") setTimezone(result.data.timezone)
      })
      .catch(() => undefined)
    // The employee list comes from the roster, not from whoever happens to be
    // in the newest 200 photos.
    fetch("/api/v1/mtm/agents?limit=200", { headers, signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (controller.signal.aborted || !Array.isArray(result?.data?.agents)) return
        setKnownAgents((current) => {
          const next = new Map(current)
          for (const agent of result.data.agents as Array<{ id?: string; name?: string | null }>) {
            if (agent.id) next.set(agent.id, agent.name || "—")
          }
          return next
        })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [orgId])

  const markMissing = useCallback((id: string) => {
    setMissingFiles((current) => current.has(id) ? current : new Set(current).add(id))
  }, [])

  // Every photo of the period and employee, whatever its status.
  const periodTotal = Object.values(statusCounts).reduce((sum, count) => sum + count, 0)
  const countsCurrent = countsKey === queryKey

  /**
   * The nearest period with photos, once, and said aloud. Measured on the
   * period alone — the agent and status filters are the reader's own choices
   * and an empty result under them is an answer, not a wrong default.
   */
  useEffect(() => {
    const wider = nextWiderPeriod({
      order: PHOTO_PERIOD_ORDER,
      current: period,
      rows: periodTotal,
      userChose: periodChosenByUser,
      alreadyWidened: widenedFrom !== null,
      // Counts of an earlier query are not this period's: wait for its own.
      loading: loading || !countsCurrent,
    })
    if (!wider) return
    setWidenedFrom(period)
    setPeriod(wider)
  }, [period, periodTotal, periodChosenByUser, widenedFrom, loading, countsCurrent])

  const filtered = [...photos].sort((a, b) => {
    switch (sortBy) {
      case "date_desc": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case "status": return (a.status || "").localeCompare(b.status || "")
      default: return 0
    }
  })

  const loadedIsPartial = total > photos.length
  const focusedPhoto = focusedPhotoId ? photos.find((photo) => photo.id === focusedPhotoId) || null : null

  const updatePhotoStatus = async (photoId: string, status: string) => {
    try {
      const res = await fetch(`/api/v1/mtm/photos/${photoId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) }, body: JSON.stringify({ status }) })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(t("statusUpdateFailed", { reason: body?.error || res.statusText }))
        return
      }
      toast.success(t("statusUpdated", { status: mtmStatusLabel(ts, "photo", status) }))
      fetchPhotos()
    } catch (e) {
      toast.error(t("statusUpdateFailed", { reason: e instanceof Error ? e.message : t("networkError") }))
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/photos/${deleteItem.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
    if (!res.ok) throw new Error((await res.json()).error || "Failed to delete")
    fetchPhotos()
  }

  if (loading) return (
    <div className="space-y-6">
      <PageDescription icon={Camera} title={t("title")} />
      <div className="animate-pulse space-y-4"><div className="grid gap-3 grid-cols-2 sm:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="aspect-square bg-muted rounded-lg" />)}</div></div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PageDescription icon={Camera} title={t("title")} />
          <HelpButton slug="mtm-photos" variant="label" />
        </div>
        <div className="flex gap-2">
          {/* Audit 2026-09-26: three bare icons nobody could read, and an
              «Export» button with no handler at all. */}
          <div data-testid="mtm-photos-modes" className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700" role="group" aria-label={t("viewModes")}>
            <Button aria-pressed={viewMode === "gallery"} variant={viewMode === "gallery" ? "default" : "ghost"} size="sm" className="min-h-10 rounded-none" onClick={() => setViewMode("gallery")}><LayoutGrid className="mr-1.5 h-4 w-4" />{t("modeGallery")}</Button>
            <Button aria-pressed={viewMode === "compare"} variant={viewMode === "compare" ? "default" : "ghost"} size="sm" className="min-h-10 rounded-none" onClick={() => setViewMode("compare")}><Columns className="mr-1.5 h-4 w-4" />{t("modeCompare")}</Button>
            <Button aria-pressed={viewMode === "batch"} variant={viewMode === "batch" ? "default" : "ghost"} size="sm" className="min-h-10 rounded-none" onClick={() => { setViewMode("batch"); setSelectedPhotos(new Set()) }}><CheckSquare className="mr-1.5 h-4 w-4" />{t("modeBatch")}</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        {/* The four cards describe the same set — the chosen period — so they add up. */}
        <ColorStatCard label={t("statTotal")} value={periodTotal} icon={<Camera className="h-4 w-4" />} hint={t("hintTotal")} />
        <ColorStatCard label={t("statPending")} value={statusCounts["PENDING"] || 0} icon={<Clock className="h-4 w-4" />} hint={t("hintPending")} />
        <ColorStatCard label={t("statApproved")} value={statusCounts["APPROVED"] || 0} icon={<CheckCircle2 className="h-4 w-4" />} hint={t("hintApproved")} />
        <ColorStatCard label={t("statRejected")} value={statusCounts["REJECTED"] || 0} icon={<XCircle className="h-4 w-4" />} hint={t("hintRejected")} />
      </div>

      {widenedFrom ? (
        <p role="status" data-testid="mtm-photos-widened" className="text-sm text-muted-foreground">
          {t("widenedNotice", { from: t(periodLabelKey(widenedFrom)), to: t(periodLabelKey(period)) })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-medium">
          {t("periodLabel")}
          <Select data-testid="mtm-photos-period" value={period} onChange={(event) => {
            setPeriodChosenByUser(true)
            setWidenedFrom(null)
            setPeriod(event.target.value as PhotoPeriod)
          }} className="min-h-10 w-[180px]">
            <option value="today">{t("periodToday")}</option>
            <option value="week">{t("periodWeek")}</option>
            <option value="all">{t("periodAll")}</option>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("agentFilter")}
          <Select data-testid="mtm-photos-agent" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="min-h-10 w-[220px]">
            <option value="">{t("allAgents")}</option>
            {[...knownAgents.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
        {loadedIsPartial ? (
          <span data-testid="mtm-photos-partial" className="pb-2 text-xs text-muted-foreground">{t("latestOfTotal", { shown: photos.length, total })}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{t("all")} ({periodTotal})</Button>
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
          <Button key={s} variant={activeFilter === s ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(s)}>
            {t(PHOTO_FILTER_LABELS[s])} ({statusCounts[s] || 0})
          </Button>
        ))}
      </div>

      <div className="flex justify-end">
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[160px]">
          <option value="date_desc">{t("sortDateDesc")}</option>
          <option value="status">{t("sortStatus")}</option>
        </Select>
      </div>

      {/* Batch action bar */}
      {viewMode === "batch" && selectedPhotos.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-primary/5">
          <span className="text-xs font-medium">{t("batchSelected", { n: selectedPhotos.size })}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs text-green-600" onClick={() => { selectedPhotos.forEach(id => { if (!missingFiles.has(id)) updatePhotoStatus(id, "APPROVED") }); setSelectedPhotos(new Set()) }}>
            <Check className="h-3 w-3 mr-1" /> {t("batchApproveAll")}
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-xs text-red-600" onClick={() => { selectedPhotos.forEach(id => updatePhotoStatus(id, "REJECTED")); setSelectedPhotos(new Set()) }}>
            <X className="h-3 w-3 mr-1" /> {t("batchRejectAll")}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" onClick={() => setSelectedPhotos(new Set())}>{t("batchClear")}</Button>
        </div>
      )}

      {/* Compare view */}
      {viewMode === "compare" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
          {[{ photo: compareLeft, label: t("compareLeft") }, { photo: compareRight, label: t("compareRight") }].map(({ photo, label }) => (
            <div key={label}>
              <div className="text-xs font-medium text-muted-foreground mb-2">{label} — {photo ? `${photo.agent?.name} (${mtmStatusLabel(ts, "photo", photo.status)})` : t("comparePickHint")}</div>
              <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                {photo ? <PhotoImage photo={photo} className="w-full h-full object-cover" missingLabel={t("fileMissing")} onMissing={markMissing} missing={missingFiles.has(photo.id)} thumbnailWidth={960} /> : <Camera className="h-12 w-12 text-muted-foreground/30" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="h-48 flex items-center justify-center px-4 text-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{period !== "all" && periodTotal === 0 ? t("periodEmpty") : activeFilter !== "all" && periodTotal > 0 ? t("noResults") : t("empty")}</div>
      ) : (
        <div className={`grid gap-4 ${focusedPhoto ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((photo) => {
              const isFocused = focusedPhoto?.id === photo.id
              return (
                <div key={photo.id} className={`rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden cursor-pointer transition-all ${selectedPhotos.has(photo.id) ? "ring-2 ring-primary" : ""} ${isFocused ? "outline outline-1 outline-primary/50" : ""}`}
                  onClick={() => {
                    if (viewMode === "batch") {
                      setSelectedPhotos(prev => {
                        const next = new Set(prev)
                        if (next.has(photo.id)) next.delete(photo.id)
                        else next.add(photo.id)
                        return next
                      })
                    } else if (viewMode === "compare") {
                      if (!compareLeft) setCompareLeft(photo)
                      else if (!compareRight) setCompareRight(photo)
                      else { setCompareLeft(compareRight); setCompareRight(photo) }
                    }
                  }}>
                  <div className="aspect-square bg-muted flex items-center justify-center relative">
                    {viewMode === "gallery" && photo.url && !missingFiles.has(photo.id) ? (
                      <button
                        type="button"
                        className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-label={t("openPhoto", { name: photo.visit?.customer?.name || photo.agent?.name || "—" })}
                        onClick={() => setLightboxPhoto(photo)}
                      >
                        <PhotoImage photo={photo} className="w-full h-full object-cover" missingLabel={t("fileMissing")} onMissing={markMissing} missing={false} />
                      </button>
                    ) : (
                      <PhotoImage photo={photo} className="w-full h-full object-cover" missingLabel={t("fileMissing")} onMissing={markMissing} missing={missingFiles.has(photo.id)} />
                    )}
                    {viewMode === "batch" && (
                      <div className={`absolute top-1.5 left-1.5 w-4 h-4 rounded border-2 flex items-center justify-center ${selectedPhotos.has(photo.id) ? "bg-primary border-primary text-white" : "border-white/70 bg-black/20"}`}>
                        {selectedPhotos.has(photo.id) && <Check className="h-2.5 w-2.5" />}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium truncate">{photo.agent?.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{photo.visit?.customer?.name || "—"}</div>
                    <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                      <time dateTime={photo.createdAt} className="truncate tabular-nums">{t("capturedAt", { time: formatDateTime(photo.createdAt, locale, { dateStyle: "short", timeStyle: "short" }) })}</time>
                      {photo.visit?.id ? (
                        <Link
                          href={`/mtm/visits?visitId=${encodeURIComponent(photo.visit.id)}`}
                          className="shrink-0 text-primary hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {t("openVisit")}
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[photo.status] || ""}`}>{mtmStatusLabel(ts, "photo", photo.status)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title={t("deletePhoto")} aria-label={t("deletePhoto")} onClick={(event) => { event.stopPropagation(); setDeleteItem(photo); setDeleteOpen(true) }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {photo.status === "PENDING" && (!photo.url || missingFiles.has(photo.id)) ? (
                      // Audit 2026-09-26: «Approve» under «File not found» —
                      // approving a photo nobody can see is not a review.
                      <p data-testid="mtm-photo-review-unavailable" className="mt-2 text-[11px] text-muted-foreground">{t("reviewUnavailable")}</p>
                    ) : photo.status === "PENDING" ? (
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        <Button size="sm" variant="outline" className="h-7 min-w-0 px-1.5 text-xs text-green-600 hover:bg-green-50" onClick={(event) => { event.stopPropagation(); void updatePhotoStatus(photo.id, "APPROVED") }}><Check className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{t("approve")}</span></Button>
                        <Button size="sm" variant="outline" className="h-7 min-w-0 px-1.5 text-xs text-red-600 hover:bg-red-50" onClick={(event) => { event.stopPropagation(); void updatePhotoStatus(photo.id, "REJECTED") }}><X className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{t("reject")}</span></Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          {focusedPhoto ? (
            <AdvisorRecordWidget entityType="mtm_photo" entityId={focusedPhoto.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />
          ) : null}
        </div>
      )}

      <Dialog open={lightboxPhoto !== null} onOpenChange={(open) => { if (!open) setLightboxPhoto(null) }} widthClassName="max-w-4xl" maxHeightClassName="max-h-[calc(100dvh-2rem)]">
        {lightboxPhoto ? (
          <div data-testid="mtm-photo-lightbox" className="space-y-3 p-4">
            <DialogTitle className="text-sm font-semibold">
              {t("lightboxTitle")} · {lightboxPhoto.agent?.name || "—"}{lightboxPhoto.visit?.customer?.name ? ` · ${lightboxPhoto.visit.customer.name}` : ""}
            </DialogTitle>
            <div className="flex min-h-64 items-center justify-center rounded-lg bg-muted">
              {lightboxPhoto.url && !missingFiles.has(lightboxPhoto.id) ? (
                <img src={lightboxPhoto.url} alt="" className="max-h-[70dvh] w-auto max-w-full object-contain" onError={() => markMissing(lightboxPhoto.id)} />
              ) : (
                <PhotoImage photo={lightboxPhoto} className="" missingLabel={t("fileMissing")} onMissing={markMissing} missing />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <time dateTime={lightboxPhoto.createdAt}>{formatDateTime(lightboxPhoto.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</time>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusColors[lightboxPhoto.status] || ""}`}>{mtmStatusLabel(ts, "photo", lightboxPhoto.status)}</span>
              {lightboxPhoto.visit?.id ? (
                <Link href={`/mtm/visits?visitId=${encodeURIComponent(lightboxPhoto.visit.id)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />{t("openVisit")}
                </Link>
              ) : null}
              <Button size="sm" variant="outline" className="ml-auto min-h-10" onClick={() => setLightboxPhoto(null)}>{t("closeLightbox")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem?.agent?.name || tf("thisPhoto")} />
    </div>
  )
}
