// @vitest-environment jsdom
/**
 * «Экран в зале» answers «где запись?» in the settings.
 *
 * The owner booked a visit for today, opened the monitor and found it empty
 * (2026-11-13: «на сегодня же была запись, где она?»). The screen had been
 * narrowed to four masters and the visit was with a fifth: it showed exactly
 * what it was told to, and looked broken. A wall cannot explain itself to the
 * people in the room, so the settings do — and the explanation carries the way
 * out. What is checked is what he would have read there that morning, and that
 * the one button really asks the server to stop leaving anybody out.
 */
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BookingBoardPanel } from "@/components/booking/booking-board-panel"
import ru from "../../messages/ru.json"

vi.mock("@/components/ui/searchable-select", () => ({ SearchableSelect: () => null }))

const HOSTS = [
  { id: "aysel", name: "Aysel Quliyeva" }, { id: "aysu", name: "Aysu Kərimli" },
  { id: "ayten", name: "Aytən Rəhimli" }, { id: "elnur", name: "Elnur Babayev" }, { id: "leyla", name: "Leyla" },
]
const ZAL1 = {
  id: "zal1", title: "ZAL1", url: "https://app.example.test/board/token", columns: 2,
  hostIds: ["aysel", "aysu", "ayten", "elnur"],
  today: { shown: 0, elsewhere: [{ name: "Leyla", count: 1 }] },
}

let root: Root
let container: HTMLElement
let calls: { url: string; method: string; body: unknown }[]
let links: unknown[]

async function mount() {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(NextIntlClientProvider, { locale: "ru", messages: ru, children: createElement(BookingBoardPanel, { hosts: HOSTS }) } as ComponentProps<typeof NextIntlClientProvider>))
  })
  // The two reads the panel makes on opening.
  for (let turn = 0; turn < 5; turn++) await act(async () => { await Promise.resolve() })
}
const text = () => (container.textContent ?? "").replace(/\s+/g, " ")
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls = []
  links = [ZAL1]
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const answer = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) })
    if (url.startsWith("/api/v1/booking-pages/resources")) return answer({ resources: [{ id: "room-a", name: "Otaq A", isActive: true }, { id: "room-old", name: "Köhnə otaq", isActive: false }] })
    if (method === "PATCH") return answer({ link: { ...ZAL1, hostIds: body.hostIds, today: { shown: 1, elsewhere: [] } } })
    return answer({ links })
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("the settings of a wall screen, on the morning it looked empty", () => {
  it("says the screen holds nothing today, and whose visit it is leaving out", async () => {
    await mount()

    expect(text()).toContain("сегодня встреч нет")
    expect(text()).toContain("Ещё 1 встреча сегодня — у тех, кого на этом экране нет: Leyla")
    expect(button("Показывать всех")).toBeTruthy()
  })

  it("one press stops the screen leaving anybody out, at the same address", async () => {
    await mount()

    await act(async () => { button("Показывать всех")!.click() })
    for (let turn = 0; turn < 5; turn++) await act(async () => { await Promise.resolve() })

    // The same row, changed in place: the monitor's address does not move.
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      { url: "/api/v1/booking-pages/board", method: "PATCH", body: { id: "zal1", title: "ZAL1", hostIds: [], columns: 2 } },
    ])
    expect(calls.some((call) => call.method === "POST")).toBe(false)
    // And the explanation is gone with the reason for it.
    expect(text()).not.toContain("у тех, кого на этом экране нет")
    expect(text()).toContain("сегодня 1 встреча")
    expect(button("Показывать всех")).toBeUndefined()
  })

  it("a screen that leaves nobody out explains nothing", async () => {
    links = [{ ...ZAL1, hostIds: [], today: { shown: 3, elsewhere: [] } }]
    await mount()

    expect(text()).toContain("сегодня 3 встречи")
    expect(text()).not.toContain("у тех, кого на этом экране нет")
    expect(button("Показывать всех")).toBeUndefined()
  })

  it("counts rooms as rooms when it says whom a screen shows", async () => {
    links = [{ ...ZAL1, hostIds: ["aysel", "room-a"], today: { shown: 2, elsewhere: [] } }]
    await mount()

    expect(text()).toContain("1 чел. · 1 комната")
  })
})
