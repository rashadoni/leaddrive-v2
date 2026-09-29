import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { SupportPageShell } from "@/components/support/support-page-shell"

describe("SupportPageShell", () => {
  it("frames every internal Support destination and required nested workflow", () => {
    const surfaces = [
      "src/app/(dashboard)/tickets/page.tsx",
      "src/app/(dashboard)/tickets/[id]/page.tsx",
      "src/app/(dashboard)/complaints/page.tsx",
      "src/app/(dashboard)/complaints/new/page.tsx",
      "src/app/(dashboard)/complaints/import/page.tsx",
      "src/app/(dashboard)/complaints/[id]/page.tsx",
      "src/app/(dashboard)/support/agent-desktop/page.tsx",
      "src/app/(dashboard)/support/voip/page.tsx",
      "src/app/(dashboard)/knowledge-base/page.tsx",
      "src/app/(dashboard)/knowledge-base/[id]/page.tsx",
      "src/app/(dashboard)/settings/ticket-categories/page.tsx",
      "src/app/(dashboard)/settings/sla-policies/page.tsx",
      "src/app/(dashboard)/support/entitlements/page.tsx",
      "src/app/(dashboard)/settings/entitlement-templates/page.tsx",
      "src/app/(dashboard)/support/skill-routing/page.tsx",
      "src/app/(dashboard)/support/calendar/page.tsx",
      "src/app/(dashboard)/settings/escalation/page.tsx",
      "src/app/(dashboard)/settings/macros/page.tsx",
      "src/app/(dashboard)/settings/portal-users/page.tsx",
      "src/app/(dashboard)/support/ai-settings/support-ai-settings-client.tsx",
    ]

    expect(surfaces).toHaveLength(20)
    for (const file of surfaces) {
      const source = readFileSync(file, "utf8")
      expect(source, file).toContain("<SupportPageShell")
      expect(source, file).toContain("</SupportPageShell>")
    }
  })

  it("renders one compact page heading and flat semantic slots", () => {
    const html = renderToStaticMarkup(createElement(
      SupportPageShell,
      {
        title: "Service desk",
        description: "Cases needing attention",
        leading: createElement("svg", { "aria-hidden": "true" }),
        utilities: createElement("button", { type: "button" }, "Help"),
        actions: createElement("button", { type: "button" }, "New ticket"),
        notices: createElement("p", null, "Connection restored"),
        toolbar: createElement("form", { role: "search" }, "Filters"),
        "data-testid": "test-workspace",
      },
      createElement("section", { "aria-label": "Queue" }, "Primary work"),
    ))

    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).not.toContain("<main")
    expect(html).toContain('data-support-page-shell="true"')
    expect(html).toContain('data-slot="support-page-header"')
    expect(html).toContain('data-slot="support-page-actions"')
    expect(html).toContain('data-slot="support-page-notices"')
    expect(html).toContain('data-slot="support-page-toolbar"')
    expect(html).toContain('data-slot="support-page-content"')
    expect(html).toContain('<div class="mt-[var(--support-space-inline)]')
    expect(html).toContain('data-testid="test-workspace"')
  })

  it("allows structured header metadata without invalid paragraph nesting", () => {
    const html = renderToStaticMarkup(createElement(
      SupportPageShell,
      {
        title: "Case",
        description: createElement("div", null, "Status"),
      },
      "Conversation",
    ))

    expect(html).toContain('data-slot="support-page-description"')
    expect(html).not.toContain("<p")
  })

  it("keeps touch-safe utility/action rows and does not introduce a card wrapper", () => {
    const html = renderToStaticMarkup(createElement(
      SupportPageShell,
      {
        title: "Calls",
        utilities: createElement("button", { type: "button" }, "Help"),
        actions: createElement("button", { type: "button" }, "Refresh"),
        width: "wide",
      },
      "Timeline",
    ))

    expect(html).toContain("min-h-[var(--support-control-min-size)]")
    expect(html).toContain("max-w-[1180px]")
    expect(html).not.toMatch(/shadow-|rounded-(lg|xl)/)
  })

  it("uses named 4 px spacing, density, type and touch tokens", () => {
    const component = readFileSync("src/components/support/support-page-shell.tsx", "utf8")
    const styles = readFileSync("src/app/globals.css", "utf8")
    const button = readFileSync("src/components/ui/button.tsx", "utf8")
    const contentSearch = readFileSync("src/components/ai/content-search-bar.tsx", "utf8")

    expect(component).toContain('data-density={density}')
    expect(component).toContain("--support-space-section")
    expect(component).toContain("--support-control-min-size")
    expect(styles).toContain("--support-space-unit: 0.25rem")
    expect(styles).toContain('--support-control-min-size: 2.75rem')
    expect(styles).toContain('.support-page-shell[data-density="comfortable"]')
    expect(styles).toContain("--support-text-page-compact")
    expect(styles).toContain("@media (pointer: coarse)")
    expect(styles).toContain(".support-ai-search .ai-search-input")
    expect(styles).toContain(".support-ai-search .ai-search-btn")
    expect(styles).toContain("background-color: hsl(20 92% 38%) !important")
    expect(styles).toContain(".support-case-workspace")
    expect(contentSearch).toContain("support-ai-search")
    expect(contentSearch).toContain("bg-card px-1.5")
    expect(button).toContain("motion-reduce:transition-none")
    expect(button).toContain("motion-reduce:active:scale-100")
  })
})
