import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260829120000_mtm_agent_route_self_publish_permission/migration.sql"),
  "utf8",
)

describe("MTM agent route self-publish permission migration", () => {
  it("adds a fail-closed, additive employee grant", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "canSelfPublishRoutes" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toMatch(/existing agents.*false/i)
  })

  it("documents a forward-safe rollback instead of dropping authorization data", () => {
    expect(migration).toMatch(/Rollback is forward-safe/i)
    expect(migration).not.toMatch(/DROP\s+COLUMN/i)
  })
})
