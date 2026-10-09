"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

/** GET /api/v1/mtm/locations/device, as far as the card reads it. */
interface DeviceAnswer {
  notificationsConnected: boolean
  appVersion: string | null
  registeredAt: string | null
}

// The answer also carries a platform. It is not drawn: the registration fills
// it with «android» when the phone names none, so the line would be the
// server's default presented as the phone's own word.
/** Below this the list paints the battery red (live-map-roster.tsx); the card does the same. */
const LOW_BATTERY_PERCENT = 20

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * An answer that does not say whether notifications are connected is not an
 * answer: read as «no», a missing field would accuse a phone that is connected.
 */
function deviceAnswer(data: unknown): DeviceAnswer | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const row = data as Record<string, unknown>
  if (typeof row.notificationsConnected !== "boolean") return null
  return {
    notificationsConnected: row.notificationsConnected,
    appVersion: text(row.appVersion),
    registeredAt: text(row.registeredAt),
  }
}

function Line({ id, label, tone, children }: { id: string; label: string; tone?: string; children: ReactNode }) {
  return (
    <div data-testid={`live-map-device-${id}`}>
      <span className="text-muted-foreground">{label}: </span>
      <span className={cn("font-medium", tone ?? "text-foreground")}>{children}</span>
    </div>
  )
}

/**
 * The «device» block of the selected employee's card: what is known about his
 * phone, and nothing that is not.
 *
 * Most of it the page already holds in his row — when the server last heard
 * from the phone, when the coordinate on the map was taken, how fresh and how
 * exact it is, the battery — and that is on screen at once, with no request.
 * The battery is the one written into that coordinate, not a live reading, so
 * it is shown with the coordinate's time: «12 %» from an hour ago is not the
 * phone's charge now.
 *
 * One small read adds what the row lacks — the application's version, the
 * platform, whether notifications can reach him — each line only when the
 * phone did report it. While that read is on its way, or when it fails, the
 * first group stays as it is.
 *
 * Not here, because no phone reports them to us: the location permission, GPS
 * switched off, battery saver, a mocked location, the OS version, the model.
 */
export function LiveMapAgentDevice({ agent, refreshKey, formatTime }: {
  agent: Pick<MtmDashboardAgent, "agentId" | "isOnline" | "lastSeenAt" | "recordedAt" | "freshness" | "accuracy" | "battery" | "locationState">
  /** Changes when the phone's own facts are to be read again; not on every refresh of the map. */
  refreshKey: string
  /** How a moment is written. The contact may be days old: give one that adds the date when it is not today. */
  formatTime: (iso: string) => string
}) {
  const tMap = useTranslations("mtmMap")
  const agentId = agent.agentId
  const [state, setState] = useState<{ agentId: string; answer: DeviceAnswer | null; failed: boolean } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/v1/mtm/locations/device?agentId=${encodeURIComponent(agentId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json() as { data?: unknown } | null
        const answer = deviceAnswer(body?.data)
        if (!answer) throw new Error("Unreadable answer")
        if (controller.signal.aborted) return
        setState({ agentId, answer, failed: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        // What was read before stays on screen, with a word that it is not fresh.
        setState((previous) => ({ agentId, failed: true, answer: previous?.agentId === agentId ? previous.answer : null }))
      })
    return () => controller.abort()
  }, [agentId, refreshKey])

  const known = state?.agentId === agentId ? state : null
  const reported = known?.answer ?? null
  const clock = (value: string | null | undefined) => (value ? formatTime(value) || null : null)
  const lastContact = clock(agent.lastSeenAt)
  const recorded = clock(agent.recordedAt)
  const registered = clock(reported?.registeredAt)
  const accuracy = typeof agent.accuracy === "number" && Number.isFinite(agent.accuracy) ? Math.round(agent.accuracy) : null
  const battery = typeof agent.battery === "number" && Number.isFinite(agent.battery) ? Math.round(agent.battery) : null

  return (
    <div data-testid="live-map-agent-device" className="space-y-0.5">
      {agent.locationState !== "AVAILABLE" ? (
        <div className="flex items-start gap-1 text-amber-700 dark:text-amber-300" data-testid="live-map-device-location-state">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {tMap(`locationState.${agent.locationState.toLowerCase()}`)}
        </div>
      ) : null}
      <Line id="app" label={tMap("appPresence")} tone={agent.isOnline ? "text-green-600" : "text-muted-foreground"}>
        {tMap(`presence.${agent.isOnline ? "online" : "offline"}`)}
      </Line>
      {lastContact ? <Line id="last-contact" label={tMap("device.lastContact")}>{lastContact}</Line> : null}
      {recorded ? <Line id="recorded" label={tMap("recordedAt")}>{recorded}</Line> : null}
      <Line
        id="freshness"
        label={tMap("gpsFreshness")}
        tone={agent.freshness === "ONLINE" ? "text-blue-600" : agent.freshness === "DELAYED" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}
      >
        {tMap(`freshness.${agent.freshness.toLowerCase()}`)}
      </Line>
      {accuracy !== null ? (
        <Line id="accuracy" label={tMap("device.accuracy")}>±{tMap("distanceUnits.m", { value: accuracy })}</Line>
      ) : null}
      {battery !== null ? (
        <Line id="battery" label={tMap("battery")} tone={battery < LOW_BATTERY_PERCENT ? "text-red-600 dark:text-red-400" : undefined}>
          {battery}%{recorded ? ` · ${tMap("device.asOf", { time: recorded })}` : null}
        </Line>
      ) : null}
      {reported?.appVersion ? (
        // The version is the one the phone named when it last registered; it may have been updated since.
        <Line id="app-version" label={tMap("device.appVersion")}>
          {reported.appVersion}{registered ? ` · ${tMap("device.asOf", { time: registered })}` : null}
        </Line>
      ) : null}
      {reported ? (
        <Line id="notifications" label={tMap("device.notifications")} tone={reported.notificationsConnected ? undefined : "text-amber-700 dark:text-amber-300"}>
          {reported.notificationsConnected ? tMap("device.notificationsOn") : tMap("device.notificationsOff")}
        </Line>
      ) : null}
      {known?.failed ? (
        <div role="status" className="text-amber-700 dark:text-amber-300" data-testid="live-map-device-failed">{tMap("device.failed")}</div>
      ) : null}
    </div>
  )
}
