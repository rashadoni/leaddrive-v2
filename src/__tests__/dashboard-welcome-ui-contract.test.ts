import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("dashboard welcome experience", () => {
  const page = source("src/app/(dashboard)/dashboard/page.tsx")
  const welcome = source("src/components/dashboard/dashboard-welcome.tsx")
  const leads = source("src/app/(dashboard)/leads/page.tsx")

  it("leads the dashboard with a personalized, data-backed welcome", () => {
    expect(page).toContain("<DashboardWelcome")
    expect(page).toContain("userName={session?.user?.name}")
    expect(page.indexOf("<DashboardWelcome")).toBeLessThan(page.indexOf("<QuickAccessStrip"))
    expect(welcome).toContain('useTranslations("dashboard")')
    expect(welcome).toContain("data.operations.slaBreached")
    expect(welcome).toContain("data.pipeline.deals")
  })

  it("keeps Da Vinci and the primary daily paths reachable", () => {
    expect(welcome).toContain('new CustomEvent("davinci:open"')
    // The three paths are no longer hardcoded in the hero — they are the
    // default quick-action set, which is where the guarantee now lives. The
    // hero renders whatever it is handed, so pinning the literals here would
    // only pin the wrong file.
    const quickActions = source("src/lib/dashboard/quick-actions.ts")
    for (const href of ["/leads?new=1", "/deals", "/boards"]) {
      expect(quickActions).toContain(`"${href}"`)
    }
    expect(quickActions).toContain("DEFAULT_DASHBOARD_QUICK_ACTIONS")
    // The create action still depends on the leads page reading its query.
    expect(leads).toContain('searchParams?.get("new") === "1"')
  })

  it("floats over the live wallpaper instead of covering it with a card", () => {
    const css = source("src/app/globals.css")
    const wallpaperHero = css.slice(css.indexOf('html[data-wallpaper][data-wallpaper-scope="dashboard"] .dashboard-welcome {'))
    const heroRule = wallpaperHero.slice(0, wallpaperHero.indexOf("}"))
    // The video is the visual: no plate, no blur, no rounded card under wallpaper.
    expect(heroRule).toContain("border: 0;")
    expect(heroRule).toContain("backdrop-filter: none;")
    expect(heroRule).toContain("border-radius: 0;")
    expect(css).toMatch(/html\[data-wallpaper\]\[data-wallpaper-scope="dashboard"\] \.dashboard-welcome-route \{\s*display: none;/)
  })

  it("uses a labelled form and native landmarks", () => {
    // The section is labelled by whichever half is on screen: with the
    // greeting switched off, pointing at a heading that is not rendered would
    // leave the landmark nameless.
    expect(welcome).toContain('aria-labelledby={showGreeting ? "dashboard-welcome-title" : "dashboard-brief-title"}')
    expect(welcome).toContain('htmlFor="dashboard-welcome-ai"')
    expect(welcome).toContain('aria-labelledby="dashboard-brief-title"')
    expect(welcome).toContain('<nav className="dashboard-welcome-actions"')
  })

  it("is two switchable widgets, not one block nobody can turn off", () => {
    const registry = source("src/lib/dashboard/widget-registry.ts")
    const page = source("src/app/(dashboard)/dashboard/page.tsx")

    // In the registry, so /settings/dashboard lists them like every other
    // widget. This is the whole fix: shipped outside it, the hero was the one
    // thing a tenant could not switch off.
    expect(registry).toContain('id: "welcomeGreeting"')
    expect(registry).toContain('id: "welcomeBrief"')

    // Resolved like every other widget, then drawn above the grid rather than
    // inside it — and excluded from the grid so it is never drawn twice.
    expect(page).toContain('widgets.some((widget) => widget.id === "welcomeGreeting")')
    expect(page).toContain('widgets.some((widget) => widget.id === "welcomeBrief")')
    expect(page).toContain('if (widget.id === "welcomeGreeting" || widget.id === "welcomeBrief") return false')
    expect(page).toContain("showGreeting={showGreeting}")
    expect(page).toContain("showBrief={showBrief}")

    // With neither enabled the hero renders nothing at all.
    expect(welcome).toContain("if (!showGreeting && !showBrief) return null")
  })

  it("puts the module shortcut row behind a switch too", () => {
    const registry = source("src/lib/dashboard/widget-registry.ts")
    const page = source("src/app/(dashboard)/dashboard/page.tsx")
    const css = source("src/app/globals.css")

    // Same defect as the hero had: drawn straight into the page, on screen for
    // everyone, with no control anywhere.
    expect(registry).toContain('id: "quickAccessStrip"')
    expect(page).toContain('widgets.some((widget) => widget.id === "quickAccessStrip")')
    expect(page).toContain("{showQuickAccess ? (")
    expect(page).toContain("<QuickAccessStrip />")
    expect(page).toContain('if (widget.id === "quickAccessStrip") return false')
    // Switched off, the row goes entirely — the help controls are no longer
    // in it, so there is nothing left to hold in place.
    expect(page).toContain("{showQuickAccess ? (")
    expect(css).not.toContain(".dashboard-welcome-tools-spacer")

    // The strip's overflow fades instead of ending in a hard cut against the
    // help controls, which is what made a half-visible chip read as a chip
    // that had escaped the row.
    expect(css).toContain("mask-image: linear-gradient(90deg, black calc(100% - 28px), transparent)")
    // And those controls stop being the only orange thing on a dark glass row.
    expect(css).toContain('html[data-wallpaper][data-wallpaper-scope="dashboard"] .dashboard-welcome-help > *')
  })

  it("keeps help and the tour replay out of the floating orb's corner", () => {
    const page = source("src/app/(dashboard)/dashboard/page.tsx")
    const header = source("src/components/header.tsx")
    const orb = source("src/components/ai/voice-orb.tsx")

    // The orb is fixed to the bottom right, so anything in normal page flow
    // can end up underneath it at some scroll position — which is what
    // happened to these two controls at the end of the shortcut row.
    expect(orb).toContain("fixed bottom-24 right-6")

    // The header renders them instead, right after the "all apps" button.
    expect(header).toContain('data-testid="header-page-help"')
    expect(header.indexOf('tNav("allApps")')).toBeLessThan(header.indexOf('data-testid="header-page-help"'))
    expect(header).toContain('pathname === "/dashboard" &&')
    expect(header).toContain('<TourReplayButton tourId="dashboard" />')
    expect(header).toContain('<HelpButton slug="crm-dashboard" variant="label" />')
    // And the page no longer draws them anywhere in its own flow.
    expect(page).not.toContain("<TourReplayButton")
    expect(page).not.toContain("<HelpButton")
  })
})
