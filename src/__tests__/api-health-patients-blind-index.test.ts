/**
 * Slice-3 blind-index integration tests for the health-patients route.
 *
 * Mirrors `api-citizens-blind-index.test.ts` — same pipeline applied
 * to R2 health-patients.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthPatient: {
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

const ORG = "org-test-patients"
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

describe("POST /api/v1/health-patients — fullNameBlindIndex write", () => {
  it("stamps fullNameBlindIndex on create", async () => {
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "p-1",
        mrn: args.data.mrn,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        status: "active",
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    const res = await POST(
      jsonReq("/api/v1/health-patients", {
        mrn: "MRN-001",
        fullName: "Patient Zero",
      }),
    )
    expect(res.status).toBe(201)

    const call = vi.mocked(prisma.healthPatient.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    expect(call.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Patient Zero"),
    )
  })

  it("blind-index is case-insensitive: 'PATIENT ZERO' → same hash as 'Patient Zero'", async () => {
    vi.mocked(prisma.healthPatient.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "p-2",
        mrn: args.data.mrn,
        fullName: args.data.fullName,
        fullNameBlindIndex: args.data.fullNameBlindIndex,
        status: "active",
      }) as never,
    )

    const { POST } = await import("@/app/api/v1/health-patients/route")
    await POST(
      jsonReq("/api/v1/health-patients", {
        mrn: "MRN-002",
        fullName: "PATIENT ZERO",
      }),
    )
    const call = vi.mocked(prisma.healthPatient.create).mock.calls[0][0] as {
      data: { fullNameBlindIndex: string }
    }
    expect(call.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "patient zero"),
    )
  })
})

describe("PATCH /api/v1/health-patients/[id] — fullNameBlindIndex re-compute", () => {
  it("re-computes index when fullName changes", async () => {
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.healthPatient.update).mockResolvedValue({
      id: "p-1",
      fullName: "encrypted",
      fullNameBlindIndex: "hash",
    } as never)

    const { PATCH } = await import("@/app/api/v1/health-patients/[id]/route")
    const res = await PATCH(
      jsonReq("/api/v1/health-patients/p-1", { fullName: "New Name" }, "PATCH"),
      { params: Promise.resolve({ id: "p-1" }) },
    )
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.healthPatient.update).mock.calls[0][0] as {
      data: { fullName?: unknown; fullNameBlindIndex?: string | null }
    }
    expect(updateCall.data.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "New Name"),
    )
  })

  it("does NOT touch fullNameBlindIndex on email-only PATCH", async () => {
    vi.mocked(prisma.healthPatient.findFirst).mockResolvedValue({
      id: "p-1",
      organizationId: ORG,
      status: "active",
    } as never)
    vi.mocked(prisma.healthPatient.update).mockResolvedValue({ id: "p-1" } as never)

    const { PATCH } = await import("@/app/api/v1/health-patients/[id]/route")
    await PATCH(
      jsonReq("/api/v1/health-patients/p-1", { email: "new@example.com" }, "PATCH"),
      { params: Promise.resolve({ id: "p-1" }) },
    )

    const updateCall = vi.mocked(prisma.healthPatient.update).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect("fullNameBlindIndex" in updateCall.data).toBe(false)
  })
})

describe("GET /api/v1/health-patients — ?fullName= filter via blind index", () => {
  it("queries by fullNameBlindIndex when ?fullName= is supplied", async () => {
    vi.mocked(prisma.healthPatient.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/health-patients/route")
    await GET(getReq("/api/v1/health-patients?fullName=Patient%20Zero"))

    const where = vi.mocked(prisma.healthPatient.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG, "Patient Zero"),
    )
  })

  it("treats whitespace-only ?fullName= as no-op", async () => {
    vi.mocked(prisma.healthPatient.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/health-patients/route")
    await GET(getReq("/api/v1/health-patients?fullName=%20%20"))

    const where = vi.mocked(prisma.healthPatient.findMany).mock.calls[0][0]
      ?.where as { fullNameBlindIndex?: string }
    expect(where.fullNameBlindIndex).toBeUndefined()
  })

  it("audit metadata surfaces fullNameFilterHit", async () => {
    vi.mocked(prisma.healthPatient.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/v1/health-patients/route")
    await GET(getReq("/api/v1/health-patients?fullName=Patient%20Zero"))

    const auditCall = vi.mocked(prisma.complianceAuditLog.create).mock.calls[0]
    expect(auditCall).toBeDefined()
    const metadata = (auditCall![0] as { data: { metadata: Record<string, unknown> } })
      .data.metadata
    expect(metadata.fullNameFilterHit).toBe(true)
  })
})
