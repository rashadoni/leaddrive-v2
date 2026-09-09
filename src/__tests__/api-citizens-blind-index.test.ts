/**
 * Slice-3 blind-index integration tests for the citizens route.
 *
 * Verifies the new `fullNameBlindIndex` column wiring:
 *   • POST create writes the index alongside the encrypted name
 *   • PATCH update re-computes the index when fullName changes
 *   • GET list ?fullName= filters via the index (exact-match search)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    citizen: {
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

const ORG = "org-test-citizens"
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

describe("POST /api/v1/citizens — fullNameBlindIndex write", () => {
  it("computes and stores the blind index alongside the encrypted fullName", async () => {
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "c-1",
        citizenNumber: args.data.citizenNumber,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        status: "active",
        jurisdictionSlug: null,
        createdAt: new Date(),
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    const res = await POST(
      jsonReq("/api/v1/citizens", {
        citizenNumber: "CIT-001",
        fullName: "Jane Doe",
      }),
    )
    expect(res.status).toBe(201)

    const createCall = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    // The blind index is the deterministic HMAC over the normalized
    // plaintext — recompute it here and confirm the route wrote
    // the same value.
    const expectedHash = blindIndexForTenant(ORG, "Jane Doe")
    expect(createCall.data.fullNameBlindIndex).toBe(expectedHash)
    expect(createCall.data.fullNameBlindIndex).not.toBeNull()
  })

  it("blind-index is case-insensitive: 'JANE DOE' produces same hash as 'Jane Doe'", async () => {
    vi.mocked(prisma.citizen.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "c-2",
        citizenNumber: args.data.citizenNumber,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        status: "active",
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/citizens/route")
    await POST(
      jsonReq("/api/v1/citizens", {
        citizenNumber: "CIT-002",
        fullName: "JANE DOE",
      }),
    )
    const call = vi.mocked(prisma.citizen.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    // Same hash as the lowercase version
    expect(call.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "jane doe"),
    )
  })
})

describe("PATCH /api/v1/citizens/[id] — fullNameBlindIndex re-compute", () => {
  it("re-computes the blind index when fullName changes", async () => {
    vi.mocked(prisma.citizen.findFirst).mockResolvedValue({
      id: "c-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.citizen.update).mockResolvedValue({
      id: "c-1",
      fullName: "encrypted",
      fullNameBlindIndex: "hash",
    } as never)

    const { PATCH } = await import("@/app/api/v1/citizens/[id]/route")
    const res = await PATCH(
      jsonReq("/api/v1/citizens/c-1", { fullName: "John Smith" }, "PATCH"),
      { params: Promise.resolve({ id: "c-1" }) },
    )
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.citizen.update).mock.calls[0][0] as {
      data: { fullName?: unknown; fullNameBlindIndex?: string | null }
    }
    expect(updateCall.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "John Smith"),
    )
    expect(updateCall.data.fullName).toBeDefined()
  })

  it("does NOT touch fullNameBlindIndex when PATCH doesn't include fullName", async () => {
    vi.mocked(prisma.citizen.findFirst).mockResolvedValue({
      id: "c-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.citizen.update).mockResolvedValue({ id: "c-1" } as never)

    const { PATCH } = await import("@/app/api/v1/citizens/[id]/route")
    await PATCH(
      jsonReq("/api/v1/citizens/c-1", { email: "new@example.com" }, "PATCH"),
      { params: Promise.resolve({ id: "c-1" }) },
    )

    const updateCall = vi.mocked(prisma.citizen.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    // Email present, blind-index untouched
    expect(updateCall.data.email).toBe("new@example.com")
    expect("fullNameBlindIndex" in updateCall.data).toBe(false)
  })
})

describe("GET /api/v1/citizens — ?fullName= filter via blind index", () => {
  it("queries by fullNameBlindIndex when ?fullName= is supplied", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?fullName=Jane%20Doe"))

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]?.where as {
      fullNameBlindIndex?: string
    }
    expect(where.fullNameBlindIndex).toBe(blindIndexForTenant(ORG, "Jane Doe"))
  })

  it("treats whitespace-only ?fullName= as no-op", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?fullName=%20%20%20"))

    const where = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]?.where as {
      fullNameBlindIndex?: string
    }
    expect(where.fullNameBlindIndex).toBeUndefined()
  })

  it("?fullName= matches the same row regardless of caller-supplied case/whitespace", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])
    const { GET } = await import("@/app/api/v1/citizens/route")

    await GET(getReq("/api/v1/citizens?fullName=Jane%20Doe"))
    const where1 = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    vi.mocked(prisma.citizen.findMany).mockClear()

    await GET(getReq("/api/v1/citizens?fullName=%20%20JANE%20%20DOE%20%20"))
    const where2 = vi.mocked(prisma.citizen.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }

    // Both queries resolve to the same blind-index hash — same row hits.
    expect(where1.fullNameBlindIndex).toBe(where2.fullNameBlindIndex)
    expect(where1.fullNameBlindIndex).not.toBeUndefined()
  })

  it("audit metadata surfaces fullNameFilterHit when the filter is used", async () => {
    vi.mocked(prisma.citizen.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/citizens/route")
    await GET(getReq("/api/v1/citizens?fullName=Jane%20Doe"))

    const auditCall = vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    expect(auditCall).toBeDefined()
    const metadata = (auditCall![0] as { data: { metadata: Record<string, unknown> } })
      .data.metadata
    expect(metadata.fullNameFilterHit).toBe(true)
  })
})
