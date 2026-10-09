"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { AlertTriangle, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { actionLabelKey, actionMeta, TONE_CLASSES } from "@/lib/mtm/activity-actions"
import {
  liveMapAgentEventHref,
  liveMapAgentEvents,
  type LiveMapActivityRow,
  type LiveMapAgentEvent,
  type LiveMapAlertGroupRow,
} from "@/lib/mtm/live-map-agent-events"

/** How many events the card shows before «показать ещё». */
const SHOWN_AT_FIRST = 5
/**
 * The journal page asked for. The server picks out the employee's own events
 * (type=FIELD_DAY), so the page counts those and not his photos and visit
 * steps; a day with more than this many is said to be cut, not shown as whole.
 */
const ACTIVITY_LIMIT = 100

type AlertEvent = Extract<LiveMapAgentEvent, { kind: "alert" }>

async function readJson(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal, cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { data?: unknown }
  return body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {}
}

/**
 * «События сегодня» in the selected employee's card: what he did (visits, the
 * shift, the route) and the alerts about him, newest first.
 *
 * The list is his own — read for him, not picked out of the team's feed under
 * the map, which is cut to fifteen rows for everybody. It is asked for when he
 * is selected and again when `refreshKey` changes (he did something), not on
 * every refresh of the map.
 */
export function LiveMapAgentEvents({
  agentId, refreshKey, workdayStartedAt, formatTime, alertText, isEarlierDay,
}: {
  agentId: string
  /** Changes when the employee's row changes in a way that means a new event. */
  refreshKey: string
  /** The shift start the row shows, when it began today — see liveMapAgentEvents. */
  workdayStartedAt: string | null
  formatTime: (value: string) => string
  alertText: (alert: AlertEvent) => string
  /** Was this moment on an earlier day than today, in the organization's time zone? */
  isEarlierDay?: (iso: string) => boolean
}) {
  const tMap = useTranslations("mtmMap")
  const tActivity = useTranslations("mtmActivity")
  const [state, setState] = useState<{ agentId: string; events: LiveMapAgentEvent[]; failed: boolean; cut: boolean } | null>(null)
  // What the read uses besides the question itself. Neither restarts it: the
  // page hands a new function on every render, and the shift's start does not
  // change without the row's state changing — which is in `refreshKey`.
  const isEarlierDayRef = useRef(isEarlierDay)
  const workdayStartedAtRef = useRef(workdayStartedAt)
  useEffect(() => {
    isEarlierDayRef.current = isEarlierDay
    workdayStartedAtRef.current = workdayStartedAt
  }, [isEarlierDay, workdayStartedAt])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const id = encodeURIComponent(agentId)
    void Promise.all([
      readJson(`/api/v1/mtm/activity?agentId=${id}&period=today&type=FIELD_DAY&limit=${ACTIVITY_LIMIT}`, controller.signal),
      readJson(`/api/v1/mtm/alerts?view=groups&agentId=${id}&status=all`, controller.signal),
    ])
      .then(([activity, alerts]) => {
        if (controller.signal.aborted) return
        const logs = Array.isArray(activity.logs) ? activity.logs as LiveMapActivityRow[] : []
        setState({
          agentId,
          failed: false,
          // More of his own events today than one page holds: the earliest are not here.
          cut: typeof activity.total === "number" && activity.total > logs.length,
          events: liveMapAgentEvents({
            agentId,
            activity: logs,
            alerts: Array.isArray(alerts.groups) ? alerts.groups as LiveMapAlertGroupRow[] : [],
            workdayStartedAt: workdayStartedAtRef.current,
            isEarlierDay: (iso) => isEarlierDayRef.current?.(iso) ?? false,
          }),
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        // What was read before stays on screen, with a word that it is not fresh.
        setState((previous) => ({
          agentId,
          failed: true,
          cut: previous?.agentId === agentId ? previous.cut : false,
          events: previous?.agentId === agentId ? previous.events : [],
        }))
      })
    return () => controller.abort()
  }, [agentId, refreshKey])

  const known = state?.agentId === agentId ? state : null
  const events = known?.events ?? []
  const shown = expanded ? events : events.slice(0, SHOWN_AT_FIRST)
  const hidden = events.length - shown.length

  return (
    <div data-testid="live-map-agent-events" className="rounded-md bg-background/80 p-2">
      <div className="mb-1 font-semibold text-foreground">{tMap("events.title")}</div>
      {!known ? (
        <div className="text-muted-foreground">{tMap("events.loading")}</div>
      ) : (
        <>
          {known.failed ? (
            <div role="status" className="mb-1 text-amber-700 dark:text-amber-300" data-testid="live-map-agent-events-failed">{tMap("events.failed")}</div>
          ) : null}
          {events.length === 0 && !known.failed ? (
            <div className="text-muted-foreground" data-testid="live-map-agent-events-empty">{tMap("events.empty")}</div>
          ) : null}
          {shown.length > 0 ? (
            <ol className="space-y-0.5">
              {shown.map((event) => {
                const href = liveMapAgentEventHref(event)
                const meta = event.kind === "action" ? actionMeta(event.action) : null
                const Icon = meta ? meta.icon : AlertTriangle
                const label = event.kind === "action" ? tActivity(actionLabelKey(event.action)) : alertText(event)
                const about = event.kind === "action"
                  ? event.customerName
                  : event.count > 1 ? tMap("feed.repeated", { count: event.count }) : null
                const body = (
                  <>
                    <span className="min-w-10 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(event.at)}</span>
                    <span className={cn(
                      "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      meta ? TONE_CLASSES[meta.tone] : TONE_CLASSES.amber,
                    )}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{label}</span>
                      {about ? <span className="text-muted-foreground"> · {about}</span> : null}
                    </span>
                    {href ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                  </>
                )
                return (
                  <li key={event.id} data-testid="live-map-agent-event" data-event-kind={event.kind}>
                    {href ? (
                      <Link href={href} className="flex min-h-8 items-center gap-2 rounded px-1 hover:bg-muted [@media(pointer:coarse)]:min-h-11">{body}</Link>
                    ) : (
                      <div className="flex min-h-8 items-center gap-2 px-1 [@media(pointer:coarse)]:min-h-11">{body}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          ) : null}
          {hidden > 0 || (expanded && events.length > SHOWN_AT_FIRST) ? (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              data-testid="live-map-agent-events-more"
              className="mt-1 inline-flex min-h-8 items-center font-semibold text-orange-700 underline underline-offset-2 dark:text-primary [@media(pointer:coarse)]:min-h-11"
            >
              {expanded ? tMap("events.fewer") : tMap("events.more", { count: hidden })}
            </button>
          ) : null}
          {known.cut && (expanded || hidden === 0) ? (
            <div className="mt-1 text-muted-foreground" data-testid="live-map-agent-events-cut">{tMap("events.cut", { count: ACTIVITY_LIMIT })}</div>
          ) : null}
        </>
      )}
    </div>
  )
}
