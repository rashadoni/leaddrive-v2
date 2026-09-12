import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SUPPORT_NAV_SECTION_ORDER, accessibleNavItems, navItems } from "@/lib/nav-items"

const read = (path: string) => readFileSync(path, "utf8")
const sidebar = read("src/components/sidebar.tsx")
const mobile = read("src/components/support-mobile-navigation.tsx")
const layout = read("src/app/(dashboard)/layout.tsx")

describe("Support navigation UX contract", () => {
  it("defines one ordered source of truth for all 15 destinations", () => {
    const support = navItems.filter((item) => item.group === "Support")
    expect(SUPPORT_NAV_SECTION_ORDER).toEqual(["work", "team", "rules"])
    expect(support).toHaveLength(15)
    expect(support.every((item) => SUPPORT_NAV_SECTION_ORDER.includes(item.supportSection!))).toBe(true)
    expect(support.filter((item) => item.supportSection === "work")).toHaveLength(5)
    expect(support.filter((item) => item.supportSection === "team")).toHaveLength(3)
    expect(support.filter((item) => item.supportSection === "rules")).toHaveLength(7)
  })

  it("preserves feature, add-on and role gates in every navigation projection", () => {
    const hrefs = (role: string, modules: Record<string, boolean>) => accessibleNavItems({ plan: "enterprise", role, modules }).map((item) => item.href)
    const agent = hrefs("agent", { support: true, complaints_register: false, voip: false, ai: false })
    expect(agent).toContain("/tickets")
    expect(agent).not.toContain("/complaints")
    expect(agent).not.toContain("/support/voip")
    expect(agent).not.toContain("/support/ai-settings")
    const admin = hrefs("admin", { support: true, complaints_register: true, voip: true, ai: true })
    expect(admin).toContain("/complaints")
    expect(admin).toContain("/support/voip")
    expect(admin).toContain("/support/ai-settings")
  })

  it("keeps subgroup state persistent, searchable, keyboard-operable and active-route safe", () => {
    expect(sidebar).toContain('localStorage.getItem("support-nav-open-sections")')
    expect(sidebar).toContain('localStorage.setItem("support-nav-open-sections"')
    expect(sidebar).toContain("activeSupportSection === section")
    expect(sidebar).toContain("sectionLabel.includes(q)")
    expect(sidebar).toContain('data-testid="support-navigation-section-toggle"')
    expect(sidebar).toContain("aria-expanded={sectionOpen}")
    expect(sidebar).toContain("focus-visible:ring-2")
    expect(sidebar).toContain("motion-reduce:transition-none")
  })

  it("provides a labeled 44px touch and keyboard control on narrow screens", () => {
    expect(layout).toContain("<SupportMobileNavigation org={org} pathname={pathname} />")
    expect(mobile).toContain('data-testid="support-mobile-navigation"')
    expect(mobile).toContain('data-testid="support-mobile-destination"')
    expect(mobile).toContain("lg:hidden")
    expect(mobile).toContain("min-h-11")
    expect(mobile).toContain("<optgroup")
    expect(mobile).toContain("router.push(event.target.value)")
  })

  it("keeps subgroup labels localized in AZ, RU, and EN", () => {
    for (const locale of ["az", "ru", "en"]) {
      const nav = (JSON.parse(read(`messages/${locale}.json`)) as { nav: Record<string, unknown> }).nav
      expect(nav).toHaveProperty("supportSections.work")
      expect(nav).toHaveProperty("supportSections.team")
      expect(nav).toHaveProperty("supportSections.rules")
      expect(nav).toHaveProperty("supportMobileLabel")
    }
  })
})
