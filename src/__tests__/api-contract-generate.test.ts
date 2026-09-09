/**
 * CLM Slice 1c — API tests for:
 *   POST /api/v1/contract-templates/[id]/generate
 *
 * Coverage:
 *   - Happy path: creates Contract + ContractVersion v1 with non-empty contentHash
 *   - Missing required variable → 400 with missingVars
 *   - Module/permission gate → 403 when requireAuth returns error response
 *   - Read-only role → 403 (requireAuth(contracts, write) enforced)
 *   - Org-scoped: missing template → 404
 *   - Inactive template → 422
 *   - $transaction is used (atomic)
 *   - HIGH: cross-tenant companyId/dealId/contactId → 404 (FK guard)
 *   - MEDIUM: bad startDate/endDate → 400 (coerce.date validation)
 *   - MEDIUM: Prisma P2002 → 409 (duplicate contractNumber)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractTemplate: {
      findFirst: vi.fn(),
    },
    company: {
      findFirst: vi.fn(),
    },
    deal: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    contractClause: {
      findMany: vi.fn(),
    },
    contractDeviationFlag: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: unknown) => v instanceof NextResponse),
}))

// normalizeContractRow returns the contract unchanged for our purposes
vi.mock("@/lib/prisma-decimal", () => ({
  normalizeContractRow: (c: any) => c,
}))

import { POST } from "@/app/api/v1/contract-templates/[id]/generate/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { Prisma } from "@prisma/client"

// Convenience alias — typed after import so vi.mocked resolves correctly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = () => vi.mocked((prisma as any).$transaction)

// Auth fixtures
const authWrite = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Admin" }
const auth403   = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/contract-templates/tmpl-1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeParams(id = "tmpl-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

// Minimal contract template with one required variable
const baseTemplate = {
  id: "tmpl-1",
  organizationId: "org-1",
  name: "Service Agreement",
  version: 1,
  isActive: true,
  defaultContractType: "service_agreement",
  clauses: [
    {
      id: "clause-1",
      title: "Parties",
      body: "This agreement is between {{clientName}} and the provider.",
    },
  ],
  variables: [
    { name: "clientName", type: "string", required: true },
  ],
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Default: authorized write role
  vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
  // Default: FK lookups return matching same-org records (happy path)
  vi.mocked((prisma as any).company.findFirst).mockResolvedValue({ id: "comp-99" })
  vi.mocked((prisma as any).deal.findFirst).mockResolvedValue({ id: "deal-77" })
  vi.mocked((prisma as any).contact.findFirst).mockResolvedValue({ id: "contact-55" })
  // Default: no library clauses (best-effort detection safe to call)
  vi.mocked((prisma as any).contractClause.findMany).mockResolvedValue([])
  vi.mocked((prisma as any).contractDeviationFlag.createMany).mockResolvedValue({ count: 0 })
})

describe("POST /api/v1/contract-templates/[id]/generate", () => {
  // ── Happy path ─────────────────────────────────────────────────────

  it("creates Contract + ContractVersion v1 with non-empty sha256 contentHash", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    const createdContract = {
      id: "ctr-1",
      organizationId: "org-1",
      contractNumber: "CONTRACT-20260607-ABCD",
      title: "Service Agreement",
      type: "service_agreement",
      status: "draft",
      templateId: "tmpl-1",
      templateVersion: 1,
      renderedBody: "Parties\n\nThis agreement is between Acme Corp and the provider.",
      company: null,
      deal: null,
      contact: null,
    }

    // $transaction receives a callback; execute it with a mock tx
    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          create: vi.fn().mockResolvedValue(createdContract),
        },
        contractVersion: {
          create: vi.fn().mockResolvedValue({ id: "cv-1" }),
        },
      }
      await cb(mockTx)
      // Return the first value (contract) as the transaction result
      return [createdContract]
    })

    const res = await POST(
      makeReq({ variables: { clientName: "Acme Corp" } }),
      makeParams(),
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("ctr-1")
    expect(json.data.status).toBe("draft")

    // Verify $transaction was called (atomicity)
    expect(mockTransaction()).toHaveBeenCalledTimes(1)

    // Inspect what was passed to tx.contract.create and tx.contractVersion.create
    const txCb = mockTransaction().mock.calls[0][0]
    const captureCreate = { contractArgs: null as any, versionArgs: null as any }
    await txCb({
      contract: {
        create: vi.fn().mockImplementation((args: any) => {
          captureCreate.contractArgs = args
          return createdContract
        }),
      },
      contractVersion: {
        create: vi.fn().mockImplementation((args: any) => {
          captureCreate.versionArgs = args
          return { id: "cv-1" }
        }),
      },
    })

    // Contract fields
    expect(captureCreate.contractArgs.data.status).toBe("draft")
    expect(captureCreate.contractArgs.data.templateId).toBe("tmpl-1")
    expect(captureCreate.contractArgs.data.templateVersion).toBe(1)
    expect(captureCreate.contractArgs.data.renderedBody).toContain("Acme Corp")

    // ContractVersion fields
    expect(captureCreate.versionArgs.data.versionNo).toBe(1)
    expect(captureCreate.versionArgs.data.source).toBe("draft")

    // createdBy must come from the flat session.userId (NOT session.user.id) on
    // BOTH the contract and its v1 version — regression guard for the flat-session bug.
    expect(captureCreate.contractArgs.data.createdBy).toBe("user-1")
    expect(captureCreate.versionArgs.data.createdBy).toBe("user-1")

    // contentHash must be a 64-char sha256 hex string
    const contentHash: string = captureCreate.versionArgs.data.contentHash
    expect(contentHash).toBeTruthy()
    expect(contentHash.length).toBe(64)
    expect(/^[0-9a-f]{64}$/.test(contentHash)).toBe(true)

    // Verify contentHash is actually sha256 of the renderedBody
    const expectedHash = crypto
      .createHash("sha256")
      .update(captureCreate.contractArgs.data.renderedBody, "utf8")
      .digest("hex")
    expect(contentHash).toBe(expectedHash)
  })

  it("passes optional fields (companyId, dealId, title) to contract create", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    let capturedContractData: any = null
    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          create: vi.fn().mockImplementation((args: any) => {
            capturedContractData = args.data
            return { id: "ctr-2", status: "draft", company: null, deal: null, contact: null }
          }),
        },
        contractVersion: {
          create: vi.fn().mockResolvedValue({ id: "cv-2" }),
        },
      }
      await cb(mockTx)
      return [{ id: "ctr-2", status: "draft" }]
    })

    await POST(
      makeReq({
        variables: { clientName: "Beta Ltd" },
        companyId: "comp-99",
        dealId: "deal-77",
        title: "Custom Title",
      }),
      makeParams(),
    )

    expect(capturedContractData.companyId).toBe("comp-99")
    expect(capturedContractData.dealId).toBe("deal-77")
    expect(capturedContractData.title).toBe("Custom Title")
  })

  // ── Missing required variable → 400 ───────────────────────────────

  it("returns 400 with missingVars when a required variable is omitted", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    const res = await POST(
      makeReq({ variables: {} }), // clientName omitted
      makeParams(),
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/variable substitution failed/i)
    expect(Array.isArray(json.missingVars)).toBe(true)
    expect(json.missingVars).toContain("clientName")
    // Must NOT call $transaction when substitution fails
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  // ── Permission/module gate → 403 ─────────────────────────────────

  it("returns 403 when requireAuth rejects (module disabled or read-only role)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)

    const res = await POST(makeReq({ variables: {} }), makeParams())
    expect(res.status).toBe(403)
  })

  // ── Read-only role → 403 ──────────────────────────────────────────

  it("returns 403 for a read-only role (sales/support — contracts:read only)", async () => {
    // requireAuth(contracts, write) rejects read-only role before any business logic
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)

    const res = await POST(makeReq({ variables: { clientName: "X" } }), makeParams())
    expect(res.status).toBe(403)
    // Must NOT proceed to template lookup or transaction
    expect(prisma.contractTemplate.findFirst).not.toHaveBeenCalled()
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  // ── Org-scoped: template from another org → 404 ───────────────────

  it("returns 404 when template belongs to a different org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(null) // org-scoped query returns null

    const res = await POST(
      makeReq({ variables: { clientName: "X" } }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/not found/i)
  })

  // ── Inactive template → 422 ───────────────────────────────────────

  it("returns 422 when template is inactive", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue({
      ...baseTemplate,
      isActive: false,
    } as any)

    const res = await POST(
      makeReq({ variables: { clientName: "X" } }),
      makeParams(),
    )

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/not active/i)
  })

  // ── Unauthorized → 403 (via requireAuth) ─────────────────────────

  it("returns 403/401 when session is missing (requireAuth returns error)", async () => {
    const auth401 = new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    vi.mocked(requireAuth).mockResolvedValue(auth401 as any)

    const res = await POST(makeReq({ variables: {} }), makeParams())
    // requireAuth can return 401 or 403 depending on the failure mode
    expect([401, 403]).toContain(res.status)
  })

  // ── HIGH: cross-tenant FK guard ────────────────────────────────────

  it("returns 404 when companyId belongs to a different org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)
    // company.findFirst returns null → foreign-org company
    vi.mocked((prisma as any).company.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, companyId: "foreign-comp" }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/company not found in this tenant/i)
    // Must NOT proceed to transaction when FK guard fails
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 404 when dealId belongs to a different org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)
    vi.mocked((prisma as any).deal.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, dealId: "foreign-deal" }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/deal not found in this tenant/i)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 404 when contactId belongs to a different org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)
    vi.mocked((prisma as any).contact.findFirst).mockResolvedValue(null)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, contactId: "foreign-contact" }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/contact not found in this tenant/i)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("validates FK for all three ids when all are supplied and all match", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)
    // All FK lookups return matching records
    vi.mocked((prisma as any).company.findFirst).mockResolvedValue({ id: "comp-1" })
    vi.mocked((prisma as any).deal.findFirst).mockResolvedValue({ id: "deal-1" })
    vi.mocked((prisma as any).contact.findFirst).mockResolvedValue({ id: "contact-1" })

    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: { create: vi.fn().mockResolvedValue({ id: "ctr-fk", status: "draft", company: null, deal: null, contact: null }) },
        contractVersion: { create: vi.fn().mockResolvedValue({ id: "cv-fk" }) },
      }
      await cb(mockTx)
      return [{ id: "ctr-fk", status: "draft" }]
    })

    const res = await POST(
      makeReq({
        variables: { clientName: "Corp" },
        companyId: "comp-1",
        dealId: "deal-1",
        contactId: "contact-1",
      }),
      makeParams(),
    )
    expect(res.status).toBe(201)
    // All three FK lookups must have been called with org-scoped where
    expect((prisma as any).company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
    )
    expect((prisma as any).deal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
    )
    expect((prisma as any).contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
    )
  })

  // ── MEDIUM: date validation → 400 on bad ISO string ───────────────

  it("returns 400 when startDate is not a valid ISO date string", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, startDate: "not-a-date" }),
      makeParams(),
    )

    // z.coerce.date() rejects non-parseable strings → Zod validation error → 400
    expect(res.status).toBe(400)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 400 when endDate is not a valid ISO date string", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, endDate: "garbage" }),
      makeParams(),
    )

    expect(res.status).toBe(400)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  // ── MEDIUM: Prisma error mapping ──────────────────────────────────

  it("returns 409 when Prisma throws P2002 (duplicate contractNumber)", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(baseTemplate as any)

    const p2002 = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      name: "PrismaClientKnownRequestError",
    })
    // Make it pass instanceof check by setting prototype
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype)

    mockTransaction().mockRejectedValue(p2002)

    const res = await POST(
      makeReq({ variables: { clientName: "X" }, contractNumber: "DUPE-001" }),
      makeParams(),
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already exists/i)
  })
})
