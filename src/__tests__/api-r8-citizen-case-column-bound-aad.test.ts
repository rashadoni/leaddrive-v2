/**
 * Phase 7 slice-3 — R8 Public Sector citizens + public-sector-cases
 * wired to the column-bound AAD helpers. Pattern parallels the R7 PR-1
 * + PR-2 tests.
 *
 * Strategy: mock the entire encryption module so each helper is a spy.
 * Assert calls to bound helpers with the exact `(table, column)`
 * tuple, and assert the legacy orgId-only helpers are NOT called on
 * the new paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r8"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    citizen: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    publicSectorCase: {
      create: vi.fn(),
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
  transitionCitizen: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
  canTransitionCase: vi.fn().mockReturnValue({ ok: true }),
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

const CITIZEN_PII = [
  "fullName",
  "taxId",
  "addressLine1",
  "addressLine2",
  "city",
  "stateProvince",
  "postalCode",
  "country",
] as const

describe("Phase 7 slice-3 — citizens POST uses column-bound AAD", () => {
  it("encrypts fullName via bound + 7 optional PII columns via OrNull bound (right tuples)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "c-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    const res = await POST(
      makeReq("/api/v1/citizens", "POST", {
        citizenNumber: "CIT-1",
        fullName: "Carol Citizen",
        taxId: "AAA-BBB-CCC",
        addressLine1: "100 Federal Plaza",
        addressLine2: "Suite 200",
        city: "Springfield",
        stateProvince: "IL",
        postalCode: "62701",
        country: "USA",
      }),
    )
    expect(res.status).toBe(201)

    // Required fullName uses strict bound encrypt.
    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "citizens",
      "fullName",
      "Carol Citizen",
    )

    // Every other PII column uses bound OrNull with the right column key.
    const optional = CITIZEN_PII.filter((c) => c !== "fullName")
    for (const column of optional) {
      expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
        ORG,
        "citizens",
        column,
        expect.any(String),
      )
    }

    // Legacy NOT called on these paths.
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })

  it("GET [id] uses softDecryptForTenantBound for all 8 PII columns (right tuples)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    // All 8 PII columns populated with non-null ciphertext so every
    // soft-decrypt call fires. Using `expect.anything()` doesn't match
    // null (vitest quirk), so we need real values to exercise the
    // (table, column) tuple assertion across all 8 columns.
    vi.mocked(prisma.citizen.findFirst).mockResolvedValue({
      id: "c-1",
      organizationId: ORG,
      citizenNumber: "CIT-1",
      fullName: "BOUND:citizens:fullName:Carol",
      taxId: "BOUND:citizens:taxId:111-22-3333",
      addressLine1: "BOUND:citizens:addressLine1:100 Plaza",
      addressLine2: "BOUND:citizens:addressLine2:Apt 4B",
      city: "BOUND:citizens:city:Springfield",
      stateProvince: "BOUND:citizens:stateProvince:IL",
      postalCode: "BOUND:citizens:postalCode:62701",
      country: "BOUND:citizens:country:USA",
      email: null,
      phone: null,
      dateOfBirth: null,
      jurisdictionSlug: null,
      contactId: null,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      fullNameBlindIndex: null,
      taxIdBlindIndex: null,
    } as never)

    const { GET } = await import("@/app/api/v1/citizens/[id]/route")
    const res = await GET(
      new NextRequest("http://localhost/api/v1/citizens/c-1"),
      { params: Promise.resolve({ id: "c-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.citizen.fullName).toBe("Carol")
    expect(body.citizen.taxId).toBe("111-22-3333")
    expect(body.citizen.country).toBe("USA")

    for (const column of CITIZEN_PII) {
      expect(enc.softDecryptForTenantBound).toHaveBeenCalledWith(
        ORG,
        "citizens",
        column,
        expect.any(String),
      )
    }

    expect(enc.softDecryptForTenant).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — public-sector-cases PATCH side-exit gates use column-bound AAD", () => {
  it("denied transition encrypts decisionRationale via bound OrNull (right tuple)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorCase.findFirst).mockResolvedValue({
      id: "ca-1",
      organizationId: ORG,
      citizenId: "c-1",
      status: "in_progress",
      assignedOfficialId: "off-1",
      intakeStartedAt: new Date(),
      assignedAt: new Date(),
      workStartedAt: new Date(),
      escalatedAt: null,
      resolvedAt: null,
      deniedAt: null,
      withdrawnAt: null,
      decisionRationale: null,
      withdrawalReason: null,
      description: null,
      caseNumber: "CASE-1",
      caseType: "complaint",
      priority: "routine",
      agencySlug: "hsa",
      departmentSlug: null,
      subject: "Subj",
      statutoryDueAt: null,
      submittedAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.publicSectorOfficial.findFirst).mockResolvedValue({
      id: "off-1",
      authorityLevel: "supervisor",
    } as never)
    vi.mocked(prisma.publicSectorCase.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "ca-1",
          status: args.data.status,
          decisionRationale: args.data.decisionRationale ?? null,
          withdrawalReason: null,
          deniedAt: args.data.deniedAt ?? null,
          withdrawnAt: null,
          description: null,
          caseNumber: "CASE-1",
          caseType: "complaint",
          citizenId: "c-1",
          priority: "routine",
          agencySlug: "hsa",
          departmentSlug: null,
          assignedOfficialId: "off-1",
          subject: "Subj",
          statutoryDueAt: null,
          submittedAt: new Date(),
          intakeStartedAt: new Date(),
          assignedAt: new Date(),
          workStartedAt: new Date(),
          escalatedAt: null,
          resolvedAt: null,
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-cases/[id]/route"
    )
    const res = await PATCH(
      makeReq("/api/v1/public-sector-cases/ca-1", "PATCH", {
        status: "denied",
        decisionRationale: "Insufficient documentation.",
      }),
      { params: Promise.resolve({ id: "ca-1" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "public_sector_cases",
      "decisionRationale",
      "Insufficient documentation.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})
