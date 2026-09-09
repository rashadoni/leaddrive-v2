/**
 * CLM Slice 4a — API tests for:
 *   POST /api/v1/contracts/:id/amend
 *
 * Coverage:
 *   - Amend an active contract → creates ContractVersion(source="amendment",
 *     versionNo=max+1, isCanonicalSigned=false), updates Contract.renderedBody
 *   - Amend a draft/pending contract → 200 (early-stage body can be set in-UI)
 *   - Amend a terminal contract (terminated) → 409 (NOT_AMENDABLE)
 *   - Amend with optional changeNote → stored as version.note
 *   - Amend with optional title update → Contract.title updated
 *   - Missing renderedBody → 400
 *   - Contract not found / different org → 404
 *   - Org-scoped: request without session → 401
 *   - Read-only user → 403 (FIX D: requireAuth + write)
 *   - Module gate: 403 when contracts module disabled
 *   - Superadmin bypasses module gate
 *   - In-flight envelope → 409 ENVELOPE_IN_FLIGHT (FIX D)
 *   - In-tx CAS: concurrent terminal transition → 409 NOT_AMENDABLE (FIX E)
 *   - CAS versionNo: uses MAX(versionNo)+1
 *   - P2002 retry: succeeds on second attempt after unique collision
 *   - Contract.renderedBody updated to the amended text
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockContractFindFirst = vi.fn()
const mockVersionCreate = vi.fn()
const mockContractUpdateMany = vi.fn()
const mockEnvelopeCount = vi.fn()
const mockAuditCreate = vi.fn()
const mockTransaction = vi.fn()
const mockQueryRaw = vi.fn()
const mockOrgHasModule = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: (...args: unknown[]) => mockContractFindFirst(...args),
    },
    contractVersion: {
      create: (...args: unknown[]) => mockVersionCreate(...args),
    },
    esignEnvelope: {
      count: (...args: unknown[]) => mockEnvelopeCount(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => mockAuditCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (result: unknown) => result instanceof NextResponse,
  orgHasModule: (...args: unknown[]) => mockOrgHasModule(...args),
  moduleDisabledResponse: vi.fn(
    (moduleId: string) =>
      new NextResponse(JSON.stringify({ error: `Module ${moduleId} is not enabled` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { POST } from "@/app/api/v1/contracts/[id]/amend/route"
import { requireAuth } from "@/lib/api-auth"

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const USER_ID = "user-1"

const baseContract = {
  id: CONTRACT_ID,
  organizationId: ORG_ID,
  title: "Service Agreement v1",
  status: "active",
}

const amendedBody = "This is the amended contract body with new payment terms."
const EXISTING_MAX_VERSION = 2

// ─── Request helpers ──────────────────────────────────────────────────────────

function makePOSTReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/amend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function makeRouteParams(id: string = CONTRACT_ID) {
  return { params: Promise.resolve({ id }) }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

type TestRole = "superadmin" | "admin" | "manager" | "sales" | "support" | "viewer"

/** Returns a mock AuthResult (non-error) for requireAuth */
function makeAuthResult(overrides: Partial<{ orgId: string; userId: string; role: TestRole }> = {}) {
  return {
    orgId: overrides.orgId ?? ORG_ID,
    userId: overrides.userId ?? USER_ID,
    role: (overrides.role ?? "admin") as TestRole,
    email: "user@example.com",
    name: "Test User",
  } as any
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: authenticated admin with contracts write permission
  vi.mocked(requireAuth).mockResolvedValue(makeAuthResult())
  mockOrgHasModule.mockResolvedValue(true)

  // Default: active contract found
  mockContractFindFirst.mockResolvedValue(baseContract)

  // Default: no in-flight envelopes
  mockEnvelopeCount.mockResolvedValue(0)

  // Default $transaction: executes the callback
  mockTransaction.mockImplementation(async (cb: any) => {
    const mockTx = {
      contract: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // count=1 → CAS succeeded
      },
      contractVersion: {
        create: vi.fn().mockImplementation((args: unknown) => {
          return {
            id: "ver-new",
            versionNo: EXISTING_MAX_VERSION + 1,
            source: "amendment",
            isCanonicalSigned: false,
            contentHash: "abcdef",
            note: (args as any)?.data?.note ?? null,
            createdBy: USER_ID,
            createdAt: new Date(),
          }
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ max: EXISTING_MAX_VERSION }]),
    }
    return cb(mockTx)
  })

  // Audit log: non-critical, always succeeds
  mockAuditCreate.mockResolvedValue({ id: "audit-1" })
})

// ═══════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — happy path", () => {
  it("amend an active contract → 200 with ContractVersion(source=amendment, isCanonicalSigned=false)", async () => {
    const capturedVersionCreates: unknown[] = []
    const capturedContractUpdateManys: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedContractUpdateManys.push(args)
            return { count: 1 }
          }),
        },
        contractVersion: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return {
              id: "ver-new",
              versionNo: EXISTING_MAX_VERSION + 1,
              source: "amendment",
              isCanonicalSigned: false,
              contentHash: "abc123",
              note: null,
              createdBy: USER_ID,
              createdAt: new Date(),
            }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: EXISTING_MAX_VERSION }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // Version shape
    expect(json.data.version.source).toBe("amendment")
    expect(json.data.version.isCanonicalSigned).toBe(false)
    expect(json.data.version.versionNo).toBe(EXISTING_MAX_VERSION + 1)
    expect(typeof json.data.version.contentHash).toBe("string")

    // The ContractVersion.create was called with correct fields
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.source).toBe("amendment")
    expect(versionCreate.data.isCanonicalSigned).toBe(false)
    expect(versionCreate.data.contractId).toBe(CONTRACT_ID)
    expect(versionCreate.data.renderedBody).toBe(amendedBody)
    // contentHash must be SHA-256 hex (64 chars) computed from renderedBody
    expect(typeof versionCreate.data.contentHash).toBe("string")
    expect(versionCreate.data.contentHash).toHaveLength(64)

    // FIX E: Contract update uses updateMany with status CAS (not plain update)
    const contractUpdate = capturedContractUpdateManys[0] as any
    expect(contractUpdate.data.renderedBody).toBe(amendedBody)
    // CAS where-clause must include organizationId + status in AMENDABLE_STATUSES
    expect(contractUpdate.where.id).toBe(CONTRACT_ID)
    expect(contractUpdate.where.organizationId).toBe(ORG_ID)
    expect(contractUpdate.where.status.in).toContain("active")
  })

  it("changeNote stored as version.note", async () => {
    const capturedVersionCreates: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        contractVersion: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "ver-2", versionNo: 3, source: "amendment", isCanonicalSigned: false, contentHash: "x".repeat(64), note: (args as any).data.note, createdBy: USER_ID, createdAt: new Date() }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody, changeNote: "Updated Section 4.2 payment terms" }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.note).toBe("Updated Section 4.2 payment terms")
  })

  it("optional title: when provided, Contract.title is also updated", async () => {
    const capturedContractUpdateManys: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedContractUpdateManys.push(args)
            return { count: 1 }
          }),
        },
        contractVersion: {
          create: vi.fn().mockResolvedValue({ id: "v", versionNo: 3, source: "amendment", isCanonicalSigned: false, contentHash: "y".repeat(64), note: null, createdBy: USER_ID, createdAt: new Date() }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody, title: "Service Agreement v1 (Amended)" }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    const contractUpdate = capturedContractUpdateManys[0] as any
    expect(contractUpdate.data.title).toBe("Service Agreement v1 (Amended)")
    expect(contractUpdate.data.renderedBody).toBe(amendedBody)
  })

  it("CAS: versionNo = MAX(versionNo) + 1", async () => {
    const capturedVersionCreates: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        contractVersion: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "v", versionNo: (args as any).data.versionNo, source: "amendment", isCanonicalSigned: false, contentHash: "z".repeat(64), note: null, createdBy: USER_ID, createdAt: new Date() }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 7 }]), // existing max = 7
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.versionNo).toBe(8) // 7 + 1
  })

  it("CAS: when no prior versions exist (max=null), versionNo = 1", async () => {
    const capturedVersionCreates: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        contractVersion: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "v", versionNo: (args as any).data.versionNo, source: "amendment", isCanonicalSigned: false, contentHash: "z".repeat(64), note: null, createdBy: USER_ID, createdAt: new Date() }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]), // no versions yet
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.versionNo).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════
// State guard: non-amendable statuses → 409
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — state guard (non-amendable → 409)", () => {
  // draft + pending_approval are now amendable (set/paste the body on an early-stage
  // contract — closes the upload gap); only late terminal states remain non-amendable.
  const terminalStatuses = [
    "terminated",
    "expired",
    "renewed",
    "rejected",
    "cancelled",
  ]

  for (const status of terminalStatuses) {
    it(`status="${status}" → 409 NOT_AMENDABLE`, async () => {
      mockContractFindFirst.mockResolvedValue({ ...baseContract, status })

      const res = await POST(
        makePOSTReq({ renderedBody: amendedBody }),
        makeRouteParams()
      )

      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.code).toBe("NOT_AMENDABLE")
      // Transaction must NOT have been called (guard fires before tx)
      expect(mockTransaction).not.toHaveBeenCalled()
    })
  }
})

// ═══════════════════════════════════════════════════════════════════
// Validation errors
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — validation", () => {
  it("missing renderedBody → 400", async () => {
    const res = await POST(makePOSTReq({}), makeRouteParams())
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("empty renderedBody → 400", async () => {
    const res = await POST(makePOSTReq({ renderedBody: "" }), makeRouteParams())
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("invalid JSON body → 400", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/amend`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not-json" }
    )
    const res = await POST(req, makeRouteParams())
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Auth + module guards (FIX D: requireAuth + write)
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — auth + module guards (FIX D)", () => {
  it("no session (unauthenticated) → 401", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    )
    const res = await POST(makePOSTReq({ renderedBody: amendedBody }), makeRouteParams())
    expect(res.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("read-only user (viewer role) → 403 (cannot write contracts)", async () => {
    // requireAuth returns 403 for a viewer attempting a write operation
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json(
        { error: "Forbidden", message: `Role "viewer" cannot "write" on "contracts"` },
        { status: 403 }
      )
    )
    const res = await POST(makePOSTReq({ renderedBody: amendedBody }), makeRouteParams())
    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("contracts module disabled → 403", async () => {
    // requireAuth succeeds but module is disabled
    vi.mocked(requireAuth).mockResolvedValue(makeAuthResult())
    mockOrgHasModule.mockResolvedValue(false)

    const res = await POST(makePOSTReq({ renderedBody: amendedBody }), makeRouteParams())
    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("superadmin bypasses module gate even when disabled", async () => {
    mockOrgHasModule.mockResolvedValue(false)
    vi.mocked(requireAuth).mockResolvedValue(makeAuthResult({ role: "superadmin" }))

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )
    // Should not be 403 — superadmin bypasses module gate
    expect(res.status).not.toBe(403)
    // Contract is active → should reach the transaction
    expect(mockTransaction).toHaveBeenCalled()
  })

  it("contract not found (different org) → 404", async () => {
    mockContractFindFirst.mockResolvedValue(null)
    const res = await POST(makePOSTReq({ renderedBody: amendedBody }), makeRouteParams())
    expect(res.status).toBe(404)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════
// FIX D: In-flight envelope block → 409 ENVELOPE_IN_FLIGHT
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — in-flight envelope block (FIX D)", () => {
  it("active envelope (status=sent) → 409 ENVELOPE_IN_FLIGHT", async () => {
    mockEnvelopeCount.mockResolvedValue(1) // one in-flight envelope

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("ENVELOPE_IN_FLIGHT")
    // Transaction must NOT have been called
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("in_progress envelope → 409 ENVELOPE_IN_FLIGHT", async () => {
    mockEnvelopeCount.mockResolvedValue(2) // multiple in-flight

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("ENVELOPE_IN_FLIGHT")
  })

  it("completed/voided envelope (count=0) → does NOT block amend", async () => {
    // Completed envelopes are not in-flight — amend proceeds normally
    mockEnvelopeCount.mockResolvedValue(0)

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    // Happy path: status 200
    expect(res.status).toBe(200)
    expect(mockTransaction).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════
// FIX E: In-tx state CAS (concurrent terminal transition → 409)
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — in-tx CAS (FIX E)", () => {
  it("contract concurrently transitioned to non-amendable state → 409 NOT_AMENDABLE", async () => {
    // The pre-flight check passes (contract.status="active" at read time),
    // but inside the tx the updateMany finds count=0 (concurrent transition happened).
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          // FIX E: count=0 → AmendConflictError inside tx → rollback
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        contractVersion: {
          create: vi.fn().mockResolvedValue({ id: "v", versionNo: 3, source: "amendment", isCanonicalSigned: false, contentHash: "z".repeat(64), note: null, createdBy: USER_ID, createdAt: new Date() }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("NOT_AMENDABLE")
  })

  it("in-tx CAS: updateMany called with status filter containing all amendable states", async () => {
    const capturedUpdateManys: unknown[] = []

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        contract: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedUpdateManys.push(args)
            return { count: 1 }
          }),
        },
        contractVersion: {
          create: vi.fn().mockResolvedValue({
            id: "v", versionNo: 3, source: "amendment", isCanonicalSigned: false,
            contentHash: "z".repeat(64), note: null, createdBy: USER_ID, createdAt: new Date(),
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      }
      return cb(mockTx)
    })

    await POST(makePOSTReq({ renderedBody: amendedBody }), makeRouteParams())

    const cas = capturedUpdateManys[0] as any
    // Must include all amendable statuses
    expect(cas.where.status.in).toContain("active")
    expect(cas.where.status.in).toContain("approved")
    expect(cas.where.status.in).toContain("renewing")
    expect(cas.where.status.in).not.toContain("signed")
    // Must scope to the correct contract + org
    expect(cas.where.id).toBe(CONTRACT_ID)
    expect(cas.where.organizationId).toBe(ORG_ID)
  })
})

// ═══════════════════════════════════════════════════════════════════
// P2002 retry
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/contracts/:id/amend — P2002 CAS retry", () => {
  it("P2002 on first attempt → retries → succeeds on second", async () => {
    const { Prisma } = await import("@prisma/client")
    let attempt = 0

    mockTransaction.mockImplementation(async (cb: any) => {
      attempt++
      if (attempt === 1) {
        // Simulate unique constraint violation on (contractId, versionNo)
        const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "5.0.0",
          meta: { target: ["contractId", "versionNo"] },
        })
        throw err
      }
      // Second attempt succeeds
      const mockTx = {
        contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        contractVersion: {
          create: vi.fn().mockResolvedValue({
            id: "ver-retry",
            versionNo: 3,
            source: "amendment",
            isCanonicalSigned: false,
            contentHash: "a".repeat(64),
            note: null,
            createdBy: USER_ID,
            createdAt: new Date(),
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq({ renderedBody: amendedBody }),
      makeRouteParams()
    )

    expect(res.status).toBe(200)
    // Two attempts were made
    expect(attempt).toBe(2)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.version.source).toBe("amendment")
  })
})
