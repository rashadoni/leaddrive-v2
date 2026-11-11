// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AiSpendPage from "@/app/(dashboard)/settings/ai-spend/page"

/**
 * «Настройки → ИИ и расходы», the daily limit card. Owner, 2026-11-11: «зачем
 * ты ставишь лимит? лимит в балансе сколько загрузил… если клиент захочет, то
 * пусть ставит лимит». No limit unless the organization's admin sets one, here.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const s = ru.aiSpend as Record<string, string>

let today: { spent: number; limit: number | null; remaining: number | null }
const patches: unknown[] = []
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/settings/ai-spend") {
    return json({ data: { granularity: "week", range: "90d", timeZone: "Asia/Baku", start: "2026-08-13T00:00:00.000Z",
      firstDay: "2026-08-13", lastDay: "2026-11-11", periods: [], rows: [], totals: { calls: 0, costUsd: 0 },
      firstCallAt: null, today } })
  }
  if (url.pathname === "/api/v1/settings/ai-keys") return json({ data: { platformAllowed: true, keys: [], providers: [] } })
  if (url.pathname === "/api/v1/settings/ai-budget" && init?.method === "PATCH") {
    const { limit } = JSON.parse(String(init.body))
    patches.push(limit)
    today = { spent: today.spent, limit, remaining: limit === null ? null : Math.max(0, limit - today.spent) }
    return json({ data: { allowed: true, ...today } })
  }
  return json({ error: "unexpected" }, 404)
})

let container: HTMLDivElement
let root: Root
async function render() {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru },
    createElement(AiSpendPage))))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const card = () => [...container.querySelectorAll("section")].find((section) => section.textContent?.includes(s.limitTitle))!
const button = (label: string) => [...card().querySelectorAll("button")].find((b) => b.textContent === label)
async function type(value: string) {
  const input = card().querySelector("input")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}
async function click(label: string) {
  await act(async () => { button(label)!.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("ResizeObserver", undefined)
  patches.length = 0
  today = { spent: 3.4, limit: null, remaining: null }
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("the daily AI limit card", () => {
  it("says there is no limit, and lets the admin set one and take it away", async () => {
    await render()
    expect(card().textContent).toContain(s.limitNoneTitle)
    expect(card().textContent).toContain(s.limitNone)
    expect(card().textContent).not.toContain(s.limitWhenTitle)
    expect(button(s.limitClear)).toBeUndefined()
    // The «today» tile says it too, instead of «из $5,00».
    expect(container.textContent).toContain(s.kpiTodayNoLimit)

    // Nothing to save until a sum is typed; a sum outside the range is not sent.
    expect(button(s.limitSave)!.disabled).toBe(true)
    await type("0,2")
    expect(button(s.limitSave)!.disabled).toBe(true)
    await type("12,5")
    await click(s.limitSave)
    expect(patches).toEqual([12.5])
    expect(card().textContent).toContain(s.limitWhenTitle)
    expect(card().textContent).not.toContain(s.limitNoneTitle)
    expect(card().textContent).toContain("12,50")

    await click(s.limitClear)
    expect(patches).toEqual([12.5, null])
    expect(card().textContent).toContain(s.limitNoneTitle)
    expect(button(s.limitClear)).toBeUndefined()
  })

  it("shows a limit the organization set, and says when it is used up", async () => {
    today = { spent: 12, limit: 12, remaining: 0 }
    await render()
    expect(card().textContent).toContain(s.limitOverTitle)
    expect((card().querySelector("input") as HTMLInputElement).value).toBe("12")
  })
})
