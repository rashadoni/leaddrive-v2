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
function capture() {
  const dir = process.env.MTM_ATTENDANCE_RENDER_DIR
  if (!dir) return
  // Reflect the live selected value in static HTML; React keeps it as a DOM property.
  for (const select of container.querySelectorAll("select")) {
    for (const option of select.options) option.toggleAttribute("selected", option.selected)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `attendance-outside-rule-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{max-width:1300px;margin:auto;padding:32px;font-family:Arial,sans-serif}*,*:before,*:after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`)
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
  it.each(locales)("renders %s off by default, immediately after attendance, preserving every company section", async language => {
    await render(language)
    expect(container.querySelector<HTMLElement>("#mtm-settings-panel-company")?.hidden).toBe(false)
    expect(control().getAttribute("aria-checked")).toBe("false")
    expect(control().getAttribute("aria-label")).toBe(t("lblAttendanceRejectOutsideBranch"))
    expect(row().textContent).toContain(t("hintAttendanceRejectOutsideBranch"))
    expect(row().previousElementSibling?.getAttribute("data-setting-row")).toBe("attendanceEnabled")
    expect(Array.from(container.querySelectorAll('#mtm-settings-panel-company [data-settings-group]')).map(element => element.getAttribute("data-settings-group"))).toEqual(["groupScheduling", "groupSupport", "groupModules", "groupAgentCapabilities"])
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
  it("supports enabling attendance and its outside rule in one save", async () => {
    stored.attendanceEnabled = false; await render(); expect(row()).toBeNull(); await click("attendanceEnabled"); await click(); await save()
    expect(writes).toEqual([{ attendanceEnabled: true, [KEY]: true }]); expect(control().getAttribute("aria-checked")).toBe("true")
  })
  it("keeps the rule's stored value while attendance is hidden, with no accidental reset", async () => {
    stored[KEY] = true; await render(); await click("attendanceEnabled"); expect(row()).toBeNull(); await save()
    expect(writes).toEqual([{ attendanceEnabled: false }]); await click("attendanceEnabled"); expect(control().getAttribute("aria-checked")).toBe("true")
  })
  it("preserves the unsaved draft after a denied save without reporting success or exposing server details", async () => {
    await render(); await click(); refuse = true; await save()
    expect(toast.error).toHaveBeenCalledWith(t("saveFailed")); expect(toast.success).not.toHaveBeenCalled(); expect(saveBar().hidden).toBe(false)
    expect(control().getAttribute("aria-checked")).toBe("true"); expect(stored[KEY]).toBe(false); expect(container.textContent).not.toContain("PRIVATE_SERVER_TRACE")
    refuse = false; await save(); expect(stored[KEY]).toBe(true); expect(saveBar().hidden).toBe(true)
  })
})
