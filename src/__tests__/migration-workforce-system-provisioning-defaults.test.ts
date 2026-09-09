import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260829140000_workforce_system_provisioning_defaults/migration.sql",
), "utf8")

describe("Workforce system provisioning provenance migration", () => {
  it("permits an explicit system profile without forging a tenant actor", () => {
    expect(schema).toContain("enum WorkforceDefinitionProvenance {")
    expect(schema).toContain("SYSTEM_PROVISIONING")
    expect(schema).toContain("provenance        WorkforceDefinitionProvenance")
    expect(schema).toContain("systemProfileVersion String?")
    expect(schema).toContain("createdByUserId   String?")
    expect(migration).toContain('CREATE TYPE "WorkforceDefinitionProvenance"')
    expect(migration).toContain('ALTER COLUMN "createdByUserId" DROP NOT NULL')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "workforce_policies_activation_check"')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "workforce_shift_templates_activation_check"')
    expect(migration).toContain('"provenance" = \'SYSTEM_PROVISIONING\'')
    expect(migration).toContain('"createdByUserId" IS NULL')
    expect(migration).toContain('"activatedByUserId" IS NULL')
    expect(migration).toContain('"status" IN (\'ACTIVE\', \'RETIRED\')')
  })

  it("keeps profile provenance immutable and makes retries database-safe", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_guard_definition_provenance()")
    expect(migration).toContain("Workforce definition provenance is immutable")
    expect(migration).toContain("workforce_policies_provenance_guard")
    expect(migration).toContain("workforce_shift_templates_provenance_guard")
    expect(migration).toContain("workforce_policies_one_system_profile_version_key")
    expect(migration).toContain("workforce_shift_templates_one_system_profile_version_key")
  })

  it("does not enable, insert, update, or delete any tenant profile during migration", () => {
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"?(?:workforce_|mtm_)/i)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE)\b/i)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|TYPE|INDEX)\b/i)
  })
})
