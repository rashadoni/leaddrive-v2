import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260831223000_workforce_c9_workday_schema_v4/migration.sql",
), "utf8")

describe("Workforce C9 workday schema v4 migration", () => {
  it("adds action-time location metadata compatibility without rewriting facts", () => {
    expect(migration).toContain('DROP CONSTRAINT "mtm_agent_workday_events_schema_version_check"')
    expect(migration).toContain('CHECK ("schemaVersion" IN (1, 2, 3, 4))')
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/i)
  })
})
