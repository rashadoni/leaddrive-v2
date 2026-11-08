// @vitest-environment jsdom
/**
 * The page-load numbers go out once, under the page the tab was loaded on.
 *
 * Prod, 2026-11-07: one load of «/settings/users» (FCP 1172, TTFB 634, LCP
 * 5072) was logged again three times as «/meetings» — Next re-registers its
 * listeners whenever the callback changes, web-vitals hands the final values
 * to each new listener, and the first reporter keyed them by the current route.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Metric = { id: string; name: string; value: number }
const registered = vi.hoisted(() => ({ fns: [] as Array<(m: Metric) => void> }))
// The real hook's shape: an effect keyed on the callback, no cleanup.
vi.mock("next/web-vitals", async () => {
  const { useEffect } = await import("react")
  return {
    useReportWebVitals: (fn: (m: Metric) => void) => {
      useEffect(() => { registered.fns.push(fn) }, [fn])
    },
  }
})

import { WebVitalsReporter, __resetWebVitalsForTests } from "@/components/web-vitals-reporter"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const beacons: Array<Record<string, unknown>> = []

beforeEach(async () => {
  __resetWebVitalsForTests()
  registered.fns.length = 0
  beacons.length = 0
  window.history.replaceState(null, "", "/settings/users")
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, blob: Blob) => { void blob.text().then((text) => beacons.push(JSON.parse(text))); return true },
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const hide = async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
  document.dispatchEvent(new Event("visibilitychange"))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
/** What web-vitals does: every registered listener gets the final values. */
const deliver = (metric: Metric) => { for (const fn of registered.fns) fn(metric) }

describe("page-speed beacon", () => {
  it("registers once, however often the shell re-renders", () => {
    act(() => root.render(createElement(WebVitalsReporter)))
    act(() => root.render(createElement(WebVitalsReporter)))
    act(() => root.render(createElement(WebVitalsReporter)))
    expect(new Set(registered.fns).size).toBe(1)
  })

  it("sends the load's numbers once, under the page the tab was loaded on", async () => {
    act(() => root.render(createElement(WebVitalsReporter)))
    deliver({ id: "v1-lcp", name: "LCP", value: 5072 })
    deliver({ id: "v1-ttfb", name: "TTFB", value: 634 })
    deliver({ id: "v1-lcp", name: "LCP", value: 5072 })
    // The person moves on inside the app; the numbers stay the load's.
    window.history.pushState(null, "", "/meetings")
    act(() => root.render(createElement(WebVitalsReporter)))
    await hide()
    expect(beacons).toEqual([expect.objectContaining({ route: "/settings/users", metrics: { LCP: 5072, TTFB: 634 } })])

    // Hidden again with nothing new, or the same values handed over again: nothing more is sent.
    deliver({ id: "v1-lcp", name: "LCP", value: 5072 })
    await hide()
    expect(beacons).toHaveLength(1)

    // A value that did change (interaction later in the page's life) is sent, still under the load's page.
    deliver({ id: "v1-inp", name: "INP", value: 96 })
    await hide()
    expect(beacons[1]).toEqual(expect.objectContaining({ route: "/settings/users", metrics: { INP: 96 } }))
  })

  it("ignores what it does not report", async () => {
    act(() => root.render(createElement(WebVitalsReporter)))
    deliver({ id: "v1-fid", name: "FID", value: 12 })
    await hide()
    expect(beacons).toEqual([])
  })
})
