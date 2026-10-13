// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"
import { MtmAttendancePersonalViews } from "@/components/mtm/attendance-personal-views"
import { MTM_ATTENDANCE_BASELINE_RULE } from "@/lib/mtm/attendance-rules"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const currentConfig: AttendanceViewConfig = { version: 1, mode: "DAY", columns: ["employee", "worked"], showTotals: true,
  filters: { from: "2026-10-13", to: "2026-10-13", form: "ALL" } }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement
let root: Root
async function render(child: ReactElement, locale: string) {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: child }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function fill(id: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "My future settings")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method === "POST") return new Promise<Response>((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    })
    const data = String(url).includes("/rules") ? { current: MTM_ATTENDANCE_BASELINE_RULE, versions: [], today: "2026-10-13", minEffectiveFrom: "2026-10-14", canManageRules: true }
      : String(url).includes("/calendar") ? { today: "2026-10-13", days: [], canManage: true } : []
    return new Response(JSON.stringify({ success: true, data }), { status: 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("attendance writes interrupted by a locale change", () => {
  it.each([
    { kind: "rules", child: createElement(MtmAttendanceRulesForm), field: null, error: "rulesSaveUnconfirmed", reload: "rulesReload" },
    { kind: "calendar", child: createElement(MtmAttendanceCalendar), field: "attendance-calendar-name", error: "calendarSaveUnconfirmed", reload: "calendarReload" },
    { kind: "personal", child: createElement(MtmAttendancePersonalViews, { currentConfig, onApply: () => {}, onAccessLost: () => {} }), field: "attendance-view-name", error: "viewsSaveUnconfirmed", reload: "viewsReload" },
  ])("$kind leaves saving state but requires an explicit fresh read before another write", async ({ child, field, error, reload }) => {
    await render(child, "en")
    if (field) await fill(field)
    await submit()
    const write = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!
    expect(write).toBeDefined()
    await render(child, "ru")
    expect(write[1]?.signal?.aborted).toBe(true)
    expect(container.textContent).not.toContain("Сохраняем…")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance[error])
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await submit()
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1)
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === messages("ru").mtmAttendance[reload])!
    await act(async () => refresh.click())
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })
})
