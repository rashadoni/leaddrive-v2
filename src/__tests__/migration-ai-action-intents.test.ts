import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  "prisma/migrations/20260919190000_ai_action_intents/migration.sql",
  "utf8",
)
const schema = readFileSync("prisma/schema.prisma", "utf8")

describe("AI voice action-intent migration", () => {
  it("creates the durable intent with the complete proposal and result envelope", () => {
    expect(migration).toContain('CREATE TABLE "ai_action_intents"')
    for (const column of [
      "organizationId",
      "userId",
      "voiceSessionId",
      "parentIntentId",
      "actionType",
      "rawPayload",
      "normalizedPayload",
      "preview",
      "warnings",
      "state",
      "revision",
      "payloadHash",
      "idempotencyKey",
      "providerToolCallId",
      "targetEntityId",
      "expectedUpdatedAt",
      "resultEntityId",
      "resultPayload",
      "errorCode",
      "errorDetail",
      "expiresAt",
      "confirmedAt",
      "executionStartedAt",
      "executionLeaseToken",
      "executionLeaseExpiresAt",
      "completedAt",
    ]) {
      expect(migration).toContain(`"${column}"`)
    }
    expect(schema).toContain("model AiActionIntent {")
    expect(schema).toContain('@@map("ai_action_intents")')
  })

  it("enforces tenant-safe organization, user, session and parent references", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("organizationId", "userId")\n  REFERENCES "users"("organizationId", "id")',
    )
    expect(migration).toContain(
      'FOREIGN KEY ("organizationId", "voiceSessionId")\n  REFERENCES "voice_sessions"("organizationId", "id")',
    )
    expect(migration).toContain(
      'FOREIGN KEY ("organizationId", "parentIntentId")\n  REFERENCES "ai_action_intents"("organizationId", "id")',
    )
    expect(migration).not.toContain('FOREIGN KEY ("userId")')
    expect(migration).not.toContain('FOREIGN KEY ("voiceSessionId")')
  })

  it("uses the canonical fail-closed RLS context in both policy clauses", () => {
    expect(migration).toContain('ALTER TABLE "ai_action_intents" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "ai_action_intents" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "ai_action_intents"')
    expect(migration.match(/current_setting\('app\.org_id', true\)/g)).toHaveLength(2)
    expect(migration.match(/current_setting\('app\.rls_bypass', true\) = 'on'/g)).toHaveLength(2)
    expect(migration).not.toContain("app.current_organization_id")
  })

  it("deduplicates callers and permits only one active root per user session", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "ai_action_intents_org_user_idempotency_key"')
    expect(migration).toContain(
      'ON "ai_action_intents"("organizationId", "userId", "idempotencyKey")',
    )
    expect(migration).toContain('CREATE UNIQUE INDEX "ai_action_intents_org_session_provider_call_key"')
    expect(migration).toContain('CREATE UNIQUE INDEX "ai_action_intents_org_active_root_key"')
    expect(migration).toContain('WHERE "parentIntentId" IS NULL')
    expect(migration).toContain(
      'AND "state" IN (\'collecting\', \'awaiting_confirmation\', \'executing\')',
    )
  })

  it("backs the application lifecycle with database state and coherence checks", () => {
    expect(migration).toContain('CONSTRAINT "ai_action_intents_state_check"')
    expect(migration).toContain('CONSTRAINT "ai_action_intents_lifecycle_check"')
    expect(migration).toContain('CONSTRAINT "ai_action_intents_payload_hash_check"')
    expect(migration).toContain('CONSTRAINT "ai_action_intents_expiry_check"')
    expect(migration).toContain('CONSTRAINT "ai_action_intents_timestamp_order_check"')
    expect(migration).toContain('"state" = \'executing\'')
    expect(migration).toContain('"confirmedAt" IS NOT NULL')
    expect(migration).toContain('"executionLeaseToken" IS NOT NULL')
    expect(migration).toContain('"state" = \'succeeded\'')
    expect(migration).toContain('"resultPayload" IS NOT NULL')
  })
})
