// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceEmployee, type MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const at = (clock: string, date = TODAY) => `${date}T${clock}:00+04:00`
const employees = [
  { id: "a", name: "Aysel Aliyeva", teamId: "north", teamName: "North" },
  { id: "b", name: "Leyla Mammadova", teamId: "north", teamName: "North" },
  { id: "c", name: "Samir Karimov", teamId: "south", teamName: "South" },
  { id: "d", name: "Rauf Hasanov", teamId: "south", teamName: "South" },
]
const privatePause = { type: "PAUSE", occurredAt: at("13:00"), latitude: 40.987654, longitude: 49.123456, note: "PRIVATE_PAUSE_NOTE", payload: { secret: true } }
const workdays: MtmAttendanceWorkday[] = [
  { id: "closed", agentId: "a", workDate: TODAY, status: "COMPLETED", startedAt: at("09:21"), completedAt: at("17:00"), totalPausedSeconds: 3600,
    events: [{ type: "START", occurredAt: at("09:21"), claimedAt: at("09:19"), serverReceivedAt: at("10:00") }, privatePause,
      { type: "RESUME", occurredAt: at("14:00") }, { type: "FINISH", occurredAt: at("17:00"), serverReceivedAt: at("17:01") }] },
  { id: "open", agentId: "b", workDate: TODAY, status: "STARTED", startedAt: at("09:00"), completedAt: null, totalPausedSeconds: 0, events: [{ type: "START", occurredAt: at("09:00") }] },
  { id: "past-open", agentId: "b", workDate: "2026-10-12", status: "STARTED", startedAt: at("09:00", "2026-10-12"), completedAt: null, totalPausedSeconds: 0, events: [{ type: "START", occurredAt: at("09:00", "2026-10-12") }] },
  { id: "invalid", agentId: "d", workDate: TODAY, status: "COMPLETED", startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 0, events: [] },
]
function fixture(from = TODAY, to = TODAY, people: MtmAttendanceEmployee[] = employees) {
  return buildMtmAttendanceReport({ employees: people, from, to, now: at("19:00"), rules: [], workdays,
    calendar: [{ id: "holiday", date: "2026-10-20", kind: "COMPANY_HOLIDAY", name: "Company day", teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null }] })
}
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_SERVER_ERROR" }), { status })
const fetchMock = vi.fn<typeof fetch>()
async function defaultFetch(url: string | URL | Request) {
  const parsed = new URL(String(url), "https://attendance.test")
  if (parsed.pathname.endsWith("/rules")) return response({ today: TODAY })
  return response(fixture(parsed.searchParams.get("from")!, parsed.searchParams.get("to")!))
}
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
let container: HTMLDivElement
let root: Root
const field = (name: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#attendance-report-${name}`)!
const button = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text)!
const card = (name: string) => container.querySelector(`[data-testid="attendance-${name}-value"]`)!.textContent
const dayRows = () => Array.from(container.querySelectorAll('[data-testid="attendance-day-row"]'))
async function render(locale = "en") {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceReportWorkspace) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function edit(name: string, value: string) {
  const input = field(name)
  await act(async () => {
    Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function click(text: string) { await act(async () => button(text).click()) }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
function capture(name: string, locale: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `attendance-report-${name}-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance report</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1600px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`, "utf8")
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(defaultFetch)
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("attendance report workspace on the real row calculation", () => {
  it.each(["ru", "az", "en"])("renders the real day, cards and privacy boundaries in %s", async (locale) => {
    await render(locale)
    const t = messages(locale).mtmAttendance
    expect(field("from").value).toBe(TODAY)
    expect(field("to").value).toBe(TODAY)
    expect(dayRows()).toHaveLength(4)
    expect(card("arrived")).toBe("2")
    expect(card("late")).toBe("1")
    expect(card("absent")).toBe("1")
    expect(card("missing-finish")).toBe("0")
    expect(container.textContent).toContain(t.reportInvalidFacts)
    expect(container.textContent).toContain(t.reportProvisional)
    expect(container.textContent).toContain("16:39")
    expect(container.textContent).toContain("0:21")
    expect(container.textContent).not.toMatch(/PRIVATE_|40\.987654|49\.123456|latitude|longitude|mtmAttendance\./)
    expect(dayRows()[3].textContent).toContain("—")
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain(t.reportTotalsTitle)
    for (const name of ["from", "to", "team", "employee"]) expect(container.querySelector(`label[for="attendance-report-${name}"]`)?.textContent).toBeTruthy()
    capture("day", locale)
  })

  it("uses the same filtered rows for cards and totals without shrinking the directory", async () => {
    await render()
    await edit("team", "north")
    expect(dayRows()).toHaveLength(2)
    const expected = summarizeMtmAttendanceRows(filterMtmAttendanceRows(fixture().rows, { teamId: "north" }))
    expect(card("arrived")).toBe(String(expected.arrivedCount))
    expect(card("late")).toBe(String(expected.lateCount))
    expect(card("absent")).toBe(String(expected.absentCount))
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain(formatAttendanceDuration(expected.workedSeconds))
    expect(field("team").querySelectorAll("option")).toHaveLength(3)
    expect(field("employee").querySelectorAll("option")).toHaveLength(3)
    await edit("employee", "b")
    expect(dayRows()).toHaveLength(1)
    expect(card("arrived")).toBe("1")
    expect(card("late")).toBe("0")
    expect(field("employee").querySelectorAll("option")).toHaveLength(3)
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it("renders late/early and absence forms as slices of the same base snapshot", async () => {
    await render("ru")
    const t = messages("ru").mtmAttendance
    await click(t.reportLateEarly)
    expect(dayRows()).toHaveLength(1)
    expect(dayRows()[0].textContent).toContain("Aysel Aliyeva")
    expect(card("late")).toBe("1")
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain("6:39")
    expect(field("employee").querySelectorAll("option")).toHaveLength(5)
    capture("late-early", "ru")
    await click(t.reportAbsences)
    expect(dayRows()).toHaveLength(1)
    expect(dayRows()[0].textContent).toContain("Samir Karimov")
    expect(card("arrived")).toBe("0")
    expect(card("absent")).toBe("1")
    expect(fetchMock.mock.calls).toHaveLength(2)
    capture("absences", "ru")
  })

  it("shows both phone and receipt clocks in the journal without substituting missing server time", async () => {
    await render("ru")
    await click(messages("ru").mtmAttendance.reportJournal)
    const events = container.querySelectorAll('[data-testid="attendance-journal-event"]')
    expect(events).toHaveLength(5)
    expect(events[0].textContent).toContain("09:19:00")
    expect(events[0].textContent).toContain("10:00:00")
    expect(events[1].textContent).toContain("—")
    expect(container.textContent).not.toMatch(/PRIVATE_|40\.987654|49\.123456/)
    expect(card("arrived")).toBe("2")
    capture("journal", "ru")
  })

  it("loads the server day's whole month and shows each employee × date with a legend", async () => {
    await render("ru")
    const t = messages("ru").mtmAttendance
    await click(t.reportMonth)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/report?from=2026-10-01&to=2026-10-31&form=ALL")
    expect(field("month").value).toBe("2026-10")
    expect(container.querySelectorAll('[data-testid="attendance-month-person"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-testid="attendance-month-grid"] thead th')).toHaveLength(35)
    expect(container.querySelector(`[aria-label="${t.reportLegend}"]`)?.textContent).toContain(t.reportMissingFinish)
    expect(container.textContent).toContain(t.reportDayRecords)
    expect(card("missing-finish")).toBe("1")
    expect(container.textContent).toContain(t.reportPartial)
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain("16:39")
    capture("month", "ru")
    await edit("month", "2026-11")
    await submit()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/report?from=2026-11-01&to=2026-11-30&form=ALL")
    expect(container.querySelectorAll('[data-testid="attendance-month-grid"] thead th')).toHaveLength(34)
    await click(t.reportDay)
    expect(field("from").value).toBe("2026-11-01")
    expect(field("to").value).toBe("2026-11-30")
  })

  it("marks past open duration unknown and totals partial on a multi-day report", async () => {
    await render()
    await edit("from", "2026-10-12")
    await submit()
    expect(dayRows()).toHaveLength(8)
    expect(card("missing-finish")).toBe("1")
    const missing = dayRows().find((row) => row.textContent?.includes("Missing finish"))!
    expect(missing.textContent).toContain("worked time is unknown")
    expect(missing.textContent).toContain("—")
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain("Totals are incomplete")
    expect(container.textContent).toContain("day records")
  })

  it("paginates displayed records while cards and totals cover all filtered records", async () => {
    const people = Array.from({ length: 55 }, (_, index) => ({ id: `person-${index}`, name: `Employee ${index}`, teamId: null, teamName: null }))
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/rules") ? response({ today: TODAY }) : response(fixture(TODAY, TODAY, people)))
    await render()
    expect(dayRows()).toHaveLength(50)
    expect(card("absent")).toBe("55")
    expect(container.textContent).toContain("Showing 1–50 of 55")
    await click("Next")
    expect(dayRows()).toHaveLength(5)
    expect(card("absent")).toBe("55")
    expect(container.textContent).toContain("Showing 51–55 of 55")
    expect(container.querySelector('[data-testid="attendance-report-totals"]')?.textContent).toContain("55 day records")
  })

  it("rejects invalid range without a fetch and labels the still displayed period", async () => {
    await render()
    await edit("to", "2026-10-01")
    await submit()
    expect(fetchMock.mock.calls).toHaveLength(2)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.reportRangeInvalid)
    expect(dayRows()).toHaveLength(4)
  })

  it("clears stale results and the employee directory after access is revoked", async () => {
    await render()
    fetchMock.mockResolvedValueOnce(response(null, 403, "MTM_ATTENDANCE_FORBIDDEN"))
    await submit()
    expect(dayRows()).toHaveLength(0)
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    expect(field("employee").querySelectorAll("option")).toHaveLength(1)
    expect(card("arrived")).toBe("—")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.reportAccessUnavailable)
  })

  it("aborts an earlier range request and ignores its late result", async () => {
    await render()
    let finishOld!: (value: Response) => void
    const old = new Promise<Response>((resolve) => { finishOld = resolve })
    fetchMock.mockImplementation(async (url) => String(url).includes("to=2026-10-14") ? old : defaultFetch(url))
    await edit("to", "2026-10-14")
    await submit()
    const oldSignal = fetchMock.mock.calls.at(-1)?.[1]?.signal
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    await edit("to", "2026-10-15")
    await submit()
    expect(oldSignal?.aborted).toBe(true)
    expect(dayRows()).toHaveLength(12)
    await act(async () => finishOld(response(fixture(TODAY, "2026-10-14"))))
    expect(dayRows()).toHaveLength(12)
    expect(field("to").value).toBe("2026-10-15")
  })

  it("aborts its pending load on unmount", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    await render()
    const signal = fetchMock.mock.calls[0][1]?.signal
    await act(async () => root.render(null))
    expect(signal?.aborted).toBe(true)
  })

  it("shows a bounded-report error without server internals or stale totals", async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/rules") ? response({ today: TODAY }) : response(null, 400, "MTM_ATTENDANCE_REPORT_TOO_LARGE"))
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.reportTooLarge)
    expect(container.textContent).not.toContain("PRIVATE_SERVER_ERROR")
    expect(container.querySelector('[data-testid="attendance-report-totals"]')).toBeNull()
  })

  it("shares an exact duration notation with exports, without rounding away seconds", () => {
    expect(formatAttendanceDuration(0)).toBe("0:00")
    expect(formatAttendanceDuration(601)).toBe("0:10:01")
    expect(formatAttendanceDuration(3661)).toBe("1:01:01")
    expect(formatAttendanceDuration(27540)).toBe("7:39")
    expect(formatAttendanceDuration(null)).toBe("—")
  })
})
