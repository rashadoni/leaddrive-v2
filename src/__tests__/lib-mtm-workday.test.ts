import { describe, expect, it, vi } from "vitest"
import {
  applyMtmWorkdayEvent,
  mtmWorkdayReplayMatches,
  mtmWorkdayRequestHash,
  parseMtmWorkdayEvent,
  recoveryActionsForMtmWorkday,
} from "@/lib/mtm/workday"
import { makeMtmPrismaMock } from "./mocks/mtm-prisma"

const SCOPE = { organizationId: "org-1", agentId: "agent-1" }

function workday(overrides: Record<string, unknown> = {}) {
  return {
    id: "workday-1",
    workDate: new Date("2026-07-15T00:00:00.000Z"),
    status: "STARTED",
    startedAt: new Date("2026-07-15T05:00:00.000Z"),
    pausedAt: null,
    completedAt: null,
    totalPausedSeconds: 0,
    startLatitude: 0,
    startLongitude: 0,
    endLatitude: null,
    endLongitude: null,
    createdAt: new Date("2026-07-15T05:00:00.000Z"),
    updatedAt: new Date("2026-07-15T05:00:00.000Z"),
    ...overrides,
  }
}

describe("MTM mobile workday", () => {
  it("derives recovery actions only from a disclosed canonical workday", () => {
    expect(recoveryActionsForMtmWorkday(workday({ status: "STARTED" }))).toEqual(["PAUSE", "FINISH"])
    expect(recoveryActionsForMtmWorkday(workday({ status: "PAUSED" }))).toEqual(["RESUME", "FINISH"])
    expect(recoveryActionsForMtmWorkday(workday({ status: "COMPLETED" }))).toEqual([])
    expect(recoveryActionsForMtmWorkday(null)).toEqual([])
    expect(recoveryActionsForMtmWorkday({ status: "UNKNOWN" })).toEqual([])
  })

  it("parses an organization-local start and preserves zero coordinates", () => {
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-14T20:30:00.000Z",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
    }, "event-1", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    expect(parsed.error).toBeNull()
    expect(parsed.input).toMatchObject({
      action: "START",
      workdayId: "workday-1",
      clientEventId: "event-1",
      workDateKey: "2026-07-15",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
    })
  })

  it("accepts transient QR/device evidence without copying it into the canonical event", () => {
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T05:00:00.000Z",
      attendance: {
        qrToken: "wa1.example.signature",
        device: { enrollmentId: "enrollment-1", signature: "MEQCIFake" },
      },
    }, "event-1", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    expect(parsed.error).toBeNull()
    expect(parsed.input?.attendance).toEqual({
      qrToken: "wa1.example.signature",
      device: { enrollmentId: "enrollment-1", signature: "MEQCIFake" },
    })
  })

  it("records versioned claim/capture/queue provenance without trusting a client receipt time", () => {
    const serverReceivedAt = new Date("2026-07-15T08:00:00.000Z")
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      schemaVersion: 2,
      occurredAt: "2026-07-15T07:55:00.000Z",
      claimedAt: "2026-07-15T07:55:00.000Z",
      capturedAt: "2026-07-15T07:54:58.000Z",
      queuedAt: "2026-07-15T07:55:01.000Z",
    }, "event-provenance", "Asia/Baku", serverReceivedAt)

    expect(parsed.error).toBeNull()
    expect(parsed.input).toMatchObject({
      schemaVersion: 2,
      claimedAt: new Date("2026-07-15T07:55:00.000Z"),
      capturedAt: new Date("2026-07-15T07:54:58.000Z"),
      queuedAt: new Date("2026-07-15T07:55:01.000Z"),
      serverReceivedAt,
    })
  })

  it("rejects out-of-window or internally contradictory offline provenance", () => {
    const now = new Date("2026-07-15T08:00:00.000Z")
    const olderThanSevenDays = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-08T07:59:59.999Z",
    }, "event-expired", "Asia/Baku", now)
    expect(olderThanSevenDays.input).toBeNull()
    expect(olderThanSevenDays.error).toContain("seven-day offline horizon")

    const missingQueue = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      schemaVersion: 2,
      occurredAt: "2026-07-15T07:55:00.000Z",
      claimedAt: "2026-07-15T07:55:00.000Z",
      capturedAt: "2026-07-15T07:55:00.000Z",
    }, "event-missing-queue", "Asia/Baku", now)
    expect(missingQueue.input).toBeNull()
    expect(missingQueue.error).toContain("schemaVersion 2 requires queuedAt")

    const reversedQueue = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      schemaVersion: 2,
      occurredAt: "2026-07-15T07:55:00.000Z",
      claimedAt: "2026-07-15T07:55:00.000Z",
      capturedAt: "2026-07-15T07:55:00.000Z",
      queuedAt: "2026-07-15T07:54:59.000Z",
    }, "event-reversed-queue", "Asia/Baku", now)
    expect(reversedQueue.input).toBeNull()
    expect(reversedQueue.error).toContain("must be ordered")
  })

  it("binds a C1 replay to actor, evidence references and provenance instead of only visible event fields", () => {
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      schemaVersion: 2,
      occurredAt: "2026-07-15T07:55:00.000Z",
      claimedAt: "2026-07-15T07:55:00.000Z",
      capturedAt: "2026-07-15T07:54:58.000Z",
      queuedAt: "2026-07-15T07:55:01.000Z",
      attendance: { qrToken: "wa1.example.signature" },
    }, "event-hash", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    const input = parsed.input!
    const replay = {
      workdayId: input.workdayId,
      type: input.action,
      occurredAt: input.occurredAt,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      note: input.note,
      requestHash: mtmWorkdayRequestHash(SCOPE, input),
    }

    expect(mtmWorkdayReplayMatches(replay, input, SCOPE)).toBe(true)
    expect(mtmWorkdayReplayMatches(replay, {
      ...input,
      attendance: { qrToken: "wa1.changed.signature" },
    }, SCOPE)).toBe(false)
    expect(mtmWorkdayReplayMatches(replay, input)).toBe(false)
  })

  it("creates the shift and immutable START event together", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(db.mtmAgentWorkday.create).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-1",
      workdayId: "workday-1",
      clientEventId: "event-1",
      type: "START",
      occurredAt: new Date("2026-07-15T05:00:00.000Z"),
    } as never)

    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T05:00:00.000Z",
      latitude: 40.4,
      longitude: 49.8,
    }, "event-1", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result.status).toBe("ok")
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    const lockCall = vi.mocked(db.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(lockCall[1]).toBe("mtm-workday:org-1:agent-1")
    expect(vi.mocked(db.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(db.mtmAgentWorkday.findFirst).mock.invocationCallOrder[0])
    expect(db.mtmAgentWorkday.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "workday-1",
        workDate: new Date("2026-07-15T00:00:00.000Z"),
        status: "STARTED",
      }),
    }))
    expect(db.mtmAgentWorkdayEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientEventId: "event-1", type: "START" }),
    }))
  })

  it("refuses a second start on a day already finished (audit A7)", async () => {
    // Owner decision 4: "Finish the day" is final and happens once. Restarting
    // would reopen a shift whose hours are already counted, so the second
    // start is a conflict, not a new day.
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday({
      status: "COMPLETED",
      completedAt: new Date("2026-07-15T15:24:00.000Z"),
    }) as never)

    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-2",
      occurredAt: "2026-07-15T16:00:00.000Z",
    }, "event-restart", "Asia/Baku", new Date("2026-07-15T16:00:00.000Z"))
    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result.status).toBe("conflict")
    expect(result).toMatchObject({ code: "MTM_WORKDAY_ALREADY_EXISTS" })
    expect(db.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("refuses to pause or resume a finished day (audit A7)", async () => {
    for (const action of ["PAUSE", "RESUME", "FINISH"] as const) {
      const db = makeMtmPrismaMock()
      vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday({
        status: "COMPLETED",
        completedAt: new Date("2026-07-15T15:24:00.000Z"),
      }) as never)

      // A transition names the shift with workdayId; only START uses id.
      const parsed = parseMtmWorkdayEvent({
        action,
        workdayId: "workday-1",
        occurredAt: "2026-07-15T16:00:00.000Z",
      }, `event-${action}`, "Asia/Baku", new Date("2026-07-15T16:00:00.000Z"))
      expect(parsed.error).toBeNull()
      const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

      expect(result, `${action} on a completed day`).toMatchObject({
        status: "conflict",
        code: "MTM_WORKDAY_COMPLETED",
      })
      expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    }
  })

  it("runs an attendance post-event guard inside the state mutation and never reruns it for a replay", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(db.mtmAgentWorkday.create).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-guarded",
      workdayId: "workday-1",
      clientEventId: "event-guarded",
      type: "START",
      occurredAt: new Date("2026-07-15T05:00:00.000Z"),
    } as never)
    const afterEvent = vi.fn(async () => undefined)
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T05:00:00.000Z",
      attendance: { qrToken: "wa1.example.signature" },
    }, "event-guarded", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    await expect(applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!, { afterEvent })).resolves.toMatchObject({
      status: "ok",
      idempotent: false,
    })
    expect(afterEvent).toHaveBeenCalledWith(expect.objectContaining({
      workday: expect.objectContaining({ id: "workday-1" }),
      event: expect.objectContaining({ id: "event-guarded" }),
      input: expect.objectContaining({ attendance: { qrToken: "wa1.example.signature" } }),
    }))
    expect(vi.mocked(db.mtmAgentWorkdayEvent.create).mock.invocationCallOrder[0])
      .toBeLessThan(afterEvent.mock.invocationCallOrder[0]!)

    vi.mocked(db.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-guarded",
      workdayId: "workday-1",
      clientEventId: "event-guarded",
      type: "START",
      occurredAt: new Date("2026-07-15T05:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
      createdAt: new Date("2026-07-15T05:00:00.000Z"),
      workday: workday(),
    } as never)
    const replay = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!, { afterEvent })
    expect(replay).toMatchObject({ status: "ok", idempotent: true })
    expect(afterEvent).toHaveBeenCalledTimes(1)
  })

  it("accumulates paused time on resume", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday({
      status: "PAUSED",
      pausedAt: new Date("2026-07-15T06:00:00.000Z"),
      totalPausedSeconds: 120,
    }) as never)
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        occurredAt: new Date("2026-07-15T06:00:00.000Z"),
      } as never)
    vi.mocked(db.mtmAgentWorkday.update).mockResolvedValue(workday({
      totalPausedSeconds: 1_920,
    }) as never)
    vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({ id: "event-resume" } as never)

    const parsed = parseMtmWorkdayEvent({
      action: "RESUME",
      workdayId: "workday-1",
      occurredAt: "2026-07-15T06:30:00.000Z",
    }, "event-resume", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result.status).toBe("ok")
    expect(db.mtmAgentWorkday.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "STARTED",
        pausedAt: null,
        totalPausedSeconds: 1_920,
      },
    }))
  })

  it("takes the agent off the live map when a workday is finished", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ occurredAt: new Date("2026-07-15T06:00:00.000Z") } as never)
    vi.mocked(db.mtmAgentWorkday.update).mockResolvedValue(workday({
      status: "COMPLETED",
      completedAt: new Date("2026-07-15T07:00:00.000Z"),
    }) as never)
    vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({ id: "event-finish" } as never)
    vi.mocked(db.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as never)

    const parsed = parseMtmWorkdayEvent({
      action: "FINISH",
      workdayId: "workday-1",
      occurredAt: "2026-07-15T07:00:00.000Z",
      latitude: 40.4,
      longitude: 49.8,
    }, "event-finish", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result.status).toBe("ok")
    expect(db.mtmAgent.updateMany).toHaveBeenCalledWith({
      where: { id: "agent-1", organizationId: "org-1" },
      data: { isOnline: false },
    })
  })

  it("rejects an out-of-order transition without writing", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        occurredAt: new Date("2026-07-15T07:00:00.000Z"),
      } as never)

    const parsed = parseMtmWorkdayEvent({
      action: "PAUSE",
      workdayId: "workday-1",
      occurredAt: "2026-07-15T06:30:00.000Z",
    }, "event-pause", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result).toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
      workday: { status: "STARTED" },
      allowedActions: ["PAUSE", "FINISH"],
    })
    expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("replays an exact transport-independent event under the shared lock", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-web-1",
      workdayId: "workday-1",
      clientEventId: "event-cross-channel",
      type: "START",
      occurredAt: new Date("2026-07-15T05:00:00.000Z"),
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 8,
      note: null,
      createdAt: new Date("2026-07-15T05:00:00.000Z"),
      workday: workday(),
    } as never)
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T05:00:00.000Z",
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 8,
    }, "event-cross-channel", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result).toMatchObject({
      status: "ok",
      idempotent: true,
      workday: { id: "workday-1" },
      event: { id: "event-web-1", clientEventId: "event-cross-channel" },
    })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(db.mtmAgentWorkdayEvent.findFirst).mock.invocationCallOrder[0])
    expect(db.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("rejects a cross-channel replay when its normalized fingerprint differs", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-web-1",
      workdayId: "workday-1",
      clientEventId: "event-cross-channel",
      type: "START",
      occurredAt: new Date("2026-07-15T05:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: "original",
      createdAt: new Date("2026-07-15T05:00:00.000Z"),
      workday: workday(),
    } as never)
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T05:00:00.000Z",
      note: "different",
    }, "event-cross-channel", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    const result = await applyMtmWorkdayEvent(db as any, SCOPE, parsed.input!)

    expect(result).toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_IDEMPOTENCY_MISMATCH",
    })
    expect(db.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })
})
