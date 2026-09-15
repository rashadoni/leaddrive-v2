import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { accessibleNavItems, isNavItemEnabled, matchNavItem } from "@/lib/nav-items"
import { visibleMtmToolGroups } from "@/lib/mtm/navigation"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { MTM_ROUTE_TARGET_TYPE_DEFAULTS, routeTargetTypesForFieldContacts } from "@/lib/mtm/route-target-types"
import { mtmRouteAssignmentCatalogHref } from "@/lib/mtm/route-links"

const source = (path: string) => readFileSync(resolve(path), "utf8")
const routeFieldOrg = { plan: "enterprise", role: "admin", modules: { "route-field": true } }
const hrefs = (org: Parameters<typeof accessibleNavItems>[0]) => accessibleNavItems(org).map((item) => item.href)

describe("field contacts organization switch", () => {
  it("is ON by default so existing tenants see no change", () => {
    expect(MTM_SETTING_DEFAULTS.fieldContactsEnabled).toBe(true)
  })

  it("hides Sahə kontaktları from the menus only when explicitly off", () => {
    expect(hrefs(routeFieldOrg)).toContain("/mtm/contacts")
    expect(hrefs({ ...routeFieldOrg, orgSettings: {} })).toContain("/mtm/contacts")
    expect(hrefs({ ...routeFieldOrg, orgSettings: { fieldContactsEnabled: true } })).toContain("/mtm/contacts")

    const off = hrefs({ ...routeFieldOrg, orgSettings: { fieldContactsEnabled: false } })
    expect(off).not.toContain("/mtm/contacts")
    // Nothing else in Route & Field goes with it.
    expect(off).toContain("/mtm/customers")
    expect(off).toContain("/mtm/visits")
    // Superadmin menus follow the organization switch too.
    expect(hrefs({ plan: "enterprise", role: "superadmin", modules: { "route-field": true }, orgSettings: { fieldContactsEnabled: false } }))
      .not.toContain("/mtm/contacts")
  })

  it("keeps the page reachable by URL so it can explain the switch", () => {
    // The dashboard page guard uses isNavItemEnabled. If the switch leaked into
    // it, the page would claim the whole module is not enabled.
    const item = matchNavItem("/mtm/contacts")!
    expect(isNavItemEnabled({ ...routeFieldOrg, orgSettings: { fieldContactsEnabled: false } }, item)).toBe(true)
  })

  it("hides the contacts tool from All MTM tools only when explicitly off", () => {
    const toolHrefs = (settings?: { fieldContactsEnabled?: boolean }) =>
      visibleMtmToolGroups(settings).flatMap((group) => group.items.map((item) => item.href))
    expect(toolHrefs()).toContain("/mtm/contacts")
    expect(toolHrefs({ fieldContactsEnabled: true })).toContain("/mtm/contacts")
    const off = toolHrefs({ fieldContactsEnabled: false })
    expect(off).not.toContain("/mtm/contacts")
    expect(off).toContain("/mtm/customers")
    expect(visibleMtmToolGroups({ fieldContactsEnabled: false }).map((group) => group.key))
      .toEqual(["work", "reference", "control", "analytics", "administration"])
  })

  it("feeds the switch to every menu surface", () => {
    for (const path of [
      "src/app/(dashboard)/layout.tsx",
      "src/components/command-search.tsx",
      "src/components/dashboard/quick-access-strip.tsx",
    ]) {
      expect(source(path), path).toContain("useNavOrgContext(")
    }
    const moduleNav = source("src/components/mtm/mtm-module-navigation.tsx")
    expect(moduleNav).toContain("visibleMtmToolGroups(useMtmOrgSettings(")
    expect(moduleNav).not.toContain("MTM_TOOL_GROUPS.map")
  })

  it("shows a localized notice on /mtm/contacts instead of a 404 when off", () => {
    const page = source("src/app/(dashboard)/mtm/contacts/page.tsx")
    expect(page).toMatch(/<FieldContactsGate>\s*<MtmContactExplorer \/>\s*<\/FieldContactsGate>/)

    expect(source("src/components/mtm/field-contacts-gate.tsx"))
      .toContain('<MtmFeatureGate feature="fieldContactsEnabled">{children}</MtmFeatureGate>')
    const gate = source("src/components/mtm/mtm-feature-gate.tsx")
    expect(gate).toContain("if (enabled) return <>{children}</>")
    expect(gate).toContain('href="/mtm/settings"')
    expect(gate).not.toContain("notFound")

    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(source(`messages/${locale}.json`))
      for (const key of ["title", "body", "openSettings", "askAdmin"]) {
        expect(typeof messages.mtmFieldContactsDisabled?.[key], `${locale} ${key}`).toBe("string")
      }
      for (const key of ["groupModules", "lblFieldContacts", "hintFieldContacts"]) {
        expect(typeof messages.mtmSettingsPage?.[key], `${locale} ${key}`).toBe("string")
      }
    }
    const az = JSON.parse(source("messages/az.json"))
    expect(az.mtmSettingsPage.lblFieldContacts).toBe("Sahə kontaktları (həkim, əczaçı və s.)")
    expect(az.mtmSettingsPage.hintFieldContacts)
      .toBe("Söndürüldükdə menyudan və agent tətbiqindən kontaktlar gizlədilir; məlumatlar silinmir.")
  })

  it("holds a neutral placeholder until the switch is known", () => {
    const gate = source("src/components/mtm/mtm-feature-gate.tsx")
    const skeleton = gate.indexOf("if (!ready)")
    const children = gate.indexOf("if (enabled) return <>{children}</>")
    expect(skeleton).toBeGreaterThan(-1)
    expect(children).toBeGreaterThan(skeleton)
    // The shared gate builds its test ids from the feature config.
    expect(gate).toContain('data-testid={`${config.testId}-loading`}')
    expect(gate).toContain('fieldContactsEnabled: { namespace: "mtmFieldContactsDisabled", icon: UsersRound, testId: "field-contacts" }')
  })

  it("gates the contact card page with the same notice", () => {
    expect(source("src/app/(dashboard)/mtm/contacts/[id]/page.tsx"))
      .toMatch(/<FieldContactsGate>\s*<MtmContactDetail contactId=\{id\} \/>\s*<\/FieldContactsGate>/)
  })

  it("stops offering doctor targets to planners while keeping the stored config", () => {
    const off = routeTargetTypesForFieldContacts(MTM_ROUTE_TARGET_TYPE_DEFAULTS, false)
    expect(off.some((target) => target.direction === "DOCTOR")).toBe(false)
    expect(off.map((target) => target.id)).toContain("all-customers")
    expect(routeTargetTypesForFieldContacts(MTM_ROUTE_TARGET_TYPE_DEFAULTS, true)).toEqual(MTM_ROUTE_TARGET_TYPE_DEFAULTS)
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS.some((target) => target.direction === "DOCTOR")).toBe(true)

    for (const path of ["src/components/mtm/route-builder.tsx", "src/components/mtm/route-planning-matrix.tsx"]) {
      expect(source(path), path).toContain("routeTargetTypesForFieldContacts(")
      expect(source(path), path).toContain("settingsResult.data?.fieldContactsEnabled !== false")
    }
  })

  it("sends the doctor direction to customers when contacts are off", () => {
    const input = { agentId: "a1", date: "2026-09-15", direction: "DOCTOR" as const }
    expect(new URL(mtmRouteAssignmentCatalogHref(input), "http://x").pathname).toBe("/mtm/contacts")
    expect(new URL(mtmRouteAssignmentCatalogHref({ ...input, fieldContactsEnabled: false }), "http://x").pathname).toBe("/mtm/customers")
  })

  it("hides contact entry points on customer and week screens without touching data", () => {
    const detail = source("src/components/mtm/organization-detail.tsx")
    expect(detail).toContain("useMtmFieldContacts(session?.user)")
    expect(detail).toContain('.filter(([section]) => (fieldContactsEnabled || section !== "contacts")')
    expect(detail).toContain('{fieldContactsEnabled ? <TabsContent value="contacts">')
    expect(detail).toContain("...(fieldContactsEnabled ? [[t(\"detail.contacts\")")

    const week = source("src/components/mtm/operational-week-home.tsx")
    expect(week).toContain("useMtmFieldContacts(")
    expect(week).toContain("point.contactId && point.contactName && !fieldContactsEnabled ?")
    expect(week).toContain("(fieldContactsEnabled ? `/mtm/contacts/${encodeURIComponent(row.subjectId)}` : null)")

    const settings = source("src/app/(dashboard)/mtm/settings/page.tsx")
    expect(settings).toMatch(/settings\.fieldContactsEnabled !== false \? \(\s*<ContactRequiredFieldSettings/)
  })

  it("renders the switch on /mtm/settings for administrators only", () => {
    const page = source("src/app/(dashboard)/mtm/settings/page.tsx")
    expect(page).toContain('key: "fieldContactsEnabled"')
    expect(page).toContain("adminOnly: true")
    expect(page).toContain("notifyMtmSettingsChanged(")
  })
})
