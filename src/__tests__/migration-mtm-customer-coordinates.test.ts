import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(
  join(process.cwd(), "prisma/migrations/20260905160000_mtm_customer_coordinates_null_island/migration.sql"),
  "utf8",
)

describe("MTM customer coordinates migration (field UX audit A1)", () => {
  it("backfills Null Island and half pairs to NULL on both tables", () => {
    expect(sql).toContain("ARRAY['mtm_customers', 'mtm_customer_create_requests']")
    expect(sql).toContain('SET "latitude" = NULL, "longitude" = NULL')
    expect(sql).toContain('("latitude" = 0 AND "longitude" = 0)')
    expect(sql).toContain('(("latitude" IS NULL) <> ("longitude" IS NULL))')
  })

  it("bumps updatedAt so mobile delta sync replaces cached 0,0", () => {
    expect(sql).toContain('"updatedAt" = CURRENT_TIMESTAMP')
  })

  it("runs the backfill through the RLS snapshot/disable/restore pattern", () => {
    expect(sql).toContain("SELECT relrowsecurity, relforcerowsecurity")
    expect(sql).toContain("DISABLE ROW LEVEL SECURITY")
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).toContain("FORCE ROW LEVEL SECURITY")
    expect(sql).toContain("NO FORCE ROW LEVEL SECURITY")
  })

  it("adds an idempotent CHECK constraint that rejects 0,0 and half pairs", () => {
    for (const table of ["mtm_customers", "mtm_customer_create_requests"]) {
      expect(sql).toContain(`conname = '${table}_coordinates_check'`)
      expect(sql).toContain(`ADD CONSTRAINT "${table}_coordinates_check" CHECK (`)
    }
    expect(sql).toContain('("latitude" IS NULL AND "longitude" IS NULL)')
    expect(sql).toContain('"latitude" IS NOT NULL AND "longitude" IS NOT NULL AND NOT ("latitude" = 0 AND "longitude" = 0)')
  })
})
