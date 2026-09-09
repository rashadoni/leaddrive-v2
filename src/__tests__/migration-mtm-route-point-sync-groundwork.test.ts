import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260828130000_mtm_route_point_sync_groundwork/migration.sql"),
  "utf8",
)

describe("R6 route-point sync groundwork migration", () => {
  it("adds an additive point revision, mutation timestamp, and keyset indexes", () => {
    expect(migration).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1')
    expect(migration).toContain('ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP')
    expect(migration).toContain('"organizationId", "routeId", "orderIndex"')
    expect(migration).toContain('"organizationId", "updatedAt", "id"')
  })

  it("documents the no-drop rollback policy for existing offline data", () => {
    expect(migration).toMatch(/retain these additive columns and indexes/i)
    expect(migration).not.toMatch(/DROP\s+COLUMN/i)
  })
})
