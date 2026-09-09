import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260810123000_call_log_target_phone_e164/migration.sql"),
  "utf8",
)
const deployScript = readFileSync(
  join(process.cwd(), "scripts/server-deploy.sh"),
  "utf8",
)
const auditMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260810124500_voice_permission_idempotency_audit/migration.sql",
  ),
  "utf8",
)
const deployWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8",
)

describe("CallLog target phone E.164 migration", () => {
  it("adds the canonical field, exact lookup index, and E.164 constraint", () => {
    expect(migration).toContain('ADD COLUMN "targetPhoneE164" TEXT')
    expect(migration).toContain('"call_logs_org_target_phone_e164_idx"')
    expect(migration).toContain('"organizationId", "targetPhoneE164"')
    expect(migration).toContain('"call_logs_target_phone_e164_check"')
    expect(migration).toContain("'^\\+[1-9][0-9]{6,14}$'")
    expect(migration).toContain('CREATE INDEX "call_logs_org_target_phone_e164_idx"')
    expect(migration).not.toContain("CREATE INDEX CONCURRENTLY")
  })

  it("backfills only direction-aware, fully specified phone forms", () => {
    expect(migration).toContain('WHEN "direction" = \'outbound\' THEN "toNumber"')
    expect(migration).toContain('WHEN "direction" = \'inbound\' THEN "fromNumber"')
    expect(migration).toContain("'^994[0-9]{9}$'")
    expect(migration).toContain("'^0[0-9]{9}$'")
    expect(migration).not.toContain("RIGHT(")
    expect(migration).not.toContain("LIKE '%")
    expect(migration).not.toContain("voiceQueueEnabled")
  })

  it("retries only the known failed transaction after proving a complete rollback", () => {
    const migrationSha = createHash("sha256").update(migration).digest("hex")
    const auditMigrationSha = createHash("sha256").update(auditMigration).digest("hex")

    expect(deployScript).toContain(
      'CALL_TARGET_MIGRATION="20260810123000_call_log_target_phone_e164"',
    )
    expect(deployScript).toContain(
      'CALL_TARGET_FAILED_CHECKSUM="5915860b3846bd59b33483345e98eed5c750e80c6a1b77ae5e9b3c94291352fe"',
    )
    expect(deployScript).toContain("known_concurrent_index_transaction_failure")
    expect(deployScript).toContain('UNRESOLVED_MIGRATION_COUNT=')
    expect(deployScript).toContain('preflight_known_voice_safety_recovery')
    expect(deployScript).toContain('CALL_TARGET_FIXED_CHECKSUM=')
    expect(deployScript).toContain('VOICE_PERMISSION_FIXED_CHECKSUM=')
    expect(deployScript).toContain(`CALL_TARGET_FIXED_CHECKSUM="${migrationSha}"`)
    expect(deployScript).toContain(
      `VOICE_PERMISSION_FIXED_CHECKSUM="${auditMigrationSha}"`,
    )
    expect(deployScript).toContain(
      'fatal_after_standalone_replacement "$CALL_TARGET_MIGRATION left partial schema artifacts',
    )
    expect(deployScript).toContain('--rolled-back "$CALL_TARGET_MIGRATION"')

    const artifactCheck = deployScript.slice(
      deployScript.indexOf("CALL_TARGET_ARTIFACTS="),
      deployScript.indexOf(
        'log "Verified complete rollback of $CALL_TARGET_MIGRATION',
      ),
    )
    expect(artifactCheck).toContain("column:call_logs.targetPhoneE164")
    expect(artifactCheck).toContain("constraint:call_logs_target_phone_e164_check")
    expect(artifactCheck).toContain("index:call_logs_org_target_phone_e164_idx")
  })

  it("keeps the append-only audit migration compatible with the transactional runner", () => {
    expect(auditMigration).toContain(
      'CREATE UNIQUE INDEX "audit_logs_voice_permission_request_key"',
    )
    expect(auditMigration).not.toContain("CREATE UNIQUE INDEX CONCURRENTLY")
    expect(auditMigration).not.toContain("IF NOT EXISTS")
    expect(auditMigration).not.toContain("CREATE OR REPLACE FUNCTION")
    expect(auditMigration).not.toContain("DROP TRIGGER IF EXISTS")
    expect(auditMigration).toContain('CREATE TRIGGER "audit_logs_voice_permission_append_only"')
    expect(
      auditMigration.indexOf('CREATE TRIGGER "audit_logs_voice_permission_append_only"'),
    ).toBeLessThan(
      auditMigration.indexOf('CREATE UNIQUE INDEX "audit_logs_voice_permission_request_key"'),
    )
  })

  it("restores the prior standalone on every recovery failure and verifies postconditions", () => {
    expect(deployScript).toContain("restore_standalone_before_pm2()")
    expect(deployScript).toContain("fatal_after_standalone_replacement()")
    expect(deployScript).toContain("rollback_replaced_standalone_on_exit()")
    expect(deployScript).toContain("trap rollback_replaced_standalone_on_exit EXIT")
    expect(deployScript).toContain("STANDALONE_REPLACED=true")
    expect(deployScript).toContain('VOICE_SAFETY_SCHEMA_STATE=')
    expect(deployScript).toContain(
      '[ "$VOICE_SAFETY_SCHEMA_STATE" = "2|1|0|1|1|1|1|1|1" ]',
    )
    expect(deployScript).toContain("npx prisma migrate status")
    expect(deployScript).toContain('FINAL_MIGRATION_WINDOW=')
    expect(deployScript).toContain('FINAL_ACTIVE_TRANSACTIONS')
    expect(deployScript).toContain('FINAL_AUDIT_LOG_BYTES')
    expect(deployScript.indexOf("preflight_known_voice_safety_recovery")).toBeLessThan(
      deployScript.indexOf('log "Creating backup..."'),
    )
    expect(deployScript.indexOf("trap rollback_replaced_standalone_on_exit EXIT")).toBeLessThan(
      deployScript.indexOf("STANDALONE_REPLACED=true"),
    )
  })

  it("fails before staging on an oversized or non-clean audit migration pre-state", () => {
    expect(deployWorkflow).toContain('pg_total_relation_size(\'public.audit_logs\')')
    expect(deployWorkflow).toContain('i.indisvalid AND i.indisready AND i.indislive')
    expect(deployWorkflow).toContain(
      "to_regclass('public.audit_logs_voice_permission_request_key')",
    )
    expect(deployWorkflow).toContain('voicePermissionReservedRowCount')
    expect(deployWorkflow).toContain('voicePermissionDuplicateGroupCount')
    expect(deployWorkflow).toContain(
      "Voice-permission audit namespace is not clean for its first migration",
    )
  })
})
