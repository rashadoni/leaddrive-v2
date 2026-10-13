// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceInstallations } from "@/components/mtm/attendance-installations"
import type { AttendanceInstallationQueue } from "@/lib/mtm/attendance-installation-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const ID = "10000000-0000-4000-8000-000000000001"
const fixture = (): AttendanceInstallationQueue => ({ required: false, timezone: "Asia/Baku", canConfigure: true, nextCursor: null, items: [{ id: ID, requestId: ID,
  employeeId: "fictional-employee", employeeName: "Demo employee 01", teamId: "fictional-team", teamName: "Demo team", installationLabel: "…7b12",
  state: "PENDING", submittedAt: "2026-10-13T06:00:00Z", decision: null, revocation: null, canDecide: true, canRevoke: false }] })
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data, code: "PRIVATE_INTERNAL_TRACE" }), { status })
const fetchMock = vi.fn<typeof fetch>()
let root: Root, container: HTMLDivElement, queue: AttendanceInstallationQueue, locale: "ru" | "az" | "en"
const t = (key: string) => createTranslator({ locale, messages: messages[locale], namespace: "mtmAttendance" })(key)
const buttons = (key: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent === t(key))
const click = async (key: string, index = 0) => { await act(async () => buttons(key)[index].click()) }
async function render(language = locale) { locale = language; const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceInstallations) }; await act(async () => root.render(createElement(NextIntlClientProvider, props))) }
async function edit(value: string) { await act(async () => { const input = container.querySelector<HTMLTextAreaElement>("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) }) }
const writes = () => fetchMock.mock.calls.filter(([, opts]) => opts?.method === "POST")
const submit = async () => { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR; if (!dir) return
  mkdirSync(dir, { recursive: true })
  const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("select").forEach((field, i) => [...clone.querySelectorAll("select")[i].options].forEach(option => { if (option.value === field.value) option.setAttribute("selected", ""); else option.removeAttribute("selected") }))
  container.querySelectorAll("textarea").forEach((field, i) => clone.querySelectorAll("textarea")[i].textContent = field.value)
  writeFileSync(join(dir, `attendance-installations-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><div style="max-width:1400px;margin:auto;padding:24px">${clone.innerHTML}</div></body></html>`)
}
beforeEach(() => {
  locale = "ru"; queue = fixture(); container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async (_url, opts) => opts?.method === "POST" ? response({ id: ID }) : response(queue))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
describe("installation queue", () => {
  it.each(["ru", "az", "en"] as const)("renders approval, history and localized defaults in %s", async language => {
    queue.items.push({ ...queue.items[0], id: "second", employeeName: "Demo employee 02", state: "APPROVED", canDecide: false, canRevoke: true, decision: { action: "APPROVE", at: "2026-10-13T07:00:00Z", reason: "Demo: installation reviewed" } })
    await render(language)
    await act(async () => { const select = container.querySelector("select")!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ALL"); select.dispatchEvent(new Event("change", { bubbles: true })) })
    await click("installationApprove")
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
    expect(buttons("installationSave")[0].disabled).toBe(true)
    expect(container.querySelectorAll('[data-testid="installation-row"]')).toHaveLength(2)
    expect(container.textContent).toContain(t("installationRuleHint")); expect(container.textContent).not.toContain("mtmAttendance."); capture()
  })
  it("freezes an unknown write and retries the identical decision body", async () => {
    fetchMock.mockImplementation(async (_url, opts) => {
      if (opts?.method === "POST") { if (writes().length === 1) throw new Error("reply lost"); queue.items = []; return response({ id: ID, idempotent: true }) }
      return response(queue)
    })
    await render(); await click("installationApprove"); await edit("Demo reviewed installation"); await submit()
    expect(container.textContent).toContain(t("installationUnknown")); expect(container.querySelector<HTMLTextAreaElement>("textarea")!.readOnly).toBe(true)
    expect(buttons("installationRefresh")[0].disabled).toBe(true)
    await click("installationRetry"); expect(writes()).toHaveLength(2); expect(writes()[0][1]?.body).toBe(writes()[1][1]?.body)
    expect(container.textContent).toContain(t("installationSaved")); expect(container.textContent).toContain(t("installationEmpty"))
  })
  it.each([401, 403, 404])("clears employee and reason after access denial %s", async status => {
    fetchMock.mockImplementation(async (_url, opts) => opts?.method === "POST" ? response(null, status) : response(queue))
    await render(); await click("installationReject"); await edit("Demo private reason"); await submit()
    expect(container.textContent).toContain(t("reportAccessUnavailable")); expect(container.textContent).not.toMatch(/Demo employee|Demo team|Demo private|PRIVATE_INTERNAL/)
    expect(container.querySelector("textarea")).toBeNull()
  })
  it("offers no decision or setting write to a read-only reviewer", async () => {
    queue.canConfigure = false; queue.items[0].canDecide = false
    await render(); expect(buttons("installationApprove")).toHaveLength(0); expect(buttons("installationReject")).toHaveLength(0)
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
  })
  it("saves the single setting only and refreshes its authoritative value", async () => {
    fetchMock.mockImplementation(async (_url, opts) => { if (opts?.method === "PUT") { queue.required = true; return response({}) }; return response(queue) })
    await render(); await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
    const write = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")!
    expect(JSON.parse(String(write[1]?.body))).toEqual({ attendanceRequireInstallationApproval: true })
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
  })
  it("does not label an unread setting as off", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); await render(); expect(container.querySelector('[role="switch"]')).toBeNull()
    const signal = fetchMock.mock.calls[0][1]?.signal; await act(async () => root.unmount()); expect(signal?.aborted).toBe(true); root = createRoot(container)
  })
  it("asks for the next server page rather than silently truncating requests", async () => {
    queue.nextCursor = ID; await render(); await click("installationMore")
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(`cursor=${ID}`)
  })
})
