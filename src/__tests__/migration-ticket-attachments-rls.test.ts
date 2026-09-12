import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260912225000_ticket_attachments_rls/migration.sql",
), "utf8")

describe("ticket attachment tenant isolation migration", () => {
  it("enables and forces RLS with tenant and bounded bypass checks", () => {
    expect(migration).toContain('ALTER TABLE "ticket_attachments" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "ticket_attachments" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "ticket_attachments"')
    expect(migration).toContain('"organizationId" = current_setting(\'app.org_id\', true)')
    expect(migration).toContain("current_setting('app.rls_bypass', true) = 'on'")
    expect(migration).not.toMatch(/\b(?:TRUNCATE|DROP)\s+(?:TABLE|TYPE)\b/i)
  })
})
