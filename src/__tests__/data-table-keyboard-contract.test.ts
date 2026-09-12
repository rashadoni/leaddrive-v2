import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const dataTable = readFileSync("src/components/data-table.tsx", "utf8")

describe("DataTable keyboard activation contract", () => {
  it("does not activate a clickable row when Enter belongs to a nested control", () => {
    expect(dataTable).toContain("if (event.target !== event.currentTarget) return")
    expect(dataTable).toContain('event.key === "Enter" || event.key === " "')
  })

  it("keeps sort, focus and responsive table/card behavior explicit", () => {
    expect(dataTable).toContain("aria-sort=")
    expect(dataTable).toContain('<button\n                      type="button"')
    expect(dataTable).toContain("focus-visible:ring-inset")
    expect(dataTable).toContain("mobileCardRender")
    expect(dataTable).toContain('className="space-y-2 md:hidden"')
  })

  it("uses opt-in compact chrome without shrinking touch targets", () => {
    expect(dataTable).toContain('compact && "space-y-3 pb-6"')
    expect(dataTable).toContain('compact && "rounded-md border-border shadow-none"')
    expect(dataTable).not.toContain('compact && "bg-orange-')
    expect(dataTable).toContain("min-h-11 min-w-11")
    expect(dataTable).toContain("sm:min-h-9 sm:min-w-9")
    expect(dataTable).toContain('size === 0 ? t("all") : size')
    expect(dataTable).not.toContain('|| "Hamısı"')
  })
})
