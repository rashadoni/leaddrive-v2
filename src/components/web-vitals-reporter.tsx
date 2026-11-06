"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useReportWebVitals } from "next/web-vitals"
import { isReportedVital, WEB_VITALS_URI, type WebVitalName } from "@/lib/telemetry/web-vitals"

type Pending = { route: string; metrics: Partial<Record<WebVitalName, number>> }

/**
 * Collects the page's Web Vitals and sends them once, in one beacon, when the
 * user leaves the page (another route, hidden tab, closed tab). Renders
 * nothing; costs no request while the page is in use.
 */
export function WebVitalsReporter() {
  const pathname = usePathname()
  const pending = useRef<Pending>({ route: pathname ?? "/", metrics: {} })

  const flush = useRef(() => {
    const { route, metrics } = pending.current
    if (Object.keys(metrics).length === 0) return
    pending.current = { route, metrics: {} }
    try {
      const nav = navigator as Navigator & { connection?: { effectiveType?: string }; deviceMemory?: number }
      const body = JSON.stringify({
        route,
        metrics,
        conn: nav.connection?.effectiveType,
        mem: nav.deviceMemory,
        cpu: nav.hardwareConcurrency,
      })
      // text/plain: a simple request, no preflight; delivered after unload.
      if (!navigator.sendBeacon?.(WEB_VITALS_URI, new Blob([body], { type: "text/plain" }))) {
        void fetch(WEB_VITALS_URI, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {})
      }
    } catch {
      /* monitoring must never disturb the page */
    }
  })

  useReportWebVitals((metric) => {
    if (!isReportedVital(metric.name)) return
    pending.current.metrics[metric.name] = metric.value
  })

  // A new route: the previous page's numbers are complete.
  useEffect(() => {
    if (pending.current.route === pathname) return
    flush.current()
    pending.current = { route: pathname ?? "/", metrics: {} }
  }, [pathname])

  useEffect(() => {
    const send = flush.current
    const onHidden = () => { if (document.visibilityState === "hidden") send() }
    document.addEventListener("visibilitychange", onHidden)
    window.addEventListener("pagehide", send)
    return () => {
      document.removeEventListener("visibilitychange", onHidden)
      window.removeEventListener("pagehide", send)
    }
  }, [])

  return null
}
