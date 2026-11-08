"use client"

import { useEffect } from "react"
import { useReportWebVitals } from "next/web-vitals"
import { isReportedVital, WEB_VITALS_URI, type WebVitalName } from "@/lib/telemetry/web-vitals"

type Metric = { id: string; name: string; value: number }

/**
 * Page-load Web Vitals (TTFB, FCP, LCP, CLS, INP) belong to the page the tab
 * was LOADED on — the address the browser fetched, not whatever route the
 * single-page app shows when the number arrives. They are sent once, in one
 * beacon, when the tab is hidden or closed.
 *
 * Module state, not component state, on purpose. Next's useReportWebVitals
 * re-registers its listeners every time the callback's identity changes, and
 * web-vitals hands an already-final value straight to every new listener. The
 * first version passed an inline callback and keyed metrics by the current
 * route: every soft navigation re-reported the load's numbers under the new
 * page (prod, 2026-11-07: one load of «/settings/users» with LCP 5072 ms was
 * logged three more times as «/meetings»). Here the callback is one module
 * function, so it is registered once per page load, and each metric id+value
 * is sent once.
 */
const state: {
  landing: string | null
  pending: Map<string, Metric>
  sent: Set<string>
} = { landing: null, pending: new Map(), sent: new Set() }

export function reportWebVital(metric: Metric): void {
  if (!isReportedVital(metric.name)) return
  if (state.sent.has(`${metric.id}:${metric.value}`)) return
  state.pending.set(metric.name, metric)
}

export function flushWebVitals(): void {
  if (state.pending.size === 0) return
  const metrics: Partial<Record<WebVitalName, number>> = {}
  for (const metric of state.pending.values()) {
    metrics[metric.name as WebVitalName] = metric.value
    state.sent.add(`${metric.id}:${metric.value}`)
  }
  state.pending.clear()
  try {
    const nav = navigator as Navigator & { connection?: { effectiveType?: string }; deviceMemory?: number }
    const body = JSON.stringify({
      route: state.landing ?? window.location.pathname,
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
}

/** Test seam: forget the page load (a real page load starts with fresh module state). */
export function __resetWebVitalsForTests(): void {
  state.landing = null
  state.pending.clear()
  state.sent.clear()
}

/** Renders nothing; costs no request while the page is in use. */
export function WebVitalsReporter() {
  useReportWebVitals(reportWebVital)

  useEffect(() => {
    // The address of the page load — the first mount after it.
    if (state.landing === null) state.landing = window.location.pathname
    const onHidden = () => { if (document.visibilityState === "hidden") flushWebVitals() }
    document.addEventListener("visibilitychange", onHidden)
    window.addEventListener("pagehide", flushWebVitals)
    return () => {
      document.removeEventListener("visibilitychange", onHidden)
      window.removeEventListener("pagehide", flushWebVitals)
    }
  }, [])

  return null
}
