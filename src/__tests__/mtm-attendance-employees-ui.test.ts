// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceEmployees } from "@/components/mtm/attendance-employees"
import type { AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const response = (data: unknown, status = 200, code = "PRIVATE_SERVER_TRACE") => new Response(JSON.stringify({ success: status < 400, data, code }), { status })
const fetchMock = vi.fn<typeof fetch>()
let root: Root, container: HTMLDivElement, locale: "ru" | "az" | "en", directory: AttendanceEmployeeDirectory, unmounted: boolean
const t = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "mtmAttendance" })(key, values)
const button = (key: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === t(key))!
const click = async (key: string) => { await act(async () => button(key).click()) }
const postCalls = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
async function render(language = locale) { locale = language; const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceEmployees) }; await act(async () => root.render(createElement(NextIntlClientProvider, props))) }
const field = (id: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
async function edit(id: string, value: string) { await act(async () => { const input = field(id); Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) }) }
async function submit(history = false) { await act(async () => container.querySelector(`[data-testid="${history ? "employees-history" : "employees-enrollment"}"] form`)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
async function fillEnrollment() { for (const [id, value] of [["enroll-user", "user-leyla"], ["enroll-team", "team-centre"], ["enroll-date", "2026-10-01"], ["enroll-reason", "Fictional employment"]]) await edit(id, value) }
async function openHistory(index = 0) { await act(async () => container.querySelectorAll<HTMLButtonElement>('[data-testid="employee-row"] button')[index].click()) }
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR; if (!dir) return
  mkdirSync(dir, { recursive: true }); const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("input").forEach((field, i) => clone.querySelectorAll("input")[i].setAttribute("value", field.value))
  container.querySelectorAll("select").forEach((field, i) => [...clone.querySelectorAll("select")[i].options].forEach(option => { if (option.value === field.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") }))
  writeFileSync(join(dir, `attendance-employees-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f6f7f9;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)
}
beforeEach(() => {
  locale = "ru"; unmounted = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  directory = { timezone: "Asia/Baku", users: [{ id: "user-leyla", name: "Leyla Demo", existingRole: null, existingTeamId: null, eligible: true }, { id: "user-rauf", name: "Rauf Demo", existingRole: "MANAGER", existingTeamId: "team-centre", eligible: true }, { id: "ineligible", name: "Hidden Demo", existingRole: "AGENT", existingTeamId: null, eligible: false }], teams: [{ id: "team-centre", name: "Demo Centre" }, { id: "team-north", name: "Demo North" }], employees: [
    { id: "employee-aylin", name: "Aylin Demo", role: "EMPLOYEE", teamName: "Demo Centre", status: "ACTIVE", history: [{ id: "hire-1", kind: "HIRE", date: "2026-10-01", at: "2026-09-30T20:00:00.000Z", byName: "Rauf Demo" }] },
    { id: "employee-murad", name: "Murad Demo", role: "AGENT", teamName: "Demo North", status: "ACTIVE", history: [] },
  ] }
  fetchMock.mockReset(); fetchMock.mockImplementation(async (url, options) => options?.method === "POST" ? response({ ...(String(url).endsWith("/history") ? { eventId: "new-event" } : { agentId: "new-employee" }), idempotent: false }) : response(directory)); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe("actual employee enrollment and immutable history UI", () => {
  it.each(["ru", "az", "en"] as const)("renders %s with explicit dates, localized roles and authors", async language => {
    await render(language); expect(field("enroll-date").value).toBe(""); expect(field("enroll-user").value).toBe(""); expect(container.textContent).not.toMatch(/mtmAttendance\.|mtmStatus\.|undefined|Hidden Demo|EMPLOYEE|AGENT/)
    await fillEnrollment(); await openHistory(); await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional employment change"); expect(container.querySelectorAll('[data-testid="employment-event"]')).toHaveLength(1); expect(container.textContent).toContain(t("employeesAuthor", { name: "Rauf Demo" })); capture()
  })
  it("does not submit an absent date or a short reason", async () => {
    await render(); await edit("enroll-user", "user-leyla"); await submit(); expect(postCalls()).toHaveLength(0); expect(container.textContent).toContain(t("employeesInvalid"))
    await edit("enroll-date", "2026-10-01"); await edit("enroll-reason", "ab"); await submit(); expect(postCalls()).toHaveLength(0)
  })
  it("enrolls only the chosen existing user and refreshes the roster", async () => {
    await render(); await fillEnrollment(); await submit()
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ userId: "user-leyla", teamId: "team-centre", hireDate: "2026-10-01", reason: "Fictional employment" })
    expect(JSON.parse(postCalls()[0][1]!.body as string).clientRequestId).toMatch(/^[a-f0-9-]{36}$/); expect(field("enroll-date").value).toBe(""); expect(container.textContent).toContain(t("employeesSaved")); expect(fetchMock.mock.calls.filter(([, options]) => options?.method !== "POST")).toHaveLength(2)
  })
  it("does not claim the history refreshed when a confirmed write is followed by a failed reload", async () => {
    await render(); await fillEnrollment()
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response({ agentId: "new-employee", idempotent: false }) : response(null, 500))
    await submit(); expect(container.textContent).toContain(t("employeesLoadError")); expect(container.textContent).not.toContain(t("employeesSaved")); expect(button("employeesCheckWrite")).toBeUndefined(); expect(container.querySelector("form")).toBeNull()
  })
  it("retains an existing manager's team even if a synthetic DOM change attempts another", async () => {
    await render(); await edit("enroll-user", "user-rauf"); expect(field("enroll-team").disabled).toBe(true); expect(field("enroll-team").value).toBe("team-centre"); expect(container.textContent).toContain(t("employeesManagerHint"))
    await edit("enroll-team", "team-north"); await edit("enroll-date", "2026-10-01"); await edit("enroll-reason", "Fictional enrollment"); await submit(); expect(JSON.parse(postCalls()[0][1]!.body as string).teamId).toBe("team-centre")
  })
  it("records termination with the last known immutable event and explicit last working day", async () => {
    await render(); await openHistory(); expect(field("employment-date").value).toBe(""); expect(field("employment-kind").value).toBe("TERMINATION")
    await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional termination"); await submit(true)
    expect(postCalls()[0][0]).toBe("/api/v1/mtm/attendance/employees/history"); expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ agentId: "employee-aylin", kind: "TERMINATION", date: "2026-10-31", previousEventId: "hire-1" }); expect(container.querySelector('[data-testid="employees-history"]')).toBeNull()
  })
  it("records the first HIRE without inventing a prior event", async () => {
    await render(); await openHistory(1); expect(field("employment-kind").value).toBe("HIRE"); await edit("employment-date", "2026-10-01"); await edit("employment-reason", "Fictional hire"); await submit(true)
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ kind: "HIRE", previousEventId: null, agentId: "employee-murad" })
  })
  it("permits a rehire date immediately after the last working date without inventing an off-day", async () => {
    directory.employees[0].history.push({ id: "term-1", kind: "TERMINATION", date: "2026-10-31", at: "2026-10-31T20:00:00Z", byName: null })
    await render(); await openHistory(); expect(field("employment-kind").value).toBe("REHIRE"); await edit("employment-date", "2026-11-01"); await edit("employment-reason", "Fictional rehire"); await submit(true)
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ kind: "REHIRE", date: "2026-11-01", previousEventId: "term-1" })
  })
  it("replays an unknown outcome with exactly the same UUID/body after a language change", async () => {
    const original = fetchMock.getMockImplementation()!; let failed = false
    fetchMock.mockImplementation(async (url, options) => { if (options?.method === "POST" && !failed) { failed = true; throw new Error("PRIVATE_NETWORK") } return original(url, options) })
    const storage = vi.spyOn(Storage.prototype, "setItem"); await render(); await fillEnrollment(); await submit(); const body = postCalls()[0][1]!.body
    expect(container.textContent).toContain(t("employeesUnconfirmed")); expect(button("employeesRefresh").disabled).toBe(true); expect(field("enroll-reason").disabled).toBe(true)
    await render("az"); await click("employeesCheckWrite"); expect(postCalls()).toHaveLength(2); expect(postCalls()[1][1]!.body).toBe(body); expect(storage).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("PRIVATE_NETWORK")
  })
  it("keeps an in-flight write stable on locale change", async () => {
    const original = fetchMock.getMockImplementation()!; let resolve: (value: Response) => void = () => {}
    fetchMock.mockImplementation((url, options) => options?.method === "POST" ? new Promise<Response>(done => { resolve = done }) : original(url, options))
    await render(); await fillEnrollment(); await submit(); const signal = postCalls()[0][1]!.signal!; await render("en"); expect(signal.aborted).toBe(false)
    await act(async () => resolve(response({ agentId: "new-employee", idempotent: false }))); expect(container.textContent).toContain(t("employeesSaved")); expect(postCalls()).toHaveLength(1)
  })
  it.each([401, 403, 404])("clears directory and private drafts on HTTP %s", async status => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, status)) : original(url, options))
    await render(); await fillEnrollment(); await submit(); expect(container.textContent).toContain(t("employeesAccessUnavailable")); expect(container.textContent).not.toMatch(/Aylin|Leyla|Rauf|Demo Centre|PRIVATE_/); expect(container.querySelector("input")).toBeNull(); expect(button("employeesCheckWrite")).toBeUndefined()
  })
  it("removes previously visible users when refresh loses administrator access", async () => {
    await render(); fetchMock.mockResolvedValue(response(null, 403)); await click("employeesRefresh"); expect(container.textContent).not.toContain("Aylin"); expect(container.querySelector("select")).toBeNull()
  })
  it("requires a fresh read after a stale history response", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, 409, "MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED")) : original(url, options))
    await render(); await openHistory(); await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional termination"); await submit(true)
    expect(container.textContent).toContain(t("employeesChanged")); expect(button("employeesSaveChange").disabled).toBe(true); await click("employeesRefresh"); expect(container.querySelector('[data-testid="employees-history"]')).toBeNull()
  })
  it("renders a known date error without retrying or showing server traces", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, 400, "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID")) : original(url, options))
    await render(); await fillEnrollment(); await submit(); expect(container.textContent).toContain(t("employeesDateInvalid")); expect(button("employeesCheckWrite")).toBeUndefined(); expect(button("employeesEnroll").disabled).toBe(false)
  })
  it("handles empty data and bounds roster/history DOM without truncating access to records", async () => {
    directory.users = []; directory.employees = []; await render(); expect(container.textContent).toContain(t("employeesEmpty")); expect(container.textContent).toContain(t("employeesNoEligible"))
    directory.employees = Array.from({ length: 51 }, (_, i) => ({ id: `employee-${i}`, name: `Demo ${i}`, role: "AGENT", status: "ACTIVE", teamName: null, history: Array.from({ length: 22 }, (_, j) => ({ id: `event-${j}`, kind: "HIRE" as const, date: "2026-10-01", at: "2026-09-30T20:00:00Z", byName: null })) }))
    await click("employeesRefresh"); expect(container.querySelectorAll('[data-testid="employee-row"]')).toHaveLength(25); await click("employeesNext"); expect(container.textContent).toContain("Demo 25"); await openHistory(); expect(container.querySelectorAll('[data-testid="employment-event"]')).toHaveLength(20)
    await edit("employee-search", "Demo 50"); expect(container.querySelectorAll('[data-testid="employee-row"]')).toHaveLength(1)
  })
  it("aborts a pending write on unmount and ignores its late response", async () => {
    const original = fetchMock.getMockImplementation()!; let resolve: (value: Response) => void = () => {}
    fetchMock.mockImplementation((url, options) => options?.method === "POST" ? new Promise<Response>(done => { resolve = done }) : original(url, options))
    await render(); await fillEnrollment(); await submit(); const count = fetchMock.mock.calls.length; await act(async () => root.unmount()); unmounted = true
    expect(postCalls()[0][1]!.signal!.aborted).toBe(true); await act(async () => resolve(response({ agentId: "new", idempotent: true }))); expect(fetchMock.mock.calls).toHaveLength(count)
  })
  it("does not show an editable directory after failed or aborted loading", async () => {
    fetchMock.mockResolvedValue(response(null, 500)); await render(); expect(container.textContent).toContain(t("employeesLoadError")); expect(container.querySelector("form")).toBeNull()
    fetchMock.mockImplementation(() => new Promise<Response>(() => {})); await click("employeesRefresh"); const signal = fetchMock.mock.calls.at(-1)![1]!.signal!; await act(async () => root.unmount()); unmounted = true; expect(signal.aborted).toBe(true)
  })
})
