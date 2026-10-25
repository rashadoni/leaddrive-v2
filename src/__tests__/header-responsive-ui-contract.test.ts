import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const header = readFileSync(resolve("src/components/header.tsx"), "utf8")

describe("global header responsive contract", () => {
  it("protects the labelled app launcher from utility-action collisions on tablets", () => {
    expect(header).toContain('data-testid="global-header"')
    expect(header).toContain('data-testid="global-header-actions"')
    expect(header).toContain("hidden max-w-24 truncate text-sm font-semibold text-foreground sm:inline sm:max-w-32 xl:max-w-none")
    expect(header).toContain('<span className="hidden sm:inline">{tNav("allApps")}</span>')
    expect(header).toContain('<span className="hidden xl:inline">{t("search")}</span>')
    expect(header).toContain('<button aria-label={t("search")} title={t("search")}')
    expect(header).toContain('className="hidden text-sm font-medium xl:block"')
    expect(header).not.toContain('<span className="hidden sm:inline">{t("search")}</span>')
    expect(header).not.toContain('className="text-sm font-medium hidden md:block"')
  })

  it("keeps the avatar (the way into the profile) on screen on phones", () => {
    // 2026-10-25, owner on a phone: language, wallpaper, theme and the
    // dashboard's labelled help controls pushed the avatar past the right edge,
    // so the profile could not be opened at all.
    expect(header).toContain('<div className="hidden items-center gap-1 sm:gap-2 md:flex">')
    expect(header).toContain('className="hidden md:inline-flex"')
    expect(header).toContain('<div className="md:hidden">')
    expect(header).toContain("switchLocale(code)")
    expect(header).toContain('<HelpButton slug="crm-dashboard" variant="icon" className="xl:hidden" />')
    expect(header).toContain('className="flex min-w-0 items-center gap-2 overflow-x-clip sm:gap-4"')
  })
})
