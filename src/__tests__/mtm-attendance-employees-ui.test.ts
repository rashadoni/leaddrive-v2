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
  directory = { timezone: "Asia/Baku", users: [], teams: [{ id: "team-centre", name: "Demo Centre", departmentId: "dep-finance" }, { id: "team-north", name: "Demo North", departmentId: null }],
    departments: [{ id: "dep-finance", name: "Demo Finance" }],
    managers: [{ id: "manager-rauf", name: "Rauf Demo", position: "Руководитель отдела" }], employees: [
    { id: "employee-aylin", name: "Aylin Demo", role: "EMPLOYEE", teamName: "Demo Centre", departmentId: "dep-finance", departmentName: "Demo Finance", position: "Бухгалтер", teamId: "team-centre", managerId: null, phone: "+994501112233", status: "ACTIVE", included: true, participationVersion: null, includedFrom: null,
      todayMark: { status: "STARTED", startedAt: "2026-10-16T04:57:00.000Z", completedAt: null }, history: [{ id: "hire-1", kind: "HIRE", date: "2026-10-01", at: "2026-09-30T20:00:00.000Z", byName: "Rauf Demo" }] },
    { id: "employee-murad", name: "Murad Demo", role: "EMPLOYEE", teamName: null, departmentId: null, departmentName: null, position: null, teamId: null, managerId: null, phone: "+994552223344", status: "ACTIVE", included: true, participationVersion: null, includedFrom: null, todayMark: null, history: [] },
    { id: "employee-leyla", name: "Leyla Demo", role: "EMPLOYEE", teamName: "Demo North", departmentId: null, departmentName: null, position: "Кассир", teamId: "team-north", managerId: null, phone: null, status: "ACTIVE", included: false, participationVersion: "p1", includedFrom: null, todayMark: null,
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
    expect(aylin.textContent).toContain("Demo Finance"); expect(aylin.textContent).toContain("Demo Centre")
    expect(container.querySelector("thead")!.textContent).toContain(pt("employeesColUnit"))
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
    // Murad heads the department: in it, without a section.
    directory.employees[1] = { ...directory.employees[1], departmentId: "dep-finance", departmentName: "Demo Finance" }
    await render()
    await edit("employee-search", "касс"); expect(names()).toEqual(["Leyla Demo"])
    await edit("employee-search", "55 222"); expect(names()).toEqual(["Murad Demo"])
    await edit("employee-search", ""); await edit("employee-department", "none"); expect(names()).toEqual([])
    // A department filter takes everyone in it, with a section or without (owner, 2026-10-22).
    await edit("employee-department", "dep:dep-finance"); expect(names()).toEqual(["Aylin Demo", "Murad Demo"])
    await edit("employee-search", "finance"); expect(names()).toEqual(["Aylin Demo", "Murad Demo"]); await edit("employee-search", "")
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
    expect(JSON.parse(String(creates()[0][1]!.body))).toEqual({ name: "Nigar Demo", phone: "+994 50 111 22 33", email: null, position: null, departmentId: null, teamId: null, hireDate: null })
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
    expect(JSON.parse(String(creates()[0][1]!.body))).toEqual({ name: "Nigar Demo", phone: "+994501112233", email: "nigar@example.test", position: "Кассир", departmentId: null, teamId: "team-north", hireDate: "2026-10-01" })
  })

  // Owner, 2026-10-22: «тут есть отдел, но нет департамента».
  it("asks for the department above the section, and a section names its department", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    const labels = [...form().querySelectorAll("label")].map(node => node.textContent)
    expect(labels.indexOf(p("employeeCardDepartament"))).toBeGreaterThan(-1)
    expect(labels.indexOf(p("employeeCardDepartament"))).toBeLessThan(labels.indexOf(p("employeeCardDepartment")))
    const sections = () => [...field("add-employee-department").querySelectorAll("option")].map(option => option.value)
    // Under a department: its sections and those outside any; another department's are not offered.
    await edit("add-employee-department-unit", "dep-finance")
    expect(sections()).toEqual(["", "team-centre", "team-north", "__new"])
    directory.teams.push({ id: "team-elsewhere", name: "Demo Elsewhere", departmentId: "dep-other" })
    // A section of a department picks that department.
    await edit("add-employee-department-unit", ""); await edit("add-employee-department", "team-centre")
    expect(field("add-employee-department-unit").value).toBe("dep-finance")
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994501112233")
    await send()
    expect(JSON.parse(String(creates()[0][1]!.body))).toMatchObject({ departmentId: "dep-finance", teamId: "team-centre" })
  })

  it("sends a new department and a new section by name, and a department head without a section", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ success: true, data: { userId: "u-new", agentId: "a-new" } }), { status: 201 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Rəşad Demo"); await type("addEmployeePhone", "+994501112233")
    await edit("add-employee-department-unit", "__new")
    const typed = async (label: string, value: string) => act(async () => { const node = form().querySelector<HTMLInputElement>(`input[aria-label="${p(label)}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })) })
    await typed("employeeCardNewDepartamentName", " İT departamenti ")
    await send()
    expect(JSON.parse(String(creates()[0][1]!.body))).toMatchObject({ departmentId: null, newDepartmentName: "İT departamenti", teamId: null })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994501112244")
    await edit("add-employee-department-unit", "dep-finance"); await edit("add-employee-department", "__new"); await typed("employeeCardNewDepartmentName", "Demo Treasury")
    await send()
    expect(JSON.parse(String(creates()[1][1]!.body))).toMatchObject({ departmentId: "dep-finance", teamId: null, newTeamName: "Demo Treasury" })
  })

  it("names a section that moved to another department in words", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/employees/new") ? new Response(JSON.stringify({ code: "MTM_ATTENDANCE_EMPLOYEE_SECTION_ELSEWHERE" }), { status: 409 }) : options?.method === "POST" ? response({ eventId: "e", idempotent: false }) : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Nigar Demo"); await type("addEmployeePhone", "+994501112233")
    await send()
    expect(form().querySelector('[role="alert"]')!.textContent).toBe(p("employeeSectionElsewhere"))
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
    ["IDENTITY_CANONICAL_PHONE_RESERVED", "addEmployeePhoneTaken"],
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
  it.each((["ru", "az", "en"] as const).flatMap(language => ["MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", "IDENTITY_CANONICAL_PHONE_RESERVED"].map(code => ({ language, code }))))("opens an existing hidden CRM card after $code in $language without creating or linking again", async ({ language, code }) => {
    fetchMock.mockImplementation(async url => String(url).endsWith("/phone-match")
      ? response({ kind: "attendance", agentId: "existing-card", name: "Existing CRM person", enrolled: false })
      : String(url).endsWith("/employees/new") ? response(null, 409, code) : response(directory))
    await render(language)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "Typed name"); await type("addEmployeePhone", "+994501112233")
    await send()
    const match = form().querySelector('[data-testid="attendance-phone-match"]')!
    expect(match.textContent).toContain(p("addEmployeePhoneProfile", { name: "Existing CRM person" }))
    expect(match.textContent).toContain(p("addEmployeePhoneExistingHire"))
    expect(match.querySelector("a")!.getAttribute("href")).toBe("/mtm/attendance/people/existing-card?back=%2Fmtm%2Fattendance%2Fpeople%3Ftab%3Demployees")
    expect(creates()).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2)
    expect(form().querySelector('[role="alert"]')).toBeNull()
    expect(input("addEmployeeName").value).toBe("Typed name")
    await type("addEmployeePhone", "+994501112234")
    expect(form().querySelector('[data-testid="attendance-phone-match"]')).toBeNull()
  })

  it.each([{ kind: "other", name: "Field profile" }, { kind: "ambiguous" }])("never offers an attendance card for $kind", async match => {
    fetchMock.mockImplementation(async url => String(url).endsWith("/phone-match") ? response(match)
      : String(url).endsWith("/employees/new") ? response(null, 409, "MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN") : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "New person"); await type("addEmployeePhone", "+994501112233"); await send()
    expect(form().querySelector('[data-testid="attendance-phone-match"] a')).toBeNull()
    expect(creates()).toHaveLength(1)
  })

  it("discards a delayed lookup when the entered number changes", async () => {
    let finish!: (response: Response) => void
    fetchMock.mockImplementation(async url => String(url).endsWith("/phone-match") ? new Promise<Response>(resolve => { finish = resolve })
      : String(url).endsWith("/employees/new") ? response(null, 409, "MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN") : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "New person"); await type("addEmployeePhone", "+994501112233"); await send()
    await type("addEmployeePhone", "+994501112234")
    await act(async () => { finish(response({ kind: "attendance", agentId: "old-result", name: "Old result", enrolled: false })) })
    expect(form().querySelector('[data-testid="attendance-phone-match"]')).toBeNull()
    expect(form().querySelector('[role="alert"]')).toBeNull()
  })

  it.each([true, false])("resolves an existing profile at the seat limit; match=%s", async found => {
    fetchMock.mockImplementation(async url => String(url).endsWith("/phone-match")
      ? response(found ? { kind: "attendance", agentId: "existing-card", name: "Existing person", enrolled: false } : { kind: "none" })
      : String(url).endsWith("/employees/new") ? response(null, 403, "MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT") : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "New person"); await type("addEmployeePhone", "+994501112233"); await send()
    expect(creates()).toHaveLength(1)
    if (found) expect(form().querySelector('[data-testid="attendance-phone-match"] a')).not.toBeNull()
    else {
      expect(form().querySelector('[data-testid="attendance-phone-match"]')).toBeNull()
      expect(form().querySelector('[role="alert"]')!.textContent).toBe(p("addEmployeeUserLimit"))
    }
  })
  it("does not look up a phone after an administrator permission refusal", async () => {
    fetchMock.mockImplementation(async url => String(url).endsWith("/employees/new") ? response(null, 403, "MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED") : response(directory))
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-add-employee"]')!.click())
    await type("addEmployeeName", "New person"); await type("addEmployeePhone", "+994501112233"); await send()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/phone-match"))).toBe(false)
  })

})
