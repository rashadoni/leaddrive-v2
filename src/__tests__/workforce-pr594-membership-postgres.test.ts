import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { PrismaClient } from "@prisma/client"
import { assertWorkforceReconciliationScheduleSubjects as assertSubjects } from "@/lib/workforce/reconciliation-schedule-subject"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import { readWorkforceEligibleRosterHealth } from "@/lib/workforce/reconciliation-roster-health"

const url = process.env.WORKFORCE_MEMBERSHIP_COMPATIBILITY_TEST_DATABASE_URL
const definition = { startTime: "09:00", endTime: "18:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }
const snapshot = (agentId = "history-a") => ({ workdays: [], events: [], transitions: [], evidence: [], exceptions: [{ id: "exception-a", organizationId: "org-a", agentId, workdayId: null, workdayEventId: null, evidenceId: null, segmentId: "segment-a", expectedWorkDate: "2026-10-01" }] }) as unknown as Parameters<typeof assertSubjects>[2]

describe.skipIf(!url)("PR594 actual migration and historical subject compatibility on disposable PostgreSQL", () => {
  let db: PrismaClient
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/hrm_membership_compatibility_test") throw new Error("MEMBERSHIP_TEST_DB_NOT_ISOLATED")
    db = new PrismaClient({ datasources: { db: { url } } })
    const ddl = [
      'CREATE TABLE organizations (id text PRIMARY KEY,"isActive" boolean NOT NULL,plan text,addons jsonb,features jsonb,modules jsonb,"createdAt" timestamp(3) NOT NULL DEFAULT now())',
      'CREATE TABLE workforce_reconciliation_tenant_states ("organizationId" text PRIMARY KEY REFERENCES organizations(id),"lastAttemptAt" timestamp(3),"lastCompletedAt" timestamp(3),"dueAt" timestamp(3),"lastOutcome" text)',
      'CREATE TABLE mtm_agents (id text PRIMARY KEY,"organizationId" text NOT NULL,"teamId" text, UNIQUE ("organizationId",id))',
      'CREATE TABLE workforce_employee_team_memberships (id text PRIMARY KEY,"organizationId" text NOT NULL,"agentId" text NOT NULL,"teamId" text,"effectiveAt" timestamp(3) NOT NULL,source text NOT NULL,"recordedAt" timestamp(3) NOT NULL DEFAULT now(), CONSTRAINT workforce_employee_team_memberships_agent_fkey FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE)',
      'CREATE TABLE workforce_exception_cases (id text PRIMARY KEY,"organizationId" text NOT NULL,"agentId" text NOT NULL,FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT)',
      'CREATE TABLE workforce_shift_templates (id text PRIMARY KEY,"organizationId" text NOT NULL,"teamId" text,"isDefault" boolean NOT NULL,version integer NOT NULL,status text NOT NULL,timezone text NOT NULL,"activatedAt" timestamp(3),"retiredAt" timestamp(3),definition jsonb NOT NULL,"definitionHash" varchar(64) NOT NULL)',
      'CREATE TABLE workforce_shift_segments (id text PRIMARY KEY,"organizationId" text NOT NULL,"templateId" text NOT NULL,sequence integer NOT NULL,"startTime" text NOT NULL)',
      'CREATE TABLE workforce_shift_assignments (id text PRIMARY KEY,"organizationId" text NOT NULL,"agentId" text NOT NULL,"templateId" text NOT NULL,"effectiveFrom" date NOT NULL,"effectiveTo" date)',
      'CREATE TABLE workforce_shift_default_assignments (id text PRIMARY KEY,"organizationId" text NOT NULL,"templateId" text NOT NULL,"effectiveFrom" date NOT NULL,"effectiveTo" date)',
      'CREATE TABLE workforce_shift_team_default_assignments (id text PRIMARY KEY,"organizationId" text NOT NULL,"teamId" text NOT NULL,"templateId" text NOT NULL,"effectiveFrom" date NOT NULL,"effectiveTo" date)',
    ]
    for (const sql of ddl) await db.$executeRawUnsafe(sql)
    const original = readFileSync("prisma/migrations/20260830130000_workforce_employee_team_membership_history/migration.sql", "utf8")
    for (const pattern of [
      /CREATE OR REPLACE FUNCTION workforce_capture_employee_team_membership\(\)[\s\S]*?\$\$;/,
      /CREATE TRIGGER workforce_capture_employee_team_membership_after_change[\s\S]*?;/,
      /CREATE OR REPLACE FUNCTION workforce_reject_employee_team_membership_mutation\(\)[\s\S]*?\$\$;/,
      /CREATE TRIGGER workforce_employee_team_memberships_immutable[\s\S]*?;/,
    ]) {
      const statement = original.match(pattern)?.[0]
      if (!statement) throw new Error("MEMBERSHIP_TRIGGER_SOURCE_MISSING")
      await db.$executeRawUnsafe(statement)
    }
    await db.$executeRaw`INSERT INTO mtm_agents VALUES ('before','org-a',NULL)`
    await expect(db.$executeRaw`DELETE FROM mtm_agents WHERE id='before'`).rejects.toThrow(/foreign key/i)
    const migration = readFileSync("prisma/migrations/20261006120000_workforce_team_membership_follows_deleted_agent/migration.sql", "utf8")
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const applied = spawnSync(process.execPath, [cli, "db", "execute", "--url", url!, "--stdin"], { input: `BEGIN;\n${migration}\nCOMMIT;`, encoding: "utf8" })
    if (applied.status !== 0) throw new Error("PR594_FIXTURE_MIGRATION_FAILED")
    await db.$executeRaw`DELETE FROM mtm_agents WHERE id='before'`
  }, 30_000)
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE organizations,workforce_reconciliation_tenant_states,mtm_agents,workforce_employee_team_memberships,workforce_exception_cases,workforce_shift_templates,workforce_shift_segments,workforce_shift_assignments,workforce_shift_default_assignments,workforce_shift_team_default_assignments')
    await db.$executeRaw`INSERT INTO organizations VALUES ('org-a',true,'starter','[]','["workforce-hrm"]','{}','2026-01-01')`
    await db.$executeRaw`INSERT INTO mtm_agents VALUES ('history-a','org-a','team-current'),('setup-a','org-a',NULL)`
    await db.$executeRaw`INSERT INTO workforce_employee_team_memberships (id,"organizationId","agentId","teamId","effectiveAt",source) VALUES ('historical-membership','org-a','history-a','team-historical','2026-01-01','FIXTURE_HISTORY')`
    await db.$executeRaw`INSERT INTO workforce_exception_cases VALUES ('exception-a','org-a','history-a')`
    await db.$executeRaw`INSERT INTO workforce_shift_templates VALUES ('template-a','org-a','team-historical',true,1,'ACTIVE','UTC','2026-01-01',NULL,${JSON.stringify(definition)}::jsonb,${workforceShiftDefinitionHash(definition)})`
    await db.$executeRaw`INSERT INTO workforce_shift_segments VALUES ('segment-a','org-a','template-a',1,'09:00')`
    await db.$executeRaw`INSERT INTO workforce_shift_team_default_assignments VALUES ('assignment-a','org-a','team-historical','template-a','2026-01-01',NULL)`
  })
  afterAll(async () => { if (db) await db.$disconnect() })

  it("deletes a setup-only employee and its automatic membership, preserving tenant coverage", async () => {
    const before = await readWorkforceEligibleRosterHealth(db)
    expect(before).toMatchObject({ status: "ATTENTION", counts: { eligible: 1, neverAttempted: 1, neverMatched: 1 } })
    await expect(db.$executeRaw`DELETE FROM mtm_agents WHERE id='setup-a'`).resolves.toBe(1)
    expect(await db.$queryRaw`SELECT id FROM workforce_employee_team_memberships WHERE "agentId"='setup-a'`).toEqual([])
    const after = await readWorkforceEligibleRosterHealth(db)
    expect(after).toMatchObject({ status: before.status, coverage: before.coverage, counts: "counts" in before ? before.counts : {}, alerts: before.alerts })
  })
  it("retains schedule-only exception employee and membership when deletion is refused", async () => {
    await db.$transaction(tx => assertSubjects(tx, "org-a", snapshot()))
    await expect(db.$executeRaw`DELETE FROM mtm_agents WHERE id='history-a'`).rejects.toThrow(/foreign key/i)
    expect(await db.$queryRaw`SELECT id FROM workforce_employee_team_memberships WHERE id='historical-membership'`).toEqual([{ id: "historical-membership" }])
    await db.$transaction(tx => assertSubjects(tx, "org-a", snapshot()))
  })
  it("keeps direct membership DELETE and UPDATE immutable for an existing employee", async () => {
    await expect(db.$executeRaw`DELETE FROM workforce_employee_team_memberships WHERE id='historical-membership'`).rejects.toThrow(/immutable/i)
    await expect(db.$executeRaw`UPDATE workforce_employee_team_memberships SET "teamId"='tampered' WHERE id='historical-membership'`).rejects.toThrow(/immutable/i)
  })
  it("resolves the historical team instead of the current directory team", async () => {
    expect(await db.$queryRaw`SELECT "teamId" FROM mtm_agents WHERE id='history-a'`).toEqual([{ teamId: "team-current" }])
    await expect(db.$transaction(tx => assertSubjects(tx, "org-a", snapshot()))).resolves.toBeUndefined()
  })
  it("refuses an orphan subject instead of inventing a missing employee/team", async () => {
    await expect(db.$transaction(tx => assertSubjects(tx, "org-a", snapshot("missing-agent")))).rejects.toThrow(/^WORKFORCE_SWEEP_SCHEDULE_UNAVAILABLE$/)
  })
})
