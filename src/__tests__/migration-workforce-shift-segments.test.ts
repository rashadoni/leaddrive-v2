import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830060000_workforce_shift_segments/migration.sql",
), "utf8")

describe("Workforce ordered shift segment migration", () => {
  it("models one tenant-owned multi-site day without a Route dependency", () => {
    expect(schema).toContain("enum WorkforceShiftSegmentMode {")
    expect(schema).toContain("model WorkforceShiftSegment {")
    expect(schema).toContain("segments    WorkforceShiftSegment[]")
    expect(migration).toContain('CREATE TABLE "workforce_shift_segments"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"')
    expect(migration).not.toMatch(/mtm_customers|mtm_routes|mtm_route/i)
  })

  it("requires explicit site ownership, valid ordered windows and draft-only mutation", () => {
    for (const mode of ["SITE", "REMOTE", "FIELD", "TRAVEL", "ON_CALL", "EXCEPTION"]) {
      expect(migration).toContain(`'${mode}'`)
    }
    expect(migration).toContain("workforce_shift_segments_site_mode_check")
    expect(migration).toContain("workforce_shift_segments_time_format_check")
    expect(migration).toContain("workforce_shift_segments_grace_check")
    expect(migration).toContain("workforce_shift_segments_draft_only")
    expect(migration).toContain("workforce_shift_segments_validate_order")
    expect(migration).toContain("Published Workforce shift segments are immutable")
  })

  it("uses fail-closed tenant RLS and has no direct history rewrite", () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"workforce_shift_segments"/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"workforce_shift_segments"/i)
  })
})
