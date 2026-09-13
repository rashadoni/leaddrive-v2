import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830150000_workforce_employment_history/migration.sql",
), "utf8")
const employmentHistory = readFileSync(join(root, "src/lib/workforce/employment-history.ts"), "utf8")

describe("Workforce employment history migration", () => {
  it("adds append-only, tenant-scoped lifecycle facts without deriving them from directory status", () => {
    expect(schema).toContain("enum WorkforceEmploymentEventKind")
    expect(schema).toContain("model WorkforceEmploymentEvent {")
    expect(schema).toContain("workforceEmploymentEvents WorkforceEmploymentEvent[]")
    expect(schema).toMatch(/model WorkforceEmploymentEvent \{[\s\S]*@@ignore\s*\}/)
    expect(employmentHistory).toContain('INSERT INTO "workforce_employment_events"')
    expect(employmentHistory).not.toContain("tx.workforceEmploymentEvent")
    expect(migration).toContain('CREATE TABLE "workforce_employment_events"')
    expect(migration).toContain('CREATE TYPE "WorkforceEmploymentEventKind"')
    expect(migration).toContain("workforce_reject_employment_event_mutation")
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
  })

  it("does not backfill legal lifecycle status from mutable employee directory values", () => {
    expect(migration).toMatch(/does not translate a mutable directory/i)
    expect(migration).not.toMatch(/INSERT INTO "workforce_employment_events"/)
    expect(migration).not.toContain("AFTER INSERT OR UPDATE OF \"status\" ON \"mtm_agents\"")
  })
})
