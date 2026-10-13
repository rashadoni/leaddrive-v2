// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceHelp } from "@/components/mtm/attendance-help"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("attendance help inside the existing report", () => {
  it.each(["ru", "az", "en"])("opens and closes the actual %s guidance without a network action", async locale => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: "Asia/Baku" }, createElement(MtmAttendanceHelp))))
    const details = container.querySelector("details")!, summary = details.querySelector("summary")!
    expect(details.open).toBe(false)
    expect(summary.textContent).toContain(messages.mtmAttendance.helpTitle)
    await act(async () => summary.click())
    expect(details.open).toBe(true)
    expect(details.querySelectorAll("section")).toHaveLength(8)
    for (const topic of ["Access", "Status", "Requests", "Shifts", "Leave", "Month", "Exports", "Privacy"]) {
      const heading = details.querySelector(`#attendance-help-${topic.toLowerCase()}`)!
      expect(heading.textContent).toBe(messages.mtmAttendance[`help${topic}Title`])
      expect(heading.parentElement?.textContent).toContain(messages.mtmAttendance[`help${topic}Body`])
      expect(heading.parentElement?.getAttribute("aria-labelledby")).toBe(heading.id)
    }
    expect(container.textContent).not.toMatch(/mtmAttendance\.|undefined|NaN/)
    expect(container.querySelector("form,input,select,iframe,a")).toBeNull()
    await act(async () => summary.click())
    expect(details.open).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `attendance-help-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance help component</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1320px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body><h1 class="mb-6 text-2xl font-bold tracking-tight">${messages.mtmAttendance.title}</h1>${container.innerHTML}</body></html>`)
    }
  })
})
