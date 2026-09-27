import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migrationRoot = join(root, "prisma/migrations")
const expandMigration = readFileSync(join(
  migrationRoot,
  "20260927014000_workforce_exception_case_revisions/migration.sql",
), "utf8")
const backfillMigration = readFileSync(join(
  migrationRoot,
  "20260927014100_workforce_exception_case_revisions_backfill/migration.sql",
), "utf8")
const decisionIndexMigration = readFileSync(join(
  migrationRoot,
  "20260927014200_workforce_exception_case_revisions_decision_index/migration.sql",
), "utf8")
const responseIndexMigration = readFileSync(join(
  migrationRoot,
  "20260927014250_workforce_exception_case_revisions_response_index/migration.sql",
), "utf8")
const contractMigration = readFileSync(join(
  migrationRoot,
  "20260927014300_workforce_exception_case_revisions_contract/migration.sql",
), "utf8")
const migration = [
  expandMigration,
  backfillMigration,
  decisionIndexMigration,
  responseIndexMigration,
  contractMigration,
].join("\n")

function executableSql(source: string): string {
  return source.replace(/^--.*$/gmu, "").trim()
}

function model(name: string): string {
  const start = schema.indexOf(`model ${name} {`)
  const end = schema.indexOf("\n}", start)
  if (start < 0 || end < 0) throw new Error(`Missing Prisma model ${name}`)
  return schema.slice(start, end + 2)
}

describe("Workforce C6 case-local lifecycle revision migration", () => {
  it("adds one monotonic decision position and nullable legacy signal revisions", () => {
    const decision = model("WorkforceExceptionDecision")
    const response = model("WorkforceExceptionEmployeeResponse")
    const request = model("MtmHrmRequest")

    expect(decision).toMatch(/caseRevision\s+Int/)
    expect(decision).toContain("@@unique([organizationId, caseId, caseRevision]")
    expect(response).toMatch(/observedCaseRevision\s+Int\?/)
    expect(response).toContain("@@index([organizationId, caseId, observedCaseRevision]")
    expect(request).toMatch(/exceptionCaseRevision\s+Int\?/)
    expect(migration).toContain('CHECK ("caseRevision" > 0)')
    expect(migration).toContain('CHECK ("observedCaseRevision" IS NULL OR "observedCaseRevision" >= 0)')
    expect(migration).toContain('CHECK ("exceptionCaseRevision" IS NULL OR "exceptionCaseRevision" >= 0)')
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE)\b/i)
  })

  it("uses separately tracked online phases without disabling append-only storage", () => {
    for (const transactionalMigration of [
      expandMigration,
      backfillMigration,
      contractMigration,
    ]) {
      expect(transactionalMigration).toContain("BEGIN;")
      expect(transactionalMigration.trimEnd().endsWith("COMMIT;")).toBe(true)
    }
    expect(backfillMigration).toContain("SET LOCAL lock_timeout = '3s'")
    expect(backfillMigration).toContain("SET LOCAL statement_timeout = '2min'")
    expect(backfillMigration).toContain("SELECT set_config('app.rls_bypass', 'on', true)")
    expect(backfillMigration).toContain("SELECT set_config('app.workforce_exception_revision_backfill', 'on', true)")
    expect(backfillMigration).toContain("row_number() OVER")
    expect(backfillMigration).toContain('PARTITION BY "organizationId", "caseId"')
    expect(backfillMigration).toContain('ORDER BY "createdAt" ASC, "id" ASC')
    expect(backfillMigration).toContain('WHERE "caseRevision" IS NULL')
    expect(backfillMigration).toContain("pg_has_role(session_user, relation_owner, 'MEMBER')")
    expect(backfillMigration).toContain("(to_jsonb(NEW) - 'caseRevision') = (to_jsonb(OLD) - 'caseRevision')")
    expect(executableSql(decisionIndexMigration)).toMatch(
      /^CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"\s+ON "workforce_exception_decisions"\("organizationId", "caseId", "caseRevision"\);$/u,
    )
    expect(executableSql(responseIndexMigration)).toMatch(
      /^CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"\s+ON "workforce_exception_employee_responses"\("organizationId", "caseId", "observedCaseRevision"\);$/u,
    )
    for (const concurrentIndexMigration of [
      decisionIndexMigration,
      responseIndexMigration,
    ]) {
      expect(executableSql(concurrentIndexMigration)).not.toMatch(
        /\b(?:BEGIN|COMMIT|SET|RESET|DROP)\b/iu,
      )
      expect(executableSql(concurrentIndexMigration).match(/;/gu)).toHaveLength(1)
    }
    expect(expandMigration).toContain('CHECK ("caseRevision" IS NOT NULL) NOT VALID')
    expect(contractMigration).toContain('VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_not_null_check"')
    expect(contractMigration).toContain('ALTER COLUMN "caseRevision" SET NOT NULL')
    expect(migration).not.toMatch(/LOCK TABLE[\s\S]*ACCESS EXCLUSIVE/i)
    expect(migration).not.toMatch(/DISABLE TRIGGER|ENABLE TRIGGER/i)

    expect(expandMigration).toContain("CREATE TRIGGER workforce_exception_decisions_assign_case_revision")
    expect(backfillMigration).toContain('UPDATE "workforce_exception_decisions" decisions')
    expect(decisionIndexMigration).toContain("CREATE UNIQUE INDEX CONCURRENTLY")
    expect(responseIndexMigration).toContain("CREATE INDEX CONCURRENTLY")
    expect(contractMigration).toContain('VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_check"')
  })

  it("keeps old binaries compatible while rejecting a stale new-binary revision", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_assign_exception_decision_revision()")
    expect(migration).toContain("CREATE TRIGGER workforce_exception_decisions_assign_case_revision")
    expect(migration).toContain("'workforce-exception-decision:' || NEW.\"organizationId\" || ':' || NEW.\"caseId\"")
    expect(migration).toContain('SELECT (COUNT(*) + 1)::INTEGER')
    expect(migration).toContain('IF NEW."caseRevision" IS NULL THEN')
    expect(migration).toContain('NEW."caseRevision" := expected_revision')
    expect(migration).toContain('ELSIF NEW."caseRevision" <> expected_revision THEN')
    expect(migration).toContain("USING ERRCODE = '23514'")
  })

  it("bridges old timestamp readers and old writers to the logical revision stream", () => {
    expect(expandMigration).toContain("CREATE OR REPLACE FUNCTION workforce_next_exception_compatibility_timestamp(")
    expect(expandMigration).toContain("MAX(lifecycle_event.\"eventAt\") + INTERVAL '1 millisecond'")
    expect(expandMigration).toContain('NEW."createdAt" := GREATEST(')
    expect(expandMigration).toContain('IF NEW."observedCaseRevision" IS NULL THEN')
    expect(expandMigration).toContain('NEW."observedCaseRevision" := current_case_revision')
    expect(expandMigration).toContain('IF NEW."exceptionCaseRevision" IS NULL THEN')
    expect(expandMigration).toContain('NEW."exceptionCaseRevision" := current_case_revision')
    expect(expandMigration.match(/SELECT COUNT\(\*\)::INTEGER/g)).toHaveLength(2)
    expect(expandMigration).toContain('NEW."submittedAt" := GREATEST(')
    expect(expandMigration).toContain('WHERE "organizationId" = input_organization_id AND "exceptionCaseId" = input_case_id')
  })

  it("binds every non-legacy employee signal to the exact locked revision", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_exception_employee_response_insert()")
    expect(migration).toContain('request_exception_case_id IS DISTINCT FROM NEW."caseId"')
    expect(migration).toContain('NEW."observedCaseRevision" <> current_case_revision')
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_hrm_request_exception_link()")
    expect(migration).toContain('NEW."exceptionCaseRevision" <> current_case_revision')
    expect(migration).toContain('OLD."exceptionCaseRevision" IS DISTINCT FROM NEW."exceptionCaseRevision"')
    expect(migration).toContain('"exceptionCaseRevision" IS NULL OR "exceptionCaseId" IS NOT NULL')
    expect(migration).toContain("IF TG_OP = 'INSERT' THEN")
    expect(migration).not.toMatch(/RESOLVE_NO_CHANGE|RESOLVE_WITH_CORRECTION|REOPEN_FOR_REVIEW/)
  })
})
