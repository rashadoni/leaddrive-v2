// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceLeaveBalances } from "@/components/mtm/attendance-leave-balances"
import type { AttendanceLeaveDirectory } from "@/lib/mtm/attendance-leave-contract"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = Object.fromEntries(["ru", "az", "en"].map(lang => [lang, JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"))]))
const texts = messages.ru.mtmAttendance
let root: Root, host: HTMLDivElement, directory: AttendanceLeaveDirectory
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status })
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  directory = { year: 2026, usedThrough: "2026-10-13", today: "2026-10-13", canManage: true, hasMore: false, policy: null,
    rows: [{ employeeId: "fictional-employee", name: "Demo employee 01", teamName: "Demo team", profile: null, serviceYears: null, allowanceDays: null, usedDays: null, plannedDays: null, remainingDays: null, availableDays: null, state: "POLICY_MISSING" }] }
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async () => response(directory))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(locale = "ru") {
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceLeaveBalances) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)! }
async function fill(label: string, value: string, scope: ParentNode = host) {
  const element = [...scope.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")
  if (!element) throw new Error(`Missing fixture input: ${label}`)
  const type = element.tagName === "SELECT" ? HTMLSelectElement : element.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(type.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })) })
}
async function editProfile() {
  await act(async () => button(texts.leaveEdit).click())
  // The norms form above also has a "Category" field (prefilled basic leave), so stay inside the profile form.
  const form = host.querySelector<HTMLFormElement>('[data-testid="leave-profile"] form')!
  await fill(texts.leaveCategory, "Fictional category", form); await fill(texts.leaveServiceStart, "2020-01-01", form); await fill(texts.leaveOpening, "0", form)
  const reason = form.querySelector("textarea")!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Fictional approved input"); reason.dispatchEvent(new Event("input", { bubbles: true })) })
  return form
}
describe("leave balances use explicit client inputs", () => {
  it.each(["ru", "az", "en"])("renders actual %s empty-norm state with no invented allowance", async locale => {
    await render(locale)
    expect(host.textContent).toContain(messages[locale].mtmAttendance.leaveEmptyPolicy)
    expect(host.textContent).not.toContain("mtmAttendance.")
    expect(host.querySelector('input[type="checkbox"]')?.hasAttribute("checked")).toBe(false)
    const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (dir) {
      host.querySelectorAll("details").forEach(item => item.setAttribute("open", ""))
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `attendance-leave-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"></head><body><div style="max-width:1250px;margin:auto;padding:24px">${host.innerHTML}</div></body></html>`)
    }
  })
  it("keeps managers and HR readers out of policy/profile editing", async () => {
    directory.canManage = false; await render()
    expect(host.querySelector("form")).toBeNull(); expect(button(texts.leaveEdit)).toBeUndefined()
    expect(host.textContent).toContain(directory.rows[0].name)
  })
  it("preserves an unknown submission and retries exactly the same UUID/body", async () => {
    fetchMock.mockImplementation(async (_url, options) => { if (options?.method === "POST") throw new Error("reply lost"); return response(directory) })
    await render(); const form = await editProfile()
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    const calls = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
    expect(calls()).toHaveLength(1); expect(host.textContent).toContain(texts.leaveUnknown)
    expect(host.querySelector<HTMLFieldSetElement>('[data-testid="leave-policy"] fieldset')!.disabled).toBe(true)
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Год"]')!.disabled).toBe(true)
    await act(async () => button(texts.leaveRetry).click())
    expect(calls()).toHaveLength(2); expect(calls()[1][1]?.body).toBe(calls()[0][1]?.body)
    const sent = JSON.parse(String(calls()[0][1]?.body))
    expect(sent).toMatchObject({ year: 2026, agentId: "fictional-employee", expectedRevisionId: null, profile: { openingDays: 0 } })
    expect(sent.requestId).toMatch(/^[a-f0-9-]{36}$/)
  })
  it("clears all private form inputs when fresh access is refused", async () => {
    await render(); const form = await editProfile()
    fetchMock.mockResolvedValue(response(null, 403))
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain("Demo employee")
    expect(host.textContent).not.toContain("Fictional category")
  })
  // Owner, 2026-10-15: empty norms start from the Labour Code's basic leave; HR checks and saves.
  it("starts empty norms from 21 calendar days of basic leave and publishes only after HR confirms", async () => {
    await render()
    const policy = host.querySelector<HTMLDetailsElement>('[data-testid="leave-policy"] details')!
    expect(policy.open).toBe(true)
    expect(host.textContent).toContain(texts.leaveDefaultHint)
    const inputs = [...policy.querySelectorAll<HTMLInputElement>("input")]
    expect(inputs.find(input => input.type === "date")!.value).toBe("2026-01-01")
    expect(policy.querySelector<HTMLSelectElement>("select")!.value).toBe("CALENDAR_EXCEPT_HOLIDAYS")
    expect(inputs.filter(input => input.type !== "date" && input.type !== "checkbox").map(input => input.value)).toEqual(["", texts.leaveDefaultCategory, "0", "21"])
    const submit = async () => act(async () => policy.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    await submit()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false)
    await act(async () => policy.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response({ id: "p1", idempotent: false }) : response(directory))
    await submit()
    const sent = JSON.parse(String(fetchMock.mock.calls.find(([, options]) => options?.method === "POST")![1]!.body))
    expect(sent).toMatchObject({ year: 2026, expectedRevisionId: null, reason: texts.leaveDefaultReason,
      policy: { basisDate: "2026-01-01", counting: "CALENDAR_EXCEPT_HOLIDAYS", minutesPerDay: null, reviewed: true, tiers: [{ category: texts.leaveDefaultCategory, minimumYears: 0, days: 21 }] } })
  })
  it("never publishes incomplete or unconfirmed norms", async () => {
    await render(); await act(async () => host.querySelector('[data-testid="leave-policy"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(host.textContent).toContain(texts.leaveInvalid); expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false)
  })
  it("shows both negative current balance and the future-leave deduction", async () => {
    directory.rows[0] = { ...directory.rows[0], state: "READY", usedDays: 12, plannedDays: 2, allowanceDays: 10, remainingDays: -2, availableDays: -4 }
    await render(); expect(host.textContent).toContain("-2 дн."); expect(host.textContent).toContain("После будущих отпусков: -4 дн.")
  })
  it("unlocks editing after an explicit oversized-body refusal", async () => {
    await render(); const form = await editProfile()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "MTM_ATTENDANCE_LEAVE_INVALID" }), { status: 413 }))
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(host.textContent).toContain(texts.leaveInvalid)
    expect(host.querySelector<HTMLFieldSetElement>('[data-testid="leave-profile"] fieldset')!.disabled).toBe(false)
    expect(button(texts.leaveRetry)).toBeUndefined()
  })

})
