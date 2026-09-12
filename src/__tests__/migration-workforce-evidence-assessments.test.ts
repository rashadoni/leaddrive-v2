import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830100000_workforce_evidence_assessments/migration.sql",
), "utf8")

describe("Workforce evidence and assessment migration", () => {
  it("separates encrypted raw evidence from immutable derived assessments", () => {
    expect(schema).toContain("model WorkforceAttendanceEvidence {")
    expect(schema).toContain("model WorkforceEvidenceAssessment {")
    expect(schema).toContain("rawEnvelopeCiphertext")
    expect(schema).toContain("rawPurgedAt")
    expect(migration).toContain('CREATE TABLE "workforce_attendance_evidence"')
    expect(migration).toContain('CREATE TABLE "workforce_evidence_assessments"')
    expect(migration).toContain('workforce_guard_attendance_evidence')
    expect(migration).toContain('workforce_reject_evidence_assessment_mutation')
    expect(migration).toContain('"rawEnvelopeCiphertext" IS NULL')
  })

  it("uses tenant RLS and never adds a plaintext latitude/longitude evidence column", () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).not.toMatch(/"(?:latitude|longitude|accuracy)"\s+(?:FLOAT|DOUBLE|NUMERIC)/i)
  })

  it("can attach evidence to an immutable site transition without weakening its tenant boundary", () => {
    expect(schema).toContain("siteTransitionId     String?")
    expect(schema).toContain("siteTransition       WorkforceSiteTransition?")
    expect(migration).toContain('"siteTransitionId" TEXT')
    expect(migration).toContain('"workforce_attendance_evidence_transition_fkey"')
    expect(migration).toContain('REFERENCES "workforce_site_transitions"("organizationId", "id")')
    expect(migration).toContain('"workdayEventId" IS NULL AND "siteTransitionId" IS NOT NULL')
  })
})
