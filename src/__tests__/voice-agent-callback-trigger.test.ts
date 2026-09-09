/**
 * The point where a finished call becomes an outgoing one.
 *
 * Two properties matter more than the happy path: it must never dial when the
 * evidence does not call for it, and it must never throw — its caller is the
 * PBX result webhook, which retries, and an exception here would turn one
 * broken call into repeated re-processing of a result already stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  placeCallback: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { callLog: { findFirst: mocks.findFirst } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/voice-agent/place-callback", () => ({
  placeCallback: mocks.placeCallback,
}))

import { maybePlaceCallback } from "@/lib/voice-agent/callback-trigger"

const ORG = "org-test"
const now = new Date("2026-08-17T12:00:00.000Z")

function brokenCall(overrides: Record<string, unknown> = {}) {
  return {
    callMode: "ai",
    duration: 40,
    agentMidUtterance: true,
    recoveryAttempts: 0,
    continuesCallId: null,
    endedAt: new Date(now.getTime() - 30_000),
    ...overrides,
  }
}

const TURNS = [
  { role: "agent", text: "Qiymət üç yüz manatdır..." },
  { role: "customer", text: "Hə." },
]

beforeEach(() => {
  mocks.findFirst.mockReset()
  mocks.placeCallback.mockReset()
  mocks.findFirst.mockResolvedValue(brokenCall())
  mocks.placeCallback.mockResolvedValue({ placed: true, callLogId: "call-new", providerCallId: "pc" })
})

describe("maybePlaceCallback", () => {
  it("places a callback when the call was cut off mid-sentence", async () => {
    const result = await maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })

    expect(result.decision).toEqual({ callback: true, reason: "agent_cut_off" })
    expect(mocks.placeCallback).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      originalCallLogId: "call-1",
    }))
  })

  it("does not dial when the agent had signed off", async () => {
    // The goodbye is read from the transcript here, not from the PBX, which
    // can only see whether audio was still owed.
    const result = await maybePlaceCallback({
      organizationId: ORG,
      callLogId: "call-1",
      turns: [...TURNS, { role: "agent", text: "Çox sağ olun, görüşərik." }],
      now,
    })

    expect(result.decision).toEqual({ callback: false, reason: "agent_said_goodbye" })
    expect(mocks.placeCallback).not.toHaveBeenCalled()
  })

  it("does not dial when nothing says the call broke", async () => {
    mocks.findFirst.mockResolvedValue(brokenCall({ agentMidUtterance: false }))

    const result = await maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })

    expect(result.decision.callback).toBe(false)
    expect(mocks.placeCallback).not.toHaveBeenCalled()
  })

  it("swallows a placement failure instead of failing the webhook", async () => {
    // The webhook retries. An exception here would re-process a call result
    // that was already stored correctly.
    mocks.placeCallback.mockRejectedValue(new Error("provider exploded"))

    await expect(maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })).resolves.toEqual(expect.objectContaining({ placement: null }))
  })

  it("swallows a database failure the same way", async () => {
    mocks.findFirst.mockRejectedValue(new Error("db down"))

    await expect(maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })).resolves.toEqual(expect.objectContaining({ placement: null }))
    expect(mocks.placeCallback).not.toHaveBeenCalled()
  })

  it("does nothing for a call it cannot find", async () => {
    mocks.findFirst.mockResolvedValue(null)

    const result = await maybePlaceCallback({
      organizationId: ORG, callLogId: "missing", turns: TURNS, now,
    })

    expect(result.placement).toBeNull()
    expect(mocks.placeCallback).not.toHaveBeenCalled()
  })

  it("reports a refusal from the placement without treating it as an error", async () => {
    mocks.placeCallback.mockResolvedValue({ placed: false, reason: "not_enabled" })

    const result = await maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })

    expect(result.decision.callback).toBe(true)
    expect(result.placement).toEqual({ placed: false, reason: "not_enabled" })
  })

  it("never gives a callback a callback of its own", async () => {
    mocks.findFirst.mockResolvedValue(brokenCall({ continuesCallId: "call-parent" }))

    const result = await maybePlaceCallback({
      organizationId: ORG, callLogId: "call-1", turns: TURNS, now,
    })

    expect(result.decision).toEqual({ callback: false, reason: "already_a_callback" })
    expect(mocks.placeCallback).not.toHaveBeenCalled()
  })
})
