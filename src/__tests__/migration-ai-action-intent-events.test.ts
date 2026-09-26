import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260919210000_ai_action_intent_events/migration.sql",
), "utf8")

describe("AI action intent event ledger migration", () => {
  it("binds every event to a tenant-safe intent and user", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "intentId")')
    expect(migration).toContain('REFERENCES "ai_action_intents"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "userId")')
    expect(migration).toContain('REFERENCES "users"("organizationId", "id")')
  })

  it("allows tenant reads and inserts but no application update/delete policy", () => {
    expect(migration).toContain('ALTER TABLE "ai_action_intent_events" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('FOR SELECT USING')
    expect(migration).toContain('FOR INSERT WITH CHECK')
    expect(migration).not.toMatch(/FOR\s+(UPDATE|DELETE)/i)
  })

  it("blocks direct update, delete, and truncate of evidence", () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "ai_action_intent_events"')
    expect(migration).toContain('BEFORE TRUNCATE ON "ai_action_intent_events"')
    expect(migration).toContain("pg_trigger_depth() > 1")
  })

  it("constrains event vocabulary, receipt revision, hash and JSON shape", () => {
    expect(migration).toContain('"eventType" IN (')
    expect(migration).toContain('"intentRevision" >= 1')
    expect(migration).toContain('"payloadHash" ~ \'^[0-9a-f]{64}$\'')
    expect(migration).toContain('jsonb_typeof("eventData")')
    expect(migration).toContain("'confirmation_proof_issued'")
  })
})
