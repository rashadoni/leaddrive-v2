/**
 * Slice-3 blind-index integration tests for the R7 beneficiaries route.
 *
 * Mirrors `api-citizens-blind-index.test.ts` / `-policy-holders-...`
 * with one wrinkle: beneficiaries POST + PATCH are wrapped in a
 * SERIALIZABLE `prisma.$transaction(async (tx) => {...})` for set-level
 * allocation validation. We mock $transaction as a callback-invoker so
 * the assertions still target the same prisma mock.
 *
 * Coverage:
 *   • POST stamps fullNameBlindIndex alongside the encrypted ciphertext
 *   • POST is case- + whitespace-insensitive (normalization round-trip)
 *   • PATCH re-computes the index when body.fullName is supplied
 *   • PATCH leaves fullNameBlindIndex untouched on non-name patches
 *   • GET ?fullName= filters via the blind-index column
 *   • Audit metadata flags fullNameFilterHit when the filter is used
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
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

const ORG = "org-test-beneficiaries"
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

// The route calls `prisma.$transaction(async (tx) => {...})`; this stub
// runs the callback against the same `prisma` mock so all
// `tx.policy.findFirst` / `tx.beneficiary.*` calls land on the same
// vi.fn instances the test asserts against.
type TxFn = (
  tx: typeof prisma,
) => Promise<{
  beneficiary?: Record<string, unknown>
  error?: string
  status?: number
}>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  resetBlindIndexKeyCache()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as never)
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(prisma as any).$transaction = vi
    .fn()
    .mockImplementation(async (fn: TxFn) => fn(prisma))
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

describe("POST /api/v1/beneficiaries — fullNameBlindIndex write", () => {
  it("stamps fullNameBlindIndex alongside the encrypted fullName", async () => {
    // Tenant-scoped policy lookup succeeds — line-of-business is "auto"
    // (non-life) so the validator doesn't enforce the 100% primary-sum
    // invariant.
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "po-1",
      lineOfBusiness: "auto",
    } as never)
    // No existing beneficiaries on the policy — the new row is the
    // first in the set.
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])
    vi.mocked(prisma.beneficiary.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "b-1",
        policyId: args.data.policyId,
        tier: args.data.tier,
        beneficiaryType: args.data.beneficiaryType,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        allocationPct: args.data.allocationPct,
        designatedAt: new Date(),
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/beneficiaries/route")
    const res = await POST(
      jsonReq("/api/v1/beneficiaries", {
        policyId: "po-1",
        fullName: "Estate of Jane Doe",
        allocationPct: 100,
      }),
    )
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.beneficiary.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    expect(createCall.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Estate of Jane Doe"),
    )
    expect(createCall.data.fullNameBlindIndex).not.toBeNull()
  })

  it("blind-index is case-insensitive: 'JANE DOE' produces same hash as 'Jane Doe'", async () => {
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "po-1",
      lineOfBusiness: "auto",
    } as never)
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])
    vi.mocked(prisma.beneficiary.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "b-2",
        policyId: args.data.policyId,
        tier: args.data.tier,
        beneficiaryType: args.data.beneficiaryType,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        allocationPct: args.data.allocationPct,
        designatedAt: new Date(),
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/beneficiaries/route")
    await POST(
      jsonReq("/api/v1/beneficiaries", {
        policyId: "po-1",
        fullName: "JANE DOE",
        allocationPct: 100,
      }),
    )
    const call = vi.mocked(prisma.beneficiary.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    // Same hash as the lowercase / canonical version.
    expect(call.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "jane doe"),
    )
  })
})

describe("PATCH /api/v1/beneficiaries/[id] — fullNameBlindIndex re-compute", () => {
  it("re-computes blind-index when fullName changes", async () => {
    vi.mocked(prisma.beneficiary.findFirst).mockResolvedValue({
      id: "b-1",
      policyId: "po-1",
      tier: "primary",
      beneficiaryType: "person",
      allocationPct: {
        toString: () => "100",
        isNegative: () => false,
      } as never,
      revokedAt: null,
    } as never)
    vi.mocked(prisma.beneficiary.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "b-1",
        policyId: "po-1",
        tier: "primary",
        beneficiaryType: "person",
        fullName: args.data.fullName ?? "X",
        relationship: null,
        allocationPct: "100",
        dateOfBirth: null,
        designatedAt: new Date(),
        revokedAt: null,
        revocationReason: null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/beneficiaries/[id]/route")
    const res = await PATCH(
      jsonReq(
        "/api/v1/beneficiaries/b-1",
        { fullName: "Estate of John Smith" },
        "PATCH",
      ),
      { params: Promise.resolve({ id: "b-1" }) },
    )
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.beneficiary.update).mock.calls[0][0] as {
      data: { fullName?: unknown; fullNameBlindIndex?: string | null }
    }
    expect(updateCall.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Estate of John Smith"),
    )
    expect(updateCall.data.fullName).toBeDefined()
  })

  it("does NOT touch fullNameBlindIndex when PATCH omits fullName", async () => {
    vi.mocked(prisma.beneficiary.findFirst).mockResolvedValue({
      id: "b-1",
      policyId: "po-1",
      tier: "primary",
      beneficiaryType: "person",
      allocationPct: {
        toString: () => "100",
        isNegative: () => false,
      } as never,
      revokedAt: null,
    } as never)
    vi.mocked(prisma.beneficiary.update).mockImplementation(
      async () =>
        ({
          id: "b-1",
          policyId: "po-1",
          tier: "primary",
          beneficiaryType: "person",
          fullName: "X",
          relationship: null,
          allocationPct: "100",
          dateOfBirth: null,
          designatedAt: new Date(),
          revokedAt: null,
          revocationReason: null,
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/beneficiaries/[id]/route")
    // dateOfBirth-only patch — no set-level change, no fullName.
    await PATCH(
      jsonReq(
        "/api/v1/beneficiaries/b-1",
        { dateOfBirth: "1990-04-12" },
        "PATCH",
      ),
      { params: Promise.resolve({ id: "b-1" }) },
    )

    const updateCall = vi.mocked(prisma.beneficiary.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect("fullNameBlindIndex" in updateCall.data).toBe(false)
    // dateOfBirth landed as expected — sanity that the test patched
    // *something*.
    expect(updateCall.data.dateOfBirth).toBeInstanceOf(Date)
  })
})

describe("GET /api/v1/beneficiaries — ?fullName= filter via blind index", () => {
  it("queries by fullNameBlindIndex when ?fullName= is supplied", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/beneficiaries/route")
    await GET(
      getReq(
        "/api/v1/beneficiaries?policyId=po-1&fullName=Estate%20of%20Jane%20Doe",
      ),
    )

    const where = vi.mocked(prisma.beneficiary.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Estate of Jane Doe"),
    )
  })

  it("treats whitespace-only ?fullName= as no-op", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/beneficiaries/route")
    await GET(getReq("/api/v1/beneficiaries?policyId=po-1&fullName=%20%20%20"))

    const where = vi.mocked(prisma.beneficiary.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBeUndefined()
  })

  it("audit metadata flags fullNameFilterHit when filter is used", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/beneficiaries/route")
    await GET(
      getReq(
        "/api/v1/beneficiaries?policyId=po-1&fullName=Estate%20of%20Jane%20Doe",
      ),
    )

    // recordPiiAccessFromRequest writes through prisma.complianceAuditLog.create.
    // Asserting at the prisma layer (rather than spying on the helper)
    // matches the citizens / policy-holders pattern and catches a
    // regression if the route stops calling the helper at all.
    const auditCall = vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    expect(auditCall).toBeDefined()
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.fullNameFilterHit).toBe(true)
  })
})
