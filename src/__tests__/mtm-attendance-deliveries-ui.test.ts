// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceDeliveries } from "@/components/mtm/attendance-deliveries"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { AttendanceDeliveryInputSchema, type AttendanceDeliveryReceipt, type AttendanceDeliverySchedule } from "@/lib/mtm/attendance-delivery-contract"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const TODAY = "2026-10-13"
const currentConfig: AttendanceViewConfig = { version: 1, mode: "DAY", columns: ["worked", "employee"], showTotals: false,
  filters: { from: TODAY, to: TODAY, form: "LATE_EARLY", employeeId: "agent-a", teamId: "north" } }
const exampleSchedule = (): AttendanceDeliverySchedule => ({ name: "Weekly attendance", config: currentConfig, frequency: "WEEKLY", format: "xlsx", locale: "ru", recipients: ["manager@example.test"], enabled: true,
  id: "schedule-a", timezone: "Asia/Baku", nextRunAt: "2026-10-19T05:00:00.000Z", version: "2026-10-13T10:00:00.000Z" })
const exampleReceipts = (): AttendanceDeliveryReceipt[] => (["SENT", "UNKNOWN", "PENDING", "SENDING", "CANCELLED", "FAILED"] as const).map((status, index) => ({
  id: `receipt-${index}`, scheduleId: "schedule-a", recipient: `reviewer${index + 1}@example.test`, from: "2026-10-05", to: "2026-10-11", status,
  createdAt: "2026-10-12T05:00:00.000Z", completedAt: status === "PENDING" || status === "SENDING" ? null : "2026-10-12T05:00:02.000Z", errorCode: "PRIVATE_PROVIDER_PAYLOAD",
}))
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_SERVER_ERROR" }), { status })
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const fetchMock = vi.fn<typeof fetch>()
const accessLost = vi.fn()
let schedules: AttendanceDeliverySchedule[]
let receipts: AttendanceDeliveryReceipt[]
let container: HTMLDivElement
let root: Root
let version: number

async function server(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsed = new URL(String(url), "https://attendance.test")
  if (!parsed.pathname.includes("/deliveries")) throw new Error(`Unexpected URL: ${url}`)
  if (!options?.method || options.method === "GET") return response({ timezone: "Asia/Baku", schedules, receipts })
  const body = JSON.parse(String(options.body))
  if (options.method === "POST") {
    const input = AttendanceDeliveryInputSchema.parse(body.input)
    const id = `new-${body.requestId}`
    const existing = schedules.find(item => item.id === id)
    if (existing) return response(existing)
    const created = { ...exampleSchedule(), ...input, id }
    schedules.push(created)
    return response(created)
  }
  const id = decodeURIComponent(parsed.pathname.split("/").at(-1)!)
  const existing = schedules.find(item => item.id === id)
  if (!existing) return response(null, 404, "MTM_ATTENDANCE_DELIVERY_NOT_FOUND")
  if (body.version !== existing.version) return response(null, 409, "MTM_ATTENDANCE_DELIVERY_CHANGED")
  receipts = receipts.map(item => item.scheduleId === id && item.status === "PENDING" ? { ...item, status: "CANCELLED" } : item)
  if (options.method === "DELETE") { schedules = schedules.filter(item => item.id !== id); return response(null) }
  const changed = { ...existing, ...AttendanceDeliveryInputSchema.parse(body.input), version: `2026-10-13T11:00:${String(++version).padStart(2, "0")}.000Z` }
  schedules = schedules.map(item => item.id === id ? changed : item)
  return response(changed)
}

const panel = () => container.querySelector<HTMLElement>('[data-testid="attendance-deliveries"]')!
const button = (text: string, parent: ParentNode = panel()) => Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!
const mutations = () => fetchMock.mock.calls.filter(([, options]) => ["POST", "PATCH", "DELETE"].includes(options?.method ?? ""))
async function render(locale = "en", config: AttendanceViewConfig | null = currentConfig, denied = false, workspace = false) {
  const child = workspace ? createElement(MtmAttendanceReportWorkspace) : createElement(MtmAttendanceDeliveries, { currentConfig: config, onAccessLost: accessLost, accessUnavailable: denied })
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: child }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(text: string, parent?: ParentNode) { await act(async () => button(text, parent).click()) }
async function edit(id: string, value: string) {
  const field = panel().querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#attendance-delivery-${id}`)!
  await act(async () => {
    const prototype = field.tagName === "SELECT" ? HTMLSelectElement.prototype : field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function submit() { await act(async () => { panel().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
async function newDraft(locale = "en") { const t = messages(locale).mtmAttendance; await click(t.deliveryOpen); await click(t.deliveryNew); await edit("name", "My attendance"); await edit("recipients", "first@example.test"); }

function capture(locale: string, suffix = "") {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  const clone = panel().cloneNode(true) as HTMLElement
  // Serialize live form values too; this is the tested DOM, not a parallel UI.
  panel().querySelectorAll("input,textarea,select").forEach((field, index) => {
    const copied = clone.querySelectorAll("input,textarea,select")[index]
    if (field instanceof HTMLInputElement) {
      copied.setAttribute("value", field.value)
      if (field.checked) copied.setAttribute("checked", "")
      else copied.removeAttribute("checked")
    } else if (field instanceof HTMLTextAreaElement) copied.textContent = field.value
    else if (field instanceof HTMLSelectElement) Array.from(copied.querySelectorAll("option")).forEach(option => { if (option.value === field.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") })
  })
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `attendance-deliveries-${locale}${suffix}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance email schedules</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.outerHTML}</body></html>`, "utf8")
}

beforeEach(() => {
  schedules = []; receipts = []; version = 0
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(server); accessLost.mockReset(); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("personal attendance email schedules", () => {
  it("loads private schedules only after the user opens the section", async () => {
    await render("ru")
    const t = messages("ru").mtmAttendance
    expect(fetchMock).not.toHaveBeenCalled()
    expect(panel().querySelector("form")).toBeNull()
    expect(button(t.deliveryOpen).getAttribute("aria-expanded")).toBe("false")
    await click(t.deliveryOpen)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(panel().textContent).toContain(t.deliveryEmpty)
    await click(t.deliveryNew)
    expect(panel().querySelector<HTMLTextAreaElement>("#attendance-delivery-recipients")!.value).toBe("")
    expect(panel().querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(mutations()).toHaveLength(0)
    capture("ru", "-empty")
  })

  it.each(["en", "ru", "az"])("renders the editor, schedule and all receipt states in %s", async locale => {
    schedules = [exampleSchedule()]; receipts = exampleReceipts()
    await render(locale)
    const t = messages(locale).mtmAttendance
    await click(t.deliveryOpen); await click(t.deliveryEdit)
    for (const key of ["deliveryTitle", "deliveryRecipientsHint", "deliveryRolling", "deliveryHistoryHint", "deliverySent", "deliveryUnknownHint", "deliveryPending", "deliverySending", "deliveryCancelled", "deliveryFailed"]) expect(panel().textContent).toContain(t[key])
    expect(panel().textContent).toContain("Asia/Baku")
    expect(panel().querySelectorAll('input,select,textarea')).toHaveLength(6)
    expect(panel().textContent).not.toMatch(/mtmAttendance\.|PRIVATE_|latitude|longitude/)
    capture(locale)
  })

  it("creates a paused schedule with the exact report configuration and normalized recipients", async () => {
    await render("ru"); await newDraft("ru")
    await edit("recipients", "FIRST@EXAMPLE.TEST; second@example.test\nthird@example.test")
    await edit("frequency", "WEEKLY"); await edit("format", "pdf")
    expect(panel().querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    await submit()
    expect(mutations()).toHaveLength(1)
    const body = JSON.parse(String(mutations()[0][1]?.body))
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.input).toEqual({ name: "My attendance", config: currentConfig, frequency: "WEEKLY", format: "pdf", locale: "ru", recipients: ["first@example.test", "second@example.test", "third@example.test"], enabled: false })
    expect(panel().querySelectorAll('[data-testid="attendance-delivery-schedule"]')).toHaveLength(1)
    expect(panel().textContent).toContain(messages("ru").mtmAttendance.deliverySaved)
  })

  it("keeps saved employee/team filters on edit until current report replacement is explicit", async () => {
    schedules = [exampleSchedule()]
    const otherConfig: AttendanceViewConfig = { ...currentConfig, columns: ["employee", "late"], filters: { from: TODAY, to: TODAY, form: "ALL" } }
    await render("en", otherConfig); await click("Email schedules"); await click("Edit")
    await edit("name", "Renamed schedule"); await submit()
    expect(JSON.parse(String(mutations()[0][1]?.body))).toMatchObject({ version: "2026-10-13T10:00:00.000Z", input: { config: currentConfig } })
    await click("Use the current report"); await submit()
    expect(JSON.parse(String(mutations()[1][1]?.body))).toMatchObject({ version: "2026-10-13T11:00:01.000Z", input: { config: otherConfig } })
  })

  it("allows monthly grids only on a monthly schedule", async () => {
    const month: AttendanceViewConfig = { ...currentConfig, mode: "MONTH", columns: ["employee", "days", "worked"], filters: { ...currentConfig.filters, from: "2026-10-01", to: "2026-10-31" } }
    await render("en", month); await newDraft()
    const frequency = panel().querySelector<HTMLSelectElement>("#attendance-delivery-frequency")!
    expect(frequency.value).toBe("MONTHLY")
    expect(Array.from(frequency.options).map(option => option.value)).toEqual(["MONTHLY"])
    await submit()
    expect(schedules[0].frequency).toBe("MONTHLY")
    expect(schedules[0].config).toEqual(month)
  })

  it("pauses with the current version and requires an explicit click to delete", async () => {
    schedules = [exampleSchedule()]; receipts = exampleReceipts()
    await render(); await click("Email schedules"); await click("Pause")
    expect(JSON.parse(String(mutations()[0][1]?.body))).toMatchObject({ version: "2026-10-13T10:00:00.000Z", input: { enabled: false, config: currentConfig } })
    expect(receipts.some(item => item.status === "PENDING")).toBe(false)
    await click("Delete")
    expect(mutations()).toHaveLength(1)
    await click("Cancel"); expect(mutations()).toHaveLength(1)
    await click("Delete"); await click("Confirm deletion")
    expect(mutations()[1][1]?.method).toBe("DELETE")
    expect(JSON.parse(String(mutations()[1][1]?.body))).toEqual({ version: "2026-10-13T11:00:01.000Z" })
    expect(schedules).toHaveLength(0)
    expect(panel().querySelectorAll('[data-testid="attendance-delivery-receipt"]')).toHaveLength(6)
    expect(panel().textContent).toContain("Deleted schedule")
  })

  it.each(["invalid", "duplicate", "too-many"])("rejects %s recipients before writing", async kind => {
    await render(); await newDraft()
    await edit("recipients", kind === "invalid" ? "not-an-email" : kind === "duplicate" ? "first@example.test,FIRST@example.test" : Array.from({ length: 11 }, (_, index) => `person${index}@example.test`).join(","))
    await submit()
    expect(mutations()).toHaveLength(0)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.deliveryInvalid)
  })

  it("requires a refresh after an unknown create and reuses the request id on retry", async () => {
    let loseResponse = true
    fetchMock.mockImplementation(async (url, options) => {
      const result = await server(url, options)
      if (options?.method === "POST" && loseResponse) { loseResponse = false; throw new Error("Response lost after commit") }
      return result
    })
    await render(); await newDraft(); await submit()
    expect(button("Save schedule").matches(":disabled")).toBe(true)
    await submit(); expect(mutations()).toHaveLength(1)
    await click("Refresh schedules"); await submit()
    const payloads = mutations().map(([, options]) => JSON.parse(String(options?.body)))
    expect(payloads[1].requestId).toBe(payloads[0].requestId)
    expect(schedules).toHaveLength(1)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.deliverySaved)
  })

  it("refreshes a stale schedule before editing again with the new version", async () => {
    schedules = [exampleSchedule()]
    await render(); await click("Email schedules"); await click("Edit")
    schedules[0] = { ...schedules[0], name: "Changed in another tab", version: "2026-10-13T12:00:00.000Z" }
    await edit("name", "My update"); await submit()
    expect(panel().textContent).toContain(messages("en").mtmAttendance.deliveryChanged)
    expect(button("Save schedule").matches(":disabled")).toBe(true)
    await click("Refresh schedules")
    expect(panel().querySelector<HTMLInputElement>("#attendance-delivery-name")!.value).toBe("Changed in another tab")
    await submit()
    expect(JSON.parse(String(mutations()[1][1]?.body)).version).toBe("2026-10-13T12:00:00.000Z")
  })

  it.each([401, 403, 404])("clears recipients, drafts and history after write denial %s", async status => {
    schedules = [exampleSchedule()]; receipts = exampleReceipts()
    fetchMock.mockImplementation(async (url, options) => options?.method === "PATCH" ? response(null, status) : server(url, options))
    await render(); await click("Email schedules"); await click("Edit"); await submit()
    expect(accessLost).toHaveBeenCalledTimes(1)
    expect(panel().textContent).not.toMatch(/Weekly attendance|manager@example|reviewer1@example|PRIVATE_/)
    expect(panel().querySelector("form")).toBeNull()
    expect(panel().textContent).toContain(messages("en").mtmAttendance.deliveryAccessUnavailable)
  })

  it("aborts a write on locale change and keeps it locked until an explicit refresh", async () => {
    fetchMock.mockImplementation(async (url, options) => options?.method === "POST" ? new Promise<Response>((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    }) : server(url, options))
    await render(); await newDraft(); await submit()
    const pendingWrite = mutations()[0]
    await render("ru")
    expect(pendingWrite[1]?.signal?.aborted).toBe(true)
    expect(panel().textContent).not.toContain(messages("ru").mtmAttendance.deliverySaving)
    expect(panel().textContent).toContain(messages("ru").mtmAttendance.deliveryUnconfirmed)
    expect(button(messages("ru").mtmAttendance.deliverySave).matches(":disabled")).toBe(true)
    await submit(); expect(mutations()).toHaveLength(1)
    await click(messages("ru").mtmAttendance.deliveryReload)
    expect(button(messages("ru").mtmAttendance.deliverySave).matches(":disabled")).toBe(false)
  })

  it("does not restore private data from an older request after access is denied", async () => {
    schedules = [exampleSchedule()]; receipts = exampleReceipts()
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done })).mockResolvedValueOnce(response(null, 403))
    await render(); await click("Email schedules")
    const signal = fetchMock.mock.calls[0][1]?.signal
    await render("ru")
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(response({ timezone: "Asia/Baku", schedules, receipts })))
    expect(panel().textContent).not.toContain("manager@example.test")
    expect(panel().textContent).toContain(messages("ru").mtmAttendance.deliveryAccessUnavailable)
  })

  it("stops writes and clears drafts when the containing report loses access", async () => {
    schedules = [exampleSchedule()]; receipts = exampleReceipts()
    await render(); await click("Email schedules"); await click("Edit")
    await render("en", null, true)
    expect(panel().querySelector("form")).toBeNull()
    expect(panel().textContent).not.toMatch(/manager@example|Weekly attendance|reviewer/)
    expect(mutations()).toHaveLength(0)
  })

  it("shows the ten-schedule limit and pages the bounded receipt history", async () => {
    schedules = Array.from({ length: 10 }, (_, index) => ({ ...exampleSchedule(), id: `schedule-${index}` }))
    receipts = Array.from({ length: 23 }, (_, index) => ({ ...exampleReceipts()[0], id: `receipt-${index}` }))
    await render(); await click("Email schedules")
    expect(button("New schedule").disabled).toBe(true)
    expect(panel().textContent).toContain(messages("en").mtmAttendance.deliveryLimit)
    expect(panel().querySelectorAll('[data-testid="attendance-delivery-receipt"]')).toHaveLength(10)
    await click("Show more")
    expect(panel().querySelectorAll('[data-testid="attendance-delivery-receipt"]')).toHaveLength(20)
    await click("Show more")
    expect(panel().querySelectorAll('[data-testid="attendance-delivery-receipt"]')).toHaveLength(23)
    expect(panel().textContent).toContain("Showing 23 of 23 recent attempts")
  })

  it("uses the opened personal report configuration and clears the workspace on schedule denial", async () => {
    const savedView = { id: "view-a", name: "Private attendance view", config: currentConfig, version: "2026-10-13T10:00:00.000Z" }
    let deny = false
    fetchMock.mockImplementation(async (url, options) => {
      const parsed = new URL(String(url), "https://attendance.test")
      if (parsed.pathname.includes("/deliveries")) return deny ? response(null, 403) : server(url, options)
      if (parsed.pathname.endsWith("/rules")) return response({ today: TODAY })
      if (parsed.pathname.endsWith("/views")) return response([savedView])
      return response(buildMtmAttendanceReport({ employees: [{ id: "agent-a", name: "Aysel Aliyeva", teamId: "north", teamName: "North" }], workdays: [], calendar: [], rules: [], from: parsed.searchParams.get("from")!, to: parsed.searchParams.get("to")!, now: `${TODAY}T19:00:00+04:00` }))
    })
    await render("en", currentConfig, false, true)
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === "Open")!.click())
    await newDraft(); await submit()
    expect(schedules[0].config).toEqual(currentConfig)
    deny = true
    await click("Refresh schedules")
    expect(container.textContent).not.toMatch(/Private attendance view|Aysel Aliyeva|first@example/)
    expect(container.textContent).toContain(messages("en").mtmAttendance.reportAccessUnavailable)
  })
})

describe("daily HR summary preset", () => {
  it.each(["ru", "az", "en"])("keeps %s recipients empty and delivery off until explicitly configured", async locale => {
    await render(locale)
    const t = messages(locale).mtmAttendance
    await click(t.deliveryOpen); await click(t.deliveryDailySummary)
    expect((panel().querySelector("#attendance-delivery-recipients") as HTMLTextAreaElement).value).toBe("")
    expect((panel().querySelector("#attendance-delivery-frequency") as HTMLSelectElement).value).toBe("DAILY")
    expect((panel().querySelector("#attendance-delivery-format") as HTMLSelectElement).value).toBe("xlsx")
    expect(mutations()).toEqual([])
    capture(locale, "-daily-summary")
    await submit()
    expect(mutations()).toEqual([])
  })
})
