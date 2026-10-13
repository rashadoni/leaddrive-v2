// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceBranchReport } from "@/components/mtm/attendance-branch-report"
import { buildMtmAttendanceReport, type MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import type { AttendanceReportMark } from "@/lib/mtm/attendance-location-report"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const languages = ["ru", "az", "en"] as const
type Locale = typeof languages[number]
const messages = Object.fromEntries(languages.map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const snapshot = { version: 1, asOf: "2026-10-13T15:00:00.000Z", fingerprint: "a".repeat(64), query: { from: TODAY, to: TODAY, form: "ALL" } }
const branch = { id: "private-branch-id", revisionId: "private-revision-id", name: "Демо-офис «Центр»" }
function mark(id: string, action: AttendanceReportMark["action"], state: AttendanceReportMark["state"], hasBranch = false): AttendanceReportMark {
  return { eventId: `private-event-${id}`, action, state, branch: hasBranch ? branch : null, distanceMeters: hasBranch ? 30 : null, claimedAt: `${TODAY}T06:00:00.000Z`, serverReceivedAt: `${TODAY}T06:00:01.000Z` }
}
function fixture(from = TODAY, to = TODAY): MtmAttendanceReport & { snapshot: typeof snapshot } {
  const report = buildMtmAttendanceReport({ from, to, now: `${to}T15:00:00Z`, rules: [], calendar: [], workdays: [], employees: [
    { id: "a", name: "Демо-сотрудник 1", teamId: "north", teamName: "Демо-команда 1" },
    { id: "b", name: "Демо-сотрудник 2", teamId: "south", teamName: "Демо-команда 2" },
    { id: "c", name: "Демо-сотрудник 3", teamId: "south", teamName: "Демо-команда 2" },
    { id: "d", name: "Демо-сотрудник 4", teamId: "south", teamName: "Демо-команда 2" },
  ] })
  for (const row of report.rows) row.locationMarks = row.employeeId === "a" ? [mark("a1", "START", "INSIDE", true), mark("a2", "FINISH", "OUTSIDE", true)]
    : row.employeeId === "b" ? [mark("b1", "START", "UNAVAILABLE"), mark("b2", "FINISH", "NO_CONSENT")]
      : row.employeeId === "c" ? [mark("c1", "START", "NOT_RECORDED"), mark("c2", "FINISH", "NOT_RECORDED")]
        : [mark("d1", "START", "UNCERTAIN", true)]
  return { ...report, snapshot: { ...snapshot, query: { from, to, form: "ALL" } } }
}
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_SERVER_TRACE" }), { status })
const fetchMock = vi.fn<typeof fetch>()
async function defaultFetch(input: string | URL | Request) {
  const url = new URL(String(input), "https://fixture.test")
  if (url.pathname.endsWith("/rules")) return response({ today: TODAY })
  return response(fixture(url.searchParams.get("from")!, url.searchParams.get("to")!))
}
let root: Root, container: HTMLDivElement, locale: Locale, unmounted: boolean
const t = (key: string) => messages[locale].mtmAttendance[key] as string
const button = (key: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === t(key))!
const field = (key: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#attendance-branch-${key}`)!
const metric = (key: string) => container.querySelector(`[data-testid="attendance-branch-${key}-value"]`)?.textContent
const rows = () => Array.from(container.querySelectorAll('[data-testid="attendance-branch-row"]'))
async function render(language: Locale = locale) {
  locale = language
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceBranchReport) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(key: string) { await act(async () => button(key).click()) }
async function edit(key: string, value: string) { await act(async () => {
  const input = field(key)
  Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }))
}) }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `attendance-branch-report-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1300px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
}
beforeEach(() => { locale = "en"; unmounted = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockReset(); fetchMock.mockImplementation(defaultFetch); vi.stubGlobal("fetch", fetchMock) })
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("attendance branch report using the shared historical projection", () => {
  it.each(languages)("renders %s with historical branches and distinct absent-location states", async language => {
    await render(language)
    expect(container.querySelector("h1")?.textContent).toBe(t("branchReportTitle"))
    expect(rows()).toHaveLength(4)
    expect(metric("marks")).toBe("5"); expect(metric("employees")).toBe("3")
    expect(metric("outside")).toBe("1"); expect(metric("uncertain")).toBe("1")
    expect(rows()[0].textContent).toContain(branch.name)
    expect(container.textContent).toContain(t("locationReportUnavailable")); expect(container.textContent).toContain(t("locationReportNoConsent"))
    expect(rows().find(row => row.textContent?.includes(t("locationReportNotRecorded")))?.querySelectorAll("td")).toHaveLength(5)
    expect(Array.from(rows().find(row => row.textContent?.includes(t("locationReportNotRecorded")))!.querySelectorAll("td")).every(cell => cell.textContent?.endsWith("—"))).toBe(true)
    expect(container.textContent).toContain(t("branchReportBreakPrivacy"))
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_|private-(?:branch|revision|event)-|latitude|longitude/)
    for (const name of ["from", "to", "team", "employee"]) expect(container.querySelector(`label[for="attendance-branch-${name}"]`)?.textContent).toBeTruthy()
    capture()
  })
  it("filters summary and export identically without shrinking the directory", async () => {
    await render(); await edit("team", "north")
    expect(rows()).toHaveLength(1); expect(metric("marks")).toBe("2"); expect(metric("employees")).toBe("1")
    expect(field("team").querySelectorAll("option")).toHaveLength(3)
    fetchMock.mockResolvedValueOnce(response(null, 409, "MTM_ATTENDANCE_EXPORT_CHANGED")); await click("exportExcel")
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ config: { mode: "BRANCH", columns: ["branch", "arrivals", "departures", "employees", "outside", "uncertain"], filters: { from: TODAY, to: TODAY, form: "ALL", teamId: "north" } }, snapshot, format: "xlsx", locale: "en" })
    expect(container.textContent).toContain(t("exportChanged")); expect(button("exportPdf").disabled).toBe(true)
  })
  it("preserves unknown historical locations as dashes, including cards and totals", async () => {
    await render(); await edit("employee", "c")
    expect(rows()).toHaveLength(1); expect(metric("marks")).toBe("—"); expect(metric("employees")).toBe("—")
    expect(metric("outside")).toBe("—"); expect(metric("uncertain")).toBe("—")
    const totals = container.querySelector('[data-testid="attendance-branch-totals"]')!
    expect(totals.textContent).toContain("—"); expect(totals.textContent).not.toContain(": 0")
  })
  it("keeps the selected employee when a refreshed server scope no longer includes them", async () => {
    await render(); await edit("employee", "a")
    fetchMock.mockResolvedValueOnce(response({ today: TODAY })).mockResolvedValueOnce(response({ ...fixture(), rows: fixture().rows.filter(row => row.employeeId !== "a") }))
    await submit()
    expect(field("employee").value).toBe("a"); expect(container.textContent).not.toContain(branch.name)
    expect(container.textContent).toContain(t("viewsScopeUnavailable")); expect(container.textContent).toContain(t("viewsUnavailableEmployee")); expect(rows()).toHaveLength(0)
  })
  it("refreshes the same period and selection after a language change", async () => {
    await render(); await edit("employee", "a"); await edit("from", "2026-10-12"); await submit(); await render("ru")
    expect(field("from").value).toBe("2026-10-12"); expect(field("employee").value).toBe("a")
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("from=2026-10-12")
    expect(metric("marks")).toBe("4")
  })
  it.each([401, 403, 404])("clears all report facts and names after export access loss (%s)", async status => {
    await render(); fetchMock.mockResolvedValueOnce(response(null, status)); await click("exportPdf")
    expect(container.textContent).not.toContain(branch.name); expect(container.textContent).not.toContain("Демо-сотрудник")
    expect(container.textContent).toContain(t("reportAccessUnavailable")); expect(metric("marks")).toBe("—")
    expect(button("exportExcel").disabled).toBe(true); expect(button("reportApply").disabled).toBe(true)
  })
  it("never renders private server errors or malformed report dates", async () => {
    fetchMock.mockResolvedValueOnce(response({ today: TODAY })).mockResolvedValueOnce(response({ rows: [], from: "invalid", to: TODAY, asOf: "invalid" }))
    await render(); expect(rows()).toHaveLength(0); expect(container.textContent).toContain(t("reportLoadError"))
    expect(container.textContent).not.toContain("PRIVATE_SERVER_TRACE"); await click("reportReload"); expect(rows()).toHaveLength(4)
  })
  it("rejects inverted and oversized periods before loading", async () => {
    await render(); const calls = fetchMock.mock.calls.length
    await edit("to", "2026-10-01"); await submit(); expect(container.textContent).toContain(t("reportRangeInvalid"))
    await edit("to", "2027-10-14"); await submit(); expect(fetchMock.mock.calls).toHaveLength(calls)
  })
  it("aborts a superseded request and ignores its late private response", async () => {
    await render(); let done!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { done = resolve })); await submit()
    const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal
    await render("az"); expect(signal?.aborted).toBe(true)
    await act(async () => done(response(null, 403)))
    expect(container.textContent).not.toContain(t("reportAccessUnavailable")); expect(rows()).toHaveLength(4)
  })
  it("aborts pending reads when the screen unmounts", async () => {
    let done!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { done = resolve })); await render()
    const signal = fetchMock.mock.calls[0][1]?.signal
    await act(async () => root.unmount()); unmounted = true; expect(signal?.aborted).toBe(true)
    await act(async () => done(response({ today: TODAY }))); expect(fetchMock.mock.calls).toHaveLength(1)
  })
})
