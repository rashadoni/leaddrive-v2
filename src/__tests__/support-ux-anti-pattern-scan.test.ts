import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const scanner = "scripts/check-support-ux-anti-patterns.mjs"

describe("Support UX deterministic anti-pattern scan", () => {
  it("keeps every internal and customer-facing Support surface in the full inventory", () => {
    const source = readFileSync(scanner, "utf8")
    for (const routeRoot of [
      "tickets", "complaints", "agent-desktop", "voip", "entitlements",
      "skill-routing", "calendar", "ai-settings", "knowledge-base",
      "ticket-categories", "sla-policies", "entitlement-templates",
      "escalation", "macros", "portal-users", "portal/chat", "ticket-closure",
      "components/data-table", "components/delete-confirm-dialog",
      "components/ai-assistant-panel", "components/ai/content-search-bar",
      "components/kb-article-form", "components/portal-chat-widget",
      "components/sla-policy-form", "components/support-mobile-navigation",
      "components/ticket-form", "components/support", "components/tickets",
      "components/voip",
    ]) {
      expect(source).toContain(routeRoot)
    }
  })

  it("fails closed on prohibited visual, interaction, copy, and motion patterns", () => {
    const source = readFileSync(scanner, "utf8")
    for (const rule of [
      "generic-ai-palette-or-gradient",
      "decorative-colored-side-stripe",
      "oversized-page-typography",
      "undersized-interface-copy",
      "hardcoded-file-size-unit",
      "generic-glass-or-heavy-shadow",
      "native-blocking-dialog",
      "animation-without-reduced-motion",
      "transition-without-reduced-motion",
      "undersized-summary-target",
      "summary-without-focus-state",
      "native-button-without-focus-state",
      "undersized-native-button-target",
      "hardcoded-localizable-attribute",
      "hardcoded-visible-copy",
      "unlabelled-native-form-control",
    ]) {
      expect(source).toContain(rule)
    }
    expect(source).toContain("process.exitCode = 1")
  })

  it("supports section-scoped audits without weakening the full inventory", () => {
    const output = execFileSync(process.execPath, [scanner], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPPORT_UX_SCAN_ROOTS: [
          "src/app/(dashboard)/tickets",
          "src/components/ticket-form.tsx",
          "src/components/tickets",
          "src/components/support/support-page-shell.tsx",
          "src/components/data-table.tsx",
          "src/components/delete-confirm-dialog.tsx",
        ].join(","),
      },
    })
    expect(output).toMatch(/passed: \d+ visible TSX files, 0 findings/)
  })
})
