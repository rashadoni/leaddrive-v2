// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AttendanceBranchScreenKiosk } from "@/components/mtm/attendance-branch-screen-kiosk"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const az = messages.az.attendanceBranchScreen
const dataUrl = "data:image/png;base64,iVBORw0KGgo="
const showing = () => ({ state: "SHOWING", organizationName: "Demo company", branch: { id: "b", name: "Demo branch" }, dataUrl, serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let root: Root, host: HTMLDivElement, qrAnswer: unknown
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  qrAnswer = { state: "UNPAIRED" }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async url => {
    if (String(url).endsWith("/pair")) { qrAnswer = showing(); return json({ success: true, state: "PAIRED" }) }
    return json({ success: true, data: qrAnswer })
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "az") {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(AttendanceBranchScreenKiosk) })))
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
}
function type(value: string) {
  const input = host.querySelector<HTMLInputElement>("#branch-screen-code")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }))
}
async function submit() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
}
describe("the branch screen", () => {
  it.each(["az", "ru", "en"])("asks an unpaired tablet for its code, in %s", async locale => {
    await render(locale)
    expect(host.querySelector('[data-testid="branch-screen-pair"]')).not.toBeNull(); expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).not.toContain("attendanceBranchScreen.")
  })
  it("pairs with the typed code and then shows its branch's code with a countdown", async () => {
    await render(); type("4f7k 92qd"); await submit()
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/pair"))?.[1]?.body))).toEqual({ code: "4f7k 92qd" })
    expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)
    expect(host.querySelector('[data-testid="branch-screen-branch"]')!.textContent).toBe("Demo branch")
    expect(host.textContent).toContain("Demo company")
    expect(host.querySelector('[data-testid="branch-screen-countdown"]')!.textContent).toMatch(/\d/)
  })
  it("tells a refused code apart from too many tries", async () => {
    fetchMock.mockImplementation(async url => String(url).endsWith("/pair") ? json({ success: false, state: "CODE_REFUSED" }, 400) : json({ success: true, data: { state: "UNPAIRED" } }))
    await render(); type("ZZZZ-ZZZZ"); await submit()
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(az.pairRefused)
    fetchMock.mockImplementation(async url => String(url).endsWith("/pair") ? json({ success: false, state: "RATE_LIMITED" }, 429) : json({ success: true, data: { state: "UNPAIRED" } }))
    type("ZZZZ-ZZZZ"); await submit()
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(az.pairLimited)
  })
  it("takes a code past its minute off the screen when the next one does not come", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] })
    qrAnswer = showing(); await render()
    expect(host.querySelector("img")).not.toBeNull()
    fetchMock.mockRejectedValue(new Error("offline"))
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain(az.offline)
  })
  it("goes back to the pairing form when the screen is disconnected", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] })
    qrAnswer = showing(); await render()
    qrAnswer = { state: "UNPAIRED" }
    await act(async () => { await vi.advanceTimersByTimeAsync(56_000) })
    expect(host.querySelector("img")).toBeNull(); expect(host.querySelector('[data-testid="branch-screen-pair"]')).not.toBeNull()
  })
  it("says the QR rule is off instead of showing a code", async () => {
    qrAnswer = { state: "QR_OFF", organizationName: "Demo company", branch: { id: "b", name: "Demo branch" } }; await render()
    expect(host.querySelector("img")).toBeNull(); expect(host.textContent).toContain(az.qrOff)
  })
})
