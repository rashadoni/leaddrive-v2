// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const push = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (href: string) => push.calls.push(href) }) }))
const { MtmAttendanceEmployeePage } = await import("@/components/mtm/attendance-employee-page")
import type { AttendanceEmployeeDetail } from "@/lib/mtm/attendance-employee-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const p = createTranslator({ locale: "ru", messages: ru, namespace: "personnel" })
const t = createTranslator({ locale: "ru", messages: ru, namespace: "mtmAttendance" })
const fetchMock = vi.fn<typeof fetch>()
const json = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code }), { status })
let root: Root, container: HTMLDivElement, detail: AttendanceEmployeeDetail
const BACK = "/mtm/attendance/people?tab=employees&q=Togrul"

async function render() {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, children: createElement(MtmAttendanceEmployeePage, { agentId: "togrul", back: BACK }) })))
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const field = (id: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
async function edit(id: string, value: string) {
  await act(async () => { const input = field(id); Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) })
}
const submit = async (selector: string) => act(async () => { container.querySelector(selector)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
const saveForm = `form[aria-label="${p("employeeTitle", { name: "Togrul" })}"]`
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  detail = { timezone: "Asia/Baku", today: "2026-10-16", teams: [{ id: "team-kassa", name: "Касса" }], managers: [{ id: "m-saida", name: "Saida", position: "Главный бухгалтер" }],
    month: { from: "2026-10-01", to: "2026-10-16", workedDays: 9, workedSeconds: 292800, lateCount: 2, absentCount: 1, leaveDays: 0, sickDays: 0, isComplete: true },
    employee: { id: "togrul", name: "Togrul", phone: "+994501112233", email: null, role: "EMPLOYEE", status: "ACTIVE", loginEditable: true, position: null, teamId: null, teamName: null, managerId: null,
      included: true, participationVersion: null, history: [], todayMark: { status: "STARTED", startedAt: "2026-10-16T04:57:00.000Z", completedAt: null } } }
  fetchMock.mockReset(); fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? json({ eventId: "e1", idempotent: false }) : json(detail)); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

// Owner, 2026-10-16: «просил редактируемыми сделать сотрудников»; the card under a long list meant scrolling.
describe("Personnel → employee page", () => {
  it("shows actual preparation gaps and optional approval without inventing a delivered invitation or arrival", async () => {
    detail.preparation = { checkedAt: "2026-10-16T06:00:00Z", date: detail.today, login: "CONTACT_MISSING", schedule: "DEFAULT", branch: null, installations: { required: false, approved: 0, pending: 1 } }
    detail.employee.included = false
    await render()
    const preparation = container.querySelector('[data-testid="employee-preparation"]')!
    expect(preparation.textContent).toContain(p("preparation.loginCONTACT_MISSING"))
    expect(preparation.textContent).toContain(p("preparation.scheduleDEFAULT"))
    expect(preparation.textContent).toContain(p("preparation.approvalOptional", { count: 0 }))
    expect(preparation.textContent).toContain(p("preparation.pending", { count: 1 }))
    expect(preparation.textContent).toContain(p("preparation.excluded"))
    expect(preparation.textContent).toContain(p("preparation.invitation"))
    expect(preparation.querySelector('a[href="#employee-phone"]')).not.toBeNull()
    expect(container.querySelector('#employee-participation')).not.toBeNull()
    expect(posts()).toHaveLength(0)
  })
  it("shows the person, how they sign in, their work, this month and the history, with a way back to the same list", async () => {
    await render()
    expect(container.querySelector('[data-testid="attendance-employee-back"]')!.getAttribute("href")).toBe(BACK)
    expect(container.querySelector("h1")!.textContent).toBe("Togrul")
    expect(container.textContent).toContain(p("todayAt", { time: "08:57" }))
    expect(field("employee-name").value).toBe("Togrul"); expect(field("employee-phone").value).toBe("+994501112233")
    // Empty fields HR should fill say so beside their label.
    expect([...container.querySelectorAll('[data-testid="employee-field-missing"]')].length).toBe(2)
    const month = container.querySelector('[data-testid="employee-section-month"]')!.textContent!
    expect(month).toContain(p("monthWorkedValue", { days: 9, hours: "81:20" })); expect(month).toContain(p("monthLate"))
    expect(container.querySelector('[data-testid="employees-history"]')!.textContent).toContain(t("employeesNoHistory"))
  })

  it("saves name, phone, email, job and the first hire date in one request, then says so", async () => {
    await render()
    await edit("employee-name", "Togrul Məmmədov"); await edit("employee-phone", "+994 55 000 11 22"); await edit("employee-email", "togrul@example.test")
    await edit("employee-position", "Менеджер"); await edit("employee-department", "team-kassa"); await edit("employee-manager", "m-saida"); await edit("employee-hire-date", "2026-03-02")
    await submit(saveForm)
    expect(String(posts()[0][0])).toBe("/api/v1/mtm/attendance/employees/togrul")
    expect(JSON.parse(String(posts()[0][1]!.body))).toEqual({ name: "Togrul Məmmədov", position: "Менеджер", teamId: "team-kassa", managerId: "m-saida",
      phone: "+994 55 000 11 22", email: "togrul@example.test", hireDate: "2026-03-02" })
    expect(container.textContent).toContain(p("employeeSaved"))
  })

  it("does not send an empty number for someone who has none yet", async () => {
    detail.employee = { ...detail.employee, phone: null }
    await render(); await edit("employee-position", "Кассир"); await submit(saveForm)
    expect(JSON.parse(String(posts()[0][1]!.body))).not.toHaveProperty("phone")
  })

  it("leaves an administrator's sign-in alone and does not send it", async () => {
    detail.employee = { ...detail.employee, loginEditable: false }
    await render()
    expect((field("employee-phone") as HTMLInputElement).disabled).toBe(true); expect((field("employee-email") as HTMLInputElement).disabled).toBe(true)
    expect(container.textContent).toContain(p("employeeLoginLocked"))
    await submit(saveForm)
    const body = JSON.parse(String(posts()[0][1]!.body))
    expect(body).not.toHaveProperty("phone"); expect(body).not.toHaveProperty("email")
  })

  it.each([
    ["MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", "addEmployeePhoneTaken"],
    ["MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID", "employeeManagerInvalid"],
    ["SOMETHING_ELSE", "employeeSaveFailed"],
  ])("says %s in words and keeps what was typed", async (code, text) => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? json(null, 409, code) : json(detail))
    await render(); await edit("employee-phone", "+994550001122"); await submit(saveForm)
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(p(text)); expect(field("employee-phone").value).toBe("+994550001122")
  })

  it("shows a recorded hire date instead of an input, and records history and participation on the page", async () => {
    detail.employee = { ...detail.employee, history: [{ id: "h1", kind: "HIRE", date: "2026-03-02", at: "2026-03-01T20:00:00.000Z", byName: "Saida" }], participationVersion: "pv1" }
    await render()
    expect(container.querySelector("#employee-hire-date")).toBeNull()
    expect(container.querySelector('[data-testid="employee-hire"]')!.textContent).toContain("2 марта 2026")
    await edit("employment-date", "2026-10-31"); await edit("employment-reason", "По собственному желанию")
    await submit(`form[aria-label="${t("employeesRecordChange")}"]`)
    expect(JSON.parse(String(posts()[0][1]!.body))).toMatchObject({ agentId: "togrul", kind: "TERMINATION", date: "2026-10-31", previousEventId: "h1" })
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
    expect(String(posts()[1][0])).toBe("/api/v1/mtm/attendance/employees/participation")
    expect(JSON.parse(String(posts()[1][1]!.body))).toMatchObject({ agentId: "togrul", included: false, previousEventId: "pv1" })
  })

  // Owner, 2026-10-16: «где удаление сотрудников» — his rule for agents: delete without history, dismiss with it.
  it("deletes an employee without history and returns to the list", async () => {
    push.calls = []
    detail.employee = { ...detail.employee, crmRole: "viewer" }
    await render()
    const block = container.querySelector('[data-testid="attendance-employee-remove"]')!
    const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!
    await act(async () => button(p("removeButton")).click())
    await act(async () => button(p("removeConfirmButton")).click())
    expect(String(posts()[0][0])).toBe("/api/v1/mtm/attendance/employees/togrul/remove")
    expect(JSON.parse(String(posts()[0][1]!.body))).toEqual({ mode: "DELETE" })
    expect(push.calls).toEqual([BACK]); expect(block).toBeTruthy()
  })

  it("offers dismissal when the server says the employee has history, and sends the last day and reason", async () => {
    detail.employee = { ...detail.employee, crmRole: "viewer" }
    fetchMock.mockImplementation(async (url, options) => options?.method === "POST"
      ? String(url).endsWith("/remove") && String(options.body).includes("DELETE") ? json(null, 409, "MTM_ATTENDANCE_EMPLOYEE_HAS_HISTORY") : json({ eventId: "e", idempotent: false })
      : json(detail))
    await render()
    const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!
    await act(async () => button(p("removeButton")).click()); await act(async () => button(p("removeConfirmButton")).click())
    const form = container.querySelector('[data-testid="attendance-employee-dismiss"]')!
    expect(form.textContent).toContain(p("dismissHint", { name: "Togrul" }))
    const [lastDay, reason] = [...form.querySelectorAll("input")]
    expect(lastDay.value).toBe("2026-10-16")
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reason, "По собственному желанию"); reason.dispatchEvent(new Event("input", { bubbles: true })) })
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    expect(JSON.parse(String(posts().at(-1)![1]!.body))).toEqual({ mode: "DISMISS", lastDay: "2026-10-16", reason: "По собственному желанию" })
  })

  it("does not offer removal of a CRM user, and says where that is done", async () => {
    detail.employee = { ...detail.employee, crmRole: "admin" }
    await render()
    expect(container.querySelector('[data-testid="attendance-employee-remove-crm"]')!.textContent).toBe(p("removeCrmUser"))
    expect([...container.querySelectorAll("button")].some(item => item.textContent === p("removeButton"))).toBe(false)
  })

  it("names a missing employee in words", async () => {
    fetchMock.mockResolvedValue(json(null, 404)); await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(p("employeeNotFound"))
    expect(container.querySelector('[data-testid="attendance-employee-back"]')).not.toBeNull()
  })
})
