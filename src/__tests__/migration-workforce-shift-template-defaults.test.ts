import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829020000_workforce_shift_template_defaults/migration.sql",
), "utf8")

describe("Workforce shift template default migration", () => {
  it("adds an explicit default flag with one active default per scope", () => {
    expect(migration).toContain('ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain("workforce_shift_templates_one_active_org_default_key")
    expect(migration).toContain("workforce_shift_templates_one_active_team_default_key")
    expect(migration).toContain('"status" = \'ACTIVE\'')
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i)
  })
})
