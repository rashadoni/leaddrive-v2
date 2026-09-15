import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseMtmWorkdayEvent } from "@/lib/mtm/workday"

const root = process.cwd()
const migrationsRoot = join(root, "prisma/migrations")
const ENUM_MIGRATION = "20260915210000_workforce_workday_reopen_event_type"
const LEDGER_MIGRATION = "20260915210100_workforce_workday_reopen_ledger"

const migration = (name: string) => readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8")
const enumMigration = migration(ENUM_MIGRATION)
const ledgerMigration = migration(LEDGER_MIGRATION)
const previousGuardMigration = migration("20260828230000_workforce_direct_correction_contract")
const service = readFileSync(join(root, "src/lib/workforce/workday-reopen.ts"), "utf8")
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}()`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf("$$;", start)
  expect(end, name).toBeGreaterThan(start)
  return sql.slice(start, end + 3)
}

const tenantPredicate = `"organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on'`

describe("Workforce workday reopen migrations", () => {
  it("adds REOPEN alone in its own migration, applied before the ledger that relies on it", () => {
    expect(readdirSync(join(migrationsRoot, ENUM_MIGRATION))).toEqual(["migration.sql"])
    expect(statements(enumMigration)).toEqual([
      `ALTER TYPE "MtmWorkdayEventType" ADD VALUE IF NOT EXISTS 'REOPEN'`,
    ])
    const ordered = readdirSync(migrationsRoot).sort()
    expect(ordered.indexOf(ENUM_MIGRATION)).toBeGreaterThanOrEqual(0)
    expect(ordered.indexOf(ENUM_MIGRATION)).toBeLessThan(ordered.indexOf(LEDGER_MIGRATION))
    expect(schema).toMatch(/enum MtmWorkdayEventType \{[^}]*\bREOPEN\b[^}]*\}/)
    expect(schema).toMatch(/model WorkforceWorkdayReopen \{[\s\S]*?@@map\("workforce_workday_reopens"\)/)
  })

  it("keeps REOPEN out of the employee action parser shared by web and mobile transports", () => {
    const parsed = parseMtmWorkdayEvent({
      action: "REOPEN",
      workdayId: "workday-1",
      occurredAt: "2026-09-15T14:00:00.000Z",
    }, "client-event-1", "Asia/Baku", new Date("2026-09-15T14:00:05.000Z"))

    expect(parsed).toEqual({ input: null, error: "Invalid workday action" })
  })

  it("stores reopen facts append-only under FORCE row-level security", () => {
    expect(ledgerMigration).toContain('CREATE TABLE "workforce_workday_reopens" (')
    expect(ledgerMigration).toContain('ALTER TABLE "workforce_workday_reopens" ENABLE ROW LEVEL SECURITY;')
    expect(ledgerMigration).toContain('ALTER TABLE "workforce_workday_reopens" FORCE ROW LEVEL SECURITY;')
    expect(ledgerMigration).toContain(
      `CREATE POLICY workforce_workday_reopens_tenant_select\n  ON "workforce_workday_reopens" FOR SELECT\n  USING (${tenantPredicate});`,
    )
    expect(ledgerMigration).toContain(
      `CREATE POLICY workforce_workday_reopens_tenant_insert\n  ON "workforce_workday_reopens" FOR INSERT\n  WITH CHECK (${tenantPredicate});`,
    )
    expect(ledgerMigration.match(/CREATE POLICY/g)).toHaveLength(2)
    expect(ledgerMigration).toContain(
      'CREATE TRIGGER workforce_workday_reopens_append_only\n  BEFORE UPDATE OR DELETE ON "workforce_workday_reopens"\n  FOR EACH ROW EXECUTE FUNCTION workforce_reject_workday_reopen_mutation();',
    )
    expect(functionBody(ledgerMigration, "workforce_reject_workday_reopen_mutation"))
      .toContain("RAISE EXCEPTION 'Workforce workday reopen facts are immutable' USING ERRCODE = '55000';")
    expect(ledgerMigration).toContain(
      "EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', 'workforce_workday_reopens', app_owner);",
    )
    expect(ledgerMigration).toContain(
      'CREATE UNIQUE INDEX "workforce_workday_reopens_operation_key"\n  ON "workforce_workday_reopens"("organizationId", "operationId");',
    )
    expect(ledgerMigration).toContain(
      'CREATE UNIQUE INDEX "workforce_workday_reopens_event_key"\n  ON "workforce_workday_reopens"("organizationId", "eventId");',
    )
    expect(ledgerMigration).toContain(`CHECK ("requestHash" ~ '^[0-9a-f]{64}$')`)
    expect(ledgerMigration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(ledgerMigration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|COLUMN|TRIGGER|POLICY)\b/i)
    expect(ledgerMigration).not.toMatch(/^\s*UPDATE\s+/im)
  })

  it("keeps every line of the previous completed-workday guard and adds only the reopen path", () => {
    const previous = functionBody(previousGuardMigration, "workforce_guard_completed_workday").split("\n")
    const current = functionBody(ledgerMigration, "workforce_guard_completed_workday").split("\n")
    const added: string[] = []
    let matched = 0
    for (const line of current) {
      if (matched < previous.length && line === previous[matched]) matched += 1
      else added.push(line)
    }

    expect(matched).toBe(previous.length)
    const addedSql = added.join("\n")
    expect(addedSql).toContain("reopen_id TEXT := current_setting('app.workforce_reopen_id', true);")
    expect(addedSql).toContain(`IF NEW."status" = 'PAUSED' AND NULLIF(reopen_id, '') IS NOT NULL THEN`)
    expect(addedSql).toContain(`NEW."completedAt" IS NOT NULL`)
    expect(addedSql).toContain(`NEW."pausedAt" IS DISTINCT FROM OLD."completedAt"`)
    expect(addedSql).toContain(
      `(to_jsonb(NEW) - ARRAY['status', 'pausedAt', 'completedAt', 'updatedAt'])`,
    )
    expect(addedSql).toContain('FROM "workforce_workday_reopens" reopen_row')
    expect(addedSql).toContain('workforce_workday_fact_matches(reopen_row."beforeFacts", OLD)')
    expect(addedSql).toContain('workforce_workday_fact_matches(reopen_row."afterFacts", NEW)')
    expect(addedSql).not.toContain("workforce_time_corrections")
    expect(addedSql).not.toContain("correction_id")

    // Reachable: the branch is decided before the old rejection of any
    // COMPLETED -> non-COMPLETED update.
    const guard = current.join("\n")
    expect(guard.indexOf("NULLIF(reopen_id, '')")).toBeLessThan(
      guard.indexOf("Completed Workforce workday cannot reopen or become invalid"),
    )
    // An undo is an ordinary FINISH of a PAUSED day: the guard returns before
    // any COMPLETED-only branch, so it needs no reopen or correction context.
    expect(guard.indexOf(`IF OLD."status" <> 'COMPLETED' THEN`)).toBeLessThan(guard.indexOf("NULLIF(reopen_id, '')"))
    expect(guard).not.toMatch(/now\(\)|CURRENT_TIMESTAMP|occurredAt/)
  })

  it("creates every function its triggers run, so a database built by `prisma db push` can apply it", () => {
    // db push creates tables but no functions; the shared H3 helper
    // workforce_reject_immutable_mutation() does not exist there.
    const executed = [...ledgerMigration.matchAll(/EXECUTE FUNCTION (\w+)\(\)/g)].map((match) => match[1])

    expect(executed).toEqual(["workforce_validate_workday_reopen_insert", "workforce_reject_workday_reopen_mutation"])
    for (const name of executed) {
      expect(ledgerMigration, name).toContain(`CREATE OR REPLACE FUNCTION ${name}()`)
    }
    expect(ledgerMigration).not.toContain("workforce_reject_immutable_mutation")
  })

  it("carries the rollback rule: the enum value and the REOPEN replay case stay", () => {
    for (const sql of [enumMigration, ledgerMigration]) {
      expect(sql).toMatch(/-- Rollback:/)
      expect(sql).toContain("REOPEN case of the journal")
    }
    expect(enumMigration).toContain("never drop this value")
    expect(ledgerMigration).toContain("a revert must keep this table, the")
  })

  it("admits a ledger row only for this workday's REOPEN event, current facts and a non-employee actor", () => {
    const validator = functionBody(ledgerMigration, "workforce_validate_workday_reopen_insert")

    expect(ledgerMigration).toContain(
      'CREATE TRIGGER workforce_workday_reopens_validate_insert\n  BEFORE INSERT ON "workforce_workday_reopens"',
    )
    expect(validator).toContain(`workday_row."status" <> 'COMPLETED'`)
    expect(validator).toContain('workforce_workday_fact_matches(NEW."beforeFacts", workday_row)')
    expect(validator).toContain(`NEW."afterFacts"->>'pausedAt' IS DISTINCT FROM NEW."beforeFacts"->>'completedAt'`)
    expect(validator).toContain(`event_type <> 'REOPEN'`)
    // The REOPEN is recorded at the finish it reopens; the ledger's own
    // occurredAt is the server time the manager acted and is not compared.
    expect(validator).toContain('event_occurred_at IS DISTINCT FROM workday_row."completedAt"')
    expect(validator).not.toContain('NEW."occurredAt"')
    expect(validator).toContain('event_workday_id <> NEW."workdayId"')
    expect(validator).toContain('linked_user_id = NEW."actorUserId"')
  })

  it("selects the reopen ledger for the guard only after writing it", () => {
    const event = service.indexOf("await tx.mtmAgentWorkdayEvent.create(")
    const ledger = service.indexOf("await tx.workforceWorkdayReopen.create(")
    const context = service.indexOf("set_config('app.workforce_reopen_id'")
    const projection = service.indexOf("await tx.mtmAgentWorkday.update(")
    const audit = service.indexOf("await writeWorkforceWorkdayReopenAuditInTransaction(tx")

    expect(event).toBeGreaterThanOrEqual(0)
    expect(ledger).toBeGreaterThan(event)
    expect(context).toBeGreaterThan(ledger)
    expect(projection).toBeGreaterThan(context)
    expect(audit).toBeGreaterThan(projection)
    expect(service).not.toContain("app.workforce_correction_id")
  })
})
