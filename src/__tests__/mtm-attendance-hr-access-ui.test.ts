// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceHrAccess } from "@/components/mtm/attendance-hr-access"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import type { AttendanceHrUser } from "@/lib/mtm/attendance-hr-access"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_SERVER_ERROR" }), { status })
const fixture = (): AttendanceHrUser[] => [
  { id: "user-a", name: "Aysel Aliyeva", role: "manager", isActive: true, allEmployees: false, canGrant: true, version: "2026-10-13T10:00:00.000Z" },
  { id: "user-b", name: "Leyla Mammadova", role: "sales", isActive: true, allEmployees: true, canGrant: true, version: "2026-10-13T10:00:00.000Z" },
  { id: "user-c", name: "Samir Karimov", role: "support", isActive: false, allEmployees: true, canGrant: false, version: "2026-10-13T10:00:00.000Z" },
  { id: "user-d", name: "Rauf Hasanov", role: "viewer", isActive: true, allEmployees: false, canGrant: false, version: "2026-10-13T10:00:00.000Z" },
]
const fetchMock = vi.fn<typeof fetch>()
const accessLost = vi.fn()
let users: AttendanceHrUser[]
let hasMore: boolean
let container: HTMLDivElement
let root: Root
let revision: number

async function server(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsed = new URL(String(url), "https://attendance.test")
  if (!parsed.pathname.includes("/access")) throw new Error(`Unexpected URL: ${url}`)
  if (options?.method !== "PATCH") {
    const search = parsed.searchParams.get("search")?.toLowerCase() ?? ""
    return response({ users: users.filter(user => user.name.toLowerCase().includes(search)).map(user => ({ ...user, email: "private@example.test", token: "PRIVATE_TOKEN" })), hasMore })
  }
  const id = decodeURIComponent(parsed.pathname.split("/").at(-1)!)
  const current = users.find(user => user.id === id)
  if (!current) return response(null, 404, "MTM_ATTENDANCE_HR_NOT_FOUND")
  const body = JSON.parse(String(options.body))
  if (body.version !== current.version) return response(null, 409, "MTM_ATTENDANCE_HR_CHANGED")
  if (body.allEmployees && !current.canGrant) return response(null, 409, "MTM_ATTENDANCE_HR_UNAVAILABLE")
  const updated = { ...current, allEmployees: body.allEmployees, version: `2026-10-13T11:00:${String(++revision).padStart(2, "0")}.000Z` }
  users = users.map(user => user.id === id ? updated : user)
  return response(updated)
}
const panel = () => container.querySelector<HTMLElement>('[data-testid="attendance-hr-access"]')!
const row = (name: string) => Array.from(panel().querySelectorAll<HTMLElement>('[data-testid="attendance-hr-user"]')).find(item => item.textContent?.includes(name))!
const button = (text: string, parent: ParentNode = panel()) => Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!
const mutations = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")
async function render(locale = "en", canManage = true, denied = false, workspace = false) {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: workspace ? createElement(MtmAttendanceReportWorkspace)
    : createElement(MtmAttendanceHrAccess, { canManage, accessUnavailable: denied, onAccessLost: accessLost }) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(text: string, parent?: ParentNode) { await act(async () => button(text, parent).click()) }
async function search(value: string, submit = true) {
  const input = panel().querySelector<HTMLInputElement>("#attendance-hr-search")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  if (submit) await act(async () => { panel().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}
function capture(locale: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `attendance-hr-access-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance HR access</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${panel().outerHTML}</body></html>`, "utf8")
}

beforeEach(() => {
  users = fixture(); hasMore = false; revision = 0
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(server); accessLost.mockReset(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("administrator management of individual attendance access", () => {
  it("is absent without the explicit management flag and only loads after opening", async () => {
    await render("en", false)
    expect(panel()).toBeNull(); expect(fetchMock).not.toHaveBeenCalled()
    await render()
    expect(button("HR access").getAttribute("aria-expanded")).toBe("false")
    expect(fetchMock).not.toHaveBeenCalled()
    await click("HR access")
    expect(panel().querySelectorAll('[data-testid="attendance-hr-user"]')).toHaveLength(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["ru", "az", "en"])("renders translated user rights, eligibility and named confirmation in %s", async locale => {
    const t = messages(locale).mtmAttendance
    await render(locale); await click(t.hrOpen); await click(t.hrGrant, row("Aysel"))
    for (const key of ["hrPermission", "hrIntro", "hrAdmins", "hrNormalScope", "hrAllEmployees", "hrInactiveHint", "hrGrantUnavailable", "hrAuditHint"]) expect(panel().textContent).toContain(t[key])
    expect(panel().textContent).toContain(t.hrConfirmGrantHint.replace("{name}", "Aysel Aliyeva"))
    expect(panel().textContent).not.toMatch(/mtmAttendance\.|PRIVATE_|private@example|user-[abcd]/)
    expect(button(t.hrGrant, row("Rauf")).disabled).toBe(true)
    expect(button(t.hrRevoke, row("Samir")).disabled).toBe(false)
    expect(mutations()).toHaveLength(0)
    capture(locale)
  })

  it("confirms the named user before granting and revokes with the returned version", async () => {
    await render(); await click("HR access"); await click("Grant access", row("Aysel"))
    expect(mutations()).toHaveLength(0)
    await click("Cancel", row("Aysel")); expect(mutations()).toHaveLength(0)
    await click("Grant access", row("Aysel")); await click("Confirm grant", row("Aysel"))
    expect(mutations()[0][0]).toBe("/api/v1/mtm/attendance/access/user-a")
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ allEmployees: true, version: "2026-10-13T10:00:00.000Z" })
    expect(row("Aysel").textContent).toContain("All employees")
    await click("Revoke access", row("Aysel")); await click("Confirm revocation", row("Aysel"))
    expect(JSON.parse(String(mutations()[1][1]?.body))).toEqual({ allEmployees: false, version: "2026-10-13T11:00:01.000Z" })
    expect(row("Aysel").textContent).toContain("Standard access scope")
    expect(users[1].allEmployees).toBe(true)
  })

  it("blocks a new grant to an ineligible user while allowing revocation from an inactive one", async () => {
    await render(); await click("HR access")
    await click("Grant access", row("Rauf")); expect(mutations()).toHaveLength(0)
    expect(row("Rauf").textContent).not.toContain("Confirm grant")
    await click("Revoke access", row("Samir")); await click("Confirm revocation", row("Samir"))
    expect(JSON.parse(String(mutations()[0][1]?.body)).allEmployees).toBe(false)
    expect(button("Grant access", row("Samir")).disabled).toBe(true)
  })

  it("searches by name on the server and does not silently apply a draft search on locale change", async () => {
    await render(); await click("HR access"); await search("Leyla")
    expect(new URL(String(fetchMock.mock.calls.at(-1)![0]), "https://attendance.test").searchParams.get("search")).toBe("Leyla")
    expect(panel().querySelectorAll('[data-testid="attendance-hr-user"]')).toHaveLength(1)
    expect(panel().textContent).not.toContain("Aysel")
    await search("Unsaved search", false); await render("ru")
    expect(new URL(String(fetchMock.mock.calls.at(-1)![0]), "https://attendance.test").searchParams.get("search")).toBe("Leyla")
    expect(panel().textContent).toContain("Leyla")
    await search("No matching name")
    expect(panel().textContent).toContain(messages("ru").mtmAttendance.hrEmpty)
  })

  it("clearly marks a bounded result set and asks for a narrower name search", async () => {
    users = Array.from({ length: 50 }, (_, index) => ({ ...fixture()[0], id: `user-${index}`, name: `Example ${index}` })); hasMore = true
    await render(); await click("HR access")
    expect(panel().querySelectorAll('[data-testid="attendance-hr-user"]')).toHaveLength(50)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.hrMoreResults)
  })

  it.each([
    ["MTM_ATTENDANCE_HR_CHANGED", "hrChanged"], ["MTM_ATTENDANCE_HR_UNAVAILABLE", "hrGrantChanged"], ["MTM_ATTENDANCE_HR_ADMIN_AUTOMATIC", "hrAdminChanged"],
  ])("requires fresh confirmation after server conflict %s", async (code, key) => {
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? response(null, 409, code) : server(url, options))
    await render(); await click("HR access"); await click("Grant access", row("Aysel")); await click("Confirm grant", row("Aysel"))
    expect(panel().textContent).toContain(messages("en").mtmAttendance[key])
    expect(button("Confirm grant", row("Aysel")).disabled).toBe(true)
    await click("Confirm grant", row("Aysel")); expect(mutations()).toHaveLength(1)
    users[0] = { ...users[0], version: "2026-10-13T12:00:00.000Z" }
    await click("Refresh users")
    expect(row("Aysel").textContent).not.toContain("Confirm grant")
    expect(button("Grant access", row("Aysel")).disabled).toBe(false)
  })

  it("handles a response lost after commit by reading the new grant before any further write", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      const result = await server(url, options)
      if (options?.method === "PATCH") throw new Error("Connection lost after commit")
      return result
    })
    await render(); await click("HR access"); await click("Grant access", row("Aysel")); await click("Confirm grant", row("Aysel"))
    expect(row("Aysel").textContent).toContain("Standard access scope")
    expect(panel().textContent).toContain(messages("en").mtmAttendance.hrUnconfirmed)
    await click("Refresh users")
    expect(row("Aysel").textContent).toContain("All employees")
    expect(button("Revoke access", row("Aysel")).disabled).toBe(false)
    expect(mutations()).toHaveLength(1)
  })

  it.each([401, 403, 404])("clears user names and confirmation after write denial %s", async status => {
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? response(null, status) : server(url, options))
    await render(); await click("HR access"); await click("Grant access", row("Aysel")); await click("Confirm grant", row("Aysel"))
    expect(panel().textContent).not.toMatch(/Aysel|Leyla|Samir|Rauf|PRIVATE_/)
    expect(accessLost).toHaveBeenCalledTimes(1)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.hrAccessUnavailable)
  })

  it("aborts writes on language change and requires an explicit refresh before a new confirmation", async () => {
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? new Promise<Response>((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    }) : server(url, options))
    await render(); await click("HR access"); await click("Grant access", row("Aysel")); await click("Confirm grant", row("Aysel"))
    await render("ru")
    expect(mutations()[0][1]?.signal?.aborted).toBe(true)
    const t = messages("ru").mtmAttendance
    expect(panel().textContent).not.toContain(t.hrSaving)
    expect(panel().textContent).toContain(t.hrUnconfirmed)
    expect(button(t.hrGrant, row("Aysel")).disabled).toBe(true)
    await click(t.hrReload)
    expect(button(t.hrGrant, row("Aysel")).disabled).toBe(false)
    expect(mutations()).toHaveLength(1)
  })

  it("ignores an older user search after a newer search has completed", async () => {
    let resolve!: (value: Response) => void
    await render(); await click("HR access")
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
    await search("Aysel")
    const signal = fetchMock.mock.calls.at(-1)![1]?.signal
    await search("Leyla")
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(response({ users: [fixture()[0]], hasMore: false })))
    expect(panel().textContent).toContain("Leyla")
    expect(panel().textContent).not.toContain("Aysel")
  })

  it("hides and clears the section when the containing report loses access", async () => {
    await render(); await click("HR access"); await click("Grant access", row("Aysel"))
    await render("en", true, true)
    expect(panel()).toBeNull(); expect(container.textContent).not.toContain("Aysel")
    await render("en", false)
    expect(panel()).toBeNull(); expect(mutations()).toHaveLength(0)
  })

  it("shows a localized load error without exposing a non-JSON server body", async () => {
    fetchMock.mockResolvedValue(new Response("PRIVATE_RESPONSE", { status: 500 }))
    await render(); await click("HR access")
    expect(panel().textContent).toContain(messages("en").mtmAttendance.hrLoadError)
    expect(panel().textContent).not.toContain("PRIVATE_")
  })

  it.each([true, false, "true"])("uses the strict server management flag %s in the real report workspace", async flag => {
    let deny = false
    let managementFlag = flag
    fetchMock.mockImplementation(async (url, options) => {
      const parsed = new URL(String(url), "https://attendance.test")
      if (parsed.pathname.includes("/access")) return deny ? response(null, 403) : server(url, options)
      if (parsed.pathname.endsWith("/rules")) return response({ today: TODAY, canManageRules: managementFlag })
      if (parsed.pathname.endsWith("/views")) return response([])
      return response(buildMtmAttendanceReport({ employees: [{ id: "agent-a", name: "Aysel Aliyeva", teamId: "north", teamName: "North" }], workdays: [], calendar: [], rules: [], from: parsed.searchParams.get("from")!, to: parsed.searchParams.get("to")!, now: `${TODAY}T19:00:00+04:00` }))
    })
    await render("en", true, false, true)
    if (flag !== true) { expect(panel()).toBeNull(); return }
    await click("HR access")
    expect(row("Aysel")).toBeDefined()
    managementFlag = false
    await render("ru", true, false, true)
    expect(panel()).toBeNull()
    expect(container.textContent).not.toContain("Samir")
    expect(container.textContent).toContain("Aysel")
    managementFlag = true
    await render("en", true, false, true)
    await click("HR access")
    deny = true
    await click("Refresh users")
    expect(panel()).toBeNull()
    expect(container.textContent).not.toContain("Aysel")
    expect(container.textContent).toContain(messages("en").mtmAttendance.reportAccessUnavailable)
  })
})
