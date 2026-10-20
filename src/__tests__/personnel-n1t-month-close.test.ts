// @vitest-environment jsdom
/**
 * Personnel → Reports → N-1t closes a finished month the way the «Kadr uçotu»
 * clip shows it (owner, 2026-10-20): the N-1t, «Bu tabeli bağla», one press,
 * then «sentyabr 2026 · Bağlanıb» with who, when, Excel and PDF in place of
 * the button — and a closed month keeps its frozen figures whatever today's
 * report says. Rendered with the real viewer and the real Azerbaijani texts.
 */
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider, createTranslator } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceReportViewer } from "@/components/mtm/attendance-report-viewer"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceN1tConfig } from "@/lib/mtm/attendance-month-snapshot"
import { createDateFormatter } from "@/lib/format-date"
import type { AttendanceMonthDetail, AttendanceMonthN1tState } from "@/lib/mtm/attendance-month-contract"
import { readHint } from "./helpers/hint"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
const t = az.mtmAttendance as Record<string, string>
const translate = createTranslator({ locale: "az", messages: { mtmAttendance: t }, namespace: "mtmAttendance" })
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
const CLOSE_ID = "00000000-0000-4000-8000-0000000000a1"

/** Two people of an invented company; `start` moves one arrival so "today" can differ from the frozen month. */
function september(start = "09:10") {
  const day = (id: string, date: string, from: string) => ({ id: `${id}-${date}`, agentId: id, workDate: date, status: "COMPLETED", startedAt: at(date, from), completedAt: at(date, "18:00"), totalPausedSeconds: 0,
    events: [{ type: "START", occurredAt: at(date, from) }, { type: "FINISH", occurredAt: at(date, "18:00") }] })
  return { ...buildMtmAttendanceReport({ from: "2026-09-01", to: "2026-09-30", now: "2026-10-20T08:00:00Z", rules: [], calendar: [],
    employees: [{ id: "demo-a", name: "Demo işçi A", position: "Kassir", teamId: "t1", teamName: "Satış" }, { id: "demo-b", name: "Demo işçi B", position: "Anbardar", teamId: "t2", teamName: "Anbar" }],
    workdays: [day("demo-a", "2026-09-28", start), day("demo-b", "2026-09-28", "09:00")] } as never),
  snapshot: { id: "snap", asOf: "2026-10-20T08:00:00Z", query: { from: "2026-09-01", to: "2026-09-30", form: "ALL" } } }
}
const n1t = (report: ReturnType<typeof september>) => buildAttendanceTable(report as never, attendanceN1tConfig("2026-09-01", "2026-09-30"), "az", translate)
const frozen = n1t(september())
const closedDetail = (): AttendanceMonthDetail => ({ id: CLOSE_ID, month: "2026-09", createdAt: "2026-10-15T05:20:00Z", createdByName: "Demo kadr rəhbəri", employeeCount: 2, form: "N1T",
  agentIds: ["demo-a", "demo-b"], table: frozen, moreCorrections: false, corrections: [] })
const base: AttendanceMonthN1tState = { month: "2026-09", finished: true, canClose: true, closes: [], moreCloses: false, closedElsewhere: 0, open: 2, ownOpen: false, notIncluded: 0,
  candidates: [{ agentIds: ["demo-a", "demo-b"], hash: "a".repeat(64), asOf: "2026-10-20T08:00:00.000Z", table: frozen }], blockers: [], moreBlockers: 0 }
const closedState = (): AttendanceMonthN1tState => ({ ...base, open: 0, candidates: [], closes: [closedDetail()] })

let container: HTMLDivElement, root: Root
let state: AttendanceMonthN1tState, live: ReturnType<typeof september>
let closeAnswer: () => Promise<Response>
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : data), { status })
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname.endsWith("/rules")) return json({ today: "2026-10-20" })
  if (url.pathname.endsWith("/report")) return json(live)
  if (url.pathname.endsWith("/months/n1t")) return json(state)
  if (url.pathname === "/api/v1/mtm/attendance/months" && init?.method === "POST") return closeAnswer()
  if (url.pathname.endsWith("/export")) return new Response("file", { headers: { "content-type": "application/pdf" } })
  return json({ code: "UNEXPECTED" }, 500)
})
const posts = () => fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/v1/mtm/attendance/months" && init?.method === "POST")
const text = () => container.textContent ?? ""
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim().endsWith(label))
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
function inAzerbaijani(viewer: Parameters<typeof MtmAttendanceReportViewer>[0]) {
  const props = { locale: "az", timeZone: "Asia/Baku", messages: az, children: createElement(MtmAttendanceReportViewer, viewer) }
  return createElement(NextIntlClientProvider, props)
}
async function render() {
  await act(async () => root.render(inAzerbaijani({ report: "n1t", initialDate: "2026-09-10" })))
  await settle()
}

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  state = structuredClone(base); live = september()
  closeAnswer = async () => { state = closedState(); return json({ id: CLOSE_ID, idempotent: false }) }
  fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("N-1t of a finished month (the clip's month close)", () => {
  it("closes in one press and puts the closed card with Excel and PDF where the button was", async () => {
    await render()
    // What will be frozen is on screen: the N-1t lines and the sentence beside the button.
    expect([...container.querySelectorAll('[data-testid="attendance-n1t-candidate"] [data-testid="attendance-report-row"]')]).toHaveLength(2)
    expect(container.querySelector('[data-testid="attendance-n1t-will-freeze"]')!.textContent).toBe(translate("monthCloseN1tWillFreeze", { month: "sentyabr 2026", count: 2 }))
    // Today's Excel/PDF are not offered beside a table about to be frozen.
    expect(container.querySelector('[data-testid="attendance-export"]')).toBeNull()
    const press = button(t.monthCloseAction)!
    expect(await readHint(press)).toBe(t.monthCloseActionHint)
    await act(async () => press.click()); await settle()

    expect(posts()).toHaveLength(1)
    const body = JSON.parse(String(posts()[0][1]!.body))
    expect(body).toMatchObject({ month: "2026-09", agentIds: ["demo-a", "demo-b"], preview: { hash: "a".repeat(64), asOf: "2026-10-20T08:00:00.000Z" } })
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
    // No list to pick from: the closed card is there at once.
    expect(container.querySelector('[data-testid="attendance-closed-month-title"]')!.textContent).toBe(`sentyabr 2026 · ${t.monthCloseClosed}`)
    // Who and when, on the reader's own clock (owner, 2026-10-15).
    expect(container.querySelector('[data-testid="attendance-closed-month-by"]')!.textContent).toBe(`Demo kadr rəhbəri · ${createDateFormatter("az", { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-10-15T05:20:00Z"))}`)
    expect(button(t.monthCloseExcel)).toBeDefined(); expect(button(t.monthClosePdf)).toBeDefined()
    expect(await readHint(button(t.monthCloseExcel))).toBe(t.monthCloseExcelHint)
    expect(text()).toContain(t.monthCloseFrozen); expect(text()).toContain(t.monthCloseDone)
    expect(button(t.monthCloseAction)).toBeUndefined()
    // The table stays above the card, as in the clip; one filled button on the screen.
    const block = container.querySelector('[data-testid="attendance-closed-month-block"]')!
    expect(block.firstElementChild!.getAttribute("data-testid")).toBe("attendance-frozen-n1t")
    expect([...container.querySelectorAll("button")].filter(item => item.className.includes("bg-primary "))).toHaveLength(1)
    expect(container.querySelector(`select[aria-label="${t.reportTeam}"]`)).toBeNull()
  })

  it("shows the frozen figures of a closed month, not today's, and the later correction apart", async () => {
    state = closedState()
    state.closes[0].corrections = [{ id: "c1", employeeId: "demo-a", employeeName: "Demo işçi A", date: "2026-09-28", at: "2026-10-16T06:40:00Z", reviewerName: "Demo kadr rəhbəri", requestId: "00000000-0000-4000-8000-0000000000b2",
      before: { startedAt: "2026-09-28T05:10:00Z", completedAt: "2026-09-28T14:00:00Z" }, after: { startedAt: "2026-09-28T05:00:00Z", completedAt: "2026-09-28T14:00:00Z" } }]
    live = september("08:00") // the live day was corrected after the close
    const hours = frozen.columns.findIndex(column => column.key === "hours")
    expect(n1t(live).rows[0].cells[hours]).not.toBe(frozen.rows[0].cells[hours])
    await render()
    const cells = [...container.querySelectorAll('[data-testid="attendance-frozen-n1t-table"] [data-testid="attendance-report-row"]')][0].textContent
    expect(cells).toContain(String(frozen.rows[0].cells[hours]))
    expect(cells).not.toContain(String(n1t(live).rows[0].cells[hours]))
    // Today's table of the same people is not drawn under the frozen one.
    expect(container.querySelectorAll('[data-testid="attendance-report-table"]')).toHaveLength(0)
    const correction = container.querySelector('[data-testid="attendance-closed-month-correction"]')!
    expect(correction.textContent).toContain("Demo işçi A"); expect(correction.textContent).toContain(t.monthCloseBefore)
    expect(correction.querySelector('a[href*="requestId=00000000-0000-4000-8000-0000000000b2"]')).not.toBeNull()
    await act(async () => button(t.monthClosePdf)!.click()); await settle()
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(`/api/v1/mtm/attendance/months/${CLOSE_ID}/export?`) && String(url).includes("format=pdf"))).toBe(true)
  })

  it("lists the days that block the month instead of the button", async () => {
    state.blockers = [{ employeeId: "demo-b", employeeName: "Demo işçi B", date: "2026-09-14", kind: "MISSING_FINISH" }]
    await render()
    expect(button(t.monthCloseAction)).toBeUndefined()
    const list = container.querySelector('[data-testid="attendance-n1t-blockers"]')!
    expect(list.textContent).toContain(t.monthCloseN1tBlocked)
    expect(list.textContent).toContain(`Demo işçi B · 14 sen 2026 · ${t.reportMissingFinish}`)
    const link = list.querySelector<HTMLAnchorElement>("a")!
    expect(link.textContent).toBe(t.monthCloseBlockerOpenDay)
    expect(link.getAttribute("href")).toBe("/mtm/attendance/timesheet?date=2026-09-14&employeeId=demo-b")
    expect(await readHint(link)).toBe(t.monthCloseBlockerOpenDayHint)
  })

  it("shows the month someone else closed a moment earlier", async () => {
    closeAnswer = async () => { state = closedState(); return json({ code: "MTM_ATTENDANCE_MONTH_ALREADY_CLOSED" }, 409) }
    await render()
    await act(async () => button(t.monthCloseAction)!.click()); await settle()
    expect(text()).toContain(t.monthCloseAlreadyClosed)
    expect(container.querySelector('[data-testid="attendance-closed-month"]')).not.toBeNull()
  })

  it("repeats exactly the same close when its answer was lost", async () => {
    closeAnswer = async () => { throw new Error("connection lost") }
    await render()
    await act(async () => button(t.monthCloseAction)!.click()); await settle()
    expect(text()).toContain(t.monthCloseUnknown)
    expect(button(t.monthCloseAction)!.disabled).toBe(true)
    closeAnswer = async () => { state = closedState(); return json({ id: CLOSE_ID, idempotent: true }) }
    await act(async () => button(t.monthCloseRetry)!.click()); await settle()
    expect(posts()).toHaveLength(2)
    expect(posts()[1][1]!.body).toBe(posts()[0][1]!.body)
    expect(container.querySelector('[data-testid="attendance-closed-month"]')).not.toBeNull()
  })

  it("says who closes the month to a reader without the right to close", async () => {
    state = { ...base, canClose: false, candidates: [] }
    await render()
    expect(button(t.monthCloseAction)).toBeUndefined()
    expect(container.querySelector('[data-testid="attendance-n1t-notes"]')!.textContent).toBe(t.monthCloseN1tReadOnly)
    // Live figures, live Excel/PDF and the team filter, as for any open month.
    expect(container.querySelectorAll('[data-testid="attendance-report-table"] [data-testid="attendance-report-row"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="attendance-export"]')).not.toBeNull()
  })

  it("reads no month state while the month is still running", async () => {
    await act(async () => root.render(inAzerbaijani({ report: "n1t" })))
    await settle()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/months/n1t"))).toBe(false)
    expect(button(t.monthCloseAction)).toBeUndefined()
    expect(container.querySelector('[data-testid="attendance-n1t-not-yet"]')!.textContent).toBe(t.monthCloseN1tNotYet)
  })
})
