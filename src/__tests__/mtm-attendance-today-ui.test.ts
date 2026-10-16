// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceToday } from "@/components/mtm/attendance-today"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { attendanceTodayRange } from "@/lib/mtm/attendance-today"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"
import type { AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
const p = (key: string) => ru.personnel[key] as string
const today = "2026-10-14"
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
const kinds = defaultAttendanceDayKinds(key => ({ ru: ru.mtmAttendance[`dayKindName${key}`], az: "x", en: "x" }))
const day = (agentId: string, date: string, start: string) => ({ id: `${agentId}-${date}`, agentId, workDate: date, status: "STARTED", startedAt: at(date, start), completedAt: null, totalPausedSeconds: 0,
  events: [{ type: "START", occurredAt: at(date, start) }] })
const range = attendanceTodayRange(today)
const report = buildMtmAttendanceReport({ from: range.from, to: range.to, now: "2026-10-14T08:00:00Z", rules: [], calendar: [], dayKinds: kinds,
  employees: ["Айсель", "Нигяр", "Рашад", "Эльвин"].map(name => ({ id: `id-${name}`, name, teamId: null, teamName: null })),
  workdays: [day("id-Айсель", today, "08:55"), day("id-Нигяр", today, "09:25"), day("id-Эльвин", "2026-10-13", "09:00"), day("id-Эльвин", today, "09:00")] })
const version = "2026-10-13T08:00:00.000Z"
const leaveRequest = (id: string, name: string): AttendanceReviewItem => ({
  id, clientRequestId: `${id}-client`, agentId: `agent-${id}`, status: "PENDING", startDate: "2026-10-20", endDate: "2026-10-24", reason: "Семейный отпуск",
  submittedAt: version, decisionNote: null, decidedAt: null, cancelledAt: null, version,
  details: { version: 1, kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "ANNUAL_LEAVE")!, attachmentIds: [] },
  employeeName: name, teamName: null, reviewerName: null,
} as AttendanceReviewItem)
const risk = { id: "risk-1", employeeId: "id-Рашад", employeeName: "Камран", teamId: null, teamName: null, kind: "SHARED_INSTALLATION", workDate: today, timezone: "Asia/Baku",
  claimedAt: at(today, "09:00"), serverReceivedAt: at(today, "09:00"), action: "START", createdAt: at(today, "09:01"), canDismiss: true, relatedNames: ["Эльвин"], relatedNamesRestricted: false,
  usualName: null, usualDays: null, observedDays: null, deltaSeconds: null, thresholdSeconds: null, branchName: null, distanceMeters: null, dismissal: null } as AttendanceRiskItem

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let requests: AttendanceReviewItem[] = [], requestsStatus = 200, decisionStatus = 200
// Null: this user may not ask for explanations (the route refuses).
let explanations: unknown[] | null = null
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  if (url.startsWith("/api/v1/mtm/attendance/rules")) return json({ success: true, data: { today, canManageRules: true } })
  if (url.startsWith("/api/v1/mtm/attendance/report")) return json({ success: true, data: report })
  if (url.startsWith("/api/v1/mtm/attendance/explanations") && init?.method === "POST" && !url.includes("/decision")) return json({ success: true, data: { created: 2, already: 0, notNeeded: 0 } }, 201)
  if (url.startsWith("/api/v1/mtm/attendance/explanations") && !init?.method) return explanations ? json({ success: true, data: { items: explanations } }) : json({ error: "Forbidden" }, 403)
  if (url.includes("/decision") && init?.method === "POST") return json(decisionStatus < 400 ? { success: true, data: { request: { status: "APPROVED" } } } : { error: "x" }, decisionStatus)
  if (url.startsWith("/api/v1/mtm/attendance/requests")) return json(requestsStatus < 400 ? { success: true, data: { items: requests, nextCursor: null } } : { error: "Forbidden" }, requestsStatus)
  if (url.startsWith("/api/v1/mtm/attendance/review")) return json({ success: true, data: { items: [risk], directory: [], snapshot: {} } })
  return json({ error: "unexpected" }, 500)
})
let container: HTMLDivElement, root: Root
async function render() {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru }, createElement(MtmAttendanceToday))))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const buttonIn = (region: HTMLElement | null, text: string) => Array.from(region?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(item => item.textContent === text)
const decisions = () => fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/decision") && init?.method === "POST")
async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
  requests = [leaveRequest("r1", "Айсель Мамедова"), leaveRequest("r2", "Мурад Гасанов")]; requestsStatus = 200; decisionStatus = 200; explanations = null
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("Personnel → Today", () => {
  it("shows today's figures from the report and an action beside each person who needs one", async () => {
    await render()
    expect(byTestId("attendance-today-arrived-value")?.textContent).toBe("3")
    expect(byTestId("attendance-today-arrived")?.textContent).toContain("из 4")
    expect(byTestId("attendance-today-late-value")?.textContent).toBe("1")
    expect(byTestId("attendance-today-absent-value")?.textContent).toBe("1")
    expect(byTestId("attendance-today-missing-finish-value")?.textContent).toBe("1")
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]'))
    expect(items.map(item => item.dataset.type)).toEqual(["absent", "late", "missing-finish", "risk"])
    const absent = items[0].querySelector("a")!
    expect(absent.textContent).toBe(p("addReason"))
    expect(absent.getAttribute("href")).toBe(`/mtm/attendance/recordings?employeeId=${encodeURIComponent("id-Рашад")}&date=${today}`)
    expect(items[1].textContent).toContain("25 мин")
    expect(items[2].querySelector("a")!.getAttribute("href")).toBe(`/mtm/attendance/timesheet?date=2026-10-13&employeeId=${encodeURIComponent("id-Эльвин")}`)
    // Suspicious marks open their own queue page, reached from here (owner, 2026-10-15).
    expect(items[3].querySelector("a")!.getAttribute("href")).toBe("/mtm/attendance/review")
    expect(byTestId("attendance-today-attention")!.querySelector('a[href="/mtm/attendance/review"]')).not.toBeNull()
    // Each figure opens the list it counts: today's day map, today's late arrivals, today's absences.
    const link = (id: string) => byTestId(`attendance-today-${id}`)!.parentElement!.querySelector("a")!.getAttribute("href")
    expect(link("arrived")).toBe("/mtm/attendance/reports?report=day")
    expect(link("late")).toBe(`/mtm/attendance/reports?report=late&date=${today}`)
    expect(link("absent")).toBe("/mtm/attendance/reports?report=absent")
    expect(link("missing-finish")).toBe("/mtm/attendance/timesheet?filter=missing-finish")
    expect(items[3].textContent).toContain("Эльвин")
  })

  // Owner, 2026-10-16 (approved mockup): who is at work, on a break, gone and not yet in.
  it("shows who is at work now, and a name opens the employee for an administrator", async () => {
    await render()
    const now = byTestId("attendance-today-now")!
    const names = (key: string) => [...now.querySelectorAll(`[data-testid="attendance-now-${key}"] li a`)].map(link => link.textContent)
    expect(names("working")).toEqual(["Айсель", "Эльвин", "Нигяр"])
    expect(names("notYet")).toEqual(["Рашад"])
    expect(byTestId("attendance-now-working")!.textContent).toContain(p("nowSince").replace("{time}", "08:55"))
    expect(now.querySelector("li a")!.getAttribute("href")).toBe(`/mtm/attendance/people/${encodeURIComponent("id-Айсель")}`)
  })
  it("approves in one click with the request version and removes the row", async () => {
    await render()
    const row = byTestId("attendance-today-request-r1")
    await act(async () => buttonIn(row, p("approve"))!.click())
    expect(decisions()).toHaveLength(1)
    const [url, init] = decisions()[0]
    expect(String(url)).toBe("/api/v1/mtm/attendance/requests/r1/decision")
    expect(JSON.parse(String(init?.body))).toEqual({ decision: "APPROVED", version, note: null })
    expect(byTestId("attendance-today-request-r1")).toBeNull()
    expect(byTestId("attendance-today-request-r2")).not.toBeNull()
    expect(container.textContent).toContain(p("decisionSaved"))
  })

  it("rejects only with a reason, and sends that reason", async () => {
    await render()
    await act(async () => buttonIn(byTestId("attendance-today-request-r2"), p("reject"))!.click())
    const row = byTestId("attendance-today-request-r2")!
    const confirm = buttonIn(row, p("rejectConfirm"))!
    expect(confirm.disabled).toBe(true)
    await type(row.querySelector("input")!, "Нет замены")
    expect(buttonIn(row, p("rejectConfirm"))!.disabled).toBe(false)
    await act(async () => buttonIn(row, p("rejectConfirm"))!.click())
    expect(JSON.parse(String(decisions()[0][1]?.body))).toEqual({ decision: "REJECTED", version, note: "Нет замены" })
    expect(byTestId("attendance-today-request-r2")).toBeNull()
  })

  it("on a changed request keeps the row and reloads the queue instead of claiming success", async () => {
    await render()
    decisionStatus = 409
    const before = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/mtm/attendance/requests?")).length
    await act(async () => buttonIn(byTestId("attendance-today-request-r1"), p("approve"))!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.textContent).toContain(p("decisionChanged"))
    expect(container.textContent).not.toContain(p("decisionSaved"))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/mtm/attendance/requests?")).length).toBe(before + 1)
  })

  it("without the right to decide hides the request card but keeps the rest of the screen", async () => {
    requestsStatus = 403
    await render()
    expect(byTestId("attendance-today-requests")).toBeNull()
    expect(byTestId("attendance-today-attention")).not.toBeNull()
    expect(byTestId("attendance-today-arrived-value")?.textContent).toBe("3")
  })

  it("links every weekday to that day of the timesheet", async () => {
    await render()
    const days = Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="attendance-today-day"]'))
    expect(days.map(link => link.getAttribute("href"))).toEqual(["12", "13", "14", "15", "16"].map(d => `/mtm/attendance/timesheet?date=2026-10-${d}`))
    expect(days[2].textContent).toContain(p("weekToday"))
  })

  it("writes Azerbaijani dates itself, never the root-locale 'M10' (prod, 2026-10-14)", async () => {
    await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "az", timeZone: "Asia/Baku", messages: az }, createElement(MtmAttendanceToday))))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const text = container.textContent ?? ""
    expect(text).not.toMatch(/M\d{2}\b/)
    expect(text).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri)\b/)
    expect(text).toContain("oktyabr")
    expect(text).toContain("14 okt")
  })

  // Owner, 2026-10-16 (approved mockup): tick the late and the absent and ask them to explain.
  it("asks everyone late or absent today for an explanation with one tick and one button", async () => {
    explanations = []
    await render()
    const bar = byTestId("attendance-explain-bar")!
    expect(bar.textContent).toContain(p("explainHint"))
    const all = bar.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => all.click())
    const ask = byTestId("attendance-explain-ask") as HTMLButtonElement
    expect(ask.textContent).toBe(ru.personnel.explainAsk.replace("{count}", "2"))
    await act(async () => ask.click())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST")!
    expect(JSON.parse(String(post[1]!.body)).items).toEqual([{ agentId: "id-Рашад", date: today, kind: "ABSENT" }, { agentId: "id-Нигяр", date: today, kind: "LATE" }])
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2")
  })

  it("shows who was asked and who answered, and HR accepts the answer", async () => {
    explanations = [{ id: "e1", employeeId: "id-Рашад", employeeName: "Рашад", date: today, kind: "ABSENT", status: "ANSWERED", lateMinutes: null, requestedAt: at(today, "10:05"),
      requestedByName: "HR", answer: "Затопило квартиру", answeredAt: at(today, "11:00"), decidedAt: null, decidedByName: null },
    { id: "e2", employeeId: "id-Нигяр", employeeName: "Нигяр", date: today, kind: "LATE", status: "REQUESTED", lateMinutes: 25, requestedAt: at(today, "10:05"),
      requestedByName: "HR", answer: null, answeredAt: null, decidedAt: null, decidedByName: null }]
    await render()
    // Both already asked: nothing left to tick.
    expect(byTestId("attendance-explain-bar")).toBeNull()
    const statuses = Array.from(container.querySelectorAll('[data-testid="attendance-explain-status"]')).map(item => item.textContent)
    expect(statuses).toEqual([p("explainAnswered"), ru.personnel.explainWaiting.replace("{time}", "10:05")])
    await act(async () => buttonIn(byTestId("attendance-today-attention"), p("explainAnswered"))!.click())
    expect(byTestId("attendance-explain-answer")?.textContent).toContain("Затопило квартиру")
    await act(async () => buttonIn(byTestId("attendance-explain-answer"), p("explainAccept"))!.click())
    const decision = fetchMock.mock.calls.find(([url]) => String(url) === "/api/v1/mtm/attendance/explanations/e1/decision")!
    expect(JSON.parse(String(decision[1]!.body))).toEqual({ decision: "ACCEPTED" })
  })

  it("without the right to ask draws no ticks and no button", async () => {
    await render()
    expect(byTestId("attendance-explain-bar")).toBeNull()
    expect(container.querySelectorAll('[data-testid="attendance-explain-status"]')).toHaveLength(0)
  })
})
