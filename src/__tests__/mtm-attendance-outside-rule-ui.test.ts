// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import MtmSettingsPage from "@/app/(dashboard)/mtm/settings/page"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { MtmAttendancePolicySettings, type AttendancePolicyCard } from "@/components/mtm/attendance-policy-settings"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const viewer = vi.hoisted(() => ({ role: "admin" }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: viewer.role } } }) }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ notifyMtmSettingsChanged: vi.fn() }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
const section = vi.hoisted(() => (name: string) => () => ({ [name]: () => null }))
// Other tabs load independent resources; the Company panel and its controls are real.
vi.mock("@/app/(dashboard)/mtm/settings/visit-policy-settings", section("VisitPolicySettings"))
vi.mock("@/app/(dashboard)/mtm/settings/route-target-type-settings", section("RouteTargetTypeSettings"))
vi.mock("@/app/(dashboard)/mtm/settings/contact-card-settings", section("ContactCardSettings"))
vi.mock("@/app/(dashboard)/mtm/settings/contact-dictionary-settings", section("ContactDictionarySettings"))
vi.mock("@/app/(dashboard)/mtm/settings/organization-attribute-package-settings", section("OrganizationAttributePackageSettings"))
vi.mock("@/app/(dashboard)/mtm/settings/scoring-formula-settings", section("ScoringFormulaSettings"))
vi.mock("@/components/mtm/coverage-policy-admin", section("CoveragePolicyAdmin"))
vi.mock("@/components/mtm/kpi-policy-admin", section("KpiPolicyAdmin"))
const KEY = "attendanceRejectOutsideBranch"
const locales = ["ru", "az", "en"] as const
type Locale = typeof locales[number]
const messages = Object.fromEntries(locales.map(locale => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))]))
const fetchMock = vi.fn<typeof fetch>()
let stored: Record<string, unknown>, writes: Record<string, unknown>[], root: Root, container: HTMLDivElement, locale: Locale, refuse: boolean
const row = (key = KEY) => container.querySelector(`[data-setting-row="${key}"]`)!
const control = (key = KEY) => row(key).querySelector<HTMLButtonElement>('[role="switch"]')!
const t = (key: string) => messages[locale].mtmSettingsPage[key]
const saveBar = () => container.querySelector<HTMLElement>('[data-testid="mtm-settings-save-bar"]')!
const button = (name: string) => Array.from(saveBar().querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === t(name))!
async function click(key = KEY) { await act(async () => control(key).click()) }
async function render(language: Locale = "en") {
  locale = language
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmSettingsPage) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
async function save() { await act(async () => button("save").click()) }
function capture(prefix = "attendance-outside-rule") {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!dir) return
  // Reflect the live selected value in static HTML; React keeps it as a DOM property.
  for (const select of container.querySelectorAll("select")) {
    for (const option of select.options) option.toggleAttribute("selected", option.selected)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${prefix}-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1300px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
}
beforeEach(() => {
  viewer.role = "admin"; locale = "en"; stored = { ...MTM_SETTING_DEFAULTS, attendanceEnabled: true }; writes = []; refuse = false
  toast.success.mockClear(); toast.error.mockClear(); fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === "PUT") {
      const changes = JSON.parse(String(init.body)); writes.push(changes)
      if (refuse) return new Response(JSON.stringify({ success: false, error: "PRIVATE_SERVER_TRACE" }), { status: 403 })
      stored = { ...stored, ...changes }
      return new Response(JSON.stringify({ success: true, data: { ignoredKeys: [] } }))
    }
    return new Response(JSON.stringify({ success: true, data: String(input).includes("visit-policies") ? { policies: [] } : stored }))
  })
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/mtm/settings?tab=company")
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/") })

const ATTENDANCE_KEYS = ["attendanceRejectOutsideBranch", "attendanceAllowSharedInstallations", "attendanceRejectMockLocations", "attendanceClockDifferenceSeconds",
  "attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled", "attendanceAutoCloseForgottenDay"]

// Owner, 2026-10-18: «настройки, которые относятся к учёту времени, перемести в
// настройки соответствующего модуля». MTM → Settings no longer carries them.
describe("MTM → Settings → Company has no attendance switches", () => {
  it.each(locales)("renders %s without any, whether attendance is on or off", async language => {
    for (const enabled of [true, false]) {
      stored.attendanceEnabled = enabled
      await render(language)
      for (const key of ATTENDANCE_KEYS) expect(container.querySelector(`[data-setting-row="${key}"]`)).toBeNull()
      expect(Array.from(container.querySelectorAll('#mtm-settings-panel-company [data-settings-group]')).map(element => element.getAttribute("data-settings-group")))
        .toEqual(["groupScheduling", "groupSupport", "groupModules", "groupAgentCapabilities"])
      expect(writes).toHaveLength(0)
    }
  })
})

// Personnel → Settings → «Проверка отметок» / «Напоминания об отметках» / «Подтверждение заявок».
let editor: { card: AttendancePolicyCard; canChange: boolean }
async function renderEditor(card: AttendancePolicyCard, language: Locale = "en", canChange = true) {
  locale = language; editor = { card, canChange }
  const props = { locale, messages: messages[locale], timeZone: "Asia/Baku", children: createElement(MtmAttendancePolicySettings, editor) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const saveButton = () => container.querySelector<HTMLButtonElement>('[data-testid="attendance-policy-save"]')!
async function saveEditor() { await act(async () => saveButton().click()) }
const SHARED = "attendanceAllowSharedInstallations", MOCK = "attendanceRejectMockLocations", CLOCK = "attendanceClockDifferenceSeconds"
const numberControl = () => row(CLOCK).querySelector<HTMLInputElement>('input[type="number"]')!
async function setThreshold(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(numberControl(), value)
    numberControl().dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("Personnel → Settings: the checks of marks", () => {
  it.each(locales)("renders the real %s controls with conservative defaults", async language => {
    await renderEditor("checks", language)
    for (const key of [KEY, SHARED, MOCK]) {
      expect(control(key).getAttribute("aria-checked")).toBe("false")
      expect(control(key).className).toContain("h-11")
      expect(row(key).textContent).toContain(t(`hint${key.charAt(0).toUpperCase()}${key.slice(1)}`))
    }
    expect(numberControl().value).toBe("300")
    expect(numberControl().min).toBe("30"); expect(numberControl().max).toBe("86400")
    expect(row(CLOCK).textContent).toContain(t("hintAttendanceClockDifferenceSeconds"))
    expect(container.textContent).not.toContain("mtmSettingsPage.")
    expect(writes).toHaveLength(0); capture("attendance-checks-settings")
  })
  it("saves only the changed keys", async () => {
    await renderEditor("checks"); await click(KEY); await click(SHARED); await click(MOCK); await setThreshold("600"); await saveEditor()
    expect(writes).toEqual([{ [KEY]: true, [SHARED]: true, [MOCK]: true, [CLOCK]: 600 }])
    expect(toast.success).toHaveBeenCalledWith(t("savedToast")); expect(saveButton().disabled).toBe(true)
  })
  it.each(["", "29", "86401", "300.5"])("refuses invalid threshold %s without sending or coercing it", async value => {
    await renderEditor("checks"); await setThreshold(value)
    expect(numberControl().getAttribute("aria-invalid")).toBe("true")
    expect(row(CLOCK).querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(saveButton().disabled).toBe(true); await saveEditor(); expect(writes).toHaveLength(0); expect(stored[CLOCK]).toBe(300)
    await setThreshold("30"); await saveEditor(); expect(writes).toEqual([{ [CLOCK]: 30 }])
  })
  it("keeps the draft after a denied save, without reporting success or exposing server details, and retries", async () => {
    await renderEditor("checks"); await click(MOCK); refuse = true; await saveEditor()
    expect(toast.error).toHaveBeenCalledWith(t("saveFailed")); expect(toast.success).not.toHaveBeenCalled()
    expect(control(MOCK).getAttribute("aria-checked")).toBe("true"); expect(stored[MOCK]).toBe(false); expect(container.textContent).not.toContain("PRIVATE_SERVER_TRACE")
    refuse = false; await saveEditor(); expect(stored[MOCK]).toBe(true); expect(writes).toEqual([{ [MOCK]: true }, { [MOCK]: true }])
  })
  it("shows a non-administrator why the controls are locked, and writes nothing", async () => {
    await renderEditor("checks", "en", false)
    for (const key of [KEY, SHARED, MOCK]) expect(control(key).disabled).toBe(true)
    expect(numberControl().disabled).toBe(true)
    expect(row(KEY).textContent).toContain(t("adminOnlyNote")); expect(container.querySelector('[data-testid="attendance-policy-save"]')).toBeNull()
    await click(KEY); expect(writes).toHaveLength(0)
  })
})

describe("Personnel → Settings: reminders and request approval", () => {
  it.each(locales)("renders %s defaults without side effects", async language => {
    await renderEditor("reminders", language)
    for (const key of ["attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"]) {
      expect(control(key).getAttribute("aria-checked")).toBe("false")
      expect(control(key).className).toContain("h-11")
    }
    expect(container.textContent).not.toContain("mtmSettingsPage.")
    expect(writes).toEqual([]); capture("attendance-reminder-settings")
  })
  it("switches «Закрыть день» auto-approval on, alone", async () => {
    await renderEditor("approval", "ru"); await click("attendanceAutoCloseForgottenDay"); await saveEditor()
    expect(writes).toEqual([{ attendanceAutoCloseForgottenDay: true }])
    expect(row("attendanceAutoCloseForgottenDay").textContent).toContain(t("hintAttendanceAutoCloseForgottenDay"))
  })
})
