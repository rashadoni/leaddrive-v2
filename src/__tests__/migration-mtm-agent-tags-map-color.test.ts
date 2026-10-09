import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20261010090000_mtm_agent_tags_map_color/migration.sql",
), "utf8")
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")
const statements = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n")

// No CI step compares schema.prisma with the SQL of a migration, and the
// Postgres gates build their database with `db push`. A column misspelled here
// — `mapcolor` without the quotes is the likely one — would fail every read of
// the employee list on production while the health check stayed green. This
// text test is the guard until the file is replayed on a real Postgres.
describe("MTM employee labels and map colour migration", () => {
  it("adds exactly the two columns the schema names", () => {
    expect(statements).toContain('ALTER TABLE "mtm_agents"')
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],')
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS "mapColor" TEXT;')
    expect(statements.match(/ADD COLUMN/g)).toHaveLength(2)
    const model = schema.slice(schema.indexOf("model MtmAgent {"), schema.indexOf('@@map("mtm_agents")'))
    expect(model).toMatch(/\n\s+tags\s+String\[\]\s+@default\(\[\]\)\n/)
    expect(model).toMatch(/\n\s+mapColor\s+String\?\n/)
  })

  it("leaves every existing employee as he was: no labels, no colour, nothing to backfill", () => {
    // A row inserted by the previous build, which does not know the columns,
    // gets the empty list and NULL from the database itself.
    expect(statements).toMatch(/"tags" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/)
    expect(statements).not.toMatch(/"mapColor" TEXT\s+NOT NULL/i)
    expect(statements).not.toMatch(/UPDATE\s|INSERT\s|DELETE\s/i)
  })

  it("is additive: nothing dropped, no index, the row-level-security policy left alone", () => {
    expect(statements).not.toMatch(/DROP\s|POLICY|ROW LEVEL SECURITY|CREATE\s+INDEX|ALTER\s+COLUMN/i)
    expect(migration).toMatch(/Rollback is forward-safe/i)
    // Fails fast rather than queueing behind a long write to the employee table.
    expect(statements).toContain("SET lock_timeout = '3s';")
    expect(statements.indexOf("SET lock_timeout")).toBeLessThan(statements.indexOf("ALTER TABLE"))
  })
})
