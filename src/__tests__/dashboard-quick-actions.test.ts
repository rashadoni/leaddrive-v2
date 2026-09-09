import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_DASHBOARD_QUICK_ACTIONS,
  MAX_DASHBOARD_QUICK_ACTIONS,
  availableQuickActions,
  normalizeQuickActionHrefs,
  resolveQuickActions,
  storedQuickActionHrefs,
} from "@/lib/dashboard/quick-actions"
import type { OrgNavContext } from "@/lib/nav-items"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

// A tenant that can see everything, so the catalogue is at its widest.
const SUPERADMIN: OrgNavContext = { plan: "enterprise", role: "superadmin" }
// A plan-limited tenant: whatever it cannot open must not become a button.
const CRM_ONLY: OrgNavContext = { plan: "starter", role: "manager", modules: { crm: true } }

/**
 * The three buttons under the greeting shipped hardcoded — new lead, pipeline,
 * tasks. A fair guess for a sales team and wrong for anyone else, with no way
 * to say so. They are configurable now, stored per organisation beside the
 * widget config.
 *
 * A stored choice is only an href. Label, icon and whether the person may see
 * it at all are resolved from the navigation at render time, so the two ways
 * this could go wrong — a dead button into a module the tenant lost, and a
 * settings form that can point a dashboard button off-site — are closed here.
 */
describe("dashboard quick actions", () => {
  it("defaults to the set that used to be hardcoded", () => {
    expect([...DEFAULT_DASHBOARD_QUICK_ACTIONS]).toEqual(["/leads?new=1", "/deals", "/boards"])
  })

  it("sanitises without deciding policy", () => {
    // The sanitiser answers "which of these are usable paths", nothing more.
    // Folding "nothing usable means use the defaults" in here is what let a
    // save carrying `quickActions: null` overwrite a deliberately empty
    // selection with the three defaults.
    expect(normalizeQuickActionHrefs(undefined)).toEqual([])
    expect(normalizeQuickActionHrefs(null)).toEqual([])
    expect(normalizeQuickActionHrefs("/deals")).toEqual([])
    expect(normalizeQuickActionHrefs({ 0: "/deals" })).toEqual([])
    expect(normalizeQuickActionHrefs([])).toEqual([])
  })

  it("reads a stored setting as never-configured only when it is absent", () => {
    expect(storedQuickActionHrefs(undefined)).toEqual([...DEFAULT_DASHBOARD_QUICK_ACTIONS])
    expect(storedQuickActionHrefs(null)).toEqual([...DEFAULT_DASHBOARD_QUICK_ACTIONS])
    // A stored list is the tenant's decision, empty included.
    expect(storedQuickActionHrefs([])).toEqual([])
    expect(storedQuickActionHrefs(["/deals"])).toEqual(["/deals"])
  })

  it("refuses anything that is not an in-app path", () => {
    const cleaned = normalizeQuickActionHrefs([
      "/deals",
      "https://example.com/phish",
      "//example.com",
      "javascript:alert(1)",
      "",
      "   ",
      42,
      null,
      "/deals",
    ])
    // Only the in-app path survives, and only once.
    expect(cleaned).toEqual(["/deals"])
  })

  it("caps the list so the row cannot grow without limit", () => {
    const many = ["/deals", "/boards", "/contacts", "/companies", "/leads", "/invoices"]
    const cleaned = normalizeQuickActionHrefs(many)
    expect(cleaned).toHaveLength(MAX_DASHBOARD_QUICK_ACTIONS)
    expect(cleaned).toEqual(many.slice(0, MAX_DASHBOARD_QUICK_ACTIONS))
  })

  it("offers only destinations the organisation can actually open", () => {
    const wide = availableQuickActions(SUPERADMIN).map((a) => a.href)
    const narrow = availableQuickActions(CRM_ONLY).map((a) => a.href)

    expect(wide).toContain("/leads?new=1")
    expect(wide.length).toBeGreaterThan(narrow.length)
    // Every narrow choice is also a wide one; the gate only ever removes.
    for (const href of narrow) expect(wide).toContain(href)
    // A CRM-only tenant has no sales module, so no deal pipeline to offer.
    expect(narrow).not.toContain("/deals")
  })

  it("drops a configured action the tenant can no longer open", () => {
    // Configured while the tenant had sales; the module is gone now.
    const resolved = resolveQuickActions(["/deals", "/contacts"], CRM_ONLY)
    expect(resolved.map((a) => a.href)).toEqual(["/contacts"])
  })

  it("keeps the configured order and fills exactly one button", () => {
    const resolved = resolveQuickActions(["/deals", "/leads?new=1", "/boards"], SUPERADMIN)
    expect(resolved.map((a) => a.href)).toEqual(["/deals", "/leads?new=1", "/boards"])
    expect(resolved.filter((a) => a.primary)).toHaveLength(1)
    expect(resolved[0].primary).toBe(true)
  })

  it("carries the navigation group so the picker can be a tree, not a list", () => {
    const actions = availableQuickActions(SUPERADMIN)
    // Every choice knows which module it belongs to, which is what lets the
    // picker show "module → sections" instead of ~150 flat chips.
    for (const action of actions) expect(action.group).toBeTruthy()
    expect(new Set(actions.map((a) => a.group)).size).toBeGreaterThan(3)
    // Creating a lead sits with the leads list it creates into.
    const newLead = actions.find((a) => a.href === "/leads?new=1")
    const leadsList = actions.find((a) => a.href === "/leads")
    expect(newLead?.group).toBe(leadsList?.group)
  })

  it("labels the create action from dashboard copy and the rest from the nav", () => {
    const resolved = resolveQuickActions(["/leads?new=1", "/deals"], SUPERADMIN)
    expect(resolved[0]).toMatchObject({ labelNamespace: "dashboard", labelKey: "welcome.newLead" })
    expect(resolved[1].labelNamespace).toBe("nav")
    // Every action carries an icon component, so the row never renders a gap.
    for (const action of resolved) expect(typeof action.icon).not.toBe("undefined")
  })

  it("separates never-configured from deliberately empty", () => {
    // `null` is "never configured" and takes the defaults.
    expect(resolveQuickActions(null, SUPERADMIN).map((a) => a.href))
      .toEqual([...DEFAULT_DASHBOARD_QUICK_ACTIONS])
    expect(resolveQuickActions(undefined, SUPERADMIN).map((a) => a.href))
      .toEqual([...DEFAULT_DASHBOARD_QUICK_ACTIONS])
    // An empty list is a decision the settings page states out loud
    // ("nothing selected — the dashboard shows no quick actions"). Restoring
    // the defaults here would silently undo the choice on the next load.
    expect(resolveQuickActions([], SUPERADMIN)).toEqual([])
  })
})

describe("dashboard quick actions wiring", () => {
  it("persists through the same endpoint without either setting erasing the other", () => {
    const route = source("src/app/api/v1/dashboard/widget-config/route.ts")
    // Omitting quickActions from a widgets-only save must preserve what is stored.
    expect(route).toContain("quickActions === undefined")
    expect(route).toContain("storedQuickActionHrefs(currentSettings.dashboardQuickActions)")
    expect(route).toContain("dashboardQuickActions: normalizedQuickActions")
    // Validation runs server-side too, not only in the settings form.
    expect(route).toContain("normalizeQuickActionHrefs(quickActions)")
  })

  it("rejects a present-but-malformed quickActions instead of sanitising it", () => {
    const route = source("src/app/api/v1/dashboard/widget-config/route.ts")
    // `quickActions: null` in a save must not silently become the defaults and
    // overwrite a tenant's deliberately empty row. Sanitising it there would
    // be the same bug this feature exists to avoid, one trigger over.
    expect(route).toContain("quickActions !== undefined && !Array.isArray(quickActions)")
    expect(route).toContain('"Invalid quickActions config"')
    expect(route).toContain("status: 400")
  })

  it("is chosen in dashboard settings and drawn by the hero", () => {
    const settings = source("src/app/(dashboard)/settings/dashboard/page.tsx")
    const welcome = source("src/components/dashboard/dashboard-welcome.tsx")

    expect(settings).toContain("availableQuickActions(org)")
    expect(settings).toContain("MAX_DASHBOARD_QUICK_ACTIONS")

    // Only the chosen actions are on screen, each with a remove control, plus
    // one "add" that opens the navigation as a tree. The first version listed
    // every accessible destination as a flat chip — ~150 on a full tenant, a
    // wall to read rather than a choice to make.
    expect(settings).toContain("quickActions.map((href, index)")
    expect(settings).toContain("data-quick-action={href}")
    expect(settings).toContain("quickActionsRemove")
    expect(settings).toContain("data-quick-action-add")
    expect(settings).toContain("data-quick-action-option={action.href}")
    expect(settings).toContain("quickActions.length < MAX_DASHBOARD_QUICK_ACTIONS")

    // Grouped by module, searchable, and never offering what is already chosen.
    expect(settings).toContain("pickerGroups")
    expect(settings).toContain("groupLabel(group)")
    expect(settings).toContain("quickActions.includes(action.href)) continue")
    expect(settings).toContain("quickActionsSearch")

    // The hero renders whatever it is handed, and nothing when handed nothing.
    expect(welcome).toContain("quickActions.length > 0")
    expect(welcome).toContain("action.primary")
    expect(welcome).not.toContain('href="/leads?new=1"')
  })
})
