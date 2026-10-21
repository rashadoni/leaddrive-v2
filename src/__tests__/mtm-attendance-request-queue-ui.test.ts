// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceRequestQueue } from "@/components/mtm/attendance-request-queue"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const locales = { ru: messages("ru"), az: messages("az"), en: messages("en") }
const dayKinds = defaultAttendanceDayKinds(key => ({ ru: locales.ru.mtmAttendance[`dayKindName${key}`], az: locales.az.mtmAttendance[`dayKindName${key}`], en: locales.en.mtmAttendance[`dayKindName${key}`] }))
const id = (index: number) => `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`
const version = "2026-10-13T08:00:00.000Z"
function request(index = 1, patch: Partial<AttendanceReviewItem> = {}): AttendanceReviewItem {
  return {
    id: id(index), clientRequestId: id(index + 100), agentId: `demo-agent-${index}`, status: "PENDING",
    startDate: "2026-10-15", endDate: "2026-10-15", reason: "Демонстрационная заявка: запись к врачу на два часа.",
    submittedAt: version, decisionNote: null, decidedAt: null, cancelledAt: null, version,
    details: { version: 1, kind: "HOURLY_ABSENCE", unit: "HOURS", startTime: "10:00", endTime: "12:00", timezone: "Asia/Baku", dayKind: dayKinds.find(kind => kind.key === "HOURLY_ABSENCE")!, attachmentIds: [id(200)] },
    employeeName: "Aylin Demo", teamName: "Demo North", reviewerName: null,
    approval: { twoStep: false, awaiting: null, manager: null, passesToHr: false }, canDecide: true, ...patch,
  }
}
const fixture = () => [request(), request(2, { employeeName: "Murad Demo", reason: "Демонстрационная заявка: забыта отметка ухода.", startDate: "2026-10-12", endDate: "2026-10-12",
  details: { ...request().details, kind: "TIME_CORRECTION", startTime: "09:00", endTime: "18:00", dayKind: dayKinds.find(kind => kind.key === "WORKED")!, attachmentIds: [], correctionBasis: { kind: "MISSING", workDate: "2026-10-12" } } }),
  request(3, { employeeName: "Leyla Demo", teamName: "Demo South", reason: "Демонстрационная заявка: отпуск.", startDate: "2026-10-19", endDate: "2026-10-23", details: { ...request().details, kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, dayKind: dayKinds.find(kind => kind.key === "ANNUAL_LEAVE")!, attachmentIds: [] } })]
const response = (items: AttendanceReviewItem[] = fixture(), cursor: string | null = null, status = 200) => new Response(JSON.stringify({ success: status < 400, data: { items, nextCursor: cursor }, error: "PRIVATE_INTERNAL_ERROR" }), { status })
const decided = (row: AttendanceReviewItem) => new Response(JSON.stringify({ success: true, data: { request: row } }))
const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement, root: Root, language: "az" | "ru" | "en"
const translation = (key: string) => locales[language].mtmAttendance[key]
const row = (index = 1) => container.querySelector<HTMLElement>(`[data-testid="attendance-request-${id(index)}"]`)!
const button = (key: string, region: HTMLElement = container) => Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === translation(key))!
async function render(locale: typeof language = language) {
  language = locale
  const providerProps = { locale, timeZone: "Asia/Baku", messages: locales[locale], children: createElement(MtmAttendanceRequestQueue) }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
async function click(key: string, region: HTMLElement = container) { await act(async () => button(key, region).click()) }
async function editNote(value: string) { await act(async () => {
  const field = container.querySelector("textarea")!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value)
  field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }))
}) }
async function filter(status: string) { await act(async () => { const field = container.querySelector("select")!; field.value = status; field.dispatchEvent(new Event("change", { bubbles: true })) }) }
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
beforeEach(() => {
  window.history.replaceState({}, "", "/"); language = "ru"; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(async () => response()); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function capture(locale: string, variant = "") {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("select").forEach((select, index) => {
    const target = clone.querySelectorAll("select")[index]
    Array.from(target.options).forEach(option => { if (option.value === select.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") })
  })
  container.querySelectorAll("textarea").forEach((field, index) => { clone.querySelectorAll("textarea")[index].textContent = field.value })
  writeFileSync(join(directory, `attendance-request-queue-${locale}${variant ? `-${variant}` : ""}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)
}

describe("actual attendance review queue", () => {
  it("opens only the authorized linked request with the decided-history filter", async () => {
    window.history.replaceState({}, "", `/mtm/attendance/requests?requestId=${id(1)}`)
    fetchMock.mockImplementation(async () => response([{ ...request(), status: "APPROVED", decidedAt: version }]))
    await render()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`/api/v1/mtm/attendance/requests?status=ALL&requestId=${id(1)}`)
    expect(container.querySelector("select")!.disabled).toBe(true)
    expect(container.textContent).toContain(request().reason)
    expect(button("requestsApprove")).toBeUndefined()
    await click("requestsAll")
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/requests?status=ALL")
    expect(container.querySelector("select")!.disabled).toBe(false)
  })

  it.each(["ru", "az", "en"] as const)("renders scoped request types, explicit actions and document links in %s", async locale => {
    await render(locale)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/mtm/attendance/requests?status=PENDING")
    expect(container.querySelector("select")!.value).toBe("PENDING")
    expect(container.querySelectorAll("li")).toHaveLength(3)
    expect(container.textContent).toContain(translation("requestsTimeCorrection"))
    expect(row(1).textContent).toContain("10:00–12:00")
    expect(container.textContent).not.toContain(request().reason)
    await click("requestsOpen", row(1))
    expect(row(1).textContent).toContain(request().reason)
    expect(button("requestsApprove").disabled).toBe(false)
    expect(button("requestsReject").disabled).toBe(true)
    expect(container.querySelector("label textarea")).not.toBeNull()
    const document = row(1).querySelector<HTMLAnchorElement>('a[target="_blank"]')!
    expect(document.getAttribute("href")).toBe(`/api/v1/mtm/attendance/attachments/${id(200)}`)
    expect(document.rel).toContain("noopener")
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_INTERNAL_ERROR|undefined/)
    expect(container.querySelector('[class*="overflow-y-auto"]')).toBeNull()
    capture(locale)
  })
  it("starts with pending only and shows an honest empty state after an empty response", async () => {
    fetchMock.mockImplementation(async () => response([]))
    await render()
    expect(container.textContent).toContain(translation("requestsEmpty"))
    expect(container.querySelector("textarea")).toBeNull()
    expect(button("requestsApprove")).toBeUndefined()
    expect(writes()).toHaveLength(0)
  })
  it("requires three trimmed characters before rejection and posts the exact loaded version", async () => {
    await render(); await click("requestsOpen", row())
    await editNote("  аб  "); expect(button("requestsReject").disabled).toBe(true)
    await click("requestsReject"); expect(writes()).toHaveLength(0)
    await editNote("  Нужна другая дата  ")
    fetchMock.mockResolvedValueOnce(decided({ ...request(), status: "REJECTED", decisionNote: "Нужна другая дата", decidedAt: version }))
    await click("requestsReject")
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe(`/api/v1/mtm/attendance/requests/${id(1)}/decision`)
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ decision: "REJECTED", version, note: "Нужна другая дата" })
    expect(row()).toBeNull(); expect(container.textContent).toContain(translation("requestsSaved"))
  })
  // Two-step approval (owner, 2026-10-21): «сначала руководитель, потом HR».
  it("two-step approval: the manager passes on, sees what waits for HR without buttons, and HR sees who approved", async () => {
    const atHr = request(2, { employeeName: "Murad Demo", approval: { twoStep: true, awaiting: "HR", manager: { name: "Togrul Demo", at: version, note: "Не возражаю" }, passesToHr: false }, canDecide: false })
    const atManager = request(1, { approval: { twoStep: true, awaiting: "MANAGER", manager: null, passesToHr: true }, canDecide: true })
    fetchMock.mockImplementation(async () => response([atManager, atHr]))
    await render()
    expect(row(1).textContent).toContain(translation("requestsAwaitingManager"))
    expect(row(2).textContent).toContain(translation("requestsAwaitingHr"))
    await click("requestsOpen", row(2))
    expect(row(2).textContent).toContain(translation("requestsHrDecides"))
    expect(row(2).querySelector('[data-testid="attendance-request-manager-approval"]')?.textContent).toContain("Не возражаю")
    expect(row(2).querySelector("textarea")).toBeNull()
    capture("ru", "two-step-manager-waiting")
    await click("requestsClose", row(2)); await click("requestsOpen", row(1))
    expect(button("requestsApprove")).toBeUndefined()
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ success: true, data: { request: atManager, passedToHr: true } })))
    fetchMock.mockImplementationOnce(async () => response([{ ...atManager, approval: { ...atHr.approval }, canDecide: false }, atHr]))
    await click("requestsPassToHr")
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(writes()).toHaveLength(1)
    expect(container.textContent).toContain(translation("requestsPassedToHr"))
    expect(row(1).textContent).toContain(translation("requestsAwaitingHr"))
    // HR: the manager's approval is shown and the decision is a plain approve.
    fetchMock.mockImplementation(async () => response([{ ...atHr, canDecide: true }]))
    await click("requestsRefresh"); await click("requestsOpen", row(2))
    expect(row(2).textContent).toContain(translation("requestsManagerApproved").replace("{name}", "Togrul Demo").split(",")[0])
    expect(button("requestsApprove")).toBeDefined()
    capture("ru", "two-step-hr")
  })

  it("approves without a note and prevents a second click while the first response is pending", async () => {
    await render(); await click("requestsOpen", row())
    let resolve!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
    await click("requestsApprove"); await click("requestsSaving")
    expect(writes()).toHaveLength(1)
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ decision: "APPROVED", version, note: null })
    await act(async () => resolve(decided({ ...request(), status: "APPROVED" })))
    expect(row()).toBeNull()
  })
  it("keeps reviewer history read-only for decided requests in the ALL filter", async () => {
    await render()
    const approved = { ...request(), status: "APPROVED" as const, decisionNote: "Демонстрационное согласование", decidedAt: "2026-10-13T09:00:00Z", reviewerName: "Reviewer Demo" }
    fetchMock.mockResolvedValueOnce(response([approved])); await filter("ALL")
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/requests?status=ALL")
    await click("requestsOpen", row())
    expect(row().textContent).toContain("Reviewer Demo")
    expect(row().textContent).toContain(approved.decisionNote)
    expect(container.querySelector("textarea")).toBeNull(); expect(button("requestsApprove")).toBeUndefined()
  })
  it("updates the row in ALL after a confirmed decision instead of removing its history", async () => {
    await render(); await filter("ALL"); await click("requestsOpen", row())
    fetchMock.mockResolvedValueOnce(decided({ ...request(), status: "APPROVED", decidedAt: version }))
    await click("requestsApprove")
    expect(row().textContent).toContain(translation("requestsApproved"))
    expect(row().textContent).toContain("Aylin Demo")
  })
  it.each([401, 403, 404])("clears all private cards and note after a %s decision refusal", async status => {
    await render(); await click("requestsOpen", row()); await editNote("Private reviewer note")
    fetchMock.mockResolvedValueOnce(response([], null, status)); await click("requestsApprove")
    expect(container.querySelectorAll("li")).toHaveLength(0)
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.textContent).toContain(translation("requestsForbidden"))
    expect(container.textContent).not.toContain(request().reason)
    expect(container.textContent).not.toContain("Private reviewer note")
  })
  it("does not render a disabled feature through a direct URL", async () => {
    fetchMock.mockImplementation(async () => response([], null, 404))
    await render()
    expect(container.textContent).toContain(translation("requestsForbidden"))
    expect(container.textContent).not.toContain(translation("requestsEmpty"))
    expect(button("requestsApprove")).toBeUndefined(); expect(container.querySelectorAll("li")).toHaveLength(0)
  })
  it("blocks decisions after a lost reply until a successful refresh", async () => {
    await render(); await click("requestsOpen", row())
    fetchMock.mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_TRACE")); await click("requestsApprove")
    expect(container.textContent).toContain(translation("requestsUnknown"))
    expect(button("requestsApprove").disabled).toBe(true)
    await click("requestsApprove"); expect(writes()).toHaveLength(1)
    fetchMock.mockResolvedValueOnce(response([], null, 500)); await click("requestsRefresh")
    expect(container.textContent).not.toContain("PRIVATE_TRANSPORT_TRACE")
    fetchMock.mockResolvedValueOnce(response([request()])); await click("requestsRefresh"); await click("requestsOpen", row())
    expect(button("requestsApprove").disabled).toBe(false)
  })
  it("requires a fresh read after a stale-version 409 and uses its new version", async () => {
    await render(); await click("requestsOpen", row())
    fetchMock.mockResolvedValueOnce(response([], null, 409)); await click("requestsApprove")
    expect(container.textContent).toContain(translation("requestsChanged"))
    const newer = "2026-10-13T10:00:00.000Z"
    fetchMock.mockResolvedValueOnce(response([request(1, { version: newer })])); await click("requestsRefresh"); await click("requestsOpen", row())
    fetchMock.mockResolvedValueOnce(decided({ ...request(), status: "APPROVED" })); await click("requestsApprove")
    expect(JSON.parse(String(writes()[1][1]?.body)).version).toBe(newer)
  })
  it("paginates without duplicate rows; a temporary next-page failure keeps earlier rows", async () => {
    fetchMock.mockResolvedValueOnce(response([request()], id(1)))
    await render()
    fetchMock.mockResolvedValueOnce(response([], null, 500)); await click("requestsMore")
    expect(row()).not.toBeNull(); expect(container.textContent).toContain(translation("requestsLoadError"))
    // Reload returns a current cursor instead of reusing a server-refused one.
    fetchMock.mockResolvedValueOnce(response([request()], id(1))); await click("requestsRefresh")
    fetchMock.mockResolvedValueOnce(response([request(), request(2)])); await click("requestsMore")
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`/api/v1/mtm/attendance/requests?status=PENDING&cursor=${id(1)}`)
    expect(container.querySelectorAll("li")).toHaveLength(2)
  })
  it("clears earlier pages when a later page reveals access loss", async () => {
    fetchMock.mockResolvedValueOnce(response([request()], id(1))); await render()
    fetchMock.mockResolvedValueOnce(response([], null, 403)); await click("requestsMore")
    expect(container.querySelectorAll("li")).toHaveLength(0)
    expect(container.textContent).toContain(translation("requestsForbidden"))
  })
  it("aborts an in-flight decision on locale change, waits for the new GET, and ignores the late success", async () => {
    await render(); await click("requestsOpen", row())
    let finishWrite!: (response: Response) => void, finishRead!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finishWrite = done }))
    await click("requestsApprove")
    const signal = writes()[0][1]?.signal
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finishRead = done }))
    await render("en")
    expect(signal?.aborted).toBe(true)
    expect(button("requestsRefresh").disabled).toBe(true)
    await act(async () => finishWrite(decided({ ...request(), status: "APPROVED" })))
    expect(container.textContent).not.toContain(translation("requestsSaved"))
    await act(async () => finishRead(response([request(1, { status: "APPROVED", decidedAt: version })])))
    await click("requestsOpen", row())
    expect(container.querySelector("textarea")).toBeNull(); expect(writes()).toHaveLength(1)
  })
  it("filter change after an unknown response fetches current state before enabling another decision", async () => {
    await render(); await click("requestsOpen", row())
    fetchMock.mockRejectedValueOnce(new Error("timeout")); await click("requestsApprove")
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finish = done }))
    await filter("ALL")
    expect(container.querySelectorAll("li")).toHaveLength(0)
    expect(button("requestsRefresh").disabled).toBe(true)
    await act(async () => finish(response([request(1, { status: "APPROVED" })])))
    await click("requestsOpen", row())
    expect(button("requestsApprove")).toBeUndefined(); expect(writes()).toHaveLength(1)
  })
  it("aborts both reads and writes on unmount", async () => {
    await render(); await click("requestsOpen", row())
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {})); await click("requestsApprove")
    const signal = writes()[0][1]?.signal
    await act(async () => root.render(null))
    expect(signal?.aborted).toBe(true)
    await render(); const readSignal = fetchMock.mock.calls.at(-1)?.[1]?.signal
    await act(async () => root.render(null))
    expect(readSignal?.aborted).toBe(true)
  })
})

function approvedLeave(index = 1, kind: "ANNUAL_LEAVE" | "HR_RECORD" = "ANNUAL_LEAVE"): AttendanceReviewItem {
  return request(index, { status: "APPROVED", submittedAt: "2026-10-01T08:00:00.000Z", startDate: "2026-10-05", endDate: "2026-10-09", reason: "Демонстрационный ежегодный отпуск.",
    decidedAt: "2026-10-02T06:30:00.000Z", reviewerName: "Nigar Demo", decisionNote: "Демонстрационное согласование",
    details: { ...request().details, kind, unit: "DAYS", startTime: null, endTime: null, attachmentIds: [], dayKind: dayKinds.find(kind => kind.key === "ANNUAL_LEAVE")! } })
}
const cancelledLeave = (): AttendanceReviewItem => ({ ...approvedLeave(), status: "CANCELLED", cancelledAt: "2026-10-13T11:00:00.000Z", version: "2026-10-13T11:00:00.000Z",
  cancellation: { at: "2026-10-13T11:00:00.000Z", byName: "Reviewer Two Demo", reason: "Демонстрационная отмена по согласованию с сотрудником." } })
async function openRevocation() {
  fetchMock.mockImplementation(async () => response([approvedLeave()]))
  await render(); await filter("APPROVED"); await click("requestsOpen", row()); await click("revocationOpen")
}

describe("approved annual-leave revocation in the real queue", () => {
  it.each(["ru", "az", "en"] as const)("shows the reason and preserved original decision in %s", async locale => {
    fetchMock.mockImplementation(async () => response([approvedLeave()]))
    await render(locale); await filter("APPROVED"); await click("requestsOpen", row())
    expect(container.querySelector("textarea")).toBeNull()
    await click("revocationOpen")
    expect(row().textContent).toContain("Nigar Demo")
    expect(row().textContent).toContain(approvedLeave().decisionNote)
    expect(button("revocationConfirm").disabled).toBe(true)
    await editNote("  аб  "); await click("revocationConfirm"); expect(writes()).toHaveLength(0)
    await editNote("Демонстрационная отмена по согласованию с сотрудником.")
    expect(button("revocationConfirm").disabled).toBe(false)
    expect(container.querySelector("label textarea")).not.toBeNull()
    expect(container.textContent).toContain(translation("revocationDescription"))
    expect(container.textContent).not.toMatch(/mtmAttendance\.|undefined|PRIVATE_INTERNAL_ERROR/)
    capture(locale, "leave-revocation")
  })
  it("leaves the approval unchanged when the reviewer dismisses the editor", async () => {
    await openRevocation(); await editNote("Private draft reason"); await click("revocationKeep")
    expect(writes()).toHaveLength(0); expect(container.querySelector("textarea")).toBeNull()
    expect(row().textContent).toContain("Nigar Demo"); expect(row().textContent).toContain(translation("requestsApproved"))
    await click("revocationOpen"); expect(container.querySelector("textarea")!.value).toBe("")
  })
  it.each(["ANNUAL_LEAVE", "HR_RECORD"] as const)("revokes %s using only the exact version/reason and reloads authoritative history", async kind => {
    fetchMock.mockImplementation(async () => response([approvedLeave(1, kind)]))
    await render(); await filter("ALL"); await click("requestsOpen", row()); await click("revocationOpen"); await editNote("  Перенос по согласованию  ")
    // The mutation DTO deliberately lacks cancellation display data.
    const { cancellation: _cancellation, ...dto } = cancelledLeave(); void _cancellation
    fetchMock.mockResolvedValueOnce(decided(dto)).mockResolvedValueOnce(response([cancelledLeave()]))
    await click("revocationConfirm")
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe(`/api/v1/mtm/attendance/requests/${id(1)}/revoke`)
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ version, reason: "Перенос по согласованию" })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/mtm/attendance/requests?status=ALL")
    expect(container.textContent).toContain(translation("revocationSaved"))
    await click("requestsOpen", row())
    expect(row().textContent).toContain("Nigar Demo"); expect(row().textContent).toContain("Reviewer Two Demo")
    expect(row().textContent).toContain(cancelledLeave().cancellation!.reason)
    expect(button("revocationOpen")).toBeUndefined(); expect(container.querySelector("textarea")).toBeNull()
    expect(container.querySelector('[data-testid="attendance-cancellation-history"]')).not.toBeNull()
  })
  it.each(["hours", "sick", "correction", "pending", "cancelled"])("does not offer approved-leave cancellation for %s", async reason => {
    const item = approvedLeave()
    if (reason === "hours") item.details.unit = "HOURS"
    if (reason === "sick") { item.details.kind = "SICK_LEAVE"; item.details.dayKind = dayKinds.find(kind => kind.key === "SICK_LEAVE")! }
    if (reason === "correction") item.details.kind = "TIME_CORRECTION"
    if (reason === "pending") item.status = "PENDING"
    if (reason === "cancelled") item.status = "CANCELLED"
    fetchMock.mockImplementation(async () => response([item])); await render(); await click("requestsOpen", row())
    expect(button("revocationOpen")).toBeUndefined(); expect(writes()).toHaveLength(0)
  })
  it.each([401, 403, 404])("clears private details and the reason after a %s revocation refusal", async status => {
    await openRevocation(); await editNote("Private cancellation reason")
    fetchMock.mockResolvedValueOnce(response([], null, status)); await click("revocationConfirm")
    expect(container.querySelectorAll("li")).toHaveLength(0); expect(container.querySelector("textarea")).toBeNull()
    expect(container.textContent).not.toContain("Private cancellation reason")
    expect(container.textContent).toContain(translation("requestsForbidden"))
  })
  it.each(["network", "invalid-json", "conflict"])("blocks a second write after %s until a fresh successful read", async failure => {
    await openRevocation(); await editNote("Перенос отпуска")
    if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_ERROR"))
    else if (failure === "invalid-json") fetchMock.mockResolvedValueOnce(new Response("not json"))
    else fetchMock.mockResolvedValueOnce(response([], null, 409))
    await click("revocationConfirm"); await click("revocationConfirm")
    expect(writes()).toHaveLength(1); expect(button("revocationConfirm").disabled).toBe(true)
    expect(container.textContent).not.toContain("PRIVATE_TRANSPORT_ERROR")
    fetchMock.mockResolvedValueOnce(response([], null, 500)); await click("requestsRefresh")
    expect(button("revocationConfirm")).toBeUndefined()
    fetchMock.mockResolvedValueOnce(response([cancelledLeave()])); await filter("ALL"); await click("requestsOpen", row())
    expect(row().textContent).toContain(cancelledLeave().cancellation!.reason)
    expect(button("revocationOpen")).toBeUndefined(); expect(writes()).toHaveLength(1)
  })
  it("requires a successful reload even when cancellation was confirmed but reading history failed", async () => {
    await openRevocation(); await editNote("Перенос отпуска")
    fetchMock.mockResolvedValueOnce(decided(cancelledLeave())).mockResolvedValueOnce(response([], null, 500))
    await click("revocationConfirm")
    expect(container.textContent).toContain(translation("requestsLoadError"))
    expect(container.textContent).not.toContain(translation("revocationSaved"))
    expect(container.querySelectorAll("li")).toHaveLength(0)
    fetchMock.mockResolvedValueOnce(response([cancelledLeave()])); await filter("ALL"); await click("requestsOpen", row())
    expect(row().textContent).toContain("Reviewer Two Demo"); expect(writes()).toHaveLength(1)
  })
  it("aborts a pending cancellation on locale change, reconciles by GET and ignores the late write reply", async () => {
    await openRevocation(); await editNote("Перенос отпуска")
    let finishWrite!: (response: Response) => void, finishRead!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finishWrite = done }))
    await click("revocationConfirm"); await click("requestsSaving"); expect(writes()).toHaveLength(1)
    const signal = writes()[0][1]?.signal
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finishRead = done })); await render("en")
    expect(signal?.aborted).toBe(true); expect(button("requestsRefresh").disabled).toBe(true)
    await act(async () => finishWrite(decided(cancelledLeave())))
    expect(container.textContent).not.toContain(translation("revocationSaved"))
    await act(async () => finishRead(response([cancelledLeave()])))
    await click("requestsOpen", row()); expect(row().textContent).toContain("Reviewer Two Demo")
    expect(button("revocationOpen")).toBeUndefined(); expect(writes()).toHaveLength(1)
  })
  it("aborts the pending cancellation when leaving the queue", async () => {
    await openRevocation(); await editNote("Перенос отпуска")
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {})); await click("revocationConfirm")
    const signal = writes()[0][1]?.signal
    await act(async () => root.render(null)); expect(signal?.aborted).toBe(true)
  })
})
