/**
 * Placing the one automatic callback a broken call earned.
 *
 * Almost every test here proves a refusal. This is the only code in the system
 * that originates a call with no human in the loop, so the question that
 * matters is not "does it dial" but "what stops it".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  FakePausedError: class FakePausedError extends Error {},
}))
const FakePausedError = hoisted.FakePausedError

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogUpdateMany: vi.fn(),
  leadFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  channelFindFirst: vi.fn(),
  sessionUpdateMany: vi.fn(),
  transaction: vi.fn(),
  txCallLogCreate: vi.fn(),
  txSessionCreate: vi.fn(),
  evaluate: vi.fn(),
  initiateCall: vi.fn(),
  assertDispatchAllowed: vi.fn(),
  lockLead: vi.fn(),
  lockContact: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findFirst: mocks.callLogFindFirst, updateMany: mocks.callLogUpdateMany },
    lead: { findFirst: mocks.leadFindFirst },
    user: { findFirst: mocks.userFindFirst },
    channelConfig: { findFirst: mocks.channelFindFirst },
    voiceCallSession: { updateMany: mocks.sessionUpdateMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/voip", () => ({
  getVoipProvider: () => ({ initiateCall: mocks.initiateCall }),
}))
vi.mock("@/lib/voip/outbound-dispatch-lock", () => ({
  assertOutboundVoiceDispatchAllowed: mocks.assertDispatchAllowed,
  OutboundVoiceDispatchPausedError: hoisted.FakePausedError,
}))
vi.mock("@/lib/voice-agent/manual-lead-call", () => ({
  evaluateManualLeadAiCallPolicy: mocks.evaluate,
}))
vi.mock("@/lib/voice-agent/voice-permission-lock", () => ({
  lockVoiceLeadRow: mocks.lockLead,
  lockVoiceContactPermission: mocks.lockContact,
}))

import { Prisma } from "@prisma/client"
import { placeCallback } from "@/lib/voice-agent/place-callback"

const ORG = "org-test"
const PHONE = "+994501234567"

function originalCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-original",
    leadId: "lead-1",
    userId: "user-1",
    channelConfigId: "channel-1",
    targetPhoneE164: PHONE,
    continuedBy: null,
    ...overrides,
  }
}

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    lead: { id: "lead-1", assignedTo: "user-1" },
    targetPhoneE164: PHONE,
    targetDialNumber: "0501234567",
    provider: { fromNumber: "+994120000000", channelConfigId: "channel-1", settings: {} },
    preflight: { eligible: true },
    consentBasis: "existing_relationship",
    policySnapshot: {},
    ...overrides,
  }
}

/** Runs the callback's transaction body against the tx mocks. */
function runTransaction() {
  mocks.transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => unknown)({
        callLog: { create: mocks.txCallLogCreate },
        voiceCallSession: { create: mocks.txSessionCreate },
      })
    }
    return []
  })
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.callLogFindFirst.mockResolvedValue(originalCall())
  mocks.leadFindFirst.mockResolvedValue({ assignedTo: "user-1" })
  mocks.userFindFirst.mockResolvedValue({ role: "manager" })
  mocks.channelFindFirst.mockResolvedValue({ settings: { automaticCallbackEnabled: true } })
  mocks.evaluate.mockResolvedValue(evaluation())
  mocks.txCallLogCreate.mockResolvedValue({ id: "call-callback" })
  mocks.txSessionCreate.mockResolvedValue({ id: "session-callback" })
  mocks.initiateCall.mockImplementation(async ({ correlationId }: { correlationId: string }) => ({
    success: true,
    callSid: correlationId,
  }))
  runTransaction()
  delete process.env.VOICE_AUTOMATIC_CALLBACK_DISABLED
})

afterEach(() => {
  delete process.env.VOICE_AUTOMATIC_CALLBACK_DISABLED
})

describe("placeCallback", () => {
  it("dials the number that broke and links the call to its parent", async () => {
    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({
      placed: true,
      callLogId: "call-callback",
      providerCallId: expect.any(String),
    })
    expect(mocks.initiateCall).toHaveBeenCalledWith(expect.objectContaining({
      toNumber: "0501234567",
      voiceAgent: true,
    }))
    expect(mocks.txCallLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        continuesCallId: "call-original",
        targetPhoneE164: PHONE,
      }),
    }))
  })

  it("refuses when the lead's number changed since the break", async () => {
    // Continuing "the conversation" on an edited number would place a cold
    // automated call to a different person.
    mocks.evaluate.mockResolvedValue(evaluation({ targetPhoneE164: "+994559999999" }))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "number_changed" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("refuses when the kill switch is engaged", async () => {
    process.env.VOICE_AUTOMATIC_CALLBACK_DISABLED = "1"

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "kill_switch" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("refuses when the organisation never switched callbacks on", async () => {
    mocks.channelFindFirst.mockResolvedValue({ settings: {} })

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "not_enabled" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("refuses a call that already has a callback", async () => {
    mocks.callLogFindFirst.mockResolvedValue(originalCall({ continuedBy: { id: "call-existing" } }))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "already_placed" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("loses the race to the unique index rather than dialling twice", async () => {
    // Two placements running concurrently both pass the early check. This is
    // the one that matters: the database rejects the loser.
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    )

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "already_placed" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("calls the dispatch gate with the argument name it actually declares", async () => {
    // The gate takes `tx`. Passing `db` made it dereference undefined, and the
    // generic catch reported that as "dispatch_paused" — a plausible, false
    // explanation that hid the bug through a release. Pinned by shape, because
    // the failure was invisible in behaviour.
    await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(mocks.assertDispatchAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ tx: expect.anything(), organizationId: ORG }),
    )
    expect(mocks.assertDispatchAllowed.mock.calls[0][0]).not.toHaveProperty("db")
  })

  it("reports a genuine dispatch pause as such", async () => {
    mocks.assertDispatchAllowed.mockRejectedValue(new FakePausedError("paused"))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "dispatch_paused" })
  })

  it("does not disguise an unexpected fault as an operator pause", async () => {
    // The whole point of the fix: a bug in this code must not read like a
    // deliberate policy decision in the logs.
    mocks.assertDispatchAllowed.mockRejectedValue(new TypeError("boom"))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "placement_failed" })
  })

  it("refuses when the daily quota is spent", async () => {
    mocks.evaluate.mockResolvedValue(evaluation({ preflight: { eligible: false } }))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "policy_blocked" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("refuses when there is nobody to attribute the call to", async () => {
    mocks.callLogFindFirst.mockResolvedValue(originalCall({ userId: null }))
    mocks.leadFindFirst.mockResolvedValue({ assignedTo: null })

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "no_attributable_user" })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("falls back to the lead owner for an inbound call with no user", async () => {
    mocks.callLogFindFirst.mockResolvedValue(originalCall({ userId: null }))
    mocks.leadFindFirst.mockResolvedValue({ assignedTo: "user-owner" })

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual(expect.objectContaining({ placed: true }))
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "user-owner" }),
    }))
  })

  it("keeps the attempt spent when the provider rejects the dispatch", async () => {
    // "Once" means one dial, not one conversation. The row and its link stay,
    // so a rejected dispatch does not quietly return the retry to the pool.
    mocks.initiateCall.mockResolvedValue({ success: false })

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "dispatch_rejected" })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }))
  })

  it("treats a provider that throws as a rejected dispatch", async () => {
    mocks.initiateCall.mockRejectedValue(new Error("network"))

    const result = await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    expect(result).toEqual({ placed: false, reason: "dispatch_rejected" })
  })

  it("records that no human attested consent for this call", async () => {
    await placeCallback({ organizationId: ORG, originalCallLogId: "call-original" })

    const consent = mocks.txCallLogCreate.mock.calls[0][0].data.consentAudit
    // Naming an attester who was not there would put a fiction into an audit
    // record. Consent is inherited, and the record says exactly that.
    expect(consent.attestedByUserId).toBeNull()
    expect(consent.automaticCallback).toBe(true)
    expect(consent.inheritedFromCallLogId).toBe("call-original")
  })
})
