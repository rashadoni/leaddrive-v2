/**
 * Phase 7 slice-3 extras PR-2 — internal-users (PublicSectorOfficial +
 * HealthProvider + InsuranceServiceTeamMember) wired to column-bound
 * AAD helpers. Final sweep step — closes Phase 7 slice-3 column-bound
 * AAD migration across all sites.
 *
 * Pattern parallels R11 media-subscribers (single PII column `fullName`,
 * required → strict bound encrypt). Email intentionally NOT wrapped on
 * any of the 3 internal-user entities per slice-2 design (transactional
 * channel requirements). One spec covering all 3 entities since the
 * shape is identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-internal-users"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicSectorOfficial: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    healthProvider: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    insuranceServiceTeamMember: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordFoiaAccessFromRequest: vi.fn(),
  recordPhiAccessFromRequest: vi.fn(),
  recordPiiAccessFromRequest: vi.fn(),
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

function makeReq(url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("Phase 7 slice-3 extras PR-2 — internal-users POST uses column-bound AAD", () => {
  it("public-sector-officials: fullName via strict bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorOfficial.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "off-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/public-sector-officials/route")
    const res = await POST(
      makeReq("/api/v1/public-sector-officials", {
        fullName: "Inspector Olivia",
        email: "olivia@dept.gov",
        agencySlug: "hsa",
        role: "supervisor",
        authorityLevel: "supervisor",
      }),
    )
    expect(res.status).toBe(201)

    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "public_sector_officials",
      "fullName",
      "Inspector Olivia",
    )
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
  })

  it("health-providers: fullName via strict bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthProvider.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "prov-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-providers/route")
    const res = await POST(
      makeReq("/api/v1/health-providers", {
        fullName: "Dr. Patricia House",
        email: "patricia@clinic.org",
        role: "physician",
      }),
    )
    expect(res.status).toBe(201)

    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "health_providers",
      "fullName",
      "Dr. Patricia House",
    )
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
  })

  it("insurance-service-team-members: fullName via strict bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.insuranceServiceTeamMember.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "tm-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import(
      "@/app/api/v1/insurance-service-team-members/route"
    )
    const res = await POST(
      makeReq("/api/v1/insurance-service-team-members", {
        fullName: "Agent Alex",
        email: "alex@insurer.com",
        role: "claims_adjuster",
      }),
    )
    expect(res.status).toBe(201)

    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "insurance_service_team_members",
      "fullName",
      "Agent Alex",
    )
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
  })
})
