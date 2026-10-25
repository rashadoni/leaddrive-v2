import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { isCrmCapabilityAvailable } from "@/lib/crm-product-availability"
import { navItems } from "@/lib/nav-items"
import { TENANT_MODULE_SECTIONS, TENANT_PAGE_FEATURES, isTenantModulePageEnabled } from "@/lib/admin-sidebar-catalog"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"
import { USER_MODULE_COVERAGE, hideableIdForNavItem, userModuleOptions } from "@/lib/user-module-options"

/**
 * Owner, 2026-10-25: «после каждого созданного модуля надо заново писать, чтоб
 * посмотрел, куда он делся… если создаётся модуль, он должен быть везде виден».
 * The user card, the reviewer dialog and the tenant editor all read the
 * sidebar now; these tests fail when a sidebar section has no place in them.
 */

const az = JSON.parse(readFileSync("messages/az.json", "utf8")).nav as Record<string, unknown>
const translate = (key: string) => key.split(".").reduce<unknown>(
  (node, part) => (node as Record<string, unknown> | undefined)?.[part], az,
) as string

const served = navItems.filter((item) => {
  const capability = item.capability ?? item.tenantCapability
  return !capability || isCrmCapabilityAvailable(capability)
})

describe("user card and reviewer dialog: every sidebar section has a tick", () => {
  it("covers every served sidebar page except Settings", () => {
    for (const item of served) {
      if (item.group === "Settings") continue
      const id = hideableIdForNavItem(item)
      expect(id, `${item.href} (${item.group}) has no tick`).not.toBeNull()
      expect(USER_MODULE_COVERAGE.get(id!)?.pages, item.href).toContain(item.tKey)
    }
  })

  it("names every sidebar group a tick opens, so Personnel is not invisible", () => {
    const [mtm] = userModuleOptions(["mtm"], translate)
    expect(mtm.groups).toEqual(["Route & Field", "Personnel"])
    expect(mtm.label).toBe("Marşrut & Sahə · Kadr uçotu")
    expect(mtm.pagesText).toContain(translate("pharmacyPhoneOrders"))
    expect(mtm.pagesText).toContain(translate("personnelToday"))
  })

  it("every offered tick resolves to a translated sidebar name", () => {
    const offered = userModuleOptions(USER_HIDEABLE_MODULE_IDS, translate)
    expect(offered.map((option) => option.id)).not.toContain("workforce-hrm")
    for (const option of offered) {
      expect(option.groups.length, option.id).toBeGreaterThan(0)
      expect(option.label, option.id).not.toContain("groups.")
      expect(option.label, option.id).not.toBe(option.id)
    }
  })

  it("never offers Settings", () => {
    for (const item of served.filter((entry) => entry.module === "settings")) expect(hideableIdForNavItem(item)).toBeNull()
    expect([...USER_MODULE_COVERAGE.values()].flatMap((entry) => entry.groups)).not.toContain("Settings")
  })
})

describe("tenant editor: a page behind its own flag gets a switch from the sidebar", () => {
  it("lists every nav flag on its page row", () => {
    const flagged = served.filter((item) => item.feature)
    expect(flagged.length).toBeGreaterThan(0)
    expect(TENANT_PAGE_FEATURES).toEqual([...new Set(flagged.map((item) => item.feature))])
    for (const item of flagged) {
      const row = TENANT_MODULE_SECTIONS.flatMap((section) => section.items).find((entry) => entry.href === item.href)
      expect(row?.feature, item.href).toBe(item.feature)
    }
  })

  it("shows the page as on only when both the group and the flag are on", () => {
    const row = TENANT_MODULE_SECTIONS.flatMap((section) => section.items).find((entry) => entry.href === "/pharmacy-orders")!
    const capabilities = { "route-field": false, personnel: false }
    expect(isTenantModulePageEnabled({ features: ["mtm"], capabilities }, row)).toBe(false)
    expect(isTenantModulePageEnabled({ features: ["pharmacy_phone_orders"], capabilities }, row)).toBe(false)
    expect(isTenantModulePageEnabled({ features: ["mtm", "pharmacy_phone_orders"], capabilities }, row)).toBe(true)
  })

  it("keeps no hand-written switch for a nav flag in the editor", () => {
    const page = readFileSync("src/app/admin/tenants/[id]/edit/page.tsx", "utf8")
    for (const feature of TENANT_PAGE_FEATURES) expect(page, feature).not.toContain(`"${feature}"`)
  })
})
