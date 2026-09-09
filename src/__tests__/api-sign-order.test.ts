/**
 * CLM Slice 2d-2 — Sequential signing order tests.
 *
 * Tests for the order-enforcement logic added in Slice 2d-2:
 *
 * POST /api/v1/sign/[token]:
 *   - out-of-order sign → 409 with code "OUT_OF_ORDER"
 *   - in-order sign (lowest-order signer) → proceeds (200)
 *   - cc/copy signer → never blocked by order
 *
 * GET /api/v1/sign/[token]:
 *   - canSignNow === false when earlier unsigned signers exist
 *   - canSignNow === true when this signer is first/lowest or earlier all signed
 *   - canSignNow === true for cc/copy role (not order-gated)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { issueToken } from "@/lib/esign/token-issuer"

// ─── Mocks ───────────────────────────────────────────────────────────────────

// @/lib/auth calls NextAuth() at module-load, which pulls next-auth/env.js →
// next/server; under vitest in isolation that resolution is order-flaky (passes
// only when another test cached next/server first). Mock the boundary module so
// this suite never triggers the next-auth import chain.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

const mockSignerFindFirst = vi.fn()
const mockSignerCount = vi.fn()
const mockSignerUpdateMany = vi.fn()
const mockEnvelopeFindFirst = vi.fn()
const mockSignerUpdate = vi.fn()
const mockEnvelopeUpdate = vi.fn()
const mockAuditCreate = vi.fn()
const mockContractUpdate = vi.fn()
const mockContractUpdateMany = vi.fn()
const mockContractFindFirst = vi.fn()
const mockVersionCreate = vi.fn()
const mockTransaction = vi.fn()
const mockQueryRaw = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    esignSigner: {
      findFirst: (...args: unknown[]) => mockSignerFindFirst(...args),
      update: (...args: unknown[]) => mockSignerUpdate(...args),
      updateMany: (...args: unknown[]) => mockSignerUpdateMany(...args),
      count: (...args: unknown[]) => mockSignerCount(...args),
    },
    esignEnvelope: {
      findFirst: (...args: unknown[]) => mockEnvelopeFindFirst(...args),
      update: (...args: unknown[]) => mockEnvelopeUpdate(...args),
    },
    esignAuditEvent: {
      create: (...args: unknown[]) => mockAuditCreate(...args),
    },
    contract: {
      update: (...args: unknown[]) => mockContractUpdate(...args),
      updateMany: (...args: unknown[]) => mockContractUpdateMany(...args),
      findFirst: (...args: unknown[]) => mockContractFindFirst(...args),
    },
    contractVersion: {
      create: (...args: unknown[]) => mockVersionCreate(...args),
      // FIX C: findUnique needed for bound-version lookup; returns null (legacy path) by default
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import { GET, POST } from "@/app/api/v1/sign/[token]/route"

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = "test-secret-that-is-at-least-32-chars!!"
const ORG_ID = "org-order-test"
const CONTRACT_ID = "ctr-order-test"
const ENVELOPE_ID = "env-order-test"

// Signer 1 (order=1) — first in chain
const SIGNER_1_ID = "signer-order-1"
const EXP_FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24h

const { token: TOKEN_1, tokenHash: TOKEN_HASH_1 } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_1_ID, exp: EXP_FUTURE },
  secret: SECRET,
})

// Signer 2 (order=2) — second in chain
const SIGNER_2_ID = "signer-order-2"
const { token: TOKEN_2, tokenHash: TOKEN_HASH_2 } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_2_ID, exp: EXP_FUTURE },
  secret: SECRET,
})

// CC signer (order=1) — not blocked by signing order
const SIGNER_CC_ID = "signer-cc"
const { token: TOKEN_CC, tokenHash: TOKEN_HASH_CC } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_CC_ID, exp: EXP_FUTURE },
  secret: SECRET,
})

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeSigner(overrides: Record<string, unknown>) {
  return {
    id: SIGNER_1_ID,
    organizationId: ORG_ID,
    envelopeId: ENVELOPE_ID,
    fullName: "Test Signer",
    email: "test@example.com",
    order: 1,
    role: "signer",
    status: "sent",
    tokenHash: TOKEN_HASH_1,
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declineReason: null,
    signatureMethod: null,
    signaturePayload: null,
    signedIpAddress: null,
    signedUserAgent: null,
    lastRemindedAt: null,
    remindersSent: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: ENVELOPE_ID,
    organizationId: ORG_ID,
    contractId: CONTRACT_ID,
    subject: "Order Test Envelope",
    message: null,
    status: "in_progress",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    sentAt: new Date(),
    completedAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    metadata: {},
    createdBy: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    // FIX C: legacy path (no bound version)
    contractVersionId: null as string | null,
    boundContentHash: null as string | null,
    signers: [
      { id: SIGNER_1_ID, role: "signer", status: "sent" },
      { id: SIGNER_2_ID, role: "signer", status: "sent" },
    ],
    contract: {
      id: CONTRACT_ID,
      organizationId: ORG_ID,
      title: "Test Contract",
      contractNumber: "CTR-ORDER-001",
      renderedBody: "Contract body",
      status: "approved",
      createdBy: null,
    },
    ...overrides,
  }
}

function makeGETReq(token: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/sign/${token}`, {
    method: "GET",
  })
}

function makePOSTReq(token: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/sign/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "typed", payload: { typedName: "Test Signer", font: "dancing-script" } }),
  })
}

function makeRouteParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ESIGN_SECRET = SECRET

  // FIX 2: tx now needs findFirst + updateMany on esignSigner for CAS
  mockTransaction.mockImplementation(async (cb: unknown) => {
    const mockTx = {
      esignSigner: {
        findFirst: vi.fn().mockImplementation(() => mockSignerFindFirst()),
        update: mockSignerUpdate,
        updateMany: mockSignerUpdateMany,
      },
      esignEnvelope: {
        findFirst: vi.fn().mockImplementation(() => mockEnvelopeFindFirst()),
        update: mockEnvelopeUpdate,
      },
      esignAuditEvent: { create: mockAuditCreate },
      contract: {
        findFirst: mockContractFindFirst,
        update: mockContractUpdate,
        updateMany: mockContractUpdateMany,
      },
      contractVersion: {
        create: mockVersionCreate,
        // FIX C: tx-level findUnique for bound version (null = legacy/no binding)
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: mockQueryRaw,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (cb as any)(mockTx)
  })

  mockQueryRaw.mockResolvedValue([{ max: null }])
  mockSignerUpdate.mockResolvedValue({})
  // FIX 2: CAS returns count=1 by default (success path)
  mockSignerUpdateMany.mockResolvedValue({ count: 1 })
  mockEnvelopeUpdate.mockResolvedValue({})
  mockAuditCreate.mockResolvedValue({ id: "audit-1" })
  mockContractUpdate.mockResolvedValue({})
  mockContractFindFirst.mockResolvedValue({ status: "approved", signedAt: null })
  mockContractUpdateMany.mockResolvedValue({ count: 1 })
  mockVersionCreate.mockResolvedValue({ id: "ver-1" })
})

afterEach(() => {
  delete process.env.ESIGN_SECRET
})

// ═══════════════════════════════════════════════════════════════════
// POST order-enforcement tests
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/sign/[token] — sequential order enforcement", () => {
  it("returns 409 OUT_OF_ORDER when an earlier signer has not yet signed", async () => {
    // Signer 2 (order=2) tries to sign, but signer 1 (order=1) is still "sent"
    const signer2 = makeSigner({
      id: SIGNER_2_ID,
      order: 2,
      tokenHash: TOKEN_HASH_2,
    })
    mockSignerFindFirst.mockResolvedValue(signer2)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        signers: [
          { id: SIGNER_1_ID, role: "signer", status: "sent" }, // not signed
          { id: SIGNER_2_ID, role: "signer", status: "viewed" },
        ],
      })
    )
    // count returns 1 — signer1 (order=1) is still not signed
    mockSignerCount.mockResolvedValue(1)

    const res = await POST(makePOSTReq(TOKEN_2), makeRouteParams(TOKEN_2))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("OUT_OF_ORDER")
    expect(json.error).toMatch(/waiting for earlier signers/i)

    // Transaction must NOT have been called (signing did not proceed)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("allows signing when all earlier signers have signed", async () => {
    // Signer 2 (order=2) tries to sign; signer 1 already signed
    const signer2 = makeSigner({
      id: SIGNER_2_ID,
      order: 2,
      tokenHash: TOKEN_HASH_2,
    })
    mockSignerFindFirst.mockResolvedValue(signer2)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        signers: [
          { id: SIGNER_1_ID, role: "signer", status: "signed" }, // signed
          { id: SIGNER_2_ID, role: "signer", status: "viewed" },
        ],
      })
    )
    // count returns 0 — no unsigned earlier signers
    mockSignerCount.mockResolvedValue(0)

    const res = await POST(makePOSTReq(TOKEN_2), makeRouteParams(TOKEN_2))
    // Should proceed — status 200
    expect(res.status).toBe(200)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it("allows the first signer (order=1) to sign immediately", async () => {
    // Signer 1 (order=1) — no earlier signers possible
    const signer1 = makeSigner({ id: SIGNER_1_ID, order: 1, tokenHash: TOKEN_HASH_1 })
    mockSignerFindFirst.mockResolvedValue(signer1)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        signers: [
          { id: SIGNER_1_ID, role: "signer", status: "viewed" },
          { id: SIGNER_2_ID, role: "signer", status: "sent" },
        ],
      })
    )
    // count returns 0 — no signers with order < 1
    mockSignerCount.mockResolvedValue(0)

    const res = await POST(makePOSTReq(TOKEN_1), makeRouteParams(TOKEN_1))
    expect(res.status).toBe(200)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it("FIX 3: cc signers cannot sign — returns 403 before order check", async () => {
    // FIX 3: cc/copy roles cannot produce signature payloads.
    // The route now returns 403 before any order check or DB write.
    const ccSigner = makeSigner({
      id: SIGNER_CC_ID,
      order: 1,
      role: "cc",
      tokenHash: TOKEN_HASH_CC,
    })
    mockSignerFindFirst.mockResolvedValue(ccSigner)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        signers: [
          { id: SIGNER_CC_ID, role: "cc", status: "sent" },
          { id: SIGNER_1_ID, role: "signer", status: "sent" },
        ],
      })
    )
    mockSignerCount.mockResolvedValue(99)

    const res = await POST(
      new NextRequest(`http://localhost:3000/api/v1/sign/${TOKEN_CC}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "typed", payload: { typedName: "CC Person", font: "dancing-script" } }),
      }),
      makeRouteParams(TOKEN_CC)
    )
    // FIX 3: 403 — cc/copy cannot sign
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/only signers may submit/i)
    // count must NOT have been called (role guard fires first)
    expect(mockSignerCount).not.toHaveBeenCalled()
    // Transaction also must not have been called
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════
// GET canSignNow tests
// ═══════════════════════════════════════════════════════════════════

describe("GET /api/v1/sign/[token] — canSignNow field", () => {
  it("canSignNow = false when earlier signers have not signed", async () => {
    const signer2 = makeSigner({
      id: SIGNER_2_ID,
      order: 2,
      tokenHash: TOKEN_HASH_2,
      status: "sent",
    })
    mockSignerFindFirst.mockResolvedValue(signer2)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        status: "in_progress",
        signers: [
          { id: SIGNER_1_ID, role: "signer", status: "sent" },
          { id: SIGNER_2_ID, role: "signer", status: "sent" },
        ],
      })
    )
    // Simulate 1 unsigned signer with lower order
    mockSignerCount.mockResolvedValue(1)

    const res = await GET(makeGETReq(TOKEN_2), makeRouteParams(TOKEN_2))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.canSignNow).toBe(false)
  })

  it("canSignNow = true when this signer is lowest-order (first in chain)", async () => {
    const signer1 = makeSigner({ id: SIGNER_1_ID, order: 1, tokenHash: TOKEN_HASH_1, status: "sent" })
    mockSignerFindFirst.mockResolvedValue(signer1)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        status: "in_progress",
        signers: [
          { id: SIGNER_1_ID, role: "signer", status: "sent" },
          { id: SIGNER_2_ID, role: "signer", status: "sent" },
        ],
      })
    )
    mockSignerCount.mockResolvedValue(0) // no earlier unsigned

    const res = await GET(makeGETReq(TOKEN_1), makeRouteParams(TOKEN_1))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.canSignNow).toBe(true)
  })

  it("canSignNow = true for cc role regardless of order state", async () => {
    const ccSigner = makeSigner({
      id: SIGNER_CC_ID,
      order: 1,
      role: "cc",
      tokenHash: TOKEN_HASH_CC,
      status: "sent",
    })
    mockSignerFindFirst.mockResolvedValue(ccSigner)
    mockEnvelopeFindFirst.mockResolvedValue(
      makeEnvelope({
        signers: [
          { id: SIGNER_CC_ID, role: "cc", status: "sent" },
          { id: SIGNER_1_ID, role: "signer", status: "sent" },
        ],
      })
    )
    // count not called for cc role
    mockSignerCount.mockResolvedValue(99)

    const res = await GET(makeGETReq(TOKEN_CC), makeRouteParams(TOKEN_CC))
    expect(res.status).toBe(200)
    const json = await res.json()
    // cc role → canSignNow = true (not order-gated)
    expect(json.data.canSignNow).toBe(true)
    expect(mockSignerCount).not.toHaveBeenCalled()
  })
})
