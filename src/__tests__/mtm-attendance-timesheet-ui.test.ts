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
import type { MtmAttendanceCorrection, MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import type { WorkforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { readHint } from "./helpers/hint"

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`) }))
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const azMessages = JSON.parse(readFileSync("messages/az.json", "utf8"))
const p = (key: string) => key.split(".").reduce((node, part) => node[part], ru.personnel) as string
const kinds = attendanceDayKindPresetCodes(defaultAttendanceDayKinds(key => ({ ru: ru.mtmAttendance[`dayKindName${key}`], az: "x", en: "x" })), "RU")
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
/**
 * Rashad's month for the signs: on 12 Oct he forgot to mark his finish (hours unknown), and on
 * 13 Oct he forgot it too, asked, and HR approved 18:07 — a correction, as the product's report
 * store projects it from the correction ledger.
 */
function rashadDays(): MtmAttendanceWorkday[] {
  const before: WorkforceWorkdayCorrectionFacts = { id: "r13", workDate: "2026-10-13", status: "STARTED", startedAt: new Date(at("2026-10-13", "08:52")).toISOString(), pausedAt: null, completedAt: null, totalPausedSeconds: 0 }
  const after: WorkforceWorkdayCorrectionFacts = { ...before, status: "COMPLETED", completedAt: new Date(at("2026-10-13", "18:07")).toISOString() }
  const correction: MtmAttendanceCorrection = { id: "c13", requestId: "q13", source: "REQUEST_APPROVAL", occurredAt: new Date(at("2026-10-14", "10:05")).toISOString(),
    reviewer: { id: "hr", name: "HR" }, before: { kind: "WORKDAY", facts: before }, after }
  return [
    { id: "r12", agentId: "rashad", workDate: "2026-10-12", status: "STARTED", startedAt: at("2026-10-12", "09:00"), completedAt: null, totalPausedSeconds: 0, events: [{ type: "START", occurredAt: at("2026-10-12", "09:00") }] },
    { id: "r13", agentId: "rashad", workDate: "2026-10-13", status: "COMPLETED", startedAt: after.startedAt, completedAt: after.completedAt, totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: at("2026-10-13", "08:52") }], correctionProjection: { valid: true, facts: after, pauseIntervals: [], history: [correction] } },
  ] as MtmAttendanceWorkday[]
}
let withSigns = false
const reportFor = (from: string, to: string) => buildMtmAttendanceReport({ from, to, now: "2026-10-14T08:00:00Z", rules: [], calendar: [], dayKinds: kinds,
  employees: [{ id: "nigar", name: "Нигяр Бабаева", position: "Кассир", departmentId: "fin", departmentName: "Финансы", teamId: "centre", teamName: "Офис «Центр»" }, { id: "rashad", name: "Рашад Алиев", teamId: null, teamName: null }],
  workdays: [{ id: "n14", agentId: "nigar", workDate: "2026-10-14", status: "STARTED", startedAt: at("2026-10-14", "09:25"), completedAt: null, totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at("2026-10-14", "09:25") }] },
  { id: "n13", agentId: "nigar", workDate: "2026-10-13", status: "COMPLETED", startedAt: at("2026-10-13", "09:00"), completedAt: at("2026-10-13", "18:00"), totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at("2026-10-13", "09:00") }, { type: "FINISH", occurredAt: at("2026-10-13", "18:00") }] }, ...(withSigns ? rashadDays() : [])] })
const json = (body: unknown) => new Response(JSON.stringify(body))
const fetchMock = vi.fn<typeof fetch>(async input => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/mtm/attendance/rules") return json({ success: true, data: { today, canManageRules: true } })
  if (url.pathname === "/api/v1/mtm/attendance/report") return json({ success: true, data: reportFor(url.searchParams.get("from")!, url.searchParams.get("to")!) })
  if (url.pathname === "/api/v1/mtm/attendance/views") return json({ success: true, data: savedViews })
  return json({ success: true, data: { items: [], views: [], schedules: [] } })
})
let savedViews: unknown[] = []
let today = "2026-10-14"
let container: HTMLDivElement, root: Root
async function render(props: Parameters<typeof MtmAttendanceReportWorkspace>[0]) {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru },
    createElement(MtmAttendanceReportWorkspace, props))))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const reportCalls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://crm.test")).filter(url => url.pathname.endsWith("/report"))

beforeEach(() => { savedViews = []; today = "2026-10-14"; withSigns = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock) })
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

  // Owner, 2026-11-01: under the name position and department, never «no team»; hours to the minute.
  it("names position, department and team under a person, skips what is not set, and counts hours without seconds", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const people = Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]'))
    const nigar = people.find(row => row.textContent?.includes("Нигяр"))!, rashad = people.find(row => row.textContent?.includes("Рашад"))!
    expect(nigar.querySelector('[data-testid="attendance-employee-details"]')?.textContent).toBe("Кассир · Финансы · Офис «Центр»")
    expect(rashad.querySelector('[data-testid="attendance-employee-details"]')).toBeNull()
    expect(container.textContent).not.toContain(ru.mtmAttendance.reportNoTeam)
    // 13 Oct 09:00–18:00 less the automatic lunch, plus the open 14th up to 08:00 UTC: never "h:mm:ss".
    expect(nigar.textContent).not.toMatch(/\d:\d\d:\d\d/)
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
    expect(people.map(row => row.querySelector("th")!.textContent)).toEqual(["Нигяр БабаеваКассир · Финансы · Офис «Центр»"])
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

  // Owner, 2026-10-20 (the «Kadr uçotu» clip): the month closes on its N-1t in one press.
  // A running month has no press yet, so «Close month» there opens the month that just ended.
  const closeMonthLink = () => container.querySelector<HTMLAnchorElement>('[data-testid="attendance-timesheet-close-month"]')!
  const moveMonth = async (label: "previousMonth" | "nextMonth") => {
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${p(label)}"]`)!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }

  it("«Close month» on the running month opens the N-1t of the month that just ended", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("октябрь 2026")
    const link = closeMonthLink()
    expect(link.textContent).toBe(p("closeMonth"))
    expect(link.getAttribute("href")).toBe("/mtm/attendance/reports?report=n1t&date=2026-09-01")
    const { readHint } = await import("./helpers/hint")
    expect(await readHint(link)).toBe(ru.mtmAttendance.monthCloseOpenN1tHint)
  })

  it("«Close month» on a month that is over opens that month's N-1t", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    await moveMonth("previousMonth")
    await moveMonth("previousMonth")
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("август 2026")
    expect(closeMonthLink().getAttribute("href")).toBe("/mtm/attendance/reports?report=n1t&date=2026-08-01")
  })

  it("«Close month» on a future month still opens the month that just ended", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    await moveMonth("nextMonth")
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("ноябрь 2026")
    expect(closeMonthLink().getAttribute("href")).toBe("/mtm/attendance/reports?report=n1t&date=2026-09-01")
  })

  it("«Close month» in January opens December of the year before", async () => {
    today = "2027-01-12"
    await render({ layout: "timesheet", initialForm: "MONTH" })
    expect(container.querySelector('[data-testid="attendance-month-switcher"]')?.textContent).toContain("январь 2027")
    expect(closeMonthLink().getAttribute("href")).toBe("/mtm/attendance/reports?report=n1t&date=2026-12-01")
  })

})

describe("Timesheet signs (owner, 2026-10-20: as the «Kadr uçotu» clip explains them)", () => {
  const rashad = () => Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]')).find(row => row.textContent?.includes("Рашад"))!
  const nigar = () => Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]')).find(row => row.textContent?.includes("Нигяр"))!

  it("marks a corrected day with a star that reads at rest and is explained in the legend", async () => {
    withSigns = true
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const cell = rashad().querySelectorAll<HTMLButtonElement>('[data-testid="attendance-month-cell"]')[12]
    // No day card is open: the star is there on its own, in the colour of a correction.
    expect(document.querySelector('[data-testid="attendance-day-popover"]')).toBeNull()
    expect(cell.textContent).toBe("Я*")
    const star = cell.querySelector('[data-testid="attendance-corrected-mark"]')!
    expect(star.className).toContain("text-primary")
    expect(cell.getAttribute("aria-label")).toMatch(new RegExp(`· ${p("legendCorrected")}$`))
    const legend = container.querySelector('[data-testid="attendance-legend-corrected"]')!
    expect(legend.textContent).toBe(`*${p("legendCorrected")}`)
    expect(azMessages.personnel.legendCorrected).toBe("müraciətlə düzəliş edilib")
    // Only that day has a star.
    expect(Array.from(container.querySelectorAll('[data-testid="attendance-corrected-mark"]'))).toHaveLength(1)
  })

  it("gives an hours total that leaves out unknown days its own sign, «≥», never the correction's «*»", async () => {
    withSigns = true
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const cells = Array.from(rashad().querySelectorAll("td"))
    const hours = cells[cells.length - 4]
    expect(hours.textContent).toMatch(/^≥\d+:\d{2}$/)
    expect(hours.textContent).not.toContain("*")
    const hint = await readHint(hours.querySelector("[data-hint-value]"))
    expect(hint).toContain("у 1 дня")
    expect(hint).toMatch(/^Не меньше этого/)
    expect(container.querySelector('[data-testid="attendance-legend-partial"]')!.textContent).toBe(`≥${p("legendPartialTotal")}`)
    // Nigar's hours are all known: a plain total, no sign.
    const nigarCells = Array.from(nigar().querySelectorAll("td"))
    expect(nigarCells[nigarCells.length - 4].textContent).toMatch(/^\d+:\d{2}$/)
  })

  it("explains no sign that is not on the screen", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    expect(container.querySelector('[data-testid="attendance-timesheet-legend"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="attendance-legend-corrected"]')).toBeNull()
    expect(container.querySelector('[data-testid="attendance-legend-partial"]')).toBeNull()
  })
})

describe("Timesheet saved forms", () => {
  it("open from More, replace the month with the form's table, and close back to the month", async () => {
    savedViews = [{ id: "v1", name: "Моя форма", version: "2026-10-14T08:00:00.000Z",
      config: { version: 1, mode: "DAY", columns: ["employee", "date", "status", "worked"], showTotals: true, filters: { from: "2026-10-13", to: "2026-10-13", form: "ALL" } } }]
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const more = container.querySelector<HTMLButtonElement>('[data-testid="attendance-timesheet-more"]')!
    await act(async () => { more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent === p("customFormAndDelivery"))!
    await act(async () => item.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const open = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="attendance-personal-view"] button')).find(button => button.getAttribute("aria-label")?.includes("Моя форма") && button.textContent === ru.mtmAttendance.viewsOpen)!
    await act(async () => open.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-13")
    expect(container.querySelector('[data-testid="attendance-custom-table"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="attendance-month-grid"]')).toBeNull()
    const chip = container.querySelector<HTMLElement>('[data-testid="attendance-timesheet-custom-chip"]')!
    expect(chip.textContent).toContain("Моя форма")
    expect(chip.querySelector("button")!.getAttribute("aria-label")).toBe(p("backToMonth"))
    await act(async () => chip.querySelector("button")!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    expect(container.querySelector('[data-testid="attendance-month-grid"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="attendance-custom-table"]')).toBeNull()
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
