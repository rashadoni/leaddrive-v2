// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceFeatureSwitch } from "@/components/mtm/attendance-feature-switch"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const p = (key: string) => ru.personnel[key] as string
let status = 200, data: unknown = {}
const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status < 400 ? { success: true, data } : { error: "Forbidden" }), { status }))
const assign = vi.fn()
let container: HTMLDivElement, root: Root
async function render(enabled: boolean, canChange = true) {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru }, createElement(MtmAttendanceFeatureSwitch, { enabled, canChange }))))
}
const button = (text: string) => Array.from(container.querySelectorAll("button")).find(node => node.textContent === text)
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const puts = () => fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, JSON.parse(String(init?.body))])

beforeEach(() => {
  status = 200; data = {}
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockClear(); assign.mockClear(); vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { ...window.location, assign })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

// Owner, 2026-10-15: one setting in one place — the switch moved from MTM
// settings to Personnel → Settings.
describe("Workday attendance switch", () => {
  it("turns attendance on with one button and starts the section over", async () => {
    await render(false)
    expect(container.textContent).toContain(p("featureOff"))
    await act(async () => button(p("featureEnable"))!.click()); await flush()
    expect(puts()).toEqual([["/api/v1/mtm/settings", "PUT", { attendanceEnabled: true }]])
    expect(assign).toHaveBeenCalledWith("/mtm/attendance/settings")
  })

  it("turns it off only after an in-place confirmation that says data is kept", async () => {
    await render(true)
    await act(async () => button(p("featureDisable"))!.click())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain(p("featureDisableConfirm"))
    await act(async () => button(p("cancel"))!.click())
    expect(button(p("featureDisableAction"))).toBeUndefined()
    await act(async () => button(p("featureDisable"))!.click())
    await act(async () => button(p("featureDisableAction"))!.click()); await flush()
    expect(puts()).toEqual([["/api/v1/mtm/settings", "PUT", { attendanceEnabled: false }]])
    expect(assign).toHaveBeenCalledWith("/mtm/attendance/settings")
  })

  it.each([[403, {}], [200, { ignoredKeys: ["attendanceEnabled"] }]])("says so when the save is refused or dropped (%i)", async (code, body) => {
    status = code; data = body
    await render(false)
    await act(async () => button(p("featureEnable"))!.click()); await flush()
    expect(assign).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(p("featureSaveError"))
  })

  it("shows the state without controls to someone who cannot change it", async () => {
    await render(true, false)
    expect(container.textContent).toContain(p("featureOn"))
    expect(container.querySelectorAll("button")).toHaveLength(0)
  })
})
