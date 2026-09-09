/**
 * Slice-3 security ext — POST /api/v1/{entity}/lookup route tests.
 *
 * These endpoints accept PII (fullName / taxId) in the request body
 * rather than URL query params, preventing plaintext SSN / full-name
 * from appearing in nginx access logs.
 *
 * Coverage (one test per invariant):
 *   • Returns 400 when neither fullName nor taxId is supplied
 *   • taxId body field is resolved to the blind-index hash (not logged)
 *   • fullName body field is resolved to the blind-index hash
 *   • Both filters may be combined (AND semantics via WHERE)
 *   • Audit metadata carries lookup:true + taxIdFilterHit/fullNameFilterHit
 *   • Whitespace-only values are treated as absent (400)
 *   • Pagination: body limit + cursor pass through to findMany
 *   • Cross-entity smoke: health-patients, policy-holders, beneficiaries
 *   • Beneficiaries: policyId + tier body fields narrow the WHERE
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    citizen: {
      findMany: vi.fn(),
    },
    healthPatient: {
      findMany: vi.fn(),
    },
    policyHolder: {
      findMany: vi.fn(),
    },
    beneficiary: {
      findMany: vi.fn(),
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

const ORG = "org-lookup-test"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const AUTH_OK = {
  orgId: ORG,
  userId: "u-1",
  role: "admin" as const,
  email: "test@example.com",
  name: "Test",
}

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

/** Stub row returned by findMany. `fullName` is stored as ciphertext
 *  in the DB; softDecryptForTenant returns it unchanged in tests
 *  (plain value passes through when it can't be decrypted). */
function makeStubCitizen(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    citizenNumber: "CIT-001",
    fullName: "Jane Doe",
    email: "jane@example.com",
    phone: null,
    status: "active",
    jurisdictionSlug: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeStubPatient(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    mrn: "MRN-001",
    fullName: "John Smith",
    email: null,
    phone: null,
    status: "active",
    primaryProviderId: null,
    registeredAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  }
}

function makeStubHolder(overrides: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    holderNumber: "POL-001",
    fullName: "Alice Holder",
    email: null,
    phone: null,
    status: "active",
    activatedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeStubBeneficiary(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    policyId: "po-1",
    tier: "primary",
    beneficiaryType: "person",
    fullName: "Estate of Jane Doe",
    relationship: null,
    allocationPct: 100,
    dateOfBirth: null,
    designatedAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
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

// ---------------------------------------------------------------------------
// citizens/lookup
// ---------------------------------------------------------------------------

describe("POST /api/v1/citizens/lookup — 400 on missing PII filter", () => {
  it("returns 400 when neither fullName nor taxId is supplied", async () => {
    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    const res = await POST(postReq("/api/v1/citizens/lookup", {}))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/fullName.*taxId/)
  })

  it("returns 400 when only whitespace-only taxId is supplied", async () => {
    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    const res = await POST(
      postReq("/api/v1/citizens/lookup", { taxId: "   " }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when only whitespace-only fullName is supplied", async () => {
    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    const res = await POST(
      postReq("/api/v1/citizens/lookup", { fullName: "\t\n" }),
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/citizens/lookup — blind-index resolution", () => {
  it("resolves taxId body field to blind-index hash in WHERE", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([
      makeStubCitizen(),
    ] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", { taxId: "123-45-6789" }),
    )

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { taxIdBlindIndex?: string; fullNameBlindIndex?: string }
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
    // fullName was not supplied — its index column must be absent.
    expect(where.fullNameBlindIndex).toBeUndefined()
  })

  it("resolves fullName body field to blind-index hash in WHERE", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", { fullName: "Jane Doe" }),
    )

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string; taxIdBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Jane Doe"),
    )
    expect(where.taxIdBlindIndex).toBeUndefined()
  })

  it("applies both filters with AND semantics when both are supplied", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", {
        fullName: "Jane Doe",
        taxId: "123-45-6789",
      }),
    )

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string; taxIdBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Jane Doe"),
    )
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
  })

  it("normalization tolerant: leading/trailing spaces in taxId produce same hash", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", { taxId: "  123-45-6789  " }),
    )

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { taxIdBlindIndex?: string }
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "123-45-6789"),
    )
  })
})

describe("POST /api/v1/citizens/lookup — audit metadata", () => {
  it("writes audit row with lookup:true + correct filter flags", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", { taxId: "123-45-6789" }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    expect(auditCall).toBeDefined()
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.lookup).toBe(true)
    expect(metadata.taxIdFilterHit).toBe(true)
    expect(metadata.fullNameFilterHit).toBe(false)
  })

  it("audit flags fullNameFilterHit:true and taxIdFilterHit:false for fullName-only lookup", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", { fullName: "Jane Doe" }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.fullNameFilterHit).toBe(true)
    expect(metadata.taxIdFilterHit).toBe(false)
  })
})

describe("POST /api/v1/citizens/lookup — pagination", () => {
  it("passes limit and cursor from body to findMany", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", {
        taxId: "999-00-1234",
        limit: 10,
        cursor: "c-99",
      }),
    )

    const call = vi.mocked(prisma.citizen.findMany).mock.calls[0][0] as {
      take: number
      cursor?: { id: string }
      skip?: number
    }
    // limit + 1 over-fetch for hasMore detection
    expect(call.take).toBe(11)
    expect(call.cursor).toEqual({ id: "c-99" })
    expect(call.skip).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// health-patients/lookup — cross-entity smoke
// ---------------------------------------------------------------------------

describe("POST /api/v1/health-patients/lookup — cross-entity smoke", () => {
  it("resolves taxId to blind-index hash in WHERE", async () => {
    vi.mocked(prisma.healthPatient.findMany).mockResolvedValue([
      makeStubPatient(),
    ] as never)

    const { POST } = await import("@/app/api/v1/health-patients/lookup/route")
    const res = await POST(
      postReq("/api/v1/health-patients/lookup", { taxId: "555-12-3456" }),
    )
    expect(res.status).toBe(200)

    const where = vi.mocked(prisma.healthPatient.findMany).mock.calls[0][0]
      ?.where as { taxIdBlindIndex?: string }
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "555-12-3456"),
    )
  })

  it("returns 400 when no PII filter supplied", async () => {
    const { POST } = await import("@/app/api/v1/health-patients/lookup/route")
    const res = await POST(
      postReq("/api/v1/health-patients/lookup", { status: "active" }),
    )
    expect(res.status).toBe(400)
  })

  it("audit metadata carries lookup:true for PHI path", async () => {
    vi.mocked(prisma.healthPatient.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/health-patients/lookup/route")
    await POST(
      postReq("/api/v1/health-patients/lookup", { fullName: "John Smith" }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.lookup).toBe(true)
    expect(metadata.fullNameFilterHit).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// policy-holders/lookup — cross-entity smoke
// ---------------------------------------------------------------------------

describe("POST /api/v1/policy-holders/lookup — cross-entity smoke", () => {
  it("resolves taxId to blind-index hash in WHERE", async () => {
    vi.mocked(prisma.policyHolder.findMany).mockResolvedValue([
      makeStubHolder(),
    ] as never)

    const { POST } = await import(
      "@/app/api/v1/policy-holders/lookup/route"
    )
    const res = await POST(
      postReq("/api/v1/policy-holders/lookup", { taxId: "444-33-2222" }),
    )
    expect(res.status).toBe(200)

    const where = vi.mocked(prisma.policyHolder.findMany).mock.calls[0][0]
      ?.where as { taxIdBlindIndex?: string }
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "444-33-2222"),
    )
  })
})

// ---------------------------------------------------------------------------
// beneficiaries/lookup — policyId + tier narrowing
// ---------------------------------------------------------------------------

describe("POST /api/v1/beneficiaries/lookup — policyId + tier narrowing", () => {
  it("applies policyId and tier from body to WHERE", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([
      makeStubBeneficiary(),
    ] as never)

    const { POST } = await import(
      "@/app/api/v1/beneficiaries/lookup/route"
    )
    await POST(
      postReq("/api/v1/beneficiaries/lookup", {
        taxId: "999-88-7777",
        policyId: "po-1",
        tier: "primary",
      }),
    )

    const where = vi.mocked(prisma.beneficiary.findMany).mock.calls[0][0]
      ?.where as {
      policyId?: string
      tier?: string
      revokedAt?: null
      taxIdBlindIndex?: string
    }
    expect(where.policyId).toBe("po-1")
    expect(where.tier).toBe("primary")
    // revokedAt: null — default excludes revoked rows
    expect(where.revokedAt).toBeNull()
    expect(where.taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG, "999-88-7777"),
    )
  })

  it("includes revoked rows when includeRevoked:true is set", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([] as never)

    const { POST } = await import(
      "@/app/api/v1/beneficiaries/lookup/route"
    )
    await POST(
      postReq("/api/v1/beneficiaries/lookup", {
        fullName: "Estate of Jane Doe",
        includeRevoked: true,
      }),
    )

    const where = vi.mocked(prisma.beneficiary.findMany).mock.calls[0][0]
      ?.where as { revokedAt?: null }
    // revokedAt filter must be absent when includeRevoked is true
    expect("revokedAt" in where).toBe(false)
  })

  it("audit metadata carries lookup:true for beneficiaries PII path", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([] as never)

    const { POST } = await import(
      "@/app/api/v1/beneficiaries/lookup/route"
    )
    await POST(
      postReq("/api/v1/beneficiaries/lookup", { taxId: "111-22-3333" }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata
    expect(metadata.lookup).toBe(true)
    expect(metadata.taxIdFilterHit).toBe(true)
    expect(metadata.fullNameFilterHit).toBe(false)
  })

  it("includes revoked rows when includeRevoked is the string 'true'", async () => {
    // Clients serialising query params as strings must also work.
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValue([] as never)

    const { POST } = await import(
      "@/app/api/v1/beneficiaries/lookup/route"
    )
    await POST(
      postReq("/api/v1/beneficiaries/lookup", {
        fullName: "Estate of Jane Doe",
        includeRevoked: "true", // string — must be treated as true
      }),
    )

    const where = vi.mocked(prisma.beneficiary.findMany).mock.calls[0][0]
      ?.where as { revokedAt?: null }
    expect("revokedAt" in where).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Security invariant: plaintext PII never appears in audit metadata
// ---------------------------------------------------------------------------

describe("Audit metadata — plaintext PII absent", () => {
  it("citizens/lookup audit row does NOT contain plaintext taxId or fullName", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", {
        taxId: "SECRET-SSN-999",
        fullName: "Very Secret Name",
      }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata

    // The central invariant: plaintext PII must never appear in the log.
    expect("taxId" in metadata).toBe(false)
    expect("fullName" in metadata).toBe(false)
    // Only boolean flags are logged — not the values.
    expect(metadata.taxIdFilterHit).toBe(true)
    expect(metadata.fullNameFilterHit).toBe(true)
  })

  it("citizens/lookup audit row logs cursorPresent:bool — not the cursor value", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([] as never)

    const { POST } = await import("@/app/api/v1/citizens/lookup/route")
    await POST(
      postReq("/api/v1/citizens/lookup", {
        taxId: "123-45-6789",
        cursor: "c-entity-id-99",
      }),
    )

    const auditCall =
      vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (
      auditCall![0] as { data: { metadata: Record<string, unknown> } }
    ).data.metadata

    // cursor key (which could be PII-adjacent) must not appear.
    expect("cursor" in metadata).toBe(false)
    // Instead, only presence is recorded.
    expect(metadata.cursorPresent).toBe(true)
  })
})
