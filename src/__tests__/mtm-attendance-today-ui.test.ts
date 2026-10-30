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
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
import type { AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"
import { readHint } from "./helpers/hint"

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
// `extra` adds a start today — for someone new, or for Рашад, who has none in the base report (absent).
const reportOf = (extra: readonly { name: string; start: string }[] = [], approvedRequests: AttendanceApprovedPeriod[] = []) => buildMtmAttendanceReport({ from: range.from, to: range.to, now: "2026-10-14T08:00:00Z", rules: [], calendar: [], dayKinds: kinds, approvedRequests,
  employees: [...new Set(["Айсель", "Нигяр", "Рашад", "Эльвин", ...extra.map(person => person.name)])].map(name => ({ id: `id-${name}`, name, teamId: null, teamName: null })),
  workdays: [day("id-Айсель", today, "08:55"), day("id-Нигяр", today, "09:25"), day("id-Эльвин", "2026-10-13", "09:00"), day("id-Эльвин", today, "09:00"),
    ...extra.map(person => day(`id-${person.name}`, today, person.start))] })
const report = reportOf()
let currentReport = report
const version = "2026-10-13T08:00:00.000Z"
const leaveRequest = (id: string, name: string): AttendanceReviewItem => ({
  id, clientRequestId: `${id}-client`, agentId: `agent-${id}`, status: "PENDING", startDate: "2026-10-20", endDate: "2026-10-24", reason: "Семейный отпуск",
  submittedAt: version, decisionNote: null, decidedAt: null, cancelledAt: null, version,
  details: { version: 1, kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "ANNUAL_LEAVE")!, attachmentIds: [] },
  employeeName: name, teamName: null, reviewerName: null,
  approval: { twoStep: false, awaiting: null, manager: null, passesToHr: false }, canDecide: true,
} as AttendanceReviewItem)
const risk = { id: "risk-1", employeeId: "id-Рашад", employeeName: "Камран", teamId: null, teamName: null, kind: "SHARED_INSTALLATION", workDate: today, timezone: "Asia/Baku",
  claimedAt: at(today, "09:00"), serverReceivedAt: at(today, "09:00"), action: "START", createdAt: at(today, "09:01"), canDismiss: true, relatedNames: ["Эльвин"], relatedNamesRestricted: false,
  usualName: null, usualDays: null, observedDays: null, deltaSeconds: null, thresholdSeconds: null, branchName: null, distanceMeters: null, dismissal: null } as AttendanceRiskItem

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let requests: AttendanceReviewItem[] = [], requestsStatus = 200, decisionStatus = 200, passedToHr = false
// Null: this user may not ask for explanations (the route refuses).
let explanations: unknown[] | null = null
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  if (url.startsWith("/api/v1/mtm/attendance/rules")) return json({ success: true, data: { today, canManageRules: true } })
  if (url.startsWith("/api/v1/mtm/attendance/report")) return json({ success: true, data: currentReport })
  if (url.startsWith("/api/v1/mtm/attendance/explanations") && init?.method === "POST" && !url.includes("/decision")) return json({ success: true, data: { created: 2, already: 0, notNeeded: 0 } }, 201)
  if (url.startsWith("/api/v1/mtm/attendance/explanations") && !init?.method) return explanations ? json({ success: true, data: { items: explanations } }) : json({ error: "Forbidden" }, 403)
  if (url.includes("/decision") && init?.method === "POST") return json(decisionStatus < 400 ? { success: true, data: { request: { status: passedToHr ? "PENDING" : "APPROVED" }, passedToHr } } : { error: "x" }, decisionStatus)
  if (url.startsWith("/api/v1/mtm/attendance/requests")) return json(requestsStatus < 400 ? { success: true, data: { items: requests, nextCursor: null } } : { error: "Forbidden" }, requestsStatus)
  if (url.startsWith("/api/v1/mtm/attendance/review")) return json({ success: true, data: { items: [risk], directory: [], snapshot: {} } })
  return json({ error: "unexpected" }, 500)
})
let container: HTMLDivElement, root: Root
// What the explanations API answers with for today.
const explanationOf = (name: string, kind: "LATE" | "ABSENT", status: "REQUESTED" | "ANSWERED" | "ACCEPTED" | "REJECTED", answer: string | null = null) => ({
  id: `e-${name}`, employeeId: `id-${name}`, employeeName: name, date: today, kind, status, lateMinutes: kind === "LATE" ? 30 : null,
  requestedAt: at(today, "09:20"), requestedByName: "HR", answer, answeredAt: answer ? at(today, "11:35") : null, decidedAt: null, decidedByName: null })
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
  requests = [leaveRequest("r1", "Айсель Мамедова"), leaveRequest("r2", "Мурад Гасанов")]; requestsStatus = 200; decisionStatus = 200; passedToHr = false; explanations = null; currentReport = report
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

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

  // Owner, 2026-10-20: the «Kadr uçotu» clip says it under «Now», and so does the product.
  it("says under «Now» that there is no biometrics, no place on a break, and the employee closes the day", async () => {
    await render()
    const line = byTestId("attendance-now-privacy")!
    expect(line.textContent).toBe(p("nowPrivacy"))
    expect(az.personnel.nowPrivacy).toBe("Biometriya yoxdur: nə üz, nə barmaq izi. Fasilədə yalnız vaxt görünür — əməkdaşın yeri yazılmır. Günü əməkdaş özü bağlayır.")
    // The shield icon on its own, no coloured square behind it (calm colours, 2026-10-18).
    expect(line.querySelector("svg")).not.toBeNull()
    expect(line.innerHTML).not.toMatch(/\bbg-/)
    expect(byTestId("attendance-today-now")!.contains(line)).toBe(true)
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

  // Two-step approval (owner, 2026-10-21): «сначала руководитель, потом HR».
  const twoStep = (item: AttendanceReviewItem, approval: AttendanceReviewItem["approval"], canDecide = true): AttendanceReviewItem => ({ ...item, approval, canDecide })
  it("two-step approval: a manager's button says it passes the request to HR, and the screen says it went there", async () => {
    requests = [twoStep(leaveRequest("r1", "Айсель Мамедова"), { twoStep: true, awaiting: "MANAGER", manager: null, passesToHr: true }),
      // Already passed to HR by this or another manager: nothing left for this manager.
      twoStep(leaveRequest("r2", "Мурад Гасанов"), { twoStep: true, awaiting: "HR", manager: { name: "Тогрул", at: version, note: null }, passesToHr: false }, false)]
    passedToHr = true
    await render()
    expect(byTestId("attendance-today-request-r2")).toBeNull()
    expect(byTestId("attendance-today-requests")?.textContent).toContain("1")
    const row = byTestId("attendance-today-request-r1")
    expect(buttonIn(row, p("approve"))).toBeUndefined()
    await act(async () => buttonIn(row, p("passToHr"))!.click())
    expect(JSON.parse(String(decisions()[0][1]?.body))).toEqual({ decision: "APPROVED", version, note: null })
    expect(byTestId("attendance-today-request-r1")).toBeNull()
    expect(container.textContent).toContain(p("passedToHr"))
    expect(container.textContent).not.toContain(p("decisionSaved"))
  })

  it("two-step approval: HR sees which manager approved and whose manager has not answered yet, and decides with a plain approve", async () => {
    requests = [twoStep(leaveRequest("r1", "Айсель Мамедова"), { twoStep: true, awaiting: "HR", manager: { name: "Тогрул Алиев", at: version, note: null }, passesToHr: false }),
      twoStep(leaveRequest("r2", "Мурад Гасанов"), { twoStep: true, awaiting: "MANAGER", manager: null, passesToHr: false })]
    await render()
    expect(byTestId("attendance-today-request-r1")?.querySelector('[data-testid="attendance-today-manager-approved"]')?.textContent).toBe(p("managerApprovedBy").replace("{name}", "Тогрул Алиев"))
    expect(byTestId("attendance-today-request-r2")?.querySelector('[data-testid="attendance-today-awaiting-manager"]')?.textContent).toBe(p("awaitingManager"))
    expect(buttonIn(byTestId("attendance-today-request-r1"), p("passToHr"))).toBeUndefined()
    await act(async () => buttonIn(byTestId("attendance-today-request-r1"), p("approve"))!.click())
    expect(container.textContent).toContain(p("decisionSaved"))
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
  // Owner, 2026-10-20 (the «Kadr uçotu» clip, «bir düymə ilə»): they come ticked, so it is one button.
  it("asks everyone late or absent today for an explanation with one button", async () => {
    explanations = []
    await render()
    const bar = byTestId("attendance-explain-bar")!
    expect(bar.textContent).toContain(p("explainHint"))
    expect(bar.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    const ask = byTestId("attendance-explain-ask") as HTMLButtonElement
    expect(ask.disabled).toBe(false)
    expect(ask.textContent).toBe(ru.personnel.explainAsk.replace("{count}", "2"))
    expect(await readHint(ask)).toBe(p("explainAskHint"))
    await act(async () => ask.click())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST")!
    expect(JSON.parse(String(post[1]!.body)).items).toEqual([{ agentId: "id-Рашад", date: today, kind: "ABSENT" }, { agentId: "id-Нигяр", date: today, kind: "LATE" }])
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2")
  })

  it("keeps HR's untick through the minute's refresh and ticks only someone new", async () => {
    explanations = []
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    await render()
    const tick = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${p("explainSelect").replace("{name}", name)}"]`)
    expect(tick("Нигяр")!.checked).toBe(true)
    await act(async () => tick("Нигяр")!.click())
    expect(tick("Нигяр")!.checked).toBe(false)
    expect(byTestId("attendance-explain-ask")!.textContent).toBe(ru.personnel.explainAsk.replace("{count}", "1"))
    // A minute later Камран has come in forty minutes late; the screen reloads by itself.
    currentReport = reportOf([{ name: "Камран", start: "09:40" }])
    const loads = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/mtm/attendance/report")).length
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/mtm/attendance/report")).length).toBe(loads + 1)
    expect(tick("Камран")!.checked).toBe(true)
    expect(tick("Нигяр")!.checked).toBe(false)
    expect(tick("Рашад")!.checked).toBe(true)
    await act(async () => (byTestId("attendance-explain-ask") as HTMLButtonElement).click())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST")!
    expect(JSON.parse(String(post[1]!.body)).items).toEqual([{ agentId: "id-Рашад", date: today, kind: "ABSENT" }, { agentId: "id-Камран", date: today, kind: "LATE" }])
  })

  // The card draws six rows. A seventh late arrival came ticked but off screen, so unticking every
  // row HR could see still asked him (verifier, 2026-10-20). Everyone the button asks is drawn.
  it("draws every row the button would ask, so unticking what is on screen leaves nobody asked unseen", async () => {
    explanations = []
    currentReport = reportOf(["Камран", "Лейла", "Орхан", "Сабина", "Тофиг", "Улвия", "Фарид"].map((name, index) => ({ name, start: `09:4${index}` })))
    await render()
    const card = byTestId("attendance-today-attention")!
    const ticks = Array.from(card.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]'))
    const ask = () => byTestId("attendance-explain-ask") as HTMLButtonElement
    const asking = (count: number) => ru.personnel.explainAsk.replace("{count}", String(count))
    // Рашад absent, Нигяр and seven more late: nine to ask, nine rows on screen, each ticked.
    expect(ticks).toHaveLength(9)
    expect(ticks.every(tick => tick.checked)).toBe(true)
    expect(ask().textContent).toBe(asking(9))
    // What the card leaves out is the rest — the missing finish and the suspicious mark — and it says so.
    expect(Array.from(card.querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]')).map(item => item.dataset.type))
      .toEqual(["absent", ...Array(8).fill("late")])
    expect(card.textContent).toContain(ru.personnel.moreAttention.replace("{count}", "2"))
    for (const tick of ticks) await act(async () => tick.click())
    expect(ask().textContent).toBe(asking(0))
    expect(ask().disabled).toBe(true)
    // Ticking one back asks that one alone.
    await act(async () => card.querySelector<HTMLInputElement>(`input[aria-label="${p("explainSelect").replace("{name}", "Фарид")}"]`)!.click())
    expect(ask().textContent).toBe(asking(1))
    await act(async () => ask().click())
    const posts = fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST")
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0][1]!.body)).items).toEqual([{ agentId: "id-Фарид", date: today, kind: "LATE" }])
  })

  // After the one click everyone asked is no longer «to ask»; the rows below the sixth dropped off
  // and an answer there could be read and decided nowhere — this card is the only place that decides
  // one (verifier, 2026-10-20). A row once asked keeps its place on the card.
  it("keeps everyone it asked on the card after the click, so an answer below the sixth row can be accepted", async () => {
    explanations = []
    const late = ["Камран", "Лейла", "Орхан", "Сабина", "Тофиг", "Улвия", "Фарид"]
    currentReport = reportOf(late.map((name, index) => ({ name, start: `09:4${index}` })))
    await render()
    const card = () => byTestId("attendance-today-attention")!
    const rows = () => Array.from(card().querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]'))
    const names = () => rows().map(row => row.querySelector("p")!.textContent)
    expect(rows()).toHaveLength(9)
    // What the phones send back: all nine asked at 10:05, Нигяр — the ninth row — has answered.
    const asked = (name: string, kind: "LATE" | "ABSENT", answer: string | null) => ({ id: `e-${name}`, employeeId: `id-${name}`, employeeName: name, date: today, kind,
      status: answer ? "ANSWERED" : "REQUESTED", lateMinutes: kind === "LATE" ? 30 : null, requestedAt: at(today, "10:05"), requestedByName: "HR", answer,
      answeredAt: answer ? at(today, "10:20") : null, decidedAt: null, decidedByName: null })
    explanations = [asked("Рашад", "ABSENT", null), ...late.map(name => asked(name, "LATE", null)), asked("Нигяр", "LATE", "Пробка на въезде")]
    await act(async () => (byTestId("attendance-explain-ask") as HTMLButtonElement).click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST")!
    expect(JSON.parse(String(post[1]!.body)).items).toHaveLength(9)
    // Nobody left to ask, and still all nine on the card, each with how its question stands.
    expect(byTestId("attendance-explain-bar")).toBeNull()
    expect(names()).toEqual(["Рашад", "Фарид", "Улвия", "Тофиг", "Сабина", "Орхан", "Лейла", "Камран", "Нигяр"])
    expect(rows().map(row => row.querySelector('[data-testid="attendance-explain-status"]')?.textContent))
      .toEqual([...Array(8).fill(ru.personnel.explainWaiting.replace("{time}", "10:05")), p("explainAnswered")])
    expect(card().textContent).toContain(ru.personnel.moreAttention.replace("{count}", "2"))
    await act(async () => buttonIn(rows()[8], p("explainAnswered"))!.click())
    expect(byTestId("attendance-explain-answer")?.textContent).toContain("Пробка на въезде")
    await act(async () => buttonIn(byTestId("attendance-explain-answer"), p("explainAccept"))!.click())
    const decision = fetchMock.mock.calls.find(([url]) => String(url) === `/api/v1/mtm/attendance/explanations/${encodeURIComponent("e-Нигяр")}/decision`)!
    expect(JSON.parse(String(decision[1]!.body))).toEqual({ decision: "ACCEPTED" })
  })

  // Asked as absent at 09:20, Рашад comes at 11:30 and answers on his phone. By then his row is a late
  // one; his answer disappeared with the absent row, nothing in the CRM could decide it, and the one
  // click ticked his late row and asked him again (verifier, 2026-10-20).
  it("keeps the answer of someone asked as absent who then came late readable and decidable, and never asks him again", async () => {
    explanations = []
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    await render()
    const card = () => byTestId("attendance-today-attention")!
    const rowOf = (name: string) => Array.from(card().querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]')).find(row => row.querySelector("p")!.textContent === name)!
    const tick = (name: string) => rowOf(name).querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const ask = () => byTestId("attendance-explain-ask") as HTMLButtonElement | null
    const posts = () => fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/v1/mtm/attendance/explanations" && init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)).items)
    const minute = async () => {
      await act(async () => { vi.advanceTimersByTime(60_000) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    }
    // 09:20 — Рашад has not marked in: absent, ticked; HR asks with the one button.
    expect(rowOf("Рашад").dataset.type).toBe("absent")
    expect(tick("Рашад").checked).toBe(true)
    explanations = [explanationOf("Рашад", "ABSENT", "REQUESTED"), explanationOf("Нигяр", "LATE", "REQUESTED")]
    await act(async () => ask()!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(posts()).toEqual([[{ agentId: "id-Рашад", date: today, kind: "ABSENT" }, { agentId: "id-Нигяр", date: today, kind: "LATE" }]])

    // 11:30 — he marks in, 2 h 30 min late, and answers the absence question. The minute's reload.
    currentReport = reportOf([{ name: "Рашад", start: "11:30" }])
    explanations = [explanationOf("Рашад", "ABSENT", "ANSWERED", "Был у врача"), explanationOf("Нигяр", "LATE", "REQUESTED")]
    await minute()
    const rashad = () => rowOf("Рашад")
    expect(rashad().dataset.type).toBe("late")
    // His late row carries the answer, is not ticked for another question, and says what the answer is to.
    expect(rashad().querySelector('[data-testid="attendance-explain-status"]')?.textContent).toBe(p("explainAnswered"))
    expect(tick("Рашад").checked).toBe(false)
    expect(tick("Рашад").disabled).toBe(true)
    expect(rashad().querySelector('[data-testid="attendance-explain-about"]')?.textContent).toBe(p("explainForAbsent"))
    // Nobody is left to ask, so there is nothing to press: the bar is gone.
    expect(byTestId("attendance-explain-bar")).toBeNull()
    expect(card().querySelectorAll('[data-testid="attendance-today-attention-item"]')).toHaveLength(4)

    // HR reads the answer under his row and accepts it.
    await act(async () => buttonIn(rashad(), p("explainAnswered"))!.click())
    const answer = byTestId("attendance-explain-answer")!
    expect(rashad().contains(answer)).toBe(true)
    expect(answer.textContent).toContain("Был у врача")
    expect(byTestId("attendance-explain-answered-at")?.textContent).toBe(ru.personnel.explainAnsweredAt.replace("{time}", "11:35"))
    explanations = [{ ...explanationOf("Рашад", "ABSENT", "ACCEPTED", "Был у врача"), decidedAt: at(today, "11:50"), decidedByName: "HR" }, explanationOf("Нигяр", "LATE", "REQUESTED")]
    await act(async () => buttonIn(answer, p("explainAccept"))!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const decision = fetchMock.mock.calls.find(([url]) => String(url) === `/api/v1/mtm/attendance/explanations/${encodeURIComponent("e-Рашад")}/decision`)!
    expect(JSON.parse(String(decision[1]!.body))).toEqual({ decision: "ACCEPTED" })
    expect(rashad().querySelector('[data-testid="attendance-explain-status"]')?.textContent).toBe(p("explainAccepted"))

    // 11:40 — Камран comes in late. The bar counts him alone; the press asks him alone, never Рашад again.
    currentReport = reportOf([{ name: "Рашад", start: "11:30" }, { name: "Камран", start: "11:40" }])
    await minute()
    expect(tick("Камран").checked).toBe(true)
    expect(tick("Рашад").checked).toBe(false)
    expect(byTestId("attendance-explain-bar")!.textContent).toContain(ru.personnel.explainSelectAll.replace("{count}", "1"))
    expect(ask()!.textContent).toBe(ru.personnel.explainAsk.replace("{count}", "1"))
    explanations = [...explanations, explanationOf("Камран", "LATE", "REQUESTED")]
    await act(async () => ask()!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(posts()).toHaveLength(2)
    expect(posts()[1]).toEqual([{ agentId: "id-Камран", date: today, kind: "LATE" }])
    // «Hamısını seç» cannot bring him back either: once everyone is asked there is no bar at all.
    expect(byTestId("attendance-explain-bar")).toBeNull()
  })

  // Asked as absent, then HR records his sick leave: no late or absent row is left for him, but his
  // answer is still to be decided — it keeps a row of its own until it is, and he is not «without questions».
  it("gives an open explanation whose row left the list a row of its own until it is decided", async () => {
    const sick: AttendanceApprovedPeriod = { id: "sick", agentId: "id-Рашад", startDate: today, endDate: today, decidedAt: at(today, "10:00"),
      details: { kind: "SICK_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "SICK_LEAVE")! } }
    currentReport = reportOf([], [sick])
    explanations = [explanationOf("Рашад", "ABSENT", "ANSWERED", "Температура 39"), explanationOf("Нигяр", "LATE", "REQUESTED")]
    await render()
    const card = byTestId("attendance-today-attention")!
    const items = Array.from(card.querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]'))
    expect(items.map(item => item.dataset.type)).toEqual(["late", "explanation", "missing-finish", "risk"])
    const own = items[1]
    expect(own.querySelector("p")!.textContent).toBe("Рашад")
    expect(own.querySelector('[data-testid="attendance-explain-about"]')?.textContent).toBe(p("explainForAbsent"))
    expect(own.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
    expect(own.querySelector("a")!.getAttribute("href")).toBe(`/mtm/attendance/timesheet?date=${today}&employeeId=${encodeURIComponent("id-Рашад")}`)
    // The card's count includes his row, and «the rest, no questions» is Айсель alone.
    expect(card.querySelector("span.rounded-full")?.textContent).toBe("4")
    expect(card.textContent).toContain(ru.personnel.quiet.replace("{count}", "1"))
    expect(byTestId("attendance-explain-bar")).toBeNull()
    await act(async () => buttonIn(own, p("explainAnswered"))!.click())
    expect(byTestId("attendance-explain-answer")?.textContent).toContain("Температура 39")
    explanations = [{ ...explanationOf("Рашад", "ABSENT", "REJECTED", "Температура 39"), decidedAt: at(today, "11:50") }, explanationOf("Нигяр", "LATE", "REQUESTED")]
    await act(async () => buttonIn(byTestId("attendance-explain-answer"), p("explainReject"))!.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const decision = fetchMock.mock.calls.find(([url]) => String(url) === `/api/v1/mtm/attendance/explanations/${encodeURIComponent("e-Рашад")}/decision`)!
    expect(JSON.parse(String(decision[1]!.body))).toEqual({ decision: "REJECTED" })
    // Decided: the row has done its work and leaves the card.
    expect(Array.from(card.querySelectorAll<HTMLElement>('[data-testid="attendance-today-attention-item"]')).map(item => item.dataset.type)).toEqual(["late", "missing-finish", "risk"])
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
    // When the answer came, in the organisation's time (the «Kadr uçotu» clip, 2026-10-20).
    expect(byTestId("attendance-explain-answered-at")?.textContent).toBe(ru.personnel.explainAnsweredAt.replace("{time}", "11:00"))
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
