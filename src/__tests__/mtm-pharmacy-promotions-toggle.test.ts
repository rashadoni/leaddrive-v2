import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { accessibleNavItems, isNavItemEnabled, matchNavItem, NAV_ORG_SETTING_KEYS } from "@/lib/nav-items"
import { visibleMtmToolGroups } from "@/lib/mtm/navigation"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"

const source = (path: string) => readFileSync(resolve(path), "utf8")
// Promotions need the MTM module itself (no Route & Field capability gate).
const routeFieldOrg = { plan: "enterprise", role: "admin", modules: { mtm: true, "route-field": true } }
const hrefs = (org: Parameters<typeof accessibleNavItems>[0]) => accessibleNavItems(org).map((item) => item.href)

describe("pharmacy promotions organization switch", () => {
  it("is ON by default and separate from the posting guard", () => {
    expect(MTM_SETTING_DEFAULTS.pharmacyPromotionsEnabled).toBe(true)
    expect(MTM_SETTING_DEFAULTS.pharmacyPromotionPostingEnabled).toBe(false)
    expect(NAV_ORG_SETTING_KEYS).toEqual(["fieldContactsEnabled", "pharmacyPromotionsEnabled"])
  })

  it("hides Aptek promoları from the menus only when explicitly off", () => {
    expect(hrefs(routeFieldOrg)).toContain("/mtm/promotions")
    expect(hrefs({ ...routeFieldOrg, orgSettings: {} })).toContain("/mtm/promotions")
    expect(hrefs({ ...routeFieldOrg, orgSettings: { pharmacyPromotionsEnabled: true } })).toContain("/mtm/promotions")

    const off = hrefs({ ...routeFieldOrg, orgSettings: { pharmacyPromotionsEnabled: false } })
    expect(off).not.toContain("/mtm/promotions")
    expect(off).toContain("/mtm/contacts")
    expect(off).toContain("/mtm/tasks")
    expect(hrefs({ ...routeFieldOrg, role: "superadmin", orgSettings: { pharmacyPromotionsEnabled: false } }))
      .not.toContain("/mtm/promotions")
    // The contacts switch does not take promotions with it.
    expect(hrefs({ ...routeFieldOrg, orgSettings: { fieldContactsEnabled: false } })).toContain("/mtm/promotions")
  })

  it("keeps the page guard and the outbox drain independent of the switch", () => {
    const item = matchNavItem("/mtm/promotions")!
    expect(isNavItemEnabled({ ...routeFieldOrg, orgSettings: { pharmacyPromotionsEnabled: false } }, item)).toBe(true)
    // The dashboard layout keys the offline promotion outbox on this item via
    // isNavItemEnabled: queued captures still drain after the switch goes off.
    const layout = source("src/app/(dashboard)/layout.tsx")
    expect(layout).toContain('const mtmSyncItem = matchNavItem("/mtm/promotions")')
    expect(layout).toContain("isNavItemEnabled(org, mtmSyncItem)")
  })

  it("hides the promotions tool from All MTM tools only when explicitly off", () => {
    const toolHrefs = (settings?: Parameters<typeof visibleMtmToolGroups>[0]) =>
      visibleMtmToolGroups(settings).flatMap((group) => group.items.map((item) => item.href))
    expect(toolHrefs()).toContain("/mtm/promotions")
    const off = toolHrefs({ pharmacyPromotionsEnabled: false })
    expect(off).not.toContain("/mtm/promotions")
    expect(off).toContain("/mtm/tasks")
    const bothOff = toolHrefs({ pharmacyPromotionsEnabled: false, fieldContactsEnabled: false })
    expect(bothOff).not.toContain("/mtm/contacts")
    expect(bothOff).not.toContain("/mtm/promotions")
  })

  it("reads both switches for every menu surface", () => {
    const hook = source("src/hooks/use-mtm-org-settings.ts")
    expect(hook).toContain("for (const key of NAV_ORG_SETTING_KEYS)")
    expect(hook).toContain('["/mtm/contacts", "/mtm/promotions"]')
    expect(hook).toContain("pharmacyPromotionsEnabled")
  })

  it("shows a localized notice on both promotions pages instead of a 404", () => {
    expect(source("src/app/(dashboard)/mtm/promotions/page.tsx"))
      .toMatch(/<MtmFeatureGate feature="pharmacyPromotionsEnabled">\s*<Suspense[\s\S]*<PharmacyPromotionWorkspace \/>[\s\S]*<\/Suspense>\s*<\/MtmFeatureGate>/)
    expect(source("src/app/(dashboard)/mtm/promotions/[id]/page.tsx"))
      .toMatch(/<MtmFeatureGate feature="pharmacyPromotionsEnabled">\s*<Suspense[\s\S]*<PharmacyPromotionDetail executionId=\{id\} \/>[\s\S]*<\/Suspense>\s*<\/MtmFeatureGate>/)

    const gate = source("src/components/mtm/mtm-feature-gate.tsx")
    expect(gate).toContain('pharmacyPromotionsEnabled: { namespace: "mtmPharmacyPromotionsDisabled", icon: Megaphone, testId: "pharmacy-promotions" }')
    expect(gate).toContain('href="/mtm/settings"')
    expect(gate).not.toContain("notFound")

    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(source(`messages/${locale}.json`))
      for (const key of ["title", "body", "openSettings", "askAdmin"]) {
        expect(typeof messages.mtmPharmacyPromotionsDisabled?.[key], `${locale} ${key}`).toBe("string")
      }
      for (const key of ["groupModules", "lblPharmacyPromotions", "hintPharmacyPromotions"]) {
        expect(typeof messages.mtmSettingsPage?.[key], `${locale} ${key}`).toBe("string")
      }
    }
    const az = JSON.parse(source("messages/az.json"))
    expect(az.mtmSettingsPage.groupModules).toBe("Modullar")
    expect(az.mtmSettingsPage.lblPharmacyPromotions).toBe("Aptek promoları")
    expect(az.mtmSettingsPage.hintPharmacyPromotions)
      .toBe("Söndürüldükdə menyudan və agent tətbiqindən gizlədilir; məlumatlar silinmir.")
  })

  it("hides the promotions tab on the customer card without touching data", () => {
    const detail = source("src/components/mtm/organization-detail.tsx")
    expect(detail).toContain("useMtmPharmacyPromotions(session?.user)")
    expect(detail).toContain('(pharmacyPromotionsEnabled || section !== "promotions")')
    expect(detail).toContain('{pharmacyPromotionsEnabled ? <TabsContent value="promotions">')
    expect(detail).toContain('(!pharmacyPromotionsEnabled && activeSection === "promotions") ? "details"')
  })

  it("renders the switch next to field contacts in the Modullar card, admin-only", () => {
    const page = source("src/app/(dashboard)/mtm/settings/page.tsx")
    const group = page.slice(page.indexOf('titleKey: "groupModules"'))
    expect(group.indexOf('key: "fieldContactsEnabled"')).toBeGreaterThan(-1)
    expect(group.indexOf('key: "pharmacyPromotionsEnabled"')).toBeGreaterThan(group.indexOf('key: "fieldContactsEnabled"'))
    expect(group.slice(0, group.indexOf("],"))).toMatch(/key: "pharmacyPromotionsEnabled".*adminOnly: true/)
    expect(page).toContain("notifyMtmSettingsChanged(moduleSwitches)")
  })
})
