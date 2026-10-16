// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceManagedSetting } from "@/components/mtm/attendance-managed-setting"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
let root: Root, container: HTMLDivElement
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  // Rules say the viewer manages; every editor's own read stays pending, which is enough to see it open.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/rules")
    ? new Response(JSON.stringify({ success: true, data: { canManageRules: true } })) : new Promise<Response>(() => {})))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

// Owner critique, 2026-10-15: «Day kinds», «Request rules» and «Who sees the timesheet» opened onto one collapsed button.
describe("Settings cards open their editor", () => {
  it.each([
    ["day-kinds", "attendance-day-kinds-content", "kindsOpen"],
    ["requests", "attendance-request-limits-panel", "limitsOpen"],
    ["access", "attendance-hr-access-panel", "hrOpen"],
  ] as const)("%s shows its editor with no button to open it", async (kind, panel, openLabel) => {
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, children: createElement(MtmAttendanceManagedSetting, { kind }) })))
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector(`#${panel}`)).not.toBeNull()
    expect([...container.querySelectorAll("button")].some(button => button.textContent?.includes(ru.mtmAttendance[openLabel]))).toBe(false)
  })
})
