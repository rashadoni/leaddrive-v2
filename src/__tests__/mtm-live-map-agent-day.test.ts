// @vitest-environment jsdom
/**
 * «Пробег сегодня» and «В движении» in the selected employee's card on the
 * live map (owner, 2026-10-09: «добей до 100 %» of the Navixy tracking
 * screen).
 *
 * What is tested is what a dispatcher reads and what the page asks the server
 * for: the kilometres and how they were counted, the time in motion only when
 * he drove, the silent phone as a line of its own, a day too long to count
 * said as that — and one question per look at him, none while the block is
 * folded.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
/**
 * The block's own words. They reach messages/*.json with the change that puts
 * the block on the page; until then they are read from here. As soon as the
 * file has a `mtmMap.day` at all, only the file is read: a key it lacks then
 * shows as its path and fails the case, as it would on the screen.
 */

vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  const find = (messages: Messages, path: string) => {
    let node: unknown = messages
    for (const part of path.split(".")) node = (node as Messages | undefined)?.[part]
    return typeof node === "string" ? node : null
  }
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          const path = `${namespace}.${key}`
          const raw = find(ru, path) ?? path
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})

import { LiveMapAgentDay } from "@/components/mtm/live-map-agent-day"
import { LiveMapCardBlocks } from "@/components/mtm/live-map-card-blocks"
import { DEFAULT_CARD_LAYOUT, toggleCardBlockCollapsed, type CardLayout } from "@/lib/mtm/live-map-card-layout"

/** A morning as the server counts it: 12.4 km by road, 1 h 5 min driving, 30 min of silence. */
const MORNING = {
  date: "2026-10-09",
  timezone: "Asia/Baku",
  distanceMeters: 12_400,
  distanceBasis: "ROADS",
  movingSeconds: 65 * 60,
  unknownSeconds: 30 * 60,
  firstPointAt: "2026-10-09T05:00:00.000Z",
  lastPointAt: "2026-10-09T09:40:00.000Z",
  complete: true,
  generatedAt: "2026-10-09T10:00:00.000Z",
}

describe("«Пробег сегодня» in the selected employee's card", () => {
  let root: Root
  let container: HTMLDivElement
  let requests: string[]
  /** Each question's own «call it off» signal, in the order asked. */
  let calledOff: AbortSignal[]
  /** What the server answers next; a function so a case can hold an answer back. */
  let answer: (url: string) => Response | Promise<Response>

  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const text = (testId: string) => byTestId(testId)?.textContent ?? null
  const settle = async (ms = 10) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const render = async (element: ReturnType<typeof createElement>) => { await act(async () => { root.render(element) }) }
  const totals = (data: Record<string, unknown>) => Response.json({ success: true, data })
  const day = (extra: Record<string, unknown> = {}) => createElement(LiveMapAgentDay, {
    agentId: "a1",
    refreshKey: "k1",
    // The page hands a new function on every refresh of the map.
    formatDistance: (meters: number) => `${(meters / 1_000).toFixed(1)} км`,
    ...extra,
  } as never)

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    requests = []
    answer = () => totals(MORNING)
    calledOff = []
    // This server answers even a question that was called off: dropping a
    // late answer is the block's own job, not something the test does for it.
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { signal?: AbortSignal }) => {
      requests.push(String(input))
      if (init?.signal) calledOff.push(init.signal)
      return answer(String(input))
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("asks for this employee's day and shows the kilometres, how they were counted, the time in motion and the time the phone was silent", async () => {
    // The answer is held back for a moment: until it comes the block says it is counting.
    let release: (response: Response) => void = () => {}
    answer = () => new Promise<Response>((resolve) => { release = resolve })
    await render(day())
    expect(text("live-map-agent-day-loading")).toBe("Считаю день…")
    await act(async () => { release(totals(MORNING)) })
    await settle()
    // Only who — the day is the organization's own «today», worked out on the server.
    expect(requests).toEqual(["/api/v1/mtm/locations/day-totals?agentId=a1"])
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня12.4 км · по дорогам")
    expect(text("live-map-agent-day-moving")).toBe("В движении1 ч 5 мин")
    expect(text("live-map-agent-day-unknown")).toBe("Нет данных с телефона30 мин")
    expect(text("live-map-agent-day-note")).toBe("Считается по GPS телефона, пока идёт рабочий день. Где телефон молчал, путь неизвестен.")
    expect(byTestId("live-map-agent-day-loading")).toBeNull()
  })

  it("says «по дорогам» only when the whole day was counted along the roads", async () => {
    for (const basis of ["STRAIGHT", "PARTIAL"]) {
      answer = () => totals({ ...MORNING, distanceBasis: basis })
      await render(day({ refreshKey: basis }))
      await settle()
      expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня12.4 км")
    }
  })

  it("a day without a drive has no «В движении» line, and a day without a silence no «Нет данных» line — never a zero", async () => {
    answer = () => totals({ ...MORNING, distanceMeters: 40, movingSeconds: 0, unknownSeconds: 0 })
    await render(day())
    await settle()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня0.0 км · по дорогам")
    expect(byTestId("live-map-agent-day-moving")).toBeNull()
    expect(byTestId("live-map-agent-day-unknown")).toBeNull()
    expect(container.textContent).not.toContain("0 мин")
  })

  it("reads a duration as History reads it: minutes under an hour, hours and minutes above, and never «0 мин» for a time that exists", async () => {
    answer = () => totals({ ...MORNING, movingSeconds: 59 * 60 + 20, unknownSeconds: 20 })
    await render(day())
    await settle()
    expect(text("live-map-agent-day-moving")).toBe("В движении59 мин")
    expect(text("live-map-agent-day-unknown")).toBe("Нет данных с телефона1 мин")

    answer = () => totals({ ...MORNING, movingSeconds: 3 * 3_600 + 40, unknownSeconds: 2 * 3_600 + 14 * 60 + 31 })
    await render(day({ refreshKey: "k2" }))
    await settle()
    expect(text("live-map-agent-day-moving")).toBe("В движении3 ч 1 мин")
    expect(text("live-map-agent-day-unknown")).toBe("Нет данных с телефона2 ч 15 мин")
  })

  it("a day too long to count says so and points to «История за день» — no kilometres of its beginning are shown", async () => {
    answer = () => totals({ ...MORNING, complete: false, distanceMeters: null, distanceBasis: null, movingSeconds: null, unknownSeconds: null })
    await render(day())
    await settle()
    expect(text("live-map-agent-day-not-calculated")).toBe("Не рассчитано: за сегодня слишком много GPS-точек. Нажмите «История за день» и выберите часть дня.")
    // The pointer names the button of the same card by its own words.
    expect(text("live-map-agent-day-not-calculated")).toContain(((ru.mtmMap as Messages).roster as Messages).historyToday as string)
    for (const absent of ["distance", "moving", "unknown", "note", "empty"]) expect(byTestId(`live-map-agent-day-${absent}`)).toBeNull()
    expect(container.textContent).not.toMatch(/\d/)
  })

  it("a day without a coordinate says that — not «0 км»", async () => {
    answer = () => totals({ ...MORNING, distanceMeters: 0, distanceBasis: "STRAIGHT", movingSeconds: 0, unknownSeconds: 0, firstPointAt: null, lastPointAt: null })
    await render(day())
    await settle()
    expect(text("live-map-agent-day-empty")).toBe("Сегодня точных координат с телефона пока нет")
    expect(byTestId("live-map-agent-day-distance")).toBeNull()
    expect(container.textContent).not.toMatch(/\d/)
  })

  it("five refreshes of the map are one question; he did something, or two minutes passed — one more", async () => {
    await render(day())
    await settle()
    for (let refresh = 0; refresh < 5; refresh += 1) {
      await render(day())
      await settle()
    }
    expect(requests).toHaveLength(1)

    answer = () => totals({ ...MORNING, distanceMeters: 13_900 })
    await render(day({ refreshKey: "k2" }))
    await settle()
    expect(requests).toHaveLength(2)
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня13.9 км · по дорогам")
  })

  it("a failed refresh keeps what was read and says it is not fresh; the next good one takes the word away", async () => {
    await render(day())
    await settle()
    answer = () => new Response("{}", { status: 500 })
    await render(day({ refreshKey: "k2" }))
    await settle()
    expect(text("live-map-agent-day-failed")).toBe("Не удалось обновить цифры за день")
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня12.4 км · по дорогам")
    expect(text("live-map-agent-day-moving")).toBe("В движении1 ч 5 мин")

    answer = () => totals({ ...MORNING, distanceMeters: 15_000 })
    await render(day({ refreshKey: "k3" }))
    await settle()
    expect(byTestId("live-map-agent-day-failed")).toBeNull()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня15.0 км · по дорогам")
  })

  it("when the first read fails — refused, too many requests, or an answer that is not the day — it shows no number and does not call the day empty", async () => {
    const failures: Array<() => Response> = [
      () => new Response("{}", { status: 500 }),
      () => new Response("{}", { status: 429 }),
      () => new Response("{}", { status: 404 }),
      () => Response.json({ success: true, data: {} }),
      () => Response.json({ success: true, data: { complete: true, distanceMeters: "many" } }),
      () => new Response("<html>signed out</html>", { status: 200 }),
    ]
    for (const [index, failure] of failures.entries()) {
      answer = failure
      await render(day({ refreshKey: `first-${index}`, agentId: `a${index}` }))
      await settle()
      expect(text("live-map-agent-day-failed")).toBe("Не удалось обновить цифры за день")
      for (const absent of ["distance", "moving", "unknown", "empty", "not-calculated", "loading"]) {
        expect(byTestId(`live-map-agent-day-${absent}`)).toBeNull()
      }
    }
  })

  it("another employee's card never shows the previous one's numbers — not while his are being counted, and not when the old answer arrives late", async () => {
    await render(day())
    await settle()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня12.4 км · по дорогам")

    // The second employee's answer is held back; meanwhile nothing of the first is on screen.
    let release: (response: Response) => void = () => {}
    answer = () => new Promise<Response>((resolve) => { release = resolve })
    await render(day({ agentId: "a2" }))
    expect(text("live-map-agent-day-loading")).toBe("Считаю день…")
    expect(byTestId("live-map-agent-day-distance")).toBeNull()
    const lateForSecond = release

    // The dispatcher clicks on to a third before the second has answered.
    answer = () => totals({ ...MORNING, distanceMeters: 3_000, movingSeconds: 0, unknownSeconds: 0 })
    await render(day({ agentId: "a3" }))
    await settle()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня3.0 км · по дорогам")
    // The question about the second was called off, so the browser can drop it …
    expect(calledOff.map((signal) => signal.aborted)).toEqual([true, true, false])
    // … and when its answer comes anyway, it is not put under the third's name.
    await act(async () => { lateForSecond(totals({ ...MORNING, distanceMeters: 99_000 })) })
    await settle()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня3.0 км · по дорогам")
    expect(requests).toEqual([
      "/api/v1/mtm/locations/day-totals?agentId=a1",
      "/api/v1/mtm/locations/day-totals?agentId=a2",
      "/api/v1/mtm/locations/day-totals?agentId=a3",
    ])
  })

  it("a question that was called off and then fails does not disturb the card on screen", async () => {
    let release: (response: Response) => void = () => {}
    answer = () => new Promise<Response>((resolve) => { release = resolve })
    await render(day())
    const lateForFirst = release

    answer = () => totals({ ...MORNING, distanceMeters: 3_000 })
    await render(day({ agentId: "a2" }))
    await settle()
    await act(async () => { lateForFirst(new Response("{}", { status: 500 })) })
    await settle()
    expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня3.0 км · по дорогам")
    expect(byTestId("live-map-agent-day-failed")).toBeNull()
    expect(byTestId("live-map-agent-day-loading")).toBeNull()
  })

  it("an employee id is sent as a value, whatever characters it has", async () => {
    await render(day({ agentId: "a 1&date=2020-01-01" }))
    await settle()
    expect(requests).toEqual(["/api/v1/mtm/locations/day-totals?agentId=a%201%26date%3D2020-01-01"])
  })

  describe("as a block of the card", () => {
    const card = (layout: CardLayout, onLayoutChange: (layout: CardLayout) => void = () => {}) => createElement(LiveMapCardBlocks, {
      blocks: [{ id: "day" as const, title: "День в цифрах", render: () => day() }],
      layout,
      onLayoutChange,
    })

    it("a folded block asks the server for nothing; unfolded, it asks once", async () => {
      const folded = toggleCardBlockCollapsed(DEFAULT_CARD_LAYOUT, "day")
      await render(card(folded))
      await settle()
      // The map refreshes while it stays folded.
      await render(card(folded))
      await settle()
      expect(requests).toEqual([])
      expect(byTestId("live-map-agent-day")).toBeNull()

      await render(card(DEFAULT_CARD_LAYOUT))
      await settle()
      expect(requests).toHaveLength(1)
      expect(text("live-map-agent-day-distance")).toBe("Пробег сегодня12.4 км · по дорогам")
    })

    it("stands under the block's heading, with no second heading or frame of its own", async () => {
      await render(card(DEFAULT_CARD_LAYOUT))
      await settle()
      expect(text("live-map-card-block-toggle-day")).toBe("День в цифрах")
      expect(byTestId("live-map-card-block-day")?.textContent?.match(/День в цифрах/g)).toHaveLength(1)
    })
  })
})
