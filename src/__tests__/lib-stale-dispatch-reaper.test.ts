import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"

/**
 * One abandoned dispatch caused three separate-looking outages on 2026-08-13:
 * every deploy refused to run, every lead in the organisation reported "a call
 * is already queued", and nothing on screen explained either. Each was cleared
 * by hand, which is not a fix — it is the same incident waiting to recur.
 */

// vi.mock is hoisted above every const, so the spy has to be hoisted with it.
const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn(async () => ({ count: 0 })) }))
vi.mock("@/lib/prisma", () => ({ prisma: { voiceCallSession: { updateMany } } }))

import { reapStaleVoiceDispatches } from "@/lib/voice-agent/stale-dispatch-reaper"

const NOW = new Date("2026-08-13T12:00:00.000Z")

describe("reaping a dispatch nobody finished", () => {
  beforeEach(() => { updateMany.mockClear(); updateMany.mockResolvedValue({ count: 0 }) })

  it("finishes only expired leases, and only the dispatch phase", async () => {
    await reapStaleVoiceDispatches(NOW)
    const where = updateMany.mock.calls[0][0].where
    expect(where.endedAt).toBeNull()
    expect(where.status).toEqual({ in: ["prepared", "dispatching", "dispatch_uncertain"] })
    // The route writes `dispatch_uncertain` itself, with the fences on and no
    // `endedAt`, so nothing downstream could ever finish or release it. Its
    // reconciliation window is the lease; after that it is an abandoned
    // dispatch like any other.
    // A live call must never be reaped for outliving its lease: once it is up,
    // its status has moved past the dispatch phase.
    expect(where.status.in).not.toContain("connected")
    expect(where.status.in).not.toContain("ringing")
    expect(where.leaseUntil).toEqual({ not: null, lt: NOW })
  })

  it("records an unknown outcome rather than inventing one", async () => {
    await reapStaleVoiceDispatches(NOW)
    const data = updateMany.mock.calls[0][0].data
    // The provider never said what happened. "failed" would be a guess written
    // into a call record.
    expect(data.status).toBe("dispatch_uncertain")
    expect(data.endedAt).toBe(NOW)
    expect(data.blockReason).toContain("lease expired")
  })

  it("releases the locks a finished session is still holding", async () => {
    await reapStaleVoiceDispatches(NOW)
    const second = updateMany.mock.calls[1][0]
    // This is the half that was missed by hand: finishing the row without
    // clearing its keys left the organisation locked out of every call.
    expect(second.where.endedAt).toEqual({ not: null })
    expect(second.data).toEqual({
      activeOrganizationKey: null,
      activeLeadKey: null,
      activePhoneKey: null,
    })
  })

  it("never releases the locks of a call still in progress", async () => {
    await reapStaleVoiceDispatches(NOW)
    const second = updateMany.mock.calls[1][0]
    expect(second.where.endedAt).not.toBeNull()
    expect(second.where.endedAt).not.toEqual(null)
  })

  it("reports what it did", async () => {
    updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 3 })
    expect(await reapStaleVoiceDispatches(NOW)).toEqual({ finished: 2, locksReleased: 3 })
  })

  it("runs on every tick, not only when the queue is enabled", () => {
    // The cron spends most of its life with the queue switched off, and that is
    // precisely when an abandoned dispatch would sit blocking deploys.
    const cron = readFileSync("src/app/api/cron/voice-call-queues/route.ts", "utf8")
    const beforeGates = cron.slice(0, cron.indexOf("finalityPilotOrganizationId"))
    expect(beforeGates).toContain("reapStaleVoiceDispatches()")
  })
})
