"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Activity, AlertTriangle, CheckCircle2, Clock3, Download, Layers3, LocateFixed, MapPin, Pause, Play, RefreshCw, RotateCcw, Route, Satellite, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"

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
  range: { date: string; from: string; to: string; timezone: string }
  policy: {
    maxAccuracyMeters: number
    stopRadiusMeters: number
    stopMinimumMinutes: number
    gapThresholdSeconds: number
    distanceFormula: string
    impossibleSpeedKmh: number
    autoTrackingSupported: boolean
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
    firstPointAt: string | null
    lastPointAt: string | null
    stopCount: number
    visitCount: number
    gapCount: number
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
    reason: "TELEMETRY_GAP"
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
  visits: Array<{
    id: string
    customerId: string
    status: "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED"
    checkInAt: string
    checkOutAt: string | null
    checkInLat: number | null
    checkInLng: number | null
    confirmed: true
    customer: {
      name: string
      address: string | null
      latitude: number | null
      longitude: number | null
    }
  }>
}

function distanceLabel(meters: number | null, unavailable: string): string {
  if (meters == null) return unavailable
  return meters < 1_000 ? `${meters} m` : `${(meters / 1_000).toFixed(2)} km`
}

export function LocationHistoryPanel() {
  const locale = useLocale()
  const t = useTranslations("mtmMap.history")
  const [agents, setAgents] = useState<RosterAgent[]>([])
  const [timezone, setTimezone] = useState("Asia/Baku")
  const [agentId, setAgentId] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState("07:00")
  const [to, setTo] = useState("19:00")
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
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [layers, setLayers] = useState({
    planned: true,
    actual: true,
    stops: true,
    visits: true,
    gaps: true,
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

      setAgents(roster)
      setTimezone(body.data.timezone)
      setDate(resolvedDate)
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
    try {
      const params = new URLSearchParams({
        agentId,
        date,
        from,
        to,
        timezone,
        accuracy: String(accuracy),
      })
      const response = await fetch(`/api/v1/mtm/location-history?${params}`, { signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.code || body?.error || response.statusText)
      if (controller.signal.aborted || historyRequestRef.current !== controller) return
      setData(body.data)
    } catch (reason) {
      if (controller.signal.aborted || historyRequestRef.current !== controller) return
      setHistoryError(reason instanceof Error ? reason.message : t("loadFailed"))
      setData(null)
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null
        setLoadingHistory(false)
      }
    }
  }, [accuracy, agentId, date, from, t, timezone, to])

  useEffect(() => {
    const requested = requestedHistoryLoadRef.current
    if (!requested || loadingRoster || requested.agentId !== agentId || requested.date !== date) return
    requestedHistoryLoadRef.current = null
    void loadHistory()
  }, [agentId, date, loadHistory, loadingRoster])

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId), [agentId, agents])
  const playbackPointCount = data?.points.length ?? 0
  const playbackLastIndex = Math.max(0, playbackPointCount - 1)
  const playbackPoint = data?.points[Math.min(playbackIndex, playbackLastIndex)] ?? null
  const playbackAtMillis = playbackPoint ? new Date(playbackPoint.recordedAt).getTime() : Number.POSITIVE_INFINITY
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
    })}`
  }, [accuracy, agentId, date, from, timezone, to])

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
    setPlaybackIndex(playbackLastIndex)
  }, [data, playbackLastIndex])

  useEffect(() => {
    if (!isPlaying || playbackPointCount < 2 || playbackIndex >= playbackLastIndex) return
    const timer = window.setTimeout(() => {
      const nextIndex = Math.min(playbackIndex + 1, playbackLastIndex)
      setPlaybackIndex(nextIndex)
      if (nextIndex >= playbackLastIndex) setIsPlaying(false)
    }, Math.max(180, 900 / playbackRate))
    return () => window.clearTimeout(timer)
  }, [isPlaying, playbackIndex, playbackLastIndex, playbackPointCount, playbackRate])

  const togglePlayback = () => {
    if (playbackPointCount < 2) return
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (playbackIndex >= playbackLastIndex) setPlaybackIndex(0)
    setIsPlaying(true)
  }

  if (loadingRoster) {
    return <div className="h-64 animate-pulse rounded-lg border bg-muted/30" aria-label={t("loading")} />
  }

  return (
    <div className="space-y-3">
      <form
        data-testid="mtm-location-history-filter-form"
        className="@container rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700"
        onSubmit={(event) => {
          event.preventDefault()
          void loadHistory()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 @min-[64rem]:grid-cols-[minmax(220px,1.4fr)_160px_130px_130px_150px_auto] @min-[64rem]:items-end">
          <label className="space-y-1 text-xs font-medium">
            <span>{t("agent")}</span>
            <Select
              data-testid="mtm-location-history-agent"
              className="min-h-11"
              value={agentId}
              onChange={(event) => {
                invalidateHistory()
                setAgentId(event.target.value)
              }}
              disabled={!agents.length}
            >
              {!agents.length && <option value="">{t("noAgents")}</option>}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}{agent.team ? ` · ${agent.team.name}` : ""}</option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span>{t("date")}</span>
            <input
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              type="date"
              value={date}
              onChange={(event) => {
                invalidateHistory()
                setDate(event.target.value)
              }}
              required
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span>{t("from")}</span>
            <input
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              type="time"
              value={from}
              onChange={(event) => {
                invalidateHistory()
                setFrom(event.target.value)
              }}
              required
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span>{t("to")}</span>
            <input
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              type="time"
              value={to}
              onChange={(event) => {
                invalidateHistory()
                setTo(event.target.value)
              }}
              required
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span>{t("accuracyFilter")}</span>
            <Select
              data-testid="mtm-location-history-accuracy"
              className="min-h-11"
              value={String(accuracy)}
              onChange={(event) => {
                invalidateHistory()
                setAccuracy(Number(event.target.value))
              }}
            >
              {[25, 50, 100, 200, 500].map((value) => <option key={value} value={value}>≤ {value} m</option>)}
            </Select>
          </label>
          <Button data-testid="mtm-location-history-submit" type="submit" disabled={!agentId || loadingHistory} className="min-h-11 w-full @min-[64rem]:w-auto">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`} />
            {loadingHistory ? t("loading") : t("show")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("timezoneHint", { timezone })}</p>
      </form>

      {rosterError && (
        <div data-testid="mtm-location-history-roster-error" role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{t("rosterLoadFailed")}: {rosterError}</span>
          <Button data-testid="mtm-location-history-roster-retry" variant="outline" className="min-h-11" onClick={() => void loadRoster()}>{t("retryEmployees")}</Button>
        </div>
      )}

      {historyError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
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
              { icon: Route, label: t("distance"), value: distanceLabel(data.summary.distanceMeters, t("unavailableTruncated")) },
              { icon: LocateFixed, label: t("acceptedPoints"), value: `${data.quality.acceptedPointCount}` },
              { icon: MapPin, label: t("stops"), value: `${data.summary.stopCount}` },
              { icon: CheckCircle2, label: t("visits"), value: `${data.summary.visitCount}` },
              { icon: WifiOff, label: t("gaps"), value: `${data.summary.gapCount}` },
              { icon: Activity, label: t("anomalies"), value: `${data.summary.anomalyCount}` },
            ].map((metric) => (
              <div key={metric.label} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                <metric.icon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                  <div className="text-lg font-semibold tabular-nums">{metric.value}</div>
                </div>
              </div>
            ))}
          </div>

          {(data.quality.rawTruncated || data.quality.downsampled || data.quality.rejectedByAccuracy > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              {data.quality.rawTruncated
                ? t("truncatedWarning")
                : t("qualitySummary", {
                    raw: data.quality.rawPointCount,
                    accepted: data.quality.acceptedPointCount,
                    returned: data.quality.returnedPointCount,
                  })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-card p-2 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("layers")}>
              <span className="mr-1 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"><Layers3 className="h-3.5 w-3.5" />{t("layers")}</span>
              {(Object.keys(layers) as Array<keyof typeof layers>).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  aria-pressed={layers[layer]}
                  onClick={() => setLayers((current) => ({ ...current, [layer]: !current[layer] }))}
                  className={`min-h-11 rounded-md border px-3 py-2 text-xs transition-colors ${layers[layer] ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {t(`layer.${layer}`)}
                </button>
              ))}
            </div>
            <a href={exportUrl} download className="inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">
              <Download className="mr-1.5 h-3.5 w-3.5" />{t("exportCsv")}
            </a>
          </div>

          <section data-testid="mtm-location-history-replay" className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700" aria-labelledby="day-replay-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="day-replay-title" className="flex items-center gap-2 text-sm font-semibold">
                  <Play className="h-4 w-4 text-primary" />{t("replayTitle")}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("replayHint")}</p>
              </div>
              <div className="text-right text-xs" aria-live="polite">
                <div className="font-medium tabular-nums">
                  {playbackPoint ? formatMoment(playbackPoint.recordedAt) : t("noReplayPoints")}
                </div>
                {playbackPoint && (
                  <div className="text-muted-foreground">
                    {t("pointProgress", { current: playbackIndex + 1, total: playbackPointCount })}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-[auto_auto_minmax(180px,1fr)_110px] md:items-center">
              <Button
                data-testid="mtm-location-history-play"
                type="button"
                variant={isPlaying ? "secondary" : "default"}
                className="min-h-11"
                onClick={togglePlayback}
                disabled={playbackPointCount < 2}
              >
                {isPlaying ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
                {isPlaying ? t("pause") : playbackIndex >= playbackLastIndex ? t("replayFromStart") : t("play")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setIsPlaying(false)
                  setPlaybackIndex(0)
                }}
                disabled={!playbackPointCount || playbackIndex === 0}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />{t("restart")}
              </Button>
              <label className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <span className="sr-only">{t("replayPosition")}</span>
                <input
                  type="range"
                  min={0}
                  max={playbackLastIndex}
                  step={1}
                  value={Math.min(playbackIndex, playbackLastIndex)}
                  disabled={playbackPointCount < 2}
                  aria-label={t("replayPosition")}
                  aria-valuetext={playbackPoint ? `${playbackIndex + 1}/${playbackPointCount} · ${formatMoment(playbackPoint.recordedAt)}` : t("noReplayPoints")}
                  onChange={(event) => {
                    setIsPlaying(false)
                    setPlaybackIndex(Number(event.target.value))
                  }}
                  className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                />
              </label>
              <label className="space-y-1 text-xs font-medium">
                <span className="sr-only">{t("playbackRate")}</span>
                <Select
                  className="min-h-11"
                  value={String(playbackRate)}
                  aria-label={t("playbackRate")}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                >
                  {[0.5, 1, 2, 4].map((rate) => <option key={rate} value={rate}>{t("playbackRateValue", { rate })}</option>)}
                </Select>
              </label>
            </div>

            {playbackPoint && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("accuracy")}: {playbackPoint.accuracy == null ? "—" : `${Math.round(playbackPoint.accuracy)} m`}</span>
                <span>{t("battery")}: {playbackPoint.battery == null ? "—" : `${Math.round(playbackPoint.battery)}%`}</span>
                <span>{t("gpsSpeed")}: {playbackPoint.speed == null ? "—" : `${Math.max(0, playbackPoint.speed * 3.6).toFixed(1)} km/h`}</span>
                <span>{playbackPoint.isMoving ? t("moving") : t("stationary")}</span>
              </div>
            )}
          </section>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="h-[56vh] min-h-[420px] overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
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
              />
            </div>

            <aside className="space-y-3">
              {data.capabilities?.workforce !== false ? <section className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />{t("workday")}</h3>
                {data.workday ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">{t("status")}</dt><dd>{t(`workdayStatus.${data.workday.status}`)}</dd>
                    <dt className="text-muted-foreground">{t("workdayStart")}</dt><dd>{formatMoment(data.workday.startedAt)}</dd>
                    <dt className="text-muted-foreground">{t("workdayEnd")}</dt><dd>{data.workday.completedAt ? formatMoment(data.workday.completedAt) : "—"}</dd>
                  </dl>
                ) : <p className="text-xs text-muted-foreground">{t("noWorkday")}</p>}
              </section> : null}

              <section className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">{t("stopDetails")} · {selectedAgent?.name}</h3>
                  <p className="text-xs text-muted-foreground">{t("stopPolicy", { radius: data.policy.stopRadiusMeters, minutes: data.policy.stopMinimumMinutes })}</p>
                </div>
                <div className="max-h-[390px] divide-y overflow-y-auto">
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
                        <span>{t("accuracy")}: {stop.averageAccuracy == null ? "—" : `${stop.averageAccuracy} m`}</span>
                        <span>{t("battery")}: {stop.batteryStart == null ? "—" : stop.batteryStart === stop.batteryEnd ? `${Math.round(stop.batteryStart)}%` : `${Math.round(stop.batteryStart)}–${Math.round(stop.batteryEnd ?? stop.batteryStart)}%`}</span>
                        <span>{stop.connectivity === "ONLINE" ? t("online") : t("offlineGaps")}</span>
                      </div>
                      <div className={`rounded-md px-2 py-1.5 ${stop.visit ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                        {stop.visit
                          ? `${t("confirmedVisit")}: ${stop.visit.customerName}`
                          : t("stopIsNotVisit")}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">{t("timeline")}</h3>
                  <p className="text-xs text-muted-foreground">{t("timelineHint")}</p>
                </div>
                <div className="max-h-[360px] divide-y overflow-y-auto">
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
            </aside>
          </div>

          {data.anomalies.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/10">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />{t("evidenceWarnings")}</h3>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {data.anomalies.slice(0, 30).map((anomaly) => (
                  <div key={anomaly.id} className="rounded-md border bg-background/80 p-2 text-xs">
                    <div className="flex justify-between gap-2"><strong>{t(`anomaly.${anomaly.type}`)}</strong><time className="text-muted-foreground">{formatMoment(anomaly.startedAt, { timeStyle: "short" })}</time></div>
                    <div className="mt-1 text-muted-foreground">
                      {anomaly.type === "IMPOSSIBLE_JUMP" && t("jumpDetail", { distance: anomaly.detail.distanceMeters ?? 0, speed: anomaly.detail.speedKmh ?? 0 })}
                      {anomaly.type === "LOW_ACCURACY" && t("accuracyDetail", { accuracy: anomaly.detail.accuracyMeters ?? 0 })}
                      {anomaly.type === "MISSING_SEGMENT" && t("gapDetail", { minutes: Math.round((anomaly.detail.durationSeconds ?? 0) / 60) })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
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
                  {data.visits.map((visit) => (
                    <tr key={visit.id}>
                      <td className="px-4 py-2.5"><div className="font-medium">{visit.customer.name}</div><div className="text-xs text-muted-foreground">{visit.customer.address || "—"}</div></td>
                      <td className="px-4 py-2.5 tabular-nums">{formatMoment(visit.checkInAt)}{visit.checkOutAt ? ` – ${formatMoment(visit.checkOutAt, { timeStyle: "short" })}` : ""}</td>
                      <td className="px-4 py-2.5">{t(`visitStatuses.${visit.status}`)}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />{t("confirmed")}</span>
                        <div className="mt-1 flex gap-2 text-xs">
                          <Link className="text-primary hover:underline" href={`/mtm/visits?visitId=${visit.id}`}>{t("openVisit")}</Link>
                          <Link className="text-primary hover:underline" href={`/mtm/customers/${visit.customerId}`}>{t("openOrganization")}</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            {t("methodNote", {
              formula: data.policy.distanceFormula,
              accuracy: data.policy.maxAccuracyMeters,
            })} {data.policy.autoTrackingSupported ? t("autoTrackingAvailable") : t("autoTrackingUnavailable")}
          </p>
        </>
      )}
    </div>
  )
}
