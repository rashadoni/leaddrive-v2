// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest"
import QRCode from "qrcode"
import { MtmAttendanceQrDisplay } from "@/components/mtm/attendance-qr-display"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const branch = { id: "10000000-0000-4000-8000-000000000001", name: "Demo branch 01" }, endpoint = "/api/v1/mtm/attendance/branch-qr"
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status })
let root: Root, host: HTMLDivElement, dataUrl: string
let directory = { enabled: true, canConfigure: true, branches: [branch] }
const fetchMock = vi.fn<typeof fetch>()
beforeAll(async () => { dataUrl = await QRCode.toDataURL("FICTIONAL-UI-QR-NOT-VALID-FOR-ATTENDANCE", { width: 480, margin: 4 }) })
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  directory = { enabled: true, canConfigure: true, branches: [branch] }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async (_url, opts) => response(opts?.method === "POST" ? { branch, dataUrl, serverNow: "2026-10-13T06:00:00Z", expiresAt: "2026-10-13T06:01:00Z" } : directory))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "ru") {
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceQrDisplay) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
const image = () => host.querySelector("img")
describe("branch QR display", () => {
  it.each(["ru", "az", "en"])("renders real localized component in %s", async locale => {
    await render(locale)
    expect(image()?.getAttribute("src")).toBe(dataUrl); expect(host.textContent).toContain(branch.name); expect(host.textContent).not.toContain("mtmAttendance.")
    const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `attendance-qr-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><div style="max-width:1250px;margin:auto;padding:24px">${host.innerHTML}</div></body></html>`) }
  })
  it("does not issue or display a code while the rule is off", async () => {
    directory.enabled = false; await render()
    expect(image()).toBeNull(); expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(false)
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
  })
  it("hides expired code even when renewing fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] })
    await render(); expect(image()).not.toBeNull()
    fetchMock.mockRejectedValue(new Error("offline"))
    await act(async () => { vi.advanceTimersByTime(61000) })
    expect(image()).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
  it("clears the branch and code when fresh authorization is refused", async () => {
    fetchMock.mockImplementation(async (_url, opts) => opts?.method === "POST" ? response(null, 403) : response(directory))
    await render(); expect(image()).toBeNull(); expect(host.textContent).not.toContain(branch.name)
    expect(host.querySelector("select")).toBeNull()
  })
  it("only changes the QR rule and then rereads its authoritative value", async () => {
    directory.enabled = false
    fetchMock.mockImplementation(async (_url, opts) => { if (opts?.method === "PUT") { directory.enabled = true; return response({}) }; return response(opts?.method === "POST" ? { branch, dataUrl, serverNow: "2026-10-13T06:00:00Z", expiresAt: "2026-10-13T06:01:00Z" } : directory) })
    await render(); await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")?.[1]?.body))).toEqual({ attendanceBranchQrEnabled: true })
    expect(image()).not.toBeNull()
  })
  it("does not grant a manager the admin setting", async () => {
    directory.canConfigure = false; await render()
    expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true); expect(image()).not.toBeNull()
  })
  it("hides codes when the tab is no longer visible and reloads on return", async () => {
    await render(); const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(image()).toBeNull()
    visibility.mockReturnValue("visible"); await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    expect(image()).not.toBeNull(); expect(fetchMock.mock.calls.filter(([url, opts]) => url === endpoint && !opts?.method).length).toBe(2)
  })
})
