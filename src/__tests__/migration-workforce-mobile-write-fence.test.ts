import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260829133000_workforce_mobile_write_fence/migration.sql",
), "utf8")

describe("Workforce mobile write fence migration", () => {
  it("adds an explicit tenant-owned mode without creating a tenant rollout", () => {
    expect(schema).toContain("enum WorkforceMobileWriteFenceMode {")
    expect(schema).toContain("model WorkforceMobileWriteFence {")
    expect(schema).toContain('@@map("workforce_mobile_write_fences")')
    expect(migration).toContain('CREATE TYPE "WorkforceMobileWriteFenceMode"')
    expect(migration).toContain('CREATE TABLE "workforce_mobile_write_fences"')
    expect(migration).toContain("'LEGACY_ALLOWED'")
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|TYPE|INDEX))\b/i)
  })

  it("uses tenant-coherent actor integrity and forced RLS", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "updatedByUserId") REFERENCES "users"("organizationId", "id")')
    expect(migration).toContain('CREATE INDEX "workforce_mobile_write_fences_mode_updatedAt_idx"')
    expect(migration).toContain('ALTER TABLE "workforce_mobile_write_fences" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "workforce_mobile_write_fences" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "workforce_mobile_write_fences"')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).toContain("current_setting('app.rls_bypass', true) = 'on'")
  })
})
