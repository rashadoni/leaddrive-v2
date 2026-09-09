/**
 * CLM Slice 3d — Tests for contract intake submission:
 *   POST /api/v1/contract-intake-forms/:id/submit
 *
 * Coverage:
 *   - Happy path: creates draft Contract + Submission (mapping auto-fill)
 *   - Module gate: 403 when contracts module off
 *   - Form not found or inactive → 404
 *   - Required response missing → 400
 *   - Foreign-org companyId in responses → 400 (cross-tenant guard)
 *   - defaultStages present → approval chain created, status pending_approval
 *   - applyApprovalRules skips all stages → contract stays draft, no 422
 *   - Admins/managers notified (best-effort)
 *   - Org-scoped: ensures organizationId in all created rows
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractIntakeForm: { findFirst: vi.fn() },
    contractApprovalRule: { findMany: vi.fn() },
    contract: { count: vi.fn(), create: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    contractIntakeSubmission: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    userApprovalDelegate: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: (r: unknown) => r instanceof NextResponse,
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(
    (_moduleId: string) =>
      new NextResponse(JSON.stringify({ error: "Module disabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/contract-lifecycle/delegation", () => ({
  resolveApprovalAssignee: vi.fn().mockResolvedValue({
    resolvedUserId: "u-mgr",
    delegated: false,
    originalUserId: "u-mgr",
  }),
}))

vi.mock("@/lib/contract-lifecycle/approval-rules", async () => {
  const actual = await vi.importActual("@/lib/contract-lifecycle/approval-rules") as Record<string, unknown>
  return {
    ...actual,
    applyApprovalRules: vi.fn().mockImplementation(
      (baseStages: unknown[]) => baseStages,
    ),
  }
})

import { POST } from "@/app/api/v1/contract-intake-forms/[id]/submit/route"
import { prisma } from "@/lib/prisma"
import { requireSessionAuth, orgHasModule } from "@/lib/api-auth"
import { applyApprovalRules } from "@/lib/contract-lifecycle/approval-rules"

function makeReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/v1/contract-intake-forms/form-1/submit"),
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
  )
}
function makeParams(id = "form-1") {
  return { params: Promise.resolve({ id }) }
}

const AUTH_SESSION = { orgId: "org-1", userId: "u-user", role: "sales" }

// Base form fixture
const BASE_FORM = {
  id: "form-1",
  organizationId: "org-1",
  name: "Service Request",
  contractType: "service_agreement",
  questions: [
    { id: "q1", label: "Project name", type: "text", required: true },
    { id: "q2", label: "Budget", type: "number", required: false },
  ],
  mapping: { q1: "title", q2: "valueAmount" },
  defaultStages: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSessionAuth).mockResolvedValue(AUTH_SESSION as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
  vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(BASE_FORM as any)
  vi.mocked(prisma.contractApprovalRule.findMany).mockResolvedValue([])
  vi.mocked(prisma.contract.count).mockResolvedValue(5)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u-admin" }] as any)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

  // $transaction: run the callback with a mock tx client
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const mockTx = {
      contract: { create: vi.fn().mockResolvedValue({ id: "c-new" }) },
      contractIntakeSubmission: { create: vi.fn().mockResolvedValue({ id: "sub-1" }) },
      contractApprovalStage: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }
    return fn(mockTx)
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe("POST .../submit — module gate", () => {
  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    vi.mocked(requireSessionAuth).mockResolvedValue({ ...AUTH_SESSION, role: "viewer" } as any)
    const res = await POST(makeReq({ responses: { q1: "My project" } }), makeParams())
    expect(res.status).toBe(403)
  })
})

describe("POST .../submit — authentication boundary", () => {
  it("allows a regular browser member without requiring contracts:write", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValue({ ...AUTH_SESSION, role: "sales" } as any)

    const res = await POST(makeReq({ responses: { q1: "My project" } }), makeParams())

    expect(res.status).toBe(201)
    expect(requireSessionAuth).toHaveBeenCalledWith(expect.any(NextRequest))
  })

  it("does not let an API key impersonate its creator to submit an intake form", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValue(
      new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any,
    )

    const res = await POST(
      makeReq(
        { responses: { q1: "My project" } },
        { authorization: "Bearer ld_test_api_key" },
      ),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("POST .../submit — form loading", () => {
  it("returns 404 when form not found in org", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq({ responses: { q1: "My project" } }), makeParams())
    expect(res.status).toBe(404)
  })
})

describe("POST .../submit — validation", () => {
  it("returns 400 when a required question is missing", async () => {
    const res = await POST(makeReq({ responses: {} }), makeParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Project name/)
  })

  it("returns 400 when number field has non-numeric value", async () => {
    const form = {
      ...BASE_FORM,
      questions: [
        { id: "q1", label: "Budget", type: "number", required: true },
      ],
    }
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(form as any)
    const res = await POST(makeReq({ responses: { q1: "not-a-number" } }), makeParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Budget/)
  })

  it("accepts valid responses and calls $transaction", async () => {
    const res = await POST(makeReq({ responses: { q1: "My project", q2: "50000" } }), makeParams())
    expect(res.status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})

describe("POST .../submit — mapping auto-fill", () => {
  it("maps q1→title and q2→valueAmount in the contract create call", async () => {
    let capturedData: unknown = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const mockTx = {
        contract: {
          create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedData = data
            return Promise.resolve({ id: "c-new" })
          }),
        },
        contractIntakeSubmission: { create: vi.fn().mockResolvedValue({ id: "sub-1" }) },
        contractApprovalStage: { createMany: vi.fn() },
      }
      return fn(mockTx)
    })

    await POST(makeReq({ responses: { q1: "New SLA Project", q2: "75000" } }), makeParams())

    expect((capturedData as any).title).toBe("New SLA Project")
    expect(Number((capturedData as any).valueAmount)).toBe(75000)
  })
})

describe("POST .../submit — cross-tenant guard", () => {
  it("returns 400 when companyId from responses belongs to another org", async () => {
    const form = {
      ...BASE_FORM,
      mapping: { q1: "companyId" },
      questions: [{ id: "q1", label: "Company", type: "text", required: true }],
    }
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(form as any)
    // Company lookup returns null → foreign org
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null)

    const res = await POST(makeReq({ responses: { q1: "company-other-org" } }), makeParams())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Company|not found/i)
  })

  it("accepts companyId that belongs to the same org", async () => {
    const form = {
      ...BASE_FORM,
      mapping: { q1: "companyId" },
      questions: [{ id: "q1", label: "Company", type: "text", required: true }],
    }
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(form as any)
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "comp-1" } as any)

    const res = await POST(makeReq({ responses: { q1: "comp-1" } }), makeParams())
    expect(res.status).toBe(201)
  })
})

describe("POST .../submit — defaultStages → auto-route", () => {
  const formWithStages = {
    ...BASE_FORM,
    defaultStages: [
      { label: "Manager Approval", assigneeRole: "manager" },
    ],
  }

  it("creates approval stages and sets status=pending_approval when defaultStages non-empty", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(formWithStages as any)
    vi.mocked(applyApprovalRules).mockReturnValue([
      { label: "Manager Approval", assigneeRole: "manager" },
    ])

    let capturedContractData: unknown = null
    let capturedStages: unknown = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const mockTx = {
        contract: {
          create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedContractData = data
            return Promise.resolve({ id: "c-new" })
          }),
        },
        contractIntakeSubmission: { create: vi.fn().mockResolvedValue({ id: "sub-1" }) },
        contractApprovalStage: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedStages = data
            return Promise.resolve({ count: 1 })
          }),
        },
      }
      return fn(mockTx)
    })

    const res = await POST(makeReq({ responses: { q1: "Project A" } }), makeParams())
    expect(res.status).toBe(201)
    expect((capturedContractData as any).status).toBe("pending_approval")
    expect((capturedContractData as any).currentApprovalStage).toBe(1)
    expect(Array.isArray(capturedStages)).toBe(true)
    expect((capturedStages as any[])[0].label).toBe("Manager Approval")

    const json = await res.json()
    expect(json.data.autoRouted).toBe(true)
    expect(json.data.stagesCreated).toBe(1)
  })

  it("leaves contract as draft when applyApprovalRules empties all stages (skip-all)", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(formWithStages as any)
    // All stages skipped by rules
    vi.mocked(applyApprovalRules).mockReturnValue([])

    let capturedContractData: unknown = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const mockTx = {
        contract: {
          create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedContractData = data
            return Promise.resolve({ id: "c-new" })
          }),
        },
        contractIntakeSubmission: { create: vi.fn().mockResolvedValue({ id: "sub-1" }) },
        contractApprovalStage: { createMany: vi.fn() },
      }
      return fn(mockTx)
    })

    const res = await POST(makeReq({ responses: { q1: "Project B" } }), makeParams())
    // Not a 422 — intake doesn't fail on empty stage result
    expect(res.status).toBe(201)
    expect((capturedContractData as any).status).toBe("draft")

    const json = await res.json()
    expect(json.data.autoRouted).toBe(false)
  })
})

describe("POST .../submit — notification", () => {
  it("notifies admins/managers (best-effort, does not fail submission)", async () => {
    const { createNotification } = await import("@/lib/notifications")
    const res = await POST(makeReq({ responses: { q1: "Project X" } }), makeParams())
    expect(res.status).toBe(201)
    // user.findMany was called to get recipients
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1" }),
      }),
    )
    // notification sent
    expect(createNotification).toHaveBeenCalled()
  })
})

describe("POST .../submit — org-scope", () => {
  it("sets organizationId=orgId on the submission", async () => {
    let capturedSubData: unknown = null
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const mockTx = {
        contract: { create: vi.fn().mockResolvedValue({ id: "c-new" }) },
        contractIntakeSubmission: {
          create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedSubData = data
            return Promise.resolve({ id: "sub-1" })
          }),
        },
        contractApprovalStage: { createMany: vi.fn() },
      }
      return fn(mockTx)
    })

    await POST(makeReq({ responses: { q1: "Project Z" } }), makeParams())
    expect((capturedSubData as any).organizationId).toBe("org-1")
    expect((capturedSubData as any).formId).toBe("form-1")
  })
})
