// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceLocationPolicy } from "@/components/mtm/attendance-location-policy"
import type { AttendanceLocationPolicy } from "@/lib/mtm/attendance-location-contract"
import { attendanceConsentTemplate } from "@/lib/mtm/attendance-consent-template"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const languages = ["ru", "az", "en"] as const
type Locale = typeof languages[number]
const messages = Object.fromEntries(languages.map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data, error: "PRIVATE_SERVER_TRACE" }), { status })
const policy = (overrides: Partial<AttendanceLocationPolicy> = {}): AttendanceLocationPolicy => ({ id: "fictional-policy", version: 1, enabled: false, legalReviewConfirmed: false, createdAt: "2026-10-13T08:00:00.000Z", texts: { az: "", ru: "", en: "" }, ...overrides })
const approved = { az: "Fictional approved text for fixture only.", ru: "Fictional approved text for fixture only.", en: "Fictional approved text for fixture only." }
const fetchMock = vi.fn<typeof fetch>()
let root: Root, container: HTMLDivElement, locale: Locale, unmounted: boolean
const t = (key: string) => messages[locale].mtmAttendance[key] as string
const button = (key: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === t(key))!
const field = (lang: string) => container.querySelector<HTMLTextAreaElement>(`#geo-text-${lang}`)!
const check = (index: number) => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]
// 0 — «QR at the entrance only», 1 — the double check with the phone's place.
const mode = (index: number) => container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[index]
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
async function render(language: Locale = locale) {
  locale = language
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendanceLocationPolicy) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function click(key: string) { await act(async () => button(key).click()) }
async function toggle(index: number) { await act(async () => check(index).click()) }
async function pick(index: number) { await act(async () => mode(index).click()) }
async function edit(lang: string, value: string) { await act(async () => { const input = field(lang); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) }) }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }
async function approveTexts() { for (const lang of languages) await edit(lang, approved[lang]); await toggle(0); await pick(1) }
beforeEach(() => { locale = "en"; unmounted = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); fetchMock.mockReset(); fetchMock.mockImplementation(async () => response({ policy: null })); vi.stubGlobal("fetch", fetchMock) })
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `attendance-location-policy-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1300px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
}
describe("tenant location text publication", () => {
  it.each(languages)("renders the actual %s default: QR only, a draft agreement, no approval or collection", async language => {
    await render(language)
    // Owner, 2026-10-30: an empty agreement starts from the sample draft, for the lawyer to edit.
    for (const lang of languages) { expect(field(lang).value).toBe(attendanceConsentTemplate(null)[lang]); expect(container.querySelector(`label[for="geo-text-${lang}"]`)?.textContent).toBe(t(`geoPolicyLanguage_${lang}`)) }
    expect(check(0).checked).toBe(false); expect(mode(0).checked).toBe(true); expect(mode(1).checked).toBe(false); expect(mode(1).disabled).toBe(true)
    expect(container.textContent).toContain(t("geoPolicyModeQr")); expect(container.textContent).toContain(t("geoPolicyModeNeedsAgreement")); expect(container.textContent).toContain(t("geoPolicyPrivacy"))
    expect(container.textContent).toContain(t("geoPolicyAgreementDraft")); expect(container.textContent).toContain(t("geoPolicyAgreementPrefilled"))
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_SERVER_TRACE/); expect(writes()).toHaveLength(0)
    expect(container.querySelectorAll("section[aria-labelledby]")).toHaveLength(2)
    capture()
  })
  it("requires three texts and a deliberate review confirmation before the double check", async () => {
    await render(); await edit("en", ""); await toggle(0); expect(mode(1).disabled).toBe(true)
    for (const lang of languages) await edit(lang, approved[lang])
    expect(check(0).checked).toBe(false); expect(mode(1).disabled).toBe(true)
    await toggle(0); expect(mode(1).disabled).toBe(false); await pick(1); expect(mode(1).checked).toBe(true); expect(mode(0).checked).toBe(false)
    await edit("ru", approved.ru + " Changed."); expect(check(0).checked).toBe(false); expect(mode(1).checked).toBe(false); expect(mode(0).checked).toBe(true); expect(mode(1).disabled).toBe(true)
  })
  it("fills the draft with the organization's name, saves it only on request, and never replaces a published text", async () => {
    fetchMock.mockResolvedValueOnce(response({ policy: null, organizationName: "Fictional Pharma" })); await render("ru")
    expect(field("az").value).toContain("Fictional Pharma iş vaxtının uçotu"); expect(field("ru").value).toContain("Fictional Pharma ведёт учёт"); expect(field("en").value).not.toContain("[Company name]")
    expect(writes()).toHaveLength(0)
    const draft = policy({ id: "fictional-draft", texts: attendanceConsentTemplate("Fictional Pharma") })
    fetchMock.mockResolvedValueOnce(response({ policy: draft, idempotent: false })).mockResolvedValueOnce(response({ policy: draft, organizationName: "Fictional Pharma" }))
    await submit()
    // Saved as a draft: QR only, nothing for employees to accept.
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ enabled: false, legalReviewConfirmed: false, texts: attendanceConsentTemplate("Fictional Pharma") })
    expect(container.textContent).toContain(t("geoPolicyAgreementDraft")); expect(container.textContent).not.toContain(t("geoPolicyAgreementPrefilled"))
    await act(async () => root.unmount()); root = createRoot(container)
    fetchMock.mockResolvedValueOnce(response({ policy: policy({ texts: approved, enabled: true, legalReviewConfirmed: true }), organizationName: "Fictional Pharma" })); await render()
    for (const lang of languages) expect(field(lang).value).toBe(approved[lang])
    expect(mode(1).checked).toBe(true); expect(container.textContent).toContain(t("geoPolicyAgreementLive"))
  })
  it("publishes one explicit revision and confirms it only after reading the server", async () => {
    fetchMock.mockResolvedValueOnce(response({ policy: policy() })); await render(); await approveTexts()
    const saved = policy({ id: "fictional-next", version: 2, texts: approved, enabled: true, legalReviewConfirmed: true })
    fetchMock.mockResolvedValueOnce(response({ policy: saved, idempotent: false })).mockResolvedValueOnce(response({ policy: saved }))
    await submit(); const payload = JSON.parse(String(writes()[0][1]?.body))
    expect(payload).toMatchObject({ expectedRevisionId: "fictional-policy", texts: approved, enabled: true, legalReviewConfirmed: true })
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/); expect(container.textContent).toContain(t("geoPolicySaved")); expect(container.textContent).toContain(t("geoPolicyAgreementLive"))
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBeUndefined()
  })
  it("allows an existing publication to be switched off without inventing replacement text", async () => {
    const current = policy({ texts: approved, enabled: true, legalReviewConfirmed: true }); fetchMock.mockResolvedValueOnce(response({ policy: current }))
    await render(); await pick(0); fetchMock.mockRejectedValueOnce(new Error("lost response")); await submit()
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ enabled: false, texts: approved, expectedRevisionId: current.id })
  })
  it("freezes the exact UUID and body after an unknown reply, including a language change", async () => {
    await render(); await approveTexts(); fetchMock.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_TRACE")); await submit()
    const first = writes()[0][1]?.body
    expect(button("geoPolicySave").disabled).toBe(true); expect(field("ru").disabled).toBe(true); expect(container.textContent).toContain(t("geoPolicyUnconfirmed"))
    await render("ru"); await submit(); expect(writes()).toHaveLength(1)
    const saved = policy({ texts: approved, enabled: true, legalReviewConfirmed: true })
    fetchMock.mockResolvedValueOnce(response({ policy: saved, idempotent: true })).mockResolvedValueOnce(response({ policy: saved }))
    await click("geoPolicyRetry"); expect(writes()[1][1]?.body).toBe(first); expect(container.textContent).toContain(t("geoPolicySaved"))
    expect(container.textContent).not.toContain("PRIVATE_")
  })
  it("keeps an in-flight write across language changes and blocks a second publication", async () => {
    await render(); let done!: (response: Response) => void; fetchMock.mockImplementationOnce(() => new Promise(resolve => { done = resolve })); await submit()
    const signal = writes()[0][1]?.signal; await render("az"); expect(signal?.aborted).toBe(false); expect(button("geoPolicySaving").disabled).toBe(true)
    await submit(); expect(writes()).toHaveLength(1)
    await act(async () => done(response({ policy: policy(), idempotent: false })))
    expect(container.textContent).toContain(t("geoPolicySaved"))
  })
  it("blocks a stale revision until an explicit refresh", async () => {
    await render(); fetchMock.mockResolvedValueOnce(response(null, 409)); await submit()
    expect(container.textContent).toContain(t("geoPolicyChanged")); expect(button("geoPolicySave").disabled).toBe(true); await submit(); expect(writes()).toHaveLength(1)
    fetchMock.mockResolvedValueOnce(response({ policy: policy({ id: "newer-policy" }) })); await click("geoPolicyRefresh"); expect(button("geoPolicySave").disabled).toBe(false)
  })
  it.each([401, 403, 404])("clears texts and frozen publication after a %s denial", async status => {
    fetchMock.mockResolvedValueOnce(response({ policy: policy({ texts: approved }) })); await render()
    fetchMock.mockResolvedValueOnce(response(null, status)); await submit()
    expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain(approved.ru); expect(container.textContent).toContain(t("geoPolicyAccessUnavailable")); expect(container.querySelector("button")).toBeNull()
  })
  it("fails closed on malformed loading responses and recovers by reading again", async () => {
    fetchMock.mockResolvedValueOnce(response({ policy: { ...policy(), version: 0 } })); await render()
    expect(container.querySelector("form")).toBeNull(); expect(container.textContent).toContain(t("geoPolicyLoadError")); expect(writes()).toHaveLength(0)
    await click("geoPolicyRefresh"); expect(container.querySelector("form")).not.toBeNull()
  })
  it("does not announce success when the follow-up server read fails", async () => {
    await render(); fetchMock.mockResolvedValueOnce(response({ policy: policy(), idempotent: false })).mockRejectedValueOnce(new Error("lost read")); await submit()
    expect(container.textContent).not.toContain(t("geoPolicySaved")); expect(container.textContent).toContain(t("geoPolicyLoadError")); expect(container.querySelector("form")).toBeNull()
  })
  it.each([400, 413, 422])("shows a safe validation message for %s without an uncertain retry", async status => {
    await render(); fetchMock.mockResolvedValueOnce(response(null, status)); await submit()
    expect(container.textContent).toContain(t("geoPolicyInvalid")); expect(button("geoPolicyRetry")).toBeUndefined(); expect(button("geoPolicySave").disabled).toBe(false)
  })
  it("aborts reads and writes on unmount and ignores a late accepted reply", async () => {
    await render(); let done!: (response: Response) => void; fetchMock.mockImplementationOnce(() => new Promise(resolve => { done = resolve })); await submit()
    const signal = writes()[0][1]?.signal, callCount = fetchMock.mock.calls.length
    await act(async () => root.unmount()); unmounted = true; expect(signal?.aborted).toBe(true)
    await act(async () => done(response({ policy: policy(), idempotent: false }))); expect(fetchMock.mock.calls).toHaveLength(callCount)
  })
})
