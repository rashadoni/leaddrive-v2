/**
 * Phase 7 slice-3 — R8 Public Sector grants + licenses wired to the
 * column-bound AAD helpers. Pattern parallels R8 PR-1 (citizens/cases).
 *
 * Strategy: mock the entire encryption module. Each helper is a spy.
 * Assert calls to bound helpers with the exact `(table, column)`
 * tuple, and assert the legacy orgId-only helpers are NOT called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r8-pr2"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicSectorGrant: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    publicSectorLicense: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    publicSectorOfficial: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/public-sector/state-machine", () => ({
  transitionGrant: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
  transitionLicense: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordFoiaAccessFromRequest: vi.fn(),
  recordFoiaAccess: vi.fn(),
}))

vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({
  encryptForTenant: vi.fn((_orgId: string, v: string) => `LEGACY:${v}`),
  encryptForTenantOrNull: vi.fn((_orgId: string, v: string | null) =>
    v == null || v === "" ? null : `LEGACY:${v}`,
  ),
  softDecryptForTenant: vi.fn((_orgId: string, v: string | null) =>
    v == null ? null : v.replace(/^LEGACY:|^BOUND:[^:]+:[^:]+:/, ""),
  ),
  decryptForTenant: vi.fn((_orgId: string, v: string) =>
    v.replace(/^LEGACY:|^BOUND:[^:]+:[^:]+:/, ""),
  ),
  encryptForTenantBound: vi.fn(
    (_orgId: string, table: string, column: string, v: string) =>
      `BOUND:${table}:${column}:${v}`,
  ),
  encryptForTenantBoundOrNull: vi.fn(
    (_orgId: string, table: string, column: string, v: string | null) =>
      v == null || v === "" ? null : `BOUND:${table}:${column}:${v}`,
  ),
  softDecryptForTenantBound: vi.fn(
    (
      _orgId: string,
      _table: string,
      _column: string,
      v: string | null,
    ) => (v == null ? null : v.replace(/^BOUND:[^:]+:[^:]+:|^LEGACY:/, "")),
  ),
  blindIndexForTenant: vi.fn(
    (_orgId: string, v: string | null) =>
      v == null || v === "" ? null : `bi:${v}`,
  ),
  normalizeForBlindIndex: vi.fn((v: string) => v.toLowerCase().trim()),
}))

function makeReq(url: string, method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("Phase 7 slice-3 — grants POST uses column-bound AAD on narrative", () => {
  it("narrative encrypted via bound OrNull with (public_sector_grants, narrative) tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorGrant.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "g-1", ...args.data, status: "submitted", submittedAt: new Date(), createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/public-sector-grants/route")
    const res = await POST(
      makeReq("/api/v1/public-sector-grants", "POST", {
        grantNumber: "GR-1",
        programSlug: "rental",
        requestedAmount: "1500.00",
        currency: "USD",
        narrative: "Family of four facing eviction; landlord notice attached.",
      }),
    )
    expect(res.status).toBe(201)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "public_sector_grants",
      "narrative",
      "Family of four facing eviction; landlord notice attached.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — grants PATCH side-exit gates use column-bound AAD", () => {
  it("withdrawn transition encrypts terminationReason bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorGrant.findFirst).mockResolvedValue({
      id: "g-1",
      organizationId: ORG,
      grantNumber: "GR-1",
      programSlug: "rental",
      status: "submitted",
      citizenId: null,
      caseId: null,
      assignedOfficialId: null,
      requestedAmount: "1500",
      approvedAmount: null,
      disbursedAmount: { toString: () => "0" },
      currency: "USD",
      submittedAt: new Date(),
      reviewStartedAt: null,
      approvedAt: null,
      disbursingStartedAt: null,
      disbursedAt: null,
      deniedAt: null,
      withdrawnAt: null,
      cancelledAt: null,
      decisionRationale: null,
      terminationReason: null,
      narrative: null,
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.publicSectorGrant.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "g-1",
          status: args.data.status,
          terminationReason: args.data.terminationReason ?? null,
          withdrawnAt: args.data.withdrawnAt ?? null,
          decisionRationale: null,
          narrative: null,
          grantNumber: "GR-1",
          programSlug: "rental",
          citizenId: null,
          caseId: null,
          assignedOfficialId: null,
          requestedAmount: "1500",
          approvedAmount: null,
          disbursedAmount: "0",
          currency: "USD",
          submittedAt: new Date(),
          reviewStartedAt: null,
          approvedAt: null,
          disbursingStartedAt: null,
          disbursedAt: null,
          deniedAt: null,
          cancelledAt: null,
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-grants/[id]/route"
    )
    const res = await PATCH(
      makeReq("/api/v1/public-sector-grants/g-1", "PATCH", {
        status: "withdrawn",
        terminationReason: "Applicant secured private funding.",
      }),
      { params: Promise.resolve({ id: "g-1" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "public_sector_grants",
      "terminationReason",
      "Applicant secured private funding.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — licenses PATCH side-exit gate uses column-bound AAD", () => {
  it("suspended transition encrypts decisionRationale bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorLicense.findFirst).mockResolvedValue({
      id: "l-1",
      organizationId: ORG,
      status: "issued",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000 * 365),
      reviewStartedAt: new Date(),
      expiredAt: null,
      suspendedAt: null,
      revokedAt: null,
      deniedAt: null,
      decisionRationale: null,
      licenseNumber: "LIC-1",
      licenseType: "business",
      citizenId: null,
      caseId: null,
      issuingOfficialId: null,
      appliedAt: new Date(),
      feeAmount: "0",
      feeCurrency: "USD",
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.publicSectorLicense.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "l-1",
          status: args.data.status,
          decisionRationale: args.data.decisionRationale ?? null,
          suspendedAt: args.data.suspendedAt ?? null,
          licenseNumber: "LIC-1",
          licenseType: "business",
          citizenId: null,
          caseId: null,
          issuingOfficialId: null,
          appliedAt: new Date(),
          reviewStartedAt: new Date(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400_000 * 365),
          expiredAt: null,
          revokedAt: null,
          deniedAt: null,
          feeAmount: "0",
          feeCurrency: "USD",
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-licenses/[id]/route"
    )
    const res = await PATCH(
      makeReq("/api/v1/public-sector-licenses/l-1", "PATCH", {
        status: "suspended",
        decisionRationale: "Health code violation — 30-day suspension.",
      }),
      { params: Promise.resolve({ id: "l-1" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "public_sector_licenses",
      "decisionRationale",
      "Health code violation — 30-day suspension.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})
