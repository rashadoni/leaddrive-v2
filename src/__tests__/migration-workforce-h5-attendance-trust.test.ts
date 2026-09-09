import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260829100000_workforce_h5_attendance_trust/migration.sql",
), "utf8")

describe("Workforce H5 attendance trust migration", () => {
  it("adds scoped QR, public-key enrollment, one-time challenge, and verification facts", () => {
    for (const model of [
      "WorkforceAttendanceQrStation",
      "WorkforceAttendanceDeviceEnrollment",
      "WorkforceAttendanceDeviceEnrollmentChallenge",
      "WorkforceAttendanceVerification",
    ]) {
      expect(schema).toContain(`model ${model} {`)
    }
    for (const table of [
      "workforce_attendance_qr_stations",
      "workforce_attendance_device_enrollments",
      "workforce_attendance_device_enrollment_challenges",
      "workforce_attendance_verifications",
    ]) {
      expect(migration).toContain(`CREATE TABLE \"${table}\"`)
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('CREATE UNIQUE INDEX "workforce_attendance_verifications_nonce_key"')
    expect(migration).toContain('CREATE TRIGGER workforce_attendance_verifications_append_only')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "workforce_attendance_verifications"')
    expect(migration).toContain("(to_jsonb(NEW) - ARRAY['consumedAt'])")
  })

  it("requires only verifiable public-key proofs and never stores biometric material", () => {
    const h5Schema = schema.slice(schema.indexOf("model WorkforceAttendanceQrStation"))
    expect(h5Schema).toContain("publicKeySpki")
    expect(h5Schema).toContain("publicKeyFingerprint")
    expect(h5Schema).not.toMatch(/biometric(?:Template|Data|Result|Hash)/i)
    expect(migration).toMatch(/biometric templates and\s+-- biometric results are never stored/)
    expect(migration).toContain('FOREIGN KEY ("organizationId", "workdayEventId") REFERENCES "mtm_agent_workday_events"')
    expect(migration).toContain('policyDefinitionHash')
  })

  it("uses fail-closed RLS and grants no ordinary delete path", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("current_setting(''app.org_id'', true)")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE")
    expect(migration).toContain("GRANT SELECT, INSERT ON TABLE")
    expect(migration).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE")
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"?workforce_attendance/i)
  })
})
