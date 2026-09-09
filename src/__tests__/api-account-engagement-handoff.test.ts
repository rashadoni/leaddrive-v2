/**
 * C5 Account Engagement — SQL handoff tests.
 *
 * Covers:
 *   A) performSqlHandoff pure helper (injectable mock DB, no network)
 *   B) PATCH /api/v1/account-engagement/:id lifecycle-transition route
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import {
  performSqlHandoff,
  type HandoffDb,
  type SqlHandoffInput,
} from "@/lib/account-engagement/sql-handoff"

/* ═════════════════════════════════════════════════════════════════════════
   A. performSqlHandoff — pure helper
   ═════════════════════════════════════════════════════════════════════════ */

function makeDb(overrides: Partial<HandoffDb> = {}): HandoffDb {
  return {
    pipeline: {
      findFirst: vi.fn().mockResolvedValue({ id: "pipe-1" }),
    },
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ name: "QUALIFIED", probability: 25 }),
    },
    deal: {
      create: vi.fn().mockResolvedValue({ id: "deal-1", name: "Acme Corp — SQL Handoff", stage: "QUALIFIED" }),
    },
    ...overrides,
  }
}

const BASE_INPUT: SqlHandoffInput = {
  accountId: "acct-1",
  accountName: "Acme Corp",
  companyId: "co-1",
  ownerUserId: "user-1",
  organizationId: "org-1",
}

describe("performSqlHandoff — happy path", () => {
  it("returns the created deal", async () => {
    const db = makeDb()
    const result = await performSqlHandoff(BASE_INPUT, db)
    expect(result.skipped).toBe(false)
    expect(result.deal).toMatchObject({ id: "deal-1", stage: "QUALIFIED" })
  })

  it("passes organizationId + pipelineId + stage + probability to deal.create", async () => {
    const db = makeDb()
    await performSqlHandoff(BASE_INPUT, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.organizationId).toBe("org-1")
    expect(createArgs.pipelineId).toBe("pipe-1")
    expect(createArgs.stage).toBe("QUALIFIED")
    expect(createArgs.probability).toBe(25)
  })

  it("uses displayName as deal title base", async () => {
    const db = makeDb()
    await performSqlHandoff(BASE_INPUT, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.name).toBe("Acme Corp — SQL Handoff")
  })

  it("includes accountId in deal tags", async () => {
    const db = makeDb()
    await performSqlHandoff(BASE_INPUT, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.tags).toContain("sql-handoff")
    expect(createArgs.tags).toContain("acct-1")
  })

  it("passes companyId and ownerUserId when present", async () => {
    const db = makeDb()
    await performSqlHandoff(BASE_INPUT, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.companyId).toBe("co-1")
    expect(createArgs.assignedTo).toBe("user-1")
  })
})

describe("performSqlHandoff — no default pipeline", () => {
  it("skips with reason 'no_default_pipeline'", async () => {
    const db = makeDb({
      pipeline: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const result = await performSqlHandoff(BASE_INPUT, db)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe("no_default_pipeline")
    expect(result.deal).toBeNull()
  })

  it("does not call deal.create when pipeline is missing", async () => {
    const db = makeDb({
      pipeline: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    await performSqlHandoff(BASE_INPUT, db)
    expect((db.deal.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})

describe("performSqlHandoff — no active pipeline stage", () => {
  it("falls back to stage 'LEAD' and probability 10", async () => {
    const db = makeDb({
      pipelineStage: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    await performSqlHandoff(BASE_INPUT, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.stage).toBe("LEAD")
    expect(createArgs.probability).toBe(10)
  })
})

describe("performSqlHandoff — deal creation failure", () => {
  it("returns skipped=true with reason 'deal_create_failed' instead of throwing", async () => {
    const db = makeDb({
      deal: {
        create: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      },
    })
    const result = await performSqlHandoff(BASE_INPUT, db)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe("deal_create_failed")
    expect(result.deal).toBeNull()
  })
})

describe("performSqlHandoff — null companyId / ownerUserId", () => {
  it("creates deal without companyId when null", async () => {
    const db = makeDb()
    await performSqlHandoff({ ...BASE_INPUT, companyId: null }, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.companyId).toBeUndefined()
  })

  it("creates deal without assignedTo when ownerUserId is null", async () => {
    const db = makeDb()
    await performSqlHandoff({ ...BASE_INPUT, ownerUserId: null }, db)
    const createArgs = (db.deal.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(createArgs.assignedTo).toBeUndefined()
  })
})

/* ═════════════════════════════════════════════════════════════════════════
   B. PATCH /api/v1/account-engagement/:id
   ═════════════════════════════════════════════════════════════════════════ */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketingAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    pipeline: {
      findFirst: vi.fn(),
    },
    pipelineStage: {
      findFirst: vi.fn(),
    },
    deal: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof NextResponse),
}))

import { PATCH } from "@/app/api/v1/account-engagement/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

function makeReq(body: unknown) {
  return new Request("http://localhost/api/v1/account-engagement/acct-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
}

const PARAMS = Promise.resolve({ id: "acct-1" })

const MOCK_ACCOUNT = {
  id: "acct-1",
  accountName: "Acme Corp",
  lifecycleStage: "mql",
  companyId: "co-1",
  ownerUserId: "user-1",
  becameEngagedAt: new Date(),
  becameMqlAt: new Date(),
  becameSqlAt: null,
  becameOpportunityAt: null,
  becameCustomerAt: null,
  churnedAt: null,
}

const MOCK_UPDATED = {
  ...MOCK_ACCOUNT,
  lifecycleStage: "sql",
  becameSqlAt: new Date(),
  engagementScore: 72,
  grade: "A",
  icpTier: "tier_1",
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: "org-1" })
  ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_ACCOUNT)
  ;(prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_UPDATED)
  ;(prisma.pipeline.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "pipe-1" })
  ;(prisma.pipelineStage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "QUALIFIED", probability: 25 })
  ;(prisma.deal.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "deal-1", name: "Acme Corp — SQL Handoff", stage: "QUALIFIED" })
})

describe("PATCH /account-engagement/:id — authentication", () => {
  it("returns 401 when unauthenticated", async () => {
    ;(requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(401)
  })
})

describe("PATCH /account-engagement/:id — validation", () => {
  it("returns 400 on invalid JSON", async () => {
    const req = new Request("http://localhost/api/v1/account-engagement/acct-1", {
      method: "PATCH",
      body: "not-json",
    }) as unknown as import("next/server").NextRequest
    const res = await PATCH(req, { params: PARAMS })
    expect(res.status).toBe(400)
  })

  it("returns 400 for unknown lifecycleStage", async () => {
    const res = await PATCH(makeReq({ lifecycleStage: "bogus" }), { params: PARAMS })
    expect(res.status).toBe(400)
  })

  it("returns 404 when account not found", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(404)
  })

  it("returns 409 when stage is unchanged", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "sql",
    })
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(409)
  })

  it("returns 422 for illegal transition (target → customer)", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "target",
    })
    const res = await PATCH(makeReq({ lifecycleStage: "customer" }), { params: PARAMS })
    expect(res.status).toBe(422)
  })
})

describe("PATCH /account-engagement/:id — successful transition", () => {
  it("returns 200 with updated account on mql → sql", async () => {
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.account.lifecycleStage).toBe("sql")
  })

  it("includes deal in response on mql → sql handoff", async () => {
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    const body = await res.json()
    expect(body.deal).toMatchObject({ id: "deal-1", stage: "QUALIFIED" })
  })

  it("does NOT include deal in response on non-sql transitions", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "target",
    })
    ;(prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_UPDATED,
      lifecycleStage: "engaged",
    })
    const res = await PATCH(makeReq({ lifecycleStage: "engaged" }), { params: PARAMS })
    const body = await res.json()
    expect(body.deal).toBeUndefined()
  })

  it("stamps becameSqlAt on first sql transition", async () => {
    await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    const updateCall = (prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.becameSqlAt).toBeInstanceOf(Date)
  })

  it("does NOT overwrite becameSqlAt if already stamped", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "mql",
      becameSqlAt: new Date("2026-01-01"), // already set from a prior sql visit
    })
    await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    const updateCall = (prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.becameSqlAt).toBeUndefined()
  })

  it("stamps becameEngagedAt on first target → engaged transition", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "target",
      becameEngagedAt: null, // not yet stamped
    })
    ;(prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_UPDATED,
      lifecycleStage: "engaged",
      becameEngagedAt: new Date(),
    })
    await PATCH(makeReq({ lifecycleStage: "engaged" }), { params: PARAMS })
    const updateCall = (prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.becameEngagedAt).toBeInstanceOf(Date)
    expect(updateCall.data.lifecycleStage).toBe("engaged")
  })

  it("does NOT overwrite becameEngagedAt if already stamped", async () => {
    ;(prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_ACCOUNT,
      lifecycleStage: "target",
      becameEngagedAt: new Date("2026-01-01"), // already set from prior engaged visit
    })
    await PATCH(makeReq({ lifecycleStage: "engaged" }), { params: PARAMS })
    const updateCall = (prisma.marketingAccount.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.becameEngagedAt).toBeUndefined()
  })
})

describe("PATCH /account-engagement/:id — handoff best-effort", () => {
  it("still returns 200 even when deal creation fails", async () => {
    ;(prisma.deal.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB timeout"),
    )
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.account.lifecycleStage).toBe("sql")
    expect(body.deal).toBeUndefined()
  })

  it("still returns 200 when no default pipeline exists", async () => {
    ;(prisma.pipeline.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await PATCH(makeReq({ lifecycleStage: "sql" }), { params: PARAMS })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deal).toBeUndefined()
  })
})
