import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260808160000_mtm_contact_dictionaries/migration.sql",
), "utf8")

describe("SWM03 signed contact dictionary migration", () => {
  it("enforces tenant RLS and a tenant foreign key", () => {
    expect(migration).toContain('ALTER TABLE "mtm_contact_dictionaries" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_contact_dictionaries" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('REFERENCES "organizations"("id") ON DELETE CASCADE')
  })

  it("allows one active version for each separate dictionary kind", () => {
    expect(migration).toContain('ON "mtm_contact_dictionaries"("organizationId", "kind") WHERE "status" = \'ACTIVE\'')
    expect(migration).toContain('CONSTRAINT "mtm_contact_dict_signature_check"')
  })

  it("does not seed unsigned values inferred from screenshots", () => {
    expect(migration).not.toMatch(/INSERT\s+INTO/i)
  })
})
