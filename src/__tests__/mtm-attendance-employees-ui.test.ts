// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"

// The list keeps its search, filters and page in the address (owner, 2026-10-16).
const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: (() => {}) as (href: string, options?: unknown) => void }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string, options?: unknown) => navigation.replace(href, options) }),
  usePathname: () => "/mtm/attendance/people",
  useSearchParams: () => navigation.params,
}))
const { MtmAttendanceEmployees } = await import("@/components/mtm/attendance-employees")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const response = (data: unknown, status = 200, code = "PRIVATE_SERVER_TRACE") => new Response(JSON.stringify({ success: status < 400, data, code }), { status })
const fetchMock = vi.fn<typeof fetch>()
const replace = vi.fn<(href: string, options?: unknown) => void>()
let root: Root, container: HTMLDivElement, locale: "ru" | "az" | "en", directory: AttendanceEmployeeDirectory
const t = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "mtmAttendance" })(key, values)
const pt = (key: string, values?: Record<string, string | number>) => createTranslator({ locale, messages: messages[locale], namespace: "personnel" })(key, values)
async function render(language = locale) { locale = language; const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceEmployees) }; await act(async () => root.render(createElement(NextIntlClientProvider, props))) }
const field = (id: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
async function edit(id: string, value: string) { await act(async () => { const input = field(id); Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) }) }
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="employee-row"]')]
const names = () => rows().map(row => row.querySelector("strong")!.textContent)
beforeEach(() => {
  locale = "ru"; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  navigation.params = new URLSearchParams("tab=employees"); replace.mockReset(); navigation.replace = replace
  directory = { timezone: "Asia/Baku", users: [], teams: [{ id: "team-centre", name: "Demo Centre" }, { id: "team-north", name: "Demo North" }],
    managers: [{ id: "manager-rauf", name: "Rauf Demo", position: "Руководитель отдела" }], employees: [
    { id: "employee-aylin", name: "Aylin Demo", role: "EMPLOYEE", teamName: "Demo Centre", position: "Бухгалтер", teamId: "team-centre", managerId: null, phone: "+994501112233", status: "ACTIVE", included: true, participationVersion: null, includedFrom: null,
      todayMark: { status: "STARTED", startedAt: "2026-10-16T04:57:00.000Z", completedAt: null }, history: [{ id: "hire-1", kind: "HIRE", date: "2026-10-01", at: "2026-09-30T20:00:00.000Z", byName: "Rauf Demo" }] },
    { id: "employee-murad", name: "Murad Demo", role: "EMPLOYEE", teamName: null, position: null, teamId: null, managerId: null, phone: "+994552223344", status: "ACTIVE", included: true, participationVersion: null, includedFrom: null, todayMark: null, history: [] },
    { id: "employee-leyla", name: "Leyla Demo", role: "EMPLOYEE", teamName: "Demo North", position: "Кассир", teamId: "team-north", managerId: null, phone: null, status: "ACTIVE", included: false, participationVersion: "p1", includedFrom: null, todayMark: null,
      history: [{ id: "hire-2", kind: "HIRE", date: "2026-09-01", at: "2026-08-31T20:00:00.000Z", byName: null }] },
  ] }
  fetchMock.mockReset(); fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response({ eventId: "new-event", idempotent: false }) : response(directory)); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Owner, 2026-10-16: «просил редактируемыми сделать сотрудников… будет неудобно, когда список будет больше 200».
describe("Personnel → Employees list", () => {
  it("does not mix CRM user identities into the employee rows or counters", async () => {
    directory.users = [{ id: "crm-only", name: "CRM-only administrator", existingRole: "EMPLOYEE", existingTeamId: null, eligible: false }]
    await render()
    expect(names()).toEqual(["Aylin Demo", "Murad Demo", "Leyla Demo"])
    expect(container.textContent).not.toContain("CRM-only administrator")
    expect(container.textContent).toContain(t("employeesParticipationCounts", { total: 3, included: 2, excluded: 1 }))
    await edit("employee-search", "CRM-only administrator")
    expect(rows()).toHaveLength(0)
  })

  it.each(["ru", "az", "en"] as const)("renders %s: who, department, today, and a worded Edit link to the employee's page", async language => {
    await render(language)
    expect(names()).toEqual(["Aylin Demo", "Murad Demo", "Leyla Demo"])
    const [aylin, murad, leyla] = rows()
    expect(aylin.textContent).toContain("Бухгалтер"); expect(aylin.textContent).toContain(pt("todayAt", { time: "08:57" }))
    expect(murad.querySelector('[data-testid="employee-missing"]')!.textContent).toBe(pt("employeeMissing", { fields: [pt("employeeMissingPosition"), pt("employeeMissingHire")].join(", ") }))
    expect(murad.textContent).toContain(pt("todayNone")); expect(leyla.textContent).toContain(pt("todayExcluded"))
    const link = aylin.querySelector<HTMLAnchorElement>(`a[aria-label="${pt("employeeEditNamed", { name: "Aylin Demo" })}"]`)!
    expect(link.textContent).toBe(pt("employeeEdit"))
    expect(link.getAttribute("href")).toBe(`/mtm/attendance/people/employee-aylin?back=${encodeURIComponent("/mtm/attendance/people?tab=employees")}`)
    // No in-list editors any more: the page holds them.
    expect(container.querySelector('[role="switch"]')).toBeNull(); expect(container.querySelector('[data-testid="employees-history"]')).toBeNull()
    expect(container.textContent).not.toMatch(/PRIVATE_SERVER_TRACE|mtmAttendance\.|personnel\./)
  })

  it("finds people by position or phone digits, filters by department and participation, and keeps it in the address", async () => {
    await render()
    await edit("employee-search", "касс"); expect(names()).toEqual(["Leyla Demo"])
    await edit("employee-search", "55 222"); expect(names()).toEqual(["Murad Demo"])
    await edit("employee-search", ""); await edit("employee-department", "none"); expect(names()).toEqual(["Murad Demo"])
    await edit("employee-department", ""); await edit("employee-participation", "EXCLUDED"); expect(names()).toEqual(["Leyla Demo"])
    expect(replace.mock.calls.at(-1)![0]).toBe("/mtm/attendance/people?tab=employees&show=EXCLUDED")
    // «Back» from the employee returns to exactly this view.
    expect(rows()[0].querySelector("a")!.getAttribute("href")).toContain(`back=${encodeURIComponent("/mtm/attendance/people?tab=employees&show=EXCLUDED")}`)
  })

  it("opens with the search and filters the address carries", async () => {
    navigation.params = new URLSearchParams("tab=employees&q=Aylin&team=team-centre")
    await render()
    expect(field("employee-search").value).toBe("Aylin"); expect(field("employee-department").value).toBe("team-centre"); expect(names()).toEqual(["Aylin Demo"])
  })

  it("leaves dismissed people out of the list until their own filter is chosen", async () => {
    directory.employees.push({ ...directory.employees[0], id: "employee-gone", name: "Gone Demo", status: "INACTIVE" })
    await render()
    expect(names()).not.toContain("Gone Demo")
    await edit("employee-participation", "DISMISSED"); expect(names()).toEqual(["Gone Demo"])
  })

  it("pages 50 at a time", async () => {
    directory.employees = Array.from({ length: 120 }, (_, i) => ({ ...directory.employees[0], id: `e-${i}`, name: `Demo ${String(i).padStart(3, "0")}` }))
    await render()
    expect(rows()).toHaveLength(50)
    expect(container.textContent).toContain(t("employeesPage", { page: 1, pages: 3, count: 120 }))
  })

  it.each([401, 403, 404])("shows no employees on HTTP %s", async status => {
    fetchMock.mockResolvedValue(response(null, status)); await render()
    expect(rows()).toHaveLength(0); expect(container.textContent).toContain(t("employeesAccessUnavailable"))
  })
})

describe("Add employee", () => {
  const p = pt
  const input = (label: string) => [...container.querySelectorAll("label")].find(node => node.querySelector("span")?.textContent === p(label))!.querySelector("input")!
  async function type(label: string, value: string) {
    await act(async () => { const node = input(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })) })
  }
  const form = () => container.querySelector<HTMLFormElement>('[data-testid="attendance-add-employee-form"]')!
  async function send() { await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
  const creates = () => fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/employees/new") && options?.method === "POST")

  // Owner, 2026-10-15: HR sets no password — the person gets a code in WhatsApp and sets their own.
  it("creates the employee with a WhatsApp number and no password, then lists them and says how they sign in", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    expect(form().querySelector('input[type="password"]')).toBeNull()
    expect(form().querySelector('[data-testid="attendance-add-employee-code-note"]')!.textContent).toBe(p("addEmployeeCodeNote"))
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994 50 111 22 33")
    await send()
    expect(creates()).toHaveLength(1)
    expect(JSON.parse(String(creates()[0][1]!.body))).toEqual({ name: "Nigar Demo", phone: "+994 50 111 22 33", email: null, position: null, teamId: null, hireDate: null })
    expect(container.querySelector('[data-testid="attendance-employee-added"]')!.textContent).toBe(p("addEmployeeDone", { name: "Nigar Demo", phone: "+994 50 111 22 33" }))
    expect(container.querySelector('[data-testid="attendance-add-employee-form"]')).toBeNull()
  })

  it("sends the email, position, department and hire date when HR gives them", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994501112233"); await type("addEmployeeEmail", "nigar@example.test")
    await type("employeeCardPosition", "Кассир"); await type("employeeCardHired", "2026-10-01"); await edit("add-employee-department", "team-north")
    await send()
    expect(JSON.parse(String(creates()[0][1]!.body))).toEqual({ name: "Nigar Demo", phone: "+994501112233", email: "nigar@example.test", position: "Кассир", teamId: "team-north", hireDate: "2026-10-01" })
  })

  it("refuses a number without the country code on the spot", async () => {
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "0501112233")
    await send()
    expect(creates()).toHaveLength(0)
    expect(form().querySelector('[role="alert"]')!.textContent).toBe(p("addEmployeePhoneInvalid"))
  })

  it.each([
    ["MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN", "addEmployeeEmailTaken"],
    ["MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", "addEmployeePhoneTaken"],
  ])("names %s in words and keeps what was typed", async (code, text) => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ code }), { status: 409 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994501112233"); await type("addEmployeeEmail", "taken@example.test")
    await send()
    expect(form().querySelector('[role="alert"]')!.textContent).toBe(p(text))
    expect(input("addEmployeeEmail").value).toBe("taken@example.test")
    expect(input("addEmployeePhone").value).toBe("+994501112233")
  })
})
