// @vitest-environment jsdom
/**
 * Owner, 2026-10-30 (Zeytun, live map): «после нажатия на одного сотрудника
 * заново не могу посмотреть всех сотрудников». A press flew the map to the
 * employee; pressing him again cleared the selection but the frame of «all»
 * had not changed, so nothing brought the others back. Now leaving him, or
 * «Все сотрудники» under the map, frames the whole team again.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import type { LiveMapAgent } from "@/lib/mtm-types"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
const leaflet = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }))

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("leaflet/dist/leaflet.css", () => ({}))
vi.mock("@/components/mtm/carto-basemap", () => ({ CartoBasemap: () => null }))
vi.mock("react-leaflet", async () => {
  const { createElement: h } = await import("react")
  const bounds = { pad: () => bounds, getNorth: () => 41, getSouth: () => 40, getWest: () => 49, getEast: () => 50, contains: () => true }
  const record = (name: string) => (value: unknown) => { leaflet.calls.push([name, value]) }
  const map = {
    closePopup: () => {}, getContainer: () => document.createElement("div"), invalidateSize: () => {},
    fitBounds: record("fitBounds"), setView: record("setView"), flyTo: record("flyTo"), panTo: () => {},
    getBounds: () => bounds, getZoom: () => 12, on: () => map, off: () => map,
    doubleClickZoom: { enabled: () => true, disable: () => {}, enable: () => {} },
  }
  const plain = ({ children }: { children?: ReactNode }) => h("div", null, children)
  return {
    MapContainer: plain, Pane: plain, Circle: plain, Polygon: plain, CircleMarker: plain, Polyline: plain, Marker: plain, Tooltip: plain, Popup: plain,
    useMap: () => map, useMapEvents: () => map,
  }
})

import MtmLiveMap from "@/components/mtm/live-map"
import { LiveMapTools } from "@/components/mtm/live-map-tools"

const agent = (agentId: string, latitude: number, longitude: number): LiveMapAgent => ({
  agentId, name: agentId, isOnline: true, latitude, longitude, recordedAt: new Date().toISOString(), freshness: "ONLINE", workdayState: "ACTIVE",
})
// Two invented employees across the city.
const TEAM = [agent("first", 40.37, 49.83), agent("second", 40.41, 49.95)]
let root: Root, container: HTMLDivElement
const draw = async (element: ReactNode) => { await act(async () => { root.render(element) }) }
const drawMap = (focusAgentId: string | null, everyoneTurn = 0) => draw(createElement(MtmLiveMap, { agents: TEAM, focusAgentId, everyoneTurn }))
const framedEveryone = () => leaflet.calls.filter(([name, value]) => name === "fitBounds"
  && JSON.stringify(value).includes("40.37") && JSON.stringify(value).includes("40.41")).length

beforeEach(() => {
  leaflet.calls = []
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  // The map waits for a frame with a size before it mounts Leaflet.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe("back to the whole team on the live map", () => {
  it("frames everyone again when the selected employee is left", async () => {
    await drawMap(null); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const first = framedEveryone()
    expect(first).toBeGreaterThan(0)
    await drawMap("second")
    expect(leaflet.calls.some(([name]) => name === "flyTo")).toBe(true)
    expect(framedEveryone()).toBe(first)
    await drawMap(null)
    expect(framedEveryone()).toBe(first + 1)
  })
  it("frames everyone on «Все сотрудники» even when nobody was selected", async () => {
    await drawMap(null); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const first = framedEveryone()
    await drawMap(null, 1)
    expect(framedEveryone()).toBe(first + 1)
    // Re-rendering with the same turn does not undo the dispatcher's own zoom.
    await drawMap(null, 1)
    expect(framedEveryone()).toBe(first + 1)
  })
  it("puts «Все сотрудники» among the map's tools, in words", async () => {
    const onShowEveryone = vi.fn()
    await draw(createElement(LiveMapTools, {
      near: null, referencePoint: null, onReferencePointChange: () => {}, pickingPoint: false, onPickingPointChange: () => {},
      rulerActive: false, onRulerToggle: () => {}, rulerMeters: 0, rulerPointCount: 0, onRulerUndo: () => {}, formatDistance: String,
      fullscreen: false, onFullscreenToggle: () => {}, fullscreenSupported: false, onShowEveryone,
    }))
    const button = container.querySelector<HTMLButtonElement>('[data-testid="live-map-tool-everyone"]')!
    expect(button.textContent).toBe("Все сотрудники")
    await act(async () => { button.click() })
    expect(onShowEveryone).toHaveBeenCalledOnce()
  })
})
