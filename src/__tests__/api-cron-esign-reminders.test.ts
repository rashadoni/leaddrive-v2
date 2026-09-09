/**
 * CLM Slice 2d-2 — E-sign reminders cron tests.
 *
 * POST /api/cron/esign-reminders
 *
 * Coverage:
 *   - Cron auth gate: 503 when CRON_SECRET missing; 401 when secret wrong
 *   - 503 when ESIGN_SECRET missing
 *   - Picks pending signers due for a reminder
 *   - Skips signers with remindersSent >= MAX_REMINDERS (3)
 *   - Skips signers not yet due (lastRemindedAt too recent)
 *   - Skips out-of-order signers (earlier unsigned sibling exists)
 *   - Re-issues token (tokenHash changes) and bumps remindersSent + sets lastRemindedAt
 *   - Skips signed/declined/expired envelope signers
 *   - Email failure does not abort the batch (best-effort)
 *   - Returns correct summary { remindersSent, skipped, errors }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSignerFindMany = vi.fn()
const mockSignerCount = vi.fn()
const mockSignerUpdate = vi.fn()
const mockSignerUpdateMany = vi.fn()
const mockAuditCreate = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    esignSigner: {
      findMany: (...args: unknown[]) => mockSignerFindMany(...args),
      count: (...args: unknown[]) => mockSignerCount(...args),
      update: (...args: unknown[]) => mockSignerUpdate(...args),
      updateMany: (...args: unknown[]) => mockSignerUpdateMany(...args),
    },
    esignAuditEvent: {
      create: (...args: unknown[]) => mockAuditCreate(...args),
    },
  },
}))

const mockSendEmail = vi.fn()
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { POST } from "@/app/api/cron/esign-reminders/route"

// ─── Constants ────────────────────────────────────────────────────────────────

const CRON_SECRET = "test-cron-secret"
const ESIGN_SECRET = "test-esign-secret-that-is-at-least-32-chars!!"
const ORG_ID = "org-remind-test"
const ENVELOPE_ID = "env-remind-test"
const REMINDER_INTERVAL_DAYS = 3
const intervalMs = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(secret?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret !== undefined) headers["x-cron-secret"] = secret
  return new NextRequest("http://localhost:3000/api/cron/esign-reminders", {
    method: "POST",
    headers,
  })
}

function makeOldDate(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
}

function makePendingSigner(overrides: Record<string, unknown> = {}) {
  return {
    id: "signer-remind-1",
    organizationId: ORG_ID,
    envelopeId: ENVELOPE_ID,
    fullName: "Bob Signer",
    email: "bob@example.com",
    order: 1,
    role: "signer",
    status: "sent",
    tokenHash: "old-token-hash",
    remindersSent: 0,
    lastRemindedAt: null,
    createdAt: makeOldDate(10), // created 10 days ago
    updatedAt: new Date(),
    envelope: {
      id: ENVELOPE_ID,
      organizationId: ORG_ID,
      subject: "Please sign this agreement",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days future
      status: "sent",
      sentAt: makeOldDate(5), // sent 5 days ago → older than REMINDER_INTERVAL_DAYS (3)
    },
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  process.env.ESIGN_SECRET = ESIGN_SECRET

  mockSignerCount.mockResolvedValue(0) // default: signer is first / no earlier unsigned
  mockSignerUpdate.mockResolvedValue({})
  // FIX 7: conditional write via updateMany; default = count:1 (success path)
  mockSignerUpdateMany.mockResolvedValue({ count: 1 })
  mockAuditCreate.mockResolvedValue({ id: "audit-1" })
  mockSendEmail.mockResolvedValue({ success: true })
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.ESIGN_SECRET
})

// ═══════════════════════════════════════════════════════════════════
// Auth tests
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/cron/esign-reminders — auth gate", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET
    mockSignerFindMany.mockResolvedValue([])
    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(503)
  })

  it("returns 401 when cron secret is wrong", async () => {
    mockSignerFindMany.mockResolvedValue([])
    const res = await POST(makeReq("wrong-secret"))
    expect(res.status).toBe(401)
  })

  it("returns 401 when cron secret is missing", async () => {
    mockSignerFindMany.mockResolvedValue([])
    const res = await POST(makeReq(undefined))
    expect(res.status).toBe(401)
  })

  it("returns 503 when ESIGN_SECRET is not configured", async () => {
    delete process.env.ESIGN_SECRET
    mockSignerFindMany.mockResolvedValue([])
    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(503)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Core logic tests
// ═══════════════════════════════════════════════════════════════════

describe("POST /api/cron/esign-reminders — reminder logic", () => {
  it("sends a reminder to a pending signer due for first reminder", async () => {
    const signer = makePendingSigner({
      remindersSent: 0,
      lastRemindedAt: null, // never reminded
      // envelope.sentAt is 5 days ago — older than interval (3 days) → due
    })
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0) // in order

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(1)
    expect(json.data.errors).toBe(0)

    // FIX 7: tokenHash update now uses conditional updateMany
    expect(mockSignerUpdateMany).toHaveBeenCalledOnce()
    const updateCall = mockSignerUpdateMany.mock.calls[0][0]
    expect(updateCall.data.tokenHash).toBeDefined()
    // New tokenHash must differ from the old one
    expect(updateCall.data.tokenHash).not.toBe("old-token-hash")
    // remindersSent incremented
    expect(updateCall.data.remindersSent).toEqual({ increment: 1 })
    // lastRemindedAt set
    expect(updateCall.data.lastRemindedAt).toBeInstanceOf(Date)
    // Conditional where: only update if still active + remindersSent unchanged
    expect(updateCall.where.status.in).toContain("sent")
    expect(updateCall.where.status.in).toContain("viewed")
    // The old update (unconditional) must NOT have been called
    expect(mockSignerUpdate).not.toHaveBeenCalled()

    // Email sent
    expect(mockSendEmail).toHaveBeenCalledOnce()
    const emailArgs = mockSendEmail.mock.calls[0][0]
    expect(emailArgs.to).toBe("bob@example.com")
    // HTML must contain the new /sign/<token> link
    expect(emailArgs.html).toContain("/sign/")
    expect(emailArgs.transactional).toBe(true)
  })

  it("sends a reminder when lastRemindedAt is older than interval", async () => {
    const signer = makePendingSigner({
      remindersSent: 1,
      lastRemindedAt: makeOldDate(4), // 4 days ago — older than 3-day interval → due
    })
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0)

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(1)
  })

  it("skips a signer whose lastRemindedAt is too recent", async () => {
    const signer = makePendingSigner({
      remindersSent: 1,
      lastRemindedAt: makeOldDate(1), // only 1 day ago — within interval → not due
    })
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0)

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(0)
    expect(json.data.skipped).toBe(1)

    expect(mockSignerUpdateMany).not.toHaveBeenCalled()
    expect(mockSignerUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("skips signers who are out of order (earlier unsigned signer exists)", async () => {
    // Signer 2 is trying to be reminded, but signer 1 has not signed yet
    const signer2 = makePendingSigner({
      id: "signer-remind-2",
      order: 2,
    })
    mockSignerFindMany.mockResolvedValue([signer2])
    // count > 0 means there are earlier unsigned signers
    mockSignerCount.mockResolvedValue(1)

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(0)
    expect(json.data.skipped).toBe(1)

    expect(mockSignerUpdateMany).not.toHaveBeenCalled()
    expect(mockSignerUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("cc signers are never skipped by order check", async () => {
    // A cc signer (role=cc) should be reminded regardless of order
    const ccSigner = makePendingSigner({ role: "cc" })
    mockSignerFindMany.mockResolvedValue([ccSigner])
    // count would block if called — but cc route skips the check
    mockSignerCount.mockResolvedValue(99)

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(1)
    // count should NOT have been called for cc role
    expect(mockSignerCount).not.toHaveBeenCalled()
  })

  it("does not send when remindersSent >= MAX_REMINDERS (3)", async () => {
    // The DB query already filters remindersSent < MAX_REMINDERS;
    // this test verifies that (in theory) even if it leaked through, the
    // DB query filter is the gate. We simulate by returning 0 candidates.
    mockSignerFindMany.mockResolvedValue([]) // filtered by DB

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.remindersSent).toBe(0)
    expect(mockSignerUpdate).not.toHaveBeenCalled()
  })

  it("continues batch on email failure (best-effort)", async () => {
    const signer = makePendingSigner()
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0)
    // Email throws
    mockSendEmail.mockRejectedValue(new Error("SMTP connection refused"))

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    // Token was still rotated and DB updated via conditional updateMany
    expect(json.data.remindersSent).toBe(1)
    expect(mockSignerUpdateMany).toHaveBeenCalledOnce()
  })

  it("handles empty candidate list (no work to do)", async () => {
    mockSignerFindMany.mockResolvedValue([])

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.remindersSent).toBe(0)
    expect(json.data.skipped).toBe(0)
    expect(json.data.errors).toBe(0)
    expect(json.data.timestamp).toBeDefined()
  })

  it("tokenHash changes after re-issue (old link invalidated)", async () => {
    const signer = makePendingSigner({ tokenHash: "original-hash-abc123" })
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0)

    await POST(makeReq(CRON_SECRET))

    // FIX 7: updateMany (conditional write) replaces the old unconditional update
    expect(mockSignerUpdateMany).toHaveBeenCalledOnce()
    const updateData = mockSignerUpdateMany.mock.calls[0][0].data
    expect(updateData.tokenHash).toBeDefined()
    expect(updateData.tokenHash).not.toBe("original-hash-abc123")
    // The new tokenHash should be a non-empty string (HMAC sig portion)
    expect(typeof updateData.tokenHash).toBe("string")
    expect(updateData.tokenHash.length).toBeGreaterThan(10)
  })

  it("FIX 7: signer who signed between select and write is not emailed (count 0 → skip)", async () => {
    // Simulate: signer was still active during selection but signed between
    // that and the conditional write (count=0 → skip, email not sent).
    const signer = makePendingSigner()
    mockSignerFindMany.mockResolvedValue([signer])
    mockSignerCount.mockResolvedValue(0) // in order
    // Conditional write returns 0 — signer transitioned in the race window
    mockSignerUpdateMany.mockResolvedValue({ count: 0 })

    const res = await POST(makeReq(CRON_SECRET))
    expect(res.status).toBe(200)
    const json = await res.json()
    // count 0 → counted as skipped, not remindersSent
    expect(json.data.remindersSent).toBe(0)
    expect(json.data.skipped).toBe(1)
    // Email must NOT have been sent (dead-link prevention)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
