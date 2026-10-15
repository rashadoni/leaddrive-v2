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
async function submit() { await act(async () => container.querySelector(`[data-testid="employees-history"] form[aria-label="${t("employeesRecordChange")}"]`)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
async function toggle(index = 0) { await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[index].click()) }
async function openHistory(index = 0) { await act(async () => container.querySelectorAll<HTMLButtonElement>('[data-testid="employee-row"] button:not([role="switch"])')[index].click()) }
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR; if (!dir) return
  mkdirSync(dir, { recursive: true }); const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("input").forEach((field, i) => clone.querySelectorAll("input")[i].setAttribute("value", field.value))
  container.querySelectorAll("select").forEach((field, i) => [...clone.querySelectorAll("select")[i].options].forEach(option => { if (option.value === field.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") }))
  writeFileSync(join(dir, `attendance-employees-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f6f7f9;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)
}
beforeEach(() => {
  locale = "ru"; unmounted = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  directory = { timezone: "Asia/Baku", users: [{ id: "user-leyla", name: "Leyla Demo", existingRole: null, existingTeamId: null, eligible: true }, { id: "user-rauf", name: "Rauf Demo", existingRole: "MANAGER", existingTeamId: "team-centre", eligible: true }, { id: "ineligible", name: "Hidden Demo", existingRole: "AGENT", existingTeamId: null, eligible: false }], teams: [{ id: "team-centre", name: "Demo Centre" }, { id: "team-north", name: "Demo North" }],
    managers: [{ id: "manager-rauf", name: "Rauf Demo", position: "Руководитель отдела" }, { id: "employee-murad", name: "Murad Demo", position: null }], employees: [
    { id: "employee-aylin", name: "Aylin Demo", role: "EMPLOYEE", teamName: "Demo Centre", position: "Бухгалтер", teamId: "team-centre", managerId: null, status: "ACTIVE", included: true, participationVersion: null, includedFrom: null, history: [{ id: "hire-1", kind: "HIRE", date: "2026-10-01", at: "2026-09-30T20:00:00.000Z", byName: "Rauf Demo" }] },
    { id: "employee-murad", name: "Murad Demo", role: "AGENT", teamName: "Demo North", position: null, teamId: "team-north", managerId: null, status: "ACTIVE", included: true, participationVersion: null, includedFrom: null, history: [] },
  ] }
  fetchMock.mockReset(); fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response({ eventId: "new-event", idempotent: false }) : response(directory)); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe("automatic employee participation and immutable history UI", () => {
  it.each(["ru", "az", "en"] as const)("renders %s with automatic participation, localized roles and no enrollment form", async language => {
    directory.employees[1].included = false
    await render(language); expect(container.querySelector('[data-testid="employees-enrollment"]')).toBeNull(); expect(container.querySelector("form")).toBeNull()
    expect(container.textContent).not.toMatch(/mtmAttendance\.|mtmStatus\.|undefined|Hidden Demo|EMPLOYEE|AGENT/)
    expect(container.textContent).toContain(t("employeesAutomaticHint")); expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
    expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true"); capture()
    await openHistory(); expect(field("employment-date").value).toBe(""); expect(container.querySelectorAll('[data-testid="employment-event"]')).toHaveLength(1); expect(container.textContent).toContain(t("employeesAuthor", { name: "Rauf Demo" }))
  })
  it("keeps explicit date and comment validation only for personnel changes", async () => {
    await render(); await openHistory(); await submit(); expect(postCalls()).toHaveLength(0); expect(container.textContent).toContain(t("employeesInvalid"))
    await edit("employment-date", "2026-10-31"); await edit("employment-reason", "ab"); await submit(); expect(postCalls()).toHaveLength(0)
  })
  it("excludes only the chosen employee without requesting a reason or altering the account", async () => {
    await render(); await toggle()
    expect(postCalls()[0][0]).toBe("/api/v1/mtm/attendance/employees/participation")
    const body = JSON.parse(postCalls()[0][1]!.body as string)
    expect(body).toEqual({ agentId: "employee-aylin", included: false, previousEventId: null, clientRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) })
    expect(container.textContent).toContain(t("employeesSaved")); expect(fetchMock.mock.calls.filter(([, options]) => options?.method !== "POST")).toHaveLength(2)
    // The server response, not an optimistic flip, remains the source of truth.
    expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true")
  })
  it("includes an excluded employee with the exact latest version", async () => {
    directory.employees[0].included = false; directory.employees[0].participationVersion = "participation-previous"
    await render(); await toggle(); expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ agentId: "employee-aylin", included: true, previousEventId: "participation-previous" })
  })
  it("does not claim the roster refreshed when a confirmed write is followed by a failed reload", async () => {
    await render(); fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response({ eventId: "new-event", idempotent: false }) : response(null, 500))
    await toggle(); expect(container.textContent).toContain(t("employeesLoadError")); expect(container.textContent).not.toContain(t("employeesSaved")); expect(button("employeesCheckWrite")).toBeUndefined(); expect(container.querySelector('[role="switch"]')).toBeNull()
  })
  it("records termination with the last known immutable event and explicit last working day", async () => {
    await render(); await openHistory(); expect(field("employment-date").value).toBe(""); expect(field("employment-kind").value).toBe("TERMINATION")
    await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional termination"); await submit()
    expect(postCalls()[0][0]).toBe("/api/v1/mtm/attendance/employees/history"); expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ agentId: "employee-aylin", kind: "TERMINATION", date: "2026-10-31", previousEventId: "hire-1" })
    // The card stays open on the fresh data, so HR sees the record it just made.
    expect(container.querySelector('[data-testid="employees-history"]')).not.toBeNull(); expect(container.textContent).toContain(t("employeesSaved"))
  })
  it("records the first HIRE without inventing a prior event", async () => {
    await render(); await openHistory(1); expect(field("employment-kind").value).toBe("HIRE"); await edit("employment-date", "2026-10-01"); await edit("employment-reason", "Fictional hire"); await submit()
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ kind: "HIRE", previousEventId: null, agentId: "employee-murad" })
  })
  it("permits a rehire date immediately after the last working date without inventing an off-day", async () => {
    directory.employees[0].history.push({ id: "term-1", kind: "TERMINATION", date: "2026-10-31", at: "2026-10-31T20:00:00Z", byName: null })
    await render(); await openHistory(); expect(field("employment-kind").value).toBe("REHIRE"); await edit("employment-date", "2026-11-01"); await edit("employment-reason", "Fictional rehire"); await submit()
    expect(JSON.parse(postCalls()[0][1]!.body as string)).toMatchObject({ kind: "REHIRE", date: "2026-11-01", previousEventId: "term-1" })
  })
  it("replays an unknown outcome with exactly the same UUID/body after a language change", async () => {
    const original = fetchMock.getMockImplementation()!; let failed = false
    fetchMock.mockImplementation(async (url, options) => { if (options?.method === "POST" && !failed) { failed = true; throw new Error("PRIVATE_NETWORK") } return original(url, options) })
    const storage = vi.spyOn(Storage.prototype, "setItem"); await render(); await toggle(); const body = postCalls()[0][1]!.body
    expect(container.textContent).toContain(t("employeesUnconfirmed")); expect(button("employeesRefresh").disabled).toBe(true); expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
    await render("az"); await click("employeesCheckWrite"); expect(postCalls()).toHaveLength(2); expect(postCalls()[1][1]!.body).toBe(body); expect(storage).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("PRIVATE_NETWORK")
  })
  it("keeps an in-flight write stable on locale change", async () => {
    const original = fetchMock.getMockImplementation()!; let resolve: (value: Response) => void = () => {}
    fetchMock.mockImplementation((url, options) => options?.method === "POST" ? new Promise<Response>(done => { resolve = done }) : original(url, options))
    await render(); await toggle(); const signal = postCalls()[0][1]!.signal!; await render("en"); expect(signal.aborted).toBe(false)
    await act(async () => resolve(response({ eventId: "new-event", idempotent: false }))); expect(container.textContent).toContain(t("employeesSaved")); expect(postCalls()).toHaveLength(1)
  })
  it.each([401, 403, 404])("clears directory and private drafts on HTTP %s", async status => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, status)) : original(url, options))
    await render(); await toggle(); expect(container.textContent).toContain(t("employeesAccessUnavailable")); expect(container.textContent).not.toMatch(/Aylin|Leyla|Rauf|Demo Centre|PRIVATE_/); expect(container.querySelector("input")).toBeNull(); expect(button("employeesCheckWrite")).toBeUndefined()
  })
  it("removes previously visible users when refresh loses administrator access", async () => {
    await render(); fetchMock.mockResolvedValue(response(null, 403)); await click("employeesRefresh"); expect(container.textContent).not.toContain("Aylin"); expect(container.querySelector("select")).toBeNull()
  })
  it("requires a fresh read after a stale history response", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, 409, "MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED")) : original(url, options))
    await render(); await openHistory(); await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional termination"); await submit()
    expect(container.textContent).toContain(t("employeesChanged")); expect(button("employeesSaveChange").disabled).toBe(true); await click("employeesRefresh"); expect(container.querySelector('[data-testid="employees-history"]')).toBeNull()
  })
  it("renders a known date error without retrying or showing server traces", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, 400, "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID")) : original(url, options))
    await render(); await openHistory(); await edit("employment-date", "2026-10-31"); await edit("employment-reason", "Fictional termination"); await submit(); expect(container.textContent).toContain(t("employeesDateInvalid")); expect(button("employeesCheckWrite")).toBeUndefined(); expect(button("employeesSaveChange").disabled).toBe(false)
  })
  it("handles empty data and bounds roster/history DOM without truncating access to records", async () => {
    directory.users = []; directory.employees = []; await render(); expect(container.textContent).toContain(t("employeesEmpty"))
    directory.employees = Array.from({ length: 300 }, (_, i) => ({ id: `employee-${i}`, name: `Demo ${i}`, role: "AGENT", status: "ACTIVE", teamName: null, included: i >= 15, participationVersion: null, includedFrom: null, history: Array.from({ length: 22 }, (_, j) => ({ id: `event-${j}`, kind: "HIRE" as const, date: "2026-10-01", at: "2026-09-30T20:00:00Z", byName: null })) }))
    await click("employeesRefresh"); expect(container.querySelectorAll('[data-testid="employee-row"]')).toHaveLength(25); await click("employeesNext"); expect(container.textContent).toContain("Demo 25"); await openHistory(); expect(container.querySelectorAll('[data-testid="employment-event"]')).toHaveLength(20)
    expect(container.textContent).toContain(t("employeesParticipationCounts", { total: 300, included: 285, excluded: 15 }))
    await edit("employee-search", "Demo 299"); expect(container.querySelectorAll('[data-testid="employee-row"]')).toHaveLength(1)
    await edit("employee-search", ""); await edit("employee-participation", "EXCLUDED"); expect(container.querySelectorAll('[data-testid="employee-row"]')).toHaveLength(15)
    expect([...container.querySelectorAll('[role="switch"]')].every(node => node.getAttribute("aria-checked") === "false")).toBe(true)
  })
  it("aborts a pending write on unmount and ignores its late response", async () => {
    const original = fetchMock.getMockImplementation()!; let resolve: (value: Response) => void = () => {}
    fetchMock.mockImplementation((url, options) => options?.method === "POST" ? new Promise<Response>(done => { resolve = done }) : original(url, options))
    await render(); await toggle(); const count = fetchMock.mock.calls.length; await act(async () => root.unmount()); unmounted = true
    expect(postCalls()[0][1]!.signal!.aborted).toBe(true); await act(async () => resolve(response({ eventId: "new-event", idempotent: true }))); expect(fetchMock.mock.calls).toHaveLength(count)
  })
  it("rejects an old or incomplete roster instead of guessing participation", async () => {
    fetchMock.mockResolvedValue(response({ ...directory, employees: directory.employees.map(employee => ({ ...employee, included: undefined })) }))
    await render(); expect(container.textContent).toContain(t("employeesLoadError")); expect(container.querySelector('[role="switch"]')).toBeNull()
  })
  it("requires refreshing after another administrator changes participation", async () => {
    const original = fetchMock.getMockImplementation()!; fetchMock.mockImplementation((url, options) => options?.method === "POST" ? Promise.resolve(response(null, 409, "MTM_ATTENDANCE_PARTICIPATION_CHANGED")) : original(url, options))
    await render(); await toggle(); expect(container.textContent).toContain(t("employeesChanged")); expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
    await click("employeesRefresh"); expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(false)
  })
  it("does not show an editable directory after failed or aborted loading", async () => {
    fetchMock.mockResolvedValue(response(null, 500)); await render(); expect(container.textContent).toContain(t("employeesLoadError")); expect(container.querySelector("form")).toBeNull()
    fetchMock.mockImplementation(() => new Promise<Response>(() => {})); await click("employeesRefresh"); const signal = fetchMock.mock.calls.at(-1)![1]!.signal!; await act(async () => root.unmount()); unmounted = true; expect(signal.aborted).toBe(true)
  })
})

// Owner, 2026-10-15: HR adds office staff right here, apart from MTM agents.
// Owner, 2026-10-15: the employee card — position, department, manager, hire date.
describe("Employee card", () => {
  const p = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "personnel" })(key, values)
  const cards = () => postCalls().filter(([url]) => String(url).endsWith("/employees/card"))
  async function save() { await act(async () => container.querySelector('[data-testid="employee-card"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }

  it("shows position and department in the roster and saves the card, staying open", async () => {
    await render()
    expect(container.querySelector('[data-testid="employee-row"]')!.textContent).toContain("Бухгалтер · Demo Centre")
    await openHistory()
    expect(container.querySelector('[data-testid="employees-history"]')!.textContent).toContain(p("employeeCardTitle", { name: "Aylin Demo" }))
    expect(field("employee-card-position").value).toBe("Бухгалтер"); expect(field("employee-card-department").value).toBe("team-centre")
    expect(container.querySelector('[data-testid="employee-card-hire"]')!.textContent).toContain("2026")
    await edit("employee-card-position", "  Главный бухгалтер "); await edit("employee-card-manager", "manager-rauf"); await save()
    expect(cards()).toHaveLength(1)
    expect(JSON.parse(String(cards()[0][1]!.body))).toEqual({ agentId: "employee-aylin", position: "Главный бухгалтер", teamId: "team-centre", managerId: "manager-rauf" })
    expect(container.querySelector('[data-testid="employee-card"]')).not.toBeNull(); expect(container.textContent).toContain(p("employeeCardSaved"))
  })

  it("never offers the employee as their own manager, and types a new department by name", async () => {
    await render(); await openHistory(1)
    const managers = [...field("employee-card-manager").querySelectorAll("option")].map(option => option.value)
    expect(managers).toEqual(["", "manager-rauf"])
    expect(container.querySelector('[data-testid="employee-card-hire"]')!.textContent).toContain(p("employeeCardHireMissing"))
    await edit("employee-card-department", "__new")
    const name = container.querySelector<HTMLInputElement>(`input[aria-label="${p("employeeCardNewDepartmentName")}"]`)!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, " Склад "); name.dispatchEvent(new Event("input", { bubbles: true })) })
    await save()
    expect(JSON.parse(String(cards()[0][1]!.body))).toEqual({ agentId: "employee-murad", position: null, teamId: null, newTeamName: "Склад", managerId: null })
  })

  it("explains a refused manager in words, without a retry button", async () => {
    await render(); await openHistory()
    fetchMock.mockImplementation(async (url, options) => options?.method === "POST" ? response(null, 422, "MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID") : response(directory))
    await edit("employee-card-manager", "manager-rauf"); await save()
    expect(container.textContent).toContain(t("employeesManagerInvalid")); expect(button("employeesCheckWrite")).toBeUndefined()
  })
})

describe("Add employee", () => {
  const p = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "personnel" })(key, values)
  const input = (label: string) => [...container.querySelectorAll("label")].find(node => node.querySelector("span")?.textContent === p(label))!.querySelector("input")!
  async function type(label: string, value: string) {
    await act(async () => { const node = input(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })) })
  }
  const form = () => container.querySelector<HTMLFormElement>('[data-testid="attendance-add-employee-form"]')!
  async function send() { await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
  const creates = () => fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/employees/new") && options?.method === "POST")

  it("creates the employee with the app login, then lists them and says how they sign in", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeeEmail", "Nigar@Example.test"); await type("addEmployeePassword", "Kaxebomu-4821!")
    await send()
    expect(creates()).toHaveLength(1)
    expect(JSON.parse(String(creates()[0][1]!.body))).toEqual({ name: "Nigar Demo", email: "Nigar@Example.test", phone: null, password: "Kaxebomu-4821!", position: null, teamId: null, hireDate: null })
    expect(container.querySelector('[data-testid="attendance-employee-added"]')!.textContent).toBe(p("addEmployeeDone", { name: "Nigar Demo", email: "nigar@example.test" }))
    expect(container.querySelector('[data-testid="attendance-add-employee-form"]')).toBeNull()
  })

  it("sends position, department and hire date with the new employee", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeeEmail", "nigar@example.test"); await type("addEmployeePassword", "Kaxebomu-4821!")
    await type("employeeCardPosition", "Кассир"); await type("employeeCardHired", "2026-10-01"); await edit("add-employee-department", "team-north")
    await send()
    expect(JSON.parse(String(creates()[0][1]!.body))).toMatchObject({ position: "Кассир", teamId: "team-north", hireDate: "2026-10-01" })
  })

  it("refuses a weak password on the spot and suggests a strong one", async () => {
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeeEmail", "nigar@example.test"); await type("addEmployeePassword", "short")
    await send()
    expect(creates()).toHaveLength(0)
    expect(form().querySelector('[role="alert"]')!.textContent).toBe(p("addEmployeePasswordWeak"))
    await act(async () => [...form().querySelectorAll("button")].find(node => node.textContent === p("addEmployeeSuggestPassword"))!.click())
    expect(input("addEmployeePassword").value).toMatch(/^[A-Z][a-z]{7}-\d{4}!$/)
    expect(input("addEmployeePassword").type).toBe("text")
  })

  it("names a taken email in words and keeps what was typed", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ code: "MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN" }), { status: 409 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeeEmail", "taken@example.test"); await type("addEmployeePassword", "Kaxebomu-4821!")
    await send()
    expect(form().querySelector('[role="alert"]')!.textContent).toBe(p("addEmployeeEmailTaken"))
    expect(input("addEmployeeEmail").value).toBe("taken@example.test")
  })
})
