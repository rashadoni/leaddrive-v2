// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceQrDisplay } from "@/components/mtm/attendance-qr-display"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const ru = messages.ru.mtmAttendance
const endpoint = "/api/v1/mtm/attendance/branch-screens"
const screened = { id: "10000000-0000-4000-8000-000000000001", name: "Demo branch 01", screens: [{ id: "20000000-0000-4000-8000-000000000001", pairedAt: "2026-10-29T06:00:00Z", lastSeenAt: new Date().toISOString(),
  place: { state: "AT_BRANCH", distanceMeters: 12, checkedAt: new Date().toISOString() } as { state: string; distanceMeters: number | null; checkedAt: string } | null }] }
const bare = { id: "10000000-0000-4000-8000-000000000002", name: "Demo branch 02", screens: [] as typeof screened.screens }
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status })
let root: Root, host: HTMLDivElement
let directory: { enabled: boolean; canConfigure: boolean; branches: typeof screened[] }
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  directory = { enabled: true, canConfigure: true, branches: [structuredClone(screened), structuredClone(bare)] }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async (url, opts) => {
    if (opts?.method === "POST" && String(url) === endpoint) return response({ branch: { id: bare.id, name: bare.name }, code: "4F7K-92QD", expiresAt: new Date(Date.now() + 600_000).toISOString() })
    if (opts?.method === "POST" && String(url).endsWith("/revoke")) { directory.branches[0].screens = []; return response({ revoked: true }) }
    return response(directory)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "ru") {
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceQrDisplay) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
  await act(async () => { await Promise.resolve() })
}
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text)
describe("branch screens in Personnel → Settings → QR", () => {
  it.each(["ru", "az", "en"])("renders the real localized page in %s, and never a code", async locale => {
    await render(locale)
    expect(host.textContent).toContain(screened.name); expect(host.textContent).toContain(bare.name)
    expect(host.textContent).not.toContain("mtmAttendance."); expect(host.querySelector("img")).toBeNull()
    const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `attendance-qr-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><div style="max-width:1250px;margin:auto;padding:24px">${host.innerHTML}</div></body></html>`) }
  })
  it("says which branch has no screen and so cannot be confirmed by QR", async () => {
    await render()
    const rows = [...host.querySelectorAll('[data-testid="attendance-qr-branch"]')]
    expect(rows[0].querySelector('[data-testid="attendance-qr-screen"]')!.textContent).toContain(ru.qrScreenOnline)
    expect(rows[1].querySelector('[data-testid="attendance-qr-branch-unscreened"]')!.textContent).toBe(ru.qrScreenNone)
  })
  // Owner, 2026-10-30: a laptop paired at home showed the branch's code at home.
  it("marks a screen that is away from its branch, or cannot say where it is", async () => {
    directory.branches[0].screens[0].place = { state: "AWAY", distanceMeters: 3300, checkedAt: new Date().toISOString() }
    await render()
    const screen = () => host.querySelector('[data-testid="attendance-qr-screen"]')!.textContent!
    expect(screen()).toContain("Не в филиале · 3,3 км")
    await act(async () => root.unmount()); root = createRoot(host)
    directory.branches[0].screens[0].place = { state: "NO_FIX", distanceMeters: null, checkedAt: new Date().toISOString() }
    await render()
    expect(screen()).toContain(ru.qrScreenNoFix); expect(screen()).not.toContain("Не в филиале")
  })
  it("gives a one-time code for the chosen branch and where to type it", async () => {
    await render()
    await act(async () => { [...host.querySelectorAll('[data-testid="attendance-qr-branch"]')][1].querySelector<HTMLButtonElement>("button")!.click() })
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url, opts]) => url === endpoint && opts?.method === "POST")?.[1]?.body))).toEqual({ branchId: bare.id })
    const panel = host.querySelector('[data-testid="attendance-qr-pairing"]')!
    expect(panel.querySelector('[data-testid="attendance-qr-pairing-code"]')!.textContent).toBe("4F7K-92QD")
    expect(panel.textContent).toContain("/screen")
  })
  it("notices the tablet that typed the code and closes the code", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    await render()
    await act(async () => { [...host.querySelectorAll('[data-testid="attendance-qr-branch"]')][1].querySelector<HTMLButtonElement>("button")!.click() })
    directory.branches[1].screens = [{ id: "20000000-0000-4000-8000-000000000002", pairedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), place: null }]
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(host.querySelector('[data-testid="attendance-qr-pairing"]')).toBeNull()
    expect(host.textContent).toContain(ru.qrScreenJustPaired)
  })
  it("disconnects a screen only after it is confirmed", async () => {
    await render()
    await act(async () => { button(ru.qrScreenRevoke)!.click() })
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/revoke"))).toBe(false)
    expect(host.textContent).toContain(ru.qrScreenRevokeConfirm)
    await act(async () => { button(ru.qrScreenRevokeYes)!.click() })
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/revoke"))?.[0]).toBe(`${endpoint}/${screened.screens[0].id}/revoke`)
    expect(host.querySelectorAll('[data-testid="attendance-qr-branch-unscreened"]')).toHaveLength(2)
  })
  it("shows a manager the screens and no button that would only be refused", async () => {
    directory.canConfigure = false; await render()
    expect(host.querySelector('[role="switch"]')).toBeNull()
    expect(button(ru.qrScreenPair)).toBeUndefined(); expect(button(ru.qrScreenRevoke)).toBeUndefined()
    expect(host.textContent).toContain(screened.name)
  })
  it("only changes the QR rule and then rereads its authoritative value", async () => {
    directory.enabled = false
    fetchMock.mockImplementation(async (_url, opts) => { if (opts?.method === "PUT") { directory.enabled = true; return response({}) }; return response(directory) })
    await render(); expect(host.querySelector('[data-testid="attendance-qr-screens"]')).toBeNull()
    expect(host.querySelector('[role="switch"]')!.textContent).toBe(ru.qrTurnOn)
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")?.[1]?.body))).toEqual({ attendanceBranchQrEnabled: true })
    expect(host.querySelector('[data-testid="attendance-qr-screens"]')).not.toBeNull()
  })
  it("sends to Branches when there is no branch", async () => {
    directory.branches = []; await render()
    const link = host.querySelector('[data-testid="attendance-qr-no-branches"] a')!
    expect(link.getAttribute("href")).toBe("/mtm/attendance/people?tab=branches")
    expect(link.textContent).toBe(ru.qrAddBranch)
  })
  it("shows nothing of the list when access is refused", async () => {
    fetchMock.mockImplementation(async () => response(null, 403))
    await render(); expect(host.textContent).not.toContain(screened.name)
  })
})
