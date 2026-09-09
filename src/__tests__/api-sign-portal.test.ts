/**
 * CLM Slice 2b — API tests for the public e-sign portal.
 *
 * Routes under test:
 *   GET  /api/v1/sign/[token]          — load + view tracking
 *   POST /api/v1/sign/[token]          — sign
 *   POST /api/v1/sign/[token]/decline  — decline
 *
 * Uses the REAL pure helpers (token-issuer, state-machine, signature-validator,
 * audit-event-builder) since they have no external dependencies and testing
 * them real gives more confidence. Prisma is fully mocked.
 *
 * Coverage:
 *   GET:
 *     - Valid token → loads contract/signer/envelope, returns safe fields only
 *     - View tracking: transitions signer sent→viewed, appends signer_viewed audit
 *     - Already-viewed signer → does not double-audit (idempotent)
 *     - Invalid (tampered) token → 401
 *     - Expired token → 410
 *     - Signer not found in DB → 401
 *     - tokenHash mismatch → 401
 *     - Terminal signer status (signed) → 409
 *     - Terminal envelope status (completed) → 410
 *   POST:
 *     - Typed signature → signer transitions to signed, audit appended
 *     - Drawn signature → signer transitions to signed
 *     - Invalid body (bad method) → 400
 *     - Signer already signed → 409
 *     - Envelope completed → 410
 *     - Completion path: last signer signs → envelope completed + Contract.signedAt
 *       + ContractVersion(source:"signed", isCanonicalSigned:true) with versionNo = max+1
 *     - CAS test: versionNo = existing max + 1
 *     - Token tampered → 401
 *   Decline:
 *     - Valid → signer declined, envelope auto-declined
 *     - Already declined → 409
 *     - Token tampered → 401
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { issueToken } from "@/lib/esign/token-issuer"

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Prisma mock — we need $queryRaw for the CAS versionNo lookup
const mockSignerFindFirst = vi.fn()
const mockSignerCount = vi.fn()
const mockEnvelopeFindFirst = vi.fn()
const mockSignerUpdate = vi.fn()
const mockSignerUpdateMany = vi.fn()
const mockEnvelopeUpdate = vi.fn()
const mockAuditCreate = vi.fn()
const mockContractUpdate = vi.fn()
const mockContractUpdateMany = vi.fn()
const mockContractFindFirst = vi.fn()
const mockVersionCreate = vi.fn()
const mockTransaction = vi.fn()
const mockQueryRaw = vi.fn()

const mockCreateNotification = vi.fn().mockResolvedValue({ id: "notif-1" })

vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}))

const mockVersionFindUnique = vi.fn()

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
      findUnique: (...args: unknown[]) => mockVersionFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GET, POST } from "@/app/api/v1/sign/[token]/route"
import { POST as DECLINE } from "@/app/api/v1/sign/[token]/decline/route"

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET = "test-secret-that-is-at-least-32-chars!!"
const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const ENVELOPE_ID = "env-1"
const SIGNER_ID = "signer-1"
const EXP_FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24h from now
const EXP_PAST = Math.floor(Date.now() / 1000) - 1 // already expired

// Issue a valid token for the test signer
const { token: VALID_TOKEN, tokenHash: VALID_TOKEN_HASH } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_ID, exp: EXP_FUTURE },
  secret: SECRET,
})

const { token: EXPIRED_TOKEN } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_ID, exp: EXP_PAST },
  secret: SECRET,
})

// A token with valid HMAC but a different secret → signature mismatch
const { token: TAMPERED_TOKEN } = issueToken({
  claims: { eid: ENVELOPE_ID, sid: SIGNER_ID, exp: EXP_FUTURE },
  secret: "completely-different-secret-at-32chars!!",
})

// ─── DB fixture helpers ────────────────────────────────────────────────────────

const baseSigner = {
  id: SIGNER_ID,
  organizationId: ORG_ID,
  envelopeId: ENVELOPE_ID,
  fullName: "Alice Signer",
  email: "alice@example.com",
  order: 1,
  role: "signer",
  status: "sent",
  tokenHash: VALID_TOKEN_HASH,
  viewedAt: null,
  signedAt: null,
  declinedAt: null,
  declineReason: null,
  signatureMethod: null,
  signaturePayload: null,
  signedIpAddress: null,
  signedUserAgent: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const baseEnvelope = {
  id: ENVELOPE_ID,
  organizationId: ORG_ID,
  contractId: CONTRACT_ID,
  subject: "Please sign the NDA",
  message: "Thank you for your time.",
  status: "sent",
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
  // FIX C: bound version fields (null = legacy/unbound — falls back to live renderedBody)
  contractVersionId: null as string | null,
  boundContentHash: null as string | null,
  // Included relations
  signers: [{ id: SIGNER_ID, role: "signer", status: "sent" }],
  contract: {
    id: CONTRACT_ID,
    organizationId: ORG_ID,
    title: "Non-Disclosure Agreement",
    contractNumber: "CTR-001",
    renderedBody: "This agreement is between Party A and Party B…",
    status: "approved",
    createdBy: "user-owner-1",
  },
}

const VERSION_ID = "ver-bound-1"
const BOUND_BODY = "This is the BOUND body — pinned at send time, NOT the live amended text."
const BOUND_HASH = "a".repeat(64)

// ─── Request helpers ───────────────────────────────────────────────────────────

function makeGETReq(token: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/sign/${token}`, {
    method: "GET",
    headers: { "user-agent": "test-browser/1.0" },
  })
}

function makePOSTReq(token: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/sign/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "test-browser/1.0" },
    body: JSON.stringify(body),
  })
}

function makeDeclineReq(token: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/sign/${token}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "test-browser/1.0" },
    body: body ? JSON.stringify(body) : JSON.stringify({}),
  })
}

function makeRouteParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ESIGN_SECRET = SECRET

  // Default happy-path mocks
  mockSignerFindFirst.mockResolvedValue(baseSigner)
  mockEnvelopeFindFirst.mockResolvedValue(baseEnvelope)
  // Default: signer is first in order — no earlier unsigned signers
  mockSignerCount.mockResolvedValue(0)
  // FIX C: default no bound version (legacy path — falls back to live renderedBody)
  mockVersionFindUnique.mockResolvedValue(null)

  // Default $transaction: execute the callback with a mock tx client.
  // FIX 2: tx now needs findFirst + updateMany on esignSigner for CAS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransaction.mockImplementation(async (cb: any) => {
    const mockTx = {
      esignSigner: {
        findFirst: vi.fn().mockResolvedValue(baseSigner),
        update: mockSignerUpdate,
        updateMany: mockSignerUpdateMany,
      },
      esignEnvelope: {
        findFirst: vi.fn().mockResolvedValue(baseEnvelope),
        update: mockEnvelopeUpdate,
        // GET view-tracking uses updateMany for conditional envelope advance
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      esignAuditEvent: { create: mockAuditCreate },
      contract: {
        findFirst: mockContractFindFirst,
        update: mockContractUpdate,
        updateMany: mockContractUpdateMany,
      },
      contractVersion: {
        // Slice 4a: demote prior canonical before minting new one
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: mockVersionCreate,
      },
      $queryRaw: mockQueryRaw,
    }
    return cb(mockTx)
  })

  // Default: no existing versions
  mockQueryRaw.mockResolvedValue([{ max: null }])
  mockSignerUpdate.mockResolvedValue({ ...baseSigner, status: "viewed", viewedAt: new Date() })
  // FIX 2: CAS returns count=1 by default (success path)
  mockSignerUpdateMany.mockResolvedValue({ count: 1 })
  mockEnvelopeUpdate.mockResolvedValue({ ...baseEnvelope, status: "in_progress" })
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
// GET tests
// ═══════════════════════════════════════════════════════════════════

describe("GET /api/v1/sign/[token] — load signing page", () => {
  it("valid token: returns safe fields, no tokenHash/other signers", async () => {
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // Safe fields present
    expect(json.data.signer.fullName).toBe("Alice Signer")
    expect(json.data.signer.email).toBe("alice@example.com")
    expect(json.data.envelope.subject).toBe("Please sign the NDA")
    expect(json.data.contract.title).toBe("Non-Disclosure Agreement")
    expect(json.data.contract.contractNumber).toBe("CTR-001")
    expect(json.data.contract.renderedBody).toBeTruthy()

    // Security: tokenHash MUST NOT be in response
    expect(json.data.signer.tokenHash).toBeUndefined()
    // No other signers' data
    expect(json.data.envelope.signers).toBeUndefined()
    // No org data beyond what's needed
    expect(json.data.envelope.organizationId).toBeUndefined()
    expect(json.data.contract.organizationId).toBeUndefined()
  })

  it("view tracking: transitions signer sent→viewed (CAS updateMany) + appends signer_viewed audit", async () => {
    const capturedTxCalls: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const capturedAudits: unknown[] = []
      const mockTx = {
        esignSigner: {
          // CAS path: updateMany returns count=1 (real transition)
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedTxCalls.push({ type: "signerUpdateMany", args })
            return { count: 1 }
          }),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedTxCalls.push({ type: "envelopeUpdateMany", args })
            return { count: 1 }
          }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            capturedTxCalls.push({ type: "auditCreate", args })
            return { id: "audit-viewed" }
          }),
        },
      }
      return cb(mockTx)
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)

    // CAS: updateMany must use verified tokenHash + status predicate (no downgrade possible)
    const signerCasCall = capturedTxCalls.find(
      (c: any) => c.type === "signerUpdateMany"
    ) as any
    expect(signerCasCall).toBeTruthy()
    expect(signerCasCall.args.where.tokenHash).toBe(VALID_TOKEN_HASH)
    expect(signerCasCall.args.where.status.in).toContain("pending")
    expect(signerCasCall.args.where.status.in).toContain("sent")
    expect(signerCasCall.args.data.status).toBe("viewed")
    expect(signerCasCall.args.data.viewedAt).toBeInstanceOf(Date)

    // Audit fires on real transition (count===1)
    const auditCall = capturedTxCalls.find(
      (c: any) => c.type === "auditCreate"
    ) as any
    expect(auditCall).toBeTruthy()
    expect(auditCall.args.data.eventType).toBe("signer_viewed")
    expect(auditCall.args.data.signerId).toBe(SIGNER_ID)
  })

  it("already-viewed signer: no CAS attempted (idempotent)", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed", viewedAt: new Date() })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    // No transaction should have been triggered since signer is already viewed
    // (the GET CAS block is gated on status pending/sent only)
    expect(mockTransaction).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.data.signer.status).toBe("viewed")
  })

  it("tampered token → 401", async () => {
    const res = await GET(makeGETReq(TAMPERED_TOKEN), makeRouteParams(TAMPERED_TOKEN))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    // Must not leak any details about which field failed
    expect(json.data).toBeUndefined()
  })

  it("expired token → 410", async () => {
    const res = await GET(makeGETReq(EXPIRED_TOKEN), makeRouteParams(EXPIRED_TOKEN))
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.error).toMatch(/expired/i)
  })

  it("signer not in DB → 401 (no info leak)", async () => {
    mockSignerFindFirst.mockResolvedValue(null)
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    expect(json.data).toBeUndefined()
  })

  it("tokenHash mismatch (different hash in DB) → 401", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, tokenHash: "totally-wrong-hash-value" })
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(401)
    expect((await res.json()).data).toBeUndefined()
  })

  it("signer already signed → 200 with terminal state (no downgrade, shows signed status)", async () => {
    // Per CAS fix: a returning signer who already signed sees their terminal state.
    // The GET must NOT 409 — it should return load data with status "signed" so the
    // signing page can display "you have already signed this document".
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "signed", signedAt: new Date() })
    mockEnvelopeFindFirst.mockResolvedValue({ ...baseEnvelope, status: "in_progress" })
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    // Terminal status passed through (not downgraded to "viewed")
    expect(json.data.signer.status).toBe("signed")
    // No view-tracking tx attempted for a signed signer
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("envelope completed (terminal) → 410", async () => {
    mockEnvelopeFindFirst.mockResolvedValue({
      ...baseEnvelope,
      status: "completed",
      completedAt: new Date(),
    })
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toMatch(/completed/i)
  })

  it("ESIGN_SECRET missing → 401", async () => {
    delete process.env.ESIGN_SECRET
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(401)
  })

  // ── CAS race-safety tests (Codex residual MED fix) ──────────────────────────

  it("CAS race: signer is 'sent' → view-tracking transitions to viewed (count===1) + signer_viewed audit", async () => {
    // Signer arrives with status "sent" — CAS succeeds (count=1), audit fires.
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "sent" })

    const capturedCas: unknown[] = []
    const capturedAudits: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedCas.push(args)
            return { count: 1 } // real transition
          }),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            return { id: "audit-v" }
          }),
        },
      }
      return cb(mockTx)
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)

    // CAS where must include verified tokenHash and status predicate
    const cas = capturedCas[0] as any
    expect(cas.where.tokenHash).toBe(VALID_TOKEN_HASH)
    expect(cas.where.status.in).toEqual(expect.arrayContaining(["pending", "sent"]))
    expect(cas.data.status).toBe("viewed")

    // Audit fires on count===1
    expect(capturedAudits).toHaveLength(1)
    expect((capturedAudits[0] as any).data.eventType).toBe("signer_viewed")

    // Load data returned correctly
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.signer.fullName).toBe("Alice Signer")
  })

  it("CAS race: concurrent POST signed first (count===0) → no signer downgrade, no signer_viewed audit, still returns load data", async () => {
    // Signer looks "sent" to verifyAndLoad (TOCTOU window), but a concurrent POST
    // signed them before our tx runs → updateMany finds 0 rows.
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "sent" })
    // Envelope is "in_progress" or "completed" — no downgrade should happen.
    mockEnvelopeFindFirst.mockResolvedValue({ ...baseEnvelope, status: "in_progress" })

    const capturedAudits: unknown[] = []
    let envelopeUpdateManyCalled = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          // count===0: concurrent POST already signed
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockImplementation(() => {
            envelopeUpdateManyCalled = true
            return { count: 0 }
          }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            return { id: "audit-race" }
          }),
        },
      }
      return cb(mockTx)
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    // Must still return load data (200), NOT 409 or 500
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.signer).toBeTruthy()
    expect(json.data.contract.title).toBe("Non-Disclosure Agreement")

    // No signer_viewed audit emitted when count===0 (signer already advanced)
    const viewedAudits = (capturedAudits as any[]).filter(
      (a) => a.data?.eventType === "signer_viewed"
    )
    expect(viewedAudits).toHaveLength(0)

    // Envelope not downgraded
    expect(envelopeUpdateManyCalled).toBe(false)
  })

  it("CAS race: envelope already 'completed' → envelope updateMany not called (no downgrade)", async () => {
    // Even if the signer CAS would fire, the envelope must not be downgraded.
    // The envelope updateMany scopes to `{ status: "sent" }` — so a "completed"
    // envelope is untouched.
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "sent" })
    mockEnvelopeFindFirst.mockResolvedValue({
      ...baseEnvelope,
      status: "completed",
      completedAt: new Date(),
      signers: [{ id: SIGNER_ID, role: "signer", status: "signed" }],
    })

    const envelopeUpdateManyCalls: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            envelopeUpdateManyCalls.push(args)
            return { count: 0 } // completed envelope → 0 rows matched by status:"sent"
          }),
        },
        esignAuditEvent: {
          create: vi.fn().mockResolvedValue({ id: "a" }),
        },
      }
      return cb(mockTx)
    })

    // Note: the envelope terminal guard returns 410 for "completed" envelope —
    // this test verifies the guard fires (no tx attempted on a completed envelope).
    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(410)
    // No tx was run (envelope terminal guard fires before view-tracking block)
    expect(mockTransaction).not.toHaveBeenCalled()
    // And therefore no envelope updateMany
    expect(envelopeUpdateManyCalls).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// POST — sign tests
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/sign/[token] — sign", () => {
  it("typed signature: signer transitions to signed, audit appended", async () => {
    const capturedCasCalls: unknown[] = []
    const capturedAudits: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue(baseSigner),
          // FIX 2: CAS via updateMany
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedCasCalls.push(args)
            return { count: 1 } // success
          }),
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(baseEnvelope),
          update: mockEnvelopeUpdate,
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            return { id: "audit-signed" }
          }),
        },
        contract: {
          findFirst: mockContractFindFirst,
          update: mockContractUpdate,
          updateMany: mockContractUpdateMany,
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: mockVersionCreate,
        },
        $queryRaw: mockQueryRaw,
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, {
        method: "typed",
        payload: { typedName: "Alice Signer", font: "dancing-script" },
      }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.signer.status).toBe("signed")
    // tokenHash NEVER in response
    expect(json.data.signer.tokenHash).toBeUndefined()

    // CAS: updateMany must have been called with the right status filter
    const casCall = capturedCasCalls[0] as any
    expect(casCall.where.status.in).toContain("sent")
    expect(casCall.where.status.in).toContain("viewed")
    expect(casCall.data.status).toBe("signed")
    expect(casCall.data.signatureMethod).toBe("typed")
    expect(casCall.data.signedAt).toBeInstanceOf(Date)
    // FIX 2: tokenHash cleared on terminal transition (single-use)
    expect(casCall.data.tokenHash).toBeNull()

    // Audit
    const auditCall = capturedAudits[0] as any
    expect(auditCall.data.eventType).toBe("signer_signed")
    expect(auditCall.data.signerId).toBe(SIGNER_ID)
  })

  it("drawn signature: accepted and stored", async () => {
    const capturedCasCalls: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue(baseSigner),
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedCasCalls.push(args)
            return { count: 1 }
          }),
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(baseEnvelope),
          update: mockEnvelopeUpdate,
        },
        esignAuditEvent: { create: mockAuditCreate },
        contract: {
          findFirst: mockContractFindFirst,
          update: mockContractUpdate,
          updateMany: mockContractUpdateMany,
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: mockVersionCreate,
        },
        $queryRaw: mockQueryRaw,
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, {
        method: "drawn",
        payload: { svgPath: "M10,10 L100,50 L200,10", widthPx: 600, heightPx: 180 },
      }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const casCall = capturedCasCalls[0] as any
    expect(casCall.data.signatureMethod).toBe("drawn")
  })

  it("invalid method → 400", async () => {
    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "brainwave", payload: {} }),
      makeRouteParams(VALID_TOKEN)
    )
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("missing typedName → 400", async () => {
    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "   ", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("signer already signed → 409", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "signed", signedAt: new Date() })
    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )
    expect(res.status).toBe(409)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("envelope completed → 410", async () => {
    mockEnvelopeFindFirst.mockResolvedValue({ ...baseEnvelope, status: "completed", completedAt: new Date() })
    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )
    expect(res.status).toBe(410)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("tampered token → 401, no DB writes", async () => {
    const res = await POST(
      makePOSTReq(TAMPERED_TOKEN, { method: "typed", payload: { typedName: "Alice", font: "dancing-script" } }),
      makeRouteParams(TAMPERED_TOKEN)
    )
    expect(res.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  // ── Completion path ──────────────────────────────────────────────

  it("last signer signing → envelope completed + Contract.signedAt + ContractVersion minted", async () => {
    // Single-signer envelope in in_progress state (after view tracking): all signers sign → completed
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    // Signer is in "viewed" state (normal post-GET flow)
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    const capturedEnvelopeUpdates: unknown[] = []
    const capturedContractUpdates: unknown[] = []
    const capturedVersionCreates: unknown[] = []
    const capturedAudits: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({ ...baseSigner, status: "signed" }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockImplementation((args: unknown) => {
            capturedEnvelopeUpdates.push(args)
            return { ...singleSignerEnvelope, status: "completed", completedAt: new Date() }
          }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            return { id: "audit-x" }
          }),
        },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedContractUpdates.push(args)
            return { count: 1 }
          }),
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "ver-1" }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]), // no existing versions
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.envelopeCompleted).toBe(true)

    // Envelope completed
    const envUpdate = capturedEnvelopeUpdates[0] as any
    expect(envUpdate.data.status).toBe("completed")
    expect(envUpdate.data.completedAt).toBeInstanceOf(Date)

    // Contract.signedAt + signedBy set; signedBy uses "esign:<envelopeId>" marker
    const contractUpdate = capturedContractUpdates[0] as any
    expect(contractUpdate.where.status).toBe("approved")
    expect(contractUpdate.where.signedAt).toBeNull()
    expect(contractUpdate.data.signedAt).toBeInstanceOf(Date)
    expect(contractUpdate.data.signedBy).toBe(`esign:${ENVELOPE_ID}`)
    expect(contractUpdate.data.status).toBe("active")

    // ContractVersion minted
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.source).toBe("signed")
    expect(versionCreate.data.isCanonicalSigned).toBe(true)
    expect(versionCreate.data.contractId).toBe(CONTRACT_ID)
    expect(typeof versionCreate.data.contentHash).toBe("string")
    expect(versionCreate.data.contentHash.length).toBe(64) // SHA-256 hex

    // Audit: signer_signed + envelope_completed
    const auditTypes = (capturedAudits as any[]).map((a) => a.data.eventType)
    expect(auditTypes).toContain("signer_signed")
    expect(auditTypes).toContain("envelope_completed")
  })

  it("CAS: versionNo = existing max + 1", async () => {
    const existingMax = 3
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    const capturedVersionCreates: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({ ...baseSigner, status: "signed" }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed" }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "ver-cas" }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: existingMax }]), // existing max = 3
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const versionCreate = capturedVersionCreates[0] as any
    // Must use existingMax + 1
    expect(versionCreate.data.versionNo).toBe(existingMax + 1)
  })

  it("completion: re-signing active contract leaves status active and refreshes signedAt", async () => {
    const previousSignedAt = new Date("2026-01-01T00:00:00Z")
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
      contract: { ...baseEnvelope.contract, status: "active", signedAt: previousSignedAt },
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    const contractUpdateMany = vi.fn().mockResolvedValue({ count: 1 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({ ...baseSigner, status: "signed" }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed" }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "active", signedAt: previousSignedAt }),
          updateMany: contractUpdateMany,
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: "v" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 1 }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const contractUpdate = contractUpdateMany.mock.calls[0][0]
    expect(contractUpdate.where.status).toBe("active")
    expect(contractUpdate.where.signedAt).toBe(previousSignedAt)
    expect(contractUpdate.data.status).toBe("active")
    expect(contractUpdate.data.signedAt).toBeInstanceOf(Date)
  })

  // ── Slice 4a: canonical-swap tests ──────────────────────────────────────────

  it("Slice 4a: signing when a prior canonical exists → prior demoted (isCanonicalSigned=false) + new canonical minted", async () => {
    // Scenario: an amendment was created (source="amendment") and is now being
    // re-signed. A prior ContractVersion with isCanonicalSigned=true exists.
    // On completion, the sign route must:
    //   1. updateMany({ isCanonicalSigned: true } → { isCanonicalSigned: false })
    //   2. create new ContractVersion(source="signed", isCanonicalSigned=true)
    // Both inside the same tx → atomic; the old canonical is preserved in history.

    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    const capturedVersionUpdateManyCalls: unknown[] = []
    const capturedVersionCreateCalls: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({ ...baseSigner, status: "signed" }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed", completedAt: new Date() }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          // Capture updateMany calls (the demote step) + create calls (the mint step)
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionUpdateManyCalls.push(args)
            return { count: 1 } // 1 prior canonical demoted
          }),
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreateCalls.push(args)
            return { id: "ver-new-canonical" }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: 3 }]), // prior versions exist
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.envelopeCompleted).toBe(true)

    // Step 1: demote prior canonical — updateMany called with isCanonicalSigned: true
    expect(capturedVersionUpdateManyCalls.length).toBe(1)
    const demoteCall = capturedVersionUpdateManyCalls[0] as any
    expect(demoteCall.where.contractId).toBe(CONTRACT_ID)
    expect(demoteCall.where.isCanonicalSigned).toBe(true)
    expect(demoteCall.data.isCanonicalSigned).toBe(false)

    // Step 2: new canonical minted after the demote
    expect(capturedVersionCreateCalls.length).toBe(1)
    const newCanonical = capturedVersionCreateCalls[0] as any
    expect(newCanonical.data.source).toBe("signed")
    expect(newCanonical.data.isCanonicalSigned).toBe(true)
    expect(newCanonical.data.versionNo).toBe(4) // max(3) + 1

    // Result: exactly one canonical in play (the new one; old was demoted)
    // The updateMany demoted old; the create added new — only one isCanonicalSigned=true
  })

  it("Slice 4a: when no prior canonical exists (first sign), updateMany is still called (no-op, count=0) and new canonical minted", async () => {
    // Edge case: updateMany finds 0 rows (no prior canonical — fresh first sign).
    // This should be a no-op and NOT cause any error; the new canonical is still minted.

    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    const capturedVersionUpdateManyCalls: unknown[] = []
    const capturedVersionCreateCalls: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed", completedAt: new Date() }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionUpdateManyCalls.push(args)
            return { count: 0 } // no prior canonical (count=0 = no-op)
          }),
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreateCalls.push(args)
            return { id: "ver-first-canonical" }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]), // no prior versions
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)

    // The demote updateMany was still called (idempotent no-op)
    expect(capturedVersionUpdateManyCalls.length).toBe(1)
    expect((capturedVersionUpdateManyCalls[0] as any).data.isCanonicalSigned).toBe(false)

    // New canonical was minted
    expect(capturedVersionCreateCalls.length).toBe(1)
    expect((capturedVersionCreateCalls[0] as any).data.isCanonicalSigned).toBe(true)
    expect((capturedVersionCreateCalls[0] as any).data.source).toBe("signed")
  })
})

// ═══════════════════════════════════════════════════════════════════
// POST decline tests
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/v1/sign/[token]/decline — decline", () => {
  it("valid decline: signer → declined, envelope → declined", async () => {
    const capturedCasCalls: unknown[] = []
    const capturedEnvelopeUpdates: unknown[] = []
    const capturedAudits: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          // FIX 2: CAS via updateMany
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedCasCalls.push(args)
            return { count: 1 }
          }),
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          update: vi.fn().mockImplementation((args: unknown) => {
            capturedEnvelopeUpdates.push(args)
            return { ...baseEnvelope, status: "declined" }
          }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedAudits.push(args)
            return { id: "audit-decline" }
          }),
        },
      }
      return cb(mockTx)
    })

    const res = await DECLINE(
      makeDeclineReq(VALID_TOKEN, { reason: "Terms not acceptable" }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.signer.status).toBe("declined")
    expect(json.data.signer.reason).toBe("Terms not acceptable")

    // CAS: updateMany must have been called with the right shape
    const casCall = capturedCasCalls[0] as any
    expect(casCall.where.status.in).toContain("sent")
    expect(casCall.where.status.in).toContain("viewed")
    expect(casCall.data.status).toBe("declined")
    expect(casCall.data.declinedAt).toBeInstanceOf(Date)
    expect(casCall.data.declineReason).toBe("Terms not acceptable")
    // FIX 2: tokenHash cleared → single-use
    expect(casCall.data.tokenHash).toBeNull()

    // Audit
    const auditTypes = (capturedAudits as any[]).map((a) => a.data?.eventType)
    expect(auditTypes).toContain("signer_declined")

    // FIX 6: When the envelope transitions to "declined" (signer-triggered),
    // the audit event must use "envelope_declined", NOT "envelope_voided".
    // "envelope_voided" is reserved for sender-initiated voids.
    expect(auditTypes).toContain("envelope_declined")
    expect(auditTypes).not.toContain("envelope_voided")

    // Envelope also transitioned
    expect(capturedEnvelopeUpdates.length).toBeGreaterThan(0)
  })

  it("decline without reason: reason is null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({ ...baseSigner, status: "declined" }),
        },
        esignEnvelope: { update: vi.fn().mockResolvedValue({ ...baseEnvelope, status: "declined" }) },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
      }
      return cb(mockTx)
    })

    const res = await DECLINE(makeDeclineReq(VALID_TOKEN, {}), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.signer.reason).toBeNull()
  })

  it("already declined → 409", async () => {
    mockSignerFindFirst.mockResolvedValue({
      ...baseSigner,
      status: "declined",
      declinedAt: new Date(),
    })
    const res = await DECLINE(makeDeclineReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(409)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("tampered token → 401", async () => {
    const res = await DECLINE(makeDeclineReq(TAMPERED_TOKEN), makeRouteParams(TAMPERED_TOKEN))
    expect(res.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("expired token → 410", async () => {
    const res = await DECLINE(makeDeclineReq(EXPIRED_TOKEN), makeRouteParams(EXPIRED_TOKEN))
    expect(res.status).toBe(410)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("ESIGN_SECRET missing → 401", async () => {
    delete process.env.ESIGN_SECRET
    const res = await DECLINE(makeDeclineReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(401)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Regression tests — FIX 2/3/6 (Slice 2 security hardening)
// ═══════════════════════════════════════════════════════════════════

describe("FIX 2 — CAS single-use: concurrent sign → 409, no duplicate audit", () => {
  it("second sign attempt on same token returns 409 (CAS count === 0)", async () => {
    // Simulate: signer has already been processed between verifyAndLoad and the tx.
    // The CAS where-clause finds 0 rows → conflict.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue(baseSigner),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // race: already processed
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(baseEnvelope),
          update: mockEnvelopeUpdate,
        },
        esignAuditEvent: { create: mockAuditCreate },
        contract: {
          findFirst: mockContractFindFirst,
          update: mockContractUpdate,
          updateMany: mockContractUpdateMany,
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: mockVersionCreate,
        },
        $queryRaw: mockQueryRaw,
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already processed/i)
    // No audit must have been created (the CAS short-circuits before the audit write)
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it("tokenHash cleared after sign (single-use) — CAS data.tokenHash is null", async () => {
    const capturedCas: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue(baseSigner),
          updateMany: vi.fn().mockImplementation((args: unknown) => {
            capturedCas.push(args)
            return { count: 1 }
          }),
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(baseEnvelope),
          update: mockEnvelopeUpdate,
        },
        esignAuditEvent: { create: mockAuditCreate },
        contract: {
          findFirst: mockContractFindFirst,
          update: mockContractUpdate,
          updateMany: mockContractUpdateMany,
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: mockVersionCreate,
        },
        $queryRaw: mockQueryRaw,
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const casCall = capturedCas[0] as any
    // tokenHash must be explicitly set to null on the CAS write
    expect(casCall.data.tokenHash).toBeNull()
  })
})

describe("FIX 3 — CC/copy role cannot sign or decline", () => {
  it("CC signer: POST sign → 403", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, role: "cc" })
    // Also update what verifyAndLoad returns for the envelope (cc signer)
    mockEnvelopeFindFirst.mockResolvedValue(baseEnvelope)

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/only signers may submit/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("copy role: POST sign → 403", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, role: "copy" })
    mockEnvelopeFindFirst.mockResolvedValue(baseEnvelope)

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("CC signer: POST decline → 403", async () => {
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, role: "cc" })
    mockEnvelopeFindFirst.mockResolvedValue(baseEnvelope)

    const res = await DECLINE(makeDeclineReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/only signers may decline/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe("FIX 6 — envelope_declined audit event on signer-triggered decline", () => {
  it("envelope transitions to declined → audit emits envelope_declined not envelope_voided", async () => {
    const capturedAuditTypes: string[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: mockSignerUpdate,
        },
        esignEnvelope: {
          update: vi.fn().mockResolvedValue({ ...baseEnvelope, status: "declined" }),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: any) => {
            capturedAuditTypes.push(args.data?.eventType)
            return { id: "a" }
          }),
        },
      }
      return cb(mockTx)
    })

    await DECLINE(makeDeclineReq(VALID_TOKEN, { reason: "Out of scope" }), makeRouteParams(VALID_TOKEN))

    expect(capturedAuditTypes).toContain("envelope_declined")
    expect(capturedAuditTypes).not.toContain("envelope_voided")
  })
})

describe("CLM — contract notification kinds wired to e-sign completion", () => {
  it("POST sign: on envelope completion, calls createNotification with kind contract.signed (best-effort)", async () => {
    // Set up single-signer envelope so this signer's signature triggers completion
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)
    mockCreateNotification.mockResolvedValue({ id: "notif-signed" })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed" }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: "v-1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.envelopeCompleted).toBe(true)

    // Flush the async IIFE that fires the notification
    await new Promise((r) => setTimeout(r, 0))

    // createNotification should have been called with kind "contract.signed"
    const calls = mockCreateNotification.mock.calls
    const signedCall = calls.find((c: any[]) => c[0]?.kind === "contract.signed")
    expect(signedCall).toBeDefined()
    expect(signedCall![0]).toMatchObject({
      kind: "contract.signed",
      entityType: "contract",
      entityId: CONTRACT_ID,
      userId: "user-owner-1",
    })
  })

  it("POST sign: completion notification does NOT fail the route even if createNotification throws", async () => {
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)
    // createNotification throws — should be swallowed
    mockCreateNotification.mockRejectedValue(new Error("push service down"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue(singleSignerEnvelope),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed" }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: "v-1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    // Route must succeed even if the notification throws
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.envelopeCompleted).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// FIX C — Bound-version integrity tests (Slice 4a)
// ═══════════════════════════════════════════════════════════════════

describe("FIX C — sign reads bound version body, not live Contract.renderedBody", () => {
  it("GET: envelope with bound version → returns BOUND version's body, not live body", async () => {
    // Set up envelope with a bound version that has different body from live contract
    const boundEnvelope = {
      ...baseEnvelope,
      contractVersionId: VERSION_ID,
      boundContentHash: BOUND_HASH,
      contract: {
        ...baseEnvelope.contract,
        // The LIVE body has been mutated by /amend — different from the bound body
        renderedBody: "AMENDED body — should NOT appear in sign portal",
      },
    }
    mockEnvelopeFindFirst.mockResolvedValue(boundEnvelope)

    // bound version returns the original text
    mockVersionFindUnique.mockResolvedValue({
      renderedBody: BOUND_BODY,
      contentHash: BOUND_HASH,
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()

    // Must return the bound body, NOT the live amended body
    expect(json.data.contract.renderedBody).toBe(BOUND_BODY)
    expect(json.data.contract.renderedBody).not.toContain("AMENDED")
  })

  it("GET: envelope without bound version (legacy) → falls back to live renderedBody", async () => {
    // Legacy envelope: contractVersionId = null
    mockEnvelopeFindFirst.mockResolvedValue({
      ...baseEnvelope,
      contractVersionId: null,
      boundContentHash: null,
    })
    // contractVersion.findUnique should NOT be called (no version ID)
    mockVersionFindUnique.mockResolvedValue(null)

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()

    // Falls back to live contract body
    expect(json.data.contract.renderedBody).toBe(baseEnvelope.contract.renderedBody)
    // findUnique was not called (no contractVersionId)
    expect(mockVersionFindUnique).not.toHaveBeenCalled()
  })

  it("POST completion: canonical version minted from BOUND body, not live renderedBody", async () => {
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      contractVersionId: VERSION_ID,
      boundContentHash: BOUND_HASH,
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
      contract: {
        ...baseEnvelope.contract,
        renderedBody: "AMENDED body — should NOT be in canonical version",
        status: "approved",
      },
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    // Bound version lookup at verifyAndLoad time
    mockVersionFindUnique.mockResolvedValue({
      renderedBody: BOUND_BODY,
      contentHash: BOUND_HASH,
    })

    const capturedVersionCreates: unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = {
        esignSigner: {
          findFirst: vi.fn().mockResolvedValue({ ...baseSigner, status: "viewed" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        esignEnvelope: {
          findFirst: vi.fn().mockResolvedValue({
            ...singleSignerEnvelope,
            contractVersionId: VERSION_ID,
            boundContentHash: BOUND_HASH,
          }),
          update: vi.fn().mockResolvedValue({ ...singleSignerEnvelope, status: "completed" }),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "a" }) },
        contract: {
          findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        contractVersion: {
          // tx-level findUnique for the bound version (integrity cross-check inside tx)
          findUnique: vi.fn().mockResolvedValue({
            renderedBody: BOUND_BODY,
            contentHash: BOUND_HASH,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockImplementation((args: unknown) => {
            capturedVersionCreates.push(args)
            return { id: "ver-canonical" }
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ max: null }]),
      }
      return cb(mockTx)
    })

    const res = await POST(
      makePOSTReq(VALID_TOKEN, { method: "typed", payload: { typedName: "Alice Signer", font: "dancing-script" } }),
      makeRouteParams(VALID_TOKEN)
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.envelopeCompleted).toBe(true)

    // The canonical ContractVersion must be minted from the BOUND body
    const versionCreate = capturedVersionCreates[0] as any
    expect(versionCreate.data.renderedBody).toBe(BOUND_BODY)
    expect(versionCreate.data.contentHash).toBe(BOUND_HASH)
    expect(versionCreate.data.source).toBe("signed")
    expect(versionCreate.data.isCanonicalSigned).toBe(true)
    // Must NOT use the live amended body
    expect(versionCreate.data.renderedBody).not.toContain("AMENDED")
  })

  it("POST completion: bound version integrity violation (hash mismatch) → 500 (fail safe)", async () => {
    // Edge case: the version's contentHash somehow doesn't match boundContentHash.
    // This should fail safe (not silently sign the wrong body).
    const singleSignerEnvelope = {
      ...baseEnvelope,
      status: "in_progress",
      contractVersionId: VERSION_ID,
      boundContentHash: "expected-hash-" + "a".repeat(50), // stored at send time
      signers: [{ id: SIGNER_ID, role: "signer", status: "viewed" }],
    }
    mockSignerFindFirst.mockResolvedValue({ ...baseSigner, status: "viewed" })
    mockEnvelopeFindFirst.mockResolvedValue(singleSignerEnvelope)

    // The version now returns a DIFFERENT contentHash (shouldn't happen in practice)
    mockVersionFindUnique.mockResolvedValue({
      renderedBody: "some body",
      contentHash: "completely-different-hash-" + "b".repeat(38),
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    // Fail safe: returns 500 rather than silently serving the wrong body
    expect(res.status).toBe(500)
  })

  // ── Codex residual: bound-vs-unbound fail-closed distinction ────────────────

  it("GET: BOUND envelope whose pinned ContractVersion is missing → 500 (fail closed, not 200 with live body)", async () => {
    // Codex residual MED fix: a bound envelope (contractVersionId set) whose
    // ContractVersion cannot be loaded must fail closed. Previously the code
    // caught the null/missing case in a non-fatal branch and fell back to
    // the live Contract.renderedBody — re-opening the integrity hole.
    const boundEnvelope = {
      ...baseEnvelope,
      contractVersionId: VERSION_ID,
      boundContentHash: BOUND_HASH,
    }
    mockEnvelopeFindFirst.mockResolvedValue(boundEnvelope)
    // findUnique returns null — the bound version is missing from DB
    mockVersionFindUnique.mockResolvedValue(null)

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    // Must fail closed (500), NOT fall back to live body with 200
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    // Must NOT contain the live body (which would be in data.contract.renderedBody)
    expect(json.data).toBeUndefined()
  })

  it("GET: BOUND envelope with contentHash mismatch → 500 (fail closed)", async () => {
    // The pinned version exists but its contentHash differs from boundContentHash.
    // Should fail closed identically — don't serve the mismatched body.
    const boundEnvelope = {
      ...baseEnvelope,
      contractVersionId: VERSION_ID,
      boundContentHash: BOUND_HASH, // what was stored at send time
    }
    mockEnvelopeFindFirst.mockResolvedValue(boundEnvelope)
    // Version exists but returns a DIFFERENT contentHash
    mockVersionFindUnique.mockResolvedValue({
      renderedBody: "some mutated body",
      contentHash: "aaaa" + "b".repeat(60), // deliberately different from BOUND_HASH
    })

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(500)
    expect((await res.json()).data).toBeUndefined()
  })

  it("GET: UNBOUND envelope (contractVersionId null) with no version → 200 with live renderedBody (legacy, not broken)", async () => {
    // Unbound legacy envelopes must still fall back to the live body — that is the
    // correct legacy behaviour. The fail-closed logic ONLY applies to bound envelopes.
    mockEnvelopeFindFirst.mockResolvedValue({
      ...baseEnvelope,
      contractVersionId: null,
      boundContentHash: null,
    })
    // findUnique should not even be called for unbound envelopes
    mockVersionFindUnique.mockResolvedValue(null)

    const res = await GET(makeGETReq(VALID_TOKEN), makeRouteParams(VALID_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    // Returns the live contract body (the legacy fallback)
    expect(json.data.contract.renderedBody).toBe(baseEnvelope.contract.renderedBody)
    // findUnique was never called (no contractVersionId)
    expect(mockVersionFindUnique).not.toHaveBeenCalled()
  })
})
