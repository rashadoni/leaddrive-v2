import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260809220000_mtm_contact_dictionary_assignments/migration.sql",
), "utf8")

describe("SWM03 governed contact dictionary assignments migration", () => {
  it("keeps contact and dictionary references inside the same tenant", () => {
    expect(migration).toContain('REFERENCES "mtm_contacts"("organizationId", "id")')
    expect(migration).toContain('REFERENCES "mtm_contact_dictionaries"("organizationId", "id")')
    expect(migration).toContain('ALTER TABLE "mtm_contact_dictionary_assignments" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
  })

  it("allows only one active psychotype and no duplicate active category code", () => {
    expect(migration).toContain('"mtm_contact_dict_assignment_active_psychotype_key"')
    expect(migration).toContain('"mtm_contact_dict_assignment_active_code_key"')
    expect(migration).toContain('WHERE "effectiveTo" IS NULL')
  })

  it("guards kind alignment and requires an active dictionary for new facts", () => {
    expect(migration).toContain("contact dictionary assignment kind mismatch")
    expect(migration).toContain("new contact dictionary assignments require an active dictionary")
    expect(migration).toContain("contact dictionary assignment entry is not in the signed dictionary")
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF \"dictionaryId\", \"kind\"")
  })

  it("does not infer or seed values from the reference image", () => {
    expect(migration).not.toMatch(/INSERT\s+INTO/i)
  })
})
