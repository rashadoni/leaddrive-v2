import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830010000_workforce_c1_attendance_provenance/migration.sql",
), "utf8")

describe("Workforce C1 attendance provenance migration", () => {
  it("adds versioned client and server provenance without rewriting immutable history", () => {
    const eventSchema = schema.slice(
      schema.indexOf("model MtmAgentWorkdayEvent {"),
      schema.indexOf("model MtmAgentWorkdayEvent {") + 2_000,
    )
    for (const field of [
      /claimedAt\s+DateTime\?/,
      /capturedAt\s+DateTime\?/,
      /queuedAt\s+DateTime\?/,
      /serverReceivedAt\s+DateTime\?/,
      /appliedAt\s+DateTime\?/,
      /schemaVersion\s+Int\s+@default\(1\)/,
      /requestHash\s+String\?\s+@db\.VarChar\(64\)/,
    ]) {
      expect(eventSchema).toMatch(field)
    }
    expect(migration).toContain('ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1')
    expect(migration).toContain('CHECK ("schemaVersion" IN (1, 2))')
    expect(migration).toContain('ADD COLUMN "requestHash" VARCHAR(64)')
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+/i)
  })

  it("keeps receipt-time querying narrow and binds sync replays to a digest", () => {
    expect(migration).toContain(
      'CREATE INDEX "mtm_agent_workday_events_organizationId_agentId_serverReceivedAt_idx"',
    )
    const syncSchema = schema.slice(schema.indexOf("model MtmSyncOperation {"))
    expect(syncSchema).toMatch(/requestHash\s+String\?\s+@db\.VarChar\(64\)/)
  })
})
