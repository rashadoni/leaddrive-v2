"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Circle, Clock, ListChecks, MapPin, Route as RouteIcon, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SignaturePreview } from "@/components/mtm/visit-signature-preview"
import { VisitPhotoGrid } from "@/components/mtm/visit-photo-grid"
import { formatDateTime, formatTime as formatClockTime } from "@/lib/format-date"
import { useMtmDistanceText } from "@/components/mtm/visit-place-badge"
import {
  reviewActionRows,
  visitDurationMinutes,
  visitPlaceSummary,
  visitStatusKey,
  type PlaceCheck,
} from "@/lib/mtm/visit-review"

type Translator = (key: string, values?: Record<string, string | number>) => string

export interface VisitReviewData {
  visit: {
    id: string
    agentId: string | null
    status: string
    checkInAt: string
    checkOutAt: string | null
    duration: number | null
    checkInLat: number | null
    checkInLng: number | null
    checkOutLat: number | null
    checkOutLng: number | null
    notes: string | null
    outcome: string | null
    potential: string | null
    resultNotes: string | null
    nextActionDueAt: string | null
    agent: { id: string; name: string | null } | null
    customer: {
      id: string
      name: string | null
      address: string | null
      city: string | null
      latitude: number | null
      longitude: number | null
      geofenceRadius: number | null
    }
    contact: { id: string; displayName: string | null } | null
    route: { id: string; name: string | null; date: string } | null
    routePoint: { id: string; orderIndex: number; plannedTime: string | null } | null
    requirementSnapshot: { requirements: Array<{ id: string; actionKey: string; mode: string; minCount: number }> } | null
    actionResults: Array<{ id: string; actionKey: string; status: string; evidence: Record<string, unknown> | null; completedAt: string | null }>
    photos: Array<{ id: string; url: string; thumbnailUrl: string | null; status: string; createdAt: string }>
    /** True when the primary agent is outside the reviewer's scope; agent and route are withheld then. */
    primaryAgentHidden?: boolean
    /** Every photo of the visit; `photos` carries only the first ones. */
    photoCount?: number
  }
  geofenceRadius: number
  openTasks: { count: number; items: Array<{ id: string; title: string; priority: string; dueDate: string | null }> }
  timezone: string
  viewer: { canExecute: boolean }
}

export function visitStatusClasses(status: string): string {
  if (status === "CHECKED_IN") return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
  if (status === "CHECKED_OUT") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
  if (status === "CANCELLED") return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}

/**
 * Read-only review of one visit for an office user. Everything shown comes
 * from the server: no browser draft, no execution form, no upload. The panel
 * refetches whenever `refreshToken` changes so a visit that finishes while
 * the page is open updates in place.
 */
/** What the page may reuse from a review load instead of fetching the visit again. */
export type ReviewedVisitFacts = Pick<VisitReviewData["visit"], "id" | "status" | "checkOutAt" | "duration" | "checkOutLat" | "checkOutLng">

export function VisitReviewPanel({ visitId, refreshToken, closeHref, onVisitLoaded }: {
  visitId: string
  refreshToken: number
  closeHref: string
  /** Called with the fresh status facts after every successful load, so the history row can follow without its own request. */
  onVisitLoaded?: (visit: ReviewedVisitFacts) => void
}) {
  const t = useTranslations("mtmVisitsPage") as unknown as Translator
  const tw = useTranslations("mtmVisitWorkspace") as unknown as Translator
  const locale = useLocale()
  // Place labels are shared with the visits list, route detail and GPS history.
  const tPlace = useTranslations("mtmPlaceCheck") as unknown as Translator
  const distanceText = useMtmDistanceText()
  const [data, setData] = useState<VisitReviewData | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "failed">("loading")
  const requestRef = useRef<AbortController | null>(null)
  const onVisitLoadedRef = useRef(onVisitLoaded)
  useEffect(() => { onVisitLoadedRef.current = onVisitLoaded }, [onVisitLoaded])

  const load = useCallback(async (silent: boolean) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (!silent) setState("loading")
    try {
      const response = await fetch(`/api/v1/mtm/visits/${encodeURIComponent(visitId)}/review`, { signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (response.status === 404 || response.status === 403) {
        setData(null)
        setState("unavailable")
        return
      }
      if (!response.ok || !body?.success) {
        // A failed background refresh keeps the last good review on screen.
        if (!silent) setState("failed")
        return
      }
      const next = body.data as VisitReviewData
      setData(next)
      setState("ready")
      const { id, status, checkOutAt, duration, checkOutLat, checkOutLng } = next.visit
      onVisitLoadedRef.current?.({ id, status, checkOutAt, duration, checkOutLat, checkOutLng })
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return
      if (!silent) setState("failed")
    }
  }, [visitId])

  const loadedVisitRef = useRef<string | null>(null)
  useEffect(() => {
    const silent = loadedVisitRef.current === visitId
    loadedVisitRef.current = visitId
    void load(silent)
  }, [load, refreshToken, visitId])
  useEffect(() => () => requestRef.current?.abort(), [])

  const shell = (children: ReactNode) => (
    <section
      className="rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800"
      aria-labelledby="visit-review-title"
      data-testid="mtm-visit-review"
    >
      {children}
    </section>
  )

  if (state === "loading" && !data) {
    return shell(
      <div className="space-y-3 p-4 sm:p-5" role="status" aria-label={t("loading")}>
        <h2 id="visit-review-title" className="sr-only">{t("review.title")}</h2>
        <div className="h-6 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>,
    )
  }
  if (state === "unavailable" || state === "failed" || !data) {
    return shell(
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 id="visit-review-title" className="font-semibold text-foreground">{t("review.title")}</h2>
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {state === "unavailable" ? t("focusedUnavailable") : t("review.loadFailed")}
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11">
          <Link href={closeHref} scroll={false} aria-label={t("review.close")}><X className="h-5 w-5" aria-hidden="true" /></Link>
        </Button>
      </div>,
    )
  }

  const { visit } = data
  const formatTime = (value: string | null | undefined) => value
    ? formatClockTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: data.timezone }) || "—"
    : "—"
  const formatFull = (value: string | null | undefined) => value
    ? formatDateTime(value, locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: data.timezone }) || "—"
    : "—"
  const place = visitPlaceSummary({ ...visit, customer: { ...visit.customer, geofenceRadius: data.geofenceRadius } })
  const duration = visitDurationMinutes(visit)
  const photoCount = Math.max(visit.photoCount ?? 0, visit.photos.length)
  const actionRows = reviewActionRows({
    requirements: visit.requirementSnapshot?.requirements ?? [],
    actionResults: visit.actionResults,
    photoCount,
    agentNote: visit.notes,
    resultNote: visit.resultNotes,
  })
  const signature = visit.actionResults.filter((item) => item.actionKey === "SIGNATURE" && item.status === "COMPLETED").at(-1) ?? null
  const signerName = typeof signature?.evidence?.signerName === "string" && signature.evidence.signerName.trim() ? signature.evidence.signerName.trim() : null
  const signedAt = typeof signature?.evidence?.signedAt === "string" ? signature.evidence.signedAt : signature?.completedAt ?? null
  const locationLine = [visit.customer.address, visit.customer.city].filter((part) => part && part.trim()).join(", ")
  const hasResult = Boolean(visit.outcome || visit.resultNotes || visit.nextActionDueAt)

  const placeRow = (label: string, check: PlaceCheck | null, kind: "checkIn" | "checkOut") => {
    let tone = "text-muted-foreground"
    let Icon = MapPin
    let text: string
    if (!check) {
      // Only a check-out can be skipped: still open, or ended without one (cancelled).
      text = place.checkOutSkipped === "visit_open" ? t("review.placeNotFinished") : t("review.placeNoCheckout")
    } else if (check.state === "at_point") {
      tone = "text-emerald-700 dark:text-emerald-300"
      Icon = CheckCircle2
      text = tPlace("atPoint")
    } else if (check.state === "outside") {
      tone = "text-amber-700 dark:text-amber-300"
      Icon = AlertTriangle
      text = tPlace("outside", { distance: distanceText(check.distanceMeters ?? 0) })
    } else if (check.state === "no_gps") {
      tone = "text-amber-700 dark:text-amber-300"
      Icon = AlertTriangle
      text = kind === "checkOut" ? tPlace("checkoutGpsMissing") : tPlace("noGps")
    } else {
      text = tPlace("noPin")
    }
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-right">
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{text}
          </span>
          {check?.distanceMeters != null ? (
            <span className="block text-xs text-muted-foreground">
              {tPlace("distanceDetail", { distance: distanceText(check.distanceMeters), radius: distanceText(check.radiusMeters) })}
            </span>
          ) : null}
        </dd>
      </div>
    )
  }

  const blockTitle = (text: string) => <h3 className="text-sm font-semibold text-foreground">{text}</h3>

  return shell(
    <>
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
        <div className="min-w-0">
          <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${visitStatusClasses(visit.status)}`}>
            {t(visitStatusKey(visit.status))}
          </span>
          <h2 id="visit-review-title" className="mt-2 text-xl font-semibold text-foreground">{visit.customer.name || t("unknownCustomer")}</h2>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{locationLine || t("noAddress")}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{visit.agent?.name || t("unknownAgent")}</span>
            {visit.contact?.displayName ? <span className="text-muted-foreground">· {t("review.contact", { name: visit.contact.displayName })}</span> : null}
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0">
          <Link href={closeHref} scroll={false} aria-label={t("review.close")}><X className="h-5 w-5" aria-hidden="true" /></Link>
        </Button>
      </header>

      <div className="divide-y divide-zinc-200 px-4 dark:divide-zinc-800 sm:px-5">
        <div className="grid gap-4 py-4 md:grid-cols-2">
          <div>
            {blockTitle(t("review.planTitle"))}
            {visit.route ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground">
                <RouteIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  {visit.route.name || t("review.routeUnnamed")}
                  {visit.routePoint ? ` · ${t("review.routePoint", { number: visit.routePoint.orderIndex + 1 })}` : ""}
                  {visit.routePoint?.plannedTime ? <span className="block text-muted-foreground">{t("review.plannedAt", { time: formatTime(visit.routePoint.plannedTime) })}</span> : null}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{visit.primaryAgentHidden ? t("review.routeHidden") : t("review.unplanned")}</p>
            )}
          </div>
          <div>
            {blockTitle(t("review.actualTitle"))}
            <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="tabular-nums">
                {formatFull(visit.checkInAt)} → {visit.checkOutAt ? formatTime(visit.checkOutAt) : t("notFinished")}
                {duration != null ? <span className="block text-muted-foreground">{t("review.duration", { minutes: duration })}</span> : null}
              </span>
            </p>
          </div>
        </div>

        <div className="py-4">
          {blockTitle(t("review.placeTitle"))}
          <dl className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {placeRow(t("review.placeCheckIn"), place.checkIn, "checkIn")}
            {placeRow(t("review.placeCheckOut"), place.checkOut, "checkOut")}
          </dl>
        </div>

        <div className="py-4">
          <div className="flex items-baseline justify-between gap-3">
            {blockTitle(t("review.photosTitle"))}
            <span className="text-xs text-muted-foreground">{t("review.photosCount", { count: photoCount })}</span>
          </div>
          <div className="mt-3">
            {visit.photos.length ? (
              <>
                <VisitPhotoGrid
                  photos={visit.photos}
                  formatTime={(value) => formatTime(value)}
                  openLabel={(index) => t("review.openPhoto", { index })}
                  titleLabel={(index) => t("review.photoTitle", { index, total: photoCount })}
                />
                {photoCount > visit.photos.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t("review.morePhotos", { count: photoCount - visit.photos.length })}</p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("review.noPhotos")}</p>
            )}
          </div>
        </div>

        {signature ? (
          <div className="py-4">
            {blockTitle(tw("actions.SIGNATURE"))}
            <SignaturePreview evidence={signature.evidence} label={tw("actions.SIGNATURE")} />
            <p className="mt-2 text-xs text-muted-foreground">
              {[signerName ? t("review.signedBy", { name: signerName }) : null, signedAt ? t("review.signedAt", { time: formatTime(signedAt) }) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 py-4 md:grid-cols-2">
          <div>
            {blockTitle(t("review.noteTitle"))}
            {visit.notes?.trim()
              ? <p className="mt-2 whitespace-pre-line text-sm text-foreground">{visit.notes}</p>
              : <p className="mt-2 text-sm text-muted-foreground">{t("review.noNote")}</p>}
          </div>
          <div>
            {blockTitle(t("review.resultTitle"))}
            {hasResult ? (
              <dl className="mt-2 space-y-1 text-sm">
                {visit.outcome ? <div className="flex gap-2"><dt className="text-muted-foreground">{tw("outcome")}:</dt><dd className="font-medium text-foreground">{tw(`outcomes.${visit.outcome}`)}</dd></div> : null}
                {visit.potential && visit.potential !== "UNKNOWN" ? <div className="flex gap-2"><dt className="text-muted-foreground">{tw("potential")}:</dt><dd className="font-medium text-foreground">{tw(`potentials.${visit.potential}`)}</dd></div> : null}
                {visit.resultNotes ? <div><dt className="sr-only">{t("review.resultNote")}</dt><dd className="whitespace-pre-line text-foreground">{visit.resultNotes}</dd></div> : null}
                {visit.nextActionDueAt ? <div className="text-muted-foreground">{t("review.nextActionDue", { date: formatFull(visit.nextActionDueAt) })}</div> : null}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("review.noResult")}</p>
            )}
          </div>
        </div>

        <div className="py-4">
          {blockTitle(t("review.actionsTitle"))}
          {actionRows.length ? (
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60" data-testid="mtm-visit-review-actions">
              {actionRows.map((row) => (
                <li key={row.actionKey} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    {row.done
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      : <Circle className={`h-4 w-4 ${row.required ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} aria-hidden="true" />}
                    {tw(`actions.${row.actionKey}`)}
                    <span className="text-xs text-muted-foreground">{row.required ? t("review.actionRequired") : t("review.actionOptional")}</span>
                  </span>
                  <span className={`text-xs font-medium ${row.done ? "text-emerald-700 dark:text-emerald-300" : row.required ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                    {row.done ? t("review.actionDone") : t("review.actionNotDone")}
                    {row.minCount > 1 || row.count > 1 ? ` · ${row.count}/${row.minCount}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("review.noActions")}</p>
          )}
        </div>

        <div className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("review.openTasks", { count: data.openTasks.count })}
            </h3>
            {data.openTasks.count > 0 ? (
              <Link href="/mtm/tasks" className="text-sm font-medium text-primary hover:underline">{t("review.openTasksLink")}</Link>
            ) : null}
          </div>
          {data.openTasks.items.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {data.openTasks.items.map((task) => (
                <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 truncate text-foreground">{task.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {tw(`priorities.${task.priority}`)}
                    {task.dueDate ? ` · ${t("review.taskDue", { date: formatFull(task.dueDate) })}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </>,
  )
}
