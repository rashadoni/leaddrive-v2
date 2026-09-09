import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260830120000_mtm_mobile_route_command_receipts/migration.sql",
), "utf8")

describe("MTM mobile route-command receipt migration", () => {
  it("is additive and leaves v1 sync idempotency and the mutation outbox untouched", () => {
    expect(migration).toContain('CREATE TABLE "mtm_mobile_route_command_receipts"')
    expect(migration).not.toContain('ALTER TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('DELETE FROM "mtm_sync_operations"')
    expect(migration).not.toContain('DELETE FROM "mtm_route_notification_outbox"')
    expect(migration).not.toContain("DROP TABLE")
  })

  it("pins a canonical hash under strict tenant/operation uniqueness and bounded retention", () => {
    expect(migration).toContain('"requestHash" TEXT NOT NULL')
    expect(migration).toContain('"requestHash" ~ \'^[0-9a-f]{64}$\'')
    expect(migration).toContain('"mtm_mobile_route_command_receipts_organizationId_op_key"')
    expect(migration).toContain('"mtm_mobile_route_command_receipts_tenant_expiry_idx"')
    expect(migration).toContain("('route-commands')")
    expect(migration).toContain('"expiresAt" > "completedAt"')
  })

  it("enables forced tenant RLS from the first deployment", () => {
    expect(migration).toContain('ALTER TABLE "mtm_mobile_route_command_receipts" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_mobile_route_command_receipts" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "mtm_mobile_route_command_receipts"')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).toContain("current_setting('app.rls_bypass', true) = 'on'")
  })
})
