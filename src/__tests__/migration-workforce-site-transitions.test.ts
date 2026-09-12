import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830070000_workforce_site_transitions/migration.sql",
), "utf8")

describe("Workforce site-transition migration", () => {
  it("stores one append-only arrival/departure claim against a workday and planned segment", () => {
    expect(schema).toContain("enum WorkforceSiteTransitionKind {")
    expect(schema).toContain("model WorkforceSiteTransition {")
    expect(migration).toContain('CREATE TABLE "workforce_site_transitions"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "segmentId") REFERENCES "workforce_shift_segments"')
    expect(migration).toContain('"attendanceReviewState" "WorkforceAttendanceClaimReviewState"')
    expect(migration).toContain('CREATE UNIQUE INDEX "workforce_site_transitions_org_workday_segment_kind_key"')
  })

  it("does not store raw GPS, QR or device proof and never turns a transition into Route data", () => {
    const start = schema.indexOf("model WorkforceSiteTransition {")
    const transitionSchema = schema.slice(start, schema.indexOf("// Effective-dated assignment only.", start))
    expect(transitionSchema).not.toMatch(/latitude|longitude|qrToken|signature|biometric/i)
    expect(migration).not.toMatch(/mtm_customers|mtm_routes|mtm_route/i)
  })

  it("uses RLS, append-only history and arrival-before-departure ordering", () => {
    expect(migration).toContain("workforce_site_transitions_append_only")
    expect(migration).toContain("workforce_site_transitions_validate_order")
    expect(migration).toContain("departure requires an earlier arrival claim")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"workforce_site_transitions"/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"workforce_site_transitions"/i)
  })
})
