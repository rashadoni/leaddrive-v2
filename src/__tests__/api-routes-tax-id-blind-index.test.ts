/**
 * Slice-3 extension — taxId blind-index route wiring tests.
 *
 * Mirrors `api-citizens-blind-index.test.ts` for the taxId column.
 * One file covers all four entities by testing the citizens route in
 * depth (pattern is identical across the four) plus a spot-check on
 * health-patients PATCH to confirm the dual-write happens inside the
 * column-loop refactor for the non-citizens entities too.
 *
 * Coverage:
 *   • POST stamps taxIdBlindIndex alongside the encrypted taxId
 *   • POST is normalization-tolerant (trim + whitespace)
 *   • PATCH re-computes the index when body.taxId changes
 *   • PATCH leaves the index untouched on non-taxId patches
 *   • GET ?taxId= filters via the blind-index column
 *   • Audit metadata flags taxIdFilterHit when the filter is used
 *   • Cross-entity smoke: health-patients PATCH stamps taxIdBlindIndex
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    citizen: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    healthPatient: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    beneficiary: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
    },
    complianceAuditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import {
  blindIndexForTenant,
  resetBlindIndexKeyCache,
  resetMasterKekCache,
} from "@/lib/crypto/tenant-pii-encryption"

const ORG = "org-tax-id-test"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const AUTH_OK = {
  orgId: ORG,
  userId: "u-1",
  role: "admin" as const,
  email: "test@example.com",
  name: "Test",
}

function jsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function getReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  resetBlindIndexKeyCache()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as never)
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never)
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

describe("POST /api/v1/citizens — taxIdBlindIndex write", () => {
  it("stamps taxIdBlindIndex alongside the encrypted taxId", async () => {
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "c-1",
          citizenNumber: args.data.citizenNumber,
          fullName: args.data.fullName,
          taxId: args.data.taxId,
          taxIdBlindIndex: args.data.taxIdBlindIndex,
          status: "active",
        }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    await POST(
      jsonReq("/api/v1/citizens", {
        citizenNumber: "CIT-001",
        fullName: "Jane Doe",
        taxId: "123-45-6789",
      }),
    )

    const call = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: { taxIdBlindIndex: string }
    }
    expect(call.data.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
  })

  it("does NOT write taxIdBlindIndex when taxId is omitted (null/null sync)", async () => {
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "c-2",
          citizenNumber: args.data.citizenNumber,
          fullName: args.data.fullName,
          status: "active",
        }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    await POST(
      jsonReq("/api/v1/citizens", {
        citizenNumber: "CIT-002",
        fullName: "No SSN",
        // taxId intentionally omitted
      }),
    )

    const call = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: { taxId: unknown; taxIdBlindIndex: unknown }
    }
    // Both columns null — they always populate together or stay NULL together.
    expect(call.data.taxId).toBeNull()
    expect(call.data.taxIdBlindIndex).toBeNull()
  })

  it("normalization tolerant: '  123-45-6789  ' → same hash as '123-45-6789'", async () => {
    vi.mocked(prisma.citizen.create).mockImplementation(
      async () => ({ id: "c-3", status: "active" }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    await POST(
      jsonReq("/api/v1/citizens", {
        citizenNumber: "CIT-003",
        fullName: "Some Name",
        taxId: "  123-45-6789  ",
      }),
    )
    const call = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: { taxIdBlindIndex: string }
    }
    expect(call.data.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
  })
})

describe("PATCH /api/v1/citizens/[id] — taxIdBlindIndex re-compute", () => {
  it("re-computes blind-index when taxId changes", async () => {
    vi.mocked(prisma.citizen.findFirst).mockResolvedValue({
      id: "c-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.citizen.update).mockResolvedValue({
      id: "c-1",
      fullName: "encrypted",
    } as never)

    const { PATCH } = await import("@/app/api/v1/citizens/[id]/route")
    await PATCH(
      jsonReq(
        "/api/v1/citizens/c-1",
        { taxId: "987-65-4321" },
        "PATCH",
      ),
      { params: Promise.resolve({ id: "c-1" }) },
    )

    const updateCall = vi.mocked(prisma.citizen.update).mock.calls[0][0] as {
      data: { taxId?: unknown; taxIdBlindIndex?: string | null }
    }
    expect(updateCall.data.taxId).toBeDefined() // ciphertext written
    expect(updateCall.data.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "987-65-4321"),
    )
  })

  it("does NOT touch taxIdBlindIndex on email-only PATCH", async () => {
    vi.mocked(prisma.citizen.findFirst).mockResolvedValue({
      id: "c-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.citizen.update).mockResolvedValue({ id: "c-1" } as never)

    const { PATCH } = await import("@/app/api/v1/citizens/[id]/route")
    await PATCH(
      jsonReq(
        "/api/v1/citizens/c-1",
        { email: "new@example.com" },
        "PATCH",
      ),
      { params: Promise.resolve({ id: "c-1" }) },
    )

    const updateCall = vi.mocked(prisma.citizen.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    // Email landed, taxIdBlindIndex left untouched (key absent from data).
    expect(updateCall.data.email).toBe("new@example.com")
    expect("taxIdBlindIndex" in updateCall.data).toBe(false)
    expect("taxId" in updateCall.data).toBe(false)
  })
})

describe("GET /api/v1/citizens — ?taxId= filter via blind index", () => {
  it("queries by taxIdBlindIndex when ?taxId= is supplied", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?taxId=123-45-6789"))

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]?.where as {
      taxIdBlindIndex?: string
      fullNameBlindIndex?: string
    }
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
    // fullName filter wasn't supplied — that index column shouldn't be in the where.
    expect(where.fullNameBlindIndex).toBeUndefined()
  })

  it("treats whitespace-only ?taxId= as no-op", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?taxId=%20%20%20"))

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]?.where as {
      taxIdBlindIndex?: string
    }
    expect(where.taxIdBlindIndex).toBeUndefined()
  })

  it("audit metadata flags taxIdFilterHit when the filter is used", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?taxId=123-45-6789"))

    const auditCall = vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    expect(auditCall).toBeDefined()
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.taxIdFilterHit).toBe(true)
    expect(metadata.fullNameFilterHit).toBe(false)
  })
})

describe("PATCH /api/v1/health-patients/[id] — cross-entity smoke", () => {
  it("stamps taxIdBlindIndex on health-patients PATCH (sanity-check the column-loop refactor)", async () => {
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.healthPatient.update).mockResolvedValue({
      id: "p-1",
      mrn: "MRN-001",
      fullName: "encrypted",
      status: "active",
    } as never)

    const { PATCH } = await import("@/app/api/v1/health-patients/[id]/route")
    await PATCH(
      jsonReq("/api/v1/health-patients/p-1", { taxId: "555-12-3456" }, "PATCH"),
      { params: Promise.resolve({ id: "p-1" }) },
    )

    const updateCall = vi.mocked(prisma.healthPatient.update).mock.calls[0][0] as {
      data: { taxId?: unknown; taxIdBlindIndex?: string | null }
    }
    expect(updateCall.data.taxId).toBeDefined()
    expect(updateCall.data.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "555-12-3456"),
    )
  })
})

describe("POST /api/v1/beneficiaries — taxIdBlindIndex inside SERIALIZABLE tx", () => {
  it("stamps taxIdBlindIndex on tx.beneficiary.create's data arg", async () => {
    // Beneficiaries POST runs inside a SERIALIZABLE prisma.$transaction
    // for set-level allocation validation — structurally distinct from
    // the other entities. Smoke-test that the taxId dual-write lands
    // inside the transaction body.
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "po-1",
      lineOfBusiness: "auto",
    } as never)
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])
    vi.mocked(prisma.beneficiary.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "b-1",
          policyId: args.data.policyId,
          tier: args.data.tier,
          beneficiaryType: args.data.beneficiaryType,
          fullName: args.data.fullName,
          taxIdBlindIndex: args.data.taxIdBlindIndex,
          allocationPct: args.data.allocationPct,
          designatedAt: new Date(),
          createdAt: new Date(),
        }) as never,
    )
    // Stub $transaction as a callback-invoker — runs the route's
    // transaction body against the same prisma mock so we can read
    // `prisma.beneficiary.create.mock.calls` after the route returns.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(prisma as any).$transaction = vi.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: (tx: typeof prisma) => any) => fn(prisma),
    )

    const { POST } = await import("@/app/api/v1/beneficiaries/route")
    const res = await POST(
      jsonReq("/api/v1/beneficiaries", {
        policyId: "po-1",
        fullName: "Estate of Jane Doe",
        allocationPct: 100,
        taxId: "999-88-7777",
      }),
    )
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.beneficiary.create).mock
      .calls[0][0] as { data: { taxIdBlindIndex: string } }
    expect(createCall.data.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "999-88-7777"),
    )
  })
})
