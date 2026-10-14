// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceDayKindPresetCodes, defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { redirectToAttendanceTab } from "@/lib/mtm/attendance-legacy-redirect"

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`) }))
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const azMessages = JSON.parse(readFileSync("messages/az.json", "utf8"))
const p = (key: string) => key.split(".").reduce((node, part) => node[part], ru.personnel) as string
const kinds = attendanceDayKindPresetCodes(defaultAttendanceDayKinds(key => ({ ru: ru.mtmAttendance[`dayKindName${key}`], az: "x", en: "x" })), "RU")
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
const reportFor = (from: string, to: string) => buildMtmAttendanceReport({ from, to, now: "2026-10-14T08:00:00Z", rules: [], calendar: [], dayKinds: kinds,
  employees: [{ id: "nigar", name: "Нигяр Бабаева", teamId: "centre", teamName: "Офис «Центр»" }, { id: "rashad", name: "Рашад Алиев", teamId: "north", teamName: "Филиал «Север»" }],
  workdays: [{ id: "n14", agentId: "nigar", workDate: "2026-10-14", status: "STARTED", startedAt: at("2026-10-14", "09:25"), completedAt: null, totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at("2026-10-14", "09:25") }] },
  { id: "n13", agentId: "nigar", workDate: "2026-10-13", status: "COMPLETED", startedAt: at("2026-10-13", "09:00"), completedAt: at("2026-10-13", "18:00"), totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at("2026-10-13", "09:00") }, { type: "FINISH", occurredAt: at("2026-10-13", "18:00") }] }] })
const json = (body: unknown) => new Response(JSON.stringify(body))
const fetchMock = vi.fn<typeof fetch>(async input => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/mtm/attendance/rules") return json({ success: true, data: { today: "2026-10-14", canManageRules: true } })
  if (url.pathname === "/api/v1/mtm/attendance/report") return json({ success: true, data: reportFor(url.searchParams.get("from")!, url.searchParams.get("to")!) })
  return json({ success: true, data: { items: [], views: [], schedules: [] } })
})
let container: HTMLDivElement, root: Root
async function render(props: Parameters<typeof MtmAttendanceReportWorkspace>[0]) {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru },
    createElement(MtmAttendanceReportWorkspace, props))))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const reportCalls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://crm.test")).filter(url => url.pathname.endsWith("/report"))

beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals() })

describe("Personnel → Timesheet month", () => {
  it("opens on the current month with letters per day, totals and none of the former overview or settings", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-10-31")
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("октябрь 2026")
    const people = Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]'))
    expect(people).toHaveLength(2)
    const nigar = people.find(row => row.textContent?.includes("Нигяр"))!
    const cells = Array.from(nigar.querySelectorAll<HTMLButtonElement>('[data-testid="attendance-month-cell"]'))
    expect(cells).toHaveLength(31)
    expect(cells[12].textContent).toBe("Я")    // 13 Oct, worked
    expect(cells[2].textContent).toBe("В")     // 3 Oct, Saturday
    expect(cells[0].textContent).toBe("НН")    // 1 Oct, no mark and no reason
    // The former single page stacked these under the report; they are tabs now.
    expect(container.querySelector('[data-testid="attendance-arrived"]')).toBeNull()
    for (const key of ["kindsTitle", "hrTitle"]) {
      expect(ru.mtmAttendance[key]).toBeTruthy()
      expect(container.textContent).not.toContain(ru.mtmAttendance[key])
    }
  })

  it("opens a day card from a cell with the day's marks and one action: fix that day", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const nigar = Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]')).find(row => row.textContent?.includes("Нигяр"))!
    await act(async () => nigar.querySelectorAll<HTMLButtonElement>('[data-testid="attendance-month-cell"]')[12].click())
    const card = document.querySelector<HTMLElement>('[data-testid="attendance-day-popover"]')!
    expect(card.textContent).toContain("Нигяр Бабаева")
    const marks = card.querySelector('[data-testid="attendance-day-marks"]')!
    expect(Array.from(marks.querySelectorAll("li")).map(item => item.textContent)).toEqual([`09:00${ru.mtmAttendance.reportEventStart}`, `18:00${ru.mtmAttendance.reportEventFinish}`])
    const links = Array.from(card.querySelectorAll("a"))
    expect(links.map(link => [link.textContent, link.getAttribute("href")])).toEqual([[p("fixDay"), "/mtm/attendance/recordings?date=2026-10-13&employeeId=nigar"]])
  })

  it("filters people by a deviation, counts them on the button and dims the other days", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const late = container.querySelector<HTMLButtonElement>('[data-testid="attendance-filter-late"]')!
    expect(late.textContent).toBe(`${p("kpiLate")} · 1`)
    // 13 Oct is nine hours against the default eight, but no threshold is set: not overtime.
    expect(container.querySelector('[data-testid="attendance-filter-overtime"]')!.textContent).toBe(`${p("tabs.overtime")} · 0`)
    expect(container.querySelector('[data-testid="attendance-filter-missing-finish"]')!.textContent).toBe(`${p("kpiMissing")} · 0`)
    await act(async () => late.click())
    expect(late.getAttribute("aria-pressed")).toBe("true")
    const people = Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]'))
    expect(people.map(row => row.querySelector("th")!.textContent)).toEqual(["Нигяр БабаеваОфис «Центр»"])
    const cells = Array.from(people[0].querySelectorAll<HTMLElement>('[data-testid="attendance-month-cell"]'))
    expect(cells[13].dataset.dimmed).toBeUndefined()   // 14 Oct, 25 minutes late
    expect(cells[12].dataset.dimmed).toBe("true")      // 13 Oct, on time
    await act(async () => late.click())
    expect(container.querySelectorAll('[data-testid="attendance-month-person"]')).toHaveLength(2)
  })

  it("a filter link opens with that filter on; an empty filter says so", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH", initialFilter: "missing-finish" })
    expect(container.querySelector('[data-testid="attendance-filter-missing-finish"]')!.getAttribute("aria-pressed")).toBe("true")
    expect(container.querySelectorAll('[data-testid="attendance-month-person"]')).toHaveLength(0)
    expect(container.textContent).toContain(p("filterEmpty"))
  })

  it("a day link opens that day's month and its card for that person", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH", initialDate: "2026-10-13", initialEmployeeId: "nigar" })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    const card = document.querySelector<HTMLElement>('[data-testid="attendance-day-popover"]')!
    expect(card.textContent).toContain("Нигяр Бабаева")
    expect(card.querySelector("a")!.getAttribute("href")).toBe("/mtm/attendance/recordings?date=2026-10-13&employeeId=nigar")
    expect(container.textContent).toContain(p("onlyEmployee").replace("{name}", "Нигяр Бабаева"))
  })

  it("keeps the rarer reports under More, not as tabs", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    expect(container.querySelector('[data-testid="attendance-tabs"]')).toBeNull()
    expect(container.querySelector('[data-testid="attendance-timesheet-more"]')!.textContent).toBe(p("more"))
    expect(container.querySelector('[data-testid="attendance-timesheet-extras"]')).toBeNull()
  })

  it("moves by month with the arrows", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${p("previousMonth")}"]`)!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-09-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-09-30")
  })

})

describe("Timesheet in Azerbaijani", () => {
  it("names the month and weekdays in Azerbaijani, never the root-locale 'M10'", async () => {
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "az", timeZone: "Asia/Baku", messages: azMessages },
      createElement(MtmAttendanceReportWorkspace, { layout: "timesheet", initialForm: "MONTH" }))))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("oktyabr 2026")
    const text = container.textContent ?? ""
    expect(text).not.toMatch(/M\d{2}\b/)
    expect(text).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)
  })
})

describe("former attendance pages", () => {
  it("redirect to their tab and keep every query parameter a notification carried", async () => {
    await expect(redirectToAttendanceTab("settings", "review", Promise.resolve({ caseId: "c-1", tab: "ignored", ids: ["a", "b"] }))).rejects.toThrow()
    expect(redirect).toHaveBeenLastCalledWith("/mtm/attendance/settings?caseId=c-1&ids=a&ids=b&tab=review")
  })
})
