/**
 * Slice-3 blind-index integration tests for the policy-holders route.
 * Mirrors `api-citizens-blind-index.test.ts` for R7 policy-holders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyHolder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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

const ORG = "org-test-holders"
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

describe("POST /api/v1/policy-holders — fullNameBlindIndex write", () => {
  it("stamps fullNameBlindIndex on create", async () => {
    vi.mocked(prisma.policyHolder.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "h-1",
        holderNumber: args.data.holderNumber,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        status: "active",
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/policy-holders/route")
    const res = await POST(
      jsonReq("/api/v1/policy-holders", {
        holderNumber: "PH-001",
        fullName: "Insured Person",
      }),
    )
    expect(res.status).toBe(201)

    const call = vi.mocked(prisma.policyHolder.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    expect(call.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Insured Person"),
    )
  })
})

describe("PATCH /api/v1/policy-holders/[id] — fullNameBlindIndex re-compute", () => {
  it("re-computes index when fullName changes", async () => {
    vi.mocked(prisma.policyHolder.findFirst).mockResolvedValue({
      id: "h-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.policyHolder.update).mockResolvedValue({
      id: "h-1",
      fullName: "encrypted",
    } as never)

    const { PATCH } = await import("@/app/api/v1/policy-holders/[id]/route")
    const res = await PATCH(
      jsonReq("/api/v1/policy-holders/h-1", { fullName: "Renamed" }, "PATCH"),
      { params: Promise.resolve({ id: "h-1" }) },
    )
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.policyHolder.update).mock.calls[0][0] as {
      data: { fullNameBlindIndex?: string | null }
    }
    expect(updateCall.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Renamed"),
    )
  })

  it("does NOT touch fullNameBlindIndex on email-only PATCH", async () => {
    vi.mocked(prisma.policyHolder.findFirst).mockResolvedValue({
      id: "h-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.policyHolder.update).mockResolvedValue({ id: "h-1" } as never)

    const { PATCH } = await import("@/app/api/v1/policy-holders/[id]/route")
    await PATCH(
      jsonReq("/api/v1/policy-holders/h-1", { email: "new@example.com" }, "PATCH"),
      { params: Promise.resolve({ id: "h-1" }) },
    )

    const updateCall = vi.mocked(prisma.policyHolder.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect("fullNameBlindIndex" in updateCall.data).toBe(false)
  })
})

describe("GET /api/v1/policy-holders — ?fullName= filter via blind index", () => {
  it("queries by fullNameBlindIndex", async () => {
    vi.mocked(prisma.policyHolder.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/policy-holders/route")
    await GET(getReq("/api/v1/policy-holders?fullName=Insured%20Person"))

    const where = vi.mocked(prisma.policyHolder.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Insured Person"),
    )
  })

  it("audit metadata surfaces fullNameFilterHit", async () => {
    vi.mocked(prisma.policyHolder.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/policy-holders/route")
    await GET(getReq("/api/v1/policy-holders?fullName=Insured%20Person"))

    const auditCall = vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    const metadata = (auditCall![0] as { data: { metadata: Record<string, unknown> } })
      .data.metadata
    expect(metadata.fullNameFilterHit).toBe(true)
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
 * POST /api/v1/policy-holders — status field + coherence timestamps
 *
 * Regression for the bug where POST never wrote `status`, causing the schema
 * default "active" to fire and always violate policy_holders_active_coherence_check
 * (activatedAt IS NOT NULL required when status IN active | inactive | deceased).
 * ───────────────────────────────────────────────────────────────────────────── */
describe("POST /api/v1/policy-holders — status field + coherence timestamps", () => {
  function captureCreate() {
    vi.mocked(prisma.policyHolder.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "h-status",
          holderNumber: args.data.holderNumber,
          fullName: args.data.fullName,
          status: args.data.status,
          createdAt: new Date(),
        }) as never,
    )
  }

  it("defaults to prospect when status is omitted", async () => {
    captureCreate()
    const { POST } = await import("@/app/api/v1/policy-holders/route")
    const res = await POST(
      jsonReq("/api/v1/policy-holders", { holderNumber: "PH-S1", fullName: "No Status" }),
    )
    expect(res.status).toBe(201)
    const data = vi.mocked(prisma.policyHolder.create).mock.calls[0][0] as {
      data: { status: string; activatedAt: Date | null }
    }
    expect(data.data.status).toBe("prospect")
    expect(data.data.activatedAt).toBeNull()
  })

  it("defaults to prospect for an invalid status value", async () => {
    captureCreate()
    const { POST } = await import("@/app/api/v1/policy-holders/route")
    await POST(
      jsonReq("/api/v1/policy-holders", {
        holderNumber: "PH-S2",
        fullName: "Bad Status",
        status: "suspended", // not in HOLDER_STATUSES
      }),
    )
    const data = vi.mocked(prisma.policyHolder.create).mock.calls[0][0] as {
      data: { status: string; activatedAt: Date | null }
    }
    expect(data.data.status).toBe("prospect")
    expect(data.data.activatedAt).toBeNull()
  })

  it("sets activatedAt when status=active", async () => {
    captureCreate()
    const before = Date.now()
    const { POST } = await import("@/app/api/v1/policy-holders/route")
    await POST(
      jsonReq("/api/v1/policy-holders", {
        holderNumber: "PH-S3",
        fullName: "Active Holder",
        status: "active",
      }),
    )
    const data = vi.mocked(prisma.policyHolder.create).mock.calls[0][0] as {
      data: { status: string; activatedAt: Date | null; deactivatedAt: Date | null }
    }
    expect(data.data.status).toBe("active")
    expect(data.data.activatedAt).toBeInstanceOf(Date)
    expect(data.data.activatedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(data.data.deactivatedAt).toBeNull()
  })

  it("sets activatedAt + deceasedAt when status=deceased", async () => {
    captureCreate()
    const { POST } = await import("@/app/api/v1/policy-holders/route")
    await POST(
      jsonReq("/api/v1/policy-holders", {
        holderNumber: "PH-S4",
        fullName: "Deceased Holder",
        status: "deceased",
      }),
    )
    const data = vi.mocked(prisma.policyHolder.create).mock.calls[0][0] as {
      data: {
        status: string
        activatedAt: Date | null
        deactivatedAt: Date | null
        deceasedAt: Date | null
      }
    }
    expect(data.data.status).toBe("deceased")
    expect(data.data.activatedAt).toBeInstanceOf(Date)
    expect(data.data.deceasedAt).toBeInstanceOf(Date)
    expect(data.data.deactivatedAt).toBeNull()
  })
})
