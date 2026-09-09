import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION = "20260716003000_mtm_mobile_task_workflow"
const sql = readFileSync(resolve("prisma/migrations", MIGRATION, "migration.sql"), "utf8")

describe("MTM mobile task workflow migration", () => {
  it("adds versioned recurrence fields and an immutable task event table", () => {
    expect(sql).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1')
    expect(sql).toContain('ADD COLUMN "recurrenceRule" "MtmTaskRecurrenceRule"')
    expect(sql).toContain('CREATE TABLE "mtm_task_events"')
    expect(sql).toContain('CREATE UNIQUE INDEX "mtm_task_events_organizationId_agentId_clientEventId_key"')
  })

  it("enforces tenant isolation on the new event timeline", () => {
    expect(sql).toContain('ALTER TABLE "mtm_task_events" ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE "mtm_task_events" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY "mtm_task_events_tenant_isolation"')
    expect(sql).toContain(`current_setting('app.org_id', true)`)
  })
})
