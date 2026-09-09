/**
 * Tests for CLM Slice-3b: /api/v1/contract-approval-rules CRUD.
 *
 * Covers:
 *   GET    — org-scoped list; 401 when unauthenticated; module gate
 *   POST   — create rule + actions; admin/manager only (403 for member);
 *            validates required fields; 404 when templateId not found
 *   GET /:id — fetch single; 404 for wrong org
 *   PUT /:id — replace rule; admin/manager only; 404 for wrong org
 *   DELETE /:id — soft-delete (isActive=false); admin/manager only; 404 for wrong org
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractApprovalRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractApprovalRuleAction: {
      deleteMany: vi.fn(),
    },
    contractTemplate: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn().mockResolvedValue(true),
  moduleDisabledResponse: vi.fn(() =>
    new (require("next/server").NextResponse)(JSON.stringify({ error: "Module disabled" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  ),
}))

import { GET as listGet, POST } from "@/app/api/v1/contract-approval-rules/route"
import { GET as detailGet, PUT, DELETE } from "@/app/api/v1/contract-approval-rules/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG = "org-1"
const ADMIN_SESSION = { userId: "user-admin", orgId: ORG, role: "admin" }
const MANAGER_SESSION = { userId: "user-mgr", orgId: ORG, role: "manager" }
const MEMBER_SESSION = { userId: "user-member", orgId: ORG, role: "member" }

const RULE_FIXTURE = {
  id: "rule-1",
  organizationId: ORG,
  templateId: null,
  name: "High-value CFO review",
  conditions: [{ field: "value", operator: "gte", value: 50000 }],
  matchLogic: "all",
  isActive: true,
  createdBy: "user-admin",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  actions: [
    {
      id: "act-1",
      ruleId: "rule-1",
      actionType: "add_stage",
      stageLabel: "CFO Approval",
      assigneeUserId: null,
      assigneeRole: "director",
      atPosition: null,
      sortOrder: 0,
      createdAt: new Date("2026-01-01"),
    },
  ],
  template: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeListReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/contract-approval-rules")
}

function makePostReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/contract-approval-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDetailReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/contract-approval-rules/rule-1")
}

function makePutReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/contract-approval-rules/rule-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDeleteReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/contract-approval-rules/rule-1", {
    method: "DELETE",
  })
}

const VALID_RULE_BODY = {
  name: "High-value CFO review",
  conditions: [{ field: "value", operator: "gte", value: 50000 }],
  matchLogic: "all",
  isActive: true,
  actions: [{ actionType: "add_stage", stageLabel: "CFO Approval", sortOrder: 0 }],
}

// ─── Tests: GET list ──────────────────────────────────────────────────────────

describe("GET /api/v1/contract-approval-rules", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(true)
  })

  it("returns org-scoped rules list", async () => {
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([RULE_FIXTURE] as never)

    const res = await listGet(makeListReq())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].name).toBe("High-value CFO review")
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await listGet(makeListReq())
    expect(res.status).toBe(401)
  })

  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await listGet(makeListReq())
    expect(res.status).toBe(403)
  })

  it("passes organizationId to findMany", async () => {
    vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([] as never)
    await listGet(makeListReq())
    const call = vi.mocked(prisma.contractApprovalRule.findMany).mock.calls[0][0]
    expect(call?.where?.organizationId).toBe(ORG)
  })
})

// ─── Tests: POST ──────────────────────────────────────────────────────────────

describe("POST /api/v1/contract-approval-rules", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(true)
  })

  it("creates a rule with actions (admin)", async () => {
    vi.mocked(prisma.contractApprovalRule.create).mockResolvedValue(RULE_FIXTURE as never)

    const res = await POST(makePostReq(VALID_RULE_BODY))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("High-value CFO review")
  })

  it("FIX 2: manager → 403 (admin-only CRUD)", async () => {
    // Managers can no longer author approval rules — skip_stage is admin-level policy.
    vi.mocked(getSession).mockResolvedValue(MANAGER_SESSION as never)

    const res = await POST(makePostReq(VALID_RULE_BODY))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toMatch(/only admins/i)
  })

  it("returns 403 for member role", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as never)

    const res = await POST(makePostReq(VALID_RULE_BODY))
    expect(res.status).toBe(403)
  })

  it("FIX 3: foreign-org assigneeUserId → 400", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null) // user not found in org
    const body = {
      ...VALID_RULE_BODY,
      actions: [{ actionType: "add_stage", stageLabel: "CFO", assigneeUserId: "foreign-user", sortOrder: 0 }],
    }
    const res = await POST(makePostReq(body))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/not found in your organization/i)
  })

  it("FIX 3: unknown assigneeRole → 400", async () => {
    const body = {
      ...VALID_RULE_BODY,
      actions: [{ actionType: "add_stage", stageLabel: "CFO", assigneeRole: "space-pirate", sortOrder: 0 }],
    }
    const res = await POST(makePostReq(body))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/unknown assignee role/i)
  })

  it("FIX 4: conditions must have at least 1 entry", async () => {
    const body = { ...VALID_RULE_BODY, conditions: [] }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when name is missing", async () => {
    const body = { ...VALID_RULE_BODY, name: "" }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when actions array is empty", async () => {
    const body = { ...VALID_RULE_BODY, actions: [] }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when condition field is invalid", async () => {
    const body = {
      ...VALID_RULE_BODY,
      conditions: [{ field: "jurisdiction", operator: "eq", value: "US" }],
    }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when condition operator is invalid", async () => {
    const body = {
      ...VALID_RULE_BODY,
      conditions: [{ field: "value", operator: "between", value: 0 }],
    }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(400)
  })

  it("returns 404 when templateId does not belong to org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(null)
    const body = { ...VALID_RULE_BODY, templateId: "nonexistent-template" }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(404)
  })

  it("passes organizationId into create", async () => {
    vi.mocked(prisma.contractApprovalRule.create).mockResolvedValue(RULE_FIXTURE as never)
    await POST(makePostReq(VALID_RULE_BODY))
    const call = vi.mocked(prisma.contractApprovalRule.create).mock.calls[0][0]
    expect(call?.data?.organizationId).toBe(ORG)
  })
})

// ─── Tests: GET /:id ─────────────────────────────────────────────────────────

describe("GET /api/v1/contract-approval-rules/:id", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(true)
  })

  it("returns rule by id", async () => {
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue(RULE_FIXTURE as never)
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: "rule-1" }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.id).toBe("rule-1")
  })

  it("returns 404 when rule not found (wrong org)", async () => {
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue(null)
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(401)
  })
})

// ─── Tests: PUT /:id ─────────────────────────────────────────────────────────

describe("PUT /api/v1/contract-approval-rules/:id", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(true)
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue({ id: "rule-1" } as never)
    // PUT uses $transaction
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txPrisma = {
        contractApprovalRuleAction: { deleteMany: vi.fn().mockResolvedValue({}) },
        contractApprovalRule: {
          update: vi.fn().mockResolvedValue({ ...RULE_FIXTURE, name: "Updated Name" }),
        },
      }
      return fn(txPrisma)
    })
  })

  it("updates rule (admin)", async () => {
    const res = await PUT(makePutReq({ name: "Updated Name", actions: [{ actionType: "add_stage", stageLabel: "CFO", sortOrder: 0 }] }), {
      params: Promise.resolve({ id: "rule-1" }),
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it("FIX 2: manager → 403 on PUT", async () => {
    vi.mocked(getSession).mockResolvedValue(MANAGER_SESSION as never)
    const res = await PUT(makePutReq({ name: "X", actions: [{ actionType: "add_stage", stageLabel: "CFO", sortOrder: 0 }] }), {
      params: Promise.resolve({ id: "rule-1" }),
    })
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toMatch(/only admins/i)
  })

  it("returns 403 for member role", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as never)
    const res = await PUT(makePutReq({ name: "X", actions: [{ actionType: "add_stage", stageLabel: "CFO", sortOrder: 0 }] }), {
      params: Promise.resolve({ id: "rule-1" }),
    })
    expect(res.status).toBe(403)
  })

  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue(null)
    const res = await PUT(makePutReq({ name: "X", actions: [{ actionType: "add_stage", stageLabel: "CFO", sortOrder: 0 }] }), {
      params: Promise.resolve({ id: "rule-1" }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Tests: DELETE /:id ───────────────────────────────────────────────────────

describe("DELETE /api/v1/contract-approval-rules/:id", () => {
  beforeEach(() => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as never)
    vi.mocked(orgHasModule).mockResolvedValue(true)
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue({ id: "rule-1" } as never)
    vi.mocked(prisma.contractApprovalRule.update).mockResolvedValue({ ...RULE_FIXTURE, isActive: false } as never)
  })

  it("soft-deletes (sets isActive=false)", async () => {
    const res = await DELETE(makeDeleteReq(), { params: Promise.resolve({ id: "rule-1" }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    const call = vi.mocked(prisma.contractApprovalRule.update).mock.calls[0][0]
    expect(call?.data?.isActive).toBe(false)
  })

  // Same verdict as the POST/PUT cases above, reached one layer earlier.
  // Those map to the "write" action, which manager HAS on contracts, so the
  // route's own admin-only check is what denies them. DELETE maps to "delete",
  // which manager does NOT have (contracts: read/write/export), so the role
  // check added to withRls on 2026-08-29 denies it before the handler runs and
  // answers with the generic role message instead of this route's wording.
  it("FIX 2: manager → 403 on DELETE", async () => {
    vi.mocked(getSession).mockResolvedValue(MANAGER_SESSION as never)
    const res = await DELETE(makeDeleteReq(), { params: Promise.resolve({ id: "rule-1" }) })
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toBe("Forbidden")
    expect(json.message).toMatch(/manager/i)
    expect(json.message).toMatch(/delete/i)
    expect(json.message).toMatch(/contracts/i)
  })

  it("returns 403 for member role", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as never)
    const res = await DELETE(makeDeleteReq(), { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(403)
  })

  it("returns 404 when rule not found", async () => {
    vi.mocked(prisma.contractApprovalRule.findFirst).mockResolvedValue(null)
    const res = await DELETE(makeDeleteReq(), { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await DELETE(makeDeleteReq(), { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(401)
  })
})
