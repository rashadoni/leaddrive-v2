import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migrationName = "20260928123000_workforce_exception_response_cycle_unique_index"
const migrationIndex = "workforce_exception_employee_responses_org_case_revision_key"
const root = process.cwd()
const migration = readFileSync(
  join(root, "prisma/migrations", migrationName, "migration.sql"),
  "utf8",
)
const stateSql = readFileSync(
  join(root, "prisma/verification/workforce-exception-response-cycle-unique-state.sql"),
  "utf8",
)
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const deploy = readFileSync(join(root, "scripts/server-deploy.sh"), "utf8")
const roleDefaultsReconciler = readFileSync(
  join(root, "scripts/reconcile-migration-role-defaults.sh"),
  "utf8",
)
const roleProvisioner = readFileSync(
  join(root, "ops/migration/provision-self-hosted.sh"),
  "utf8",
)
const migrationChecksum = createHash("sha256").update(migration).digest("hex")
const stateSqlChecksum = createHash("sha256").update(stateSql).digest("hex")
const roleDefaultsReconcilerChecksum = createHash("sha256")
  .update(roleDefaultsReconciler)
  .digest("hex")

function executableSql(source: string): string {
  return source.replace(/^--.*$/gmu, "").trim()
}

function responseModel(): string {
  const start = schema.indexOf("model WorkforceExceptionEmployeeResponse {")
  const end = schema.indexOf("\n}", start)
  if (start < 0 || end < 0) throw new Error("missing response model")
  return schema.slice(start, end + 2)
}

describe("Workforce exception response-cycle unique migration", () => {
  it("ships one standalone concurrent unique-index statement with NULLS DISTINCT", () => {
    expect(executableSql(migration)).toMatch(
      /^CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_key"\s+ON "workforce_exception_employee_responses"\("organizationId", "caseId", "observedCaseRevision"\);$/u,
    )
    expect(executableSql(migration).match(/;/gu)).toHaveLength(1)
    expect(executableSql(migration)).not.toMatch(
      /\b(?:BEGIN|COMMIT|SET|RESET|DROP|DELETE|UPDATE|INSERT|IF\s+NOT\s+EXISTS)\b/iu,
    )
    expect(executableSql(migration)).not.toContain("NULLS NOT DISTINCT")

    const response = responseModel()
    expect(response).toContain("observedCaseRevision Int?")
    expect(response).toContain(
      '@@index([organizationId, caseId, observedCaseRevision], map: "workforce_exception_employee_responses_org_case_revision_idx")',
    )
    expect(response).not.toContain(
      "@@unique([organizationId, caseId, observedCaseRevision]",
    )
  })

  it("pins one aggregate-only global state query and every immutable checksum", () => {
    expect(stateSql).toContain(migrationName)
    expect(stateSql).toContain(migrationChecksum)
    expect(stateSql).toContain("indnullsnotdistinct")
    expect(stateSql).toContain("indisunique")
    expect(stateSql).toContain("indisvalid")
    expect(stateSql).toContain("indisready")
    expect(stateSql).toContain("response_count > 1")
    expect(stateSql).toContain("COALESCE(SUM(response_count - 1), 0)")
    expect(stateSql).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|ALTER|DROP|TRUNCATE)\b/iu)

    expect(deploy).toContain(
      `WORKFORCE_RESPONSE_CYCLE_UNIQUE_MIGRATION="${migrationName}"`,
    )
    expect(deploy).toContain(
      `WORKFORCE_RESPONSE_CYCLE_UNIQUE_MIGRATION_CHECKSUM="${migrationChecksum}"`,
    )
    expect(deploy).toContain(
      `WORKFORCE_RESPONSE_CYCLE_UNIQUE_STATE_SQL_CHECKSUM="${stateSqlChecksum}"`,
    )
    expect(deploy).toContain(
      'WORKFORCE_RESPONSE_CYCLE_UNIQUE_EXPECTED_TIMEOUT_STATE="10s|14min"',
    )
    expect(deploy).toContain(
      `MIGRATION_ROLE_DEFAULTS_RECONCILER_CHECKSUM="${roleDefaultsReconcilerChecksum}"`,
    )
  })

  it("fences globally twice and verifies the exact postcondition before PM2", () => {
    expect(deploy).toContain("SET LOCAL row_security = off")
    expect(deploy).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    expect(deploy).toContain("SET LOCAL lock_timeout = '1s'")
    expect(deploy).toContain("SET LOCAL statement_timeout = '2min'")
    expect(deploy).toContain("SET LOCAL work_mem = '4MB'")
    expect(deploy).toContain("known-23505-failure")
    expect(deploy).toContain("automatic remediation/resolve is forbidden")
    expect(deploy).not.toContain(
      '--rolled-back "$WORKFORCE_RESPONSE_CYCLE_UNIQUE_MIGRATION"',
    )

    const preflightAt = deploy.indexOf("\npreflight_workforce_response_cycle_unique\n")
    const backupAt = deploy.indexOf('log "Creating backup..."')
    const reconcileAt = deploy.indexOf("\nrun_migration_role_defaults_reconciler\n")
    const beforeMigrateAt = deploy.indexOf(
      "\nverify_workforce_response_cycle_unique_before_migrate\n",
    )
    const beforeMigrateFunctionAt = deploy.indexOf(
      "verify_workforce_response_cycle_unique_before_migrate() {",
    )
    const rawDefaultsAt = deploy.indexOf(
      "timeout_state=$(env -u PGOPTIONS",
      beforeMigrateFunctionAt,
    )
    const beforeMigrateFunctionEnd = deploy.indexOf(
      "\n}\n\nverify_workforce_response_cycle_unique_after_migrate()",
      rawDefaultsAt,
    )
    const migrateAt = deploy.indexOf(
      'if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy',
      beforeMigrateAt,
    )
    const postconditionAt = deploy.indexOf(
      "\nverify_workforce_response_cycle_unique_after_migrate\n",
    )
    const credentialUnsetAt = deploy.indexOf(
      "unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE",
      postconditionAt,
    )
    const pm2At = deploy.indexOf('log "Starting PM2..."')

    expect(preflightAt).toBeGreaterThan(-1)
    expect(reconcileAt).toBeGreaterThan(-1)
    expect(reconcileAt).toBeLessThan(preflightAt)
    expect(reconcileAt).toBeLessThan(backupAt)
    expect(preflightAt).toBeLessThan(backupAt)
    expect(beforeMigrateAt).toBeGreaterThan(backupAt)
    expect(beforeMigrateFunctionAt).toBeGreaterThan(-1)
    expect(rawDefaultsAt).toBeGreaterThan(beforeMigrateFunctionAt)
    expect(rawDefaultsAt).toBeLessThan(beforeMigrateFunctionEnd)
    expect(beforeMigrateAt).toBeLessThan(migrateAt)
    expect(postconditionAt).toBeGreaterThan(migrateAt)
    expect(postconditionAt).toBeLessThan(credentialUnsetAt)
    expect(postconditionAt).toBeLessThan(pm2At)
    expect(deploy).not.toContain(
      "WORKFORCE_RESPONSE_CYCLE_UNIQUE_MIGRATE_PGOPTIONS",
    )
    expect(deploy).not.toContain(
      'PGOPTIONS="$WORKFORCE_RESPONSE_CYCLE_UNIQUE_MIGRATE_PGOPTIONS" DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy',
    )
    expect(deploy).not.toContain("ALTER ROLE CURRENT_USER")
  })

  it("reconciles only accepted legacy role defaults and preserves a read-only preflight", () => {
    expect(roleDefaultsReconciler).toContain("--check|--reconcile")
    expect(roleDefaultsReconciler).toContain("env -u PGOPTIONS")
    expect(roleDefaultsReconciler).toContain("0|10s")
    expect(roleDefaultsReconciler).toContain("0|14min")
    expect(roleDefaultsReconciler).toContain(
      "refusing to replace unexpected lock_timeout",
    )
    expect(roleDefaultsReconciler).toContain(
      "refusing to replace unexpected statement_timeout",
    )
    expect(roleDefaultsReconciler).toContain(
      "ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L",
    )
    expect(roleDefaultsReconciler).toContain(
      "ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L",
    )
    expect(roleDefaultsReconciler).toContain(
      "current_user <> session_user",
    )
    expect(roleDefaultsReconciler).not.toMatch(/PASSWORD|DELETE|DROP|TRUNCATE/iu)

    expect(deploy).toContain('mode="--check"')
    expect(deploy).toContain('mode="--reconcile"')
    expect(deploy).toContain(
      'tar -xOzf "$DEPLOY_TAR" "./$MIGRATION_ROLE_DEFAULTS_RECONCILER"',
    )
    expect(deploy).toContain("migration-role server defaults failed $mode")
  })

  it("verifies every timeout installed by the canonical role provisioner", () => {
    expect(roleProvisioner).toContain(
      "setting = '10000' AND unit = 'ms'",
    )
    expect(roleProvisioner).toContain(
      "setting = '840000' AND unit = 'ms'",
    )
    expect(roleProvisioner).toContain(
      "setting = '60000' AND unit = 'ms'",
    )
    expect(roleProvisioner).toContain("ROLE_LOCK_OK ROLE_STATEMENT_OK ROLE_IDLE_OK")
  })

  it("keeps the exact 23505 artifact recoverable without automatic data repair", () => {
    expect(stateSql).toContain("exact_unresolved_23505")
    expect(stateSql).toContain("LIKE '%23505%'")
    expect(stateSql).toContain(`LIKE '%${migrationIndex}%'`)
    expect(stateSql).toContain("exact_invalid")
    expect(deploy).toContain(
      "Workforce response-cycle unique migration has an exact 23505 invalid-index failure",
    )
    expect(deploy).not.toMatch(
      new RegExp(`DROP INDEX[^\\n]+${migrationIndex}`, "u"),
    )
  })
})
