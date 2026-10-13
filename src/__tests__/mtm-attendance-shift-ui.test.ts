// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceShifts } from "@/components/mtm/attendance-shifts"
import type { AttendanceShiftDirectory } from "@/lib/mtm/attendance-shift-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const texts = messages.ru.mtmAttendance
let root: Root, host: HTMLDivElement, directory: AttendanceShiftDirectory
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status })
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  directory = { today: "2026-10-13", timezone: "Asia/Baku", revisionId: null, canManage: true,
    rosters: [{ teamId: null, name: null, count: 2, hash: "a".repeat(64) }],
    plans: [{ id: "fictional-plan", version: 1, createdAt: "2026-10-13T10:00:00Z", teamId: "fictional-team", teamName: "Demo team", memberCount: 2,
      value: { from: "2026-11-01", to: "2026-11-28", timezone: "Asia/Baku", attribution: "END_DAY", preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: null,
        cycle: [{ kind: "WORK", startTime: "22:00", endTime: "06:00", nextDay: true, lunchMinutes: 60, lateGraceMinutes: 10 }, { kind: "OFF" }] } }] }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async () => response(directory))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "ru") {
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceShifts) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)! }
async function fill(label: string, value: string) {
  const element = [...host.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")
  if (!element) throw new Error(`Missing fixture input: ${label}`)
  const type = element.tagName === "SELECT" ? HTMLSelectElement : element.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(type.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })) })
}
async function edit() {
  await act(async () => button(texts.shiftCreate).click())
  await fill(texts.shiftReason, "Fictional planned cycle")
  return host.querySelector("form")!
}
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
describe("shift publication UI", () => {
  it.each(["ru", "az", "en"])("renders actual %s cycle and leaves unconfirmed rules empty", async locale => {
    await render(locale)
    const text = messages[locale].mtmAttendance
    expect(host.textContent).toContain(text.shiftNextDay); expect(host.textContent).not.toContain("mtmAttendance.")
    await act(async () => button(text.shiftCreate).click())
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].slice(-2).map(input => input.value)).toEqual(["", ""])
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `attendance-shifts-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><div style="max-width:1250px;margin:auto;padding:24px">${host.innerHTML}</div></body></html>`) }
  })
  it("keeps read-only HR out of publishing", async () => {
    directory.canManage = false; await render()
    expect(button(texts.shiftCreate)).toBeUndefined(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain("Demo team")
  })
  it("freezes an unknown publication and retries the exact same UUID and roster", async () => {
    fetchMock.mockImplementation(async (_url, options) => { if (options?.method === "POST") throw new Error("reply lost"); return response(directory) })
    await render(); await submit(await edit())
    const calls = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
    expect(calls()).toHaveLength(1); expect(host.textContent).toContain(texts.shiftUnknown)
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true)
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')!.disabled).toBe(true)
    await act(async () => button(texts.shiftRetry).click())
    expect(calls()).toHaveLength(2); expect(calls()[1][1]?.body).toBe(calls()[0][1]?.body)
    expect(JSON.parse(String(calls()[0][1]?.body))).toMatchObject({ expectedRosterHash: "a".repeat(64), expectedRevisionId: null, value: { preHolidayMinutes: null, overtimeThresholdMinutes: null } })
  })
  it("clears all private data when access is revoked during publication", async () => {
    await render(); const form = await edit(); fetchMock.mockResolvedValue(response(null, 403)); await submit(form)
    expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain("Demo team"); expect(host.textContent).not.toContain("Fictional planned cycle")
  })
  it("blocks a shortening that has not been confirmed", async () => {
    await render(); const form = await edit(); await fill(texts.shiftShortening, "60"); await submit(form)
    expect(host.textContent).toContain(texts.shiftInvalid); expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false)
  })
  it("refreshes membership after a definitive roster conflict before another publication", async () => {
    await render(); const form = await edit()
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? new Response(JSON.stringify({ code: "MTM_ATTENDANCE_SHIFT_ROSTER_CHANGED" }), { status: 409 }) : response({ ...directory, rosters: [{ ...directory.rosters[0], hash: "b".repeat(64) }] }))
    await submit(form); expect(host.textContent).toContain(texts.shiftChanged); expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false)
    await submit(host.querySelector("form")!)
    const calls = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
    expect(JSON.parse(String(calls[1][1]?.body)).expectedRosterHash).toBe("b".repeat(64))
  })
})
