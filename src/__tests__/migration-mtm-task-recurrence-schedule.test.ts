import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const recurrenceMigration = readFileSync(resolve(
  "prisma/migrations/20260801140000_mtm_task_recurrence_schedule/migration.sql",
), "utf8")
const sourceKeyMigration = readFileSync(resolve(
  "prisma/migrations/20260713170000_mtm_visit_next_action_idempotency/migration.sql",
), "utf8")
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8")

describe("MTM task recurrence schedule migration", () => {
  it("adds nullable planning, pinned-timezone, anchor and immutable cursor columns", () => {
    expect(recurrenceMigration).toMatch(/ADD COLUMN "scheduledStartAt" TIMESTAMP\(3\)/)
    expect(recurrenceMigration).toMatch(/ADD COLUMN "recurrenceTimezone" TEXT/)
    expect(recurrenceMigration).toMatch(/ADD COLUMN "recurrenceAnchorScheduledStartAt" TIMESTAMP\(3\)/)
    expect(recurrenceMigration).toMatch(/ADD COLUMN "recurrenceAnchorDueDate" TIMESTAMP\(3\)/)
    expect(recurrenceMigration).toMatch(/ADD COLUMN "recurrenceCursorScheduledStartAt" TIMESTAMP\(3\)/)
    expect(recurrenceMigration).toMatch(/ADD COLUMN "recurrenceCursorDueDate" TIMESTAMP\(3\)/)
    expect(recurrenceMigration).toContain('CONSTRAINT "mtm_tasks_recurrenceTimezone_length_check"')
    expect(recurrenceMigration).toMatch(/char_length\("recurrenceTimezone"\) BETWEEN 1 AND 64/)
    expect(recurrenceMigration).not.toMatch(/\bNOT NULL\b/)
    expect(recurrenceMigration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/)
  })

  it("bootstraps legacy recurring occurrence cursors from their current planned timestamps", () => {
    expect(recurrenceMigration).toMatch(/UPDATE "mtm_tasks"[\s\S]*"recurrenceCursorScheduledStartAt" = "scheduledStartAt"/)
    expect(recurrenceMigration).toMatch(/"recurrenceCursorDueDate" = "dueDate"[\s\S]*WHERE "recurrenceRule" IS NOT NULL/)
  })

  it("keeps Prisma aligned and planned start separate from factual startedAt", () => {
    const taskModel = schema.match(/model MtmTask \{([\s\S]*?)\n\}/)?.[1] ?? ""
    expect(taskModel).toMatch(/scheduledStartAt\s+DateTime\?/)
    expect(taskModel).toMatch(/startedAt\s+DateTime\?/)
    expect(taskModel).toMatch(/recurrenceTimezone\s+String\?/)
    expect(taskModel).toMatch(/recurrenceAnchorScheduledStartAt\s+DateTime\?/)
    expect(taskModel).toMatch(/recurrenceAnchorDueDate\s+DateTime\?/)
    expect(taskModel).toMatch(/recurrenceCursorScheduledStartAt\s+DateTime\?/)
    expect(taskModel).toMatch(/recurrenceCursorDueDate\s+DateTime\?/)
  })

  it("reuses the existing partial unique sourceKey fence for exact-once spawn", () => {
    expect(sourceKeyMigration).toContain('CREATE UNIQUE INDEX "mtm_tasks_org_source_key_unique"')
    expect(sourceKeyMigration).toContain('ON "mtm_tasks" ("organizationId", "sourceKey")')
    expect(sourceKeyMigration).toContain('WHERE "sourceKey" IS NOT NULL')
  })
})
