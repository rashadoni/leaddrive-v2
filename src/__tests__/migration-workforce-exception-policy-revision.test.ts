import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const migrationPath = join(
  root,
  "prisma/migrations/20260927070000_workforce_exception_policy_revision_foundation/migration.sql",
)
const migration = readFileSync(migrationPath, "utf8")
const validationMigrationPath = join(
  root,
  "prisma/migrations/20260927093000_workforce_exception_policy_revision_validate/migration.sql",
)
const validationMigration = readFileSync(validationMigrationPath, "utf8")

function executableSql(sql: string): string {
  return sql
    .replace(/^\s*--.*$/gmu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return []
      return productionTypeScriptFiles(path)
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

describe("Workforce exception policy revision migration", () => {
  it("is an additive, empty and rollback-compatible foundation", () => {
    const liveTableAlter = migration.indexOf(
      'ALTER TABLE "workforce_exception_decisions"',
    )
    const applicationGrantCompleted = migration.indexOf("END $$;")
    const commit = migration.lastIndexOf("COMMIT;")

    expect(migration).toContain('CREATE TABLE "workforce_exception_policy_revisions"')
    expect(migration).toMatch(
      /ALTER TABLE "workforce_exception_decisions"\s+ADD COLUMN "policyRevisionId" TEXT;/u,
    )
    expect(migration).toMatch(
      /FOREIGN KEY \("organizationId", "policyRevisionId"\)[\s\S]*?NOT VALID;/u,
    )
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\s+/imu)
    expect(migration).not.toMatch(/ADD COLUMN "policyRevisionId"[^;]*(?:NOT NULL|DEFAULT)/iu)
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*workforce_exception_decisions/iu)
    expect(migration).not.toMatch(/ENABLE[_ ](?:TENANT|POLICY)|feature[_ ]flag/iu)
    expect(migration).toContain("BEGIN;")
    expect(migration).toContain("SET LOCAL lock_timeout = '3s'")
    expect(migration).toContain("SET LOCAL statement_timeout = '2min'")
    expect(liveTableAlter).toBeGreaterThan(applicationGrantCompleted)
    expect(commit).toBeGreaterThan(liveTableAlter)
    expect(migration.slice(liveTableAlter)).toMatch(
      /ALTER TABLE "workforce_exception_decisions"[\s\S]*?NOT VALID;\s*COMMIT;\s*$/u,
    )
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true)
  })

  it("pins tenant-first identity, actor, format and revision constraints", () => {
    expect(migration).toContain(
      'UNIQUE INDEX "workforce_exception_policy_revisions_org_revision_key"',
    )
    expect(migration).toContain(
      'UNIQUE INDEX "workforce_exception_policy_revisions_org_operation_key"',
    )
    expect(migration).toContain('CHECK ("revision" > 0)')
    expect(migration).toContain("CHECK (jsonb_typeof(\"definition\") = 'object')")
    expect(migration).toContain("CHECK (\"definitionHash\" ~ '^[a-f0-9]{64}$')")
    expect(migration).toMatch(
      /FOREIGN KEY \("organizationId", "recordedByUserId"\)\s+REFERENCES "users"\("organizationId", "id"\)/u,
    )
    expect(migration).toMatch(
      /FOREIGN KEY \("organizationId", "policyRevisionId"\)\s+REFERENCES "workforce_exception_policy_revisions"\("organizationId", "id"\)/u,
    )
  })

  it("validates the decision provenance key in one bounded metadata-only phase", () => {
    expect(executableSql(validationMigration)).toBe(
      `BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '2min'; `
      + `ALTER TABLE "workforce_exception_decisions" VALIDATE CONSTRAINT `
      + `"workforce_exception_decisions_policy_revision_fk"; COMMIT;`,
    )
    expect(validationMigration.match(/VALIDATE CONSTRAINT/gu)).toHaveLength(1)
    expect(validationMigration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|GRANT|REVOKE)\b/imu,
    )
    expect(validationMigration).not.toMatch(
      /\b(?:ADD|ALTER|DROP)\s+COLUMN\b|\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/iu,
    )
  })

  it("forces tenant RLS and rejects every direct destructive mutation", () => {
    expect(migration).toContain(
      'ALTER TABLE "workforce_exception_policy_revisions" FORCE ROW LEVEL SECURITY',
    )
    expect(migration).toContain(
      "workforce_exception_policy_revisions_tenant_select",
    )
    expect(migration).toContain(
      "workforce_exception_policy_revisions_tenant_insert",
    )
    expect(migration).toContain("BEFORE UPDATE OR DELETE")
    expect(migration).toContain("IF TG_OP = 'TRUNCATE' THEN")
    expect(migration).toContain(
      'BEFORE TRUNCATE ON "workforce_exception_policy_revisions"',
    )
    expect(migration).toContain("GRANT SELECT, INSERT ON TABLE")
    expect(migration).not.toMatch(/GRANT[^;]*(?:UPDATE|DELETE|TRUNCATE)/iu)
  })

  it("allows only the session acknowledgement route to consume the writer", () => {
    const acknowledgementRoute = join(
      root,
      "src/app/api/v1/workforce/configuration/exception-policy/revisions/route.ts",
    )
    const productionFiles = productionTypeScriptFiles(join(root, "src"))
      .filter((path) => ![
        "/lib/workforce/exception-policy-revision.ts",
        "/lib/workforce/exception-policy-revision-writer.ts",
        "/app/api/v1/workforce/configuration/exception-policy/revisions/route.ts",
      ].some((suffix) => path.endsWith(suffix)))

    for (const path of productionFiles) {
      const source = readFileSync(path, "utf8")
      expect(source, path).not.toContain(
        "@/lib/workforce/exception-policy-revision",
      )
      expect(source, path).not.toContain("exception-policy-revision-writer")
    }
    const route = readFileSync(acknowledgementRoute, "utf8")
    expect(route).toContain("withWorkforceSessionPolicyConfigurationAuth")
    expect(route).toContain("appendAuthorizedWorkforceExceptionPolicyRevision")
    expect(route).toContain('decision.operation === "POLICY_REVISION_APPEND"')
    expect(route).not.toContain("workforceExceptionDecision")
    expect(route).not.toContain("policyRevisionId")
    expect(route).not.toContain("effectiveFrom")
    expect(
      readFileSync(join(root, "src/lib/workforce/default-configuration-provisioning.ts"), "utf8"),
    ).not.toContain("workforceExceptionPolicyRevision")
    const writer = readFileSync(
      join(root, "src/lib/workforce/exception-policy-revision-writer.ts"),
      "utf8",
    )
    expect(writer).not.toContain("workforceExceptionDecision")
    expect(writer).not.toContain("policyRevisionId")
  })
})
