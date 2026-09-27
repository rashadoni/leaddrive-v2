import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql",
), "utf8")

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

  it("uses bounded expand/backfill/index/contract phases without disabling append-only storage", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration).toContain("SET LOCAL lock_timeout = '3s'")
    expect(migration).toContain("SET LOCAL statement_timeout = '2min'")
    expect(migration).toContain("SELECT set_config('app.rls_bypass', 'on', true)")
    expect(migration).toContain("SELECT set_config('app.workforce_exception_revision_backfill', 'on', true)")
    expect(migration).toContain("row_number() OVER")
    expect(migration).toContain('PARTITION BY "organizationId", "caseId"')
    expect(migration).toContain('ORDER BY "createdAt" ASC, "id" ASC')
    expect(migration).toContain('WHERE "caseRevision" IS NULL')
    expect(migration).toContain("pg_has_role(session_user, relation_owner, 'MEMBER')")
    expect(migration).toContain("(to_jsonb(NEW) - 'caseRevision') = (to_jsonb(OLD) - 'caseRevision')")
    expect(migration).toContain('CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_decisions_org_case_revision_key"')
    expect(migration).toContain('CREATE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_idx"')
    expect(migration).toContain('CHECK ("caseRevision" IS NOT NULL) NOT VALID')
    expect(migration).toContain('VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_not_null_check"')
    expect(migration).toContain('ALTER COLUMN "caseRevision" SET NOT NULL')
    expect(migration).not.toMatch(/LOCK TABLE[\s\S]*ACCESS EXCLUSIVE/i)
    expect(migration).not.toMatch(/DISABLE TRIGGER|ENABLE TRIGGER/i)
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true)

    const compatibilityTrigger = migration.indexOf("CREATE TRIGGER workforce_exception_decisions_assign_case_revision")
    const backfill = migration.indexOf('UPDATE "workforce_exception_decisions" decisions')
    const concurrentIndex = migration.indexOf("CREATE UNIQUE INDEX CONCURRENTLY")
    const validation = migration.indexOf('VALIDATE CONSTRAINT "workforce_exception_decisions_case_revision_check"')
    expect(compatibilityTrigger).toBeGreaterThan(0)
    expect(backfill).toBeGreaterThan(compatibilityTrigger)
    expect(concurrentIndex).toBeGreaterThan(backfill)
    expect(validation).toBeGreaterThan(concurrentIndex)
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

  it("binds every non-legacy employee signal to the exact locked revision", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_exception_employee_response_insert()")
    expect(migration).toContain('request_exception_case_id IS DISTINCT FROM NEW."caseId"')
    expect(migration).toContain('NEW."observedCaseRevision" <> current_case_revision')
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_hrm_request_exception_link()")
    expect(migration).toContain('NEW."exceptionCaseRevision" <> current_case_revision')
    expect(migration).toContain('OLD."exceptionCaseRevision" IS DISTINCT FROM NEW."exceptionCaseRevision"')
    expect(migration).toContain('"exceptionCaseRevision" IS NULL OR "exceptionCaseId" IS NOT NULL')
    expect(migration).toContain("IF TG_OP = 'INSERT' AND NEW.\"exceptionCaseRevision\" IS NOT NULL THEN")
    expect(migration).not.toMatch(/RESOLVE_NO_CHANGE|RESOLVE_WITH_CORRECTION|REOPEN_FOR_REVIEW/)
  })
})
