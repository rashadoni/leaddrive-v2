import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { reconcileWorkforceDenseSnapshot } from "@/lib/workforce/reconciliation-dense"
import { workforceReconciliationOperationsStore, runWorkforceReconciliationTick } from "@/lib/workforce/reconciliation-operations"
import { createHash } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { readWorkforceReconciliationSnapshot as readSnapshot } from "@/lib/workforce/reconciliation-snapshot"
import { runWorkforceReconciliationSweep as sweep } from "@/lib/workforce/reconciliation-sweep"
import { reconcileWorkforceSnapshot } from "@/lib/workforce/reconciliation"
import { workforceReconciliationCursorStore } from "@/lib/workforce/reconciliation-cursor-store"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"
import { canonicalWorkforcePolicyJson } from "@/lib/workforce/policy-definition"

describe("full sweep input boundaries", () => {
  it("rejects invalid scope and pooled clients before querying; contains driver errors", async () => {
    const tx = { $queryRaw: vi.fn().mockRejectedValue(new Error("PRIVATE-DRIVER")) }
    await expect(readSnapshot(tx, " ")).rejects.toThrow(/^WORKFORCE_SWEEP_INPUT_INVALID$/)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    await expect(readSnapshot({ ...tx, $transaction: vi.fn() } as unknown as Parameters<typeof readSnapshot>[0], "org-a")).rejects.toThrow(/^WORKFORCE_SWEEP_CONTEXT_REQUIRED$/)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    await expect(readSnapshot(tx, "org-a")).rejects.toThrow(/^WORKFORCE_SWEEP_READ_FAILED$/)
  })
  it("rejects invalid worker input and unknown checkpoint protocol before starting a read", async () => {
    const reader = { $transaction: vi.fn() }
    const cursor = { read: vi.fn().mockResolvedValue({ version: 4, cursor: "PRIVATE-OLD-PROTOCOL" }), commit: vi.fn() }
    const args = { reader: reader as unknown as Parameters<typeof sweep>[0]["reader"], cursor, organizationId: "org-a", ownerToken: "owner-a" }
    await expect(sweep({ ...args, ownerToken: " " })).rejects.toThrow(/^WORKFORCE_SWEEP_INPUT_INVALID$/)
    expect(cursor.read).not.toHaveBeenCalled()
    await expect(sweep(args)).rejects.toThrow(/^WORKFORCE_SWEEP_CHECKPOINT_PROTOCOL_INVALID$/)
    cursor.read.mockRejectedValue(new Error("PRIVATE-DRIVER"))
    await expect(sweep(args)).rejects.toThrow(/^WORKFORCE_SWEEP_CHECKPOINT_READ_FAILED$/)
    expect(reader.$transaction).not.toHaveBeenCalled(); expect(cursor.commit).not.toHaveBeenCalled()
  })
})

const url = process.env.WORKFORCE_RECONCILIATION_SWEEP_TEST_DATABASE_URL
describe.skipIf(!url)("bounded full sweep on isolated PostgreSQL", () => {
  let db: PrismaClient
  let other: PrismaClient
  let cursor: ReturnType<typeof workforceReconciliationCursorStore>
  const payload = buildWorkforceTimesheetApproval({ periodStart: "2026-10-01", periodEnd: "2026-10-01", agentId: "agent-a", rows: [{
    agentId: "agent-a", workdayId: "day-a", workDate: "2026-10-01", calculationVersion: 1,
    calculation: { calculationVersion: 1, policySnapshotId: "policy-a", shiftSnapshotId: "shift-a", status: "COMPLETED", isFinal: true,
      plan: { plannedStartAt: "2026-10-01T00:00:00Z", plannedEndAt: "2026-10-01T01:00:00Z", expectedWorkSeconds: 3600, workDate: "2026-10-01", timezone: "UTC" },
      fact: { workdayId: "day-a", startedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-01T01:00:00Z", workedSeconds: 3600, pausedSeconds: 0, longestPauseSeconds: 0 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [] },
  }] })
  const definition = { startTime: "09:00", endTime: "18:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }
  const metadata = () => ({ approvalId: "approval-a", recordKind: "APPROVAL", revision: 1, periodStart: "2026-10-01", periodEnd: "2026-10-01", rowsHash: payload.rowsHash, factsHash: payload.factsHash, format: "workforce-approved-timesheet-v1", recipient: "SESSION_DIRECT_DOWNLOAD", purpose: "PRIVATE-PURPOSE" })
  const tables = ["organizations", "mtm_agent_workdays", "mtm_agent_workday_events", "workforce_site_transitions", "workforce_attendance_evidence", "workforce_evidence_assessments", "workforce_exception_cases", "workforce_timesheet_approvals", "mtm_audit_logs", "mtm_agents", "workforce_employee_team_memberships", "workforce_shift_templates", "workforce_shift_segments", "workforce_shift_assignments", "workforce_shift_default_assignments", "workforce_shift_team_default_assignments", "workforce_workday_schedule_snapshots", "workforce_shift_snapshots", "workforce_policy_snapshots"]
  async function readonly<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return fn(tx) }, { isolationLevel: "RepeatableRead", timeout: 30000 })
  }
  const load = () => readonly(tx => readSnapshot(tx, "org-a"))
  const run = () => sweep({ reader: db, cursor, organizationId: "org-a", ownerToken: "owner-a" })
  // Fingerprints remain test-local and cover all source columns, including excluded private payload.
  async function facts() {
    return Promise.all(tables.map(table => db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY id), '')) AS hash FROM "${table}" t`)))
  }
  async function safeStop() {
    const before = await facts(); const progress = await cursor.read()
    await expect(run()).rejects.toThrow(/^WORKFORCE_SWEEP_INCOMPLETE$/)
    expect(await cursor.read()).toEqual(progress); expect(await facts()).toEqual(before)
  }
  async function mismatch(code: string) {
    const before = await facts(); const progress = await cursor.read(); const result = await run()
    expect(result.status).toBe("MISMATCH"); expect(result.checkpoint).toBe("NOT_COMMITTED")
    expect(result.mismatchCounts).toHaveProperty(code); expect(await cursor.read()).toEqual(progress)
    expect(await facts()).toEqual(before); expect(JSON.stringify(result)).not.toMatch(/org-a|agent-a|day-a|PRIVATE/)
  }
  async function schedule(linked = false) {
    await db.$executeRaw`INSERT INTO workforce_shift_templates VALUES ('template-a', 'org-a', NULL, false, 1, 'ACTIVE', 'UTC', '2026-01-01', NULL, ${JSON.stringify(definition)}::jsonb, ${workforceShiftDefinitionHash(definition)})`
    await db.$executeRaw`INSERT INTO workforce_shift_segments VALUES ('segment-a', 'org-a', 'template-a', 1, '09:00')`
    await db.$executeRaw`INSERT INTO workforce_shift_assignments VALUES ('assignment-a', 'org-a', 'agent-a', 'template-a', '2026-01-01', NULL)`
    await db.$executeRaw`UPDATE workforce_exception_cases SET "segmentId" = 'segment-a', "workdayId" = ${linked ? 'day-a' : null}, "expectedWorkDate" = ${linked ? null : '2026-10-01'}::date`
    if (linked) {
      await db.$executeRaw`INSERT INTO workforce_shift_snapshots VALUES ('shift-a','org-a','day-a','agent-a','2026-10-01')`
      await db.$executeRaw`INSERT INTO workforce_policy_snapshots VALUES ('policy-a','org-a','day-a','agent-a','2026-10-01')`
      const value = { schemaVersion: 2, calendar: null, segments: [{ id: "segment-a", mode: "SITE", siteId: "site-a" }], sites: [], policySnapshotId: "policy-a", shiftSnapshotId: "shift-a" }
      const hash = createHash("sha256").update(canonicalWorkforcePolicyJson(value)).digest("hex")
      await db.$executeRaw`INSERT INTO workforce_workday_schedule_snapshots VALUES ('schedule-a','org-a','day-a','agent-a','2026-10-01','policy-a','shift-a',2,'null'::jsonb,${JSON.stringify(value.segments)}::jsonb,'[]'::jsonb,${hash})`
    }
  }
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/hrm_reconciliation_sweep_test") throw new Error("SWEEP_TEST_DB_NOT_ISOLATED")
    db = new PrismaClient({ datasources: { db: { url } } }); other = new PrismaClient({ datasources: { db: { url } } }); cursor = workforceReconciliationCursorStore(db)
    // Deliberately omit FK constraints so orphan/cross-tenant corruptions can be exercised.
    const ddl = [
      'CREATE TABLE organizations (id text PRIMARY KEY, "isActive" boolean NOT NULL, plan text NOT NULL, addons text[] NOT NULL, features jsonb NOT NULL, modules jsonb NOT NULL, "createdAt" timestamp(3) NOT NULL)', 
      'CREATE TABLE mtm_agent_workdays (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "workDate" date NOT NULL, "startedAt" timestamp(3) NOT NULL, private text)',
      ...["mtm_agent_workday_events", "workforce_site_transitions"].map(t => `CREATE TABLE ${t} (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "workdayId" text NOT NULL, private text)`),
      'CREATE TABLE workforce_attendance_evidence (id text PRIMARY KEY, "organizationId" text NOT NULL, "workdayEventId" text, "siteTransitionId" text, private jsonb)',
      'CREATE TABLE workforce_evidence_assessments (id text PRIMARY KEY, "organizationId" text NOT NULL, "evidenceId" text NOT NULL, private jsonb)',
      'CREATE TABLE workforce_exception_cases (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "workdayId" text, "workdayEventId" text, "evidenceId" text, "segmentId" text, "expectedWorkDate" date, private text)',
      'CREATE TABLE workforce_timesheet_approvals (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "periodStart" date NOT NULL, "periodEnd" date NOT NULL, "recordKind" text NOT NULL, revision integer NOT NULL, "supersedesId" text, "calculationVersion" integer NOT NULL, "rowsHash" varchar(64) NOT NULL, "factsHash" varchar(64) NOT NULL, rows jsonb NOT NULL, "approvedAt" timestamp(3) NOT NULL)',
      'CREATE TABLE mtm_audit_logs (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text, action text NOT NULL, entity text NOT NULL, "entityId" text, "metadataKind" text, "newData" jsonb, "createdAt" timestamp(3) NOT NULL, private text)',
      'CREATE TABLE mtm_agents (id text PRIMARY KEY, "organizationId" text NOT NULL)',
      'CREATE TABLE workforce_employee_team_memberships (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "teamId" text, "effectiveAt" timestamp(3) NOT NULL)',
      'CREATE TABLE workforce_shift_templates (id text PRIMARY KEY, "organizationId" text NOT NULL, "teamId" text, "isDefault" boolean NOT NULL, version integer NOT NULL, status text NOT NULL, timezone text NOT NULL, "activatedAt" timestamp(3), "retiredAt" timestamp(3), definition jsonb NOT NULL, "definitionHash" varchar(64) NOT NULL)',
      'CREATE TABLE workforce_shift_segments (id text PRIMARY KEY, "organizationId" text NOT NULL, "templateId" text NOT NULL, sequence integer NOT NULL, "startTime" text NOT NULL)',
      'CREATE TABLE workforce_shift_assignments (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL, "templateId" text NOT NULL, "effectiveFrom" date NOT NULL, "effectiveTo" date)',
      'CREATE TABLE workforce_shift_default_assignments (id text PRIMARY KEY, "organizationId" text NOT NULL, "templateId" text NOT NULL, "effectiveFrom" date NOT NULL, "effectiveTo" date)',
      'CREATE TABLE workforce_shift_team_default_assignments (id text PRIMARY KEY, "organizationId" text NOT NULL, "teamId" text NOT NULL, "templateId" text NOT NULL, "effectiveFrom" date NOT NULL, "effectiveTo" date)',
      'CREATE TABLE workforce_workday_schedule_snapshots (id text PRIMARY KEY, "organizationId" text NOT NULL, "workdayId" text NOT NULL, "agentId" text NOT NULL, "workDate" date NOT NULL, "policySnapshotId" text NOT NULL, "shiftSnapshotId" text NOT NULL, "schemaVersion" integer NOT NULL, "calendarSnapshot" jsonb, segments jsonb NOT NULL, sites jsonb NOT NULL, "snapshotHash" varchar(64) NOT NULL)',
      ...["workforce_shift_snapshots", "workforce_policy_snapshots"].map(t => `CREATE TABLE ${t} (id text PRIMARY KEY, "organizationId" text NOT NULL, "workdayId" text NOT NULL, "agentId" text NOT NULL, "workDate" date NOT NULL)`),
      'CREATE TABLE system_job_leases (name text PRIMARY KEY, "ownerToken" text NOT NULL, "leaseUntil" timestamp(3) NOT NULL, status text NOT NULL)',
      'CREATE TABLE system_job_cursors (name text PRIMARY KEY, cursor text, version integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL DEFAULT now())',
    ]
    for (const sql of ddl) await db.$executeRawUnsafe(sql)
    const migration = readFileSync("prisma/migrations/20261005193000_workforce_reconciliation_operations/migration.sql", "utf8")
    for (const sql of migration.replace(/^--.*$/gm, "").split(";").filter(sql => sql.trim())) await db.$executeRawUnsafe(sql)
    await db.$executeRaw`CREATE ROLE wf_ops_fixture_reader NOLOGIN NOSUPERUSER NOBYPASSRLS`
    await db.$executeRawUnsafe(`GRANT SELECT ON ${tables.join(",")},workforce_reconciliation_tenant_states TO wf_ops_fixture_reader`)
    for (const table of tables.filter(table => table !== "organizations")) {
      await db.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      await db.$executeRawUnsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)
      await db.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON ${table} USING ("organizationId"=current_setting('app.org_id',true))`)
    }
  })
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.join(",")},system_job_leases,system_job_cursors,workforce_reconciliation_tenant_states`)
    await db.$executeRaw`INSERT INTO organizations VALUES ('org-a',true,'starter','{}','["workforce-hrm"]','{}','2026-01-01')`
    await db.$executeRaw`INSERT INTO mtm_agents VALUES ('agent-a','org-a')`
    await db.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('day-a','org-a','agent-a','2026-10-01','2026-10-01 09:00:00','PRIVATE-DAY')`
    await db.$executeRaw`INSERT INTO mtm_agent_workday_events VALUES ('event-a','org-a','agent-a','day-a','PRIVATE-EVENT')`
    await db.$executeRaw`INSERT INTO workforce_site_transitions VALUES ('transition-a','org-a','agent-a','day-a','PRIVATE-LOCATION')`
    await db.$executeRaw`INSERT INTO workforce_attendance_evidence VALUES ('evidence-a','org-a','event-a',NULL,'{"note":"PRIVATE-EVIDENCE"}')`
    await db.$executeRaw`INSERT INTO workforce_evidence_assessments VALUES ('assessment-a','org-a','evidence-a','{"note":"PRIVATE-ASSESSMENT"}')`
    await db.$executeRaw`INSERT INTO workforce_exception_cases VALUES ('case-a','org-a','agent-a','day-a',NULL,NULL,NULL,NULL,'PRIVATE-CASE')`
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals VALUES ('approval-a','org-a','agent-a','2026-10-01','2026-10-01','APPROVAL',1,NULL,1,${payload.rowsHash},${payload.factsHash},${JSON.stringify(payload.rows)}::jsonb,'2026-10-02 03:04:05.678')`
    await db.$executeRaw`INSERT INTO mtm_audit_logs VALUES ('audit-a','org-a','agent-a','WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED','workforce_timesheet_approval','approval-a','workforce_timesheet_export',${JSON.stringify(metadata())}::jsonb,'2026-10-02','PRIVATE-IP')`
    await db.$executeRaw`INSERT INTO system_job_leases VALUES ('workforce-claim-reconciliation-v1','owner-a',clock_timestamp()+interval '5 minutes','running')`
  })
  afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]) })

  it("enumerates all eight kinds, omits private projections and commits only opaque operational progress", async () => {
    const before = await facts(); const snapshot = await load()
    for (const rows of Object.values(snapshot)) expect(rows).toHaveLength(1)
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|purpose|newData|createdAt/)
    const result = await run(); expect(result).toMatchObject({ status: "MATCHED", checkpoint: "COMMITTED", repair: "NONE" })
    expect(JSON.stringify(result)).not.toMatch(/org-a|agent-a|day-a|PRIVATE/)
    expect(await cursor.read()).toMatchObject({ version: 1, cursor: expect.stringMatching(/^wf-sweep-v1:/) })
    expect(await facts()).toEqual(before)
  })
  it("requires explicit read-only repeatable-read ownership", async () => {
    await db.$transaction(tx => expect(readSnapshot(tx, "org-a")).rejects.toThrow(/^WORKFORCE_SWEEP_CONTEXT_REQUIRED$/))
    await db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await expect(readSnapshot(tx, "org-a")).rejects.toThrow(/^WORKFORCE_SWEEP_CONTEXT_REQUIRED$/) })
    await db.$transaction(tx => expect(readSnapshot(tx, "org-a")).rejects.toThrow(/^WORKFORCE_SWEEP_CONTEXT_REQUIRED$/), { isolationLevel: "RepeatableRead" })
  })
  it("uses parameterized tenant predicates and excludes foreign roots", async () => {
    await db.$executeRaw`INSERT INTO mtm_agent_workday_events VALUES ('foreign','org-b','agent-b','missing','PRIVATE-FOREIGN')`
    expect((await run()).status).toBe("MATCHED")
    expect((await readonly(tx => readSnapshot(tx, "org-a' OR true --"))).events).toHaveLength(0)
  })
  it("traverses C-ordered pages and closes references across page boundaries", async () => {
    await db.$executeRaw`INSERT INTO mtm_agent_workdays SELECT 'day-'||lpad(n::text,4,'0'),'org-a','agent-a','2000-01-01','2000-01-01',NULL FROM generate_series(1,255) n`
    await db.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('я-last','org-a','agent-a','1999-01-01','1999-01-01',NULL)`
    await db.$executeRaw`UPDATE mtm_agent_workday_events SET "workdayId" = 'я-last'`
    const snapshot = await load()
    expect(snapshot.workdays).toHaveLength(257); expect(snapshot.workdays.at(-1)?.id).toBe("я-last")
    expect(new Set(snapshot.workdays.map(r => r.id)).size).toBe(257)
    expect(reconcileWorkforceSnapshot(snapshot).status).toBe("MATCHED")
  })
  it("proves exact full pages and accepts1000 roots, then safely refuses1001", async () => {
    await db.$executeRaw`INSERT INTO mtm_agent_workdays SELECT 'd'||n,'org-a','agent-a','2026-01-01','2026-01-01',NULL FROM generate_series(1,127) n`
    expect((await load()).workdays).toHaveLength(128)
    await db.$executeRaw`INSERT INTO mtm_agent_workdays SELECT 'd'||n,'org-a','agent-a','2026-01-01','2026-01-01',NULL FROM generate_series(128,999) n`
    expect((await run()).examined.workdays).toBe(1000)
    await db.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('overflow','org-a','agent-a','2026-01-01','2026-01-01',NULL)`
    await safeStop()
  })
  it("finds independent orphan roots in every reference family", async () => {
    for (const [table, column, code] of [
      ["mtm_agent_workday_events", "workdayId", "WORKDAY_EVENT_SCOPE_MISMATCH"],
      ["workforce_site_transitions", "workdayId", "WORKDAY_TRANSITION_SCOPE_MISMATCH"],
      ["workforce_attendance_evidence", "workdayEventId", "EVIDENCE_SUBJECT_SCOPE_MISMATCH"],
      ["workforce_evidence_assessments", "evidenceId", "ASSESSMENT_EVIDENCE_MISMATCH"],
      ["workforce_exception_cases", "workdayId", "EXCEPTION_SUBJECT_SCOPE_MISMATCH"],
    ]) {
      const saved = await db.$queryRawUnsafe<Array<{ value: string }>>(`SELECT "${column}" AS value FROM ${table}`)
      await db.$executeRawUnsafe(`UPDATE ${table} SET "${column}" = 'absent'`)
      await mismatch(code)
      await db.$executeRawUnsafe(`UPDATE ${table} SET "${column}" = $1`, saved[0].value)
    }
    await db.$executeRaw`DELETE FROM mtm_agent_workdays`
    await mismatch("WORKDAY_EVENT_SCOPE_MISMATCH")
  })
  it("does not let a foreign root satisfy tenant or employee closure", async () => {
    await db.$executeRaw`UPDATE mtm_agent_workdays SET "organizationId" = 'org-b'`
    await mismatch("WORKDAY_TRANSITION_SCOPE_MISMATCH")
    await db.$executeRaw`UPDATE mtm_agent_workdays SET "organizationId" = 'org-a', "agentId" = 'agent-b'`
    await mismatch("WORKDAY_EVENT_SCOPE_MISMATCH")
  })
  it("retains all approval revisions and refuses gaps, malformed hashes and missing export roots", async () => {
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'approval-b',"organizationId","agentId","periodStart","periodEnd",'CORRECTION',2,'approval-a',"calculationVersion","rowsHash","factsHash",rows,"approvedAt" FROM workforce_timesheet_approvals`
    expect((await run()).examined.approvals).toBe(2)
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET revision = 3 WHERE id = 'approval-b'`
    await mismatch("APPROVAL_REVISION_INVALID")
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET "rowsHash" = repeat('0',64)`
    await mismatch("APPROVAL_HASH_INVALID")
    await db.$executeRaw`DELETE FROM workforce_timesheet_approvals WHERE id = 'approval-a'`
    await safeStop()
  })
  it("includes repeated, late and backdated audit exports beyond old window limits", async () => {
    await db.$executeRaw`INSERT INTO mtm_audit_logs SELECT 'audit-'||n,"organizationId","agentId",action,entity,"entityId","metadataKind","newData",'2000-01-01',private FROM mtm_audit_logs CROSS JOIN generate_series(1,150) n`
    expect((await run()).examined.exports).toBe(151)
    await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = jsonb_set("newData",'{factsHash}',to_jsonb(repeat('0',64))) WHERE id = 'audit-150'`
    await mismatch("EXPORT_APPROVAL_MISMATCH")
  })
  it("refuses malformed audit family roots even when only one discriminator matches", async () => {
    await db.$executeRaw`UPDATE mtm_audit_logs SET action = 'OTHER'`
    await safeStop()
    await db.$executeRaw`UPDATE mtm_audit_logs SET action = 'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED',"metadataKind" = NULL`
    await safeStop()
    await db.$executeRaw`UPDATE mtm_audit_logs SET "metadataKind" = 'workforce_timesheet_export',"newData" = jsonb_set("newData",'{revision}','2'::jsonb)`
    await safeStop()
  })
  it("rejects infinite dates and oversize UTF8 projections without advancing", async () => {
    await db.$executeRaw`UPDATE mtm_agent_workdays SET "workDate" = 'infinity'::date`
    await safeStop()
    await db.$executeRaw`UPDATE mtm_agent_workdays SET "workDate" = '2026-10-01', private = repeat('PRIVATE',200000)`
    expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = jsonb_set("newData",'{approvalId}',to_jsonb(repeat('я',3000)))`
    await safeStop()
  })
  it("rejects approval byte overflow before transferring a partial result", async () => {
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET rows = jsonb_build_array(repeat('я',600000))`
    await expect(load()).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/); await safeStop()
  })
  it("accumulates bytes across individually valid pages instead of resetting the kind budget", async () => {
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET rows = jsonb_build_array(repeat('я',1900))`
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'approval-'||n,"organizationId","agentId","periodStart","periodEnd",'CORRECTION',n+1,'approval-a',"calculationVersion","rowsHash","factsHash",rows,"approvedAt" FROM workforce_timesheet_approvals CROSS JOIN generate_series(1,300) n`
    await expect(load()).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/); await safeStop()
  })
  it("keeps one MVCC cutoff then restarts to see late inserts and backdated updates", async () => {
    await readonly(async tx => {
      expect((await readSnapshot(tx,"org-a")).workdays).toHaveLength(1)
      await other.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('late','org-a','agent-a','2000-01-01','2000-01-01',NULL)`
      await other.$executeRaw`UPDATE mtm_agent_workday_events SET "workdayId" = 'missing'`
      const same = await readSnapshot(tx,"org-a")
      expect(same.workdays).toHaveLength(1); expect(reconcileWorkforceSnapshot(same).status).toBe("MATCHED")
    })
    expect((await load()).workdays).toHaveLength(2); await mismatch("WORKDAY_EVENT_SCOPE_MISMATCH")
  })
  it("does not skip a lower-key backdated append between pages on the next full sweep", async () => {
    await db.$executeRaw`INSERT INTO mtm_agent_workdays SELECT 'z-day-'||n,'org-a','agent-a','2026-01-01','2026-01-01',NULL FROM generate_series(1,150) n`
    let pageCount = 0
    const current = await readonly(async tx => {
      const wrapped = { $queryRaw: async (query: Prisma.Sql) => {
        const result = await tx.$queryRaw(query)
        if (++pageCount === 1) {
          await other.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('000-backdated','org-a','agent-a','1999-01-01','1999-01-01',NULL)`
          await other.$executeRaw`UPDATE mtm_agent_workday_events SET "workdayId"='missing'`
        }
        return result
      } } as Parameters<typeof readSnapshot>[0]
      return readSnapshot(wrapped,"org-a")
    })
    expect(pageCount).toBeGreaterThan(8); expect(current.workdays).toHaveLength(151)
    expect(reconcileWorkforceSnapshot(current).status).toBe("MATCHED")
    const next = await load(); expect(next.workdays).toHaveLength(152); expect(next.workdays[0].id).toBe("000-backdated")
    await mismatch("WORKDAY_EVENT_SCOPE_MISMATCH")
  })
  it("resolves schedule-only subjects through effective explicit assignments", async () => {
    await schedule(); expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`UPDATE workforce_shift_assignments SET "agentId" = 'other'`
    await safeStop()
  })
  it("resolves team and organization effective defaults and refuses ambiguous fallback", async () => {
    await schedule(); await db.$executeRaw`TRUNCATE workforce_shift_assignments`
    await db.$executeRaw`INSERT INTO workforce_employee_team_memberships VALUES ('membership-a','org-a','agent-a','team-a','2026-01-01')`
    await db.$executeRaw`INSERT INTO workforce_shift_team_default_assignments VALUES ('team-default','org-a','team-a','template-a','2026-01-01',NULL)`
    expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`INSERT INTO workforce_shift_default_assignments VALUES ('org-default','org-a','template-a','2026-01-01',NULL)`
    await db.$executeRaw`TRUNCATE workforce_shift_team_default_assignments`
    expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`INSERT INTO workforce_shift_default_assignments VALUES ('ambiguous','org-a','template-a','2026-01-01',NULL)`
    await safeStop()
  })
  it("accepts an unambiguous legacy default and rejects competing defaults", async () => {
    await schedule(); await db.$executeRaw`TRUNCATE workforce_shift_assignments`
    await db.$executeRaw`UPDATE workforce_shift_templates SET "isDefault" = true`
    expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`INSERT INTO workforce_shift_templates SELECT 'competing',"organizationId","teamId","isDefault",version,status,timezone,"activatedAt","retiredAt",definition,"definitionHash" FROM workforce_shift_templates`
    await safeStop()
  })
  it("refuses unavailable, mis-scoped, late-activated and corrupt schedule subjects", async () => {
    await schedule()
    await db.$executeRaw`UPDATE workforce_shift_templates SET "activatedAt" = '2026-10-02'`; await safeStop()
    await db.$executeRaw`UPDATE workforce_shift_templates SET "activatedAt" = '2026-01-01',"definitionHash" = repeat('0',64)`; await safeStop()
    await db.$executeRaw`UPDATE workforce_shift_templates SET "definitionHash" = ${workforceShiftDefinitionHash(definition)},"teamId" = 'other-team'`; await safeStop()
    await db.$executeRaw`UPDATE workforce_shift_templates SET "teamId" = NULL`
    await db.$executeRaw`UPDATE workforce_shift_segments SET sequence = 2`; await safeStop()
    await db.$executeRaw`UPDATE workforce_shift_segments SET sequence = 1,"organizationId" = 'org-b'`; await safeStop()
  })
  it("rejects oversized auxiliary assignment and membership identifiers", async () => {
    await schedule()
    await db.$executeRaw`UPDATE workforce_shift_assignments SET "templateId"=repeat('я',200000)`
    await safeStop()
    await db.$executeRaw`UPDATE workforce_shift_assignments SET "templateId"='template-a'`
    await db.$executeRaw`INSERT INTO workforce_employee_team_memberships VALUES ('oversize','org-a','agent-a',repeat('я',200000),'2026-01-01')`
    await safeStop()
  })
  it("uses pinned linked-workday schedule despite a changed current assignment", async () => {
    await schedule(true)
    await db.$executeRaw`UPDATE workforce_shift_assignments SET "templateId" = 'changed-current-template'`
    expect((await run()).status).toBe("MATCHED")
    await db.$executeRaw`UPDATE workforce_exception_cases SET "workdayId" = NULL,"evidenceId" = 'evidence-a'`
    expect((await run()).status).toBe("MATCHED")
  })
  it("refuses corrupt or missing pinned dependencies and conflicting subjects", async () => {
    await schedule(true)
    await db.$executeRaw`UPDATE workforce_exception_cases SET "segmentId"='absent'`; await safeStop()
    await db.$executeRaw`UPDATE workforce_exception_cases SET "segmentId"='segment-a',"expectedWorkDate"='2026-10-01'`; await safeStop()
    await db.$executeRaw`UPDATE workforce_exception_cases SET "expectedWorkDate"=NULL`
    await db.$executeRaw`UPDATE workforce_workday_schedule_snapshots SET "snapshotHash" = repeat('0',64)`; await safeStop()
    await db.$executeRaw`DELETE FROM workforce_workday_schedule_snapshots`; await safeStop()
  })
  it("refuses pinned dependency scope mismatch and schedule byte overflow", async () => {
    await schedule(true)
    await db.$executeRaw`UPDATE workforce_policy_snapshots SET "agentId" = 'other'`; await safeStop()
    await db.$executeRaw`UPDATE workforce_policy_snapshots SET "agentId" = 'agent-a'`
    await db.$executeRaw`UPDATE workforce_workday_schedule_snapshots SET sites = jsonb_build_array(repeat('я',40000))`; await safeStop()
  })
  it("enforces the schedule-case budget before evaluating a truncated subset", async () => {
    await schedule()
    await db.$executeRaw`INSERT INTO workforce_exception_cases SELECT 'case-'||n,"organizationId","agentId","workdayId","workdayEventId","evidenceId","segmentId","expectedWorkDate",private FROM workforce_exception_cases CROSS JOIN generate_series(1,99) n`
    expect((await run()).examined.exceptions).toBe(100)
    await db.$executeRaw`INSERT INTO workforce_exception_cases SELECT 'overflow',"organizationId","agentId","workdayId","workdayEventId","evidenceId","segmentId","expectedWorkDate",private FROM workforce_exception_cases WHERE id = 'case-a'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_SWEEP_SCHEDULE_OVERFLOW$/); await safeStop()
  })
  it("waits for successful read transaction finalization before any checkpoint write", async () => {
    let ended = false
    const reader = { $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      const result = await db.$transaction(fn, options); ended = true; return result
    } } as unknown as Parameters<typeof sweep>[0]["reader"]
    const commit = vi.fn(async (input: Parameters<typeof cursor.commit>[0]) => { expect(ended).toBe(true); return cursor.commit(input) })
    expect((await sweep({ reader,cursor: { read: cursor.read,commit },organizationId:"org-a",ownerToken:"owner-a" })).status).toBe("MATCHED")
    expect(commit).toHaveBeenCalledOnce()
  })
  it("does not checkpoint after callback completion followed by transaction failure", async () => {
    const reader = { $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      await db.$transaction(fn, options); throw new Error("PRIVATE-COMMIT-FAILURE")
    } } as unknown as Parameters<typeof sweep>[0]["reader"]
    const commit = vi.fn(cursor.commit)
    await expect(sweep({ reader,cursor:{read:cursor.read,commit},organizationId:"org-a",ownerToken:"owner-a" })).rejects.toThrow(/^WORKFORCE_SWEEP_INCOMPLETE$/)
    expect(commit).not.toHaveBeenCalled(); expect(await cursor.read()).toBeNull()
  })
  it("reports fenced-out for expiry, takeover and competing progress after its read", async () => {
    for (const action of ["expiry","takeover","progress"] as const) {
      await db.$executeRaw`TRUNCATE system_job_cursors`
      await db.$executeRaw`UPDATE system_job_leases SET "ownerToken"='owner-a',"leaseUntil"=clock_timestamp()+interval '5 minutes'`
      const commit = async (input: Parameters<typeof cursor.commit>[0]) => {
        if (action === "expiry") await other.$executeRaw`UPDATE system_job_leases SET "leaseUntil"=clock_timestamp()-interval '1 second'`
        if (action === "takeover") await other.$executeRaw`UPDATE system_job_leases SET "ownerToken"='owner-b'`
        if (action === "progress") expect(await cursor.commit(input)).toBe("COMMITTED")
        return cursor.commit(input)
      }
      const result = await sweep({reader:db,cursor:{read:cursor.read,commit},organizationId:"org-a",ownerToken:"owner-a"})
      expect(result).toMatchObject({ status:"FENCED_OUT",checkpoint:"FENCED_OUT" })
      expect((await cursor.read())?.version ?? null).toBe(action === "progress" ? 1 : null)
    }
  })
  it("handles a lost commit acknowledgement by full replay without writing facts", async () => {
    const before = await facts()
    const commit = async (input: Parameters<typeof cursor.commit>[0]) => { await cursor.commit(input); throw new Error("PRIVATE-LOST-ACK") }
    await expect(sweep({reader:db,cursor:{read:cursor.read,commit},organizationId:"org-a",ownerToken:"owner-a"})).rejects.toThrow(/^WORKFORCE_SWEEP_CHECKPOINT_OUTCOME_UNKNOWN$/)
    expect((await cursor.read())?.version).toBe(1)
    expect((await run()).status).toBe("MATCHED"); expect((await cursor.read())?.version).toBe(2)
    expect(await facts()).toEqual(before)
  })
  it("preserves nullable checkpoint versions and safely stops at version exhaustion", async () => {
    await db.$executeRaw`INSERT INTO system_job_cursors(name,cursor,version) VALUES ('workforce-claim-reconciliation-v1',NULL,7)`
    expect((await run()).status).toBe("MATCHED"); expect((await cursor.read())?.version).toBe(8)
    await db.$executeRaw`UPDATE system_job_cursors SET version=2147483647`
    expect((await run()).status).toBe("VERSION_EXHAUSTED"); expect((await cursor.read())?.version).toBe(2147483647)
  })
  const dense = () => readonly(tx => reconcileWorkforceDenseSnapshot(tx,"org-a"))
  const denseRun = () => sweep({reader:db,cursor,organizationId:"org-a",ownerToken:"owner-a",dense:true})
  const ops = () => workforceReconciliationOperationsStore(db)
  function scopedReader(organizationId: string): Pick<PrismaClient, "$transaction"> {
    return { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL ROLE wf_ops_fixture_reader`
      await tx.$queryRaw`SELECT set_config('app.org_id',${organizationId},true),set_config('app.rls_bypass','off',true)`
      return fn(tx)
    }, options) } as Pick<PrismaClient, "$transaction">
  }
  const tick = () => runWorkforceReconciliationTick({control:db,ownerToken:"owner-a",readerForOrganization:async organizationId => scopedReader(organizationId)})

  it("streams 12002 roots with bounded dependencies and exact independent accounting", async () => {
    for (const table of ["mtm_agent_workdays","mtm_agent_workday_events","workforce_attendance_evidence","workforce_evidence_assessments","workforce_exception_cases","mtm_audit_logs"]) {
      const columns = await db.$queryRaw<Array<{name:string}>>`SELECT column_name AS name FROM information_schema.columns WHERE table_name=${table} AND column_name<>'id' ORDER BY ordinal_position`
      const names=columns.map(row=>'"'+row.name+'"').join(',')
      await db.$executeRawUnsafe(`INSERT INTO ${table} SELECT 'dense-'||n,${names} FROM ${table} CROSS JOIN generate_series(1,1999) n`)
    }
    const before=await facts();const result=await denseRun()
    expect(result).toMatchObject({status:"MATCHED",checkpoint:"COMMITTED",mismatchTotal:0})
    expect(Object.values(result.examined).reduce((a,b)=>a+b,0)).toBe(12002)
    expect(result.examined).toEqual({workdays:2000,events:2000,transitions:1,evidence:2000,assessments:2000,exceptions:2000,approvals:1,exports:2000})
    expect(await facts()).toEqual(before)
  })
  it("owns mismatch counts once despite repeatedly loaded dependency roots", async () => {
    await db.$executeRaw`UPDATE mtm_agent_workday_events SET "workdayId"='missing'`
    await db.$executeRaw`INSERT INTO workforce_attendance_evidence SELECT 'proof-'||n,"organizationId","workdayEventId",NULL,private FROM workforce_attendance_evidence CROSS JOIN generate_series(1,300) n`
    const result=await denseRun()
    expect(result.status).toBe("MISMATCH");expect(result.mismatchCounts.WORKDAY_EVENT_SCOPE_MISMATCH).toBe(1)
    expect(result.examined.evidence).toBe(301);expect(await cursor.read()).toBeNull()
  })
  it("enumerates 129 complete approval groups across a scope-page boundary exactly once", async () => {
    for (let n=1;n<=128;n++) {
      const agentId='group-agent-'+n
      const rows=payload.rows.map(row=>({...row,agentId}))
      const approval=buildWorkforceTimesheetApproval({periodStart:payload.periodStart,periodEnd:payload.periodEnd,agentId,rows})
      await db.$executeRaw`INSERT INTO workforce_timesheet_approvals VALUES (${'group-'+n},'org-a',${agentId},'2026-10-01','2026-10-01','APPROVAL',1,NULL,1,${approval.rowsHash},${approval.factsHash},${JSON.stringify(approval.rows)}::jsonb,'2026-10-02')`
    }
    expect(await denseRun()).toMatchObject({status:"MATCHED",examined:{approvals:129}})
  })
  it("refuses an indivisible 1001 revision group instead of splitting its history", async () => {
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'revision-'||n,"organizationId","agentId","periodStart","periodEnd",'CORRECTION',n+1,CASE WHEN n=1 THEN 'approval-a' ELSE 'revision-'||(n-1) END,"calculationVersion","rowsHash","factsHash",rows,"approvedAt" FROM workforce_timesheet_approvals CROSS JOIN generate_series(1,1000) n`
    await expect(denseRun()).rejects.toThrow(/^WORKFORCE_SWEEP_INCOMPLETE$/);expect(await cursor.read()).toBeNull()
  })
  it("handles 201 schedule cases in bounded pages and retains pinned scope refusal", async () => {
    await schedule(true)
    await db.$executeRaw`INSERT INTO workforce_exception_cases SELECT 'case-'||n,"organizationId","agentId","workdayId","workdayEventId","evidenceId","segmentId","expectedWorkDate",private FROM workforce_exception_cases CROSS JOIN generate_series(1,200) n`
    expect(await denseRun()).toMatchObject({status:"MATCHED",examined:{exceptions:201}})
    const checkpoint=await cursor.read()
    await db.$executeRaw`UPDATE workforce_policy_snapshots SET "organizationId"='org-b'`
    await expect(denseRun()).rejects.toThrow(/^WORKFORCE_SWEEP_INCOMPLETE$/);expect(await cursor.read()).toEqual(checkpoint)
  })
  it("adapts oversized multi-root projections while refusing an oversized atomic root", async () => {
    await db.$executeRaw`UPDATE mtm_agent_workdays SET id=repeat('d',191),"organizationId"=repeat('o',191),"agentId"=repeat('a',191)`
    await db.$executeRaw`TRUNCATE mtm_agent_workdays`
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET rows=jsonb_build_array(repeat('x',600000))`
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'large-b',"organizationId",'agent-b',"periodStart","periodEnd","recordKind",revision,"supersedesId","calculationVersion","rowsHash","factsHash",rows,"approvedAt" FROM workforce_timesheet_approvals`
    await db.$executeRaw`INSERT INTO mtm_audit_logs SELECT 'large-audit','org-a','agent-b',action,entity,'large-b',"metadataKind","newData" || '{"approvalId":"large-b"}'::jsonb,"createdAt",private FROM mtm_audit_logs`
    // Export closure adapts to one root when two dependency payloads exceed1MiB.
    expect((await dense()).examined.exports).toBe(2)
    // Two individually bounded approval groups are evaluated separately, never concatenated.
    expect((await dense()).examined.approvals).toBe(2)
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET rows=jsonb_build_array(repeat('x',1100000))`
    await expect(denseRun()).rejects.toThrow(/^WORKFORCE_SWEEP_INCOMPLETE$/);expect(await cursor.read()).toBeNull()
  })
  it("keeps dense sweep MVCC and revisits lower-key insert/update on a new invocation", async () => {
    await readonly(async tx=>{
      expect((await reconcileWorkforceDenseSnapshot(tx,"org-a")).status).toBe("MATCHED")
      await other.$executeRaw`INSERT INTO mtm_agent_workdays VALUES ('000-late','org-a','agent-a','1999-01-01','1999-01-01',NULL)`
      await other.$executeRaw`UPDATE workforce_evidence_assessments SET "evidenceId"='absent'`
      expect((await reconcileWorkforceDenseSnapshot(tx,"org-a")).status).toBe("MATCHED")
    })
    const result=await denseRun();expect(result.status).toBe("MISMATCH");expect(result.examined.workdays).toBe(2);expect(await cursor.read()).toBeNull()
  })
  it("moves a failed tenant behind other due eligible tenants without checkpointing its facts", async () => {
    await db.$executeRaw`INSERT INTO organizations VALUES ('org-b',true,'starter','{}','["workforce-hrm"]','{}','2026-01-02'),('org-disabled',true,'starter','{}','[]','{}','2025-01-01'),('org-inactive',false,'enterprise','{}','["workforce-hrm"]','{}','2025-01-01')`
    await db.$executeRaw`UPDATE mtm_agent_workday_events SET "workdayId"='missing'`
    const before=await facts();const first=await tick()
    expect(first).toMatchObject({status:"MISMATCH",eligible:2,attemptRecorded:true});expect(await cursor.read()).toBeNull()
    expect(await tick()).toMatchObject({status:"MATCHED",eligible:2,attemptRecorded:true})
    expect(await tick()).toMatchObject({status:"IDLE",eligible:2})
    const rows=await db.$queryRaw<Array<{id:string;outcome:string;completed:Date|null}>>`SELECT "organizationId" AS id,"lastOutcome" AS outcome,"lastCompletedAt" AS completed FROM workforce_reconciliation_tenant_states ORDER BY "organizationId"`
    expect(rows[0]).toMatchObject({id:"org-a",outcome:"MISMATCH",completed:null});expect(rows[1].outcome).toBe("MATCHED")
    expect(JSON.stringify(first)).not.toMatch(/org-a|agent-a|owner-a|attemptToken/);expect(await facts()).toEqual(before)
  })
  it("allows due attempts after crash/backoff and does not let stale tokens finish them", async () => {
    const first=await ops().claim("owner-a");expect(first.status).toBe("CLAIMED");if(first.status!=="CLAIMED")throw new Error("fixture")
    expect((await ops().claim("owner-a")).status).toBe("IDLE")
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`
    const next=await ops().claim("owner-a");expect(next.status).toBe("CLAIMED");if(next.status!=="CLAIMED")throw new Error("fixture")
    expect(await ops().finish("owner-a",first.claim,{outcome:"MATCHED",examined:1,mismatches:0,durationMs:1})).toBe(false)
    expect(await ops().finish("owner-a",next.claim,{outcome:"INCOMPLETE",examined:0,mismatches:0,durationMs:1})).toBe(true)
    const state=await db.$queryRaw<Array<{failures:number;retry:number}>>`SELECT "consecutiveFailures" AS failures,extract(epoch FROM "dueAt"-clock_timestamp())::integer AS retry FROM workforce_reconciliation_tenant_states`
    expect(state[0].failures).toBe(1);expect(state[0].retry).toBeGreaterThan(25);expect(state[0].retry).toBeLessThanOrEqual(30)
  })
  it("rechecks capability inside the read snapshot after attempt selection", async () => {
    const readerForOrganization=async(organizationId:string)=>{await other.$executeRaw`UPDATE organizations SET features='[]'::jsonb`;return scopedReader(organizationId)}
    expect(await runWorkforceReconciliationTick({control:db,ownerToken:"owner-a",readerForOrganization})).toMatchObject({status:"INCOMPLETE",attemptRecorded:true})
    expect(await cursor.read()).toBeNull()
  })
  it("fences attempt claim/outcome on lease expiry or takeover", async () => {
    const claimed=await ops().claim("owner-a");if(claimed.status!=="CLAIMED")throw new Error("fixture")
    await db.$executeRaw`UPDATE system_job_leases SET "ownerToken"='owner-b'`
    expect(await ops().finish("owner-a",claimed.claim,{outcome:"MATCHED",examined:1,mismatches:0,durationMs:1})).toBe(false)
    expect((await ops().claim("owner-a")).status).toBe("FENCED_OUT")
    await db.$executeRaw`UPDATE system_job_leases SET "ownerToken"='owner-a',"leaseUntil"=clock_timestamp()-interval '1 second'`
    expect((await ops().claim("owner-a")).status).toBe("FENCED_OUT")
  })
  it("rejects a wrong tenant context and a privileged reader instead of accepting empty facts", async () => {
    const wrong = await runWorkforceReconciliationTick({control:db,ownerToken:"owner-a",readerForOrganization:async () => scopedReader("org-b")})
    expect(wrong).toMatchObject({status:"INCOMPLETE",attemptRecorded:true})
    expect(await cursor.read()).toBeNull()
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`
    expect(await runWorkforceReconciliationTick({control:db,ownerToken:"owner-a",readerForOrganization:async () => db})).toMatchObject({status:"INCOMPLETE"})
    expect(await cursor.read()).toBeNull()
  })
  it("fences expired or replaced attempts before global progress even under the same live lease", async () => {
    const first=await ops().claim("owner-a");if(first.status!=="CLAIMED")throw new Error("fixture")
    const stale=workforceReconciliationCursorStore(db,first.claim)
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`
    expect(await stale.commit({expected:null,nextCursor:"opaque",ownerToken:"owner-a"})).toBe("FENCED_OUT")
    const second=await ops().claim("owner-a");if(second.status!=="CLAIMED")throw new Error("fixture")
    expect(await stale.commit({expected:null,nextCursor:"opaque",ownerToken:"owner-a"})).toBe("FENCED_OUT")
    const current=workforceReconciliationCursorStore(db,second.claim)
    expect(await current.commit({expected:null,nextCursor:"opaque",ownerToken:"owner-a"})).toBe("COMMITTED")
    expect(await stale.commit({expected:await current.read(),nextCursor:"late",ownerToken:"owner-a"})).toBe("FENCED_OUT")
    expect(await cursor.read()).toEqual({cursor:"opaque",version:1})
  })
  it.each([false,true])("rolls back claim after lease expiry during an operational row conflict (existing=%s)", async existing => {
    if (existing) await db.$executeRaw`INSERT INTO workforce_reconciliation_tenant_states ("organizationId","dueAt") VALUES ('org-a',clock_timestamp()-interval '1 second')`
    await db.$executeRaw`UPDATE system_job_leases SET "leaseUntil"=clock_timestamp()+interval '400 milliseconds'`
    let release!:()=>void;let locked!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve});const ready=new Promise<void>(resolve=>{locked=resolve})
    const holder=other.$transaction(async tx=>{
      if(existing) await tx.$queryRaw`SELECT * FROM workforce_reconciliation_tenant_states FOR UPDATE`
      else await tx.$executeRaw`INSERT INTO workforce_reconciliation_tenant_states ("organizationId","dueAt") VALUES ('org-a',clock_timestamp()-interval '1 second')`
      locked();await gate
    })
    await ready
    const claiming=ops().claim("owner-a")
    await new Promise(resolve=>setTimeout(resolve,550));release();await holder
    expect((await claiming).status).toBe("FENCED_OUT")
    const rows=await db.$queryRaw<Array<{lastOutcome:string;attemptToken:string|null}>>`SELECT "lastOutcome","attemptToken" FROM workforce_reconciliation_tenant_states`
    expect(rows).toEqual([{lastOutcome:"NEVER",attemptToken:null}])
  })
  it("refuses more than100000 total roots without accepting a truncated dense sweep", async () => {
    await db.$executeRaw`INSERT INTO mtm_agent_workdays SELECT 'ceiling-'||n,"organizationId","agentId","workDate","startedAt",private FROM mtm_agent_workdays CROSS JOIN generate_series(1,100000) n`
    const before=await facts()
    await expect(dense()).rejects.toThrow("WORKFORCE_DENSE_SWEEP_OVERFLOW")
    expect(await cursor.read()).toBeNull();expect(await facts()).toEqual(before)
  },30000)
  it("bounds health diagnostics and exposes stale/failed/never-completed conditions without IDs", async () => {
    await ops().claim("owner-a")
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "lastAttemptAt"=clock_timestamp()-interval '3 minutes',"dueAt"=clock_timestamp()-interval '1 second'`
    const health=await ops().health()
    expect(health).toMatchObject({coverage:"TRACKED_ATTEMPTS_ONLY",eligibleRosterCoverage:"NOT_MEASURED",tracked:1,running:1,neverCompleted:1,stale:1,due:1})
    expect(health.alerts).toContain("RECONCILIATION_STALE");expect(JSON.stringify(health)).not.toMatch(/org-a|owner-a|attemptToken/)
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "lastOutcome"='UNKNOWN'`
    expect((await ops().health()).alerts).toContain("RECONCILIATION_FAILURE")
  })
  it("uses tenant-owned FORCE RLS for operational state and preserves global opaque progress", async () => {
    expect((await tick()).status).toBe("MATCHED")
    await db.$transaction(async tx=>{
      await tx.$executeRaw`SET LOCAL ROLE wf_ops_fixture_reader`
      await tx.$executeRaw`SELECT set_config('app.rls_bypass','off',true)`
      await tx.$executeRaw`SELECT set_config('app.org_id','org-b',true)`
      expect(await tx.$queryRaw`SELECT "organizationId" FROM workforce_reconciliation_tenant_states`).toEqual([])
      await tx.$executeRaw`SELECT set_config('app.org_id','org-a',true)`
      expect(await tx.$queryRaw`SELECT "organizationId" FROM workforce_reconciliation_tenant_states`).toHaveLength(1)
    })
    expect((await cursor.read())?.cursor).toMatch(/^wf-sweep-v1:/)
  })

})
