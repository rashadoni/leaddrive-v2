// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AttendanceBranchScreenKiosk } from "@/components/mtm/attendance-branch-screen-kiosk"
import { evaluateBranchScreenPlace, parseBranchScreenFix } from "@/lib/mtm/attendance-branch-screen-security"
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
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  delete (navigator as { geolocation?: unknown }).geolocation
  expect("geolocation" in navigator).toBe(false)
})
// The browser's position: a fix, or a refusal, delivered asynchronously as the browser does.
function browserAt(where: { latitude: number; longitude: number; accuracy: number } | "denied") {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
    setTimeout(() => where === "denied"
      ? fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "denied" } as GeolocationPositionError)
      : ok({ coords: where, timestamp: Date.now() } as unknown as GeolocationPosition), 0)
  })
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } })
  return getCurrentPosition
}
// The server's own rule applied to what the screen sent.
const BRANCH = { latitude: 40.3777, longitude: 49.8920, radiusMeters: 100 }
function serverJudgesPlace() {
  fetchMock.mockImplementation(async (_url, init) => {
    const place = evaluateBranchScreenPlace(parseBranchScreenFix(JSON.parse(String(init?.body ?? "{}"))), BRANCH)
    return json({ success: true, data: place.state === "AT_BRANCH" ? showing()
      : { state: "NOT_AT_BRANCH", reason: place.state, distanceMeters: place.distanceMeters, organizationName: "Demo company", branch: { id: "b", name: "Demo branch" } } })
  })
}
async function render(locale = "az") {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(AttendanceBranchScreenKiosk) })))
  for (let i = 0; i < 16; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
}
/** Lets the page's own timers and the position callback run until the screen settles on what is checked. */
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)) })
}
function type(value: string) {
  const input = host.querySelector<HTMLInputElement>("#branch-screen-code")!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }))
}
async function submit() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  for (let i = 0; i < 16; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)) })
}
describe("the branch screen", () => {
  it.each(["az", "ru", "en"])("asks an unpaired tablet for its code, in %s, and not for its position", async locale => {
    const asked = browserAt({ latitude: 40.3777, longitude: 49.8920, accuracy: 20 })
    await render(locale)
    expect(asked).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="branch-screen-pair"]')).not.toBeNull(); expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).not.toContain("attendanceBranchScreen.")
  })
  it("pairs with the typed code and then shows its branch's code with a countdown", async () => {
    await render(); type("4f7k 92qd"); await submit(); await until(() => !!host.querySelector("img"))
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
  // Owner, 2026-10-30: a laptop paired at home showed the branch's code at home.
  it("shows no code on a screen standing away from its branch, and says how far", async () => {
    browserAt({ latitude: 40.4077, longitude: 49.8920, accuracy: 20 }); serverJudgesPlace(); await render("ru")
    await until(() => !!host.querySelector('[data-testid="branch-screen-away"]'))
    expect(host.querySelector("img")).toBeNull()
    const away = host.querySelector('[data-testid="branch-screen-away"]')!.textContent!
    expect(away).toContain(messages.ru.attendanceBranchScreen.notAtBranchTitle)
    expect(away).toMatch(/3,3 км/)
    expect(host.querySelector('[data-testid="branch-screen-branch"]')!.textContent).toBe("Demo branch")
  })
  it("asks for the position and shows the code once the screen is at its branch", async () => {
    browserAt({ latitude: 40.3778, longitude: 49.8921, accuracy: 25 }); serverJudgesPlace(); await render()
    await until(() => !!host.querySelector("img"))
    expect(host.querySelector("img")?.getAttribute("src")).toBe(dataUrl)
    const sent = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(sent.fix).toMatchObject({ latitude: 40.3778, longitude: 49.8921, accuracy: 25 })
  })
  it("asks for a fresh position before every next code, so a still tablet keeps its code", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] })
    const asked = browserAt({ latitude: 40.3778, longitude: 49.8921, accuracy: 25 }); serverJudgesPlace(); await render()
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(host.querySelector("img")).not.toBeNull()
    const before = asked.mock.calls.length
    for (let minute = 0; minute < 4; minute++) await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(asked.mock.calls.length).toBeGreaterThanOrEqual(before + 4)
    expect(host.querySelector("img")).not.toBeNull()
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).fix.ageMs).toBeLessThan(60_000)
  })
  it("tells a screen refused the location how to show the code", async () => {
    browserAt("denied"); serverJudgesPlace(); await render()
    await until(() => !!host.querySelector('[data-testid="branch-screen-away"]'))
    expect(host.querySelector("img")).toBeNull(); expect(host.textContent).toContain(az.locationDenied)
  })
  it("says the QR rule is off instead of showing a code", async () => {
    qrAnswer = { state: "QR_OFF", organizationName: "Demo company", branch: { id: "b", name: "Demo branch" } }; await render()
    expect(host.querySelector("img")).toBeNull(); expect(host.textContent).toContain(az.qrOff)
  })
})
