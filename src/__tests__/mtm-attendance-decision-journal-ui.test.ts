// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceDecisionJournal } from "@/components/mtm/attendance-decision-journal"
import { buildAttendanceDecisionJournalTable } from "@/lib/mtm/attendance-decision-journal-table"
import type { AttendanceDecisionJournal, AttendanceDecisionJournalItem, AttendanceDecisionJournalQuery } from "@/lib/mtm/attendance-decision-journal-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["az", "ru", "en"].map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const query: AttendanceDecisionJournalQuery = { from: "2026-10-01", to: "2026-10-31", status: "ALL" }
const item = (index = 1): AttendanceDecisionJournalItem => ({
  id: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`, employeeId: `fictional-${index}`, employeeName: index === 1 ? "Aylin Demo" : index === 2 ? "Murad Demo" : `Leyla Demo ${index}`, teamName: "Demo North",
  kind: { key: "ANNUAL_LEAVE", code: "O", names: { ru: "Ежегодный отпуск", az: "İllik məzuniyyət", en: "Annual leave" } }, requestKind: index === 2 ? "HR_RECORD" : "ANNUAL_LEAVE", unit: "DAYS", startDate: "2026-10-05", endDate: "2026-10-09", startTime: null, endTime: null, timezone: "Asia/Baku", status: index === 1 ? "APPROVED" : index === 2 ? "CANCELLED" : "PENDING",
  source: index === 2 ? "HR" : "EMPLOYEE", submittedAt: "2026-10-01T08:00:00.000Z", submittedByName: index === 2 ? "Nigar Demo" : index === 1 ? "Aylin Demo" : `Leyla Demo ${index}`,
  decision: index < 3 ? { at: "2026-10-02T06:30:00.000Z", byName: "Nigar Demo" } : null,
  cancellation: index === 2 ? { at: "2026-10-13T11:00:00.000Z", byName: "Nigar Demo" } : null,
})
function fixture(count = 3, filters = query): AttendanceDecisionJournal {
  return { items: Array.from({ length: count }, (_, index) => item(index + 1)), snapshot: { id: "a".repeat(64), asOf: "2026-10-13T12:00:00.000Z", query: filters } }
}
const response = (data: AttendanceDecisionJournal = fixture(), status = 200, code = "INTERNAL_PRIVATE_TRACE") => new Response(JSON.stringify({ success: status < 400, data, code }), { status })
const binary = (format: "xlsx" | "pdf") => new Response("fixture-file", { headers: { "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })
const fetchMock = vi.fn<typeof fetch>(), createUrl = vi.fn(() => "blob:fixture-journal"), revokeUrl = vi.fn()
let root: Root, container: HTMLDivElement, locale: "az" | "ru" | "en"
let clicked: { download: string; href: string }[]
const t = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "mtmAttendance" })(key, values)
function button(key: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === t(key))! }
async function click(key: string) { await act(async () => button(key).click()) }
async function render(language = locale) {
  locale = language
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceDecisionJournal) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function edit(id: "from" | "to" | "status", value: string) { await act(async () => {
  const field = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#attendance-journal-${id}`)!
  const prototype = id === "status" ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
  field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }))
}) }
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
const exportCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
const rows = () => [...container.querySelectorAll('[data-testid="attendance-journal-row"]')]
function renderedCells() { return rows().map(row => [...row.querySelectorAll("td")].map(cell => cell.lastElementChild!.textContent)) }
function capture() {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("input").forEach((field, index) => clone.querySelectorAll("input")[index].setAttribute("value", field.value))
  container.querySelectorAll("select").forEach((select, index) => [...clone.querySelectorAll("select")[index].options].forEach(option => { if (option.value === select.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") }))
  writeFileSync(join(directory, `attendance-decision-journal-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)
}
beforeEach(() => {
  locale = "ru"; clicked = []; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(async () => response()); createUrl.mockClear(); revokeUrl.mockClear()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }))
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ download: this.download, href: this.href }) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("actual read-only attendance decision journal", () => {
  it.each(["ru", "az", "en"] as const)("renders the same six safe cells and counts as the export projection in %s", async language => {
    await render(language)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/mtm/attendance/decisions")
    expect((container.querySelector("input") as HTMLInputElement).value).toBe(query.from)
    expect(container.querySelector("select")!.value).toBe("ALL")
    const expected = buildAttendanceDecisionJournalTable(fixture(), language, t)
    expect(renderedCells()).toEqual(expected.rows.map(row => row.cells))
    expect(container.textContent).toContain(expected.totals[0])
    for (const detail of expected.details) expect(container.textContent).toContain(detail)
    expect(container.textContent).toContain(t("journalSourceHr")); expect(container.textContent).toContain(t("journalSourceEmployee"))
    expect(container.querySelector('a[href="/mtm/attendance/requests"]')).toBeNull()
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.textContent).not.toMatch(/mtmAttendance\.|undefined/)
    capture()
  })
  it("ignores unexpected private fields in a report response", async () => {
    const data = fixture()
    Object.assign(data.items[0], { reason: "PRIVATE_REASON", decisionNote: "PRIVATE_NOTE", attachmentIds: ["PRIVATE_DOCUMENT"], gps: "40.4093,49.8671", recording: { userId: "PRIVATE_AUTH_ID" } })
    fetchMock.mockResolvedValueOnce(response(data)); await render()
    expect(container.textContent).not.toMatch(/PRIVATE_|40\.4093|49\.8671/)
    expect(container.querySelector('a[href*="attachments"]')).toBeNull()
    expect(exportCalls()).toHaveLength(0)
  })
  it("limits DOM rows to fifty while totals and snapshot still cover the full filtered result", async () => {
    fetchMock.mockResolvedValueOnce(response(fixture(121))); await render()
    expect(rows()).toHaveLength(50); expect(container.textContent).toContain(t("journalCount", { count: 121 }))
    expect(button("journalPrevious").disabled).toBe(true)
    await click("journalNext"); expect(rows()).toHaveLength(50); expect(rows()[0].textContent).toContain("Leyla Demo 51")
    await click("journalNext"); expect(rows()).toHaveLength(21); expect(button("journalNext").disabled).toBe(true)
    await click("journalPrevious"); expect(rows()[0].textContent).toContain("Leyla Demo 51")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  // Owner, 2026-10-16: the old screens' own «Show» button; filters now apply themselves.
  it("loads the new period and status by itself shortly after a change, with no button to press", async () => {
    await render(); expect(button("journalApply")).toBeUndefined()
    const next = { from: "2026-10-01", to: "2026-10-31", status: "CANCELLED" as const }
    fetchMock.mockResolvedValueOnce(response(fixture(0, next)))
    await edit("status", "CANCELLED")
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)) })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("status=CANCELLED")
    expect(container.textContent).toContain(t("journalEmpty"))
  })
  it("disables exports for draft filters and submits the full explicit new period/status", async () => {
    await render(); await edit("from", "2026-11-01"); await edit("to", "2026-11-30"); await edit("status", "CANCELLED")
    expect(button("exportExcel").disabled).toBe(true); await click("exportExcel"); expect(exportCalls()).toHaveLength(0)
    expect(container.textContent).toContain(t("journalDraftHint"))
    const next = { from: "2026-11-01", to: "2026-11-30", status: "CANCELLED" as const }
    fetchMock.mockResolvedValueOnce(response(fixture(0, next))); await submit()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/decisions?from=2026-11-01&to=2026-11-30&status=CANCELLED")
    expect(container.textContent).toContain(t("journalEmpty")); expect(container.textContent).toContain(t("journalCount", { count: 0 }))
    expect(button("exportExcel").disabled).toBe(false)
  })
  it.each(["reverse", "too-long", "invalid"])("rejects a %s date range before a request", async failure => {
    await render()
    await edit("from", failure === "too-long" ? "2024-01-01" : failure === "reverse" ? "2026-11-30" : "")
    await submit(); expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(t("journalInvalidPeriod"))
  })
  it.each(["xlsx", "pdf"] as const)("downloads %s with the exact loaded snapshot and cleans up the blob", async format => {
    await render(); fetchMock.mockResolvedValueOnce(binary(format)); await click(format === "xlsx" ? "exportExcel" : "exportPdf")
    expect(exportCalls()).toHaveLength(1)
    expect(JSON.parse(String(exportCalls()[0][1]?.body))).toEqual({ snapshot: fixture().snapshot, format, locale: "ru" })
    expect(clicked).toEqual([{ download: `attendance-decisions-2026-10-01-2026-10-31.${format}`, href: "blob:fixture-journal" }])
    expect(createUrl).toHaveBeenCalledTimes(1); expect(revokeUrl).toHaveBeenCalledWith("blob:fixture-journal")
    expect(document.querySelector('a[download]')).toBeNull()
    expect(container.textContent).toContain(t("exportReady"))
  })
  it("does not silently export newer data after a snapshot conflict", async () => {
    await render(); fetchMock.mockResolvedValueOnce(response(fixture(), 409, "MTM_ATTENDANCE_JOURNAL_CHANGED")); await click("exportExcel")
    expect(container.textContent).toContain(t("journalChanged")); expect(button("exportPdf").disabled).toBe(true)
    await click("exportPdf"); expect(exportCalls()).toHaveLength(1); expect(createUrl).not.toHaveBeenCalled()
    await edit("status", "APPROVED"); await edit("status", "ALL")
    expect(container.textContent).toContain(t("journalChanged")); expect(button("exportPdf").disabled).toBe(true)
    const latest = fixture(); latest.snapshot.id = "b".repeat(64)
    fetchMock.mockResolvedValueOnce(response(latest)); await click("reportReload")
    fetchMock.mockResolvedValueOnce(binary("pdf")); await click("exportPdf")
    expect(JSON.parse(String(exportCalls()[1][1]?.body)).snapshot.id).toBe("b".repeat(64))
  })
  it.each([401, 403, 404])("clears all private rows after a %s export refusal", async status => {
    await render(); fetchMock.mockResolvedValueOnce(response(fixture(), status)); await click("exportExcel")
    expect(rows()).toHaveLength(0); expect(container.textContent).not.toContain("Aylin Demo")
    expect(container.querySelector("form")).toBeNull(); expect(button("exportPdf")).toBeUndefined()
    expect(container.textContent).toContain(t("reportAccessUnavailable"))
  })
  it("clears a previously loaded report when refresh reveals denied access", async () => {
    await render(); fetchMock.mockResolvedValueOnce(response(fixture(), 403)); await submit()
    expect(rows()).toHaveLength(0); expect(container.textContent).not.toContain("Nigar Demo")
    expect(container.textContent).toContain(t("reportAccessUnavailable"))
  })
  it.each(["too-large", "bad-json", "network"])("offers an honest retry for a %s load failure", async failure => {
    if (failure === "too-large") fetchMock.mockResolvedValueOnce(response(fixture(), 422, "MTM_ATTENDANCE_JOURNAL_TOO_LARGE"))
    else if (failure === "bad-json") fetchMock.mockResolvedValueOnce(new Response("invalid-json"))
    else fetchMock.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_DETAIL"))
    await render(); expect(rows()).toHaveLength(0); expect(container.textContent).not.toContain("PRIVATE_NETWORK_DETAIL")
    expect(container.textContent).toContain(t(failure === "too-large" ? "journalTooLarge" : "journalLoadError"))
    await click("reportReload"); expect(rows()).toHaveLength(3)
  })
  it("shows loading and aborts an unfinished read on unmount", async () => {
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {})); await render()
    expect(container.textContent).toContain(t("journalLoading")); expect(button("journalApply")).toBeUndefined(); expect(container.querySelector<HTMLInputElement>("#attendance-journal-from")!.disabled).toBe(false)
    const signal = fetchMock.mock.calls[0][1]?.signal
    await act(async () => root.render(null)); expect(signal?.aborted).toBe(true)
  })
  it.each(["locale", "draft", "unmount"])("aborts an export on %s change and ignores its late response", async change => {
    await render(); let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finish = done })); await click("exportExcel")
    const signal = exportCalls()[0][1]?.signal
    if (change === "locale") await render("en")
    else if (change === "draft") await edit("status", "APPROVED")
    else await act(async () => root.render(null))
    expect(signal?.aborted).toBe(true)
    await act(async () => finish(binary("xlsx")))
    expect(createUrl).not.toHaveBeenCalled(); expect(clicked).toHaveLength(0)
    if (change === "locale") {
      expect(button("exportExcel").disabled).toBe(false)
      expect(renderedCells()).toEqual(buildAttendanceDecisionJournalTable(fixture(), "en", t).rows.map(row => row.cells))
    }
  })
  it("rejects successful HTTP responses with the wrong file type or empty body", async () => {
    await render(); fetchMock.mockResolvedValueOnce(new Response("{private:1}", { headers: { "content-type": "application/json" } })); await click("exportExcel")
    expect(createUrl).not.toHaveBeenCalled(); expect(container.textContent).toContain(t("exportFailed"))
    fetchMock.mockResolvedValueOnce(new Response("", { headers: { "content-type": "application/pdf" } })); await click("exportPdf")
    expect(createUrl).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("private:1")
  })
})
