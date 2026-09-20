"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Circle, Clock, FileText, ListChecks, MapPin, UserRound, X } from "lucide-react"
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
    checkInCustomerLat?: number | null
    checkInCustomerLng?: number | null
    checkInGeofenceRadius?: number | null
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
    routePoint: { id: string; orderIndex: number } | null
    requirementSnapshot: { requirements: Array<{ id: string; actionKey: string; mode: string; minCount: number }> } | null
    actionResults: Array<{ id: string; actionKey: string; status: string; evidence: Record<string, unknown> | null; completedAt: string | null }>
    presentationSessions: Array<{
      id: string
      openedAt: string
      lastViewedAt: string
      closedAt: string | null
      activeDurationSeconds: number
      openLat: number | null
      openLng: number | null
      closeLat: number | null
      closeLng: number | null
      pageCount: number | null
      lastPage: number | null
      pagesViewed: number[] | null
      pageEvents: Array<{ page: number; viewedAt: string }> | null
      presentationVersion: string | null
      product: { id: string; name: string; group: { id: string; name: string } }
      document: { id: string; title: string | null; fileName: string; mimeType: string } | null
    }>
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
  /**
   * "787 мин" is a number a reviewer has to convert before it means anything;
   * "13 ч 7 мин" is the thing they were looking for — a visit that stayed open
   * all day.
   */
  const durationText = duration == null
    ? null
    : duration >= 60
      ? t("review.durationHm", { hours: Math.floor(duration / 60), minutes: duration % 60 })
      : t("review.duration", { minutes: duration })

  const mapHref = (latitude?: number | null, longitude?: number | null) => (
    latitude != null && longitude != null ? `https://www.google.com/maps?q=${latitude},${longitude}` : null
  )

  const placeTone = (check: PlaceCheck | null) => {
    if (!check) return "text-muted-foreground"
    if (check.state === "at_point") return "text-emerald-700 dark:text-emerald-300"
    if (check.state === "outside" || check.state === "no_gps") return "text-amber-700 dark:text-amber-300"
    return "text-muted-foreground"
  }

  // One line of facts instead of four blocks of one line each.
  const facts: Array<{ key: string; icon: ReactNode; text: string; tone?: string; href?: string | null }> = []
  facts.push({
    key: "time",
    icon: <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
    text: `${formatTime(visit.checkInAt)} → ${visit.checkOutAt ? formatTime(visit.checkOutAt) : t("notFinished")}${durationText ? ` · ${durationText}` : ""}`,
  })
  facts.push({
    key: "place",
    icon: <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
    text: place.checkIn?.state === "at_point"
      ? tPlace("atPoint")
      : place.checkIn?.state === "outside"
        ? tPlace("outside", { distance: distanceText(place.checkIn.distanceMeters ?? 0) })
        : place.checkIn?.state === "no_gps"
          ? tPlace("noGps")
          : tPlace("noPin"),
    tone: placeTone(place.checkIn),
    href: mapHref(visit.checkInLat, visit.checkInLng),
  })
  facts.push({
    key: "presentations",
    icon: <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
    text: t("review.presentationsCount", { count: visit.presentationSessions.length }),
  })
  facts.push({
    key: "photos",
    icon: <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
    text: t("review.photosCount", { count: photoCount }),
  })
  facts.push({
    key: "signature",
    icon: signature
      ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
    text: signature ? t("review.factSignature") : t("review.factNoSignature"),
  })

  // What the visit does not have is one quiet line at the end, not three
  // half-empty blocks in the middle.
  const missing: string[] = []
  if (!photoCount) missing.push(t("review.photosTitle"))
  if (!visit.notes?.trim()) missing.push(t("review.noteTitle"))
  if (!hasResult) missing.push(t("review.resultTitle"))
  if (!visit.presentationSessions.length) missing.push(t("review.presentationsTitle"))

  return shell(
    <>
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${visitStatusClasses(visit.status)}`}>
              {t(visitStatusKey(visit.status))}
            </span>
            <h2 id="visit-review-title" className="text-lg font-semibold text-foreground sm:text-xl">{visit.customer.name || t("unknownCustomer")}</h2>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{locationLine || t("noAddress")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{visit.agent?.name || t("unknownAgent")}</span>
              {visit.contact?.displayName ? <span className="text-muted-foreground">· {t("review.contact", { name: visit.contact.displayName })}</span> : null}
            </span>
            <Link href={`/mtm/customers/${visit.customer.id}`} className="font-medium text-primary hover:underline">
              {t("review.openCustomer")}
            </Link>
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0">
          <Link href={closeHref} scroll={false} aria-label={t("review.close")}><X className="h-5 w-5" aria-hidden="true" /></Link>
        </Button>
      </header>

      <div className="border-b border-zinc-200 bg-muted/30 px-4 py-2.5 dark:border-zinc-800 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" data-testid="mtm-visit-review-facts">
          {facts.map((item) => (
            <span key={item.key} className={`inline-flex items-center gap-1.5 ${item.tone || "text-foreground"}`}>
              {item.icon}
              {item.href
                ? <a className="font-medium hover:underline" href={item.href} target="_blank" rel="noreferrer">{item.text}</a>
                : <span className="tabular-nums">{item.text}</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="divide-y divide-zinc-200 px-4 dark:divide-zinc-800 sm:px-5 lg:border-r lg:border-zinc-200 lg:dark:border-zinc-800">
          <section className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {blockTitle(t("review.sectionProgress"))}
              <span className="text-xs text-muted-foreground">
                {visit.route
                  ? `${visit.route.name || t("review.routeUnnamed")}${visit.routePoint ? ` · ${t("review.routePoint", { number: visit.routePoint.orderIndex + 1 })}` : ""}`
                  : visit.primaryAgentHidden ? t("review.routeHidden") : t("review.unplanned")}
              </span>
            </div>
            <dl className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {placeRow(t("review.placeCheckIn"), place.checkIn, "checkIn")}
              {placeRow(t("review.placeCheckOut"), place.checkOut, "checkOut")}
            </dl>
            <p className="mt-1 flex flex-wrap gap-x-4 text-xs">
              {mapHref(visit.checkInLat, visit.checkInLng) ? (
                <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={mapHref(visit.checkInLat, visit.checkInLng) as string} target="_blank" rel="noreferrer">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t("review.placeCheckIn")} · {t("review.mapLink")}
                </a>
              ) : null}
              {mapHref(visit.checkOutLat, visit.checkOutLng) ? (
                <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={mapHref(visit.checkOutLat, visit.checkOutLng) as string} target="_blank" rel="noreferrer">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t("review.placeCheckOut")} · {t("review.mapLink")}
                </a>
              ) : null}
            </p>
          </section>

          {visit.presentationSessions.length ? (
            <section className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("review.presentationsTitle")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t("review.presentationsCount", { count: visit.presentationSessions.length })}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("review.presentationEvidenceNote")}</p>
              <ul className="mt-2 space-y-2" data-testid="mtm-visit-presentation-sessions">
                {visit.presentationSessions.map((session) => {
                  const viewedPages = Array.isArray(session.pagesViewed) ? session.pagesViewed.length : 0
                  const latitude = session.openLat ?? session.closeLat
                  const longitude = session.openLng ?? session.closeLng
                  return (
                    <li key={session.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{session.product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {session.product.group.name}
                            {session.document ? ` · ${session.document.title || session.document.fileName}` : ""}
                            {session.presentationVersion ? ` · v${session.presentationVersion}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatTime(session.openedAt)} → {formatTime(session.closedAt || session.lastViewedAt)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("review.presentationActiveTime", { minutes: Math.max(1, Math.ceil(session.activeDurationSeconds / 60)) })}</span>
                        {session.pageCount || viewedPages ? (
                          <span>{t("review.presentationPages", { viewed: viewedPages, total: session.pageCount ?? "—" })}</span>
                        ) : null}
                        {latitude != null && longitude != null ? (
                          <a
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                            href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("review.presentationLocation")}
                          </a>
                        ) : (
                          <span>{t("review.presentationNoLocation")}</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {visit.photos.length ? (
            <section className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                {blockTitle(t("review.photosTitle"))}
                <span className="text-xs text-muted-foreground">{t("review.photosCount", { count: photoCount })}</span>
              </div>
              <div className="mt-2">
                <VisitPhotoGrid
                  photos={visit.photos}
                  formatTime={(value) => formatTime(value)}
                  openLabel={(index) => t("review.openPhoto", { index })}
                  titleLabel={(index) => t("review.photoTitle", { index, total: photoCount })}
                />
                {photoCount > visit.photos.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t("review.morePhotos", { count: photoCount - visit.photos.length })}</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <div className="divide-y divide-zinc-200 border-t border-zinc-200 px-4 dark:divide-zinc-800 dark:border-zinc-800 sm:px-5 lg:border-t-0">
          {visit.notes?.trim() || hasResult ? (
            <section className="py-3">
              {blockTitle(t("review.sectionOutcome"))}
              {visit.notes?.trim() ? (
                <p className="mt-2 whitespace-pre-line text-sm text-foreground">{visit.notes}</p>
              ) : null}
              {hasResult ? (
                <dl className="mt-2 space-y-1 text-sm">
                  {visit.outcome ? <div className="flex gap-2"><dt className="text-muted-foreground">{tw("outcome")}:</dt><dd className="font-medium text-foreground">{tw(`outcomes.${visit.outcome}`)}</dd></div> : null}
                  {visit.potential && visit.potential !== "UNKNOWN" ? <div className="flex gap-2"><dt className="text-muted-foreground">{tw("potential")}:</dt><dd className="font-medium text-foreground">{tw(`potentials.${visit.potential}`)}</dd></div> : null}
                  {visit.resultNotes ? <div><dt className="sr-only">{t("review.resultNote")}</dt><dd className="whitespace-pre-line text-foreground">{visit.resultNotes}</dd></div> : null}
                  {visit.nextActionDueAt ? <div className="text-muted-foreground">{t("review.nextActionDue", { date: formatFull(visit.nextActionDueAt) })}</div> : null}
                </dl>
              ) : null}
            </section>
          ) : null}

          {signature ? (
            <section className="py-3">
              {blockTitle(tw("actions.SIGNATURE"))}
              <SignaturePreview evidence={signature.evidence} label={tw("actions.SIGNATURE")} />
              <p className="mt-2 text-xs text-muted-foreground">
                {[signerName ? t("review.signedBy", { name: signerName }) : null, signedAt ? t("review.signedAt", { time: formatTime(signedAt) }) : null].filter(Boolean).join(" · ")}
              </p>
            </section>
          ) : null}

          {actionRows.length ? (
            <section className="py-3">
              {blockTitle(t("review.actionsTitle"))}
              <ul className="mt-1 divide-y divide-zinc-100 text-sm dark:divide-zinc-800/60" data-testid="mtm-visit-review-actions">
                {actionRows.map((row) => (
                  <li key={row.actionKey} className="flex items-center justify-between gap-3 py-1.5">
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
            </section>
          ) : null}

          <section className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("review.openTasksShort")}
              </h3>
              <span className="text-xs text-muted-foreground">{t("review.openTasks", { count: data.openTasks.count })}</span>
            </div>
            {data.openTasks.items.length ? (
              <ul className="mt-1.5 space-y-1 text-sm">
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
            {data.openTasks.count > 0 ? (
              <Link href="/mtm/tasks" className="mt-1.5 inline-block text-sm font-medium text-primary hover:underline">{t("review.openTasksLink")}</Link>
            ) : null}
          </section>

          {missing.length ? (
            <section className="py-3">
              <p className="text-xs text-muted-foreground">{t("review.nothingRecorded", { items: missing.join(", ").toLocaleLowerCase(locale) })}</p>
            </section>
          ) : null}
        </div>
      </div>
    </>,
  )
}
