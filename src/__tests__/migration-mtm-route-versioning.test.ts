import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(resolve(
  "prisma/migrations/20260730034500_mtm_route_versioning/migration.sql",
), "utf8")

describe("MTM route versioning migration", () => {
  it("adds an optimistic concurrency version without invalidating existing routes", () => {
    expect(sql).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1')
    expect(sql).toContain('ADD COLUMN "publishedVersion" INTEGER')
    expect(sql).not.toContain('ADD COLUMN "publishedVersion" INTEGER NOT NULL')
    expect(sql).toContain('SET "publishedVersion" = "version"')
    expect(sql).toContain('WHERE "publishedAt" IS NOT NULL')
  })
})
