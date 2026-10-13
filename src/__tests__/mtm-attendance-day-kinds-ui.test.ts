// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceDayKinds } from "@/components/mtm/attendance-day-kinds"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { AttendanceDayKindsUpdateSchema, defaultAttendanceDayKinds, type AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const translationFiles = Object.fromEntries(["az", "ru", "en"].map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const messages = (locale: string) => translationFiles[locale]
const fixture = () => defaultAttendanceDayKinds(key => ({ az: messages("az").mtmAttendance[`dayKindName${key}`], ru: messages("ru").mtmAttendance[`dayKindName${key}`], en: messages("en").mtmAttendance[`dayKindName${key}`] }))
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_ERROR" }), { status })
const fetchMock = vi.fn<typeof fetch>()
const accessLost = vi.fn()
const onSaved = vi.fn()
let items: AttendanceDayKind[]
let version: string | null
let revision: number
let serverCanManage: unknown
let container: HTMLDivElement
let root: Root
async function server(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsedUrl = new URL(String(url), "https://attendance.test")
  if (parsedUrl.pathname.endsWith("/rules")) return response({ today: TODAY, canManageRules: true })
  if (parsedUrl.pathname.endsWith("/views")) return response([])
  if (parsedUrl.pathname.endsWith("/report")) {
    const at = (time: string) => `${TODAY}T${time}:00+04:00`
    return response(buildMtmAttendanceReport({ from: parsedUrl.searchParams.get("from")!, to: parsedUrl.searchParams.get("to")!, now: at("19:00"),
      employees: [{ id: "fictional-agent", name: "Example A", teamId: null, teamName: null }], rules: [], calendar: [], dayKinds: items,
      workdays: [{ id: "day", agentId: "fictional-agent", workDate: TODAY, status: "COMPLETED", startedAt: at("09:00"), completedAt: at("18:00"), totalPausedSeconds: 0,
        events: [{ type: "START", occurredAt: at("09:00") }, { type: "FINISH", occurredAt: at("18:00") }] }] }))
  }
  if (!parsedUrl.pathname.endsWith("/day-kinds")) throw new Error("Unexpected endpoint")
  if (options?.method !== "PUT") return response({ items, version, canManage: serverCanManage })
  const body = AttendanceDayKindsUpdateSchema.parse(JSON.parse(String(options.body)))
  if (body.version !== version) return response(null, 409, "MTM_ATTENDANCE_DAY_KINDS_CHANGED")
  items = body.items
  version = `2026-10-13T10:00:${String(++revision).padStart(2, "0")}.000Z`
  return response({ items, version })
}
const panel = () => container.querySelector<HTMLElement>('[data-testid="attendance-day-kinds"]')!
const row = (key: string) => panel().querySelector<HTMLElement>(`[data-kind="${key}"]`)!
const button = (text: string, parent: ParentNode = panel()) => Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!
const puts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT")
async function render(locale = "en", canManage = true, accessUnavailable = false, workspace = false) {
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku",
    children: workspace ? createElement(MtmAttendanceReportWorkspace) : createElement(MtmAttendanceDayKinds, { canManage, accessUnavailable, onAccessLost: accessLost, onSaved }) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(text: string, parent?: ParentNode) { await act(async () => button(text, parent).click()) }
async function edit(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function submit() { await act(async () => { panel().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
async function selectKind(key: string, locale = "en") { await edit("attendance-kinds-search", items.find(item => item.key === key)!.names[locale as "az" | "ru" | "en"]); await click(messages(locale).mtmAttendance.kindsEdit, row(key)) }
function capture(locale: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  // outerHTML omits live selected state; preserve the actual rendered controls.
  const cloned = panel().cloneNode(true) as HTMLElement
  panel().querySelectorAll<HTMLSelectElement>("select").forEach((select, index) => {
    const target = cloned.querySelectorAll("select")[index]
    Array.from(target.options).forEach((option, optionIndex) => { if (select.options[optionIndex].selected) option.setAttribute("selected", ""); else option.removeAttribute("selected") })
  })
  panel().querySelectorAll<HTMLInputElement>("input").forEach((input, index) => {
    const target = cloned.querySelectorAll("input")[index]
    target.setAttribute("value", input.value)
    if (input.checked) target.setAttribute("checked", ""); else target.removeAttribute("checked")
  })
  writeFileSync(join(directory, `attendance-day-kinds-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance day types</title><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${cloned.outerHTML}</body></html>`)
}
beforeEach(() => {
  items = fixture(); version = null; revision = 0; serverCanManage = true
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(server); accessLost.mockReset(); onSaved.mockReset(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("attendance catalogue editor using the actual contract", () => {
  it.each(["ru", "az", "en"])("renders translated labels, unspecified pay and an accessible editor in %s", async locale => {
    const t = messages(locale).mtmAttendance
    await render(locale); expect(fetchMock).not.toHaveBeenCalled()
    await click(t.kindsOpen)
    expect(panel().querySelectorAll('[data-testid="attendance-kind-row"]')).toHaveLength(8)
    expect(panel().textContent).toContain(t.kindsPayHint)
    expect(button(t.kindsArchive, row("WORKED"))).toBeUndefined()
    await selectKind("ANNUAL_LEAVE", locale)
    for (const id of ["name-az", "name-ru", "name-en", "code", "color", "group", "unit", "paid"]) expect(panel().querySelector(`label[for="attendance-kind-${id}"]`)?.textContent).toBeTruthy()
    expect(panel().querySelector<HTMLSelectElement>("#attendance-kind-paid")!.value).toBe("unspecified")
    expect(panel().querySelector<HTMLSelectElement>("#attendance-kind-group")!.value).toBe("PAID_LEAVE")
    expect(panel().textContent).not.toMatch(/mtmAttendance\.|PRIVATE_|CUSTOM_/)
    capture(locale)
  })

  it.each([false, "true"])("does not expose writes without literal server management permission: %s", async permission => {
    serverCanManage = permission
    await render(); await click("Day types")
    expect(panel().textContent).toContain(messages("en").mtmAttendance.kindsReadOnly)
    expect(button("Add day type")).toBeUndefined(); expect(button("Edit")).toBeUndefined()
    expect(puts()).toHaveLength(0)
  })

  it("also requires management permission from the containing report", async () => {
    await render("en", false); await click("Day types")
    expect(button("Edit")).toBeUndefined()
    await render("en", true)
    await click("Edit", row("WORKED"))
    await render("en", false)
    expect(panel().querySelector("form")).toBeNull()
    expect(button("Edit")).toBeUndefined()
  })

  it("saves all configured fields, retains every identity and uses the returned version for the next edit", async () => {
    await render(); await click("Day types"); await selectKind("WORKED")
    await edit("attendance-kind-code", "W1"); await edit("attendance-kind-name-en", "Company workday")
    await edit("attendance-kind-color", "#884411"); await edit("attendance-kind-paid", "false"); await edit("attendance-kind-unit", "DAYS")
    await submit()
    expect(items.find(item => item.key === "WORKED")).toMatchObject({ code: "W1", names: { en: "Company workday" }, color: "#884411", paid: false, unit: "DAYS" })
    expect(items.map(item => item.key)).toEqual(fixture().map(item => item.key))
    expect(JSON.parse(String(puts()[0][1]?.body)).version).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)
    await click("Refresh catalogue"); await selectKind("WORKED"); await edit("attendance-kind-paid", "unspecified"); await submit()
    expect(JSON.parse(String(puts()[1][1]?.body)).version).toBe("2026-10-13T10:00:01.000Z")
    expect(items[0].paid).toBeNull()
  })

  it("adds a custom kind without exposing implementation keys to the user", async () => {
    await render(); await click("Day types"); await click("Add day type")
    for (const language of ["az", "ru", "en"]) await edit(`attendance-kind-name-${language}`, `Example ${language}`)
    await edit("attendance-kind-code", "ZZ"); await edit("attendance-kind-group", "EMPLOYER"); await submit()
    expect(items).toHaveLength(33)
    expect(items[32]).toMatchObject({ code: "ZZ", group: "EMPLOYER", paid: null, archived: false, countsAsWorked: false })
    expect(items[32].key).toMatch(/^CUSTOM_[A-F0-9]+$/)
    expect(panel().textContent).not.toContain(items[32].key)
  })

  it("rejects duplicate active codes and missing translations before sending", async () => {
    await render(); await click("Day types"); await selectKind("WORKED")
    await edit("attendance-kind-code", "B"); await submit()
    expect(puts()).toHaveLength(0)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.kindsInvalid)
    await edit("attendance-kind-code", "W"); await edit("attendance-kind-name-ru", ""); await submit()
    expect(puts()).toHaveLength(0)
  })

  it("requires confirmation to apply preset codes and preserves names and custom types", async () => {
    items[0].names.en = "Company workday"
    items.push({ ...items[0], key: "CUSTOM_EXAMPLE", code: "ZZ", names: { az: "Nümunə", ru: "Пример", en: "Example" } })
    await render(); await click("Day types"); await click("Russian codes")
    expect(puts()).toHaveLength(0)
    await click("Cancel"); expect(puts()).toHaveLength(0)
    await click("Russian codes"); await click("Confirm")
    expect(items[0].code).toBe("Я"); expect(items[0].names.en).toBe("Company workday")
    expect(items.at(-1)!.code).toBe("ZZ")
    await click("İ / B / E / X / M codes"); await click("Confirm")
    expect(items[0].code).toBe("İ")
  })

  it("archives and restores a custom kind without deleting its identity", async () => {
    await render(); await click("Day types"); await edit("attendance-kinds-search", "Annual leave")
    await click("Archive", row("ANNUAL_LEAVE")); expect(puts()).toHaveLength(0)
    await click("Confirm"); expect(items.find(item => item.key === "ANNUAL_LEAVE")!.archived).toBe(true)
    expect(items).toHaveLength(32); expect(row("ANNUAL_LEAVE")).toBeNull()
    await act(async () => { Array.from(panel().querySelectorAll<HTMLLabelElement>("label")).find(label => label.textContent === "Show archived")!.querySelector<HTMLInputElement>("input")!.click() })
    await click("Restore", row("ANNUAL_LEAVE")); await click("Confirm")
    expect(items.find(item => item.key === "ANNUAL_LEAVE")!.archived).toBe(false)
  })

  it("fences a version conflict until an explicit reload", async () => {
    await render(); await click("Day types"); await selectKind("WORKED")
    version = "2026-10-13T12:00:00.000Z"
    await edit("attendance-kind-code", "W"); await submit()
    expect(panel().textContent).toContain(messages("en").mtmAttendance.kindsChanged)
    expect(button("Save type").disabled).toBe(true)
    await click("Refresh catalogue")
    expect(panel().querySelector("form")).toBeNull(); expect(button("Add day type").disabled).toBe(false)
  })

  it("reads the actual commit after a lost response instead of blindly repeating the save", async () => {
    fetchMock.mockImplementation(async (url, options) => { const result = await server(url, options); if (options?.method === "PUT") throw new Error("Response lost"); return result })
    await render(); await click("Day types"); await selectKind("WORKED"); await edit("attendance-kind-code", "W"); await submit()
    expect(panel().textContent).toContain(messages("en").mtmAttendance.kindsUnconfirmed)
    expect(puts()).toHaveLength(1)
    await click("Refresh catalogue")
    expect(row("WORKED").textContent).toContain("W")
    expect(button("Add day type").disabled).toBe(false)
  })

  it("aborts an uncertain write on locale change and requires explicit acknowledgement after the read", async () => {
    let resolve!: (value: Response) => void
    await render(); await click("Day types"); await selectKind("WORKED"); await edit("attendance-kind-code", "W")
    fetchMock.mockImplementation(async (url, options) => {
      const result = await server(url, options)
      return options?.method === "PUT" ? new Promise<Response>(done => { resolve = () => done(result) }) : result
    })
    await submit(); const signal = puts()[0][1]?.signal
    await render("ru")
    expect(signal?.aborted).toBe(true)
    const t = messages("ru").mtmAttendance
    expect(panel().textContent).toContain(t.kindsUnconfirmed)
    expect(button(t.kindsAdd).disabled).toBe(true)
    expect(button(t.kindsReload).disabled).toBe(false)
    await act(async () => resolve(response({ items, version })))
    expect(onSaved).not.toHaveBeenCalled()
    await click(t.kindsReload)
    expect(button(t.kindsAdd).disabled).toBe(false)
    expect(puts()).toHaveLength(1)
  })

  it.each([401, 403, 404])("clears private catalogue and draft on write denial %s", async status => {
    await render(); await click("Day types"); await selectKind("WORKED")
    fetchMock.mockImplementation(async (url, options) => options?.method === "PUT" ? response(null, status) : server(url, options))
    await edit("attendance-kind-name-en", "Private company term"); await submit()
    expect(panel().querySelector("form")).toBeNull()
    expect(panel().textContent).not.toContain("Private company term")
    expect(panel().querySelectorAll('[data-testid="attendance-kind-row"]')).toHaveLength(0)
    expect(accessLost).toHaveBeenCalledOnce()
  })

  it("clears the catalogue if a later read is denied and aborts pending reads on unmount", async () => {
    await render(); await click("Day types")
    fetchMock.mockResolvedValueOnce(response(null, 403))
    await click("Refresh catalogue")
    expect(panel().querySelectorAll('[data-testid="attendance-kind-row"]')).toHaveLength(0)
    expect(accessLost).toHaveBeenCalledOnce()
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}))
    await click("Refresh catalogue")
    const signal = fetchMock.mock.calls.at(-1)![1]?.signal
    await act(async () => root.unmount()); root = createRoot(container)
    expect(signal?.aborted).toBe(true)
  })

  it("uses actual catalogue codes and names in day, month, legend and journal, then refreshes after editing", async () => {
    items[0].code = "W1"; items[0].names.en = "Company workday"; items[0].color = "#123456"
    await render("en", true, false, true)
    const globalButton = (text: string) => button(text, container)
    expect(container.querySelector('[data-testid="attendance-day-table"]')!.textContent).toContain("W1 · Company workday")
    expect(container.querySelector<HTMLElement>('[data-testid="attendance-day-table"] [data-testid="attendance-kind-color"]')!.style.backgroundColor).toBe("rgb(18, 52, 86)")
    await act(async () => globalButton(messages("en").mtmAttendance.reportJournal).click())
    expect(container.querySelector('[data-testid="attendance-journal-table"]')!.textContent).toContain("W1 · Company workday")
    expect(container.querySelector('[data-testid="attendance-journal-table"]')!.textContent).toContain(messages("en").mtmAttendance.reportStatus)
    await act(async () => globalButton(messages("en").mtmAttendance.reportMonth).click())
    expect(container.querySelector('[data-testid="attendance-month-grid"]')!.textContent).toContain("W1 · 9:00")
    expect(container.querySelector(`[aria-label="${messages("en").mtmAttendance.reportLegend}"]`)!.textContent).toContain("W1 — Company workday")
    await click("Day types"); await selectKind("WORKED"); await edit("attendance-kind-code", "W2"); await submit()
    expect(container.querySelector('[data-testid="attendance-month-grid"]')!.textContent).toContain("W2 · 9:00")
  })
})
