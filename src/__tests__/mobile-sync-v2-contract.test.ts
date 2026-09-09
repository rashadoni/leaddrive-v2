import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const contract = readFileSync(join(process.cwd(), "docs/mobile-sync-v2-routes-contract.md"), "utf8")

describe("MTM mobile sync v2 routes contract", () => {
  it("pins revision-ordered atomic merge semantics for items and tombstones", () => {
    expect(contract).toContain("combines `items` and `tombstones`")
    expect(contract).toContain("decimal `revision` ascending")
    expect(contract).toContain("highest applied revision for each `(entityType, id)`")
    expect(contract).toContain("atomically persists that full")
    expect(contract).toContain("initial snapshot")
    expect(contract).toContain("`complete: true`")
  })
})
