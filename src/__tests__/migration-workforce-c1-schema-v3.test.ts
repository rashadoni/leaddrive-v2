import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260830140000_workforce_c1_workday_schema_v3/migration.sql",
), "utf8")

describe("Workforce C1 workday schema v3 migration", () => {
  it("expands the immutable event contract without rewriting legacy facts", () => {
    expect(migration).toContain('DROP CONSTRAINT "mtm_agent_workday_events_schema_version_check"')
    expect(migration).toContain('CHECK ("schemaVersion" IN (1, 2, 3))')
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/i)
  })
})
