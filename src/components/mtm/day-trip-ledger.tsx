"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Car, Coffee, Flag, MapPin, Store, WifiOff } from "lucide-react"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"

/** The API's `DayTrip`, as it arrives over JSON. */
export type DayTripData = {
  entries: Array<
    | { kind: "START" | "END"; id: string; at: string; source: "WORKDAY" | "GPS" }
    | {
        kind: "STAY"
        id: string
        startedAt: string
        endedAt: string
        durationSeconds: number
        latitude: number | null
        longitude: number | null
        open: boolean
        visit: { id: string; customerId: string; customerName: string } | null
      }
    | { kind: "MOVE"; id: string; startedAt: string; endedAt: string; durationSeconds: number; distanceMeters: number; pointCount: number }
    | { kind: "GAP"; id: string; startedAt: string; endedAt: string; durationSeconds: number; reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"; displacementMeters: number }
  >
  summary: {
    movingSeconds: number
    movingMeters: number
    staySeconds: number
    visitCount: number
    unknownSeconds: number
    pausedSeconds: number
  }
}

/** A stretch of the day the map should bring forward. */
export type DayTripFocus = {
  id: string
  from: string
  to: string
  latitude: number | null
  longitude: number | null
}

/** Displacement below this is GPS jitter, not a distance worth reading out. */
const MEANINGFUL_DISPLACEMENT_METERS = 300

export function kilometres(meters: number): string {
  return meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1_000).toFixed(1)} km`
}

/**
 * Owner 2026-09-22: «if I sell it as a TMS, how will managers see which way
 * they drove to the customers». The day, told as legs; each leg lights up its
 * own stretch of track on the map.
 */
export function DayTripLedger({
  trip,
  multiDay,
  focusId,
  onFocus,
  formatMoment,
  formatDuration,
}: {
  trip: DayTripData
  multiDay: boolean
  focusId: string | null
  onFocus: (focus: DayTripFocus | null) => void
  formatMoment: (value: string, options?: Intl.DateTimeFormatOptions) => string
  formatDuration: (seconds: number) => string
}) {
  const t = useTranslations("mtmMap.history.trip")
  const clock = (value: string) => formatMoment(value, { hour: "2-digit", minute: "2-digit" })
  const dayOf = (value: string) => formatMoment(value, { day: "numeric", month: "long" })
  const { summary } = trip
  const entryDays = trip.entries.map((entry) => dayOf("at" in entry ? entry.at : entry.startedAt))

  return (
    <section data-testid="mtm-day-trip" className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="day-trip-title">
      <div className="border-b px-3 py-2">
        <h3 id="day-trip-title" className="text-sm font-semibold">{t("title")}</h3>
        <p data-testid="mtm-day-trip-summary" className="mt-0.5 text-xs text-muted-foreground">
          {[
            // «On the road 0 min, 0 m» on a day without a single drive reads as a fault.
            summary.movingSeconds > 0 ? t("summaryMoving", { duration: formatDuration(summary.movingSeconds), distance: kilometres(summary.movingMeters) }) : null,
            t("summaryVisits", { count: summary.visitCount }),
            summary.unknownSeconds > 0 ? t("summaryUnknown", { duration: formatDuration(summary.unknownSeconds) }) : null,
            summary.pausedSeconds > 0 ? t("summaryPaused", { duration: formatDuration(summary.pausedSeconds) }) : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      {!trip.entries.length && <p className="p-4 text-xs text-muted-foreground">{t("empty")}</p>}
      <ol className="divide-y">
        {trip.entries.map((entry, index) => {
          const dayHeader = multiDay && entryDays[index] !== entryDays[index - 1] ? entryDays[index] : null
          const focus: DayTripFocus | null = "at" in entry
            ? null
            : {
                id: entry.id,
                from: entry.startedAt,
                to: entry.endedAt,
                latitude: entry.kind === "STAY" ? entry.latitude : null,
                longitude: entry.kind === "STAY" ? entry.longitude : null,
              }
          const selected = focusId === entry.id
          const Icon = entry.kind === "MOVE" ? Car
            : entry.kind === "GAP" ? (entry.reason === "WORKDAY_PAUSED" ? Coffee : WifiOff)
            : entry.kind === "STAY" ? (entry.visit ? Store : MapPin)
            : Flag
          const tone = entry.kind === "MOVE" ? HISTORY_MAP_COLORS.track
            : entry.kind === "GAP" ? (entry.reason === "WORKDAY_PAUSED" ? "#64748b" : HISTORY_MAP_COLORS.gap)
            : entry.kind === "STAY" ? (entry.visit ? HISTORY_MAP_COLORS.visit : HISTORY_MAP_COLORS.stop)
            : "#334155"

          let title: string
          let detail: string | null = null
          switch (entry.kind) {
            case "START":
              title = entry.source === "WORKDAY" ? t("startWorkday") : t("startGps")
              break
            case "END":
              title = entry.source === "WORKDAY" ? t("endWorkday") : t("endGps")
              break
            case "MOVE":
              title = t("move")
              detail = `${formatDuration(entry.durationSeconds)} · ${kilometres(entry.distanceMeters)}`
              break
            case "STAY":
              title = entry.visit?.customerName ?? t("stopWithoutVisit")
              detail = entry.open
                ? t("visitOpen")
                : entry.visit
                  ? t("visitFor", { duration: formatDuration(entry.durationSeconds) })
                  : formatDuration(entry.durationSeconds)
              break
            case "GAP":
              title = entry.reason === "WORKDAY_PAUSED" ? t("pause") : t("noSignal")
              detail = entry.reason === "TELEMETRY_GAP" && entry.displacementMeters >= MEANINGFUL_DISPLACEMENT_METERS
                ? t("noSignalMoved", { duration: formatDuration(entry.durationSeconds), distance: kilometres(entry.displacementMeters) })
                : formatDuration(entry.durationSeconds)
              break
          }
          const time = "at" in entry
            ? clock(entry.at)
            : `${clock(entry.startedAt)}–${clock(entry.endedAt)}`

          const body = (
            <>
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tone }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{title}</span>
                {detail && <span className="block text-muted-foreground">{detail}</span>}
              </span>
              <time className="shrink-0 tabular-nums text-muted-foreground">{time}</time>
            </>
          )

          return (
            <li key={entry.id}>
              {dayHeader && <div className="bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{dayHeader}</div>}
              {focus ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onFocus(selected ? null : focus)}
                  className={`flex min-h-11 w-full items-start gap-2.5 border-l-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60 ${selected ? "border-l-primary bg-primary/5" : "border-l-transparent"}`}
                >
                  {body}
                </button>
              ) : (
                <div className="flex min-h-11 items-start gap-2.5 border-l-2 border-l-transparent px-3 py-2 text-xs">{body}</div>
              )}
              {entry.kind === "STAY" && entry.visit && selected && (
                <div className="flex gap-3 px-3 pb-2 pl-9 text-xs">
                  <Link className="text-primary hover:underline" href={`/mtm/visits?visitId=${entry.visit.id}`}>{t("openVisit")}</Link>
                  <Link className="text-primary hover:underline" href={`/mtm/customers/${entry.visit.customerId}`}>{t("openCustomer")}</Link>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">{t("straightLineNote")}</p>
    </section>
  )
}
