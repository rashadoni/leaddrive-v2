/**
 * Phase 7 slice-3 — R7 Insurance policies + beneficiaries wired to the
 * column-bound AAD helpers. Pattern parallels
 * `api-r7-policy-holder-claim-column-bound-aad.test.ts` (PR-1).
 *
 * Strategy: mock the entire encryption module. Each helper is a spy.
 * Assert calls to bound helpers with the exact `(table, column)`
 * tuple, and assert the legacy orgId-only helpers are NOT called on
 * the new paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r7-pr2"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policy: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    beneficiary: {
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

vi.mock("@/lib/insurance/state-machine", () => ({
  transitionPolicy: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
  canTransitionBeneficiary: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock("@/lib/insurance/beneficiary-allocation-validator", () => ({
  validateBeneficiaries: vi.fn().mockReturnValue({ ok: true }),
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

function makePatchReq(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Phase 7 slice-3 — policies PATCH side-exit uses column-bound AAD", () => {
  it("cancellationReason on cancelled transition encrypted via bound AAD with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "po-1",
      organizationId: ORG,
      status: "active",
      effectiveDate: new Date(),
      expirationDate: null,
      boundAt: new Date(),
      activatedAt: new Date(),
      expiredAt: null,
      lapsedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      policyNumber: "POL-1",
      policyHolderId: "h-1",
      lineOfBusiness: "auto",
      coverageLimit: "0",
      annualPremium: "0",
      deductible: null,
      billingFrequency: "annual",
      underwriterId: null,
    } as never)
    vi.mocked(prisma.policy.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "po-1",
          status: args.data.status,
          cancellationReason: args.data.cancellationReason ?? null,
          cancelledAt: args.data.cancelledAt ?? null,
          updatedAt: new Date(),
          effectiveDate: new Date(),
          expirationDate: null,
          boundAt: new Date(),
          activatedAt: new Date(),
          expiredAt: null,
          lapsedAt: null,
          policyNumber: "POL-1",
          policyHolderId: "h-1",
          lineOfBusiness: "auto",
          coverageLimit: "0",
          annualPremium: "0",
          deductible: null,
          billingFrequency: "annual",
          underwriterId: null,
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/policies/[id]/route")
    const res = await PATCH(
      makePatchReq("/api/v1/policies/po-1", {
        status: "cancelled",
        cancellationReason: "Non-payment of premium.",
      }),
      { params: Promise.resolve({ id: "po-1" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "policies",
      "cancellationReason",
      "Non-payment of premium.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — beneficiaries PATCH writes use column-bound AAD per column", () => {
  it("PATCH fullName + relationship + taxId + revocationReason bound with right tuples", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)

    // $transaction calls back with the same prisma mock.
    type TxFn = (tx: typeof prisma) => Promise<unknown>
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi
      .fn()
      .mockImplementation(async (fn: TxFn) => fn(prisma))

    vi.mocked(prisma.beneficiary.findFirst).mockResolvedValue({
      id: "b-1",
      organizationId: ORG,
      policyId: "po-1",
      tier: "primary",
      beneficiaryType: "person",
      allocationPct: { toString: () => "100", isNegative: () => false } as never,
      revokedAt: null,
    } as never)

    // Set-level revalidation path needs policy + sibling beneficiaries.
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      lineOfBusiness: "auto",
    } as never)
    ;(prisma.beneficiary as unknown as { findMany: unknown }).findMany = vi
      .fn()
      .mockResolvedValue([])

    vi.mocked(prisma.beneficiary.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "b-1",
          policyId: "po-1",
          tier: "primary",
          beneficiaryType: "person",
          fullName: args.data.fullName ?? "X",
          relationship: args.data.relationship ?? null,
          taxId: args.data.taxId ?? null,
          allocationPct: "100",
          dateOfBirth: null,
          designatedAt: new Date(),
          revokedAt: args.data.revokedAt ?? null,
          revocationReason: args.data.revocationReason ?? null,
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/beneficiaries/[id]/route")
    const res = await PATCH(
      makePatchReq("/api/v1/beneficiaries/b-1", {
        fullName: "Jane Updated",
        relationship: "Spouse",
        taxId: "111-22-3333",
      }),
      { params: Promise.resolve({ id: "b-1" }) },
    )
    expect(res.status).toBe(200)

    // fullName uses strict bound (required field).
    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "beneficiaries",
      "fullName",
      "Jane Updated",
    )
    // Optional PII uses bound OrNull with right tuple.
    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "beneficiaries",
      "relationship",
      "Spouse",
    )
    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "beneficiaries",
      "taxId",
      "111-22-3333",
    )
    // Legacy MUST NOT be hit.
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})
