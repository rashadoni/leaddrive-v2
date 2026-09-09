import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql",
), "utf8")

describe("Workforce H3 foundation migration", () => {
  it("adds the policy, schedule, immutable fact, exception and timesheet models", () => {
    for (const model of [
      "WorkforcePolicy",
      "WorkforceShiftTemplate",
      "WorkforceShiftAssignment",
      "WorkforcePolicySnapshot",
      "WorkforceShiftSnapshot",
      "WorkforceAttendanceException",
      "WorkforceTimeCorrection",
      "WorkforceTimesheetApproval",
    ]) {
      expect(schema).toContain(`model ${model} {`)
    }

    for (const table of [
      "workforce_policies",
      "workforce_shift_templates",
      "workforce_shift_assignments",
      "workforce_policy_snapshots",
      "workforce_shift_snapshots",
      "workforce_attendance_exceptions",
      "workforce_time_corrections",
      "workforce_timesheet_approvals",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
      expect(migration).toContain(`'${table}'`)
    }
  })

  it("binds audit actors and approvers to the same tenant", () => {
    for (const field of [
      "createdByUserId",
      "activatedByUserId",
      "assignedByUserId",
      "resolvedByUserId",
      "actorUserId",
      "approvedByUserId",
      "correctionActorUserId",
    ]) {
      expect(migration).toContain(`FOREIGN KEY ("organizationId", "${field}") REFERENCES "users"("organizationId", "id")`)
    }
  })

  it("keeps schedule and approved-time facts coherent and append-only", () => {
    expect(migration).toContain('ADD CONSTRAINT "workforce_shift_assignments_no_overlap"')
    expect(migration).toContain('EXCLUDE USING gist')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_validate_h3_insert()')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_guard_published_definition()')
    expect(migration).toContain('CREATE TRIGGER workforce_policies_published_definition_guard')
    expect(migration).toContain('CREATE TRIGGER workforce_shift_templates_published_definition_guard')
    expect(migration).toContain('CREATE TRIGGER workforce_policies_published_definition_delete_guard')
    expect(migration).toContain('CREATE TRIGGER workforce_shift_templates_published_definition_delete_guard')
    expect(migration).toContain('published definition cannot be deleted; retire it instead')
    expect(migration).toContain("WHEN 'RETIRED' THEN ARRAY['updatedAt']")
    expect(migration).toContain('CREATE TRIGGER workforce_shift_assignments_guard')
    expect(migration).toContain('CREATE TRIGGER workforce_attendance_exceptions_update_guard')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "workforce_attendance_exceptions"')
    expect(migration).toContain('policy_row."status" = \'DRAFT\'::"WorkforceDefinitionStatus"')
    expect(migration).toContain('template_row."status" = \'DRAFT\'::"WorkforceDefinitionStatus"')
    expect(migration).toContain('workday_row."startedAt" > policy_row."retiredAt"')
    expect(migration).toContain('workday_row."startedAt" > template_row."retiredAt"')
    expect(migration).toContain('workday_row."startedAt" < policy_row."activatedAt"')
    expect(migration).toContain('workday_row."startedAt" < template_row."activatedAt"')
    expect(migration).toContain('Team-scoped Workforce policy resolution requires an explicit historical team rule')
    expect(migration).toContain('"beforeFacts" IS DISTINCT FROM "afterFacts"')
    expect(migration).toContain('"source" = \'DIRECT_MANAGER\' AND "requestId" IS NULL')
    expect(migration).toContain('CREATE UNIQUE INDEX "workforce_time_corrections_request_key"')
    expect(migration).toContain('NEW."revision" <> parent_approval_row."revision" + 1')
    expect(migration).toContain('CREATE UNIQUE INDEX "workforce_timesheet_approvals_organizationId_supersedesId_key"')

    for (const table of [
      "workforce_policy_snapshots",
      "workforce_shift_snapshots",
      "workforce_time_corrections",
      "workforce_timesheet_approvals",
    ]) {
      expect(migration).toContain(`BEFORE UPDATE OR DELETE ON "${table}"`)
      expect(migration).toContain(`'${table}'`)
    }
  })

  it("uses RLS without granting immutable facts a normal update path", () => {
    expect(migration).toContain("CREATE POLICY %I ON %I FOR SELECT")
    expect(migration).toContain("CREATE POLICY %I ON %I FOR INSERT")
    expect(migration).toContain("CREATE POLICY %I ON %I FOR UPDATE")
    expect(migration).not.toContain("CREATE POLICY %I ON %I FOR DELETE")
    expect(migration).not.toContain("app.workforce_retention_purge")
    expect(migration).toMatch(/legal\/contract\s*(?:--\s*)?hold and audit model/)
    expect(migration).toContain("SELECT tableowner INTO app_owner")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I")
    expect(migration).toContain("GRANT SELECT, INSERT ON TABLE public.%I TO %I")
    expect(migration).not.toContain("scopeKey")
  })

  it("does not seed or rewrite legacy workday/request data", () => {
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\s+"?mtm_/i)
  })
})
