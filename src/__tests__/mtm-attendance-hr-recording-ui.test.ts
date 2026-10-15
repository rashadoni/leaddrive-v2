// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceHrRecordingForm } from "@/components/mtm/attendance-hr-recording-form"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { AttendanceHrRecordingInputSchema, type AttendanceHrDirectory, type AttendanceHrRecordingInput } from "@/lib/mtm/attendance-hr-recording-contract"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const locales = { ru: messages("ru"), az: messages("az"), en: messages("en") }
const kinds = defaultAttendanceDayKinds(key => ({ ru: locales.ru.mtmAttendance[`dayKindName${key}`], az: locales.az.mtmAttendance[`dayKindName${key}`], en: locales.en.mtmAttendance[`dayKindName${key}`] }))
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const version = "2026-10-13T08:00:00.000Z"
const directory = (): AttendanceHrDirectory => ({
  employees: [{ id: "demo-b", name: "Aylin Demo", teamId: "north", teamName: "Demo North" }, { id: "demo-a", name: "Murad Demo", teamId: "north", teamName: "Demo North" }, { id: "demo-c", name: "Leyla Demo", teamId: "south", teamName: "Demo South" }],
  catalogue: { items: kinds, version }, timezone: "Asia/Baku",
})
const reply = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data, code, error: "PRIVATE_INTERNAL_DETAILS" }), { status })
const accepted = (input: AttendanceHrRecordingInput, idempotent = false) => reply({ idempotent, items: input.agentIds.map((agentId, index) => ({ id: id(index + 100), agentId, clientRequestId: input.clientRequestId, status: "APPROVED" })) }, idempotent ? 200 : 201)
const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement, root: Root, language: keyof typeof locales, sequence: number
const t = (key: string) => locales[language].mtmAttendance[key]
const button = (key: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === t(key))!
const field = (key: string) => container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#hr-recording-${key}`)!
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
const payload = (index = 0) => JSON.parse(String(writes()[index][1]?.body)) as AttendanceHrRecordingInput
async function render(locale: typeof language = language) {
  language = locale
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, timeZone: "Asia/Baku", messages: locales[locale] }, createElement(MtmAttendanceHrRecordingForm))))
}
async function click(key: string) { await act(async () => button(key).click()) }
async function edit(key: string, value: string) { await act(async () => {
  const input = field(key)
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }))
}) }
async function fill(kind = "STUDY_LEAVE", team = true) {
  if (team) await edit("mode", "TEAM")
  await edit("target", team ? "north" : "demo-b"); await edit("kind", kind)
  await edit("from", "2026-10-19")
  if (field("to")) await edit("to", "2026-10-20")
  await edit("reason", "  Демонстрационная запись: согласованное обучение  ")
}
function capture(locale: string) {
  const directory = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const clone = container.cloneNode(true) as HTMLElement
  container.querySelectorAll("select").forEach((select, index) => Array.from(clone.querySelectorAll("select")[index].options).forEach(option => {
    if (option.value === select.value) option.setAttribute("selected", ""); else option.removeAttribute("selected")
  }))
  container.querySelectorAll("input").forEach((input, index) => clone.querySelectorAll("input")[index].setAttribute("value", input.value))
  container.querySelectorAll("textarea").forEach((input, index) => { clone.querySelectorAll("textarea")[index].textContent = input.value })
  writeFileSync(join(directory, `attendance-hr-recording-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{width:100%;max-width:1360px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${clone.innerHTML}</body></html>`)
}
beforeEach(() => {
  language = "ru"; sequence = 0; container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? accepted(JSON.parse(String(init.body))) : reply(directory()))
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: () => id(++sequence) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("actual HR recording form", () => {
  it.each(["ru", "az", "en"] as const)("renders explicit selection and the actual team preview in %s", async locale => {
    await render(locale)
    expect(button("hrRecordingSave").disabled).toBe(true)
    expect(field("target").value).toBe(""); expect(field("reason").value).toBe("")
    expect(container.querySelector('option[value="WORKED"]')).toBeNull()
    expect(container.querySelector('option[value="NOT_EMPLOYED"]')).toBeNull()
    await fill()
    expect(container.querySelectorAll('[data-testid="hr-recording-preview"] li')).toHaveLength(2)
    expect(container.textContent).toContain("Aylin Demo"); expect(container.textContent).toContain("Murad Demo")
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_INTERNAL_DETAILS/)
    expect(container.querySelector('[class*="overflow-y-auto"]')).toBeNull()
    for (const input of container.querySelectorAll("input,select,textarea")) expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
    capture(locale)
  })
  it("says why the recorder's own days are not in the list", async () => {
    await render()
    expect(container.querySelector('[data-testid="hr-recording-not-self"]')!.textContent).toBe(t("hrRecordingNotSelf"))
  })
  it("records a sorted, explicit team snapshot with the loaded catalogue version and waits before another operation", async () => {
    await render(); await fill(); await click("hrRecordingSave")
    expect(AttendanceHrRecordingInputSchema.safeParse(payload()).success).toBe(true)
    expect(payload()).toEqual({ clientRequestId: id(1), agentIds: ["demo-a", "demo-b"], catalogueVersion: version, dayKindKey: "STUDY_LEAVE", unit: "DAYS", startDate: "2026-10-19", endDate: "2026-10-20", reason: "Демонстрационная запись: согласованное обучение" })
    expect(button("hrRecordingSave").disabled).toBe(true)
    await click("hrRecordingSave"); expect(writes()).toHaveLength(1)
    await click("hrRecordingNew"); expect(field("target").value).toBe(""); expect(field("reason").value).toBe("")
    expect(button("hrRecordingSave").disabled).toBe(true)
  })
  it("uses the catalogue unit for a same-day hour pair and rejects a reversed interval", async () => {
    await render(); await fill("TRAINING", false)
    expect(field("to")).toBeNull(); expect(container.textContent).toContain("Asia/Baku")
    await edit("start", "12:00"); await edit("end", "11:00"); await click("hrRecordingSave")
    expect(writes()).toHaveLength(0); expect(container.textContent).toContain(t("hrRecordingInvalid"))
    await edit("end", "14:30"); await click("hrRecordingSave")
    expect(payload()).toMatchObject({ agentIds: ["demo-b"], unit: "HOURS", startDate: "2026-10-19", endDate: "2026-10-19", startTime: "12:00", endTime: "14:30" })
  })
  it("does not add newly loaded team members to an already selected batch", async () => {
    await render(); await fill()
    const next = directory(); next.employees.push({ id: "demo-new", name: "New Demo", teamId: "north", teamName: "Demo North" })
    fetchMock.mockResolvedValueOnce(reply(next)); await click("hrRecordingRefresh")
    expect(container.querySelectorAll('[data-testid="hr-recording-preview"] li')).toHaveLength(2)
    await click("hrRecordingSave"); expect(payload().agentIds).toEqual(["demo-a", "demo-b"])
  })
  it("blocks a batch whose employee scope was removed instead of substituting other employees", async () => {
    await render(); await fill()
    const next = directory(); next.employees = next.employees.filter(employee => employee.id !== "demo-a")
    fetchMock.mockResolvedValueOnce(reply(next)); await click("hrRecordingRefresh")
    expect(container.textContent).toContain(t("hrRecordingScopeChanged")); expect(button("hrRecordingSave").disabled).toBe(true)
    await click("hrRecordingSave"); expect(writes()).toHaveLength(0)
  })
  it("never silently truncates an oversized team", async () => {
    const next = directory(); next.employees = Array.from({ length: 101 }, (_, index) => ({ id: `demo-${index}`, name: `Demo ${index}`, teamId: "north", teamName: "Demo North" }))
    fetchMock.mockResolvedValueOnce(reply(next)); await render(); await fill()
    expect(container.querySelectorAll('[data-testid="hr-recording-preview"] li')).toHaveLength(101)
    expect(button("hrRecordingSave").disabled).toBe(true); expect(writes()).toHaveLength(0)
  })
  it("requires three trimmed reason characters without sending", async () => {
    await render(); await fill(); await edit("reason", "  аб  "); await click("hrRecordingSave")
    expect(container.textContent).toContain(t("hrRecordingInvalid")); expect(writes()).toHaveLength(0)
  })
  it("reconciles a lost response by repeating exactly the same body and UUID", async () => {
    await render(); await fill()
    fetchMock.mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_DETAILS")); await click("hrRecordingSave")
    const sent = writes()[0][1]?.body
    expect(container.textContent).toContain(t("hrRecordingUnknown")); expect(field("reason").matches(":disabled")).toBe(true)
    await click("hrRecordingRefresh")
    expect(button("hrRecordingSave").disabled).toBe(true)
    fetchMock.mockImplementationOnce(async (_url, init) => accepted(JSON.parse(String(init?.body)), true))
    await click("hrRecordingCheck")
    expect(writes()[1][1]?.body).toBe(sent); expect(button("hrRecordingNew")).toBeDefined()
    expect(container.textContent).not.toContain("PRIVATE_TRANSPORT_DETAILS")
  })
  it("treats a malformed success or unmatched batch as unknown", async () => {
    await render(); await fill()
    fetchMock.mockResolvedValueOnce(reply({ items: [{ id: id(9), agentId: "other-person", clientRequestId: id(1), status: "APPROVED" }] })); await click("hrRecordingSave")
    expect(container.textContent).toContain(t("hrRecordingUnknown")); expect(button("hrRecordingNew")).toBeUndefined()
  })
  it("aborts on a locale change, keeps the frozen request, ignores late success and never unlocks via GET", async () => {
    await render(); await fill()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finish = done })); await click("hrRecordingSave")
    const first = payload(), signal = writes()[0][1]?.signal
    await render("en")
    expect(signal?.aborted).toBe(true); expect(button("hrRecordingCheck").disabled).toBe(false)
    await act(async () => finish(accepted(first)))
    expect(button("hrRecordingNew")).toBeUndefined()
    await click("hrRecordingCheck")
    expect(payload(1)).toEqual(first); expect(button("hrRecordingNew")).toBeDefined()
  })
  it.each([401, 403, 404])("clears all private form/preview/pending data after a %s refusal", async status => {
    await render(); await fill()
    fetchMock.mockResolvedValueOnce(reply(null, status)); await click("hrRecordingSave")
    expect(field("reason")).toBeNull(); expect(container.textContent).not.toContain("Aylin Demo")
    expect(container.textContent).not.toContain("согласованное обучение"); expect(button("hrRecordingCheck")).toBeUndefined()
    expect(container.textContent).toContain(t("hrRecordingForbidden"))
  })
  it("does not expose direct recording controls when GET refuses the feature", async () => {
    fetchMock.mockResolvedValueOnce(reply(null, 404)); await render()
    expect(container.querySelector("form")).toBeNull(); expect(container.textContent).toContain(t("hrRecordingForbidden"))
  })
  it("shows overlap as a known refusal and permits correcting the period", async () => {
    await render(); await fill(); fetchMock.mockResolvedValueOnce(reply(null, 409, "MTM_ATTENDANCE_REQUEST_OVERLAP")); await click("hrRecordingSave")
    expect(container.textContent).toContain(t("hrRecordingOverlap")); expect(field("reason").matches(":disabled")).toBe(false)
    expect(button("hrRecordingCheck")).toBeUndefined()
    await edit("from", "2026-10-21"); await edit("to", "2026-10-21"); await click("hrRecordingSave")
    expect(payload(1).clientRequestId).not.toBe(payload().clientRequestId)
  })
  it("requires catalogue refresh after a stale version and submits the refreshed version", async () => {
    await render(); await fill(); fetchMock.mockResolvedValueOnce(reply(null, 409, "MTM_ATTENDANCE_DAY_KINDS_CHANGED")); await click("hrRecordingSave")
    expect(button("hrRecordingSave").disabled).toBe(true)
    const next = directory(); next.catalogue.version = "2026-10-13T09:00:00.000Z"
    fetchMock.mockResolvedValueOnce(reply(next)); await click("hrRecordingRefresh"); await click("hrRecordingSave")
    expect(payload(1).catalogueVersion).toBe(next.catalogue.version)
  })
  it("aborts a write on unmount and rejects its late success", async () => {
    await render(); await fill(); let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { finish = done })); await click("hrRecordingSave")
    const sent = payload(), signal = writes()[0][1]?.signal
    await act(async () => root.render(null)); expect(signal?.aborted).toBe(true)
    await act(async () => finish(accepted(sent))); expect(container.textContent).toBe("")
  })
})
