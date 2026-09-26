import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { MTM_ROUTE_TARGET_TYPE_DEFAULTS } from "@/lib/mtm/route-target-types"

const source = readFileSync(
  resolve("src/app/(dashboard)/mtm/settings/route-target-type-settings.tsx"),
  "utf8",
)

describe("tenant route category settings", () => {
  it("includes doctors in the default SaaS taxonomy", () => {
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "doctors", direction: "DOCTOR", enabled: true }),
    ]))
  })

  it("lets an administrator add, edit, enable, delete and reorder categories", () => {
    expect(source).toContain("function addRow()")
    expect(source).toContain("function updateLabel(")
    expect(source).toContain('role="switch"')
    expect(source).toContain("rows.filter((candidate) => candidate.id !== row.id)")
    expect(source).toContain("function moveRow(index: number, direction: -1 | 1)")
    expect(source).toContain("moveRow(index, -1)")
    expect(source).toContain("moveRow(index, 1)")
  })
})
