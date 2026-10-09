// @vitest-environment jsdom
/**
 * Route & Field → Settings, the whole page.
 *
 * Owner, 2026-10-08, after an audit that counted ten screens and 164 controls
 * on one page: «сделай компактнее… переводы какие-то непонятные и сама
 * структура как-то непонятная. продумай».
 *
 * The page is six tabs now. A tab that is not open is hidden, not gone — so
 * these tests hold it to the three things a hidden tab could silently break:
 * an unsaved change must survive a look at another tab and be visible from
 * anywhere, a refused save must lead to the field that refused it, and one
 * save must still send exactly what was changed.
 *
 * The real page with the real Russian copy; the network is stubbed and keeps
 * what was written. The self-contained sections that load their own data are
 * replaced by named placeholders: where they stand is what is tested here.
 */
import { act, createElement, useInsertionEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru[namespace]
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
const viewer = vi.hoisted(() => ({ role: "manager" }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: viewer.role } } }) }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ notifyMtmSettingsChanged: vi.fn() }))
vi.mock("@/components/page-description", () => ({ PageDescription: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
// A section that loads its own data, replaced by a named placeholder.
const section = vi.hoisted(() => (exportName: string, name: string) => async () => {
  const react = await import("react")
  return { [exportName]: () => react.createElement("div", { "data-section": name }) }
})
vi.mock("@/app/(dashboard)/mtm/settings/contact-card-settings", section("ContactCardSettings", "contact-card"))
vi.mock("@/app/(dashboard)/mtm/settings/contact-dictionary-settings", section("ContactDictionarySettings", "contact-dictionary"))
vi.mock("@/app/(dashboard)/mtm/settings/organization-attribute-package-settings", section("OrganizationAttributePackageSettings", "attribute-packages"))
vi.mock("@/app/(dashboard)/mtm/settings/scoring-formula-settings", section("ScoringFormulaSettings", "scoring"))
vi.mock("@/components/mtm/coverage-policy-admin", section("CoveragePolicyAdmin", "coverage"))
vi.mock("@/components/mtm/kpi-policy-admin", section("KpiPolicyAdmin", "kpi"))

import MtmSettingsPage from "@/app/(dashboard)/mtm/settings/page"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"

const TABS = ["visit", "routes", "alerts", "clients", "company", "admin"] as const
type Tab = typeof TABS[number]
const page = ru.mtmSettingsPage as Record<string, string>

let stored: Record<string, unknown> = {}
let writes: Record<string, unknown>[] = []
let refuse: { status: number; body: unknown } | null = null

let root: Root
let container: HTMLDivElement
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const tabButton = (name: Tab) => container.querySelector(`#mtm-settings-tab-${name}`) as HTMLButtonElement
const panel = (name: Tab) => container.querySelector(`#mtm-settings-panel-${name}`) as HTMLElement
const openTab = async (name: Tab) => { await act(async () => { tabButton(name).click() }) }
const shownTabs = () => TABS.filter((name) => !panel(name).hidden)
const mark = (name: Tab) => container.querySelector(`[data-testid="mtm-settings-tab-mark-${name}"]`)?.getAttribute("data-mark") ?? null
const settingRow = (key: string) => container.querySelector(`[data-setting-row="${key}"]`) as HTMLElement
const tabOf = (element: Element | null) => element?.closest('[role="tabpanel"]')?.id.replace("mtm-settings-panel-", "") ?? null
const flip = async (key: string) => {
  await act(async () => { (settingRow(key).querySelector('[role="switch"]') as HTMLButtonElement).click() })
}
const typeNumber = async (key: string, value: string) => {
  const input = settingRow(key).querySelector('input[type="number"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const saveBar = () => container.querySelector('[data-testid="mtm-settings-save-bar"]') as HTMLElement
const pressSave = async () => {
  const button = [...saveBar().querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(page.save)) as HTMLButtonElement
  await act(async () => { button.click() })
  await settle()
}

async function open() {
  await act(async () => { root.render(createElement(MtmSettingsPage)) })
  await settle()
}
/** The page opened anew, as a reload or a typed address opens it. */
async function openAt(address: string) {
  act(() => root.unmount())
  root = createRoot(container)
  window.history.replaceState(null, "", address)
  await open()
}
/**
 * The page reached by a link inside the application. The router writes the
 * new address while the new page is being put on screen — after the page was
 * first drawn, with the address of the page that was left still in the bar.
 */
function ArrivingByLink({ address }: { address: string }) {
  useInsertionEffect(() => { window.history.replaceState(null, "", address) }, [address])
  return createElement(MtmSettingsPage)
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  viewer.role = "manager"
  stored = { ...MTM_SETTING_DEFAULTS }
  writes = []
  refuse = null
  toast.error.mockClear()
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    const url = String(input)
    if ((init?.method ?? "GET") === "GET") {
      if (url.includes("/visit-policies")) {
        return reply(200, { success: true, data: { policies: [], access: { kind: "admin", canWriteOrganizationWide: true, writableTeamIds: null } } })
      }
      if (url.includes("/mtm/settings")) return reply(200, { success: true, data: stored })
      return reply(200, { success: true, data: { teams: [], agents: [], customers: [] } })
    }
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
    writes.push(body)
    if (refuse) return reply(refuse.status, refuse.body)
    stored = { ...stored, ...body }
    return reply(200, { success: true, data: { ignoredKeys: [] } })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

describe("the settings page as six tabs", () => {
  it("opens on what an agent does in a visit, with the other five tabs one press away", async () => {
    await open()
    expect([...container.querySelectorAll('[data-testid="mtm-settings-tabs"] [role="tab"]')].map((tab) => tab.textContent))
      .toEqual([page.tabVisit, page.tabRoutes, page.tabAlerts, page.tabClients, page.tabCompany, page.tabAdmin])
    expect(shownTabs()).toEqual(["visit"])
    expect(tabButton("visit").getAttribute("aria-selected")).toBe("true")
    // The visit switches are the first thing on the first tab.
    expect(panel("visit").firstElementChild?.querySelector('[data-testid="visit-action-switches"]')).not.toBeNull()

    for (const name of TABS) {
      await openTab(name)
      expect(shownTabs()).toEqual([name])
      expect(TABS.filter((other) => tabButton(other).getAttribute("aria-selected") === "true")).toEqual([name])
    }
  })

  // The live map's «Настройки оповещений» leads here for the alert rules
  // (2026-10-09). Every link to this page used to land on the first tab, and
  // the rules are on the third.
  it("opens on the tab the address names, and on the first tab when it names none or one that does not exist", async () => {
    await openAt("/mtm/settings?tab=alerts")
    expect(shownTabs()).toEqual(["alerts"])
    expect(TABS.filter((name) => tabButton(name).getAttribute("aria-selected") === "true")).toEqual(["alerts"])
    // What the link promised is on screen, not behind a tab still to be found.
    expect(tabOf(settingRow("alertOutOfZone"))).toBe("alerts")
    // It is where the page opens, not where it is stuck: the other tabs answer as before.
    await openTab("company")
    expect(shownTabs()).toEqual(["company"])

    await openAt("/mtm/settings")
    expect(shownTabs()).toEqual(["visit"])
    for (const unknown of ["/mtm/settings?tab=reports", "/mtm/settings?tab=", "/mtm/settings?tab=ALERTS", "/mtm/settings?section=alerts"]) {
      await openAt(unknown)
      expect(shownTabs(), unknown).toEqual(["visit"])
    }
    // Every tab can be named, not only the one the map needs today.
    for (const name of TABS) {
      await openAt(`/mtm/settings?tab=${name}`)
      expect(shownTabs()).toEqual([name])
    }
  })

  it("opens the named tab for a link pressed inside the application, where the address changes only as the page appears", async () => {
    window.history.replaceState(null, "", "/mtm/map?agentId=agent-7")
    await act(async () => { root.render(createElement(ArrivingByLink, { address: "/mtm/settings?tab=alerts" })) })
    await settle()
    expect(window.location.search).toBe("?tab=alerts")
    expect(shownTabs()).toEqual(["alerts"])
  })

  it("puts every setting where its tab says it is", async () => {
    await open()
    const where = (key: string) => tabOf(settingRow(key))
    expect(["maxPhotosPerVisit", "photoWatermarkEnabled", "geofenceRadius", "agentCheckInOutsideZone"].map(where))
      .toEqual(["visit", "visit", "visit", "visit"])
    expect(["routeAssignmentsEnabled", "routeTravelEnabled", "enforceWorkCalendarForRoutes"].map(where)).toEqual(["routes", "routes", "routes"])
    expect(tabOf(container.querySelector('[data-testid="route-target-preview"]'))).toBe("routes")
    expect(["alertLongBreak", "alertOutOfZone", "lateAfterHour", "offlineThresholdSeconds"].map(where)).toEqual(["alerts", "alerts", "alerts", "alerts"])
    expect(tabOf(container.querySelector('[data-section="contact-card"]'))).toBe("clients")
    expect(["timezone", "supportEmail", "fieldContactsEnabled", "taskSelfCreate", "teamScheduleVisibilityEnabled"].map(where))
      .toEqual(["company", "company", "company", "company", "company"])
    expect(["visitPoliciesEnabled", "brandPotentialPerAgentEnabled", "excelImportsEnabled", "gpsInterval"].map(where))
      .toEqual(["admin", "admin", "admin", "admin"])
    // One place to require a photo: the switches. The older page-level switch is gone.
    expect(settingRow("photoRequired")).toBeNull()
  })

  // Owner, 2026-10-08, shown the «Routes» tab with a half-width card and
  // nothing beside it: «симметрично делай, ты как будто как попало
  // накладываешь… половинчатые блоки». The rule since: a card is half of a
  // pair or the whole row, never a half on its own.
  it("leaves no half-width card standing alone on any tab", async () => {
    await open()
    for (const name of TABS) {
      const cards = [...panel(name).querySelectorAll("[data-settings-group][data-span]")]
      const halves = cards.filter((card) => card.getAttribute("data-span") === "half")
      expect(halves.length % 2, `${name}: ${halves.length} half-width cards`).toBe(0)
      for (const card of cards.filter((candidate) => candidate.getAttribute("data-span") === "full")) {
        expect(card.className, `${name}: ${card.getAttribute("data-settings-group")}`).toContain("lg:col-span-2")
      }
    }
    // The first tab's pair is the visit switches and, beside them, the two cards about photos and the zone.
    const row = container.querySelector('[data-testid="visit-switches-row"]') as HTMLElement
    expect(row.className).toContain("lg:grid-cols-2")
    expect([...row.children].map((child) => child.getAttribute("data-testid") ?? [...child.children].map((card) => card.getAttribute("data-settings-group"))))
      .toEqual(["visit-action-switches", ["groupVisits", "groupGeofence"]])
    // Tabs with one card give it the whole row; the planner buttons are two equal halves as well.
    expect([...panel("routes").querySelectorAll("[data-span]")].map((card) => card.getAttribute("data-span"))).toEqual(["full"])
    expect([...panel("admin").querySelectorAll("[data-settings-grid] [data-span]")].map((card) => card.getAttribute("data-span"))).toEqual(["full"])
    expect((container.querySelector('[data-testid="route-target-rows"]')?.parentElement as HTMLElement).className).toContain("lg:grid-cols-2")
  })

  it("shows the unit beside every number, in words a person reads", async () => {
    await open()
    const unit = (key: string) => settingRow(key).querySelector('input[type="number"]')?.nextElementSibling?.textContent
    expect(unit("geofenceRadius")).toBe(page.unitMetersShort)
    expect(unit("maxPhotosPerVisit")).toBe(page.unitPhotosShort)
    expect(unit("lateAfterHour")).toBe(page.unitHourShort)
    expect(unit("offlineThresholdSeconds")).toBe(page.unitSecondsShort)
    // …so no title needs a unit glued to it any more.
    expect(settingRow("geofenceRadius").textContent).not.toMatch(/\((м|m)\)/)
  })

  it("keeps an unsaved change through a look at another tab, and marks the tab that holds it", async () => {
    await open()
    expect(TABS.map(mark)).toEqual([null, null, null, null, null, null])
    await flip("agentCheckInOutsideZone")
    expect(mark("visit")).toBe("unsaved")

    await openTab("alerts")
    await flip("alertLongBreak")
    expect(TABS.map(mark)).toEqual(["unsaved", null, "unsaved", null, null, null])
    // The visit tab is hidden now, but its switch still holds what was pressed.
    expect(panel("visit").hidden).toBe(true)
    expect(settingRow("agentCheckInOutsideZone").querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")

    // One save from any tab sends both changes, and only them.
    await pressSave()
    expect(writes).toEqual([{ agentCheckInOutsideZone: true, alertLongBreak: !MTM_SETTING_DEFAULTS.alertLongBreak }])
    expect(TABS.map(mark)).toEqual([null, null, null, null, null, null])
  })

  it("opens the tab with the mistake instead of refusing a save about a field nobody can see", async () => {
    await open()
    await typeNumber("geofenceRadius", "")
    expect(mark("visit")).toBe("mistake")
    await openTab("company")
    expect(shownTabs()).toEqual(["company"])

    await pressSave()
    expect(writes).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(page.saveInvalid)
    expect(shownTabs()).toEqual(["visit"])
    expect(settingRow("geofenceRadius").querySelector('[role="alert"]')?.textContent).toBe(page.errRequired)
  })

  it("leads to the field the server refused, too", async () => {
    await open()
    await openTab("alerts")
    await typeNumber("offlineThresholdSeconds", "600")
    await openTab("company")
    refuse = { status: 400, body: { errors: [{ key: "offlineThresholdSeconds", code: "MTM_SETTING_OUT_OF_RANGE" }] } }
    await pressSave()
    expect(shownTabs()).toEqual(["alerts"])
    expect(mark("alerts")).toBe("mistake")
    expect(settingRow("offlineThresholdSeconds").querySelector('[role="alert"]')).not.toBeNull()
  })

  it("shows the save bar only while there is something to save, from whichever tab is open", async () => {
    await open()
    // Nothing changed: no strip saying so under every tab.
    for (const name of TABS) {
      await openTab(name)
      expect(saveBar().hidden, name).toBe(true)
    }
    await openTab("visit")
    await flip("agentCheckInOutsideZone")
    expect(saveBar().hidden).toBe(false)
    expect(saveBar().textContent).toContain(page.dirtyIndicator)
    // The client card saves itself, but an unsaved change elsewhere stays within reach there too.
    await openTab("clients")
    expect(saveBar().hidden).toBe(false)

    await pressSave()
    expect(saveBar().hidden).toBe(true)
  })

  it("says why a switch cannot be pressed, and only where it cannot", async () => {
    await open()
    const locked = (key: string) => container.querySelector(`[data-testid="mtm-setting-locked-${key}"]`)?.textContent ?? null
    expect(locked("fieldContactsEnabled")).toBe(page.adminOnlyNote)
    expect(locked("pharmacyPromotionsEnabled")).toBe(page.adminOnlyNote)
    expect(locked("agentCheckInOutsideZone")).toBeNull()
    // The advanced block says it once in its own line, not five times.
    expect(locked("gpsInterval")).toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    viewer.role = "admin"
    await open()
    expect(locked("fieldContactsEnabled")).toBeNull()
    expect((settingRow("fieldContactsEnabled").querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(false)
  })

  // Owner, 2026-10-08, on the administrator tab, shown «coverage policies and
  // baseline snapshots» with its JSON fields and hashes: «что это такое, я сам
  // не понимаю, как буду объяснять клиенту». These five loaders of signed
  // settings files are for the person rolling the system out. No tenant on
  // production had loaded anything through four of them.
  it("keeps the rollout loaders away from everybody but an administrator, closed and unloaded until opened", async () => {
    const loaders = () => ["contact-dictionary", "attribute-packages", "coverage", "kpi", "scoring"]
      .filter((name) => container.querySelector(`[data-section="${name}"]`) !== null)
    const block = () => container.querySelector('[data-testid="mtm-settings-implementer-tools"]') as HTMLDetailsElement | null

    await open()
    await openTab("admin")
    // The account that runs the field module day to day never meets them.
    expect(block()).toBeNull()
    expect(loaders()).toEqual([])

    act(() => root.unmount())
    root = createRoot(container)
    viewer.role = "admin"
    await open()
    await openTab("admin")
    expect(tabOf(block())).toBe("admin")
    expect(block()?.open).toBe(false)
    expect(block()?.querySelector("summary")?.textContent).toContain(page.groupImplementerTools)
    // Closed, they are not even mounted: five sections do not load their data for nobody.
    expect(loaders()).toEqual([])

    await act(async () => {
      const details = block() as HTMLDetailsElement
      details.open = true
      details.dispatchEvent(new Event("toggle"))
    })
    expect(block()?.textContent).toContain(page.hintImplementerTools)
    expect(loaders()).toEqual(["contact-dictionary", "attribute-packages", "coverage", "kpi", "scoring"])
  })

  it("says where the client section went when it is switched off, instead of an empty tab", async () => {
    stored = { ...MTM_SETTING_DEFAULTS, fieldContactsEnabled: false }
    await open()
    await openTab("clients")
    expect(container.querySelector('[data-section="contact-card"]')).toBeNull()
    const note = container.querySelector('[data-testid="mtm-settings-clients-off"]')?.textContent ?? ""
    expect(note).toContain(page.tabCompany)
    expect(note).toContain(page.groupModules)
  })
})

/**
 * Owner, 2026-10-07: «нужна возможность отключения из настроек … если агент не
 * на месте, но мог делать чек-ин». The switch shipped on «Access &
 * permissions», a page only a CRM administrator opens — and the account that
 * runs the field module for the client is a CRM manager. It now stands beside
 * the zone radius; that the server takes it from whoever may set that radius
 * is held by `mtm-settings-safe-save.test.ts`.
 */
describe("allowing a check-in outside the zone, beside the radius it lifts", () => {
  it("stands in the zone card, right under the radius, off until somebody turns it on", async () => {
    await open()
    const card = container.querySelector('[data-settings-group="groupGeofence"]') as HTMLElement
    expect([...card.querySelectorAll("[data-setting-row]")].map((row) => row.getAttribute("data-setting-row")))
      .toEqual(["geofenceRadius", "agentCheckInOutsideZone"])
    const control = settingRow("agentCheckInOutsideZone").querySelector('[role="switch"]') as HTMLButtonElement
    expect(control.getAttribute("aria-checked")).toBe("false")
    // A manager is not locked out of it, unlike the administrator-only switches.
    expect(control.disabled).toBe(false)
    expect((settingRow("fieldContactsEnabled").querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true)
  })
})
