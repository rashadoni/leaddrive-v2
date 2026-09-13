import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830193000_workforce_access_grants/migration.sql",
), "utf8")
const operationMigration = readFileSync(join(
  root,
  "prisma/migrations/20260830195000_workforce_access_grant_operations/migration.sql",
), "utf8")

describe("Workforce C7 durable access-grant migration", () => {
  it("adds tenant-scoped, effective-dated grant rows with one exact scope", () => {
    const grantSchema = schema.slice(schema.indexOf("model WorkforceAccessGrant {"))

    expect(grantSchema).toMatch(/role\s+WorkforceAccessRole/)
    expect(grantSchema).toMatch(/scopeKind\s+WorkforceAccessScopeKind/)
    expect(grantSchema).toMatch(/scopeTeamId\s+String\?/)
    expect(grantSchema).toMatch(/scopeSiteId\s+String\?/)
    expect(grantSchema).toMatch(/scopeAgentId\s+String\?/)
    expect(grantSchema).toMatch(/@@unique\(\[organizationId, id\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_access_grants"')
    expect(migration).toContain('workforce_access_grants_exact_scope_check')
    expect(migration).toContain('workforce_access_grants_role_scope_check')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "principalUserId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "scopeSiteId")')
  })

  it("keeps grants and revocations append-only, tenant-isolated and accountable", () => {
    const revocationSchema = schema.slice(schema.indexOf("model WorkforceAccessGrantRevocation {"))

    expect(revocationSchema).toMatch(/@@unique\(\[organizationId, grantId\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_access_grant_revocations"')
    expect(migration).toContain('CREATE TRIGGER workforce_access_grants_append_only')
    expect(migration).toContain('CREATE TRIGGER workforce_access_grant_revocations_append_only')
    expect(migration).toContain('ALTER TABLE "workforce_access_grants" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "workforce_access_grant_revocations" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('workforce_validate_access_grant_revocation_insert')
  })

  it("contains all recorded incompatible-role pairs in the durable insert guard", () => {
    expect(migration).toContain("'SCHEDULER' AND NEW.\"role\" = 'TIME_APPROVER'")
    expect(migration).toContain("'TIME_APPROVER' AND NEW.\"role\" = 'TEAM_MANAGER'")
    expect(migration).toContain("'EVIDENCE_REVIEWER' AND NEW.\"role\" = 'DEVICE_SECURITY_ADMIN'")
    expect(migration).toContain("'EXPORT_CUSTODIAN' AND NEW.\"role\" = 'RETENTION_HOLD_OFFICER'")
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"workforce_access_grants"/i)
  })

  it("makes future authority writes replayable without inventing ids for an unknown ledger", () => {
    const grantSchema = schema.slice(schema.indexOf("model WorkforceAccessGrant {"))
    const revocationSchema = schema.slice(schema.indexOf("model WorkforceAccessGrantRevocation {"))

    expect(grantSchema).toMatch(/operationId\s+String\s+@db\.VarChar\(100\)/)
    expect(grantSchema).toMatch(/@@unique\(\[organizationId, operationId\]\)/)
    expect(revocationSchema).toMatch(/operationId\s+String\s+@db\.VarChar\(100\)/)
    expect(revocationSchema).toMatch(/@@unique\(\[organizationId, operationId\]\)/)
    expect(operationMigration).toContain('ADD COLUMN "operationId" VARCHAR(100)')
    expect(operationMigration).toContain("CHECK (\"operationId\" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$')")
    expect(operationMigration).toContain("CHECK (\"grantReasonCode\" ~ '^[A-Z][A-Z0-9_]{0,63}$')")
    expect(operationMigration).toContain("CHECK (\"revocationReasonCode\" ~ '^[A-Z][A-Z0-9_]{0,63}$')")
    expect(operationMigration).toContain('Cannot add Workforce access operation ids to a non-empty dormant ledger')
    expect(operationMigration).toContain('workforce_access_grants_organizationId_operationId_key')
    expect(operationMigration).toContain('workforce_access_grant_revocations_organizationId_operationId_key')
  })
})
