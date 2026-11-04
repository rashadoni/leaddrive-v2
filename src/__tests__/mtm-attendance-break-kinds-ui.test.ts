// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceBreakKindsSettings } from "@/components/mtm/attendance-break-kinds-settings"
import { attendanceBreakKindTotals, attendanceBreakOverLimit } from "@/lib/mtm/attendance-break-kinds-names"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const ru = messages.ru.mtmAttendance
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status })
let root: Root, host: HTMLDivElement
let stored: { enabled: boolean; kinds: { id: string; name: string | null; limitMinutes: number | null }[]; canConfigure: boolean }
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  stored = { enabled: false, canConfigure: true, kinds: [{ id: "smoke", name: null, limitMinutes: 30 }, { id: "lunch", name: null, limitMinutes: 60 }, { id: "personal", name: null, limitMinutes: null }] }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async (_url, opts) => {
    if (opts?.method === "PUT") {
      const body = JSON.parse(String(opts.body))
      stored = { ...stored, enabled: body.enabled, kinds: body.kinds.map((kind: { id: string | null; name: string | null; limitMinutes: number | null }, index: number) => ({ ...kind, id: kind.id ?? `k-0000000${index}` })) }
      return response({ ...stored, changed: true })
    }
    return response(stored)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "ru") {
  const page = createElement(MtmAttendanceBreakKindsSettings)
  // eslint-disable-next-line react/no-children-prop -- the provider's props type requires `children`
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Baku", children: page })))
  await act(async () => { await Promise.resolve() })
}
const names = () => [...host.querySelectorAll<HTMLInputElement>('[data-testid="attendance-break-kind-name"]')]
const limits = () => [...host.querySelectorAll<HTMLInputElement>('[data-testid="attendance-break-kind-limit"]')]
const put = () => JSON.parse(String(fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")?.[1]?.body))
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("Personnel → Settings → Kinds of breaks", () => {
  it.each(["ru", "az", "en"])("names the built-in kinds in %s and never shows a raw key", async locale => {
    await render(locale)
    const m = messages[locale].mtmAttendance
    expect(names().map(input => input.value)).toEqual([m.breakKind_smoke, m.breakKind_lunch, m.breakKind_personal])
    expect(limits().map(input => input.value)).toEqual(["30", "60", ""])
    expect(host.textContent).not.toContain("mtmAttendance.")
  })
  it("turns the choice on, adds the company's own kind, and keeps an untouched built-in kind nameless", async () => {
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-switch"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kind-add"]')!.click())
    await act(async () => { type(names()[3], "Звонок домой"); type(limits()[3], "15") })
    await act(async () => { type(names()[1], "Обеденный перерыв") })
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-save"]')!.click())
    expect(put()).toEqual({ enabled: true, kinds: [
      { id: "smoke", name: null, limitMinutes: 30 }, { id: "lunch", name: "Обеденный перерыв", limitMinutes: 60 },
      { id: "personal", name: null, limitMinutes: null }, { id: null, name: "Звонок домой", limitMinutes: 15 }] })
    expect(host.textContent).toContain(ru.breakKindsSaved)
  })
  it("does not save a nameless kind or a limit out of range", async () => {
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kind-add"]')!.click())
    expect(host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-save"]')!.disabled).toBe(true)
    await act(async () => { type(names()[3], "Fictional"); type(limits()[0], "999") })
    expect(host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-save"]')!.disabled).toBe(true)
    await act(async () => { type(limits()[0], "45") })
    expect(host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-save"]')!.disabled).toBe(false)
  })
  it("shows a manager the kinds without anything that would only be refused", async () => {
    stored.canConfigure = false; await render()
    expect(host.querySelector('[data-testid="attendance-break-kinds-switch"]')).toBeNull()
    expect(host.querySelector('[data-testid="attendance-break-kinds-save"]')).toBeNull()
    expect(names().every(input => input.disabled)).toBe(true)
    expect(host.textContent).toContain(ru.breakKindsReadOnly)
  })
  it("says so when saving fails", async () => {
    fetchMock.mockImplementation(async (_url, opts) => opts?.method === "PUT" ? response(null, 400) : response(stored))
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="attendance-break-kinds-save"]')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(ru.breakKindsError)
  })
})

describe("totals of a day's breaks by kind", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 9, minute))
  it("matches a break to the PAUSE that opened it, counts an open one to now, and puts unlabeled last", () => {
    const pauses = [{ from: at(0), to: at(5) }, { from: at(10), to: at(40) }, { from: at(50), to: at(60) }, { from: at(70), to: null }]
    const labels = [{ at: at(10).toISOString(), kindId: "smoke", kindName: null, limitMinutes: 30 }, { at: at(50).toISOString(), kindId: "smoke", kindName: null, limitMinutes: 30 },
      { at: at(70).toISOString(), kindId: "lunch", kindName: "Nahar", limitMinutes: 60 }]
    const totals = attendanceBreakKindTotals(pauses, labels, at(80))
    expect(totals).toEqual([{ kindId: "smoke", kindName: null, count: 2, seconds: 2400, limitMinutes: 30 }, { kindId: "lunch", kindName: "Nahar", count: 1, seconds: 600, limitMinutes: 60 },
      { kindId: "", kindName: null, count: 1, seconds: 300, limitMinutes: null }])
    expect(totals.map(attendanceBreakOverLimit)).toEqual([true, false, false])
  })
  it("is not over a limit at exactly the limit", () => {
    expect(attendanceBreakOverLimit({ kindId: "smoke", kindName: null, count: 1, seconds: 1800, limitMinutes: 30 })).toBe(false)
    expect(attendanceBreakOverLimit({ kindId: "", kindName: null, count: 1, seconds: 99999, limitMinutes: 1 })).toBe(false)
  })
})
