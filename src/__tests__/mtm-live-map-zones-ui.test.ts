// @vitest-environment jsdom
/**
 * «Свои зоны» of the live map, piece by piece: the small form, the list of
 * zones and the card on the page that holds it, the two buttons among the
 * map's tools, and how the map itself draws a zone.
 *
 * Owner, 2026-10-09, of the tracking product shown as the model: «бери почти
 * всё, чего у нас нет» — there a dispatcher outlines a district, names it, and
 * it stays on the map for everybody. How the pieces work together on the page
 * is in mtm-live-map-page-flow.test.ts; here each is held to its own rules.
 *
 * The Leaflet canvas is not drawn in jsdom, so the map's shapes are stood in
 * for by plain elements that show what they were given. What that still
 * proves is the part that goes wrong silently: which of a zone's two numbers
 * Leaflet is handed first.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

const leaflet = vi.hoisted(() => ({ closedBalloons: 0 }))

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
vi.mock("leaflet/dist/leaflet.css", () => ({}))
vi.mock("@/components/mtm/carto-basemap", () => ({ CartoBasemap: () => null }))
// Every shape says, as attributes, what Leaflet would have been handed; a
// press on it is a press at one known place inside it.
vi.mock("react-leaflet", async () => {
  const { createElement: h } = await import("react")
  const PRESSED = { lat: 40.405, lng: 49.805 }
  const bounds = { pad: () => bounds, getNorth: () => 41, getSouth: () => 40, getWest: () => 49, getEast: () => 50, contains: () => true }
  const map = {
    closePopup: () => { leaflet.closedBalloons += 1 },
    getContainer: () => document.createElement("div"),
    invalidateSize: () => {}, fitBounds: () => {}, setView: () => {}, flyTo: () => {}, panTo: () => {},
    getBounds: () => bounds, getZoom: () => 12,
    doubleClickZoom: { enabled: () => true, disable: () => {}, enable: () => {} },
  }
  type ShapeProps = {
    center?: unknown; radius?: unknown; positions?: unknown; pathOptions?: unknown; bubblingMouseEvents?: boolean
    eventHandlers?: { click?: (event: { latlng: { lat: number; lng: number } }) => void }; children?: ReactNode
  }
  const shape = (kind: string) => function Shape(props: ShapeProps) {
    return h("div", {
      "data-shape": kind,
      "data-center": JSON.stringify(props.center ?? null),
      "data-radius": String(props.radius ?? ""),
      "data-positions": JSON.stringify(props.positions ?? null),
      "data-style": JSON.stringify(props.pathOptions ?? null),
      "data-bubbling": String(props.bubblingMouseEvents),
      onClick: (event: { target: unknown; currentTarget: unknown }) => {
        if (event.target === event.currentTarget) props.eventHandlers?.click?.({ latlng: PRESSED })
      },
    }, props.children)
  }
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => h("div", { "data-testid": "leaflet-map" }, children),
    Pane: ({ name, style, children }: { name: string; style?: { zIndex?: number }; children?: ReactNode }) =>
      h("div", { "data-pane": name, "data-z": String(style?.zIndex ?? "") }, children),
    Circle: shape("circle"), Polygon: shape("polygon"), CircleMarker: shape("disc"), Polyline: shape("line"), Marker: shape("marker"),
    Tooltip: ({ children, permanent }: { children?: ReactNode; permanent?: boolean }) => h("span", { "data-label": permanent ? "permanent" : "hover" }, children),
    Popup: ({ children, pane }: { children?: ReactNode; pane?: string }) => h("div", { "data-balloon": pane ?? "inherited" }, children),
    useMap: () => map,
    useMapEvents: () => map,
  }
})

import MtmLiveMap from "@/components/mtm/live-map"
import { LiveMapTools } from "@/components/mtm/live-map-tools"
import { LiveMapZoneForm, LiveMapZoneGone, liveMapZoneFormChange, type LiveMapZoneFormBlock, type LiveMapZoneFormTask, type LiveMapZoneFormValues } from "@/components/mtm/live-map-zone-form"
import { LiveMapZoneList } from "@/components/mtm/live-map-zone-list"
import { LiveMapZonesCard } from "@/components/mtm/live-map-zones-card"
import { MTM_AGENT_MAP_COLOR_KEYS, MTM_AGENT_MAP_COLORS } from "@/lib/mtm/agent-tags"
import {
  LIVE_MAP_ZONE_DEFAULT_HEX,
  type LiveMapZone,
  type LiveMapZoneChange,
  type LiveMapZoneOutlineProblem,
  type LiveMapZoneWriteProblem,
} from "@/lib/mtm/live-map-zones"

// Invented shapes: a circle a kilometre and a half wide, and a block a hundredth of a degree a side.
const CENTRE: LiveMapZone = { id: "zone-centre", name: "Центр", color: "teal", kind: "CIRCLE", center: { latitude: 40.4, longitude: 49.85 }, radiusMeters: 1500 }
const NORTH: LiveMapZone = {
  id: "zone-north", name: "Северный участок", color: null, kind: "POLYGON",
  outline: [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.4, longitude: 49.81 }, { latitude: 40.41, longitude: 49.81 }, { latitude: 40.41, longitude: 49.8 }],
}

let root: Root
let container: HTMLDivElement
const byTestId = (testId: string, within: ParentNode = container) => within.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const draw = async (element: ReactNode) => { await act(async () => { root.render(element) }) }
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const press = async (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error("element not found")
  await act(async () => { element.click() })
  await settle()
}
const type = async (testId: string, value: string, within: ParentNode = container) => {
  const input = byTestId(testId, within) as HTMLInputElement | null
  if (!input) throw new Error(`no field ${testId}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  leaflet.closedBalloons = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the small form of a zone", () => {
  let sent: LiveMapZoneFormValues[]
  let cancelled: number
  /** What the server will answer; a function so a case can make it wait. */
  let answer: () => Promise<LiveMapZoneWriteProblem | null>
  const drawForm = (task: LiveMapZoneFormTask) => draw(createElement(LiveMapZoneForm, {
    task,
    onSubmit: (values: LiveMapZoneFormValues) => { sent.push(values); return answer() },
    onCancel: () => { cancelled += 1 },
  }))
  const fields = () => ({
    name: byTestId("live-map-zone-name") != null,
    radius: byTestId("live-map-zone-radius") != null,
    colors: byTestId("live-map-zone-colors") != null,
  })

  beforeEach(() => {
    sent = []
    cancelled = 0
    answer = async () => null
  })

  it("asks only for what cannot be pressed on a map: a name, a colour — and a radius for a circle", async () => {
    await drawForm({ kind: "outline" })
    expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Новая зона по контуру линейки")
    expect(fields()).toEqual({ name: true, radius: false, colors: true })
    await drawForm({ kind: "circle" })
    expect(fields()).toEqual({ name: true, radius: true, colors: true })
    expect(byTestId("live-map-zone-save")?.textContent).toBe("Сохранить")
  })

  it("opens a change with what the zone has now, and asks for nothing the change does not touch", async () => {
    await drawForm({ kind: "rename", zone: CENTRE })
    expect(fields()).toEqual({ name: true, radius: false, colors: false })
    expect((byTestId("live-map-zone-name") as HTMLInputElement).value).toBe("Центр")
    act(() => root.unmount())
    root = createRoot(container)
    await drawForm({ kind: "color", zone: CENTRE })
    expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Цвет зоны «Центр»")
    expect(fields()).toEqual({ name: false, radius: false, colors: true })
    expect(MTM_AGENT_MAP_COLOR_KEYS.filter((key) => byTestId(`live-map-zone-color-${key}`)?.getAttribute("aria-pressed") === "true")).toEqual(["teal"])
    expect(byTestId("live-map-zone-color-none")?.getAttribute("aria-pressed")).toBe("false")
  })

  it("names every colour it offers, in words: eight of the palette and «Без цвета»", async () => {
    await drawForm({ kind: "outline" })
    const swatches = MTM_AGENT_MAP_COLOR_KEYS.map((key) => byTestId(`live-map-zone-color-${key}`)!)
    expect(swatches.map((swatch) => swatch.getAttribute("aria-label")))
      .toEqual(["Розовый", "Фуксия", "Фиолетовый", "Тёмно-синий", "Голубой", "Бирюзовый", "Салатовый", "Чёрный"])
    expect(swatches.map((swatch) => swatch.getAttribute("title"))).toEqual(swatches.map((swatch) => swatch.getAttribute("aria-label")))
    // The swatch is painted from the palette in the code, by key.
    expect(swatches[5].style.backgroundColor).toBe("rgb(13, 148, 136)")
    // A new zone starts with no colour chosen, and that choice has its own words.
    expect(byTestId("live-map-zone-color-none")?.textContent).toBe("Без цвета")
    expect(byTestId("live-map-zone-color-none")?.getAttribute("aria-pressed")).toBe("true")
    expect(byTestId("live-map-zone-color-name")).toBeNull()
    await press(byTestId("live-map-zone-color-navy"))
    // The choice is said beside the swatches as well: a swatch alone does not name itself.
    expect(byTestId("live-map-zone-color-name")?.textContent).toBe("Тёмно-синий")
    expect(byTestId("live-map-zone-color-none")?.getAttribute("aria-pressed")).toBe("false")
  })

  it("hands over a tidied name, the colour's key and whole metres — on «Сохранить» and on Enter alike", async () => {
    await drawForm({ kind: "circle" })
    await type("live-map-zone-name", "  Центр  ")
    await type("live-map-zone-radius", "1500")
    await press(byTestId("live-map-zone-color-pink"))
    await press(byTestId("live-map-zone-save"))
    expect(sent).toEqual([{ name: "Центр", color: "pink", radiusMeters: 1500 }])
    // Enter in the name field submits the form it is in.
    await act(async () => { (byTestId("live-map-zone-form") as HTMLFormElement).requestSubmit() })
    await settle()
    expect(sent).toHaveLength(2)
  })

  it("sends nothing without a name, or with a radius the server would not keep, and says which", async () => {
    await drawForm({ kind: "circle" })
    await press(byTestId("live-map-zone-save"))
    expect(byTestId("live-map-zone-notice")?.textContent).toBe("Введите название зоны")
    await type("live-map-zone-name", "   ")
    await press(byTestId("live-map-zone-save"))
    expect(byTestId("live-map-zone-notice")?.textContent).toBe("Введите название зоны")
    await type("live-map-zone-name", "Центр")
    for (const radius of ["24", "100001", "", "12.5"]) {
      await type("live-map-zone-radius", radius)
      await press(byTestId("live-map-zone-save"))
      expect(byTestId("live-map-zone-notice")?.textContent?.replace(/\s/g, " "), radius).toBe("Радиус — целое число от 25 до 100 000 метров")
    }
    expect(sent).toEqual([])
    // The range is said before anything goes wrong, too.
    expect(byTestId("live-map-zone-radius-range")?.textContent?.replace(/\s/g, " ")).toBe("от 25 до 100 000 метров")
    // A name longer than the server keeps cannot be typed.
    expect((byTestId("live-map-zone-name") as HTMLInputElement).maxLength).toBe(120)
  })

  it("waits for the server with the button saying so, and a second press sends nothing more", async () => {
    let release: (value: LiveMapZoneWriteProblem | null) => void = () => {}
    answer = () => new Promise((resolve) => { release = resolve })
    await drawForm({ kind: "outline" })
    await type("live-map-zone-name", "Центр")
    await press(byTestId("live-map-zone-save"))
    const save = byTestId("live-map-zone-save") as HTMLButtonElement
    expect([save.textContent, save.disabled, (byTestId("live-map-zone-cancel") as HTMLButtonElement).disabled]).toEqual(["Сохраняю…", true, true])
    await press(save)
    await act(async () => { (byTestId("live-map-zone-form") as HTMLFormElement).requestSubmit() })
    expect(sent).toHaveLength(1)
    // Refused: the form stays, says why, and can be sent again.
    await act(async () => { release("busy") })
    await settle()
    expect(byTestId("live-map-zone-notice")?.textContent).toBe("Слишком много изменений подряд. Подождите минуту.")
    expect([save.textContent, save.disabled]).toEqual(["Сохранить", false])
    answer = async () => null
    await press(save)
    expect(sent).toHaveLength(2)
    expect(byTestId("live-map-zone-notice")).toBeNull()
  })

  it("says every refusal of the server in plain words", async () => {
    await drawForm({ kind: "rename", zone: CENTRE })
    const words: Record<LiveMapZoneWriteProblem, string> = {
      invalid: "Сервер не принял зону: проверьте название и очертания.",
      limit: "В организации уже 500 зон — больше сохранить нельзя. Удалите ненужную.",
      readOnly: "У вас нет права менять зоны",
      gone: "Этой зоны уже нет: её удалил кто-то другой",
      busy: "Слишком много изменений подряд. Подождите минуту.",
      session: "Вход устарел. Обновите страницу и войдите снова.",
      network: "Нет связи с сервером. Попробуйте ещё раз.",
      failed: "Не получилось. Попробуйте ещё раз.",
    }
    for (const [problem, text] of Object.entries(words) as Array<[LiveMapZoneWriteProblem, string]>) {
      answer = async () => problem
      await press(byTestId("live-map-zone-save"))
      const notice = byTestId("live-map-zone-notice")
      expect([notice?.getAttribute("role"), notice?.textContent], problem).toEqual(["alert", text])
    }
  })

  it("asks in words before a zone goes, and is called off by «Отмена» or Escape", async () => {
    await drawForm({ kind: "delete", zone: CENTRE })
    expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Удалить зону «Центр»?")
    expect(byTestId("live-map-zone-form")?.textContent).toContain("Она исчезнет с карты у всех в организации.")
    expect(fields()).toEqual({ name: false, radius: false, colors: false })
    expect(byTestId("live-map-zone-save")?.textContent).toBe("Удалить")
    await press(byTestId("live-map-zone-cancel"))
    await act(async () => { byTestId("live-map-zone-form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect([cancelled, sent.length]).toEqual([2, 0])
    await press(byTestId("live-map-zone-save"))
    expect(sent).toHaveLength(1)
  })

  it("told that it has nothing it could keep, stays with everything typed, says why, and sends nothing — by the button or by Enter", async () => {
    let mended = 0
    const drawBlocked = (blocked: LiveMapZoneFormBlock | null) => draw(createElement(LiveMapZoneForm, {
      task: { kind: "outline" },
      blocked,
      onSubmit: (values: LiveMapZoneFormValues) => { sent.push(values); return answer() },
      onCancel: () => { cancelled += 1 },
    }))
    await drawBlocked(null)
    await type("live-map-zone-name", "Центр")
    await press(byTestId("live-map-zone-color-teal"))
    expect(byTestId("live-map-zone-blocked")).toBeNull()

    await drawBlocked({ text: "Линия пересекает сама себя.", actionLabel: "Убрать последнюю", onAction: () => { mended += 1 } })
    // The same form: what was typed and chosen is still in it.
    expect((byTestId("live-map-zone-name") as HTMLInputElement).value).toBe("Центр")
    expect(byTestId("live-map-zone-color-teal")?.getAttribute("aria-pressed")).toBe("true")
    const blocked = byTestId("live-map-zone-blocked")!
    expect([blocked.getAttribute("role"), blocked.querySelector("span")?.textContent]).toEqual(["status", "Линия пересекает сама себя."])
    const save = byTestId("live-map-zone-save") as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await press(save)
    await act(async () => { (byTestId("live-map-zone-form") as HTMLFormElement).requestSubmit() })
    await settle()
    expect(sent).toEqual([])
    // The one press that mends it is offered beside the reason.
    expect(byTestId("live-map-zone-blocked-action")?.textContent).toBe("Убрать последнюю")
    await press(byTestId("live-map-zone-blocked-action"))
    expect(mended).toBe(1)
    // A reason nothing here can mend is words only.
    await drawBlocked({ text: "Нужны хотя бы три точки." })
    expect(byTestId("live-map-zone-blocked-action")).toBeNull()
    // «Отмена» is still the way out.
    expect((byTestId("live-map-zone-cancel") as HTMLButtonElement).disabled).toBe(false)

    // Mended: the form goes on from where it was.
    await drawBlocked(null)
    expect(byTestId("live-map-zone-blocked")).toBeNull()
    expect(save.disabled).toBe(false)
    await press(save)
    expect(sent).toEqual([{ name: "Центр", color: "teal", radiusMeters: 500 }])
  })

  it("says where a form stood that its zone is gone, in words, until it is closed", async () => {
    let closed = 0
    await draw(createElement(LiveMapZoneGone, { onClose: () => { closed += 1 } }))
    const gone = byTestId("live-map-zone-gone")!
    expect([gone.getAttribute("role"), gone.querySelector("span")?.textContent]).toEqual(["status", "Этой зоны уже нет: её удалил кто-то другой"])
    expect(byTestId("live-map-zone-gone-close")?.textContent).toBe("Закрыть")
    await press(byTestId("live-map-zone-gone-close"))
    expect(closed).toBe(1)
  })

  it("turns a filled-in form into the one change it was opened for", () => {
    const values: LiveMapZoneFormValues = { name: "Аэропорт", color: "navy", radiusMeters: 500 }
    expect(liveMapZoneFormChange("rename", values)).toEqual({ kind: "rename", name: "Аэропорт" })
    expect(liveMapZoneFormChange("color", values)).toEqual({ kind: "color", color: "navy" })
    expect(liveMapZoneFormChange("color", { ...values, color: null })).toEqual({ kind: "color", color: null })
    expect(liveMapZoneFormChange("delete", values)).toEqual({ kind: "delete" })
  })
})

describe("the list of zones", () => {
  let changes: Array<{ zoneId: string; change: LiveMapZoneChange }>
  let answer: LiveMapZoneWriteProblem | null
  /** The zones «На карте» was pressed for, in the order of the presses. */
  let shown: string[]
  const drawList = (zones: LiveMapZone[], canWrite: boolean) => draw(createElement(LiveMapZoneList, {
    zones, canWrite,
    formatArea: (squareMeters: number) => `${Math.round(squareMeters / 10_000)} га`,
    onChange: async (zone: LiveMapZone, change: LiveMapZoneChange) => { changes.push({ zoneId: zone.id, change }); return answer },
    onShowOnMap: (zone: LiveMapZone) => { shown.push(zone.id) },
  }))
  const rows = () => [...container.querySelectorAll('[data-testid^="live-map-zone-row-zone-"]')] as HTMLElement[]

  beforeEach(() => {
    changes = []
    answer = null
    shown = []
  })

  it("says what each zone is called and how much it covers, in the order it was given", async () => {
    await drawList([NORTH, CENTRE], true)
    expect(rows().map((row) => [byTestId("live-map-zone-row-name", row)?.textContent, byTestId("live-map-zone-row-area", row)?.textContent]))
      .toEqual([["Северный участок", "94 га"], ["Центр", "707 га"]])
    // Each row carries its zone's colour as the map draws it: the key's hex, or the one for «no colour».
    const dot = (row: HTMLElement) => (row.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor
    expect(rows().map(dot)).toEqual(["rgb(154, 52, 18)", "rgb(13, 148, 136)"])
    // No frame with a scrollbar of its own, and no height it may not outgrow: the page scrolls, the list does not.
    expect(byTestId("live-map-zone-list")?.outerHTML).not.toMatch(/overflow-|max-h-/)
  })

  it("offers «На карте» and the three changes in words to somebody who may make them, on every row", async () => {
    await drawList([NORTH, CENTRE], true)
    for (const row of rows()) {
      expect([...row.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["На карте", "Переименовать", "Цвет", "Удалить"])
    }
    // The words are the same on every row; read aloud, each also says which zone it is about.
    expect([...rows()[1].querySelectorAll("button")].map((button) => button.getAttribute("aria-label")))
      .toEqual(["На карте: Центр", "Переименовать: Центр", "Цвет: Центр", "Удалить: Центр"])
    expect(byTestId("live-map-zone-read-only")).toBeNull()
  })

  it("shows a reader every zone with «На карте» and no other button, and says who can change them", async () => {
    await drawList([NORTH, CENTRE], false)
    expect(rows()).toHaveLength(2)
    // Looking at a zone changes nothing, so it is everybody's; the three changes are not his.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["На карте", "На карте"])
    expect(byTestId("live-map-zone-read-only")?.textContent).toBe("Рисовать и менять зоны могут администратор и менеджер.")
    await press(byTestId("live-map-zone-show-zone-centre"))
    expect(shown).toEqual(["zone-centre"])
    expect(changes).toEqual([])
  })

  it("«На карте» names the zone of its own row, every time it is pressed — and opens no form", async () => {
    await drawList([NORTH, CENTRE], true)
    await press(byTestId("live-map-zone-show-zone-centre"))
    // The same zone again — the map was moved away meanwhile — is asked for again.
    await press(byTestId("live-map-zone-show-zone-centre"))
    await press(byTestId("live-map-zone-show-zone-north"))
    expect(shown).toEqual(["zone-centre", "zone-centre", "zone-north"])
    expect(byTestId("live-map-zone-form")).toBeNull()
    expect(changes).toEqual([])
  })

  it("makes a change in the zone's own row and keeps the form until the server has kept the change", async () => {
    await drawList([NORTH, CENTRE], true)
    await press(byTestId("live-map-zone-rename-zone-centre"))
    // The form is in that row and in no other; the row's buttons step aside for it.
    expect(container.querySelectorAll('[data-testid="live-map-zone-form"]')).toHaveLength(1)
    const row = () => byTestId("live-map-zone-row-zone-centre")!
    expect(byTestId("live-map-zone-form", row())?.getAttribute("data-task")).toBe("rename")
    expect(byTestId("live-map-zone-rename-zone-centre")).toBeNull()
    expect(byTestId("live-map-zone-rename-zone-north")).not.toBeNull()
    await type("live-map-zone-name", "Старый город", row())
    answer = "readOnly"
    await press(byTestId("live-map-zone-save", row()))
    expect(changes).toEqual([{ zoneId: "zone-centre", change: { kind: "rename", name: "Старый город" } }])
    expect(byTestId("live-map-zone-notice", row())?.textContent).toBe("У вас нет права менять зоны")
    answer = null
    await press(byTestId("live-map-zone-save", row()))
    expect(changes).toHaveLength(2)
    expect(container.querySelector('[data-testid="live-map-zone-form"]')).toBeNull()
    expect(byTestId("live-map-zone-rename-zone-centre")).not.toBeNull()
  })

  it("removes only after the question has been answered, and «Отмена» removes nothing", async () => {
    await drawList([NORTH, CENTRE], true)
    await press(byTestId("live-map-zone-remove-zone-north"))
    expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Удалить зону «Северный участок»?")
    expect(changes).toEqual([])
    await press(byTestId("live-map-zone-cancel"))
    expect(changes).toEqual([])
    await press(byTestId("live-map-zone-remove-zone-north"))
    await press(byTestId("live-map-zone-save"))
    expect(changes).toEqual([{ zoneId: "zone-north", change: { kind: "delete" } }])
  })

  it("does not carry what was typed for one change into another", async () => {
    await drawList([CENTRE], true)
    await press(byTestId("live-map-zone-rename-zone-centre"))
    await type("live-map-zone-name", "Не то")
    await press(byTestId("live-map-zone-cancel"))
    await press(byTestId("live-map-zone-rename-zone-centre"))
    expect((byTestId("live-map-zone-name") as HTMLInputElement).value).toBe("Центр")
  })

  it("with no zones yet tells a manager how to draw the first one, and a reader who draws them", async () => {
    await drawList([], true)
    expect(byTestId("live-map-zone-empty")?.textContent)
      .toBe("Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки».")
    await drawList([], false)
    expect(byTestId("live-map-zone-empty")?.textContent).toBe("Зон пока нет. Рисовать и менять зоны могут администратор и менеджер.")
  })
})

describe("the card «Свои зоны» on the page", () => {
  // A dozen invented districts, each a circle a little bigger than the one before.
  const DISTRICTS = ["Аэропорт", "Бинагади", "Насими", "Порт", "Сабунчу", "Северный участок", "Старый город", "Сумгаит", "Сураханы", "Хырдалан", "Центр", "Ясамал"]
  const dozen: LiveMapZone[] = DISTRICTS.map((name, index) => ({
    id: `zone-${index + 1}`, name, color: index % 2 ? "teal" : null, kind: "CIRCLE",
    center: { latitude: 40.3 + index * 0.01, longitude: 49.8 }, radiusMeters: 300 + index * 100,
  }))
  let state: { zones: LiveMapZone[]; canWrite: boolean; unfolded: boolean; gone: boolean }
  let changes: Array<{ zoneId: string; change: LiveMapZoneChange }>
  let answer: LiveMapZoneWriteProblem | null
  let shown: string[]
  // The page keeps whether the card is unfolded and whether «gone» is being said; the card reports the presses.
  const drawCard = () => draw(createElement(LiveMapZonesCard, {
    zones: state.zones, canWrite: state.canWrite,
    unfolded: state.unfolded,
    onUnfoldedChange: (unfolded: boolean) => { state.unfolded = unfolded },
    gone: state.gone,
    onGoneClose: () => { state.gone = false },
    formatArea: (squareMeters: number) => `${Math.round(squareMeters / 10_000)} га`,
    onChange: async (zone: LiveMapZone, change: LiveMapZoneChange) => { changes.push({ zoneId: zone.id, change }); return answer },
    onShowOnMap: (zone: LiveMapZone) => { shown.push(zone.id) },
  }))
  const pressAndDraw = async (element: Element | null | undefined) => { await press(element); await drawCard() }
  const card = () => byTestId("live-map-zones-card")!
  const fold = () => byTestId("live-map-zones-card-fold") as HTMLButtonElement | null
  const rows = () => [...card().querySelectorAll('[data-testid^="live-map-zone-row-zone-"]')] as HTMLElement[]

  beforeEach(() => {
    state = { zones: [NORTH, CENTRE], canWrite: true, unfolded: false, gone: false }
    changes = []
    answer = null
    shown = []
  })

  it("folded, says how many zones there are and lists none: the employees' list under it is what the page is for", async () => {
    await drawCard()
    expect(byTestId("live-map-zones-card-title")?.textContent).toBe("Свои зоны · 2")
    // The card is named by its heading for whoever does not see it.
    expect(card().getAttribute("aria-labelledby")).toBe(byTestId("live-map-zones-card-title")?.id)
    expect(rows()).toEqual([])
    expect(byTestId("live-map-zone-list")).toBeNull()
    // The way in is a button that says in words what it does.
    expect([fold()?.textContent, fold()?.getAttribute("aria-expanded")]).toEqual(["Показать список", "false"])
    expect(card().querySelectorAll("button")).toHaveLength(1)
    state.zones = dozen
    await drawCard()
    expect(byTestId("live-map-zones-card-title")?.textContent).toBe("Свои зоны · 12")
  })

  it("unfolds on «Показать список» and folds again on «Свернуть список»", async () => {
    await drawCard()
    await pressAndDraw(fold())
    expect(state.unfolded).toBe(true)
    expect([fold()?.textContent, fold()?.getAttribute("aria-expanded")]).toEqual(["Свернуть список", "true"])
    // What the button says it opens is what it points at.
    expect(card().querySelector(`#${fold()!.getAttribute("aria-controls")}`)?.contains(rows()[0])).toBe(true)
    expect(rows().map((row) => [byTestId("live-map-zone-row-name", row)?.textContent, byTestId("live-map-zone-row-area", row)?.textContent]))
      .toEqual([["Северный участок", "94 га"], ["Центр", "707 га"]])
    await pressAndDraw(fold())
    expect(state.unfolded).toBe(false)
    expect(rows()).toEqual([])
    expect(byTestId("live-map-zones-card-title")?.textContent).toBe("Свои зоны · 2")
  })

  it("unfolded, is as long as its zones are many: no height of its own, nothing cut off, no scrollbar inside the page", async () => {
    state.zones = dozen
    state.unfolded = true
    await drawCard()
    expect(rows()).toHaveLength(12)
    // Nothing in the card may scroll or be clipped: neither the card, nor the list, nor a row.
    for (const element of [card(), ...card().querySelectorAll<HTMLElement>("*")]) {
      expect(element.getAttribute("class") ?? "", element.getAttribute("data-testid") ?? element.tagName).not.toMatch(/overflow-|max-h-|truncate|line-clamp/)
    }
    // A long name is broken onto the next line, not cut.
    expect(byTestId("live-map-zone-row-name", rows()[0])?.className).toContain("break-words")
    // Every button says in words what it does: none is an icon alone.
    for (const button of card().querySelectorAll("button")) expect(button.textContent?.trim().length, button.outerHTML).toBeGreaterThan(3)
    // A finger gets a target of 44 px on every one of them.
    for (const button of card().querySelectorAll("button")) expect(button.className, button.textContent ?? "").toContain("[@media(pointer:coarse)]:min-h-11")
  })

  it("makes the three changes from a row exactly as the list does, with the form opening in the row", async () => {
    state.unfolded = true
    await drawCard()
    await pressAndDraw(byTestId("live-map-zone-rename-zone-centre"))
    const row = () => byTestId("live-map-zone-row-zone-centre")!
    expect(byTestId("live-map-zone-form", row())?.getAttribute("data-task")).toBe("rename")
    await type("live-map-zone-name", "Старый город", row())
    answer = "busy"
    await pressAndDraw(byTestId("live-map-zone-save", row()))
    // Refused: the form stays in the row and says why.
    expect(byTestId("live-map-zone-notice", row())?.textContent).toBe("Слишком много изменений подряд. Подождите минуту.")
    answer = null
    await pressAndDraw(byTestId("live-map-zone-save", row()))
    await pressAndDraw(byTestId("live-map-zone-recolor-zone-north"))
    await pressAndDraw(byTestId("live-map-zone-color-pink"))
    await pressAndDraw(byTestId("live-map-zone-save"))
    await pressAndDraw(byTestId("live-map-zone-remove-zone-north"))
    expect(byTestId("live-map-zone-form-title")?.textContent).toBe("Удалить зону «Северный участок»?")
    await pressAndDraw(byTestId("live-map-zone-save"))
    expect(changes).toEqual([
      { zoneId: "zone-centre", change: { kind: "rename", name: "Старый город" } },
      { zoneId: "zone-centre", change: { kind: "rename", name: "Старый город" } },
      { zoneId: "zone-north", change: { kind: "color", color: "pink" } },
      { zoneId: "zone-north", change: { kind: "delete" } },
    ])
    expect(card().querySelector('[data-testid="live-map-zone-form"]')).toBeNull()
    // «На карте» from the card is the row's own zone.
    await pressAndDraw(byTestId("live-map-zone-show-zone-centre"))
    expect(shown).toEqual(["zone-centre"])
  })

  it("shows a reader the rows, «На карте» on each and who can change them — and nothing that changes a zone", async () => {
    state.canWrite = false
    state.unfolded = true
    await drawCard()
    expect(rows()).toHaveLength(2)
    expect([...card().querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Свернуть список", "На карте", "На карте"])
    expect(byTestId("live-map-zone-read-only")?.textContent).toBe("Рисовать и менять зоны могут администратор и менеджер.")
  })

  it("with no zones has nothing to fold: how to draw the first one is said at once, in the words on the buttons", async () => {
    state.zones = []
    await drawCard()
    expect(byTestId("live-map-zones-card-title")?.textContent).toBe("Свои зоны · 0")
    expect(fold()).toBeNull()
    expect(byTestId("live-map-zone-empty")?.textContent)
      .toBe("Зон пока нет. Чтобы нарисовать первую: «Линейка» → «Сохранить как зону» или «Адрес или точка» → «Зона вокруг точки».")
    state.canWrite = false
    await drawCard()
    expect(byTestId("live-map-zone-empty")?.textContent).toBe("Зон пока нет. Рисовать и менять зоны могут администратор и менеджер.")
    expect(card().querySelector("button")).toBeNull()
  })

  it("says above the list that a zone asked about from a row is gone, until that is closed", async () => {
    state.unfolded = true
    state.gone = true
    await drawCard()
    const gone = byTestId("live-map-zone-gone")!
    expect(card().contains(gone)).toBe(true)
    expect(gone.querySelector("span")?.textContent).toBe("Этой зоны уже нет: её удалил кто-то другой")
    // Above the list: read before the rows that are left.
    expect(gone.compareDocumentPosition(byTestId("live-map-zone-list")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await pressAndDraw(byTestId("live-map-zone-gone-close"))
    expect([state.gone, byTestId("live-map-zone-gone")]).toEqual([false, null])
    // The last zone was the one that went: the words stand above «Зон пока нет».
    state.zones = []
    state.gone = true
    await drawCard()
    expect(byTestId("live-map-zone-gone")!.compareDocumentPosition(byTestId("live-map-zone-empty")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe("the two zone buttons among the map's tools", () => {
  /** `outlineProblem` is what the page says of the ruler's points: null — they can be a zone as they stand. */
  let state: { point: { latitude: number; longitude: number; label: string } | null; ruler: boolean; outlineProblem: LiveMapZoneOutlineProblem | null; mayDraw: boolean; editor: ReactNode }
  let created: Array<{ kind: string; values: LiveMapZoneFormValues }>
  let answer: LiveMapZoneWriteProblem | null
  let undone: number
  const drawTools = () => draw(createElement(LiveMapTools, {
    near: null,
    referencePoint: state.point,
    onReferencePointChange: (point) => { state.point = point },
    pickingPoint: false,
    onPickingPointChange: () => {},
    rulerActive: state.ruler,
    onRulerToggle: () => { state.ruler = !state.ruler },
    rulerMeters: 0,
    rulerPointCount: state.outlineProblem === "tooFew" ? 2 : 4,
    onRulerUndo: () => { undone += 1 },
    formatDistance: (meters: number) => `${Math.round(meters)} м`,
    rulerArea: state.outlineProblem === null ? "53,9 га" : null,
    fullscreen: false,
    onFullscreenToggle: () => {},
    fullscreenSupported: false,
    zoneDrawing: state.mayDraw
      ? { outlineProblem: state.outlineProblem, onCreate: async (kind: "outline" | "circle", values: LiveMapZoneFormValues) => { created.push({ kind, values }); return answer } }
      : null,
    zoneEditor: state.editor,
  }))
  const pressAndDraw = async (element: Element | null | undefined) => { await press(element); await drawTools() }

  beforeEach(() => {
    state = { point: null, ruler: true, outlineProblem: null, mayDraw: true, editor: null }
    created = []
    answer = null
    undone = 0
  })

  it("offers «Сохранить как зону» in the ruler's own line once the outline can be a zone — and only to somebody who may draw", async () => {
    state.outlineProblem = "tooFew"
    await drawTools()
    expect(byTestId("live-map-ruler-save-zone")).toBeNull()
    state.outlineProblem = null
    await drawTools()
    expect(byTestId("live-map-ruler-save-zone", byTestId("live-map-ruler")!)?.textContent).toBe("Сохранить как зону")
    state.mayDraw = false
    await drawTools()
    expect(byTestId("live-map-ruler-save-zone")).toBeNull()
    // The ruler itself is what it was for everybody.
    expect(byTestId("live-map-ruler-area")?.textContent).toBe("Площадь внутри: 53,9 га")
  })

  it("says in the ruler's own line why what is outlined cannot be saved as a zone, instead of the button simply not being there", async () => {
    const said = () => byTestId("live-map-ruler-outline-problem", byTestId("live-map-ruler")!)?.textContent ?? null
    for (const [problem, words] of [
      ["crossing", "Сохранить как зону нельзя: линия пересекает сама себя."],
      ["flat", "Сохранить как зону нельзя: точки стоят на одной линии, внутри нет площади."],
      ["tooMany", "Сохранить как зону нельзя: в контуре больше 200 точек."],
    ] as const) {
      state.outlineProblem = problem
      await drawTools()
      expect(said(), problem).toBe(words)
      expect(byTestId("live-map-ruler-save-zone")).toBeNull()
    }
    // One or two points are a ruler measuring, not a zone that went wrong: nothing is said.
    state.outlineProblem = "tooFew"
    await drawTools()
    expect(said()).toBeNull()
    // Mended: the words go and the button is back.
    state.outlineProblem = null
    await drawTools()
    expect([said(), byTestId("live-map-ruler-save-zone") != null]).toEqual([null, true])
    // Somebody who may not draw zones is told nothing about them: his ruler only measures.
    state.outlineProblem = "crossing"
    state.mayDraw = false
    await drawTools()
    expect(said()).toBeNull()
  })

  it("names the new zone right there, sends it as an outline, and puts the form away once it is kept", async () => {
    await drawTools()
    await pressAndDraw(byTestId("live-map-ruler-save-zone"))
    expect(byTestId("live-map-zone-form")?.getAttribute("data-task")).toBe("outline")
    // The button has become its form.
    expect(byTestId("live-map-ruler-save-zone")).toBeNull()
    await type("live-map-zone-name", "Центр")
    answer = "limit"
    await pressAndDraw(byTestId("live-map-zone-save"))
    expect(created).toEqual([{ kind: "outline", values: { name: "Центр", color: null, radiusMeters: 500 } }])
    expect(byTestId("live-map-zone-notice")?.textContent).toContain("В организации уже 500 зон")
    answer = null
    await pressAndDraw(byTestId("live-map-zone-save"))
    expect(created).toHaveLength(2)
    expect(byTestId("live-map-zone-form")).toBeNull()
  })

  it("keeps the form and everything typed in it when the outline stops being one a zone can be: it says why, waits, and goes on from where it was", async () => {
    await drawTools()
    await pressAndDraw(byTestId("live-map-ruler-save-zone"))
    await type("live-map-zone-name", "Центр")
    await press(byTestId("live-map-zone-color-teal"))
    const typed = () => [(byTestId("live-map-zone-name") as HTMLInputElement | null)?.value, byTestId("live-map-zone-color-teal")?.getAttribute("aria-pressed")]
    const blocked = () => byTestId("live-map-zone-blocked", byTestId("live-map-zone-form")!)?.querySelector("span")?.textContent ?? null
    const save = () => byTestId("live-map-zone-save") as HTMLButtonElement

    // One more press on the map — the ruler is still on — and the line crosses itself.
    state.outlineProblem = "crossing"
    await drawTools()
    expect(typed()).toEqual(["Центр", "true"])
    expect(blocked()).toBe("Сохранить как зону нельзя: линия пересекает сама себя.")
    expect(save().disabled).toBe(true)
    await pressAndDraw(save())
    expect(created).toEqual([])
    // The way to mend it is in the form itself: on a phone the ruler's own line has stepped aside for the form.
    expect(byTestId("live-map-ruler")?.className).toContain("max-sm:hidden")
    expect(byTestId("live-map-zone-blocked-action")?.textContent).toBe("Убрать последнюю")
    await pressAndDraw(byTestId("live-map-zone-blocked-action"))
    expect(undone).toBe(1)

    // Points taken back until two are left: nothing is enclosed, and that is mended on the map, not by taking back more.
    state.outlineProblem = "tooFew"
    await drawTools()
    expect(typed()).toEqual(["Центр", "true"])
    expect(blocked()).toBe("Сохранить пока нельзя: нужны хотя бы три точки. Нажмите на карту, чтобы поставить ещё.")
    expect([save().disabled, byTestId("live-map-zone-blocked-action")]).toEqual([true, null])
    // Three points on one line.
    state.outlineProblem = "flat"
    await drawTools()
    expect(blocked()).toBe("Сохранить как зону нельзя: точки стоят на одной линии, внутри нет площади.")
    expect(typed()).toEqual(["Центр", "true"])

    // An outline again: the same form with the same name, and it can be sent.
    state.outlineProblem = null
    await drawTools()
    expect([blocked(), save().disabled]).toEqual([null, false])
    expect(typed()).toEqual(["Центр", "true"])
    await pressAndDraw(save())
    expect(created).toEqual([{ kind: "outline", values: { name: "Центр", color: "teal", radiusMeters: 500 } }])
    expect(byTestId("live-map-zone-form")).toBeNull()
  })

  it("takes the form away when the ruler is put down, and does not bring it back by itself with the next outline", async () => {
    await drawTools()
    await pressAndDraw(byTestId("live-map-ruler-save-zone"))
    expect(byTestId("live-map-zone-form")).not.toBeNull()
    state.ruler = false
    await drawTools()
    expect(byTestId("live-map-zone-form")).toBeNull()
    state.ruler = true
    await drawTools()
    expect(byTestId("live-map-zone-form")).toBeNull()
    expect(byTestId("live-map-ruler-save-zone")).not.toBeNull()
    // The same when the right to draw is taken back while the form is open.
    await pressAndDraw(byTestId("live-map-ruler-save-zone"))
    state.mayDraw = false
    await drawTools()
    state.mayDraw = true
    await drawTools()
    expect(byTestId("live-map-zone-form")).toBeNull()
  })

  it("offers «Зона вокруг точки» beside a picked point, as a button of its own that leaves the point's chip as it was", async () => {
    state.ruler = false
    await drawTools()
    expect(byTestId("live-map-point-zone")).toBeNull()
    state.point = { latitude: 40.4, longitude: 49.85, label: "Точка на карте" }
    await drawTools()
    expect(byTestId("live-map-point-zone")?.textContent).toBe("Зона вокруг точки")
    expect(byTestId("live-map-point-chip")?.textContent).toBe("Ближайшие к: Точка на картеУбрать")
    await pressAndDraw(byTestId("live-map-point-zone"))
    expect(byTestId("live-map-zone-form")?.getAttribute("data-task")).toBe("circle")
    await type("live-map-zone-name", "Центр")
    await type("live-map-zone-radius", "750")
    await pressAndDraw(byTestId("live-map-zone-save"))
    expect(created).toEqual([{ kind: "circle", values: { name: "Центр", color: null, radiusMeters: 750 } }])
    expect(byTestId("live-map-zone-form")).toBeNull()
    // With the address panel open the button steps aside with the chip: on a phone the three together are taller than the map.
    await pressAndDraw(byTestId("live-map-tool-point"))
    expect([byTestId("live-map-point-chip"), byTestId("live-map-point-zone")]).toEqual([null, null])
    await pressAndDraw(byTestId("live-map-tool-point"))
    // …and so does a form that was open: the panel takes its place, and it does not come back by itself.
    await pressAndDraw(byTestId("live-map-point-zone"))
    await pressAndDraw(byTestId("live-map-tool-point"))
    expect([byTestId("live-map-point-panel") != null, byTestId("live-map-zone-form")]).toEqual([true, null])
    await pressAndDraw(byTestId("live-map-tool-point"))
    expect([byTestId("live-map-zone-form"), byTestId("live-map-point-zone") != null]).toEqual([null, true])
    // The point removed while its form is open: there is nothing left to stand around.
    await pressAndDraw(byTestId("live-map-point-zone"))
    await pressAndDraw(byTestId("live-map-point-clear"))
    expect([byTestId("live-map-zone-form"), byTestId("live-map-point-zone")]).toEqual([null, null])
    // Somebody who may not draw is offered nothing about zones beside a point either.
    state.point = { latitude: 40.4, longitude: 49.85, label: "Точка на карте" }
    state.mayDraw = false
    await drawTools()
    expect(byTestId("live-map-point-zone")).toBeNull()
  })

  it("has a place for the form of a zone that was pressed on the map", async () => {
    state.ruler = false
    state.editor = createElement(LiveMapZoneForm, { task: { kind: "delete", zone: CENTRE }, onSubmit: async () => null, onCancel: () => {} })
    await drawTools()
    expect(byTestId("live-map-zone-form-title", byTestId("live-map-zone-editor")!)?.textContent).toBe("Удалить зону «Центр»?")
    state.editor = null
    await drawTools()
    expect(byTestId("live-map-zone-editor")).toBeNull()
  })
})

describe("a zone as the map draws it", () => {
  let pressedAt: Array<[number, number]>
  let actions: Array<[string, string]>
  const drawMap = async (over: { zones?: LiveMapZone[]; canEditZones?: boolean; pressMode?: "ruler" | "point" | null } = {}) => {
    await draw(createElement(MtmLiveMap, {
      agents: [],
      zones: over.zones ?? [CENTRE, NORTH],
      canEditZones: over.canEditZones ?? true,
      pressMode: over.pressMode ?? null,
      onMapPress: (latitude: number, longitude: number) => { pressedAt.push([latitude, longitude]) },
      onZoneAction: (zoneId: string, action: string) => { actions.push([zoneId, action]) },
    }))
  }
  const pane = () => container.querySelector('[data-pane="mtm-own-zones"]') as HTMLElement
  const circle = () => pane().querySelector('[data-shape="circle"]') as HTMLElement
  const outline = () => pane().querySelector('[data-shape="polygon"]') as HTMLElement
  const style = (shape: HTMLElement) => JSON.parse(shape.getAttribute("data-style") ?? "null") as { color: string; fillColor: string; fillOpacity: number }

  beforeEach(() => {
    pressedAt = []
    actions = []
    // The map waits for a frame with a size before it mounts Leaflet.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
  })

  it("hands Leaflet the latitude first: a circle at its centre, an outline through its corners", async () => {
    await drawMap()
    // Stored and sent as [longitude, latitude]; Leaflet takes [latitude, longitude].
    expect([circle().getAttribute("data-center"), circle().getAttribute("data-radius")]).toEqual(["[40.4,49.85]", "1500"])
    // Every corner once — Leaflet closes the outline itself.
    expect(outline().getAttribute("data-positions")).toBe("[[40.4,49.8],[40.4,49.81],[40.41,49.81],[40.41,49.8]]")
  })

  it("draws zones in a pane of their own, above the tiles and under every line, client and marker", async () => {
    await drawMap()
    const z = Number(pane().getAttribute("data-z"))
    // Leaflet's own: tiles at 200, lines and clients at 400, markers at 600.
    expect(z).toBeGreaterThan(200)
    expect(z).toBeLessThan(400)
    expect(pane().querySelectorAll('[data-shape="circle"], [data-shape="polygon"]')).toHaveLength(2)
    // Nothing else of the map is drawn in the zones' pane, and no zone outside it.
    expect(container.querySelectorAll('[data-shape="circle"], [data-shape="polygon"]')).toHaveLength(2)
  })

  it("lays the bigger zone down first whichever way round they are given, so the smaller one lies on top of it", async () => {
    // What Leaflet itself then does with that order is asked of the real Leaflet in mtm-live-map-zone-stacking.test.ts.
    const shapes = () => [...pane().querySelectorAll("[data-shape]")].map((shape) => shape.getAttribute("data-shape"))
    // «Центр» is a circle of seven square kilometres, «Северный участок» a block of one.
    await drawMap({ zones: [NORTH, CENTRE] })
    expect(shapes()).toEqual(["circle", "polygon"])
    await drawMap({ zones: [CENTRE, NORTH] })
    expect(shapes()).toEqual(["circle", "polygon"])
  })

  it("paints a zone in its colour by key, faintly filled, and a zone without one in the colour kept for that", async () => {
    await drawMap({ zones: [CENTRE, NORTH, { ...CENTRE, id: "zone-odd", color: "red;stroke:url(x)" as never }] })
    expect(style(circle())).toMatchObject({ color: MTM_AGENT_MAP_COLORS.teal, fillColor: MTM_AGENT_MAP_COLORS.teal })
    expect(style(outline())).toMatchObject({ color: LIVE_MAP_ZONE_DEFAULT_HEX, fillColor: LIVE_MAP_ZONE_DEFAULT_HEX })
    // What is under a zone stays readable through it.
    expect(style(circle()).fillOpacity).toBeLessThan(0.25)
    // Text that is not a key of the palette never becomes a style.
    const odd = pane().querySelectorAll('[data-shape="circle"]')[1] as HTMLElement
    expect(style(odd).color).toBe(LIVE_MAP_ZONE_DEFAULT_HEX)
    expect(pane().outerHTML).not.toContain("url(x)")
  })

  it("keeps the zone's name on it all the time, and says in a balloon what it is and how much it covers", async () => {
    await drawMap()
    expect([...pane().querySelectorAll('[data-label="permanent"]')].map((label) => label.textContent)).toEqual(["Центр", "Северный участок"])
    const balloon = byTestId("live-map-zone-zone-centre")!
    expect(balloon.textContent).toContain("Центр")
    expect(balloon.textContent).toContain("Площадь: 7,07 км²")
    // The balloon is drawn where every balloon is — above the markers — not in the zones' pane under them.
    expect(balloon.closest("[data-balloon]")?.getAttribute("data-balloon")).toBe("popupPane")
  })

  it("offers the three changes in the balloon, in words, to somebody who may make them — and reports the one pressed", async () => {
    await drawMap()
    const buttons = () => [...byTestId("live-map-zone-zone-north")!.querySelectorAll("button")]
    expect(buttons().map((button) => button.textContent)).toEqual(["Переименовать", "Цвет", "Удалить"])
    await press(buttons()[2])
    await press(buttons()[0])
    expect(actions).toEqual([["zone-north", "delete"], ["zone-north", "rename"]])
    // The balloon steps aside for the form the page opens.
    expect(leaflet.closedBalloons).toBe(2)
    // Nothing was removed or renamed here: the map only reports the button.
    expect(pane().querySelectorAll('[data-shape="polygon"]')).toHaveLength(1)

    await drawMap({ canEditZones: false })
    expect(byTestId("live-map-zone-zone-north")?.textContent).toContain("Северный участок")
    expect(byTestId("live-map-zone-zone-north")?.querySelector("button")).toBeNull()
  })

  it("gives a press on a zone to the tool that is waiting for one — at the place pressed, once, and with no balloon", async () => {
    await drawMap()
    // No tool: the press is the zone's own (its balloon), and the map hears nothing.
    await press(circle())
    expect(pressedAt).toEqual([])
    expect(circle().getAttribute("data-bubbling")).toBe("false")
    expect(outline().getAttribute("data-bubbling")).toBe("false")

    await drawMap({ pressMode: "ruler" })
    expect(pane().querySelector("[data-balloon]")).toBeNull()
    await press(circle())
    await press(outline())
    // Where the finger was, not the zone's middle: the ruler measures from there.
    expect(pressedAt).toEqual([[40.405, 49.805], [40.405, 49.805]])
    // The name stays on the zone while a tool is in use.
    expect(pane().querySelectorAll('[data-label="permanent"]')).toHaveLength(2)
  })

  it("draws no zone when it is given none", async () => {
    await drawMap({ zones: [] })
    expect(pane().children).toHaveLength(0)
  })
})

describe("the words of «Свои зоны»", () => {
  const paths = (node: Messages, prefix = ""): Array<[string, string]> => Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : paths(value, `${prefix}${key}.`))
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  const catalogs = Object.fromEntries(["ru", "en", "az"].map((locale) => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages]))
  const areas = (locale: string) => paths((catalogs[locale].mtmMap as Messages).areas as Messages)

  it("are all there in the three languages, each with the same things to fill in", () => {
    const expected = areas("ru")
    expect(expected.length).toBeGreaterThan(40)
    for (const locale of ["en", "az"]) {
      const said = areas(locale)
      expect(said.map(([path]) => path), locale).toEqual(expected.map(([path]) => path))
      expect(said.map(([path, text]) => [path, placeholders(text)]), locale).toEqual(expected.map(([path, text]) => [path, placeholders(text)]))
    }
  })

  it("call the layer something else than the clients' own check-in circles, in every language", () => {
    for (const locale of ["ru", "en", "az"]) {
      const layers = (catalogs[locale].mtmMap as Messages).layers as Messages
      expect([typeof layers.areas, typeof layers.areasHint], locale).toEqual(["string", "string"])
      expect(layers.areas, locale).not.toBe(layers.zones)
    }
    expect(((catalogs.ru.mtmMap as Messages).layers as Messages).areas).toBe("Свои зоны")
  })

  it("never glue an Azerbaijani case ending onto a name or a number", () => {
    // «{name}ı» would be right for one zone's name and wrong for the next.
    for (const [path, text] of areas("az")) {
      expect(text, path).not.toMatch(/\}['’\-]?\p{L}/u)
    }
  })
})
