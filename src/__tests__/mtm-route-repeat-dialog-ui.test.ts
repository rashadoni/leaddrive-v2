// @vitest-environment jsdom
/**
 * «Повторить маршрут» on the route's details (Zeytun 2026-11-13, owner's
 * mockup approved with «Давай»): the dialog is rendered for real against a
 * stubbed server — what the agent's Fridays look like, which are skipped,
 * and what is made.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    return (typeof node === "string" ? node : `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import { MtmRouteRepeatDialog } from "@/components/mtm/route-repeat-dialog"

const SOURCE = {
  date: "2026-11-20T00:00:00.000Z",
  name: "Klinika 3 və apteklər",
  agentId: "agent-rashad",
  assignments: [{ agentId: "agent-rashad", role: "PRIMARY" }],
  points: [{ customerId: "clinic-3", contactId: "doctor-aliyeva", orderIndex: 0, plannedTime: "2026-11-20T06:00:00.000Z" }],
}

let root: Root
let container: HTMLDivElement
const created: string[] = []
const onCreated = vi.fn()

const byTestId = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  created.length = 0
  onCreated.mockReset()
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/v1/mtm/routes?")) {
      // The agent already has a route on Friday 4 December.
      return new Response(JSON.stringify({ success: true, data: { routes: [
        { id: "other", date: "2026-12-04T00:00:00.000Z", status: "PLANNED" },
        { id: "cancelled", date: "2026-12-11T00:00:00.000Z", status: "CANCELLED" },
      ] } }))
    }
    if (url.endsWith("/publish")) return new Response(JSON.stringify({ success: true, data: { version: 2 } }))
    const date = JSON.parse(String(init?.body)).date as string
    // 25 December is a holiday in this organization's calendar.
    if (date === "2026-12-25") return new Response(JSON.stringify({ code: "MTM_ROUTE_NON_WORKING_DAY" }), { status: 409 })
    created.push(date)
    return new Response(JSON.stringify({ success: true, data: { id: `route-${date}`, version: 1 } }), { status: 201 })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function open() {
  await act(async () => {
    root.render(createElement(MtmRouteRepeatDialog, {
      open: true, source: SOURCE, today: "2026-11-13", publish: true, onClose: () => {}, onCreated,
    }))
  })
  await settle()
}

function setUntil(value: string) {
  const input = byTestId("mtm-route-repeat-until")[0] as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("«Повторить маршрут»", () => {
  it("offers the route's own weekday, every week, and crosses out the Friday the agent is already busy on", async () => {
    await open()
    expect(byTestId("mtm-route-repeat-weekday-5")[0].getAttribute("aria-pressed")).toBe("true")
    expect(byTestId("mtm-route-repeat-every-1")[0].getAttribute("aria-pressed")).toBe("true")
    await act(async () => setUntil("2026-12-25"))
    await settle()
    const dates = byTestId("mtm-route-repeat-date")
    expect(dates).toHaveLength(5)
    const crossed = dates.filter((date) => date.className.includes("line-through")).map((date) => date.textContent)
    expect(crossed).toEqual(["4 дек."])
    // A cancelled route does not hold the day.
    expect(byTestId("mtm-route-repeat-count")[0].textContent).toContain("Будет маршрутов: 4")
  })

  it("makes the free Fridays, names the busy one and the holiday, and refreshes the routes", async () => {
    await open()
    await act(async () => setUntil("2026-12-25"))
    await settle()
    await act(async () => byTestId("mtm-route-repeat-create")[0].click())
    await settle()
    expect(created).toEqual(["2026-11-27", "2026-12-11", "2026-12-18"])
    expect(byTestId("mtm-route-repeat-summary")[0].textContent).toBe("Создано: 3, пропущено: 2")
    const outcomes = byTestId("mtm-route-repeat-outcome").map((row) => row.textContent ?? "")
    expect(outcomes.find((row) => row.includes("4 дек"))).toContain("у агента уже есть маршрут")
    expect(outcomes.find((row) => row.includes("25 дек"))).toContain("выходной или праздник")
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it("every other week, from the route's own rhythm", async () => {
    await open()
    await act(async () => byTestId("mtm-route-repeat-every-2")[0].click())
    await act(async () => setUntil("2026-12-25"))
    await settle()
    expect(byTestId("mtm-route-repeat-date").map((date) => date.textContent)).toEqual(["4 дек.", "18 дек."])
  })
})

describe("where the button is", () => {
  it("sits in the route's details for whoever may plan routes", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    const detail = page.slice(page.indexOf('data-testid="mtm-route-detail-dialog"'), page.indexOf('data-testid="mtm-route-detail-dialog"') + 4000)
    expect(detail).toContain('capabilities.canCreateRoute && selectedRoute.historicalAccessOnly !== true && selectedRoute.agentId && selectedRoutePoints.length > 0')
    expect(detail).toContain('data-testid="mtm-route-repeat"')
    expect(page).toContain('publish={capabilities.canPublish && selectedRoute?.status !== "DRAFT"}')
  })
})
