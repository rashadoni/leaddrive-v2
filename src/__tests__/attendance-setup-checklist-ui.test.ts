// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider, createTranslator } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceSetupChecklist } from "@/components/mtm/attendance-setup-checklist"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const p = createTranslator({ locale: "ru", messages: ru, namespace: "personnel" })
let status = 200, steps: unknown[] = []
const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status === 200 ? { success: true, data: { steps } } : { error: "Forbidden" }), { status }))
let container: HTMLDivElement, root: Root
async function render() {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, children: createElement(MtmAttendanceSetupChecklist, { year: "2026" }) })))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
beforeEach(() => { status = 200; container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

// Owner, 2026-10-15: HR did not know where to begin; until these steps are done every report is wrong.
describe("Personnel → Today → set up attendance", () => {
  it("lists the six steps with what is left, each with a button to its screen", async () => {
    steps = [{ key: "hours", done: true }, { key: "holidays", done: false, count: 0 }, { key: "branches", done: true, count: 1 }, { key: "leave", done: false },
      { key: "employees", done: true, count: 2 }, { key: "app", done: false, count: 0, total: 2 }]
    await render()
    const card = container.querySelector('[data-testid="attendance-setup-checklist"]')!
    expect(card.querySelector("h2")!.textContent).toBe(p("setupTitle", { done: 3, total: 6 }))
    const holidays = card.querySelector('[data-testid="attendance-setup-holidays"]')!
    expect(holidays.textContent).toContain(p("setupSteps.holidays.title", { year: "2026" }))
    expect(holidays.querySelector("a")!.getAttribute("href")).toBe("/mtm/attendance/settings?tab=holidays")
    expect(holidays.querySelector("a")!.textContent).toBe(p("setupDo"))
    expect(card.querySelector('[data-testid="attendance-setup-branches"]')!.textContent).toContain(p("setupSteps.branches.done", { count: 1 }))
    expect(card.querySelector('[data-testid="attendance-setup-branches"] a')!.textContent).toBe(p("setupOpen"))
    expect(card.querySelector('[data-testid="attendance-setup-app"]')!.textContent).toContain(p("setupSteps.app.todo"))
  })

  it("disappears once every step is done, and never shows to someone refused", async () => {
    steps = ["hours", "holidays", "branches", "leave", "employees", "app"].map(key => ({ key, done: true }))
    await render()
    expect(container.querySelector('[data-testid="attendance-setup-checklist"]')).toBeNull()
    status = 403; await act(async () => root.unmount()); root = createRoot(container); await render()
    expect(container.querySelector('[data-testid="attendance-setup-checklist"]')).toBeNull()
  })
})
