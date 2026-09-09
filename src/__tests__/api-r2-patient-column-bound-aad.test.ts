/**
 * Phase 7 slice-3 — R2 Health Patient route is wired to the new
 * column-bound AAD helpers (PR #136 sequel).
 *
 * Slice-2 (PRs #118-#133) wrapped PII columns with `encryptForTenant`
 * / `encryptForTenantOrNull` — AAD = orgId only. That stops cross-
 * tenant ciphertext shuffle but NOT same-tenant cross-column shuffle
 * (e.g. copying `fullName` ciphertext into `taxId`). PR #136 shipped
 * the bound primitives (`encryptForTenantBound`, `decryptForTenantBound`,
 * `softDecryptForTenantBound`) but did NOT migrate the routes.
 *
 * This test pilots the migration on R2 Health Patient: the route MUST
 * now call the bound variants with the exact (table, column) tuple
 * matching the destination Prisma column, NOT the legacy orgId-only
 * helpers. Backward compat for legacy ciphertext is preserved by the
 * soft-decrypt fallback inside the helper itself.
 *
 * Strategy: mock the entire encryption module. Each helper becomes a
 * spy. Assert calls to `encryptForTenantBound("health_patients",
 * "fullName", "John Doe")` etc., and assert the legacy variants are
 * NOT called on the new paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r2"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  // resetModules wipes import cache but does NOT clear vi.fn() call
  // history (mocks are hoisted once per file). Clear explicitly so
  // each test's `toHaveBeenCalledWith` / `mock.calls[0]` reads only
  // this test's invocations.
  vi.clearAllMocks()
})

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthPatient: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    healthProvider: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

// Mock the entire encryption module so we can spy on every helper.
// Real implementations from `tenant-pii-encryption` are bypassed —
// the spies just label-and-return so we can observe call shape.
vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({
  // Legacy orgId-only AAD helpers (slice-2). The route MUST NOT
  // hit these on PII columns after the slice-3 swap.
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

  // New column-bound AAD helpers (slice-3). The route MUST hit
  // these on PII writes after the swap, with the correct
  // (table, column) tuple.
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

  // Blind-index helper — not part of the slice-3 sweep, pass-through.
  blindIndexForTenant: vi.fn(
    (_orgId: string, v: string | null) =>
      v == null || v === "" ? null : `bi:${v}`,
  ),
  normalizeForBlindIndex: vi.fn((v: string) => v.toLowerCase().trim()),
}))

function makePostReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/health-patients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const PII_COLUMNS = [
  "fullName",
  "sexAtBirth",
  "taxId",
  "addressLine1",
  "city",
  "postalCode",
  "country",
  "insuranceCarrier",
  "insurancePolicyId",
  "emergencyContactName",
  "emergencyContactPhone",
] as const

describe("Phase 7 slice-3 — Patient POST uses column-bound AAD", () => {
  it("encrypts fullName with bound helper, NOT the legacy orgId-only one", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "p-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    const res = await POST(
      makePostReq({
        mrn: "MRN-1",
        fullName: "John Doe",
        taxId: "123-45-6789",
        addressLine1: "742 Evergreen Terrace",
        city: "Springfield",
      }),
    )
    expect(res.status).toBe(201)

    // The non-null required column (`fullName`) must use the bound
    // variant with the (table, column) tuple matching the schema.
    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "health_patients",
      "fullName",
      "John Doe",
    )

    // Legacy orgId-only encrypt MUST NOT be called for `fullName`.
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
  })

  it("encrypts every optional PII column via encryptForTenantBoundOrNull with the right (table, column) tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "p-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    await POST(
      makePostReq({
        mrn: "MRN-2",
        fullName: "Jane Smith",
        sexAtBirth: "F",
        taxId: "987-65-4321",
        addressLine1: "1 Oak St",
        city: "Boston",
        postalCode: "02101",
        country: "USA",
        insuranceCarrier: "BlueCross",
        insurancePolicyId: "BC-555",
        emergencyContactName: "Bob Smith",
        emergencyContactPhone: "+15551234567",
      }),
    )

    // Every optional PII column except `fullName` (which is required +
    // uses the strict bound variant above) must hit the OrNull bound
    // helper with the correct column key.
    const optionalColumns = PII_COLUMNS.filter((c) => c !== "fullName")
    for (const column of optionalColumns) {
      expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
        ORG,
        "health_patients",
        column,
        expect.any(String),
      )
    }
    // Legacy nullable wrapper MUST NOT be hit for these columns.
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })

  it("writes the bound ciphertext to prisma.create (sanity proof of end-to-end persistence)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "p-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    await POST(
      makePostReq({
        mrn: "MRN-3",
        fullName: "Carol Tester",
        taxId: "555-00-0000",
      }),
    )

    const createCall = vi.mocked(prisma.healthPatient.create).mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    // The mock encryptForTenantBound prefixes with "BOUND:<table>:<column>:".
    // After the swap the persisted ciphertext MUST carry that prefix —
    // i.e. the route is asking for AAD bound to the specific column.
    expect(createCall.data.fullName).toBe(
      "BOUND:health_patients:fullName:Carol Tester",
    )
    expect(createCall.data.taxId).toBe(
      "BOUND:health_patients:taxId:555-00-0000",
    )
  })
})

describe("Phase 7 slice-3 — Patient GET decrypts via column-bound soft helper", () => {
  it("GET [id] uses softDecryptForTenantBound with the right (table, column) tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)

    // Mock a stored row whose PII columns carry the bound-prefix
    // ciphertext, as if a freshly-written row landed in the DB.
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
      organizationId: ORG,
      mrn: "MRN-9",
      fullName: "BOUND:health_patients:fullName:Dana",
      sexAtBirth: null,
      taxId: "BOUND:health_patients:taxId:111-22-3333",
      addressLine1: null,
      city: null,
      postalCode: null,
      country: null,
      insuranceCarrier: null,
      insurancePolicyId: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      dateOfBirth: null,
      status: "active",
      contactId: null,
      userId: null,
      primaryProviderId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      fullNameBlindIndex: null,
      taxIdBlindIndex: null,
    } as never)

    const { GET } = await import("@/app/api/v1/health-patients/[id]/route")
    const res = await GET(
      new NextRequest("http://localhost/api/v1/health-patients/p-1"),
      { params: Promise.resolve({ id: "p-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patient.fullName).toBe("Dana")
    expect(body.patient.taxId).toBe("111-22-3333")

    // Read-side: bound soft-decrypt must be the one called.
    expect(enc.softDecryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "health_patients",
      "fullName",
      "BOUND:health_patients:fullName:Dana",
    )
    expect(enc.softDecryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "health_patients",
      "taxId",
      "BOUND:health_patients:taxId:111-22-3333",
    )
    // Legacy soft-decrypt MUST NOT be called on these columns.
    expect(enc.softDecryptForTenant).not.toHaveBeenCalled()
  })
})
