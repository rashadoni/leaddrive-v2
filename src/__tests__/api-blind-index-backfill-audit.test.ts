/**
 * Slice-3 backfill cron — compliance audit-log integration test.
 *
 * Verifies that POST /api/cron/pii-blind-index-backfill writes one
 * compliance_audit_log row per (entity × tenant) with the right
 * recordType + metadata, after a successful backfill pass.
 *
 * The pure helper is fully covered in `lib-blind-index-backfill`; the
 * test here only confirms the route → audit-log wiring. We pass a
 * minimal fake prisma + intercept the audit module's create() call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const ORG_A = "org-A"
const ORG_B = "org-B"
const CRON_SECRET = "test-cron-secret"

// In-memory rows: citizens (foia) + health_patients (phi).
interface StubRow {
  id: string
  organizationId: string
  fullName: string | null
  fullNameBlindIndex: string | null
  taxId: string | null
  taxIdBlindIndex: string | null
}

const rowsState: Record<
  "citizens" | "health_patients" | "policy_holders" | "beneficiaries",
  StubRow[]
> = {
  citizens: [
    {
      id: "c-A1",
      organizationId: ORG_A,
      fullName: "FOIA-tracked citizen",
      fullNameBlindIndex: null,
      taxId: null,
      taxIdBlindIndex: null,
    },
    {
      id: "c-B1",
      organizationId: ORG_B,
      fullName: "Another tenant citizen",
      fullNameBlindIndex: null,
      taxId: null,
      taxIdBlindIndex: null,
    },
  ],
  health_patients: [
    {
      id: "p-A1",
      organizationId: ORG_A,
      fullName: "HIPAA-tracked patient",
      fullNameBlindIndex: null,
      taxId: null,
      taxIdBlindIndex: null,
    },
  ],
  policy_holders: [],
  beneficiaries: [],
}

// Stub raw-prisma so the helper runs without a DB. The helper now
// iterates BOTH (fullName, taxId) columns so the stub examines the
// SQL to figure out which column it's serving.
vi.mock("@/lib/prisma", () => {
  type RowSet = typeof rowsState
  type TableName = keyof RowSet
  const tableFromSql = (sql: string): TableName => {
    const tables: TableName[] = [
      "citizens",
      "health_patients",
      "policy_holders",
      "beneficiaries",
    ]
    for (const t of tables) {
      if (sql.includes(`"${t}"`)) return t
    }
    throw new Error(`Unknown table in SQL: ${sql}`)
  }
  const columnFromSql = (sql: string): "fullName" | "taxId" => {
    return sql.includes(`"taxIdBlindIndex"`) || sql.includes(`"taxId"`)
      ? "taxId"
      : "fullName"
  }
  return {
    prisma: {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        const t = tableFromSql(sql)
        const col = columnFromSql(sql)
        const limit = params[0] as number
        return rowsState[t]
          .filter((r) =>
            col === "fullName"
              ? r.fullNameBlindIndex === null && r.fullName !== null
              : r.taxIdBlindIndex === null && r.taxId !== null,
          )
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            organizationId: r.organizationId,
            plain: (col === "fullName" ? r.fullName : r.taxId)!,
          }))
      },
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        const t = tableFromSql(sql)
        const col = columnFromSql(sql)
        const [hash, id] = params as [string, string]
        const row = rowsState[t].find((r) => r.id === id)
        if (row) {
          if (col === "fullName") row.fullNameBlindIndex = hash
          else row.taxIdBlindIndex = hash
        }
        return row ? 1 : 0
      },
      complianceAuditLog: { create: vi.fn() },
    },
  }
})

import { prisma } from "@/lib/prisma"
import {
  resetBlindIndexKeyCache,
  resetMasterKekCache,
} from "@/lib/crypto/tenant-pii-encryption"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  process.env.CRON_SECRET = CRON_SECRET
  resetMasterKekCache()
  resetBlindIndexKeyCache()
  // Reset row state to NULL blind-index between tests (both columns).
  for (const t of Object.keys(rowsState) as (keyof typeof rowsState)[]) {
    for (const r of rowsState[t]) {
      r.fullNameBlindIndex = null
      r.taxIdBlindIndex = null
    }
  }
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({
    id: "audit-row",
  } as never)
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  delete process.env.CRON_SECRET
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

function cronReq(): NextRequest {
  return new NextRequest(
    new URL("/api/cron/pii-blind-index-backfill", "http://localhost"),
    {
      method: "POST",
      headers: {
        "x-cron-secret": CRON_SECRET,
        "Content-Type": "application/json",
      },
    },
  )
}

describe("POST /api/cron/pii-blind-index-backfill — audit-log integration", () => {
  it("writes one compliance_audit_log row per (entity × tenant)", async () => {
    const { POST } = await import(
      "@/app/api/cron/pii-blind-index-backfill/route"
    )

    // Route now awaits Promise.allSettled on the audit fan-out, so
    // by the time the response resolves the writes have all settled
    // and we can assert against the mock directly — no microtask
    // drain needed.
    const res = await POST(cronReq())

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: {
        totalUpdated: number
        auditWritesEnqueued: number
        auditWritesSucceeded: number
        auditWritesFailed: number
      }
    }
    expect(body.data.totalUpdated).toBe(3) // 2 citizens + 1 patient
    expect(body.data.auditWritesEnqueued).toBe(3) // (citizens A) + (citizens B) + (patient A)
    expect(body.data.auditWritesSucceeded).toBe(3)
    expect(body.data.auditWritesFailed).toBe(0)

    interface AuditArgs {
      data: {
        organizationId: string
        recordType: string
        recordTable: string
        action: string
        userId: string | null
        metadata: { systemBackfill?: boolean; rowsUpdated?: number }
      }
    }
    interface AuditSummary {
      org: string
      type: string
      table: string
      action: string
      userId: string | null
      systemBackfill: boolean | undefined
      rowsUpdated: number | undefined
    }
    const auditCalls = vi.mocked(prisma.complianceAuditLog.create).mock.calls
    expect(auditCalls.length).toBe(3)
    const summarized: AuditSummary[] = auditCalls
      .map((call: unknown[]): AuditSummary => {
        const args = call[0] as unknown as AuditArgs
        return {
          org: args.data.organizationId,
          type: args.data.recordType,
          table: args.data.recordTable,
          action: args.data.action,
          userId: args.data.userId,
          systemBackfill: args.data.metadata.systemBackfill,
          rowsUpdated: args.data.metadata.rowsUpdated,
        }
      })
      .sort((a: AuditSummary, b: AuditSummary) =>
        `${a.table}-${a.org}`.localeCompare(`${b.table}-${b.org}`),
      )
    expect(summarized).toEqual([
      {
        org: ORG_A,
        type: "foia",
        table: "citizens",
        action: "write",
        userId: null,
        systemBackfill: true,
        rowsUpdated: 1,
      },
      {
        org: ORG_B,
        type: "foia",
        table: "citizens",
        action: "write",
        userId: null,
        systemBackfill: true,
        rowsUpdated: 1,
      },
      {
        org: ORG_A,
        type: "phi",
        table: "health_patients",
        action: "write",
        userId: null,
        systemBackfill: true,
        rowsUpdated: 1,
      },
    ])
  })

  it("does NOT write audit rows on an empty-result run", async () => {
    // Pre-populate every row's blind-index so the WHERE filter is empty.
    for (const t of Object.keys(rowsState) as (keyof typeof rowsState)[]) {
      for (const r of rowsState[t]) r.fullNameBlindIndex = "pre-existing"
    }

    const { POST } = await import(
      "@/app/api/cron/pii-blind-index-backfill/route"
    )
    const res = await POST(cronReq())

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        totalUpdated: number
        auditWritesEnqueued: number
        auditWritesSucceeded: number
      }
    }
    expect(body.data.totalUpdated).toBe(0)
    expect(body.data.auditWritesEnqueued).toBe(0)
    expect(body.data.auditWritesSucceeded).toBe(0)
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled()
  })

  it("partial audit failure: one tenant's audit erroring does not break the others", async () => {
    // Fail the audit write for the FIRST call (tenant A citizens),
    // succeed for the rest. The semantic guarantee `Promise.allSettled`
    // adds here is "await all + count failures without throwing the
    // route" — the parallel fire happens either way; allSettled is
    // about how we surface the result. Route response reports
    // 2 succeeded / 1 failed and still returns 200.
    let callIdx = 0
    vi.mocked(prisma.complianceAuditLog.create).mockImplementation(
      async () => {
        const i = callIdx++
        if (i === 0) {
          throw new Error("simulated audit write failure")
        }
        return { id: `audit-${i}` } as never
      },
    )

    const { POST } = await import(
      "@/app/api/cron/pii-blind-index-backfill/route"
    )
    const res = await POST(cronReq())

    expect(res.status).toBe(200) // route still 200 — compliance gap on one tenant beats compliance gap on all
    const body = (await res.json()) as {
      data: {
        totalUpdated: number
        auditWritesEnqueued: number
        auditWritesSucceeded: number
        auditWritesFailed: number
      }
    }
    expect(body.data.totalUpdated).toBe(3) // backfill itself completed
    expect(body.data.auditWritesEnqueued).toBe(3)
    // First audit threw → recordComplianceAccess's internal catch
    // returns null → allSettled sees a fulfilled promise but value=null.
    // The route counts non-null fulfilled as success, so this is 2.
    expect(body.data.auditWritesSucceeded).toBe(2)
    expect(body.data.auditWritesFailed).toBe(1)
  })

  it("rejects requests without a valid cron secret", async () => {
    const { POST } = await import(
      "@/app/api/cron/pii-blind-index-backfill/route"
    )
    const badReq = new NextRequest(
      new URL("/api/cron/pii-blind-index-backfill", "http://localhost"),
      {
        method: "POST",
        headers: { "x-cron-secret": "wrong-secret" },
      },
    )
    const res = await POST(badReq)
    expect(res.status).toBe(401)
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled()
  })

  it("returns 503 when CRON_SECRET env var is missing", async () => {
    delete process.env.CRON_SECRET
    const { POST } = await import(
      "@/app/api/cron/pii-blind-index-backfill/route"
    )
    const res = await POST(cronReq())
    expect(res.status).toBe(503)
  })
})
