import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(__dirname, "../../prisma/migrations/20260828120000_mtm_route_notification_outbox/migration.sql"),
  "utf8",
)

describe("MTM route notification outbox migration", () => {
  it("is additive and gives the delivery source a tenant-local idempotency key", () => {
    expect(migration).toContain('CREATE TABLE "mtm_route_notification_outbox"')
    expect(migration).toContain('ALTER TABLE "mtm_notifications" ADD COLUMN "outboxId" TEXT')
    expect(migration).toContain('CREATE UNIQUE INDEX "mtm_route_notification_outbox_org_dedupe_key"')
    expect(migration).toContain('ON "mtm_route_notification_outbox"("organizationId", "dedupeKey")')
    expect(migration).toContain('CREATE UNIQUE INDEX "mtm_notifications_org_outbox_key"')
    expect(migration).toContain('ON "mtm_notifications"("organizationId", "outboxId")')
    expect(migration).not.toContain('DROP TABLE "mtm_notifications"')
  })

  it("enforces tenant RLS and preserves the cross-tenant worker bypass", () => {
    expect(migration).toContain('ALTER TABLE "mtm_route_notification_outbox" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_route_notification_outbox" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('"organizationId" = current_setting(\'app.org_id\', true)')
    expect(migration).toContain("current_setting('app.rls_bypass', true) = 'on'")
  })
})
