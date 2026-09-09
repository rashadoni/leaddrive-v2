import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migrationName = "20260827090000_tenant_delete_cascades"
const successfulMigrationChecksum =
  "28e3ceba5dbace8e53b66e4faf304ebad1a1618452bfe9e5b3c7a60e92be0dff"
const deployScript = readFileSync(
  join(process.cwd(), "scripts/server-deploy.sh"),
  "utf8",
)
const orphanAudit = readFileSync(
  join(process.cwd(), "scripts/rls/audit-orphan-tenant-rows.sql"),
  "utf8",
)
const cascadeAudit = readFileSync(
  join(process.cwd(), "scripts/rls/audit-tenant-delete-cascade.sql"),
  "utf8",
)
const stateSqlPath = join(
  process.cwd(),
  "prisma/verification/tenant-delete-cascade-artifact-state.sql",
)
const stateSql = existsSync(stateSqlPath) ? readFileSync(stateSqlPath, "utf8") : ""
const migrationSql = readFileSync(
  join(process.cwd(), "prisma/migrations", migrationName, "migration.sql"),
  "utf8",
)

describe("successful tenant-delete cascade postconditions", () => {
  it("refuses an RLS-filtered orphan audit and keeps NOT VALID keys visible", () => {
    const guardAt = orphanAudit.indexOf("rolbypassrls")
    const scanAt = orphanAudit.indexOf("FOR r IN")

    expect(guardAt).toBeGreaterThan(-1)
    expect(orphanAudit).toContain("rolsuper")
    expect(orphanAudit).toContain("RAISE EXCEPTION")
    expect(guardAt).toBeLessThan(scanAt)
    expect(orphanAudit).toContain("NOT fk.convalidated")
    expect(cascadeAudit).toContain("NOT fk.convalidated")
  })

  it("ships one executable aggregate-only catalog query for all 73 exact keys", () => {
    const targetTables = [
      ...stateSql.matchAll(/^\s+'([a-z0-9_]+)'[,]?$/gm),
    ].map((match) => match[1])

    expect(targetTables).toHaveLength(73)
    expect(new Set(targetTables).size).toBe(73)
    expect(stateSql).toContain("confdeltype = 'c'")
    expect(stateSql).toContain("confupdtype = 'c'")
    expect(stateSql).toContain("conkey")
    expect(stateSql).toContain("confkey")
    expect(stateSql).toContain("pg_trigger")
    expect(stateSql).toContain("tgenabled")
    expect(stateSql).not.toMatch(/\b(?:DELETE|UPDATE|INSERT)\b/i)
  })

  it("pins the already-successful migration and verifies catalog state before activation", () => {
    const migrationChecksum = createHash("sha256")
      .update(migrationSql)
      .digest("hex")
    const stateSqlChecksum = createHash("sha256").update(stateSql).digest("hex")

    expect(migrationChecksum).toBe(successfulMigrationChecksum)
    expect(deployScript).toContain(`TENANT_CASCADE_MIGRATION="${migrationName}"`)
    expect(deployScript).toContain(
      `TENANT_CASCADE_SUCCESS_CHECKSUM="${migrationChecksum}"`,
    )
    expect(deployScript).toContain(
      'TENANT_CASCADE_STATE_SQL="prisma/verification/tenant-delete-cascade-artifact-state.sql"',
    )
    expect(deployScript).toContain(
      `TENANT_CASCADE_STATE_SQL_CHECKSUM="${stateSqlChecksum}"`,
    )
    expect(deployScript).toContain("TENANT_CASCADE_EXPECTED_CONSTRAINTS=73")
    expect(deployScript).toContain("TENANT_CASCADE_PREFLIGHT_STATE=")
    expect(deployScript).toContain("TENANT_CASCADE_SCHEMA_STATE=")
    expect(deployScript).toContain('TENANT_CASCADE_LEDGER_STATE" = "1|1|0"')
    expect(deployScript).toContain("BEGIN TRANSACTION READ ONLY")
    expect(deployScript).toContain("tenant cascade postcondition failed")
    expect(deployScript).not.toContain('--rolled-back "$TENANT_CASCADE_MIGRATION"')

    const preflightCall = deployScript.indexOf(
      "\npreflight_successful_tenant_cascade\n",
    )
    const backupAt = deployScript.indexOf('log "Creating backup..."')
    const migrateAt = deployScript.indexOf(
      'if ! DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy',
    )
    const postconditionAt = deployScript.indexOf(
      "EXTRACTED_TENANT_CASCADE_MIGRATION=",
    )
    const migrationCredentialUnsetAt = deployScript.indexOf(
      "unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE",
      postconditionAt,
    )
    const pm2At = deployScript.indexOf('log "Starting PM2..."')

    expect(preflightCall).toBeGreaterThan(-1)
    expect(preflightCall).toBeLessThan(backupAt)
    expect(migrateAt).toBeGreaterThan(backupAt)
    expect(postconditionAt).toBeGreaterThan(migrateAt)
    expect(postconditionAt).toBeLessThan(migrationCredentialUnsetAt)
    expect(postconditionAt).toBeLessThan(pm2At)
  })
})
