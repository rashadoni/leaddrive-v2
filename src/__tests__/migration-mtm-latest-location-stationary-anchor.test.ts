import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20261009200000_mtm_latest_location_stationary_anchor/migration.sql",
), "utf8")
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")
const statements = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n")

// No CI step compares schema.prisma with the SQL of a migration, and the
// Postgres gates build their database with `db push`. A column misspelled
// here would fail every GPS write of a standing employee on production while
// the health check stayed green. This test and the Postgres case that replays
// this very file are the guard.
describe("MTM latest-location stationary anchor migration", () => {
  it("adds exactly the three columns the schema names, nullable and without a default", () => {
    expect(statements).toContain('ALTER TABLE "mtm_agent_latest_locations"')
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS "stationarySince" TIMESTAMP(3),')
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS "stationaryLatitude" DOUBLE PRECISION,')
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS "stationaryLongitude" DOUBLE PRECISION;')
    expect(statements.match(/ADD COLUMN/g)).toHaveLength(3)
    expect(statements).not.toMatch(/NOT NULL|DEFAULT/i)
    const model = schema.slice(schema.indexOf("model MtmAgentLatestLocation {"), schema.indexOf('@@map("mtm_agent_latest_locations")'))
    expect(model).toMatch(/\n\s+stationarySince\s+DateTime\?\n/)
    expect(model).toMatch(/\n\s+stationaryLatitude\s+Float\?\n/)
    expect(model).toMatch(/\n\s+stationaryLongitude\s+Float\?\n/)
  })

  it("is additive: nothing dropped, no backfill, the row-level-security policy left alone", () => {
    expect(statements).not.toMatch(/DROP\s|UPDATE\s|DELETE\s|POLICY|ROW LEVEL SECURITY|CREATE\s+INDEX/i)
    // Fails fast rather than queueing behind a long GPS batch.
    expect(statements).toContain("SET lock_timeout = '3s';")
  })
})
