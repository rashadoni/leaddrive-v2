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
const p = (key: string) => ru.personnel[key] as string
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
    await render({ layout: "timesheet", initialForm: "MONTH", tabs: createElement("nav", { "data-testid": "tabs-slot" }) })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-10-31")
    expect(container.querySelector('[data-testid="tabs-slot"]')).not.toBeNull()
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

  it("opens a day card from a cell with the marks and links to the day and to its correction", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    const nigar = Array.from(container.querySelectorAll('[data-testid="attendance-month-person"]')).find(row => row.textContent?.includes("Нигяр"))!
    await act(async () => nigar.querySelectorAll<HTMLButtonElement>('[data-testid="attendance-month-cell"]')[13].click())
    const card = document.querySelector<HTMLElement>('[data-testid="attendance-day-popover"]')!
    expect(card.textContent).toContain("Нигяр Бабаева")
    expect(card.textContent).toContain("09:25")
    const links = Array.from(card.querySelectorAll("a"))
    expect(links.map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      [p("openDay"), "/mtm/attendance/timesheet?tab=journal&date=2026-10-14&employeeId=nigar"],
      [p("changeDayKind"), "/mtm/attendance/recordings?date=2026-10-14&employeeId=nigar"],
    ])
  })

  it("moves by month with the arrows", async () => {
    await render({ layout: "timesheet", initialForm: "MONTH" })
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${p("previousMonth")}"]`)!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-09-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-09-30")
  })

  it("a day link opens that day for that person only", async () => {
    await render({ layout: "timesheet", initialForm: "JOURNAL", initialDate: "2026-10-13", initialEmployeeId: "nigar" })
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-13")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-10-13")
    expect(container.textContent).toContain(p("onlyEmployee").replace("{name}", "Нигяр Бабаева"))
    expect(container.textContent).not.toContain("Рашад Алиев")
  })
})

describe("former attendance pages", () => {
  it("redirect to their tab and keep every query parameter a notification carried", async () => {
    await expect(redirectToAttendanceTab("settings", "review", Promise.resolve({ caseId: "c-1", tab: "ignored", ids: ["a", "b"] }))).rejects.toThrow()
    expect(redirect).toHaveBeenLastCalledWith("/mtm/attendance/settings?caseId=c-1&ids=a&ids=b&tab=review")
  })
})
