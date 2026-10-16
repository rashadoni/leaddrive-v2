// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import type { AttendanceView } from "@/lib/mtm/attendance-view-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const at = (clock: string) => `${TODAY}T${clock}:00+04:00`
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_SERVER_ERROR" }), { status })
const savedView: AttendanceView = { id: "view-a", name: "Private custom hours", version: "2026-10-13T10:00:00.000Z",
  config: { version: 1, mode: "DAY", columns: ["worked", "employee"], showTotals: false, filters: { from: TODAY, to: TODAY, form: "ALL", teamId: "north" } } }
const fetchMock = vi.fn<typeof fetch>()
const createObjectURL = vi.fn(() => "blob:attendance-download")
const revokeObjectURL = vi.fn()
let container: HTMLDivElement
let root: Root
let views: AttendanceView[]
let hasSnapshot: boolean
let downloads: Array<{ href: string; filename: string }>
async function server(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsed = new URL(String(url), "https://attendance.test")
  if (parsed.pathname.endsWith("/rules")) return response({ today: TODAY })
  if (parsed.pathname.endsWith("/views")) return response(views)
  if (parsed.pathname.endsWith("/export")) {
    const format = JSON.parse(String(options?.body)).format
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })
  }
  const query = { from: parsed.searchParams.get("from")!, to: parsed.searchParams.get("to")!, form: "ALL" as const,
    ...(parsed.searchParams.has("teamId") ? { teamId: parsed.searchParams.get("teamId")! } : {}) }
  const report = buildMtmAttendanceReport({ employees: [{ id: "a", name: "Aysel Aliyeva", teamId: "north", teamName: "North" }], workdays: [{ id: "day-a", agentId: "a", workDate: TODAY,
    status: "COMPLETED", startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at("09:00") }, { type: "FINISH", occurredAt: at("18:00") }] }], calendar: [], rules: [], from: query.from, to: query.to, now: at("19:00") })
  return response({ ...report, ...(hasSnapshot ? { snapshot: { id: "a".repeat(64), asOf: report.asOf, query } } : {}) })
}
const panel = () => container.querySelector('[data-testid="attendance-export"]')!
const button = (text: string, parent: ParentNode = container) => Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text)!
const exports = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/export"))
async function render(locale = "en") {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceReportWorkspace) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(text: string, parent: ParentNode = container) { await act(async () => button(text, parent).click()) }
async function editTo(value: string) {
  const field = container.querySelector<HTMLInputElement>("#attendance-report-to")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

beforeEach(() => {
  views = []
  hasSnapshot = true
  downloads = []
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(server)
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  const OriginalURL = URL
  vi.stubGlobal("URL", class extends OriginalURL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ href: this.href, filename: this.download }) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("attendance export buttons bound to the displayed snapshot", () => {
  it.each([["en", "xlsx"], ["ru", "pdf"], ["az", "xlsx"]] as const)("downloads %s %s using the loaded period and exact snapshot, then revokes the URL", async (locale, format) => {
    await render(locale)
    await editTo("2026-10-20") // draft not yet applied; it must not affect this export.
    await click(messages(locale).mtmAttendance[format === "pdf" ? "exportPdf" : "exportExcel"], panel())
    expect(exports()).toHaveLength(1)
    const body = JSON.parse(String(exports()[0][1]?.body))
    expect(body).toMatchObject({ format, locale, config: { filters: { from: TODAY, to: TODAY, form: "ALL" } },
      snapshot: { id: "a".repeat(64), asOf: "2026-10-13T15:00:00.000Z", query: { from: TODAY, to: TODAY, form: "ALL" } } })
    expect(downloads).toEqual([{ href: "blob:attendance-download", filename: `attendance-${TODAY}-${TODAY}.${format}` }])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:attendance-download")
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it("exports the opened personal column order, totals choice and scoped query", async () => {
    views = [savedView]
    await render()
    await click("Open")
    await click("Download Excel", panel())
    const body = JSON.parse(String(exports()[0][1]?.body))
    expect(body.config).toEqual(savedView.config)
    expect(body.snapshot.query).toEqual({ from: TODAY, to: TODAY, form: "ALL", teamId: "north" })
    expect(container.querySelector('[data-testid="attendance-report-totals"]')).toBeNull()
  })

  it("does not offer a download without a server snapshot", async () => {
    hasSnapshot = false
    await render()
    expect(button("Download Excel", panel()).disabled).toBe(true)
    expect(button("Download PDF", panel()).disabled).toBe(true)
    await click("Download Excel", panel())
    expect(exports()).toHaveLength(0)
  })

  it("requires a refreshed report after 409 before another export", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/export") ? response(null, 409, "MTM_ATTENDANCE_EXPORT_CHANGED") : server(url, options))
    await render()
    await click("Download PDF", panel())
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.exportChanged)
    expect(button("Download PDF", panel()).disabled).toBe(true)
    expect(downloads).toHaveLength(0)
    await click("Refresh report", panel())
    expect(button("Download PDF", panel()).disabled).toBe(false)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/report?")).length).toBe(2)
  })

  it("clears report and personal names when export discovers revoked access", async () => {
    views = [savedView]
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/export") ? response(null, 403) : server(url, options))
    await render()
    await click("Open")
    await click("Download Excel", panel())
    expect(container.textContent).not.toContain("Private custom hours")
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    expect(container.textContent).toContain(messages("en").mtmAttendance.reportAccessUnavailable)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it.each(["non-json", "wrong-content-type", "too-large"])("handles %s without downloading or exposing server text", async (failure) => {
    fetchMock.mockImplementation(async (url, options) => {
      if (!String(url).endsWith("/export")) return server(url, options)
      if (failure === "too-large") return response(null, 400, "MTM_ATTENDANCE_EXPORT_TOO_LARGE")
      return new Response("PRIVATE_HTML", { status: failure === "non-json" ? 500 : 200, headers: { "content-type": "text/html" } })
    })
    await render()
    await click("Download Excel", panel())
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance[failure === "too-large" ? "exportTooLarge" : "exportFailed"])
    expect(container.textContent).not.toMatch(/PRIVATE_HTML|PRIVATE_SERVER_ERROR/)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("aborts a pending export when the displayed form changes", async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/export") ? pending : server(url, options))
    await render()
    await click("Download PDF", panel())
    const signal = exports()[0][1]?.signal
    await click(messages("en").mtmAttendance.reportJournal)
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "application/pdf" } })))
    expect(downloads).toHaveLength(0)
  })
})
