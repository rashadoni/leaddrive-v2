// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }))
const { default: PersonnelReportsPage } = await import("@/app/(dashboard)/mtm/attendance/reports/page")
const { MtmAttendanceReportViewer } = await import("@/components/mtm/attendance-report-viewer")
const { MtmAttendanceLeaveBalances } = await import("@/components/mtm/attendance-leave-balances")
const { buildMtmAttendanceReport } = await import("@/lib/mtm/attendance-report")
const { attendanceDayKindPresetCodes, defaultAttendanceDayKinds } = await import("@/lib/mtm/attendance-day-kinds")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const open = async (params: Record<string, string>) => await PersonnelReportsPage({ searchParams: Promise.resolve(params) }) as ReactElement<{ children?: unknown }>

// Owner, 2026-10-15: "all the reports HR may need", approved as 13 cards.
describe("Personnel → Reports page", () => {
  it("lists the 13 reports in their groups, the timesheet card going to the timesheet", async () => {
    const html = renderToStaticMarkup(await open({}))
    const cards = [...html.matchAll(/data-testid="attendance-report-card-([a-zA-Z0-9]+)"/g)].map(match => match[1])
    expect(cards).toEqual(["day", "absent", "timesheet", "n1t", "summary", "balance", "late", "overtime", "absenceKinds", "leaveBalances", "teams", "journal", "decisions"])
    expect(html).toContain('href="/mtm/attendance/timesheet"')
    expect(html).toContain('href="/mtm/attendance/reports?report=n1t"')
    expect(html.match(/reportsNew/g)).toHaveLength(6)
  })

  it("opens a table report in the viewer and a ready screen for leave balances, each with a way back", async () => {
    const n1t = await open({ report: "n1t" })
    const children = n1t.props.children as ReactElement<{ href?: string; report?: string; children?: unknown }>[]
    expect(children[0].props.href).toBe("/mtm/attendance/reports")
    const viewer = (children[1].props.children as ReactElement<{ report?: string }>[]).find(child => child?.type === MtmAttendanceReportViewer)!
    expect(viewer.props.report).toBe("n1t")
    expect(((await open({ report: "leaveBalances" })).props.children as ReactElement[])[1].type).toBe(MtmAttendanceLeaveBalances)
    // Unknown keys and the timesheet (its own page) fall back to the cards.
    for (const report of ["nothing", "timesheet"]) expect(renderToStaticMarkup(await open({ report }))).toContain("attendance-reports-hub")
  })
})

describe("Report viewer", () => {
  let container: HTMLDivElement, root: Root
  const kinds = attendanceDayKindPresetCodes(defaultAttendanceDayKinds(key => ({ ru: ru.mtmAttendance[`dayKindName${key}`], az: "x", en: "x" })), "RU")
  const at = (date: string, time: string) => `${date}T${time}:00+04:00`
  const report = (from: string, to: string) => ({ ...buildMtmAttendanceReport({ from, to, now: "2026-10-14T08:00:00Z", rules: [], calendar: [], dayKinds: kinds,
    employees: [{ id: "nigar", name: "Нигяр", position: "Бухгалтер", teamId: "centre", teamName: "Центр" }, { id: "rashad", name: "Рашад", teamId: "north", teamName: "Север" }],
    workdays: [{ id: "n", agentId: "nigar", workDate: "2026-10-13", status: "COMPLETED", startedAt: at("2026-10-13", "09:00"), completedAt: at("2026-10-13", "18:00"), totalPausedSeconds: 0,
      events: [{ type: "START", occurredAt: at("2026-10-13", "09:00") }, { type: "FINISH", occurredAt: at("2026-10-13", "18:00") }] }] }),
    snapshot: { id: "snap", asOf: "2026-10-14T08:00:00Z", query: { from, to, form: "ALL" } } })
  const fetchMock = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input), "https://crm.test")
    if (url.pathname.endsWith("/rules")) return new Response(JSON.stringify({ success: true, data: { today: "2026-10-14" } }))
    return new Response(JSON.stringify({ success: true, data: report(url.searchParams.get("from")!, url.searchParams.get("to")!) }))
  })
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  async function render(key: "summary" | "n1t") {
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, children: createElement(MtmAttendanceReportViewer, { report: key }) })))
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  const reportCalls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://crm.test")).filter(url => url.pathname.endsWith("/report"))

  it("opens the month to date, one row per employee, and narrows to a team", async () => {
    await render("summary")
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-10-14")
    const rows = () => [...container.querySelectorAll('[data-testid="attendance-report-row"]')].map(row => row.querySelector("td")!.textContent)
    expect(rows()).toEqual(["Нигяр", "Рашад"])
    const team = container.querySelector<HTMLSelectElement>(`select[aria-label="${ru.mtmAttendance.reportTeam}"]`)!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(team, "north"); team.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(rows()).toEqual(["Рашад"])
  })

  it("opens N-1t on the whole current month with day columns", async () => {
    await render("n1t")
    expect(reportCalls().at(-1)?.searchParams.get("from")).toBe("2026-10-01")
    expect(reportCalls().at(-1)?.searchParams.get("to")).toBe("2026-10-31")
    const headers = [...container.querySelectorAll("th")].map(th => th.textContent)
    // On screen position and department sit under the name and an empty notes
    // column is not drawn, so 31 days fit the page; Excel and PDF keep every column.
    expect(headers.slice(0, 2)).toEqual([ru.mtmAttendance.reportIndex, ru.mtmAttendance.reportEmployee])
    expect(headers).toHaveLength(2 + 31 + 2)
    // The day columns read as day numbers on screen.
    expect(headers.slice(2, 33)).toEqual(Array.from({ length: 31 }, (_, index) => String(index + 1)))
    const details = [...container.querySelectorAll('[data-testid="attendance-report-row"]')].map(row => row.querySelector('[data-testid="attendance-report-employee-details"]')?.textContent)
    expect(details).toEqual(["Бухгалтер · Центр", "Север"])
    // A worked day shows its code with the hours beneath, the whole text in its tooltip.
    const worked = container.querySelector('td span[title]')!
    expect(worked.getAttribute("title")).toMatch(/ · /)
    expect(worked.children).toHaveLength(2)
  })
})
