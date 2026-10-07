import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PrismaClient, type Prisma } from "@prisma/client"
import { readWorkforceReconciliationExportAuditWindow as readAudit } from "@/lib/workforce/reconciliation-export-audit"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import { runWorkforceReconciliationJob } from "@/lib/workforce/reconciliation-job"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"

const scope = () => ({ organizationId: "org-a", startInclusive: new Date("2026-10-02T00:00:00Z"), endExclusive: new Date("2026-10-03T00:00:00Z") })
const empty = (): WorkforceReconciliationSnapshot => ({ workdays: [], events: [], transitions: [], evidence: [], assessments: [], exceptions: [], approvals: [], exports: [] })

describe("export audit input boundary", () => {
  it("rejects invalid input before querying and contains database errors", async () => {
    const tx = { $queryRaw: vi.fn().mockRejectedValue(new Error("private-identifier")) }
    for (const change of [{ organizationId: " " }, { startInclusive: new Date("bad") }, { endExclusive: new Date("2026-10-02") }, { endExclusive: new Date("2027-01-01") }]) {
      await expect(readAudit(tx, { ...scope(), ...change })).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INPUT_INVALID$/)
    }
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    await expect(readAudit(tx, scope())).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_READ_FAILED$/)
  })
  it("rejects an ordinary pooled client even with pretend session defaults", async () => {
    const pooled = { $transaction: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ context: true, count: 0, records: [] }]) }
    await expect(readAudit(pooled as unknown as Parameters<typeof readAudit>[0], scope())).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED$/)
    expect(pooled.$queryRaw).not.toHaveBeenCalled()
  })
})

const url = process.env.WORKFORCE_EXPORT_AUDIT_TEST_DATABASE_URL
describe.skipIf(!url)("export audit on isolated PostgreSQL", () => {
  let db: PrismaClient
  let other: PrismaClient
  const payload = buildWorkforceTimesheetApproval({ periodStart: "2026-10-01", periodEnd: "2026-10-01", agentId: "agent-a", rows: [{
    agentId: "agent-a", workdayId: "day-a", workDate: "2026-10-01", calculationVersion: 1,
    calculation: { calculationVersion: 1, policySnapshotId: "policy-a", shiftSnapshotId: "shift-a", status: "COMPLETED", isFinal: true,
      plan: { plannedStartAt: "2026-10-01T00:00:00Z", plannedEndAt: "2026-10-01T01:00:00Z", expectedWorkSeconds: 3600, workDate: "2026-10-01", timezone: "UTC" },
      fact: { workdayId: "day-a", startedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-01T01:00:00Z", workedSeconds: 3600, pausedSeconds: 0, longestPauseSeconds: 0 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [] },
  }] })

  const metadata = () => ({ approvalId: "revision-2", recordKind: "CORRECTION", revision: 2, periodStart: "2026-10-01", periodEnd: "2026-10-01", rowsHash: payload.rowsHash, factsHash: payload.factsHash, format: "workforce-approved-timesheet-v1", recipient: "SESSION_DIRECT_DOWNLOAD", purpose: "PRIVATE-PURPOSE" })
  async function readonly<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return fn(tx) }, { isolationLevel: "RepeatableRead" })
  }
  const load = () => readonly(tx => readAudit(tx, scope()))
  async function audit(id: string, data: unknown = metadata(), organizationId = "org-a", stamp = "2026-10-02 12:00:00") {
    await other.$executeRaw`INSERT INTO mtm_audit_logs (id, "organizationId", "agentId", action, entity, "entityId", "metadataKind", "newData", "createdAt", "ipAddress", "userAgent", "oldData")
      VALUES (${id}, ${organizationId}, 'agent-a', 'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED', 'workforce_timesheet_approval', 'revision-2', 'workforce_timesheet_export', ${JSON.stringify(data)}::jsonb, ${stamp}::timestamp, 'PRIVATE-IP', 'PRIVATE-UA', '{"private":"PRIVATE-OLD"}'::jsonb)`
  }
  async function facts() {
    return db.$queryRaw`SELECT md5((SELECT string_agg(row_to_json(t)::text, '' ORDER BY id) FROM mtm_audit_logs t) || (SELECT string_agg(row_to_json(t)::text, '' ORDER BY id) FROM workforce_timesheet_approvals t)) AS hash`
  }
  async function job() {
    const commitCursor = vi.fn().mockResolvedValue(true)
    const run = runWorkforceReconciliationJob({ initialCursor: null, store: { loadPage: async () => ({ snapshot: { ...empty(), ...await load() }, nextCursor: null, more: false }), commitCursor } })
    return { run, commitCursor }
  }
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/hrm_export_audit_test") throw new Error("EXPORT_TEST_DB_NOT_ISOLATED")
    db = new PrismaClient({ datasources: { db: { url } } }); other = new PrismaClient({ datasources: { db: { url } } })
    await db.$executeRaw`CREATE TABLE "workforce_timesheet_approvals" (
      "id" text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL,
      "periodStart" date NOT NULL, "periodEnd" date NOT NULL, "recordKind" text NOT NULL,
      "revision" integer NOT NULL, "supersedesId" text, "calculationVersion" integer NOT NULL,
      "rowsHash" varchar(64) NOT NULL, "factsHash" varchar(64) NOT NULL, "rows" jsonb NOT NULL, "approvedAt" timestamp(3) NOT NULL
    )`
    await db.$executeRaw`CREATE INDEX ON "workforce_timesheet_approvals" ("organizationId", "agentId", "periodStart", "periodEnd", "revision")`

    await db.$executeRaw`CREATE TABLE mtm_audit_logs (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text, action text NOT NULL, entity text NOT NULL, "entityId" text, "metadataKind" text, "newData" jsonb, "createdAt" timestamp(3) NOT NULL, "ipAddress" text, "userAgent" text, "oldData" jsonb)`
    await db.$executeRaw`CREATE ROLE wf_export_fixture_reader NOLOGIN`
    await db.$executeRaw`GRANT SELECT ON mtm_audit_logs, workforce_timesheet_approvals TO wf_export_fixture_reader`
    for (const table of ["mtm_audit_logs", "workforce_timesheet_approvals"]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      await db.$executeRawUnsafe(`CREATE POLICY fixture_tenant ON "${table}" USING ("organizationId" = current_setting('fixture.tenant', true))`)
    }
  })
  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE mtm_audit_logs, workforce_timesheet_approvals`
    for (let n = 1; n <= 3; n++) {
      await db.$executeRaw`INSERT INTO workforce_timesheet_approvals VALUES (${'revision-' + n}, 'org-a', 'agent-a', '2026-10-01', '2026-10-01', ${n === 1 ? 'APPROVAL' : 'CORRECTION'}, ${n}, ${n === 1 ? null : 'revision-' + (n - 1)}, 1, ${payload.rowsHash}, ${payload.factsHash}, ${JSON.stringify(payload.rows)}::jsonb, '2026-10-02 03:04:05.678')`
    }
    await audit("audit-a")
  })
  afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]) })

  it("joins full ancestor/successor groups and preserves repeat downloads without duplicate approvals", async () => {
    await audit("audit-b")
    const before = await facts(); const result = await load()
    expect(result.approvals.map(r => r.revision)).toEqual([1, 2, 3]); expect(result.exports).toHaveLength(2)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|purpose|ipAddress|userAgent|oldData|audit-a/)
    expect(await facts()).toEqual(before)
    const { run, commitCursor } = await job(); expect((await run).status).toBe("MATCHED"); expect(commitCursor).toHaveBeenCalledOnce()
  })
  it("uses inclusive/exclusive UTC boundaries and deterministic timestamp/id order", async () => {
    await db.$executeRaw`TRUNCATE mtm_audit_logs`
    await audit("start", { ...metadata(), approvalId: "revision-1", recordKind: "APPROVAL", revision: 1 }, "org-a", "2026-10-02 00:00:00")
    await db.$executeRaw`UPDATE mtm_audit_logs SET "entityId" = 'revision-1' WHERE id = 'start'`
    await audit("z"); await audit("a", { ...metadata(), approvalId: "revision-3", revision: 3 });
    await db.$executeRaw`UPDATE mtm_audit_logs SET "entityId" = 'revision-3' WHERE id = 'a'`
    await audit("end", null, "org-a", "2026-10-03 00:00:00"); await audit("before", null, "org-a", "2026-10-01 23:59:59.999")
    await readonly(async tx => { await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`; expect((await readAudit(tx, scope())).exports.map(r => r.approvalId)).toEqual(["revision-1", "revision-3", "revision-2"]) })
  })
  it("scopes roots to tenant and source family while retaining malformed family members", async () => {
    await audit("foreign", null, "org-b"); await audit("unrelated", null)
    await db.$executeRaw`UPDATE mtm_audit_logs SET action = 'OTHER', "metadataKind" = 'other' WHERE id = 'unrelated'`
    expect((await load()).exports).toHaveLength(1)
    await db.$executeRaw`UPDATE mtm_audit_logs SET action = 'OTHER' WHERE id = 'audit-a'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
    await db.$executeRaw`UPDATE mtm_audit_logs SET action = 'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED', "metadataKind" = NULL WHERE id = 'audit-a'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
  })
  it("honors injected RLS and contains parameter strings", async () => {
    await readonly(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE wf_export_fixture_reader`
      await tx.$executeRaw`SELECT set_config('fixture.tenant', 'org-b', true)`
      expect(await readAudit(tx, scope())).toEqual({ approvals: [], exports: [] })
      await tx.$executeRaw`SELECT set_config('fixture.tenant', 'org-a', true)`
      expect((await readAudit(tx, scope())).exports).toHaveLength(1)
      expect(await readAudit(tx, { ...scope(), organizationId: "org-a' OR true --" })).toEqual({ approvals: [], exports: [] })
    })
  })
  it("requires read-only repeatable-read transaction context", async () => {
    await db.$transaction(tx => expect(readAudit(tx, scope())).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED$/))
    await db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await expect(readAudit(tx, scope())).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED$/) })
    await db.$transaction(tx => expect(readAudit(tx, scope())).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_CONTEXT_REQUIRED$/), { isolationLevel: "RepeatableRead" })
  })
  it("keeps one snapshot across audit and group reads despite concurrent append", async () => {
    await readonly(async tx => {
      expect((await readAudit(tx, scope())).exports).toHaveLength(1)
      await audit("late")
      await other.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'revision-4', "organizationId", "agentId", "periodStart", "periodEnd", 'CORRECTION', 4, 'revision-3', "calculationVersion", "rowsHash", "factsHash", rows, "approvedAt" FROM workforce_timesheet_approvals WHERE id = 'revision-3'`
      const next = await readAudit(tx, scope()); expect(next.exports).toHaveLength(1); expect(next.approvals).toHaveLength(3)
    })
    const next = await load(); expect(next.exports).toHaveLength(2); expect(next.approvals).toHaveLength(4)
  })
  it("refuses every malformed JSON type, date, revision, hash and export descriptor", async () => {
    const variants: unknown[] = [null, [], "bad", ...[{ approvalId: 12 }, { periodStart: "2026-02-30" }, { periodEnd: "2026-09-30" }, { revision: "2" }, { revision: 1.5 }, { revision: 9007199254740992 }, { recordKind: "OTHER" }, { rowsHash: "bad" }, { factsHash: null }, { format: "csv" }, { recipient: "EXTERNAL" }].map(v => ({ ...metadata(), ...v }))]
    for (const data of variants) {
      await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = ${JSON.stringify(data)}::jsonb`
      await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
    }
  })
  it("refuses null agent, entity disagreement and a reference outside the recorded subject", async () => {
    for (const column of ["agentId", "entity", "entityId"]) {
      await db.$executeRawUnsafe(`UPDATE mtm_audit_logs SET "${column}" = $1`, column === "agentId" ? null : "wrong")
      await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
      await db.$executeRaw`TRUNCATE mtm_audit_logs`; await audit("audit-a")
    }
    await db.$executeRaw`UPDATE mtm_audit_logs SET "agentId" = 'agent-b'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_UNAVAILABLE$/)
  })
  it("does not hide missing or cross-tenant approval roots and never commits on refusal", async () => {
    await db.$executeRaw`DELETE FROM workforce_timesheet_approvals WHERE id = 'revision-2'`
    const { run, commitCursor } = await job(); await expect(run).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_UNAVAILABLE$/); expect(commitCursor).not.toHaveBeenCalled()
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET "organizationId" = 'org-b'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_UNAVAILABLE$/)
  })
  it("checks subsequent cached-group roots and revision/recordKind agreement", async () => {
    await audit("audit-z", { ...metadata(), approvalId: "absent" }); await db.$executeRaw`UPDATE mtm_audit_logs SET "entityId" = 'absent' WHERE id = 'audit-z'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
    await db.$executeRaw`DELETE FROM mtm_audit_logs WHERE id = 'audit-z'`
    for (const change of [{ revision: 3 }, { recordKind: "APPROVAL" }]) {
      await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = ${JSON.stringify({ ...metadata(), ...change })}::jsonb`
      await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_INVALID$/)
    }
  })
  it("preserves bad reference hashes for kernel mismatch without cursor commit", async () => {
    await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = jsonb_set("newData", '{rowsHash}', to_jsonb(repeat('0',64)))`
    const { run, commitCursor } = await job(); const result = await run
    expect(result.status).toBe("MISMATCH"); expect(result.mismatchCounts.EXPORT_APPROVAL_MISMATCH).toBe(1); expect(commitCursor).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/org-a|agent-a|revision-/)
  })
  it("accepts100 audit roots and refuses101 without a partial window", async () => {
    await db.$executeRaw`INSERT INTO mtm_audit_logs SELECT 'audit-' || n, "organizationId", "agentId", action, entity, "entityId", "metadataKind", "newData", "createdAt", "ipAddress", "userAgent", "oldData" FROM mtm_audit_logs CROSS JOIN generate_series(1,99) n WHERE id = 'audit-a'`
    expect((await load()).exports).toHaveLength(100); await audit("overflow")
    const { run, commitCursor } = await job(); await expect(run).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_OVERFLOW$/); expect(commitCursor).not.toHaveBeenCalled()
  })
  it("excludes oversized private fields but refuses oversized projected values", async () => {
    await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = "newData" || jsonb_build_object('purpose', repeat('PRIVATE-',200000))`
    expect((await load()).exports).toHaveLength(1)
    await db.$executeRaw`UPDATE mtm_audit_logs SET "newData" = jsonb_set("newData", '{approvalId}', to_jsonb(repeat('я',3000)))`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_OVERFLOW$/)
  })
  it("refuses a deduplicated approval union exceeding1000 rows", async () => {
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'other-' || n, 'org-a', 'agent-a', '2026-09-01'::date, '2026-09-01'::date, 'APPROVAL', n, NULL, 1, repeat('a',64), repeat('b',64), '[]'::jsonb, '2026-10-02'::timestamp FROM generate_series(1,1000) n`
    await audit("audit-z", { ...metadata(), approvalId: "other-1", periodStart: "2026-09-01", periodEnd: "2026-09-01", recordKind: "APPROVAL", revision: 1 }); await db.$executeRaw`UPDATE mtm_audit_logs SET "entityId" = 'other-1' WHERE id = 'audit-z'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_OVERFLOW$/)
  })
  it("refuses combined UTF8 approval bytes even when each group fits separately", async () => {
    await db.$executeRaw`UPDATE workforce_timesheet_approvals SET rows = to_jsonb(repeat('я',300000)) WHERE id = 'revision-1'`
    await db.$executeRaw`INSERT INTO workforce_timesheet_approvals SELECT 'other-1', 'org-a', 'agent-a', '2026-09-01'::date, '2026-09-01'::date, 'APPROVAL', 1, NULL, 1, repeat('a',64), repeat('b',64), to_jsonb(repeat('я',300000)), '2026-10-02'::timestamp`
    await audit("audit-z", { ...metadata(), approvalId: "other-1", periodStart: "2026-09-01", periodEnd: "2026-09-01", recordKind: "APPROVAL", revision: 1 }); await db.$executeRaw`UPDATE mtm_audit_logs SET "entityId" = 'other-1' WHERE id = 'audit-z'`
    await expect(load()).rejects.toThrow(/^WORKFORCE_EXPORT_AUDIT_OVERFLOW$/)
  })
})
