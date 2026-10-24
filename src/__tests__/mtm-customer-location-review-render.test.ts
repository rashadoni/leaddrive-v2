// @vitest-environment jsdom
import { act, createElement, Fragment, useState, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import L from "leaflet"
import { NextIntlClientProvider } from "next-intl"
import { readFileSync } from "node:fs"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const perspective = vi.hoisted(() => {
  // Leaflet caches its browser detection in module-local variables at import.
  const style = document.documentElement.style
  const previous = Object.getOwnPropertyDescriptor(style, "MozPerspective")
  Object.defineProperty(style, "MozPerspective", { value: "", configurable: true })
  return { previous }
})

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/components/hint", () => ({
  Hint: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  HintValue: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}))
vi.mock("@/lib/mtm/basemap-provider-store", () => {
  const provider = { primary: "carto", backup: null }
  return {
    basemapProviderSnapshot: () => provider,
    basemapProviderServerSnapshot: () => provider,
    subscribeBasemapProvider: () => () => {},
    refreshBasemapProvider: async () => {},
  }
})
vi.mock("next/dynamic", () => ({
  default: () => (props: ComponentProps<typeof CustomerLocationRequestMap>) => createElement(CustomerLocationRequestMap, props),
}))

import CustomerLocationRequestMap from "@/components/mtm/customer-location-request-map"
import { MtmCustomerLocationRequestQueue, type CustomerLocationRequestRow } from "@/components/mtm/customer-location-request-queue"

const messages = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>
const svg = Object.getOwnPropertyDescriptor(L.Browser, "svg")!
const zoomCompletion = Object.getOwnPropertyDescriptor(L.Map.prototype, "_onZoomTransitionEnd")!
let container: HTMLDivElement
let root: Root
let rows: CustomerLocationRequestRow[]
let decisions: number
let renderErrors: string[]
function captureError(event: ErrorEvent) {
  renderErrors.push(String(event.error?.message ?? event.message))
  event.preventDefault()
}
const row = (id: string, previous: boolean): CustomerLocationRequestRow => ({
  id, status: "SUBMITTED", submittedAt: "2026-10-23T16:00:00.000Z", comment: null,
  agent: { id: "agent-unit", name: "Test agent" },
  customer: { id: "customer-" + id, name: "Test customer " + id, address: null, city: null },
  previous: previous ? { latitude: 40.41, longitude: 49.87 } : null,
  proposed: { latitude: 40.42, longitude: 49.88 },
  agentFix: { latitude: 40.42, longitude: 49.88, accuracyMeters: 42, at: "2026-10-23T15:59:00.000Z" },
  movedMeters: previous ? 1000 : null, agentToProposedMeters: 0,
  pinMovedSince: false, outOfZoneAlerts: 0, canDecide: true,
})
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function Page() {
  const [loading, setLoading] = useState(false)
  return loading ? createElement("p", null, "Refreshing") : createElement(MtmCustomerLocationRequestQueue, {
    active: true,
    onChanged: async () => {
      // The real routes page sets loading while refreshing its other views.
      setLoading(true)
      await new Promise(resolve => setTimeout(resolve, 0))
      setLoading(false)
    },
  })
}

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function mount() {
  await act(async () => {
    root.render(createElement(IntlProvider, { locale: "ru", timeZone: "Asia/Baku", messages }, createElement(Page)))
  })
  await settle()
  // Let the real mini-map's automatic framing start a browser zoom transition.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(L.Browser, "svg", { ...svg, value: true })
  expect(L.Browser.any3d).toBe(true)
  renderErrors = []
  window.addEventListener("error", captureError)
  // Leaflet's timer uses Node's global timeout in jsdom, so window.error alone
  // misses it. Observe the real callback and turn its exception into a failed
  // assertion, rather than letting the runner report passed tests + unhandled.
  const complete = zoomCompletion.value as (this: L.Map) => void
  Object.defineProperty(L.Map.prototype, "_onZoomTransitionEnd", {
    ...zoomCompletion,
    value: function (this: L.Map) {
      try { complete.call(this) }
      catch (error) { renderErrors.push(error instanceof Error ? error.message : String(error)) }
    },
  })
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(512)
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(256)
  rows = [row("first", false), row("remaining", true)]
  decisions = 0
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/v1/mtm/customer-location-requests") return json({ success: true, data: { requests: rows } })
    if (url === "/api/v1/mtm/customer-location-requests/first/decision" && init?.method === "POST") {
      decisions++
      rows = rows.filter(r => r.id !== "first")
      return json({ success: true, data: { status: "APPROVED" } })
    }
    throw new Error("Unexpected network request in isolated render test")
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Object.defineProperty(L.Browser, "svg", svg)
  Object.defineProperty(L.Map.prototype, "_onZoomTransitionEnd", zoomCompletion)
  window.removeEventListener("error", captureError)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
afterAll(() => {
  const style = document.documentElement.style
  if (perspective.previous) Object.defineProperty(style, "MozPerspective", perspective.previous)
  else Reflect.deleteProperty(style, "MozPerspective")
})

describe("GPS review removes real Leaflet maps and refreshes the queue", () => {
  it.each([false, true])("accepts a point once with last=%s and survives map unmount", async (last) => {
    if (last) rows = [rows[0]]
    await mount()
    expect(container.querySelectorAll(".leaflet-container")).toHaveLength(last ? 1 : 2)
    const accept = container.querySelector<HTMLButtonElement>('[data-testid="mtm-customer-location-accept-first"]')
    expect(accept).not.toBeNull()
    await act(async () => { accept!.click() })
    await settle()
    expect(decisions).toBe(1)
    expect(container.querySelector('[data-testid="mtm-customer-location-request-first"]')).toBeNull()
    expect(container.querySelectorAll(".leaflet-container")).toHaveLength(last ? 0 : 1)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    // Include the delayed map-size callback after the decided card has gone.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    expect(renderErrors).toEqual([])
  })
})
