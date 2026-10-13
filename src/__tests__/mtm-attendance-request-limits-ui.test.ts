// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceRequestLimits } from "@/components/mtm/attendance-request-limits"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const version = "2026-10-13T12:00:00.000Z"
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_INTERNAL_ERROR" }), { status })
const defaults = { monthlyMinutes: 480, monthlyRequests: 3, version: null, canManage: true }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const fetchMock = vi.fn<typeof fetch>(), accessLost = vi.fn()
let container: HTMLDivElement, root: Root
let language = "en"
async function render(locale = language, canManage = true, accessUnavailable = false) {
  language = locale
  const props = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceRequestLimits, { canManage, onAccessLost: accessLost, accessUnavailable }) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
const text = (key: string) => messages(language).mtmAttendance[key]
const button = (key: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === text(key))!
const field = (name: string) => container.querySelector<HTMLInputElement>(`#attendance-limits-${name}`)!
async function click(key: string) { await act(async () => button(key).click()) }
async function edit(name: string, value: string) {
  await act(async () => { const input = field(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")
beforeEach(() => {
  language = "en"; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  accessLost.mockReset(); fetchMock.mockReset(); fetchMock.mockImplementation(async () => response(defaults)); vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function capture(locale: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `attendance-request-limits-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1300px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
}
describe("administrator hourly limit editor", () => {
  it.each(["ru", "az", "en"])("starts collapsed and renders precise default/forward semantics in %s", async (locale) => {
    await render(locale)
    expect(container.querySelector("form")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled()
    await click("limitsOpen")
    expect(field("hours").value).toBe("8"); expect(field("count").value).toBe("3")
    for (const key of ["limitsIntro", "limitsScope", "limitsReservations", "limitsDefault", "limitsForward"]) expect(container.textContent).toContain(text(key))
    expect(container.querySelector('label[for="attendance-limits-hours"]')?.textContent).toBe(text("limitsHours"))
    expect(field("hours").step).toBe("0.5"); expect(field("count").step).toBe("1")
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_/)
    capture(locale)
  })
  it("does not render or read settings without the management gate", async () => {
    await render("en", false)
    expect(container.textContent).toBe(""); expect(fetchMock).not.toHaveBeenCalled()
    await render("en", true, true)
    expect(container.textContent).toBe(""); expect(fetchMock).not.toHaveBeenCalled()
  })
  it("saves half-hours as exact integer minutes and pins the loaded version", async () => {
    await render(); await click("limitsOpen")
    fetchMock.mockResolvedValueOnce(response({ monthlyMinutes: 510, monthlyRequests: 5, version }))
    await edit("hours", "8.5"); await edit("count", "5"); await submit()
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ monthlyMinutes: 510, monthlyRequests: 5, version: null })
    expect(container.textContent).toContain(text("limitsSaved"))
    fetchMock.mockResolvedValueOnce(response({ monthlyMinutes: 540, monthlyRequests: 5, version: "2026-10-13T12:00:00.001Z" }))
    await edit("hours", "9"); await submit()
    expect(JSON.parse(String(writes()[1][1]?.body))).toHaveProperty("version", version)
  })
  it("explains zero as forbidden and rejects malformed numbers before writing", async () => {
    await render(); await click("limitsOpen")
    await edit("hours", "0")
    expect(container.textContent).toContain(text("limitsZero"))
    fetchMock.mockResolvedValueOnce(response({ monthlyMinutes: 0, monthlyRequests: 3, version }))
    await submit()
    expect(JSON.parse(String(writes()[0][1]?.body))).toHaveProperty("monthlyMinutes", 0)
    await edit("hours", "8.2"); await submit()
    expect(container.textContent).toContain(text("limitsInvalid")); expect(writes()).toHaveLength(1)
    await edit("hours", "8"); await edit("count", "1.5"); await submit()
    expect(writes()).toHaveLength(1)
  })
  it.each([401, 403, 404])("clears a loaded form after a %s write denial", async (status) => {
    await render(); await click("limitsOpen")
    fetchMock.mockResolvedValueOnce(response(null, status))
    await submit()
    expect(container.querySelector("form")).toBeNull(); expect(accessLost).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(text("limitsAccessUnavailable"))
    expect(container.textContent).not.toContain("PRIVATE_INTERNAL_ERROR")
  })
  it("blocks writes on changed version until an explicit refresh supplies current values", async () => {
    await render(); await click("limitsOpen")
    fetchMock.mockResolvedValueOnce(response(null, 409, "MTM_ATTENDANCE_REQUEST_LIMITS_CHANGED"))
    await edit("hours", "9"); await submit()
    expect(button("limitsSave").disabled).toBe(true); expect(container.textContent).toContain(text("limitsChanged"))
    await submit(); expect(writes()).toHaveLength(1)
    fetchMock.mockResolvedValueOnce(response({ ...defaults, monthlyMinutes: 600, version }))
    await click("limitsReload")
    expect(field("hours").value).toBe("10"); expect(button("limitsSave").disabled).toBe(false)
  })
  it("keeps an interrupted mutation uncertain across locale change until deliberate reload", async () => {
    await render(); await click("limitsOpen")
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    await edit("hours", "9"); await submit()
    const signal = writes()[0][1]?.signal
    fetchMock.mockImplementation(async () => response({ ...defaults, monthlyMinutes: 540, version }))
    await render("ru")
    expect(signal?.aborted).toBe(true)
    expect(button("limitsSave").disabled).toBe(true); expect(button("limitsReload").disabled).toBe(false)
    expect(container.textContent).toContain(text("limitsUnconfirmed"))
    await act(async () => finish(response({ monthlyMinutes: 540, monthlyRequests: 3, version })))
    expect(container.textContent).not.toContain(text("limitsSaved"))
    await click("limitsReload")
    expect(button("limitsSave").disabled).toBe(false)
    expect(writes()).toHaveLength(1)
  })
  it("does not silently use defaults when loading fails or server management is false", async () => {
    fetchMock.mockResolvedValueOnce(response(null, 409, "MTM_ATTENDANCE_REQUEST_LIMITS_INVALID_STORED"))
    await render(); await click("limitsOpen")
    expect(container.textContent).toContain(text("limitsInvalidStored")); expect(container.querySelector("form")).toBeNull()
    fetchMock.mockResolvedValueOnce(response({ ...defaults, canManage: false }))
    await click("limitsReload")
    expect(accessLost).toHaveBeenCalledTimes(1); expect(container.querySelector("form")).toBeNull()
  })
  it("aborts the pending load on unmount", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    await render(); await click("limitsOpen")
    const signal = fetchMock.mock.calls[0][1]?.signal
    await act(async () => root.render(null))
    expect(signal?.aborted).toBe(true)
  })
})
