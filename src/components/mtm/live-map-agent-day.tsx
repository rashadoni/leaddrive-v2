"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

/** What GET /api/v1/mtm/locations/day-totals answers, as far as the card reads it. */
type DayTotals =
  /** The day has more GPS points than the server counts at once: there are no figures. */
  | { kind: "not-counted" }
  /** No coordinate the count accepts has come from the phone today. */
  | { kind: "empty" }
  | {
      kind: "counted"
      distanceMeters: number
      /** Along the roads the whole way — not straight lines, not a mix of the two. */
      byRoads: boolean
      movingSeconds: number
      unknownSeconds: number
    }

const amount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null

/** The server is asked to count too many days at once: not a failure, a reason to wait. */
class TooManyDayReads extends Error {}

/**
 * A row passed through on the way down the list is not a card somebody is
 * reading: the day is asked for once the selection has rested this long, so
 * walking the list counts nobody's day.
 */
const SETTLE_MS = 400
/** After «too many at once» the same employee is asked again this much later, a bounded number of times. */
const BUSY_RETRY_MS = 15_000
const BUSY_RETRIES = 3

async function readDayTotals(agentId: string, signal: AbortSignal): Promise<DayTotals> {
  const response = await fetch(`/api/v1/mtm/locations/day-totals?agentId=${encodeURIComponent(agentId)}`, { signal, cache: "no-store" })
  if (response.status === 429) throw new TooManyDayReads()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { data?: unknown }
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {}
  if (data.complete === false) return { kind: "not-counted" }
  const distanceMeters = amount(data.distanceMeters)
  // An answer without the day's figures is not a day of zero kilometres.
  if (data.complete !== true || distanceMeters === null) throw new Error("not the day's totals")
  if (typeof data.firstPointAt !== "string" || !data.firstPointAt) return { kind: "empty" }
  return {
    kind: "counted",
    distanceMeters,
    byRoads: data.distanceBasis === "ROADS",
    movingSeconds: amount(data.movingSeconds) ?? 0,
    unknownSeconds: amount(data.unknownSeconds) ?? 0,
  }
}

/**
 * Rounded to the minute, as «История за день» rounds the same seconds, so the
 * two screens say the same «1 ч 5 мин». A duration that exists is never
 * printed as «0 мин».
 */
function wholeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/**
 * «Пробег сегодня» and «В движении» in the selected employee's card (owner,
 * 2026-10-09: «добей до 100 %» of the Navixy tracking screen).
 *
 * The numbers are counted on the server from the day's GPS points, by the
 * rule «История за день» counts by; the points themselves never come to the
 * page. Asked for when he is selected and again when `refreshKey` changes
 * (he did something, or a couple of minutes passed) — not on every refresh
 * of the map: a day's kilometres do not change twice a minute.
 *
 * Three things are kept apart on purpose. The time in motion is shown only
 * when he drove; the time the phone was silent is a line of its own and is
 * never folded into «стоял»; and a day too long to count says so instead of
 * showing the kilometres of its beginning.
 */
export function LiveMapAgentDay({ agentId, refreshKey, formatDistance, settleMs = SETTLE_MS, busyRetryMs = BUSY_RETRY_MS }: {
  agentId: string
  /** Changes when the employee's row changes in a way worth counting again, and every couple of minutes. */
  refreshKey: string
  formatDistance: (meters: number) => string
  /** How long the selection must rest before the day is asked for (tests pass 0). */
  settleMs?: number
  /** How long to wait after «too many at once» before asking again (tests pass a short one). */
  busyRetryMs?: number
}) {
  // Named `t`, not `tMap` as in the neighbouring blocks: the key-existence gate
  // (lib-i18n-keys.test.ts) only follows translators called `t` or `tXy`, and
  // a key missing in one language would otherwise reach the screen as its path.
  const t = useTranslations("mtmMap")
  const [state, setState] = useState<{ agentId: string; totals: DayTotals | null; failed: boolean } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let busyTurns = 0
    const ask = () => {
      timer = null
      void readDayTotals(agentId, controller.signal)
        .then((totals) => {
          if (controller.signal.aborted) return
          setState({ agentId, totals, failed: false })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          // Too many days asked for at once: what is on screen stays as it
          // is — «считаю…» or the last figures — and he is asked again soon.
          if (error instanceof TooManyDayReads && busyTurns < BUSY_RETRIES) {
            busyTurns += 1
            timer = setTimeout(ask, busyRetryMs)
            return
          }
          // What was read before stays on screen, with a word that it is not fresh.
          setState((previous) => ({ agentId, failed: true, totals: previous?.agentId === agentId ? previous.totals : null }))
        })
    }
    timer = setTimeout(ask, settleMs)
    return () => {
      controller.abort()
      if (timer != null) clearTimeout(timer)
    }
  }, [agentId, refreshKey, settleMs, busyRetryMs])

  // Another employee's numbers are never shown under this one's name.
  const known = state?.agentId === agentId ? state : null
  const totals = known?.totals ?? null
  const duration = (seconds: number) => {
    const minutes = wholeMinutes(seconds)
    return minutes < 60
      ? t("since.duration.minutes", { minutes })
      : t("since.duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }

  return (
    <div data-testid="live-map-agent-day">
      {!known ? (
        <div className="text-muted-foreground" data-testid="live-map-agent-day-loading">{t("day.loading")}</div>
      ) : (
        <>
          {known.failed ? (
            <div role="status" className="mb-1 text-amber-700 dark:text-amber-300" data-testid="live-map-agent-day-failed">{t("day.failed")}</div>
          ) : null}
          {totals?.kind === "not-counted" ? (
            <div className="text-amber-700 dark:text-amber-300" data-testid="live-map-agent-day-not-calculated">{t("day.notCalculated")}</div>
          ) : null}
          {totals?.kind === "empty" ? (
            <div className="text-muted-foreground" data-testid="live-map-agent-day-empty">{t("day.empty")}</div>
          ) : null}
          {totals?.kind === "counted" ? (
            <>
              <dl className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-2" data-testid="live-map-agent-day-distance">
                  <dt className="text-muted-foreground">{t("day.distance")}</dt>
                  <dd className="text-right font-semibold tabular-nums text-foreground">
                    {formatDistance(totals.distanceMeters)}
                    {totals.byRoads ? <span className="font-normal text-muted-foreground"> · {t("day.byRoads")}</span> : null}
                  </dd>
                </div>
                {/* «В движении 0 мин» on a day without a single drive reads as a fault. */}
                {totals.movingSeconds > 0 ? (
                  <div className="flex items-baseline justify-between gap-2" data-testid="live-map-agent-day-moving">
                    <dt className="text-muted-foreground">{t("day.moving")}</dt>
                    <dd className="text-right font-semibold tabular-nums text-foreground">{duration(totals.movingSeconds)}</dd>
                  </div>
                ) : null}
                {totals.unknownSeconds > 0 ? (
                  <div className="flex items-baseline justify-between gap-2" data-testid="live-map-agent-day-unknown">
                    <dt className="text-muted-foreground">{t("day.unknown")}</dt>
                    <dd className="text-right font-semibold tabular-nums text-foreground">{duration(totals.unknownSeconds)}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-1 text-muted-foreground" data-testid="live-map-agent-day-note">{t("day.note")}</p>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
