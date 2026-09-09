/**
 * Route-layer integration tests for the slice-2 PII column-wrap
 * (PRs #118-#133).
 *
 * Purpose: catch exactly the bug class the architect found in PR #127
 * — a route handler writing plaintext into an encrypted column. The
 * tests check that:
 *   1. POST encrypts (data passed to prisma.create is NOT the plaintext).
 *   2. GET / response paths decrypt (response field contains plaintext).
 *   3. PATCH side-exit gates (cancellationReason / decisionRationale /
 *      withdrawalReason / terminationReason / revocationReason) all
 *      encrypt before persisting.
 *
 * Strategy: mock `prisma.<entity>.create / findFirst / update`. The
 * route invokes encryptForTenant(orgId, value) on the way in; the
 * mock receives ciphertext as `data.<field>`. We assert ciphertext
 * != plaintext (cheap proof of encryption) and assert that
 * softDecryptForTenant round-trips back to plaintext.
 *
 * One test per high-leverage encrypted column per entity. Smoke
 * coverage, not exhaustive — slice-3 follow-up adds happy-path +
 * sad-path test pairs per route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Test KEK setup ─────────────────────────────────────────────────
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
})

// ── Prisma + auth mocks ────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthPatient: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    policyHolder: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    citizen: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    healthEncounter: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    healthProvider: {
      findFirst: vi.fn(),
    },
    publicSectorCase: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    publicSectorOfficial: {
      findFirst: vi.fn(),
    },
    claim: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    insuranceServiceTeamMember: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    healthCarePlan: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    healthMedicalRecord: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    beneficiary: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    publicSectorLicense: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    publicSectorGrant: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    mediaSubscriber: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    utilityCustomer: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    serviceCall: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    outage: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    meteringPoint: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (v: unknown) =>
    v !== null && typeof v === "object" && "status" in (v as object),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordPhiAccessFromRequest: vi.fn(),
  recordPiiAccessFromRequest: vi.fn(),
  recordFoiaAccessFromRequest: vi.fn(),
}))

const ORG = "org-test-pii-wrap"

function makePostReq(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function makePatchReq(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe("PII column wrap — POST encrypts on write", () => {
  it("health-patients: fullName + taxId + addressLine1 are encrypted before prisma.create", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to column-bound AAD
    // (encryptForTenantBound). Round-trip now goes through the bound
    // soft-decrypt — the legacy `softDecryptForTenant` won't decrypt
    // bound-AAD ciphertext because the AAD it sets (orgId only)
    // doesn't match what the route used (orgId + table + column).
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "p-1",
        mrn: args.data.mrn,
        fullName: args.data.fullName,
        status: "active",
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    const req = makePostReq("/api/v1/health-patients", {
      mrn: "MRN-001",
      fullName: "John Doe",
      taxId: "123-45-6789",
      addressLine1: "742 Evergreen Terrace",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    // Inspect what the route handed to prisma.create.
    const createCall = vi.mocked(prisma.healthPatient.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persistedFullName = createCall.data.fullName as string
    const persistedTaxId = createCall.data.taxId as string
    const persistedAddr = createCall.data.addressLine1 as string

    // Each persisted value must NOT equal the plaintext input.
    expect(persistedFullName).not.toBe("John Doe")
    expect(persistedTaxId).not.toBe("123-45-6789")
    expect(persistedAddr).not.toBe("742 Evergreen Terrace")

    // And must round-trip via bound soft-decrypt back to the original.
    expect(
      softDecryptForTenantBound(ORG, "health_patients", "fullName", persistedFullName),
    ).toBe("John Doe")
    expect(
      softDecryptForTenantBound(ORG, "health_patients", "taxId", persistedTaxId),
    ).toBe("123-45-6789")
    expect(
      softDecryptForTenantBound(
        ORG,
        "health_patients",
        "addressLine1",
        persistedAddr,
      ),
    ).toBe("742 Evergreen Terrace")
  })

  it("policy-holders: fullName + taxId + mailingAddressLine1 are encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD; round-trip uses
    // softDecryptForTenantBound with the (table, column) tuple.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.policyHolder.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "h-1",
        holderNumber: args.data.holderNumber,
        fullName: args.data.fullName,
        status: "prospect",
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/policy-holders/route")
    const req = makePostReq("/api/v1/policy-holders", {
      holderNumber: "POL-001",
      fullName: "Jane Smith",
      taxId: "987-65-4321",
      mailingAddressLine1: "1 Microsoft Way",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.policyHolder.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenantBound(
        ORG,
        "policy_holders",
        "fullName",
        createCall.data.fullName as string,
      ),
    ).toBe("Jane Smith")
    expect(
      softDecryptForTenantBound(
        ORG,
        "policy_holders",
        "taxId",
        createCall.data.taxId as string,
      ),
    ).toBe("987-65-4321")
    expect(
      softDecryptForTenantBound(
        ORG,
        "policy_holders",
        "mailingAddressLine1",
        createCall.data.mailingAddressLine1 as string,
      ),
    ).toBe("1 Microsoft Way")
  })

  it("citizens: fullName + taxId encrypted via FOIA audit pathway", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "c-1",
        citizenNumber: args.data.citizenNumber,
        fullName: args.data.fullName,
        status: "active",
        jurisdictionSlug: null,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    const req = makePostReq("/api/v1/citizens", {
      citizenNumber: "CIT-001",
      fullName: "Acme Citizen",
      taxId: "SSN-ALPHA",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(
      softDecryptForTenantBound(ORG, "citizens", "fullName", createCall.data.fullName as string),
    ).toBe("Acme Citizen")
    expect(
      softDecryptForTenantBound(ORG, "citizens", "taxId", createCall.data.taxId as string),
    ).toBe("SSN-ALPHA")
  })
})

describe("PII column wrap — PATCH side-exit gates encrypt", () => {
  it("R7 claims: decisionRationale on denied transition is encrypted (regression for PR #127 fix)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD — round-trip uses
    // softDecryptForTenantBound with the (table, column) tuple.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.claim.findFirst).mockResolvedValue({
      id: "cl-1",
      status: "under_review",
      lossDate: new Date("2026-01-01"),
      adjusterId: "adj-1",
      reviewStartedAt: new Date(),
      approvedAt: null,
      settledAt: null,
      deniedAt: null,
      closedNoActionAt: null,
      decisionRationale: null,
    } as never)
    vi.mocked(prisma.claim.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "cl-1",
        claimNumber: "CLM-001",
        policyId: "po-1",
        lossType: "auto",
        severity: "minor",
        status: args.data.status,
        lossDate: new Date("2026-01-01"),
        reportedAt: new Date(),
        initialReserveAmount: "0",
        currentReserveAmount: "0",
        paidAmount: "0",
        adjusterId: "adj-1",
        fraudFlag: false,
        reviewStartedAt: new Date(),
        approvedAt: null,
        settledAt: null,
        deniedAt: args.data.deniedAt ?? null,
        closedNoActionAt: null,
        decisionRationale: args.data.decisionRationale ?? null,
        description: null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/claims/[id]/route")
    const req = makePatchReq("/api/v1/claims/cl-1", {
      status: "denied",
      decisionRationale: "Fraud suspected — referred to SIU.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "cl-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.claim.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    const persisted = updateCall.data.decisionRationale as string

    // Persisted value MUST be ciphertext — not plaintext.
    expect(persisted).not.toBe("Fraud suspected — referred to SIU.")
    // And bound soft-decrypt rounds back to plaintext.
    expect(
      softDecryptForTenantBound(ORG, "claims", "decisionRationale", persisted),
    ).toBe("Fraud suspected — referred to SIU.")
  })

  it("R7 policies: cancellationReason on cancelled transition is encrypted (regression for PR #132 fix)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD — round-trip uses
    // softDecryptForTenantBound with the (table, column) tuple.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      id: "po-1",
      status: "active",
      effectiveDate: new Date(),
      expirationDate: null,
      boundAt: new Date(),
      activatedAt: new Date(),
      expiredAt: null,
      lapsedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    } as never)
    vi.mocked(prisma.policy.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "po-1",
        policyNumber: "POL-001",
        policyHolderId: "h-1",
        lineOfBusiness: "auto",
        status: args.data.status,
        coverageLimit: "0",
        annualPremium: "0",
        deductible: null,
        billingFrequency: "annual",
        effectiveDate: new Date(),
        expirationDate: null,
        underwriterId: null,
        boundAt: new Date(),
        activatedAt: new Date(),
        expiredAt: null,
        lapsedAt: null,
        cancelledAt: args.data.cancelledAt ?? null,
        cancellationReason: args.data.cancellationReason ?? null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/policies/[id]/route")
    const req = makePatchReq("/api/v1/policies/po-1", {
      status: "cancelled",
      cancellationReason: "Non-payment of premium after grace period.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "po-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.policy.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    const persisted = updateCall.data.cancellationReason as string

    expect(persisted).not.toBe("Non-payment of premium after grace period.")
    expect(
      softDecryptForTenantBound(ORG, "policies", "cancellationReason", persisted),
    ).toBe("Non-payment of premium after grace period.")
  })

  it("R8 cases: decisionRationale on denied transition is encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorCase.findFirst).mockResolvedValue({
      id: "ca-1",
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
    } as never)
    vi.mocked(prisma.publicSectorOfficial.findFirst).mockResolvedValue({
      id: "off-1",
      authorityLevel: "supervisor",
    } as never)
    vi.mocked(prisma.publicSectorCase.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "ca-1",
        caseNumber: "CASE-001",
        citizenId: "c-1",
        caseType: "complaint",
        status: args.data.status,
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
        deniedAt: args.data.deniedAt ?? null,
        withdrawnAt: null,
        decisionRationale: args.data.decisionRationale ?? null,
        withdrawalReason: null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-cases/[id]/route"
    )
    const req = makePatchReq("/api/v1/public-sector-cases/ca-1", {
      status: "denied",
      decisionRationale: "Application does not meet eligibility criteria.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "ca-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.publicSectorCase.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.decisionRationale as string

    expect(persisted).not.toBe(
      "Application does not meet eligibility criteria.",
    )
    expect(
      softDecryptForTenantBound(ORG, "public_sector_cases", "decisionRationale", persisted),
    ).toBe("Application does not meet eligibility criteria.")
  })
})

describe("PII column wrap — GET response soft-decrypts ciphertext", () => {
  it("health-patients GET [id] returns plaintext fullName even though DB stores ciphertext", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const { encryptForTenant } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)

    // Pre-encrypt the values the way the wrap-PR's POST would have.
    const fullNameCipher = encryptForTenant(ORG, "Alice Wonderland")
    const taxIdCipher = encryptForTenant(ORG, "111-22-3333")

    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
      mrn: "MRN-001",
      fullName: fullNameCipher,
      taxId: taxIdCipher,
      email: null,
      phone: null,
      dateOfBirth: null,
      sexAtBirth: null,
      addressLine1: null,
      city: null,
      postalCode: null,
      country: null,
      insuranceCarrier: null,
      insurancePolicyId: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      status: "active",
      primaryProviderId: null,
      contactId: null,
      registeredAt: new Date(),
      dischargedAt: null,
      deceasedAt: null,
      metadata: {},
      userId: null,
      organizationId: ORG,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const { GET } = await import("@/app/api/v1/health-patients/[id]/route")
    const req = new NextRequest(
      new URL("http://localhost:3000/api/v1/health-patients/p-1"),
    )
    const res = await GET(req, {
      params: Promise.resolve({ id: "p-1" }),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { patient: Record<string, unknown> }
    // Response field must be plaintext — not ciphertext.
    expect(body.patient.fullName).toBe("Alice Wonderland")
    expect(body.patient.taxId).toBe("111-22-3333")
  })

  it("legacy plaintext rows (pre-wrap) come back unchanged from soft-decrypt", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)

    // Legacy row written before the column wrap landed — fullName
    // stored as plaintext. softDecrypt should return it as-is.
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-legacy",
      mrn: "MRN-LEGACY",
      fullName: "Bob Pre-Encryption",
      taxId: "555-44-3333",
      email: null,
      phone: null,
      dateOfBirth: null,
      sexAtBirth: null,
      addressLine1: null,
      city: null,
      postalCode: null,
      country: null,
      insuranceCarrier: null,
      insurancePolicyId: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      status: "active",
      primaryProviderId: null,
      contactId: null,
      registeredAt: new Date(),
      dischargedAt: null,
      deceasedAt: null,
      metadata: {},
      userId: null,
      organizationId: ORG,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const { GET } = await import("@/app/api/v1/health-patients/[id]/route")
    const req = new NextRequest(
      new URL("http://localhost:3000/api/v1/health-patients/p-legacy"),
    )
    const res = await GET(req, {
      params: Promise.resolve({ id: "p-legacy" }),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { patient: Record<string, unknown> }
    // Plaintext legacy row passes through unchanged.
    expect(body.patient.fullName).toBe("Bob Pre-Encryption")
    expect(body.patient.taxId).toBe("555-44-3333")
  })

  it("end-to-end POST→GET round-trip with REAL bound-AAD crypto (Phase 7 slice-3 sanity)", async () => {
    // Architect P1 from the R2 Patient pilot review (2026-05-29):
    // `api-r2-patient-column-bound-aad.test.ts` mocks the entire
    // encryption module, so call-shape is asserted but real crypto is
    // never exercised together with the route. This test runs a true
    // round-trip with the bound primitives — POST encrypts via the
    // real `encryptForTenantBound`, the captured ciphertext is fed
    // back into GET's findFirst mock, and GET decrypts via the real
    // `softDecryptForTenantBound`. If the (table, column) AAD tuple
    // is wrong on either side the GCM tag check fails and the test
    // throws.
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    // POST flow — capture the ciphertext the route writes.
    let captured: Record<string, unknown> | null = null
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => {
        captured = args.data
        return {
          id: "p-roundtrip",
          mrn: args.data.mrn,
          fullName: args.data.fullName,
          status: "active",
          createdAt: new Date(),
        } as never
      },
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    const postReq = makePostReq("/api/v1/health-patients", {
      mrn: "MRN-RT-001",
      fullName: "Erin Roundtrip",
      taxId: "999-88-7777",
      addressLine1: "1 Sanity Lane",
      city: "Realville",
    })
    const postRes = await POST(postReq)
    expect(postRes.status).toBe(201)
    expect(captured).not.toBeNull()
    // `expect().not.toBeNull()` doesn't narrow the type for TS; cast
    // through `unknown` so the strict-null check doesn't complain.
    const persisted = captured as unknown as Record<string, unknown>

    // Persisted values must be ciphertext (not the plaintext input).
    expect(persisted.fullName).not.toBe("Erin Roundtrip")
    expect(persisted.taxId).not.toBe("999-88-7777")
    expect(persisted.addressLine1).not.toBe("1 Sanity Lane")
    expect(persisted.city).not.toBe("Realville")

    // GET flow — return the exact ciphertext POST wrote.
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-roundtrip",
      mrn: "MRN-RT-001",
      fullName: persisted.fullName,
      taxId: persisted.taxId,
      addressLine1: persisted.addressLine1,
      city: persisted.city,
      email: null,
      phone: null,
      dateOfBirth: null,
      sexAtBirth: null,
      postalCode: null,
      country: null,
      insuranceCarrier: null,
      insurancePolicyId: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      status: "active",
      primaryProviderId: null,
      contactId: null,
      registeredAt: new Date(),
      dischargedAt: null,
      deceasedAt: null,
      metadata: {},
      userId: null,
      organizationId: ORG,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const { GET } = await import("@/app/api/v1/health-patients/[id]/route")
    const getReq = new NextRequest(
      new URL("http://localhost:3000/api/v1/health-patients/p-roundtrip"),
    )
    const getRes = await GET(getReq, {
      params: Promise.resolve({ id: "p-roundtrip" }),
    })
    expect(getRes.status).toBe(200)

    const body = (await getRes.json()) as { patient: Record<string, unknown> }
    // End-to-end round-trip: plaintext in -> ciphertext at rest -> plaintext out.
    expect(body.patient.fullName).toBe("Erin Roundtrip")
    expect(body.patient.taxId).toBe("999-88-7777")
    expect(body.patient.addressLine1).toBe("1 Sanity Lane")
    expect(body.patient.city).toBe("Realville")
  })
})

/* ─── Extended coverage: remaining entities (slice-3 follow-up #1) ── */

describe("PII column wrap — extended POST encryption coverage", () => {
  it("encounters: reason + location encrypted on POST", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const { softDecryptForTenant } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    // Tenant pre-check for patient + provider returns mock rows so
    // POST proceeds.
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
    } as never)
    vi.mocked(prisma.healthProvider.findFirst).mockResolvedValue({
      id: "pr-1",
    } as never)
    vi.mocked(prisma.healthEncounter.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "e-1",
        patientId: args.data.patientId,
        providerId: args.data.providerId,
        encounterType: args.data.encounterType,
        status: "scheduled",
        scheduledStartAt: args.data.scheduledStartAt,
        scheduledEndAt: args.data.scheduledEndAt,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-encounters/route")
    const req = makePostReq("/api/v1/health-encounters", {
      patientId: "p-1",
      providerId: "pr-1",
      scheduledStartAt: "2026-06-01T10:00:00Z",
      scheduledEndAt: "2026-06-01T10:30:00Z",
      reason: "chest pain follow-up",
      location: "Room 401",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.healthEncounter.create).mock
      .calls[0][0] as { data: Record<string, unknown> }

    expect(softDecryptForTenant(ORG, createCall.data.reason as string)).toBe(
      "chest pain follow-up",
    )
    expect(
      softDecryptForTenant(ORG, createCall.data.location as string),
    ).toBe("Room 401")
  })

  it("medical-records: clinicianNotes encrypted on POST (append-only)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const { softDecryptForTenant } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
    } as never)
    vi.mocked(prisma.healthMedicalRecord.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "mr-1",
        patientId: args.data.patientId,
        encounterId: null,
        recordedByProviderId: null,
        recordType: args.data.recordType,
        recordedAt: args.data.recordedAt,
        severity: "informational",
        sensitivity: "normal",
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-medical-records/route")
    const req = makePostReq("/api/v1/health-medical-records", {
      patientId: "p-1",
      recordType: "diagnosis",
      recordedAt: "2026-06-01T10:00:00Z",
      // diagnosis REQUIRED_KEYS: icd10Code, description, status
      details: {
        icd10Code: "I10",
        description: "Essential hypertension",
        status: "active",
      },
      clinicianNotes: "Patient reports persistent headaches.",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.healthMedicalRecord.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenant(ORG, createCall.data.clinicianNotes as string),
    ).toBe("Patient reports persistent headaches.")
  })

  it("media-subscribers: displayName encrypted on POST", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.mediaSubscriber.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        // Match the route's `select` shape — omit lifetimeRevenueCents
        // (BigInt) since route POST doesn't include it in select.
        id: "s-1",
        subscriberNumber: args.data.subscriberNumber,
        displayName: args.data.displayName,
        email: null,
        tierSlug: args.data.tierSlug,
        billingRegion: null,
        status: "trial",
        trialStartedAt: args.data.trialStartedAt,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/media-subscribers/route")
    const req = makePostReq("/api/v1/media-subscribers", {
      subscriberNumber: "SUB-001",
      displayName: "Charlie Subscriber",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.mediaSubscriber.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenantBound(ORG, "media_subscribers", "displayName", createCall.data.displayName as string),
    ).toBe("Charlie Subscriber")
  })

  it("utility-customers: accountHolderName + serviceCity encrypted on POST", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3 extras PR-1: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.utilityCustomer.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "uc-1",
        accountNumber: args.data.accountNumber,
        accountHolderName: args.data.accountHolderName,
        serviceCity: args.data.serviceCity,
        customerClass: args.data.customerClass,
        status: args.data.status,
        activatedAt: args.data.activatedAt,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/utility-customers/route")
    const req = makePostReq("/api/v1/utility-customers", {
      accountNumber: "UC-001",
      accountHolderName: "Diana Customer",
      serviceAddressLine1: "12 Energy Lane",
      serviceCity: "Springfield",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.utilityCustomer.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenantBound(ORG, "utility_customers", "accountHolderName", createCall.data.accountHolderName as string),
    ).toBe("Diana Customer")
    expect(
      softDecryptForTenantBound(ORG, "utility_customers", "serviceCity", createCall.data.serviceCity as string),
    ).toBe("Springfield")
  })

  it("public-sector-grants: narrative encrypted on POST", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorGrant.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "g-1",
        grantNumber: args.data.grantNumber,
        programSlug: args.data.programSlug,
        status: "submitted",
        citizenId: null,
        caseId: null,
        assignedOfficialId: null,
        requestedAmount: args.data.requestedAmount,
        currency: args.data.currency,
        submittedAt: new Date(),
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/public-sector-grants/route")
    const req = makePostReq("/api/v1/public-sector-grants", {
      grantNumber: "GR-001",
      programSlug: "rental-assistance",
      requestedAmount: "1500.00",
      narrative:
        "Family of four facing eviction; landlord notice attached.",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.publicSectorGrant.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenantBound(ORG, "public_sector_grants", "narrative", createCall.data.narrative as string),
    ).toBe("Family of four facing eviction; landlord notice attached.")
  })

  it("service-calls: subject + description encrypted on POST", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3 extras PR-1: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.serviceCall.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "sc-1",
        callNumber: args.data.callNumber,
        utilityCustomerId: null,
        meteringPointId: null,
        outageId: null,
        callType: args.data.callType,
        priority: args.data.priority,
        status: "received",
        subject: args.data.subject,
        scheduledAt: null,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/service-calls/route")
    const req = makePostReq("/api/v1/service-calls", {
      callNumber: "SC-001",
      callType: "outage_report",
      subject: "Power out at 14 Elm — affecting 6 homes",
      description: "Caller heard transformer pop ~14:30. No injuries.",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.serviceCall.create).mock
      .calls[0][0] as { data: Record<string, unknown> }
    expect(
      softDecryptForTenantBound(ORG, "service_calls", "subject", createCall.data.subject as string),
    ).toBe("Power out at 14 Elm — affecting 6 homes")
    expect(
      softDecryptForTenantBound(ORG, "service_calls", "description", createCall.data.description as string),
    ).toBe("Caller heard transformer pop ~14:30. No injuries.")
  })
})

describe("PII column wrap — PATCH side-exit cancellation gates encrypt", () => {
  it("R2 encounters: cancellationReason on cancelled is encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const { softDecryptForTenant } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthEncounter.findFirst).mockResolvedValue({
      id: "e-1",
      status: "scheduled",
      scheduledStartAt: new Date(),
      scheduledEndAt: new Date(Date.now() + 3600_000),
      checkedInAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      noShowAt: null,
    } as never)
    vi.mocked(prisma.healthEncounter.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "e-1",
        patientId: "p-1",
        providerId: "pr-1",
        encounterType: "in_person",
        status: args.data.status,
        scheduledStartAt: new Date(),
        scheduledEndAt: new Date(Date.now() + 3600_000),
        checkedInAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: args.data.cancelledAt ?? null,
        noShowAt: null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/health-encounters/[id]/route"
    )
    const req = makePatchReq("/api/v1/health-encounters/e-1", {
      status: "cancelled",
      cancellationReason: "Patient called to reschedule due to illness.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "e-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.healthEncounter.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.cancellationReason as string
    expect(persisted).not.toBe("Patient called to reschedule due to illness.")
    expect(softDecryptForTenant(ORG, persisted)).toBe(
      "Patient called to reschedule due to illness.",
    )
  })

  it("R2 care-plans: cancellationReason on cancelled is encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const { softDecryptForTenant } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthCarePlan.findFirst).mockResolvedValue({
      id: "cp-1",
      status: "active",
      startDate: new Date(),
      endDate: null,
      activatedAt: new Date(),
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
    } as never)
    vi.mocked(prisma.healthCarePlan.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "cp-1",
        patientId: "p-1",
        providerId: null,
        name: "Diabetes Mgmt",
        status: args.data.status,
        startDate: new Date(),
        endDate: null,
        activatedAt: new Date(),
        completedAt: null,
        cancelledAt: args.data.cancelledAt ?? null,
        cancellationReason: args.data.cancellationReason ?? null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/health-care-plans/[id]/route"
    )
    const req = makePatchReq("/api/v1/health-care-plans/cp-1", {
      status: "cancelled",
      cancellationReason: "Patient transferred to specialist clinic.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "cp-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.healthCarePlan.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.cancellationReason as string
    expect(persisted).not.toBe("Patient transferred to specialist clinic.")
    expect(softDecryptForTenant(ORG, persisted)).toBe(
      "Patient transferred to specialist clinic.",
    )
  })

  it("R8 grants: terminationReason on withdrawn is encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorGrant.findFirst).mockResolvedValue({
      id: "g-1",
      status: "submitted",
      approvedAmount: null,
      disbursedAmount: { toString: () => "0" },
      reviewStartedAt: null,
      approvedAt: null,
      disbursingStartedAt: null,
      disbursedAt: null,
      deniedAt: null,
      withdrawnAt: null,
      cancelledAt: null,
      decisionRationale: null,
      terminationReason: null,
    } as never)
    vi.mocked(prisma.publicSectorGrant.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "g-1",
        grantNumber: "GR-001",
        programSlug: "rental",
        status: args.data.status,
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
        withdrawnAt: args.data.withdrawnAt ?? null,
        cancelledAt: null,
        decisionRationale: null,
        terminationReason: args.data.terminationReason ?? null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-grants/[id]/route"
    )
    const req = makePatchReq("/api/v1/public-sector-grants/g-1", {
      status: "withdrawn",
      terminationReason: "Applicant secured private funding.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "g-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.publicSectorGrant.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.terminationReason as string
    expect(persisted).not.toBe("Applicant secured private funding.")
    expect(
      softDecryptForTenantBound(ORG, "public_sector_grants", "terminationReason", persisted),
    ).toBe("Applicant secured private funding.")
  })

  // Regression for PR #133 (beneficiaries.revocationReason).
  // Beneficiaries PATCH wraps writes in a SERIALIZABLE prisma.$transaction
  // for set-level allocation validation. We mock $transaction to run
  // the callback synchronously against the mocked prisma client.
  it("R7 beneficiaries: revocationReason is encrypted on PATCH (regression for PR #133)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)

    // Mock $transaction as a callback-invoker. The route calls
    // `prisma.$transaction(async (tx) => {...})`; the mock runs the
    // callback against the same `prisma` mock.
    type TxFn = (
      tx: typeof prisma,
    ) => Promise<{ beneficiary?: Record<string, unknown>; error?: string }>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(prisma as any).$transaction = vi
      .fn()
      .mockImplementation(async (fn: TxFn) => fn(prisma))

    // Beneficiary row that the route reads with `existing`.
    vi.mocked(prisma.beneficiary.findFirst).mockResolvedValue({
      id: "b-1",
      policyId: "po-1",
      tier: "primary",
      beneficiaryType: "person",
      allocationPct: { toString: () => "100", isNegative: () => false } as never,
      revokedAt: null,
    } as never)
    // Setting revokedAt triggers the set-level revalidation path,
    // which needs to fetch the parent policy (for lineOfBusiness) +
    // sibling beneficiaries (NOT the row under edit) — both must be
    // mocked or the route returns 404 "Parent policy not found".
    vi.mocked(prisma.policy.findFirst).mockResolvedValue({
      lineOfBusiness: "auto",
    } as never)
    // No siblings — the row under edit is the only beneficiary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(prisma.beneficiary as any).findMany = vi.fn().mockResolvedValue([])

    vi.mocked(prisma.beneficiary.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "b-1",
        policyId: "po-1",
        tier: "primary",
        beneficiaryType: "person",
        fullName: "X",
        relationship: null,
        allocationPct: "100",
        dateOfBirth: null,
        designatedAt: new Date(),
        revokedAt: args.data.revokedAt ?? null,
        revocationReason: args.data.revocationReason ?? null,
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/beneficiaries/[id]/route")
    const req = makePatchReq("/api/v1/beneficiaries/b-1", {
      revokedAt: "2026-06-01T12:00:00Z",
      revocationReason: "Beneficiary divorced from policy holder.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "b-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.beneficiary.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.revocationReason as string
    expect(persisted).not.toBe("Beneficiary divorced from policy holder.")
    expect(
      softDecryptForTenantBound(ORG, "beneficiaries", "revocationReason", persisted),
    ).toBe("Beneficiary divorced from policy holder.")
  })

  it("R8 licenses: decisionRationale on suspended is encrypted", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    // Phase 7 slice-3: route migrated to bound AAD.
    const { softDecryptForTenantBound } = await import(
      "@/lib/crypto/tenant-pii-encryption"
    )

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.publicSectorLicense.findFirst).mockResolvedValue({
      id: "l-1",
      status: "issued",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000 * 365),
      reviewStartedAt: new Date(),
      expiredAt: null,
      suspendedAt: null,
      revokedAt: null,
      deniedAt: null,
      decisionRationale: null,
    } as never)
    vi.mocked(prisma.publicSectorLicense.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "l-1",
        licenseNumber: "LIC-001",
        licenseType: "business",
        status: args.data.status,
        citizenId: null,
        caseId: null,
        issuingOfficialId: null,
        appliedAt: new Date(),
        reviewStartedAt: new Date(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000 * 365),
        expiredAt: null,
        suspendedAt: args.data.suspendedAt ?? null,
        revokedAt: null,
        deniedAt: null,
        decisionRationale: args.data.decisionRationale ?? null,
        feeAmount: "0",
        feeCurrency: "USD",
        updatedAt: new Date(),
      }) as never,
    )

    const { PATCH } = await import(
      "@/app/api/v1/public-sector-licenses/[id]/route"
    )
    const req = makePatchReq("/api/v1/public-sector-licenses/l-1", {
      status: "suspended",
      decisionRationale: "Health code violation — 30-day suspension.",
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "l-1" }),
    })
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.publicSectorLicense.update).mock
      .calls[0][0] as { data: Record<string, unknown> }
    const persisted = updateCall.data.decisionRationale as string
    expect(persisted).not.toBe(
      "Health code violation — 30-day suspension.",
    )
    expect(
      softDecryptForTenantBound(ORG, "public_sector_licenses", "decisionRationale", persisted),
    ).toBe("Health code violation — 30-day suspension.")
  })
})
