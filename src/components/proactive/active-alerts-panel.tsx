"use client"

/**
 * T9 Proactive Service — slice-3 ActiveAlertsPanel.
 *
 * Renders un-dismissed alerts for a specific entity (contact / company /
 * deal) with inline Acknowledge / Dismiss actions.
 *
 * Fetches on mount + every focus event (so when a sales rep returns to
 * the tab the alerts are fresh). No realtime push yet — slice-4 could
 * wire a WebSocket / SSE if alert frequency surfaces a need.
 */
import { useEffect, useState, useCallback, useRef } from "react"
import { AlertCircle, AlertTriangle, Info, CheckCircle2, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

/** Min ms between focus-triggered reloads (architect P1 — prevent
 *  thrashing the API when user alt-tabs rapidly). */
const FOCUS_RELOAD_THROTTLE_MS = 30_000

interface Alert {
  id: string
  triggerType: string
  severity: "critical" | "warning" | "info"
  message: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  dismissedAt: string | null
  createdAt: string
  context: Record<string, unknown>
}

interface Props {
  entityType: "contact" | "company" | "deal"
  entityId: string
}

const SEVERITY_STYLE: Record<Alert["severity"], { icon: typeof AlertCircle; tint: string; iconTint: string }> = {
  critical: {
    icon: AlertCircle,
    tint: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/40",
    iconTint: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    tint: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40",
    iconTint: "text-amber-600 dark:text-amber-400",
  },
  info: {
    icon: Info,
    tint: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/40",
    iconTint: "text-blue-600 dark:text-blue-400",
  },
}

export function ActiveAlertsPanel({ entityType, entityId }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const lastLoadedAt = useRef<number>(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/v1/proactive-alerts?entityType=${entityType}&entityId=${entityId}`,
        { signal },
      )
      const data = await res.json()
      if (res.ok && data.success) {
        setAlerts(data.data.alerts ?? [])
      }
      lastLoadedAt.current = Date.now()
    } catch (e) {
      if ((e as Error).name === "AbortError") return // expected on unmount
      // eslint-disable-next-line no-console
      console.error("[ActiveAlertsPanel] load error:", e)
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    // Refresh on tab focus so the rep sees fresh data when returning.
    // Throttled to once every 30s so rapid alt-tab doesn't pummel the API.
    const onFocus = () => {
      if (Date.now() - lastLoadedAt.current < FOCUS_RELOAD_THROTTLE_MS) return
      load()
    }
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      ac.abort()
    }
  }, [load])

  const action = async (alertId: string, kind: "acknowledge" | "dismiss") => {
    setActing(alertId + ":" + kind)
    try {
      const res = await fetch(`/api/v1/proactive-alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed (${res.status})`)
      }
      if (kind === "dismiss") {
        // Optimistic remove from the local list.
        setAlerts((cur) => cur.filter((a) => a.id !== alertId))
        toast.success("Alert dismissed")
      } else {
        // Mark acknowledged locally.
        setAlerts((cur) =>
          cur.map((a) => (a.id === alertId ? { ...a, acknowledgedAt: new Date().toISOString() } : a)),
        )
        toast.success("Alert acknowledged")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed")
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading alerts…
      </div>
    )
  }

  if (alerts.length === 0) {
    return null // No alerts → render nothing (don't add empty-state noise on detail pages).
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Active alerts</h3>
        <span className="text-xs text-muted-foreground">({alerts.length})</span>
      </div>
      {alerts.map((alert) => {
        const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.info
        const Icon = style.icon
        const ackedKey = acting === alert.id + ":acknowledge"
        const dismissKey = acting === alert.id + ":dismiss"
        return (
          <div
            key={alert.id}
            className={`rounded-md border p-3 ${style.tint} flex items-start gap-3`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${style.iconTint}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide">{alert.severity}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{alert.triggerType.replace(/_/g, " ")}</span>
                {alert.acknowledgedAt && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-400 ml-2">
                    <CheckCircle2 className="h-3 w-3" />
                    Acked
                  </span>
                )}
              </div>
              <p className="text-sm">{alert.message}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!alert.acknowledgedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => action(alert.id, "acknowledge")}
                  disabled={acting !== null}
                >
                  {ackedKey ? <Loader2 className="h-3 w-3 animate-spin" /> : "Acknowledge"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive"
                onClick={() => action(alert.id, "dismiss")}
                disabled={acting !== null}
                title="Dismiss alert"
              >
                {dismissKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
