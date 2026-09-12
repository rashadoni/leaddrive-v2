import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/components/ai-assistant-panel.tsx", "utf8")
const searchSource = readFileSync("src/components/ai/content-search-bar.tsx", "utf8")
const layoutSource = readFileSync("src/app/(dashboard)/layout.tsx", "utf8")
const scanner = readFileSync("scripts/check-support-ux-anti-patterns.mjs", "utf8")

describe("Support-visible Da Vinci overlay contract", () => {
  it("uses the calm product token system instead of a generic AI treatment", () => {
    expect(source).not.toMatch(/bg-gradient|glass-panel|shadow-2xl|ai-glow|animate-pulse-glow/)
    expect(source).not.toContain("--ai-from")
    expect(source).toContain("bg-primary text-primary-foreground shadow-sm")
    expect(source).toContain("border-l bg-background shadow-lg")
    expect(scanner).toContain('"src/components/ai-assistant-panel.tsx"')
  })

  it("provides named touch-safe controls, Escape handling and focus return", () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-label={uiText.title}')
    expect(source).toContain('event.key === "Escape"')
    expect(source).toContain("launcherRef.current?.focus()")
    expect(source).toContain("aria-label={uiText.clear}")
    expect(source).toContain("aria-label={uiText.close}")
    expect(source).toContain("aria-label={uiText.send}")
    expect(source).toContain("h-11 w-11")
  })

  it("localizes overlay actions and respects locale and reduced motion", () => {
    for (const key of ["collapse", "expand", "clear", "close", "send", "recipient", "fields", "unknownAction"]) {
      expect(source.match(new RegExp(`${key}:`, "g"))?.length, key).toBeGreaterThanOrEqual(3)
    }
    expect(source).toContain("toLocaleTimeString(locale")
    expect(source).toContain('matchMedia("(prefers-reduced-motion: reduce)")')
    expect(source).toContain("motion-reduce:animate-none")
    expect(source).toContain("motion-reduce:transition-none")
    expect(source).not.toContain("return message.replace")
    expect(source).not.toContain("|| action.tool")
    expect(source).not.toContain('join(", ")')
  })

  it("uses the compact, stable search treatment on every internal Support route", () => {
    expect(searchSource).toContain("ContentSearchBar({ compact = false }")
    expect(searchSource).toContain("compact || focused || q")
    expect(searchSource).toContain('matchMedia("(prefers-reduced-motion: reduce)")')
    expect(searchSource).toContain("ai-search-bar support-ai-search mb-3 flex min-h-11")
    expect(searchSource).toContain("h-11 w-11")
    expect(layoutSource).toContain("<ContentSearchBar compact={compactSupportSearch} />")
    for (const prefix of [
      "/tickets", "/complaints", "/knowledge-base", "/support",
      "/settings/ticket-categories", "/settings/sla-policies",
      "/settings/entitlement-templates", "/settings/escalation",
      "/settings/macros", "/settings/portal-users",
    ]) {
      expect(layoutSource).toContain(`"${prefix}"`)
    }
    expect(scanner).toContain('"src/components/ai/content-search-bar.tsx"')
  })
})
