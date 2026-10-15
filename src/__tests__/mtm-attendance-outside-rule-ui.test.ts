// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import MtmSettingsPage from "@/app/(dashboard)/mtm/settings/page"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"

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

describe("the attendance outside-branch rule on Company settings", () => {
  it.each(locales)("renders %s off by default, right after the module switches, preserving every company section", async language => {
    await render(language)
    expect(container.querySelector<HTMLElement>("#mtm-settings-panel-company")?.hidden).toBe(false)
    expect(control().getAttribute("aria-checked")).toBe("false")
    expect(control().getAttribute("aria-label")).toBe(t("lblAttendanceRejectOutsideBranch"))
    expect(row().textContent).toContain(t("hintAttendanceRejectOutsideBranch"))
    // The attendance switch itself moved to Personnel → Settings (2026-10-15).
    expect(row().previousElementSibling?.getAttribute("data-setting-row")).toBe("pharmacyPromotionsEnabled")
    expect(row("attendanceEnabled")).toBeNull()
    expect(Array.from(container.querySelectorAll('#mtm-settings-panel-company [data-settings-group]')).map(element => element.getAttribute("data-settings-group"))).toEqual(["groupScheduling", "groupSupport", "groupModules", "groupAgentCapabilities", "groupAttendanceReminders", "groupAttendanceRisk"])
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(6)
    expect(row().textContent).not.toContain("mtmSettingsPage.")
    expect(writes).toHaveLength(0); capture()
  })
  it.each([false, undefined, "true", 1])("does not show the rule when attendance is %s", async value => {
    stored.attendanceEnabled = value; await render(); expect(row()).toBeNull(); expect(writes).toHaveLength(0)
  })
  it.each(["admin", "superadmin"])("lets %s save only the changed rule and reloads its stored state", async role => {
    viewer.role = role; await render(); expect(control().disabled).toBe(false); await click(); await save()
    expect(writes).toEqual([{ [KEY]: true }]); expect(control().getAttribute("aria-checked")).toBe("true"); expect(saveBar().hidden).toBe(true)
  })
  it("shows the manager why the switch is locked and cannot produce a write", async () => {
    viewer.role = "manager"; await render(); expect(control().disabled).toBe(true)
    expect(row().textContent).toContain(t("adminOnlyNote")); await click(); expect(writes).toHaveLength(0); expect(saveBar().hidden).toBe(true)
  })
  it("offers no attendance switch here: it is turned on in Personnel → Settings", async () => {
    stored.attendanceEnabled = false; await render()
    expect(row()).toBeNull(); expect(row("attendanceEnabled")).toBeNull(); expect(writes).toHaveLength(0)
  })
  it("keeps the rule's stored value while attendance is off, with no accidental reset", async () => {
    stored[KEY] = true; stored.attendanceEnabled = false; await render(); expect(row()).toBeNull()
    expect(writes).toEqual([]); stored.attendanceEnabled = true
    await act(async () => root.unmount()); root = createRoot(container); await render()
    expect(control().getAttribute("aria-checked")).toBe("true")
  })
  it("preserves the unsaved draft after a denied save without reporting success or exposing server details", async () => {
    await render(); await click(); refuse = true; await save()
    expect(toast.error).toHaveBeenCalledWith(t("saveFailed")); expect(toast.success).not.toHaveBeenCalled(); expect(saveBar().hidden).toBe(false)
    expect(control().getAttribute("aria-checked")).toBe("true"); expect(stored[KEY]).toBe(false); expect(container.textContent).not.toContain("PRIVATE_SERVER_TRACE")
    refuse = false; await save(); expect(stored[KEY]).toBe(true); expect(saveBar().hidden).toBe(true)
  })
})

const SHARED = "attendanceAllowSharedInstallations", MOCK = "attendanceRejectMockLocations", CLOCK = "attendanceClockDifferenceSeconds"
const numberControl = () => row(CLOCK).querySelector<HTMLInputElement>('input[type="number"]')!
async function setThreshold(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(numberControl(), value)
    numberControl().dispatchEvent(new Event("input", { bubbles: true }))
  })
}
describe("attendance risk policy settings", () => {
  it.each(locales)("renders the real %s controls with conservative defaults and all original groups", async language => {
    await render(language)
    expect(control(SHARED).getAttribute("aria-checked")).toBe("false")
    expect(control(MOCK).getAttribute("aria-checked")).toBe("false")
    expect(numberControl().value).toBe("300")
    expect(numberControl().min).toBe("30"); expect(numberControl().max).toBe("86400")
    expect(row(SHARED).textContent).toContain(t("hintAttendanceAllowSharedInstallations"))
    expect(row(MOCK).textContent).toContain(t("hintAttendanceRejectMockLocations"))
    expect(row(CLOCK).textContent).toContain(t("hintAttendanceClockDifferenceSeconds"))
    expect(container.querySelectorAll('#mtm-settings-panel-company [data-settings-group]')).toHaveLength(6)
    expect(container.querySelector('[data-setting-row="attendanceRequireInstallationApproval"]')).toBeNull()
    expect(writes).toHaveLength(0); capture("attendance-risk-settings")
  })
  it.each([false, undefined, "true", 1])("hides the entire risk group unless attendance is exactly true (%s)", async value => {
    stored.attendanceEnabled = value; await render()
    expect(container.querySelector('[data-settings-group="groupAttendanceRisk"]')).toBeNull()
    expect(container.querySelectorAll('#mtm-settings-panel-company [data-settings-group]')).toHaveLength(4)
    expect(writes).toHaveLength(0)
  })
  it.each(["manager", "viewer"])("keeps %s policy controls locked with an explanation", async role => {
    viewer.role = role; await render()
    expect(control(SHARED).disabled).toBe(true); expect(control(MOCK).disabled).toBe(true); expect(numberControl().disabled).toBe(true)
    for (const key of [SHARED, MOCK, CLOCK]) expect(row(key).textContent).toContain(t("adminOnlyNote"))
    await click(SHARED); await click(MOCK); expect(writes).toHaveLength(0); expect(saveBar().hidden).toBe(true)
  })
  it.each(["admin", "superadmin"])("lets %s save only changed policy keys", async role => {
    viewer.role = role; await render(); await click(SHARED); await click(MOCK); await setThreshold("600"); await save()
    expect(writes).toEqual([{ [SHARED]: true, [MOCK]: true, [CLOCK]: 600 }])
    expect(numberControl().value).toBe("600"); expect(saveBar().hidden).toBe(true)
  })
  it.each(["", "29", "86401", "300.5"])("refuses invalid threshold %s without sending or coercing it", async value => {
    await render(); await setThreshold(value)
    expect(numberControl().getAttribute("aria-invalid")).toBe("true")
    expect(row(CLOCK).querySelector('[role="alert"]')?.textContent).toBeTruthy()
    await save(); expect(writes).toHaveLength(0); expect(stored[CLOCK]).toBe(300)
    await setThreshold("30"); await save(); expect(writes).toEqual([{ [CLOCK]: 30 }])
  })
  it("saves the strictest threshold alone", async () => {
    await render(); await click(MOCK); await setThreshold("86400"); await save()
    expect(writes).toEqual([{ [MOCK]: true, [CLOCK]: 86400 }])
  })
  it("keeps existing rules while attendance is off and shows them again when it is on", async () => {
    stored[SHARED] = true; stored[MOCK] = true; stored[CLOCK] = 600; stored.attendanceEnabled = false; await render()
    expect(row(CLOCK)).toBeNull(); expect(writes).toEqual([]); stored.attendanceEnabled = true
    await act(async () => root.unmount()); root = createRoot(container); await render()
    expect(numberControl().value).toBe("600")
    expect(control(SHARED).getAttribute("aria-checked")).toBe("true"); expect(control(MOCK).getAttribute("aria-checked")).toBe("true")
  })
  it("retains an unsaved policy after a denied save and retries without writing unrelated fields", async () => {
    await render(); await click(MOCK); await setThreshold("600"); refuse = true; await save()
    expect(toast.error).toHaveBeenCalledWith(t("saveFailed")); expect(toast.success).not.toHaveBeenCalled()
    expect(stored[MOCK]).toBe(false); expect(numberControl().value).toBe("600"); expect(saveBar().hidden).toBe(false)
    refuse = false; await save(); expect(writes).toEqual([{ [MOCK]: true, [CLOCK]: 600 }, { [MOCK]: true, [CLOCK]: 600 }])
  })
})


describe("attendance reminder settings localization", () => {
  it.each(locales)("renders %s defaults without notification side effects", async language => {
    await render(language)
    for (const key of ["attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"]) {
      expect(control(key).getAttribute("aria-checked")).toBe("false")
      expect(control(key).disabled).toBe(false)
      expect(control(key).className).toContain("h-11")
    }
    expect(container.textContent).not.toContain("mtmSettingsPage.")
    expect(writes).toEqual([])
    capture("attendance-reminder-settings")
  })
})
