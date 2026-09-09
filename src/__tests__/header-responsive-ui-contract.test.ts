import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const header = readFileSync(resolve("src/components/header.tsx"), "utf8")

describe("global header responsive contract", () => {
  it("protects the labelled app launcher from utility-action collisions on tablets", () => {
    expect(header).toContain('data-testid="global-header"')
    expect(header).toContain('data-testid="global-header-actions"')
    expect(header).toContain("max-w-24 truncate text-sm font-semibold text-foreground sm:max-w-32 xl:max-w-none")
    expect(header).toContain('<span className="hidden sm:inline">{tNav("allApps")}</span>')
    expect(header).toContain('<span className="hidden xl:inline">{t("search")}</span>')
    expect(header).toContain('<button aria-label={t("search")} title={t("search")}')
    expect(header).toContain('className="hidden text-sm font-medium xl:block"')
    expect(header).not.toContain('<span className="hidden sm:inline">{t("search")}</span>')
    expect(header).not.toContain('className="text-sm font-medium hidden md:block"')
  })
})
