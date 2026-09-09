/**
 * Phase 7 slice-3 extras PR-1 — R6 Energy & Utilities utility-customers
 * + service-calls wired to column-bound AAD helpers. Pattern parallels
 * the vertical PRs (R7/R8/R11).
 *
 * Strategy: mock the entire encryption module so each helper is a spy.
 * Assert calls to bound helpers with `(table, column)` tuples, and
 * assert the legacy orgId-only helpers are NOT called on the new paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r6-extras"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    utilityCustomer: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    serviceCall: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/energy-utilities/state-machine", () => ({
  transitionCustomer: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
  transitionServiceCall: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordPiiAccessFromRequest: vi.fn(),
  recordPiiAccess: vi.fn(),
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

describe("Phase 7 slice-3 extras — utility-customers POST uses column-bound AAD", () => {
  it("3 required PII (strict bound) + 3 optional PII (OrNull bound) with right tuples", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.utilityCustomer.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({ id: "uc-1", ...args.data, status: "active", createdAt: new Date() }) as never,
    )

    const { POST } = await import("@/app/api/v1/utility-customers/route")
    const res = await POST(
      makeReq("/api/v1/utility-customers", "POST", {
        accountNumber: "UC-1",
        accountHolderName: "Diana Customer",
        serviceAddressLine1: "12 Energy Lane",
        serviceAddressLine2: "Apt 5",
        serviceCity: "Springfield",
        servicePostalCode: "01001",
        serviceCountry: "USA",
      }),
    )
    expect(res.status).toBe(201)

    // Required cols use strict bound encrypt.
    for (const col of ["accountHolderName", "serviceAddressLine1", "serviceCity"]) {
      expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
        ORG,
        "utility_customers",
        col,
        expect.any(String),
      )
    }
    // Optional cols use bound OrNull with right tuple.
    for (const col of ["serviceAddressLine2", "servicePostalCode", "serviceCountry"]) {
      expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
        ORG,
        "utility_customers",
        col,
        expect.any(String),
      )
    }

    // Legacy MUST NOT be called.
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 extras — service-calls PATCH side-exit gates use column-bound AAD", () => {
  it("resolved transition encrypts resolutionNotes bound with right tuple (architect-suggested coverage of 2nd gate)", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.serviceCall.findFirst).mockResolvedValue({
      id: "sc-2",
      organizationId: ORG,
      callNumber: "SC-2",
      utilityCustomerId: null,
      meteringPointId: null,
      outageId: null,
      callType: "outage_report",
      priority: "normal",
      status: "in_progress",
      subject: "Power out",
      description: null,
      queueSlug: null,
      assignedToUserId: null,
      scheduledAt: new Date(),
      cancellationReason: null,
      resolutionNotes: null,
      cancelledAt: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.serviceCall.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "sc-2",
          status: args.data.status,
          resolutionNotes: args.data.resolutionNotes ?? null,
          resolvedAt: args.data.resolvedAt ?? null,
          cancellationReason: null,
          cancelledAt: null,
          subject: "Power out",
          description: null,
          callNumber: "SC-2",
          utilityCustomerId: null,
          meteringPointId: null,
          outageId: null,
          callType: "outage_report",
          priority: "normal",
          queueSlug: null,
          assignedToUserId: null,
          scheduledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/service-calls/[id]/route")
    const res = await PATCH(
      makeReq("/api/v1/service-calls/sc-2", "PATCH", {
        status: "resolved",
        resolutionNotes: "Transformer replaced — service restored.",
      }),
      { params: Promise.resolve({ id: "sc-2" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "service_calls",
      "resolutionNotes",
      "Transformer replaced — service restored.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })

  it("cancelled transition encrypts cancellationReason bound with right tuple", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.serviceCall.findFirst).mockResolvedValue({
      id: "sc-1",
      organizationId: ORG,
      callNumber: "SC-1",
      utilityCustomerId: null,
      meteringPointId: null,
      outageId: null,
      callType: "outage_report",
      priority: "normal",
      status: "scheduled",
      subject: "Power out",
      description: null,
      queueSlug: null,
      assignedToUserId: null,
      scheduledAt: new Date(),
      cancellationReason: null,
      resolutionNotes: null,
      cancelledAt: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.serviceCall.update).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "sc-1",
          status: args.data.status,
          cancellationReason: args.data.cancellationReason ?? null,
          cancelledAt: args.data.cancelledAt ?? null,
          subject: "Power out",
          description: null,
          resolutionNotes: null,
          resolvedAt: null,
          callNumber: "SC-1",
          utilityCustomerId: null,
          meteringPointId: null,
          outageId: null,
          callType: "outage_report",
          priority: "normal",
          queueSlug: null,
          assignedToUserId: null,
          scheduledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as never,
    )

    const { PATCH } = await import("@/app/api/v1/service-calls/[id]/route")
    const res = await PATCH(
      makeReq("/api/v1/service-calls/sc-1", "PATCH", {
        status: "cancelled",
        cancellationReason: "Customer no longer needs visit.",
      }),
      { params: Promise.resolve({ id: "sc-1" }) },
    )
    expect(res.status).toBe(200)

    expect(enc.encryptForTenantBoundOrNull).toHaveBeenCalledWith(
      ORG,
      "service_calls",
      "cancellationReason",
      "Customer no longer needs visit.",
    )
    expect(enc.encryptForTenantOrNull).not.toHaveBeenCalled()
  })
})
