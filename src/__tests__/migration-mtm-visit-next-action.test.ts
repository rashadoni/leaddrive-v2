import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  "prisma/migrations/20260713170000_mtm_visit_next_action_idempotency/migration.sql",
  "utf8",
)
const schema = readFileSync("prisma/schema.prisma", "utf8")

describe("MTM visit next-action idempotency migration", () => {
  it("adds a nullable source key and a partial organization-scoped unique index", () => {
    expect(migration).toContain('ALTER TABLE "mtm_tasks" ADD COLUMN "sourceKey" TEXT')
    expect(migration).toContain('ON "mtm_tasks" ("organizationId", "sourceKey")')
    expect(migration).toContain('WHERE "sourceKey" IS NOT NULL')
    expect(schema).toMatch(/model MtmTask[\s\S]*sourceKey\s+String\?/)
  })
})
