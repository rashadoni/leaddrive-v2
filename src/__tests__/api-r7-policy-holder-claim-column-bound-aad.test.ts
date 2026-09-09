/**
 * Phase 7 slice-3 — R7 Insurance policy-holders + claims wired to the
 * column-bound AAD helpers (PR #136 sequel, follow-up after R2 Patient
 * pilot in `api-r2-patient-column-bound-aad.test.ts`).
 *
 * Strategy: mock the entire encryption module so each helper is a spy.
 * Assert calls to `encryptForTenantBound` / `encryptForTenantBoundOrNull`
 * / `softDecryptForTenantBound` with the exact (table, column) tuple,
 * and assert the legacy orgId-only helpers are NOT called on the new
 * paths.
 *
 * One real-crypto POST→GET round-trip case for policy-holders lives in
 * `api-pii-column-wrap.test.ts` (architect P1 from the R2 pilot) — this
 * file is structural / call-shape only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r7"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyHolder: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    claim: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/insurance/state-machine", () => ({
  canTransitionClaim: vi.fn().mockReturnValue({ ok: true }),
  transitionHolder: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
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

function makePostReq(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makePatchReq(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Phase 7 slice-3 — policy-holders POST uses column-bound AAD", () => {
  it("fullName via encryptForTenantBound + 4 mailing columns via OrNull bound (right table/column tuples)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.policyHolder.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "h-1", ...args.data, status: "prospect", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/policy-holders/route")
    const res = await POST(
      makePostReq("/api/v1/policy-holders", {
        holderNumber: "POL-1",
        fullName: "Jane Smith",
        taxId: "987-65-4321",
        mailingAddressLine1: "1 Microsoft Way",
        mailingCity: "Redmond",
        mailingPostalCode: "98052",
        mailingCountry: "USA",
      }),
    )
    expect(res.status).toBe(201)

    // Required fullName goes through strict bound encrypt.
    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "policy_holders",
      "fullName",
      "Jane Smith",
    )

    // Optional PII columns go through bound OrNull with the right tuple.
    for (const column of [
      "taxId",
      "mailingAddressLine1",
      "mailingCity",
      "mailingPostalCode",
      "mailingCountry",
    ]) {
      expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
        ORG,
        "policy_holders",
        column,
        expect.any(String),
      )
    }

    // Legacy orgId-only helpers must NOT be used on this PII path.
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })

  it("GET [id] uses softDecryptForTenantBound across all 6 PII columns with right tuples", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.policyHolder.findFirst).mockResolvedValue({
      id: "h-1",
      organizationId: ORG,
      holderNumber: "POL-1",
      fullName: "BOUND:policy_holders:fullName:Jane",
      taxId: "BOUND:policy_holders:taxId:555-00-0000",
      mailingAddressLine1: "BOUND:policy_holders:mailingAddressLine1:1 Test Ln",
      mailingCity: "BOUND:policy_holders:mailingCity:Boston",
      mailingPostalCode: "BOUND:policy_holders:mailingPostalCode:02101",
      mailingCountry: "BOUND:policy_holders:mailingCountry:USA",
      email: null,
      phone: null,
      dateOfBirth: null,
      status: "active",
      activatedAt: new Date(),
      deactivatedAt: null,
      deceasedAt: null,
      occupationSlug: null,
      contactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      fullNameBlindIndex: null,
      taxIdBlindIndex: null,
    } as never)

    const { GET } = await import("@/app/api/v1/policy-holders/[id]/route")
    const res = await GET(
      new NextRequest("http://localhost/api/v1/policy-holders/h-1"),
      { params: Promise.resolve({ id: "h-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.holder.fullName).toBe("Jane")
    expect(body.holder.taxId).toBe("555-00-0000")
    expect(body.holder.mailingAddressLine1).toBe("1 Test Ln")

    // Every PII column hit the bound soft-decrypt with the right tuple.
    for (const column of [
      "fullName",
      "taxId",
      "mailingAddressLine1",
      "mailingCity",
      "mailingPostalCode",
      "mailingCountry",
    ]) {
      expect(enc.softDecryptForTenantBound).toHaveBeenCalledWith(
        ORG,
        "policy_holders",
        column,
        expect.any(String),
      )
    }

    expect(enc.softDecryptForTenant).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — claims PATCH side-exit gate uses column-bound AAD", () => {
  it("decisionRationale on denied transition encrypted via bound AAD with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.claim.findFirst).mockResolvedValue({
      id: "cl-1",
      organizationId: ORG,
      policyId: "po-1",
      status: "under_review",
      lossDate: new Date("2026-01-01"),
      adjusterId: "adj-1",
      reviewStartedAt: new Date(),
      approvedAt: null,
      settledAt: null,
      deniedAt: null,
      closedNoActionAt: null,
      decisionRationale: null,
      description: null,
      severity: "minor",
      lossType: "auto",
      claimNumber: "CLM-1",
      fraudFlag: false,
      initialReserveAmount: "0",
      currentReserveAmount: "0",
      paidAmount: "0",
      reportedAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.claim.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "cl-1",
          status: args.data.status,
          decisionRationale: args.data.decisionRationale ?? null,
          description: null,
          deniedAt: args.data.deniedAt ?? null,
          closedNoActionAt: null,
          settledAt: null,
          approvedAt: null,
          reviewStartedAt: new Date(),
          reportedAt: new Date(),
          lossDate: new Date("2026-01-01"),
          lossType: "auto",
          severity: "minor",
          claimNumber: "CLM-1",
          policyId: "po-1",
          adjusterId: "adj-1",
          fraudFlag: false,
          initialReserveAmount: "0",
          currentReserveAmount: "0",
          paidAmount: "0",
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/claims/[id]/route")
    const res = await PATCH(
      makePatchReq("/api/v1/claims/cl-1", {
        status: "denied",
        decisionRationale: "Fraud — referred to SIU.",
      }),
      { params: Promise.resolve({ id: "cl-1" }) },
    )
    expect(res.status).toBe(200)

    // Side-exit gate must bind AAD to the right column.
    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "claims",
      "decisionRationale",
      "Fraud — referred to SIU.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})
