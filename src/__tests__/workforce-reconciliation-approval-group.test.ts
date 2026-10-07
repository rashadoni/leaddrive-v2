import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { readWorkforceReconciliationApprovalGroup as readGroup } from "@/lib/workforce/reconciliation-approval-group"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import { runWorkforceReconciliationJob } from "@/lib/workforce/reconciliation-job"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"

const scope = () => ({ organizationId: "org-a", agentId: "agent-a", periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-01T00:00:00Z"), rootApprovalId: "revision-2" })
const empty = (): WorkforceReconciliationSnapshot => ({ workdays: [], events: [], transitions: [], evidence: [], assessments: [], exceptions: [], approvals: [], exports: [] })

describe("approval-group input boundary", () => {
  it("rejects invalid dates and identifiers before issuing SQL", async () => {
    const db = { $queryRaw: vi.fn() }
    for (const change of [{ organizationId: " " }, { agentId: "" }, { rootApprovalId: "x".repeat(192) }, { periodStart: new Date("invalid") }, { periodStart: new Date("2026-10-01T01:00:00Z") }, { periodEnd: new Date("2026-09-30T00:00:00Z") }]) {
      await expect(readGroup(db, { ...scope(), ...change })).rejects.toThrow("WORKFORCE_APPROVAL_GROUP_INPUT_INVALID")
    }
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })
  it("contains raw database failure details", async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error("secret-tenant-payload")) }
    await expect(readGroup(db, scope())).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_READ_FAILED$/)
  })
})

const url = process.env.WORKFORCE_APPROVAL_GROUP_TEST_DATABASE_URL
describe.skipIf(!url)("approval groups on isolated PostgreSQL", () => {
  let db: PrismaClient
  let other: PrismaClient
  const payload = buildWorkforceTimesheetApproval({ periodStart: "2026-10-01", periodEnd: "2026-10-01", agentId: "agent-a", rows: [{
    agentId: "agent-a", workdayId: "day-a", workDate: "2026-10-01", calculationVersion: 1,
    calculation: { calculationVersion: 1, policySnapshotId: "policy-a", shiftSnapshotId: "shift-a", status: "COMPLETED", isFinal: true,
      plan: { plannedStartAt: "2026-10-01T00:00:00Z", plannedEndAt: "2026-10-01T01:00:00Z", expectedWorkSeconds: 3600, workDate: "2026-10-01", timezone: "UTC" },
      fact: { workdayId: "day-a", startedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-01T01:00:00Z", workedSeconds: 3600, pausedSeconds: 0, longestPauseSeconds: 0 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [] },
  }] })

  async function seed(revision: number, organizationId = "org-a", agentId = "agent-a", date = "2026-10-01") {
    const key = organizationId === "org-a" && agentId === "agent-a" && date === "2026-10-01" ? `revision-${revision}` : `${organizationId}-${agentId}-${date}-${revision}`
    await other.$executeRaw`INSERT INTO "workforce_timesheet_approvals"
      ("id", "organizationId", "agentId", "periodStart", "periodEnd", "recordKind", "revision", "supersedesId", "calculationVersion", "rowsHash", "factsHash", "rows", "approvedAt")
      VALUES (${key}, ${organizationId}, ${agentId}, ${date}::date, ${date}::date,
        ${revision === 1 ? "APPROVAL" : "CORRECTION"}, ${revision}, ${revision === 1 ? null : `revision-${revision - 1}`}, 1,
        ${payload.rowsHash}, ${payload.factsHash}, ${JSON.stringify(payload.rows)}::jsonb, '2026-10-02 03:04:05.678'::timestamp)`
  }
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/hrm_approval_group_test") throw new Error("APPROVAL_TEST_DB_NOT_ISOLATED")
    db = new PrismaClient({ datasources: { db: { url } } }); other = new PrismaClient({ datasources: { db: { url } } })
    await db.$executeRaw`CREATE TABLE "workforce_timesheet_approvals" (
      "id" text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL,
      "periodStart" date NOT NULL, "periodEnd" date NOT NULL, "recordKind" text NOT NULL,
      "revision" integer NOT NULL, "supersedesId" text, "calculationVersion" integer NOT NULL,
      "rowsHash" varchar(64) NOT NULL, "factsHash" varchar(64) NOT NULL, "rows" jsonb NOT NULL, "approvedAt" timestamp(3) NOT NULL
    )`
    await db.$executeRaw`CREATE INDEX ON "workforce_timesheet_approvals" ("organizationId", "agentId", "periodStart", "periodEnd", "revision")`
    await db.$executeRaw`CREATE ROLE wf_approval_fixture_reader NOLOGIN`
    await db.$executeRaw`GRANT SELECT ON "workforce_timesheet_approvals" TO wf_approval_fixture_reader`
    await db.$executeRaw`ALTER TABLE "workforce_timesheet_approvals" ENABLE ROW LEVEL SECURITY`
    await db.$executeRaw`CREATE POLICY fixture_tenant ON "workforce_timesheet_approvals" USING ("organizationId" = current_setting('fixture.tenant', true))`
  })
  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE "workforce_timesheet_approvals"`
    await seed(1); await seed(2); await seed(3)
  })
  afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]) })

  it("loads ancestors and later corrections, ordered, with UTC Date values and no writes", async () => {
    const before = await db.$queryRaw`SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY "id")) AS hash FROM "workforce_timesheet_approvals" t`
    const rows = await readGroup(db, scope())
    expect(rows.map(r => r.revision)).toEqual([1, 2, 3])
    expect(rows[0].periodStart.toISOString()).toBe("2026-10-01T00:00:00.000Z")
    expect(rows[0].approvedAt.toISOString()).toBe("2026-10-02T03:04:05.678Z")
    expect(await db.$queryRaw`SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY "id")) AS hash FROM "workforce_timesheet_approvals" t`).toEqual(before)
  })
  it("isolates tenant, employee and exact period without hiding same-group successors", async () => {
    await seed(1, "org-b"); await seed(1, "org-a", "agent-b"); await seed(1, "org-a", "agent-a", "2026-10-02")
    expect((await readGroup(db, scope())).map(r => r.id)).toEqual(["revision-1", "revision-2", "revision-3"])
  })
  it("uses the same finite refusal for empty, missing and foreign roots", async () => {
    await seed(1, "org-b")
    for (const change of [{ rootApprovalId: "absent" }, { rootApprovalId: "org-b-agent-a-2026-10-01-1" }, { organizationId: "org-empty" }]) {
      await expect(readGroup(db, { ...scope(), ...change })).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_UNAVAILABLE$/)
    }
  })
  it("honors supplied restricted role and RLS without broadening authorization", async () => {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE wf_approval_fixture_reader`
      await tx.$executeRaw`SELECT set_config('fixture.tenant', 'org-b', true)`
      await expect(readGroup(tx, scope())).rejects.toThrow("WORKFORCE_APPROVAL_GROUP_UNAVAILABLE")
      await tx.$executeRaw`SELECT set_config('fixture.tenant', 'org-a', true)`
      expect(await readGroup(tx, scope())).toHaveLength(3)
    })
  })
  it("does not let parameter strings alter the SQL scope", async () => {
    await expect(readGroup(db, { ...scope(), organizationId: "org-a' OR true --" })).rejects.toThrow("WORKFORCE_APPROVAL_GROUP_UNAVAILABLE")
  })
  it("retains statement/snapshot semantics during concurrent append", async () => {
    await db.$transaction(async tx => {
      expect(await readGroup(tx, scope())).toHaveLength(3)
      await seed(4)
      expect(await readGroup(tx, scope())).toHaveLength(3)
    }, { isolationLevel: "RepeatableRead" })
    expect(await readGroup(db, scope())).toHaveLength(4)
  })
  it("remains UTC when the injected session timezone differs", async () => {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`
      const rows = await readGroup(tx, scope())
      expect(rows[0].approvedAt.toISOString()).toBe("2026-10-02T03:04:05.678Z")
    })
  })
  it("returns exactly1000 revisions but refuses1001 without a partial snapshot", async () => {
    await db.$executeRaw`INSERT INTO "workforce_timesheet_approvals" SELECT 'revision-' || n, 'org-a', 'agent-a', '2026-10-01'::date, '2026-10-01'::date, 'CORRECTION', n, 'revision-' || (n-1), 1, repeat('a',64), repeat('b',64), '[]'::jsonb, '2026-10-02'::timestamp FROM generate_series(4,1000) n`
    expect(await readGroup(db, scope())).toHaveLength(1000)
    await seed(1001)
    await expect(readGroup(db, scope())).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_OVERFLOW$/)
  })
  it("bounds UTF8 JSON bytes, not compressed storage or JS character count", async () => {
    await db.$executeRaw`UPDATE "workforce_timesheet_approvals" SET "rows" = to_jsonb(repeat('я', 530000)) WHERE "id" = 'revision-2'`
    await expect(readGroup(db, scope())).rejects.toThrow(/^WORKFORCE_APPROVAL_GROUP_OVERFLOW$/)
  })
  it("allows a complete coherent group through existing job reconciliation", async () => {
    const commitCursor = vi.fn().mockResolvedValue(true)
    const result = await runWorkforceReconciliationJob({ initialCursor: null, store: {
      loadPage: async () => ({ snapshot: { ...empty(), approvals: await readGroup(db, scope()) }, nextCursor: null, more: false }), commitCursor,
    } })
    expect(result.status).toBe("MATCHED"); expect(commitCursor).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toMatch(/org-a|agent-a|revision-/)
  })
  it("preserves missing revision and bad hash/link so the job refuses cursor advancement", async () => {
    await db.$executeRaw`DELETE FROM "workforce_timesheet_approvals" WHERE "revision" = 1`
    await db.$executeRaw`UPDATE "workforce_timesheet_approvals" SET "rowsHash" = repeat('0',64), "supersedesId" = 'wrong' WHERE "revision" = 3`
    const commitCursor = vi.fn()
    const result = await runWorkforceReconciliationJob({ initialCursor: null, store: {
      loadPage: async () => ({ snapshot: { ...empty(), approvals: await readGroup(db, scope()) }, nextCursor: null, more: false }), commitCursor,
    } })
    expect(result.status).toBe("MISMATCH"); expect(result.mismatchCounts.APPROVAL_HASH_INVALID).toBe(1)
    expect(result.mismatchCounts.APPROVAL_REVISION_INVALID).toBe(2); expect(commitCursor).not.toHaveBeenCalled()
  })
  it("does not commit cursor when the group exceeds its byte budget", async () => {
    await db.$executeRaw`UPDATE "workforce_timesheet_approvals" SET "rows" = to_jsonb(repeat('x', 1048576)) WHERE "id" = 'revision-2'`
    const commitCursor = vi.fn()
    await expect(runWorkforceReconciliationJob({ initialCursor: null, store: {
      loadPage: async () => ({ snapshot: { ...empty(), approvals: await readGroup(db, scope()) }, nextCursor: null, more: false }), commitCursor,
    } })).rejects.toThrow("WORKFORCE_APPROVAL_GROUP_OVERFLOW")
    expect(commitCursor).not.toHaveBeenCalled()
  })
})
