// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { ATTENDANCE_VIEW_COLUMNS, AttendanceViewConfigSchema, type AttendanceView, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const people = [{ id: "a", name: "Aysel Aliyeva", teamId: "north", teamName: "North" }, { id: "b", name: "Leyla Mammadova", teamId: "south", teamName: "South" }]
const at = (clock: string) => `${TODAY}T${clock}:00+04:00`
const config = (changes: Partial<AttendanceViewConfig> = {}): AttendanceViewConfig => ({ version: 1, mode: "DAY", columns: [...ATTENDANCE_VIEW_COLUMNS.DAY], showTotals: true,
  filters: { from: TODAY, to: TODAY, form: "ALL" }, ...changes })
const view = (changes: Partial<AttendanceView> = {}): AttendanceView => ({ id: "view-a", name: "My attendance", config: config(), version: "2026-10-13T10:00:00.000Z", ...changes })
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_ERROR" }), { status })
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const fetchMock = vi.fn<typeof fetch>()
let savedViews: AttendanceView[]
let container: HTMLDivElement
let root: Root
async function server(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsed = new URL(String(url), "https://attendance.test")
  if (parsed.pathname.endsWith("/rules")) return response({ today: TODAY })
  if (parsed.pathname.endsWith("/report")) {
    const employeeId = parsed.searchParams.get("employeeId")
    const teamId = parsed.searchParams.get("teamId")
    if (employeeId && !people.some((person) => person.id === employeeId)) return response(null, 403, "MTM_ATTENDANCE_SCOPE_DENIED")
    return response(buildMtmAttendanceReport({ employees: people.filter((person) => (!employeeId || person.id === employeeId) && (!teamId || person.teamId === teamId)),
      from: parsed.searchParams.get("from")!, to: parsed.searchParams.get("to")!, now: at("19:00"), calendar: [], rules: [],
      workdays: [{ id: "workday-a", agentId: "a", workDate: TODAY, status: "COMPLETED", startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 3600,
        events: [{ type: "START", occurredAt: at("09:00"), claimedAt: at("08:59"), serverReceivedAt: at("09:02") },
          { type: "PAUSE", occurredAt: at("13:00") }, { type: "RESUME", occurredAt: at("14:00") }, { type: "FINISH", occurredAt: at("18:00") }] }] }))
  }
  if (!options?.method || options.method === "GET") return response(savedViews)
  const body = JSON.parse(String(options.body))
  if (options.method === "POST") {
    const parsedConfig = AttendanceViewConfigSchema.parse(body.config)
    const id = `saved-${body.requestId}`
    const existing = savedViews.find((item) => item.id === id)
    if (existing) return response(existing)
    const created = view({ id, name: body.name, config: parsedConfig })
    savedViews.push(created)
    return response(created)
  }
  const id = decodeURIComponent(parsed.pathname.split("/").at(-1)!)
  const existing = savedViews.find((item) => item.id === id)
  if (!existing) return response(null, 404, "MTM_ATTENDANCE_VIEW_NOT_FOUND")
  if (options.method === "PATCH") {
    const changed = { ...existing, name: body.name, config: AttendanceViewConfigSchema.parse(body.config), version: "2026-10-13T11:00:00.000Z" }
    savedViews = savedViews.map((item) => item.id === id ? changed : item)
    return response(changed)
  }
  savedViews = savedViews.filter((item) => item.id !== id)
  return response(null)
}
const panel = () => container.querySelector('[data-testid="attendance-personal-views"]')!
const input = (id: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#attendance-${id}`)!
const button = (text: string) => Array.from(panel().querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text)!
const mutations = () => fetchMock.mock.calls.filter(([, options]) => ["POST", "PATCH", "DELETE"].includes(options?.method ?? ""))
async function render(locale = "en") {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceReportWorkspace) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function edit(id: string, value: string) {
  const field = input(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(field.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function click(text: string) { await act(async () => button(text).click()) }
async function submit() { await act(async () => { panel().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
const headers = () => Array.from(container.querySelectorAll('[data-testid="attendance-custom-table"] th')).map((header) => header.textContent)
const customRows = () => Array.from(container.querySelectorAll('[data-testid="attendance-custom-row"]')).map((row) => row.textContent)
const totals = () => container.querySelector('[data-testid="attendance-report-totals"]')?.textContent

beforeEach(() => {
  savedViews = []
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(server)
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("personal attendance forms with real report rows", () => {
  it.each(["ru", "az", "en"])("renders the personal editor and actual column translations in %s", async (locale) => {
    await render(locale)
    const t = messages(locale).mtmAttendance
    expect(panel().textContent).toContain(t.viewsTitle)
    expect(panel().textContent).toContain(t.viewsIntro)
    expect(panel().textContent).toContain(t.reportWorked)
    expect(panel().querySelectorAll('input[data-column]:checked')).toHaveLength(ATTENDANCE_VIEW_COLUMNS.DAY.length)
    expect(panel().textContent).not.toMatch(/mtmAttendance\.|PRIVATE_/)
    const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (directory) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, `attendance-personal-views-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personal attendance form</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${panel().outerHTML}</body></html>`, "utf8")
    }
  })

  it("saves ordered columns and filters, remounts, and reopens with identical rows and totals", async () => {
    await render()
    await edit("report-team", "north")
    await edit("view-name", "North hours")
    for (const checkbox of Array.from(panel().querySelectorAll<HTMLInputElement>('input[data-column]'))) {
      if (!["employee", "worked"].includes(checkbox.dataset.column!)) await act(async () => checkbox.click())
    }
    await act(async () => panel().querySelector<HTMLButtonElement>('[aria-label="Move “Worked” earlier"]')!.click())
    await submit()
    expect(savedViews).toHaveLength(1)
    expect(savedViews[0].config.columns).toEqual(["worked", "employee"])
    expect(savedViews[0].config.filters.teamId).toBe("north")
    expect(headers()).toEqual(["Worked", "Employee"])
    expect(customRows()).toEqual(["8:00Aysel Aliyeva"])
    const before = { rows: customRows(), totals: totals() }
    await act(async () => root.render(null))
    await render()
    await click("Open")
    expect(headers()).toEqual(["Worked", "Employee"])
    expect({ rows: customRows(), totals: totals() }).toEqual(before)
    expect(input("report-team").value).toBe("north")
    const requestId = JSON.parse(String(mutations()[0][1]?.body)).requestId
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("supports employee-month and event rows and hides totals when unchecked", async () => {
    await render()
    await edit("view-mode", "MONTH")
    await edit("view-name", "Monthly hours")
    await submit()
    expect(savedViews[0].config.filters).toMatchObject({ from: "2026-10-01", to: "2026-10-31", form: "ALL" })
    expect(customRows()).toHaveLength(2)
    expect(headers()).toHaveLength(36)
    await click("Create another form")
    await edit("view-mode", "JOURNAL")
    await edit("view-name", "Phone and server")
    await act(async () => (input("view-totals") as HTMLInputElement).click())
    await submit()
    expect(savedViews[1].config.filters.form).toBe("JOURNAL")
    expect(customRows()).toHaveLength(4)
    expect(headers()).toEqual(["Employee", "Team", "Date", "Day status", "Event", "Phone time", "Received by server"])
    expect(customRows()[0]).toContain("8:59:00")
    expect(totals()).toBeUndefined()
  })

  it("preserves an opened monthly form and its scope when the locale changes", async () => {
    savedViews = [view({ config: config({ mode: "MONTH", columns: ["employee", "days", "worked"],
      filters: { from: "2026-10-01", to: "2026-10-31", form: "ALL", teamId: "north" } }) })]
    await render()
    await click("Open")
    expect(customRows()).toHaveLength(1)
    await render("ru")
    expect(customRows()).toHaveLength(1)
    expect(headers()).toHaveLength(33)
    expect(input("report-month").value).toBe("2026-10")
    expect(input("report-team").value).toBe("north")
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/report?")).at(-1)?.[0])
      .toBe("/api/v1/mtm/attendance/report?from=2026-10-01&to=2026-10-31&form=ALL&teamId=north")
  })

  it("renames with optimistic version and deletes only after confirmation", async () => {
    savedViews = [view()]
    await render()
    await click("Rename")
    await edit("view-name", "Renamed")
    await submit()
    expect(mutations()[0][1]?.method).toBe("PATCH")
    expect(JSON.parse(String(mutations()[0][1]?.body)).version).toBe("2026-10-13T10:00:00.000Z")
    expect(savedViews[0].name).toBe("Renamed")
    await click("Delete")
    expect(mutations()).toHaveLength(1)
    await click("Delete form")
    expect(mutations()[1][1]?.method).toBe("DELETE")
    expect(JSON.parse(String(mutations()[1][1]?.body)).version).toBe("2026-10-13T11:00:00.000Z")
    expect(savedViews).toHaveLength(0)
  })

  it("retains a removed team filter and shows no substitute employees", async () => {
    savedViews = [view({ config: config({ filters: { from: TODAY, to: TODAY, form: "ALL", teamId: "removed-team" } }) })]
    await render()
    await click("Open")
    expect(input("report-team").value).toBe("removed-team")
    expect(container.textContent).toContain(messages("en").mtmAttendance.viewsScopeUnavailable)
    expect(container.querySelectorAll('[data-testid="attendance-custom-row"]')).toHaveLength(0)
    expect(container.querySelector('[data-testid="attendance-arrived-value"]')?.textContent).toBe("0")
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/report?")).at(-1)?.[0]).toContain("teamId=removed-team")
  })

  it("clears report and personal names after opening an employee no longer in scope", async () => {
    savedViews = [view({ name: "Private form name", config: config({ filters: { from: TODAY, to: TODAY, form: "ALL", employeeId: "removed-employee" } }) })]
    await render()
    await click("Open")
    expect(container.textContent).toContain(messages("en").mtmAttendance.reportAccessUnavailable)
    expect(container.textContent).not.toContain("Private form name")
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    expect(panel().querySelectorAll('[data-testid="attendance-personal-view"]')).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/report?")).at(-1)?.[0]).toContain("employeeId=removed-employee")
  })

  it("refreshes after a lost create response and safely retries the same request ID", async () => {
    let lost = true
    fetchMock.mockImplementation(async (url, options) => {
      const result = await server(url, options)
      if (options?.method === "POST" && lost) { lost = false; throw new Error("PRIVATE_NETWORK_ERROR") }
      return result
    })
    await render()
    await edit("view-name", "Safe retry")
    await submit()
    expect(savedViews).toHaveLength(1)
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.viewsSaveUnconfirmed)
    await submit()
    expect(mutations()).toHaveLength(1)
    await click("Refresh saved forms")
    await submit()
    expect(mutations()).toHaveLength(2)
    expect(JSON.parse(String(mutations()[0][1]?.body)).requestId).toBe(JSON.parse(String(mutations()[1][1]?.body)).requestId)
    expect(savedViews).toHaveLength(1)
    expect(container.textContent).not.toContain("PRIVATE_NETWORK_ERROR")
  })

  it("requires a refresh after a stale update and adopts the latest saved version", async () => {
    savedViews = [view()]
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? response(null, 409, "MTM_ATTENDANCE_VIEW_CHANGED") : server(url, options))
    await render()
    await click("Rename")
    await edit("view-name", "Unconfirmed")
    await submit()
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.viewsChanged)
    await submit()
    expect(mutations()).toHaveLength(1)
    savedViews = [view({ name: "Latest name", version: "2026-10-13T12:00:00.000Z" })]
    await click("Refresh saved forms")
    expect(input("view-name").value).toBe("Latest name")
  })

  it.each([403, 404])("clears personal and report data on a %s mutation response", async (status) => {
    savedViews = [view({ name: "Private saved view" })]
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? response(null, status) : server(url, options))
    await render()
    await click("Rename")
    await edit("view-name", "Changed")
    await submit()
    expect(container.textContent).not.toContain("Private saved view")
    expect(container.textContent).not.toContain("Aysel Aliyeva")
    expect(panel().querySelector("form")).toBeNull()
  })
})
