"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Car, Coffee, Flag, MapPin, Store, WifiOff } from "lucide-react"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import { MovementBadge } from "@/components/mtm/movement-badge"

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
        /** The same visit again, after a break inside it: named on its first row only. */
        afterBreak?: boolean
      }
    | {
        kind: "MOVE"
        id: string
        startedAt: string
        endedAt: string
        durationSeconds: number
        distanceMeters: number
        pointCount: number
        /** Car or on foot; null — it does not say; absent — a server from before it was read. */
        mode?: "DRIVE" | "WALK" | null
      }
    | { kind: "GAP"; id: string; startedAt: string; endedAt: string; durationSeconds: number; reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"; displacementMeters: number; roadMeters?: number | null }
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
  roadsMatched = false,
}: {
  trip: DayTripData
  multiDay: boolean
  focusId: string | null
  onFocus: (focus: DayTripFocus | null) => void
  formatMoment: (value: string, options?: Intl.DateTimeFormatOptions) => string
  formatDuration: (seconds: number) => string
  /** Distances were counted along the roads (road-distance.ts), not straight between fixes. */
  roadsMatched?: boolean
}) {
  const t = useTranslations("mtmMap.history.trip")
  const clock = (value: string) => formatMoment(value, { hour: "2-digit", minute: "2-digit" })
  const dayOf = (value: string) => formatMoment(value, { day: "numeric", month: "long" })
  const { summary } = trip
  // The day added up the way the mockup «MTM: движение на карте» has it
  // (owner, 2026-11-01): by car, on foot, at the stops, on a break — each a
  // tile, and only those the day had.
  const legs = { DRIVE: { seconds: 0, meters: 0 }, WALK: { seconds: 0, meters: 0 }, MOVE: { seconds: 0, meters: 0 } }
  for (const entry of trip.entries) {
    if (entry.kind !== "MOVE") continue
    const sum = legs[entry.mode ?? "MOVE"]
    sum.seconds += entry.durationSeconds
    sum.meters += entry.distanceMeters
  }
  const totals: Array<{ id: string; badge: "DRIVE" | "WALK" | "STAY" | "BREAK" | "GAP" | null; value: string; label: string }> = [
    ...(["DRIVE", "WALK", "MOVE"] as const).flatMap((mode) => legs[mode].seconds > 0
      ? [{ id: mode, badge: mode === "MOVE" ? null : mode, value: formatDuration(legs[mode].seconds), label: t(`total${mode}`, { distance: kilometres(legs[mode].meters) }) }]
      : []),
    // «0 мин» on a day without a stop reads as a fault (prod 2026-09-24, of «В пути 0 мин, 0 м»).
    ...(summary.staySeconds > 0 || summary.visitCount > 0
      ? [{ id: "STAY", badge: "STAY" as const, value: formatDuration(summary.staySeconds), label: `${t("totalSTAY")} · ${t("summaryVisits", { count: summary.visitCount })}` }]
      : []),
    ...(summary.pausedSeconds > 0 ? [{ id: "BREAK", badge: "BREAK" as const, value: formatDuration(summary.pausedSeconds), label: t("totalBREAK") }] : []),
    ...(summary.unknownSeconds > 0 ? [{ id: "GAP", badge: "GAP" as const, value: formatDuration(summary.unknownSeconds), label: t("totalGAP") }] : []),
  ]
  const entryDays = trip.entries.map((entry) => dayOf("at" in entry ? entry.at : entry.startedAt))

  return (
    <section data-testid="mtm-day-trip" className="rounded-lg border border-border bg-card" aria-labelledby="day-trip-title">
      <div className="border-b px-3 py-2">
        <h3 id="day-trip-title" className="text-sm font-semibold">{t("title")}</h3>
        {trip.entries.length ? (
          <div data-testid="mtm-day-trip-summary" className="mt-2 grid grid-cols-2 gap-1.5">
            {totals.map((total) => (
              <div key={total.id} data-testid={`mtm-day-trip-total-${total.id}`} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5">
                {total.badge ? <MovementBadge mode={total.badge} size={22} /> : <Car aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: HISTORY_MAP_COLORS.track }} />}
                <span className="min-w-0">
                  <span className="block text-xs font-semibold tabular-nums">{total.value}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{total.label}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {!trip.entries.length && <p className="p-4 text-xs text-muted-foreground">{t("empty")}</p>}
      <ol className="divide-y">
        {trip.entries.map((entry, index) => {
          const dayHeader = multiDay && entryDays[index] !== entryDays[index - 1] ? entryDays[index] : null
          // A break has only its duration (the demo clip «Marşrut & Sahə»): it
          // is the employee's own time, and a row that drew a line from where
          // he paused to where he resumed would say where he went in between.
          // So it is a plain row, not a button, and puts nothing on the map.
          const focus: DayTripFocus | null = "at" in entry || (entry.kind === "GAP" && entry.reason === "WORKDAY_PAUSED")
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
            case "MOVE": {
              // «Ехал 18 мин · 6,2 км · ≈21 км/ч», as the mockup reads a leg.
              title = entry.mode ? t(`move${entry.mode}`) : t("move")
              const kmh = entry.durationSeconds >= 60 ? Math.round(entry.distanceMeters / entry.durationSeconds * 3.6) : 0
              detail = `${formatDuration(entry.durationSeconds)} · ${kilometres(entry.distanceMeters)}${entry.mode && kmh > 0 ? ` · ${t("moveSpeed", { kmh })}` : ""}`
              break
            }
            case "STAY":
              title = entry.afterBreak ? t("stayAfterBreak") : entry.visit?.customerName ?? t("stopWithoutVisit")
              detail = entry.open
                ? t("visitOpen")
                : entry.visit
                  ? t("visitFor", { duration: formatDuration(entry.durationSeconds) })
                  : formatDuration(entry.durationSeconds)
              break
            case "GAP":
              title = entry.reason === "WORKDAY_PAUSED" ? t("pause") : t("noSignal")
              detail = entry.reason === "TELEMETRY_GAP" && entry.roadMeters != null && entry.roadMeters >= MEANINGFUL_DISPLACEMENT_METERS
                ? t("noSignalRoad", { duration: formatDuration(entry.durationSeconds), distance: kilometres(entry.roadMeters) })
                : entry.reason === "TELEMETRY_GAP" && entry.displacementMeters >= MEANINGFUL_DISPLACEMENT_METERS
                  ? t("noSignalMoved", { duration: formatDuration(entry.durationSeconds), distance: kilometres(entry.displacementMeters) })
                  : formatDuration(entry.durationSeconds)
              break
          }
          const time = "at" in entry
            ? clock(entry.at)
            : `${clock(entry.startedAt)}–${clock(entry.endedAt)}`

          const body = (
            <>
              {entry.kind === "MOVE" && entry.mode
                ? <MovementBadge mode={entry.mode} size={18} />
                : <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tone }} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{title}</span>
                {detail && <span className="block text-muted-foreground">{detail}</span>}
              </span>
              <time className="shrink-0 tabular-nums text-muted-foreground">{time}</time>
            </>
          )

          return (
            <li key={entry.id}>
              {dayHeader && <div className="bg-muted/40 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{dayHeader}</div>}
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
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t(roadsMatched ? "roadsNote" : "straightLineNote")}</p>
    </section>
  )
}
