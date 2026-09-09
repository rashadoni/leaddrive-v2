/**
 * CLM Slice 2a — API tests for:
 *   POST /api/v1/contracts/[id]/esign         (create envelope)
 *   GET  /api/v1/contracts/[id]/esign         (list envelopes)
 *   POST /api/v1/contracts/[id]/esign/[envelopeId]/send  (send envelope)
 *
 * Coverage:
 *   Create envelope:
 *     - Happy path: envelope + signers created, 201
 *     - 404 on contract belonging to foreign org (cross-tenant guard)
 *     - 400 on empty signers array
 *     - 400 on invalid email in signers
 *     - Signer order defaults to array index + 1 when not supplied
 *
 *   List envelopes:
 *     - Happy path: returns envelopes with signers, 200
 *     - tokenHash never present in response
 *
 *   Send:
 *     - Happy path: status created→sent, tokens issued, tokenHash set, audit event
 *     - 409 when envelope already sent (state-machine blocks)
 *     - ESIGN_SECRET missing → 500
 *
 *   Auth + module gate:
 *     - 401 when no org session
 *     - 403 when contracts module disabled
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findFirst: vi.fn() },
    esignEnvelope: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    esignSigner: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    esignAuditEvent: { create: vi.fn() },
    // FIX B: send route uses contractVersion.findFirst + create + $queryRaw for version binding
    contractVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ver-bound-1", versionNo: 1, contentHash: "a".repeat(64) }),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ max: null }]),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(
    (moduleId: string) =>
      new NextResponse(JSON.stringify({ error: `Module ${moduleId} is not enabled` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { POST as createEnvelope, GET as listEnvelopes } from "@/app/api/v1/contracts/[id]/esign/route"
import { POST as sendEnvelope } from "@/app/api/v1/contracts/[id]/esign/[envelopeId]/send/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const ENVELOPE_ID = "env-1"

function makeCreateReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/esign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "test-agent" },
    body: JSON.stringify(body),
  })
}

function makeGetReq(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/esign`, {
    method: "GET",
  })
}

function makeSendReq(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/esign/${ENVELOPE_ID}/send`,
    {
      method: "POST",
      headers: body
        ? { "user-agent": "test-agent", "Content-Type": "application/json" }
        : { "user-agent": "test-agent" },
      body: body ? JSON.stringify(body) : undefined,
    },
  )
}

function makeContractParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CONTRACT_ID }) }
}

function makeSendParams(): { params: Promise<{ id: string; envelopeId: string }> } {
  return { params: Promise.resolve({ id: CONTRACT_ID, envelopeId: ENVELOPE_ID }) }
}

const baseContract = { id: CONTRACT_ID, organizationId: ORG_ID, title: "Test Contract", status: "approved", signedAt: null, renderedBody: "Contract body text." }

const baseEnvelope = {
  id: ENVELOPE_ID,
  organizationId: ORG_ID,
  contractId: CONTRACT_ID,
  subject: "Please sign",
  message: "Thank you",
  status: "created",
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  sentAt: null,
  completedAt: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  metadata: {},
  createdBy: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  contract: { id: CONTRACT_ID, title: "Test Contract", status: "approved", signedAt: null, renderedBody: "Contract body text." },
  signers: [
    {
      id: "signer-1",
      organizationId: ORG_ID,
      envelopeId: ENVELOPE_ID,
      fullName: "Alice Signer",
      email: "alice@example.com",
      order: 1,
      role: "signer",
      status: "pending",
      tokenHash: null,
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
    },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = () => vi.mocked((prisma as any).$transaction)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
  vi.mocked(getSession).mockResolvedValue({
    userId: "user-1",
    orgId: ORG_ID,
    role: "admin",
  } as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
  // Default: contract found in org
  vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(baseContract)

  // FIX B: defaults for contractVersion find-or-mint (no existing version → mint one)
  vi.mocked((prisma as any).contractVersion.findFirst).mockResolvedValue(null)
  vi.mocked((prisma as any).contractVersion.create).mockResolvedValue({
    id: "ver-bound-1", versionNo: 1, contentHash: "a".repeat(64),
  })
  vi.mocked((prisma as any).$queryRaw).mockResolvedValue([{ max: null }])

  // Set ESIGN_SECRET for tests that use it
  process.env.ESIGN_SECRET = "test-secret-that-is-32-chars-long!!"
  process.env.NEXT_PUBLIC_BASE_URL = "https://app.example.com"
})

afterEach(() => {
  delete process.env.ESIGN_SECRET
  delete process.env.NEXT_PUBLIC_BASE_URL
})

// ─── Create envelope tests ────────────────────────────────────────────────────

describe("POST /api/v1/contracts/[id]/esign — create envelope", () => {
  it("happy path: creates envelope + signers, returns 201", async () => {
    const createdEnvelope = { ...baseEnvelope, signers: [] }
    const createdSigner = baseEnvelope.signers[0]

    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contract: { findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }) },
        esignEnvelope: { create: vi.fn().mockResolvedValue(createdEnvelope) },
        esignSigner: { create: vi.fn().mockResolvedValue(createdSigner) },
      }
      const result = await cb(mockTx)
      return result
    })

    const res = await createEnvelope(
      makeCreateReq({
        subject: "Please sign",
        message: "Thank you",
        signers: [{ fullName: "Alice Signer", email: "alice@example.com" }],
      }),
      makeContractParams(),
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.envelope.id).toBe(ENVELOPE_ID)
    expect(json.data.envelope.status).toBe("created")
    expect(json.data.signers).toHaveLength(1)
    expect(json.data.signers[0].fullName).toBe("Alice Signer")
    // tokenHash must NOT be in the response
    expect(json.data.signers[0].tokenHash).toBeUndefined()
    expect(mockTransaction()).toHaveBeenCalledTimes(1)
  })

  it("defaults signer order to array index + 1 when not supplied", async () => {
    const capturedSignerCreates: any[] = []
    const firstSigner = { ...baseEnvelope.signers[0], id: "signer-1" }
    const secondSigner = { ...baseEnvelope.signers[0], id: "signer-2", email: "bob@example.com", fullName: "Bob", order: 2 }

    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contract: { findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }) },
        esignEnvelope: { create: vi.fn().mockResolvedValue({ ...baseEnvelope, signers: [] }) },
        esignSigner: {
          create: vi.fn().mockImplementation((args: any) => {
            capturedSignerCreates.push(args)
            const idx = capturedSignerCreates.length - 1
            return idx === 0 ? firstSigner : secondSigner
          }),
        },
      }
      return await cb(mockTx)
    })

    await createEnvelope(
      makeCreateReq({
        signers: [
          { fullName: "Alice", email: "alice@example.com" },
          { fullName: "Bob", email: "bob@example.com" },
        ],
      }),
      makeContractParams(),
    )

    expect(capturedSignerCreates[0].data.order).toBe(1)
    expect(capturedSignerCreates[1].data.order).toBe(2)
  })

  it("returns 404 when contract belongs to different org (cross-tenant guard)", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(null)

    const res = await createEnvelope(
      makeCreateReq({ signers: [{ fullName: "Alice", email: "alice@example.com" }] }),
      makeContractParams(),
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/not found/i)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 409 when contract is already signed (signedAt set)", async () => {
    // Simulate a contract that has already been fully executed.
    // A second envelope must not be created — doing so could mint a 2nd
    // canonical ContractVersion at envelope completion.
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue({
      ...baseContract,
      signedAt: new Date("2026-06-01T10:00:00Z"),
    })

    const res = await createEnvelope(
      makeCreateReq({ signers: [{ fullName: "Alice", email: "alice@example.com" }] }),
      makeContractParams(),
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already signed/i)
    // No DB writes should occur
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 409 when contract is not approved yet", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue({
      ...baseContract,
      status: "draft",
    })

    const res = await createEnvelope(
      makeCreateReq({ signers: [{ fullName: "Alice", email: "alice@example.com" }] }),
      makeContractParams(),
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/approved or active before e-signature/i)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 400 when signers array is empty", async () => {
    const res = await createEnvelope(
      makeCreateReq({ signers: [] }),
      makeContractParams(),
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  it("returns 400 when a signer email is invalid", async () => {
    const res = await createEnvelope(
      makeCreateReq({
        signers: [{ fullName: "Alice", email: "not-an-email" }],
      }),
      makeContractParams(),
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)

    const res = await createEnvelope(
      makeCreateReq({ signers: [{ fullName: "Alice", email: "alice@example.com" }] }),
      makeContractParams(),
    )

    expect(res.status).toBe(403)
  })

  it("returns 401 when no org session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)

    const res = await createEnvelope(
      makeCreateReq({ signers: [{ fullName: "Alice", email: "alice@example.com" }] }),
      makeContractParams(),
    )

    expect(res.status).toBe(401)
  })
})

// ─── List envelopes tests ─────────────────────────────────────────────────────

describe("GET /api/v1/contracts/[id]/esign — list envelopes", () => {
  it("returns envelopes with signers (tokenHash excluded)", async () => {
    const envelopeWithHash = {
      ...baseEnvelope,
      signers: [{ ...baseEnvelope.signers[0], tokenHash: "some-hash" }],
    }
    vi.mocked((prisma as any).esignEnvelope.findMany).mockResolvedValue([envelopeWithHash])

    const res = await listEnvelopes(makeGetReq(), makeContractParams())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].id).toBe(ENVELOPE_ID)
    expect(json.data[0].signers).toHaveLength(1)
    // tokenHash must NEVER appear in the list response
    expect(json.data[0].signers[0].tokenHash).toBeUndefined()
    // signaturePayload must NEVER appear
    expect(json.data[0].signers[0].signaturePayload).toBeUndefined()
  })

  it("returns 404 when contract not found in org", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(null)

    const res = await listEnvelopes(makeGetReq(), makeContractParams())

    expect(res.status).toBe(404)
  })

  it("returns 401 when no org session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await listEnvelopes(makeGetReq(), makeContractParams())
    expect(res.status).toBe(401)
  })
})

// ─── Send envelope tests ──────────────────────────────────────────────────────

describe("POST /api/v1/contracts/[id]/esign/[envelopeId]/send", () => {
  it("happy path: transitions created→sent, issues tokens, stores tokenHash, appends audit event", async () => {
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(baseEnvelope)

    const updatedEnvelope = { ...baseEnvelope, status: "sent", sentAt: new Date() }
    const updatedSigner = { ...baseEnvelope.signers[0], status: "sent", tokenHash: "stored-hash" }

    mockTransaction().mockImplementation(async (cb: any) => {
      const capturedAuditCreate: any[] = []
      const capturedSignerUpdates: any[] = []

      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contract: { findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }) },
        esignSigner: {
          updateMany: vi.fn().mockImplementation((args: any) => {
            capturedSignerUpdates.push(args)
            return { count: 1 }
          }),
          findMany: vi.fn().mockResolvedValue([updatedSigner]),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedEnvelope),
        },
        esignAuditEvent: {
          create: vi.fn().mockImplementation((args: any) => {
            capturedAuditCreate.push(args)
            return { id: "audit-1" }
          }),
        },
      }

      const result = await cb(mockTx)

      // Verify signer got a tokenHash (not null)
      expect(capturedSignerUpdates[0].data.tokenHash).toBeTruthy()
      expect(capturedSignerUpdates[0].data.status).toBe("sent")

      // Verify audit event was appended
      expect(capturedAuditCreate).toHaveLength(1)
      expect(capturedAuditCreate[0].data.eventType).toBe("envelope_sent")
      expect(capturedAuditCreate[0].data.actorType).toBe("user")

      return result
    })

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.envelope.status).toBe("sent")
    expect(json.data.signers[0].status).toBe("sent")
    // tokenHash must NOT be in the response
    expect(json.data.signers[0].tokenHash).toBeUndefined()
    // signingLinks should be returned
    expect(json.data.signingLinks).toHaveLength(1)
    expect(json.data.signingLinks[0].signingLink).toContain("/sign/")
    expect(json.data.signingLinks[0].email).toBe("alice@example.com")
    expect(mockTransaction()).toHaveBeenCalledTimes(1)
  })

  it("Codex HIGH: returns 400 UNRESOLVED_VARIABLES when contract body still has {{vars}} (authoritative gate before binding)", async () => {
    // Body became dirty after submit — a {{var}} was (re)introduced. The send
    // route is the last chokepoint before the body is bound to an envelope and
    // sent for signature, so it MUST reject regardless of the submit gate.
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue({
      ...baseEnvelope,
      contract: { ...baseEnvelope.contract, renderedBody: "Pay {{amount}} to {{vendor}} by {{dueDate}}." },
    })

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("UNRESOLVED_VARIABLES")
    expect(json.variables).toEqual(["amount", "vendor", "dueDate"])
    // Gate must fire BEFORE the binding transaction — nothing is minted or sent.
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 409 when envelope is already sent (state-machine rejects created→sent→sent)", async () => {
    const sentEnvelope = { ...baseEnvelope, status: "sent" }
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(sentEnvelope)

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 409 when envelope is completed (terminal state)", async () => {
    const completedEnvelope = { ...baseEnvelope, status: "completed" }
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(completedEnvelope)

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(409)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 404 when envelope not found (or belongs to different org/contract)", async () => {
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(null)

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(404)
  })

  it("returns 500 when ESIGN_SECRET is missing", async () => {
    delete process.env.ESIGN_SECRET

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/secret/i)
  })

  it("FIX 4: returns 409 when contract is already signed (do not issue live links)", async () => {
    // FIX 4 (MED): If the contract already has signedAt set, the esign send must
    // be blocked. Issuing new tokens on a fully-executed contract creates live links
    // that reference a completed artifact.
    const signedEnvelope = {
      ...baseEnvelope,
      status: "created",
      contract: { id: CONTRACT_ID, title: "Test Contract", status: "approved", signedAt: new Date("2026-06-01T10:00:00Z") },
    }
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(signedEnvelope)

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already signed/i)
    // No tokens must have been issued or DB writes made
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 409 when contract is not approved at send time", async () => {
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue({
      ...baseEnvelope,
      contract: { ...baseEnvelope.contract, status: "draft", signedAt: null },
    })

    const res = await sendEnvelope(makeSendReq(), makeSendParams())

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/approved or active before e-signature/i)
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("returns 401 when no org session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await sendEnvelope(makeSendReq(), makeSendParams())
    expect(res.status).toBe(401)
  })

  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await sendEnvelope(makeSendReq(), makeSendParams())
    expect(res.status).toBe(403)
  })

  // Slice 7d (Codex hardening): non-native provider sends hard-rejected EARLY
  it("returns 501 EARLY for provider=docusign — no envelope DB touch, native preflight not run", async () => {
    // Arrange: do NOT set up esignEnvelope.findFirst — if the route touches the DB
    // before the early-501 guard, this mock returning undefined would expose the bug.
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(undefined)

    const res = await sendEnvelope(makeSendReq({ provider: "docusign" }), makeSendParams())

    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json.error).toMatch(/external e-signature providers/i)
    expect(json.error).toMatch(/not yet available/i)
    // Critical: envelope was NOT queried — the early gate fired before any DB touch
    expect((prisma as any).esignEnvelope.findFirst).not.toHaveBeenCalled()
    // Critical: no $transaction ran — native preflight was not entered
    expect(mockTransaction()).not.toHaveBeenCalled()
  })

  it("native flow runs normally when provider=native is explicitly specified", async () => {
    // Arrange: same as the happy-path test, but explicitly passing provider:"native"
    vi.mocked((prisma as any).esignEnvelope.findFirst).mockResolvedValue(baseEnvelope)

    const updatedEnvelope = { ...baseEnvelope, status: "sent", sentAt: new Date() }
    const updatedSigner = { ...baseEnvelope.signers[0], status: "sent", tokenHash: "stored-hash" }

    mockTransaction().mockImplementation(async (cb: any) => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        contract: { findFirst: vi.fn().mockResolvedValue({ status: "approved", signedAt: null }) },
        esignSigner: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([updatedSigner]),
        },
        esignEnvelope: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedEnvelope),
        },
        esignAuditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-2" }) },
      }
      return await cb(mockTx)
    })

    const res = await sendEnvelope(makeSendReq({ provider: "native" }), makeSendParams())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.envelope.status).toBe("sent")
    // The $transaction ran — native path was entered
    expect(mockTransaction()).toHaveBeenCalledTimes(1)
  })
})
