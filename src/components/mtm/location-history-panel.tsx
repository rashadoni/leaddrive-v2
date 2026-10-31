"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { historyErrorMessage } from "@/lib/mtm/location-history-errors"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Activity, AlertTriangle, CheckCircle2, Clock3, Download, Layers3, LocateFixed, MapPin, Pause, Play, RefreshCw, RotateCcw, Route, Satellite, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint, HintValue } from "@/components/hint"
import { MtmFilterBar, MtmFilterDate, MtmFilterSelect } from "@/components/mtm/filter-bar"
import { Select } from "@/components/ui/select"
import { dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"
import { formatTime } from "@/lib/format-date"
import { visitPlaceSummary } from "@/lib/mtm/visit-place-check"
import { addDays, clampHistoryEndDate, MAX_RANGE_DAYS } from "@/lib/mtm/history-range"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import { mtmSpeedKmh } from "@/lib/mtm/gps-speed"
import { historyReplayCuts, historyReplayFrame, historyReplaySkipStill, readHistoryMovement } from "@/lib/mtm/history-replay"
import { compassPoint } from "@/lib/mtm/movement-mode"
import { VisitPlaceBadge } from "@/components/mtm/visit-place-badge"
import { DayTripLedger, type DayTripData, type DayTripFocus } from "@/components/mtm/day-trip-ledger"

/** At ×1 two minutes of the day go by in a second. */
const REPLAY_DAY_MS_PER_MS = 120
const REPLAY_RATES = [1, 4, 10] as const

const LocationHistoryMap = dynamic(() => import("@/components/mtm/location-history-map"), { ssr: false })

type RosterAgent = {
  id: string
  name: string
  role: string
  team: { id: string; name: string } | null
}

type HistoryData = {
  agent: RosterAgent
  // Old cached responses predate the split and are the bundled MTM contract.
  // Treat the omitted marker as Workforce-enabled for a non-breaking UI read.
  capabilities?: { workforce?: boolean }
  range: { date: string; toDate?: string; days?: number; from: string; to: string; timezone: string }
  policy: {
    maxAccuracyMeters: number
    stopRadiusMeters: number
    stopMinimumMinutes: number
    gapThresholdSeconds: number
    distanceFormula: string
    impossibleSpeedKmh: number
    autoTrackingSupported: boolean
    /** Organization default; older responses omit it. */
    geofenceRadiusMeters?: number
  }
  quality: {
    rawPointCount: number
    acceptedPointCount: number
    returnedPointCount: number
    rejectedByAccuracy: number
    rejectedInvalid: number
    duplicateCount: number
    rawTruncated: boolean
    downsampled: boolean
  }
  summary: {
    distanceMeters: number | null
    /** What the kilometres were counted along (road-distance.ts). */
    distanceBasis?: "ROADS" | "PARTIAL" | "STRAIGHT"
    firstPointAt: string | null
    lastPointAt: string | null
    stopCount: number
    visitCount: number
    gapCount: number
    pausedGapCount?: number
    anomalyCount: number
  }
  workday: {
    id: string
    status: "STARTED" | "PAUSED" | "COMPLETED"
    startedAt: string
    pausedAt: string | null
    completedAt: string | null
    totalPausedSeconds: number
    startLatitude: number | null
    startLongitude: number | null
    endLatitude: number | null
    endLongitude: number | null
  } | null
  /**
   * No workday dated on the selected day, but one started earlier covers it
   * (open overnight, or closed during this day). Older responses omit it.
   */
  carriedOverWorkday?: {
    id: string
    status: "STARTED" | "PAUSED" | "COMPLETED"
    workDate: string
    startedAt: string
    completedAt: string | null
  } | null
  /** Each day's shift when the window spans several days. Older responses omit it. */
  workdays?: Array<{
    id: string
    status: "STARTED" | "PAUSED" | "COMPLETED"
    workDate: string
    startedAt: string
    completedAt: string | null
  }>
  points: Array<{
    id: string
    latitude: number
    longitude: number
    accuracy: number | null
    speed: number | null
    heading: number | null
    battery: number | null
    isMoving: boolean
    recordedAt: string
    workdayId: string | null
  }>
  /** The track along the streets (self-hosted OSRM); null when it did not answer. */
  matchedTrack?: { segments: Array<Array<[number, number]>>; matchedPoints: number; totalPoints: number } | null
  stops: Array<{
    id: string
    startedAt: string
    endedAt: string
    durationSeconds: number
    latitude: number
    longitude: number
    pointCount: number
    averageAccuracy: number | null
    batteryStart: number | null
    batteryEnd: number | null
    connectivity: "ONLINE" | "OFFLINE_GAPS"
    visit: {
      id: string
      customerId: string
      customerName: string
      customerAddress: string | null
      status: string
      confirmed: true
    } | null
  }>
  gaps: Array<{
    id: string
    startedAt: string
    endedAt: string
    durationSeconds: number
    reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"
    startLatitude: number
    startLongitude: number
    endLatitude: number
    endLongitude: number
  }>
  anomalies: Array<{
    id: string
    type: "IMPOSSIBLE_JUMP" | "LOW_ACCURACY" | "MISSING_SEGMENT"
    startedAt: string
    endedAt: string
    detail: {
      distanceMeters?: number
      speedKmh?: number
      accuracyMeters?: number
      durationSeconds?: number
    }
  }>
  plannedRoutes: Array<{
    id: string
    name: string | null
    status: string
    version: number
    publishedVersion: number | null
    points: Array<{
      id: string
      orderIndex: number
      status: "PENDING" | "VISITED" | "SKIPPED"
      plannedTime: string | null
      visitedAt: string | null
      label: string
      customer: {
        name: string
        latitude: number | null
        longitude: number | null
      }
    }>
  }>
  timeline: Array<{
    id: string
    at: string
    endedAt: string | null
    kind: string
    source: "WORKDAY" | "PLAN" | "VISIT" | "GPS"
    label: string
    relatedId: string | null
    confirmed: boolean
  }>
  /** The day as legs; null when the raw read was cut short. Older responses omit it. */
  trip?: DayTripData | null
  visits: Array<{
    id: string
    customerId: string
    status: "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED"
    checkInAt: string
    checkOutAt: string | null
    checkInLat: number | null
    checkInLng: number | null
    checkOutLat?: number | null
    checkOutLng?: number | null
    checkInCustomerLat?: number | null
    checkInCustomerLng?: number | null
    checkInGeofenceRadius?: number | null
    confirmed: true
    customer: {
      name: string
      address: string | null
      latitude: number | null
      longitude: number | null
      geofenceRadius?: number | null
    }
  }>
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

/** What a layer button shows on the map; the plainly named ones need no hint. */
const HISTORY_LAYER_HINT: Partial<Record<"planned" | "actual" | "stops" | "visits" | "gaps" | "roads", string>> = {
  planned: "hint.historyLayerPlanned",
  actual: "hint.historyLayerActual",
  gaps: "hint.historyLayerGaps",
  roads: "hint.historyLayerRoads",
}

/** What each GPS quality warning means and what it does to the figures. */
const HISTORY_ANOMALY_HINT = {
  IMPOSSIBLE_JUMP: "hint.historyAnomalyJump",
  LOW_ACCURACY: "hint.historyAnomalyLowAccuracy",
  MISSING_SEGMENT: "hint.historyAnomalyMissing",
} as const

/** How the kilometres were counted (road-distance.ts); older responses omit the basis. */
const HISTORY_DISTANCE_HINT = {
  ROADS: "hint.historyDistanceRoads",
  PARTIAL: "hint.historyDistancePartial",
  STRAIGHT: "hint.historyDistanceStraight",
} as const

/** Wall-clock HH:MM in the tenant's timezone, for the time inputs. */
function tenantClock(value: Date | string, timezone: string): string {
  return formatTime(value, "az", { hour: "2-digit", minute: "2-digit", timeZone: timezone })
}

/**
 * The window a date opens with. Prod audit 2026-09-14: the fixed 07:00–19:00
 * cut off an 18:49–18:53 visit's tail and everything after seven. A past day
 * opens whole; today opens from midnight to now, and once the day's data is in
 * the start snaps to the workday start or the first GPS point.
 */
function defaultHistoryWindow(date: string, timezone: string): { from: string; to: string } {
  const today = dateInputValueInTimezone(new Date(), timezone)
  if (date === today) return { from: "00:00", to: tenantClockNowCeil(timezone) }
  return { from: "00:00", to: "23:59" }
}


/**
 * "Now" for the end of today's window, rounded up to the next minute and kept
 * on today. Review of #205: in the first minute after midnight the window was
 * 00:00–00:00, an empty range.
 */
function tenantClockNowCeil(timezone: string): string {
  const now = new Date()
  const next = new Date(now.getTime() + 60_000)
  if (dateInputValueInTimezone(next, timezone) !== dateInputValueInTimezone(now, timezone)) return "23:59"
  return tenantClock(next, timezone)
}

function distanceLabel(meters: number | null, unavailable: string): string {
  if (meters == null) return unavailable
  return meters < 1_000 ? `${meters} m` : `${(meters / 1_000).toFixed(2)} km`
}

export function LocationHistoryPanel() {
  const locale = useLocale()
  const t = useTranslations("mtmMap.history")
  // The speed reads in the live map's words, so one fix says the same on both screens.
  const tMap = useTranslations("mtmMap")
  const [agents, setAgents] = useState<RosterAgent[]>([])
  const [timezone, setTimezone] = useState("Asia/Baku")
  const [agentId, setAgentId] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState("00:00")
  const [to, setTo] = useState("23:59")
  // True while the window is the automatic one for the chosen date; any manual
  // edit of the time inputs hands control to the user.
  const autoWindowRef = useRef(true)
  const [accuracy, setAccuracy] = useState(100)
  const [data, setData] = useState<HistoryData | null>(null)
  const [loadingRoster, setLoadingRoster] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [rosterError, setRosterError] = useState("")
  const [historyError, setHistoryError] = useState("")
  const rosterRequestRef = useRef<AbortController | null>(null)
  const historyRequestRef = useRef<AbortController | null>(null)
  // A link from the live map can specify an employee and a date. Remember that
  // one explicit request until the roster resolves, then load it once. Manual
  // filter changes still require the user to press "Show".
  const requestedHistoryLoadRef = useRef<{ agentId: string; date: string } | null>(null)
  // The replay holds a moment of the day, not a fix (owner 2026-11-01, of
  // the mockup): null — the end of the day.
  const [playbackAt, setPlaybackAt] = useState<number | null>(null)
  const [playbackRate, setPlaybackRate] = useState(4)
  const [skipStill, setSkipStill] = useState(true)
  const [tripFocus, setTripFocus] = useState<DayTripFocus | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [layers, setLayers] = useState({
    planned: true,
    actual: true,
    stops: true,
    visits: true,
    gaps: true,
    roads: true,
  })

  const invalidateHistory = useCallback(() => {
    historyRequestRef.current?.abort()
    historyRequestRef.current = null
    setLoadingHistory(false)
    setHistoryError("")
    setData(null)
  }, [])

  const loadRoster = useCallback(async () => {
    rosterRequestRef.current?.abort()
    requestedHistoryLoadRef.current = null
    const controller = new AbortController()
    rosterRequestRef.current = controller
    setLoadingRoster(true)
    setRosterError("")
    invalidateHistory()

    try {
      const response = await fetch("/api/v1/mtm/location-history", { signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.error || response.statusText)
      if (controller.signal.aborted || rosterRequestRef.current !== controller) return

      const roster = body.data.agents as RosterAgent[]
      const searchParams = new URLSearchParams(window.location.search)
      const selectedFromUrl = searchParams.get("agentId")
      const selected = roster.some((agent) => agent.id === selectedFromUrl) ? selectedFromUrl : roster[0]?.id
      const selectedDate = searchParams.get("date")
      const resolvedAgentId = selected || ""
      const resolvedDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
        ? selectedDate
        : dateInputValueInTimezone(new Date(), body.data.timezone)
      // A link from a live-feed alert names the minutes around the event.
      const fromParam = searchParams.get("from") ?? ""
      const toParam = searchParams.get("to") ?? ""
      const resolvedToDate = clampHistoryEndDate(resolvedDate, searchParams.get("toDate") ?? resolvedDate)
      const linkedWindow = HH_MM.test(fromParam) && HH_MM.test(toParam) && (fromParam < toParam || resolvedToDate > resolvedDate)
      const historyWindow = linkedWindow ? { from: fromParam, to: toParam } : defaultHistoryWindow(resolvedToDate, body.data.timezone)
      autoWindowRef.current = !linkedWindow
      setFrom(historyWindow.from)
      setTo(historyWindow.to)

      setAgents(roster)
      setTimezone(body.data.timezone)
      setDate(resolvedDate)
      setToDate(resolvedToDate)
      setAccuracy(body.data.policy.maxAccuracyMeters)
      setAgentId(resolvedAgentId)
      if (selectedFromUrl && resolvedAgentId) {
        requestedHistoryLoadRef.current = { agentId: resolvedAgentId, date: resolvedDate }
      }
    } catch (reason) {
      if (controller.signal.aborted || rosterRequestRef.current !== controller) return
      setAgents([])
      setAgentId("")
      setRosterError(reason instanceof Error ? reason.message : t("rosterLoadFailed"))
    } finally {
      if (rosterRequestRef.current === controller) {
        rosterRequestRef.current = null
        setLoadingRoster(false)
      }
    }
  }, [invalidateHistory, t])

  useEffect(() => {
    void loadRoster()
    return () => {
      rosterRequestRef.current?.abort()
      historyRequestRef.current?.abort()
    }
  }, [loadRoster])

  const loadHistory = useCallback(async () => {
    if (!agentId) return
    historyRequestRef.current?.abort()
    const controller = new AbortController()
    historyRequestRef.current = controller
    setLoadingHistory(true)
    setHistoryError("")
    setData(null)
    const isToday = toDate === dateInputValueInTimezone(new Date(), timezone)
    // Pressing «Show» again later today should include what happened since.
    const effectiveTo = autoWindowRef.current && isToday ? tenantClockNowCeil(timezone) : to
    if (effectiveTo !== to) setTo(effectiveTo)
    try {
      const params = new URLSearchParams({
        agentId,
        date,
        from,
        to: effectiveTo,
        timezone,
        accuracy: String(accuracy),
      })
      if (toDate !== date) params.set("toDate", toDate)
      const response = await fetch(`/api/v1/mtm/location-history?${params}`, { signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.code || body?.error || response.statusText)
      if (controller.signal.aborted || historyRequestRef.current !== controller) return
      setData(body.data)
      if (autoWindowRef.current && isToday) {
        const dayStart = (body.data as HistoryData).workday?.startedAt ?? (body.data as HistoryData).summary.firstPointAt
        if (dayStart && date === toDate && dateInputValueInTimezone(dayStart, timezone) === date) {
          const start = tenantClock(dayStart, timezone)
          if (start < effectiveTo) setFrom(start)
        }
      }
    } catch (reason) {
      if (controller.signal.aborted || historyRequestRef.current !== controller) return
      setHistoryError(historyErrorMessage(reason instanceof Error ? reason.message : "", t))
      setData(null)
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null
        setLoadingHistory(false)
      }
    }
  }, [accuracy, agentId, date, from, t, timezone, to, toDate])

  useEffect(() => {
    const requested = requestedHistoryLoadRef.current
    if (!requested || loadingRoster || requested.agentId !== agentId || requested.date !== date) return
    requestedHistoryLoadRef.current = null
    void loadHistory()
  }, [agentId, date, loadHistory, loadingRoster])

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId), [agentId, agents])
  const playbackPointCount = data?.points.length ?? 0
  const replayPoints = useMemo(() => data?.points ?? [], [data])
  const replayCuts = useMemo(() => historyReplayCuts(replayPoints, data?.gaps ?? []), [data, replayPoints])
  const replayReading = useMemo(() => readHistoryMovement(replayPoints, replayCuts), [replayCuts, replayPoints])
  const dayStartAt = replayPoints.length ? Date.parse(replayPoints[0].recordedAt) : 0
  const dayEndAt = replayPoints.length ? Date.parse(replayPoints[replayPoints.length - 1].recordedAt) : 0
  const replayAt = playbackAt == null ? dayEndAt : Math.min(dayEndAt, Math.max(dayStartAt, playbackAt))
  const replayFrame = useMemo(
    () => historyReplayFrame(replayPoints, replayReading, replayCuts, replayAt),
    [replayAt, replayCuts, replayPoints, replayReading],
  )
  const playbackIndex = replayFrame?.index ?? 0
  const playbackAtEnd = replayAt >= dayEndAt
  const playbackPoint = replayPoints[playbackIndex] ?? null
  // Between two fixes the speed of the fix behind him; on a break or out of signal none.
  const playbackSpeedKmh = replayFrame?.mode === "DRIVE" || replayFrame?.mode === "WALK" ? mtmSpeedKmh(playbackPoint?.speed) : null
  const playbackAtMillis = replayPoints.length ? replayAt : Number.POSITIVE_INFINITY
  const activeTimelineIndex = data?.timeline.reduce(
    (lastIndex, event, index) => new Date(event.at).getTime() <= playbackAtMillis ? index : lastIndex,
    -1,
  ) ?? -1
  const exportUrl = useMemo(() => {
    if (!agentId) return "#"
    return `/api/v1/mtm/location-history?${new URLSearchParams({
      agentId,
      date,
      from,
      to,
      timezone,
      accuracy: String(accuracy),
      format: "csv",
      ...(toDate !== date ? { toDate } : {}),
    })}`
  }, [accuracy, agentId, date, from, timezone, to, toDate])

  const formatMoment = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatInTimezone(value, timezone, options ?? { dateStyle: "short", timeStyle: "short" }, locale)
  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes < 60
      ? t("durationMinutes", { minutes })
      : t("durationHoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }

  useEffect(() => {
    setIsPlaying(false)
    setPlaybackAt(null)
    setTripFocus(null)
  }, [data])

  // The day plays by the clock: at ×1 two minutes of the day go by in a
  // second, so a forty-minute stop lasts twenty seconds and a five-minute
  // drive two and a half — as long, side by side, as they were.
  const replayRef = useRef({ replayPoints, replayReading, replayCuts, dayEndAt, playbackRate, skipStill })
  replayRef.current = { replayPoints, replayReading, replayCuts, dayEndAt, playbackRate, skipStill }
  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    let last: number | null = null
    const step = (now: number) => {
      const elapsed = last == null ? 0 : Math.min(100, now - last)
      last = now
      const replay = replayRef.current
      let ended = false
      setPlaybackAt((current) => {
        let next = (current ?? replay.dayEndAt) + elapsed * replay.playbackRate * REPLAY_DAY_MS_PER_MS
        if (replay.skipStill) next = historyReplaySkipStill(replay.replayPoints, replay.replayReading, replay.replayCuts, next)
        if (next >= replay.dayEndAt) {
          ended = true
          return replay.dayEndAt
        }
        return next
      })
      if (ended) setIsPlaying(false)
      else frame = window.requestAnimationFrame(step)
    }
    frame = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frame)
  }, [isPlaying])

  const togglePlayback = () => {
    if (playbackPointCount < 2) return
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (playbackAtEnd) setPlaybackAt(dayStartAt)
    setIsPlaying(true)
  }

  if (loadingRoster) {
    return <div className="h-64 animate-pulse rounded-lg border bg-muted/30" aria-label={t("loading")} />
  }

  return (
    <div className="space-y-3">
      <form
        data-testid="mtm-location-history-filter-form"
        className="@container rounded-lg border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void loadHistory()
        }}
      >
        {/* Owner 2026-09-27: filters in one row. Seven labelled fields on a
            fixed grid became pills that wrap; «Показать» stays — a history
            load is heavy and runs when asked for. */}
        <MtmFilterBar testId="mtm-location-history-filters">
          <MtmFilterSelect testId="mtm-location-history-agent" label={t("agent")} value={agentId} emptyValue="__none__" showValue clearable={false}
            allLabel={t("noAgents")} disabled={!agents.length}
            options={agents.map((agent) => ({ value: agent.id, label: `${agent.name}${agent.team ? ` · ${agent.team.name}` : ""}` }))}
            onChange={(value) => {
              invalidateHistory()
              setAgentId(value)
            }} />
          <MtmFilterDate testId="mtm-location-history-date-from" label={t("dateFrom")} value={date}
            onChange={(start) => {
              invalidateHistory()
              // Owner 2026-09-22: the end stays where it is (today by default);
              // it moves only when the new start passes it or the window
              // would exceed its limit.
              const end = clampHistoryEndDate(start, toDate)
              setDate(start)
              setToDate(end)
              const historyWindow = defaultHistoryWindow(end, timezone)
              autoWindowRef.current = true
              setFrom(historyWindow.from)
              setTo(historyWindow.to)
            }} />
          <MtmFilterDate testId="mtm-location-history-date-to" label={t("dateTo")} value={toDate} min={date} max={addDays(date, MAX_RANGE_DAYS - 1)}
            onChange={(value) => {
              invalidateHistory()
              const end = clampHistoryEndDate(date, value)
              setToDate(end)
              const historyWindow = defaultHistoryWindow(end, timezone)
              autoWindowRef.current = true
              setFrom(historyWindow.from)
              setTo(historyWindow.to)
            }} />
          <MtmFilterDate type="time" label={t("from")} value={from}
            onChange={(value) => {
              invalidateHistory()
              autoWindowRef.current = false
              setFrom(value)
            }} />
          <MtmFilterDate type="time" label={t("to")} value={to}
            onChange={(value) => {
              invalidateHistory()
              autoWindowRef.current = false
              setTo(value)
            }} />
          <Hint wrap text={t("hint.historyAccuracyFilter")}>
            <MtmFilterSelect testId="mtm-location-history-accuracy" label={t("accuracyFilter")} value={String(accuracy)} emptyValue="100" showValue clearable={false} allLabel="≤ 100 m"
              options={[25, 50, 100, 200, 500].map((value) => ({ value: String(value), label: `≤ ${value} m` }))}
              onChange={(value) => {
                invalidateHistory()
                setAccuracy(Number(value))
              }} />
          </Hint>
          <Button data-testid="mtm-location-history-submit" type="submit" disabled={!agentId || loadingHistory} className="h-10 rounded-full px-4">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`} />
            {loadingHistory ? t("loading") : t("show")}
          </Button>
        </MtmFilterBar>
        <p className="mt-2 text-xs text-muted-foreground">{t("timezoneHint", { timezone })} {t("rangeHint", { days: MAX_RANGE_DAYS })}</p>
      </form>

      {rosterError && (
        <div data-testid="mtm-location-history-roster-error" role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-3 text-sm">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{t("rosterLoadFailed")}: {rosterError}</span>
          <Button data-testid="mtm-location-history-roster-retry" variant="outline" className="min-h-11" onClick={() => void loadRoster()}>{t("retryEmployees")}</Button>
        </div>
      )}

      {historyError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-3 text-sm">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{t("loadFailed")}: {historyError}</span>
          <Button data-testid="mtm-location-history-history-retry" variant="outline" className="min-h-11" onClick={() => void loadHistory()}>{t("retryHistory")}</Button>
        </div>
      )}

      {!rosterError && !historyError && !data && !loadingHistory && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Satellite className="mx-auto mb-2 h-7 w-7" />
          {agents.length ? t("chooseRange") : t("noAgents")}
        </div>
      )}

      {data && (
        <>
          <div data-testid="mtm-location-history-results" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            {[
              {
                icon: Route,
                label: t("distance"),
                value: distanceLabel(data.summary.distanceMeters, t("unavailableTruncated")),
                hint: data.summary.distanceMeters == null
                  ? t("hint.historyDistanceTruncated")
                  : t(HISTORY_DISTANCE_HINT[data.summary.distanceBasis ?? "PARTIAL"]),
              },
              { icon: LocateFixed, label: t("acceptedPoints"), value: `${data.quality.acceptedPointCount}`, hint: t("hint.historyAcceptedPoints", { accuracy: Math.round(data.policy.maxAccuracyMeters) }) },
              { icon: MapPin, label: t("stops"), value: `${data.summary.stopCount}`, hint: t("hint.historyStops", { minutes: data.policy.stopMinimumMinutes, radius: data.policy.stopRadiusMeters }) },
              { icon: CheckCircle2, label: t("visits"), value: `${data.summary.visitCount}`, hint: t("hint.historyVisits") },
              { icon: WifiOff, label: t("gaps"), value: `${data.summary.gapCount}`, hint: t("hint.historyGaps", { minutes: Math.round(data.policy.gapThresholdSeconds / 6) / 10 }) },
              { icon: Activity, label: t("anomalies"), value: `${data.summary.anomalyCount}`, hint: t("hint.historyAnomalies", { accuracy: Math.round(data.policy.maxAccuracyMeters) }) },
            ].map((metric) => (
              <div key={metric.label} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <metric.icon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                  <div className="text-lg font-semibold tabular-nums"><HintValue text={metric.hint}>{metric.value}</HintValue></div>
                </div>
              </div>
            ))}
          </div>

          {(data.quality.rawTruncated || data.quality.downsampled || data.quality.rejectedByAccuracy > 0) && (
            <div className="rounded-lg border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 px-3 py-2 text-xs">
              {data.quality.rawTruncated
                ? t("truncatedWarning")
                : t("qualitySummary", {
                    raw: data.quality.rawPointCount,
                    accepted: data.quality.acceptedPointCount,
                    returned: data.quality.returnedPointCount,
                  })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2">
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("layers")}>
              <span className="mr-1 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"><Layers3 className="h-3.5 w-3.5" />{t("layers")}</span>
              {(Object.keys(layers) as Array<keyof typeof layers>).filter((layer) => layer !== "roads" || Boolean(data?.matchedTrack)).map((layer) => {
                const hintKey = HISTORY_LAYER_HINT[layer]
                return (
                  <Hint key={layer} text={hintKey ? t(hintKey) : null}>
                    <button
                      type="button"
                      aria-pressed={layers[layer]}
                      onClick={() => setLayers((current) => ({ ...current, [layer]: !current[layer] }))}
                      className={`min-h-11 rounded-md border px-3 py-2 text-xs transition-colors ${layers[layer] ? "crm-choice-selected text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    >
                      {t(`layer.${layer}`)}
                    </button>
                  </Hint>
                )
              })}
            </div>
            <Hint text={t("hint.historyExportCsv")}>
              <a href={exportUrl} download className="inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">
                <Download className="mr-1.5 h-3.5 w-3.5" />{t("exportCsv")}
              </a>
            </Hint>
          </div>

          <section data-testid="mtm-location-history-replay" className="rounded-lg border border-border bg-card p-3" aria-labelledby="day-replay-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="day-replay-title" className="flex items-center gap-2 text-sm font-semibold">
                  <Play className="h-4 w-4 text-primary" />{t("replayTitle")}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("replayHint")}</p>
              </div>
              <div className="text-right text-xs" aria-live="polite">
                <div className="font-medium tabular-nums">
                  {replayFrame ? formatMoment(new Date(replayAt).toISOString()) : t("noReplayPoints")}
                </div>
                {replayFrame && (
                  <div data-testid="mtm-location-history-replay-mode" className="text-muted-foreground">
                    {tMap(`movement.${replayFrame.mode}`)}
                    {replayFrame.heading != null ? ` · ${tMap(`compass.${compassPoint(replayFrame.heading)}`)}` : ""}
                    {playbackSpeedKmh ? ` · ${tMap("roster.kmh", { value: playbackSpeedKmh })}` : ""}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-[auto_auto_minmax(180px,1fr)_110px] md:items-center">
              <Hint wrap text={playbackPointCount < 2 ? t("hint.historyPlayNeedsPoints") : null}>
                <Button
                  data-testid="mtm-location-history-play"
                  type="button"
                  variant={isPlaying ? "secondary" : "default"}
                  className="min-h-11"
                  onClick={togglePlayback}
                  disabled={playbackPointCount < 2}
                >
                  {isPlaying ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
                  {isPlaying ? t("pause") : playbackAtEnd ? t("replayFromStart") : t("play")}
                </Button>
              </Hint>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setIsPlaying(false)
                  setPlaybackAt(dayStartAt)
                }}
                disabled={!playbackPointCount || replayAt <= dayStartAt}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />{t("restart")}
              </Button>
              <label className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <span className="sr-only">{t("replayPosition")}</span>
                {/* By the minute of the day, not by the fix. */}
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.ceil((dayEndAt - dayStartAt) / 60_000))}
                  step={1}
                  value={Math.round((replayAt - dayStartAt) / 60_000)}
                  disabled={playbackPointCount < 2}
                  aria-label={t("replayPosition")}
                  aria-valuetext={replayFrame ? formatMoment(new Date(replayAt).toISOString()) : t("noReplayPoints")}
                  onChange={(event) => {
                    setIsPlaying(false)
                    setPlaybackAt(dayStartAt + Number(event.target.value) * 60_000)
                  }}
                  className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                />
              </label>
              <label className="space-y-1 text-xs font-medium">
                <span className="sr-only">{t("playbackRate")}</span>
                <Hint text={t("hint.historyPlaybackRate")}>
                  <Select
                    className="min-h-11"
                    value={String(playbackRate)}
                    aria-label={t("playbackRate")}
                    onChange={(event) => setPlaybackRate(Number(event.target.value))}
                  >
                    {REPLAY_RATES.map((rate) => <option key={rate} value={rate}>{t("playbackRateValue", { rate })}</option>)}
                  </Select>
                </Hint>
              </label>
            </div>
            <Hint wrap text={t("skipStillHint")}>
              <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium">
                <input
                  data-testid="mtm-location-history-skip-still"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={skipStill}
                  onChange={(event) => setSkipStill(event.target.checked)}
                />
                {t("skipStill")}
              </label>
            </Hint>

            {playbackPoint && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("accuracy")}: <HintValue text={playbackPoint.accuracy == null ? null : t("hint.historyPointAccuracy")}>{playbackPoint.accuracy == null ? "—" : `${Math.round(playbackPoint.accuracy)} m`}</HintValue></span>
                <span>{t("battery")}: {playbackPoint.battery == null ? "—" : `${Math.round(playbackPoint.battery)}%`}</span>
                <span>{t("gpsSpeed")}: <HintValue text={playbackSpeedKmh == null ? null : t("hint.historyPointSpeed")}>{playbackSpeedKmh == null ? "—" : tMap("roster.kmh", { value: playbackSpeedKmh })}</HintValue></span>
                <HintValue text={t("hint.historyPointMoving")}>{replayFrame?.mode === "DRIVE" || replayFrame?.mode === "WALK" ? t("moving") : t("stationary")}</HintValue>
              </div>
            )}
          </section>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="space-y-2 xl:sticky xl:top-3">
            <div className="h-[56vh] min-h-[420px] overflow-hidden rounded-lg border border-border bg-card">
              <LocationHistoryMap
                points={data.points}
                stops={data.stops}
                visits={data.visits}
                workday={data.workday}
                plannedRoutes={data.plannedRoutes}
                gaps={data.gaps}
                layers={layers}
                locale={locale}
                timezone={timezone}
                playbackIndex={playbackIndex}
                playbackAt={replayAt}
                focus={tripFocus}
                matchedTrack={data.matchedTrack ?? null}
              />
            </div>
            {/* Owner 2026-09-22: «lines by colours, by pieces — no explanation». */}
            <ul data-testid="mtm-history-map-legend" className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              {/* Owner 2026-11-01: the line itself says car or on foot, with arrows the way he went. */}
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1 w-6 rounded-full" style={{ background: HISTORY_MAP_COLORS.track }} />{t("legendDrive")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-[3px] border-dotted" style={{ borderColor: HISTORY_MAP_COLORS.walk }} />{t("legendWalk")}</li>
              {data.matchedTrack && layers.roads ? (
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-2 border-dotted" style={{ borderColor: HISTORY_MAP_COLORS.raw }} />{t("legendRaw")}</li>
              ) : null}
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-[3px] border-dotted" style={{ borderColor: HISTORY_MAP_COLORS.gap }} />{t("legendGap")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-[3px] border-dashed" style={{ borderColor: HISTORY_MAP_COLORS.plan }} />{t("legendPlan")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.stop }} />{t("legendStop")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.visit }} />{t("legendVisit")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.current }} />{t("legendCurrent")}</li>
            </ul>
            </div>

            <aside className="space-y-3">
              {data.trip && (
                <DayTripLedger
                  trip={data.trip}
                  multiDay={(data.range.days ?? 1) > 1}
                  focusId={tripFocus?.id ?? null}
                  onFocus={setTripFocus}
                  formatMoment={formatMoment}
                  formatDuration={formatDuration}
                  roadsMatched={data.summary.distanceBasis === "ROADS"}
                />
              )}
              {data.capabilities?.workforce !== false ? <section className="rounded-lg border border-border bg-card p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />{t("workday")}</h3>
                {(data.range.days ?? 1) > 1 ? (
                  data.workdays?.length ? (
                    <ul data-testid="mtm-history-range-workdays" className="space-y-1 text-xs">
                      {data.workdays.map((row) => (
                        <li key={row.id} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{formatMoment(row.startedAt, { day: "numeric", month: "short" })}</span>
                          <span className="tabular-nums">{formatMoment(row.startedAt, { hour: "2-digit", minute: "2-digit" })}–{row.completedAt ? formatMoment(row.completedAt, { hour: "2-digit", minute: "2-digit" }) : t("workdayStillOpen")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">{t("noWorkdaysInRange")}</p>
                ) : data.workday ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">{t("status")}</dt><dd>{t(`workdayStatus.${data.workday.status}`)}</dd>
                    <dt className="text-muted-foreground">{t("workdayStart")}</dt><dd>{formatMoment(data.workday.startedAt)}</dd>
                    <dt className="text-muted-foreground">{t("workdayEnd")}</dt><dd>{data.workday.completedAt ? formatMoment(data.workday.completedAt) : "—"}</dd>
                  </dl>
                ) : data.carriedOverWorkday ? (
                  // Audit 2026-09-14: the history said "no workday" while the live
                  // map showed the same workday active since the previous evening.
                  <p data-testid="mtm-history-carried-workday" className="text-xs">
                    {data.carriedOverWorkday.completedAt
                      ? t("workdayCarriedClosed", {
                        since: formatMoment(data.carriedOverWorkday.startedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                        until: formatMoment(data.carriedOverWorkday.completedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                      })
                      : t("workdayOpenSince", {
                        since: formatMoment(data.carriedOverWorkday.startedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                      })}
                  </p>
                ) : <p className="text-xs text-muted-foreground">{t("noWorkday")}</p>}
              </section> : null}

              {/* The trip above tells the day; stops and raw events stay one click away as evidence. */}
              <details data-testid="mtm-history-evidence" open={!data.trip} className="group space-y-3">
              <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-sm font-medium">{t("trip.evidence")}</summary>
              <section className="rounded-lg border border-border bg-card">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">{t("stopDetails")} · {selectedAgent?.name}</h3>
                  <p className="text-xs text-muted-foreground">{t("stopPolicy", { radius: data.policy.stopRadiusMeters, minutes: data.policy.stopMinimumMinutes })}</p>
                </div>
                <div data-testid="mtm-location-history-stops" className="divide-y">
                  {!data.stops.length && <p className="p-4 text-xs text-muted-foreground">{t("noStops")}</p>}
                  {data.stops.map((stop) => (
                    <article
                      key={stop.id}
                      className={`space-y-2 p-3 text-xs transition-opacity ${new Date(stop.startedAt).getTime() > playbackAtMillis ? "opacity-45" : "opacity-100"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong>{formatMoment(stop.startedAt, { timeStyle: "short" })} – {formatMoment(stop.endedAt, { timeStyle: "short" })}</strong>
                        <span className="whitespace-nowrap text-muted-foreground">{formatDuration(stop.durationSeconds)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                        <span>{t("accuracy")}: <HintValue text={stop.averageAccuracy == null ? null : t("hint.historyStopAccuracy")}>{stop.averageAccuracy == null ? "—" : `${Math.round(stop.averageAccuracy)} m`}</HintValue></span>
                        <span>{t("battery")}: {stop.batteryStart == null ? "—" : stop.batteryStart === stop.batteryEnd ? `${Math.round(stop.batteryStart)}%` : `${Math.round(stop.batteryStart)}–${Math.round(stop.batteryEnd ?? stop.batteryStart)}%`}</span>
                        <HintValue text={stop.connectivity === "ONLINE" ? t("hint.historyStopOnline") : t("hint.historyStopOfflineGaps")}>{stop.connectivity === "ONLINE" ? t("online") : t("offlineGaps")}</HintValue>
                      </div>
                      <div className={`rounded-md px-2 py-1.5 ${stop.visit ? "text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                        {stop.visit
                          ? <><HintValue text={t("hint.historyStopVisit")}>{t("confirmedVisit")}</HintValue>: {stop.visit.customerName}</>
                          : t("stopIsNotVisit")}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">{t("timeline")}</h3>
                  <p className="text-xs text-muted-foreground">{t("timelineHint")}</p>
                </div>
                <div data-testid="mtm-location-history-timeline" className="divide-y">
                  {!data.timeline.length && <p className="p-4 text-xs text-muted-foreground">{t("noTimeline")}</p>}
                  {data.timeline.map((event, index) => (
                    <div
                      key={event.id}
                      aria-current={index === activeTimelineIndex ? "step" : undefined}
                      className={`grid grid-cols-[62px_1fr] gap-2 border-l-2 p-3 text-xs transition-colors ${new Date(event.at).getTime() > playbackAtMillis ? "border-l-transparent opacity-45" : index === activeTimelineIndex ? "border-l-primary bg-primary/5" : "border-l-transparent"}`}
                    >
                      <time className="tabular-nums text-muted-foreground">{formatMoment(event.at, { timeStyle: "short" })}</time>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <strong>{t(`timelineKind.${event.kind}`)}</strong>
                          <span className="text-[10px] text-muted-foreground">{t(`timelineSource.${event.source}`)}</span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          {event.label === "gps_stop" || event.label === "telemetry_gap" || event.label === "impossible_jump" || event.label === "low_accuracy"
                            ? t(`timelineLabel.${event.label}`)
                            : event.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              </details>
            </aside>
          </div>

          {data.anomalies.length > 0 && (
            <section className="rounded-lg border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />{t("evidenceWarnings")}</h3>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {data.anomalies.slice(0, 30).map((anomaly) => (
                  <div key={anomaly.id} className="rounded-md border bg-background/80 p-2 text-xs">
                    <div className="flex justify-between gap-2"><strong><HintValue text={t(HISTORY_ANOMALY_HINT[anomaly.type])}>{t(`anomaly.${anomaly.type}`)}</HintValue></strong><time className="text-muted-foreground">{formatMoment(anomaly.startedAt, { timeStyle: "short" })}</time></div>
                    <div className="mt-1 text-muted-foreground">
                      {anomaly.type === "IMPOSSIBLE_JUMP" && t("jumpDetail", { distance: Math.round(anomaly.detail.distanceMeters ?? 0), speed: Math.round(anomaly.detail.speedKmh ?? 0) })}
                      {anomaly.type === "LOW_ACCURACY" && t("accuracyDetail", { accuracy: Math.round(anomaly.detail.accuracyMeters ?? 0) })}
                      {anomaly.type === "MISSING_SEGMENT" && t("gapDetail", { minutes: Math.round((anomaly.detail.durationSeconds ?? 0) / 60) })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">{t("visitCorrelation")}</h3>
              <p className="text-xs text-muted-foreground">{t("visitCorrelationHint")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t("organization")}</th>
                    <th className="px-4 py-2 font-medium">{t("visitTime")}</th>
                    <th className="px-4 py-2 font-medium">{t("visitStatus")}</th>
                    <th className="px-4 py-2 font-medium">{t("fact")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {!data.visits.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">{t("noVisits")}</td></tr>}
                  {data.visits.map((visit) => {
                    // One rule with the visit review and the route detail.
                    const place = visitPlaceSummary(visit, data.policy.geofenceRadiusMeters)
                    return (
                    <tr key={visit.id}>
                      <td className="px-4 py-2.5"><div className="font-medium">{visit.customer.name}</div><div className="text-xs text-muted-foreground">{visit.customer.address || "—"}</div></td>
                      <td className="px-4 py-2.5 tabular-nums">{formatMoment(visit.checkInAt)}{visit.checkOutAt ? ` – ${formatMoment(visit.checkOutAt, { timeStyle: "short" })}` : ""}</td>
                      <td className="px-4 py-2.5">{t(`visitStatuses.${visit.status}`)}</td>
                      <td className="px-4 py-2.5">
                        <VisitPlaceBadge place={place} showDistanceDetail />
                        <div className="mt-1 flex gap-2 text-xs">
                          <Link className="text-primary hover:underline" href={`/mtm/visits?visitId=${visit.id}`}>{t("openVisit")}</Link>
                          <Link className="text-primary hover:underline" href={`/mtm/customers/${visit.customerId}`}>{t("openOrganization")}</Link>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            {t("methodNote", { accuracy: Math.round(data.policy.maxAccuracyMeters) })}
          </p>
        </>
      )}
    </div>
  )
}
