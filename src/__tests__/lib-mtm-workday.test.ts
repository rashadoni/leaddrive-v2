import { describe, expect, it, vi } from "vitest"
import {
  applyMtmWorkdayEvent,
  mtmWorkdayReplayMatches,
  mtmWorkdayRequestHash,
  parseMtmWorkdayEvent,
  recoveryForMtmWorkdayConflict,
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

  it("maps every canonical workday conflict to a safe localizable recovery contract", () => {
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_ACTIVE", workday({ status: "PAUSED" }))).toEqual({
      canonicalState: "PAUSED",
      reason: { code: "MTM_WORKDAY_ACTIVE", messageKey: "duplicateActive" },
      allowedActions: ["RESUME", "FINISH"],
      refreshRequired: true,
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_EVENT_OUT_OF_ORDER", workday())).toMatchObject({
      canonicalState: "STARTED",
      reason: { messageKey: "eventOrder" },
      allowedActions: ["PAUSE", "FINISH"],
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_ALREADY_EXISTS", workday({ status: "COMPLETED" }))).toMatchObject({
      canonicalState: "COMPLETED", reason: { messageKey: "alreadyExists" }, allowedActions: [],
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_COMPLETED", workday({ status: "COMPLETED" }))).toMatchObject({
      reason: { messageKey: "completed" },
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_NOT_RUNNING", workday({ status: "PAUSED" }))).toMatchObject({
      reason: { messageKey: "stateChanged" },
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_NOT_PAUSED", workday())).toMatchObject({
      reason: { messageKey: "stateChanged" },
    })
    expect(recoveryForMtmWorkdayConflict("MTM_WORKDAY_NOT_FOUND")).toEqual({
      canonicalState: "NOT_FOUND",
      reason: { code: "MTM_WORKDAY_NOT_FOUND", messageKey: "workdayUnavailable" },
      allowedActions: [],
      refreshRequired: true,
    })
    expect(recoveryForMtmWorkdayConflict("WORKFORCE_WORKDAY_IDEMPOTENCY_MISMATCH")).toMatchObject({
      canonicalState: "NOT_FOUND",
      reason: { messageKey: "operationMismatch" },
      allowedActions: [],
    })
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

  it("binds a v3 request to its scheduled segment without changing legacy v2 replay hashes", () => {
    const payload = {
      action: "START",
      id: "workday-1",
      schemaVersion: 3,
      occurredAt: "2026-07-15T07:55:00.000Z",
      claimedAt: "2026-07-15T07:55:00.000Z",
      capturedAt: "2026-07-15T07:54:58.000Z",
      queuedAt: "2026-07-15T07:55:01.000Z",
      segmentId: "segment-baku-hq",
    }
    const parsed = parseMtmWorkdayEvent(
      payload,
      "event-segment",
      "Asia/Baku",
      new Date("2026-07-15T08:00:00.000Z"),
    )

    expect(parsed.error).toBeNull()
    expect(parsed.input).toMatchObject({ schemaVersion: 3, segmentId: "segment-baku-hq" })
    expect(mtmWorkdayRequestHash(SCOPE, parsed.input!)).not.toBe(mtmWorkdayRequestHash(SCOPE, {
      ...parsed.input!,
      segmentId: "segment-warehouse",
    }))

    const legacy = parseMtmWorkdayEvent({ ...payload, schemaVersion: 2, segmentId: undefined }, "event-legacy", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(legacy.error).toBeNull()
    expect(mtmWorkdayRequestHash(SCOPE, legacy.input!)).toBe(mtmWorkdayRequestHash(SCOPE, {
      ...legacy.input!,
      segmentId: "ignored-by-v2",
    }))

    const invalidLegacySegment = parseMtmWorkdayEvent({ ...payload, schemaVersion: 2 }, "event-invalid-legacy", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(invalidLegacySegment.input).toBeNull()
    expect(invalidLegacySegment.error).toContain("schemaVersion 3")
  })

  it("marks a delayed but in-window claim for human review without rejecting it", () => {
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      schemaVersion: 2,
      occurredAt: "2026-07-15T07:40:00.000Z",
      claimedAt: "2026-07-15T07:40:00.000Z",
      capturedAt: "2026-07-15T07:39:58.000Z",
      queuedAt: "2026-07-15T07:40:01.000Z",
    }, "event-delayed", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    expect(parsed.error).toBeNull()
    expect(parsed.input?.attendanceReview).toEqual({
      state: "PENDING_REVIEW",
      reasonCode: "DELAYED_CLAIM",
      policyVersion: "c1-delay-review-v1",
      claimAgeSeconds: 1_200,
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

  it("rejects future-controlled provenance and an unsupported workday protocol version", () => {
    const now = new Date("2026-07-15T08:00:00.000Z")
    const base = {
      action: "START",
      id: "workday-1",
      schemaVersion: 3,
      occurredAt: "2026-07-15T08:00:00.000Z",
      claimedAt: "2026-07-15T08:00:00.000Z",
      capturedAt: "2026-07-15T08:00:00.000Z",
      queuedAt: "2026-07-15T08:00:00.000Z",
    }

    for (const [field, value] of [
      ["occurredAt", "2026-07-15T08:05:00.001Z"],
      ["capturedAt", "2026-07-15T08:05:00.001Z"],
      ["queuedAt", "2026-07-15T08:05:00.001Z"],
    ] as const) {
      const parsed = parseMtmWorkdayEvent(
        { ...base, [field]: value },
        `event-future-${field}`,
        "Asia/Baku",
        now,
      )
      expect(parsed.input).toBeNull()
      expect(parsed.error).toContain("too far in the future")
    }

    const unsupported = parseMtmWorkdayEvent(
      { ...base, schemaVersion: 6 },
      "event-unsupported-schema",
      "Asia/Baku",
      now,
    )
    expect(unsupported.input).toBeNull()
    expect(unsupported.error).toContain("Unsupported Workforce workday schemaVersion")
    expect(unsupported).toMatchObject({
      code: "WORKFORCE_WORKDAY_SCHEMA_UNSUPPORTED",
      schemaSupport: { min: 1, max: 5, action: "UPGRADE_CLIENT" },
    })
  })

  it("parses v4 action-time location metadata only with a complete coordinate claim", () => {
    const payload = {
      action: "START",
      id: "workday-1",
      schemaVersion: 4,
      occurredAt: "2026-07-15T08:00:00.000Z",
      claimedAt: "2026-07-15T08:00:00.000Z",
      capturedAt: "2026-07-15T08:00:00.000Z",
      queuedAt: "2026-07-15T08:00:00.000Z",
      latitude: 40.4093,
      longitude: 49.8671,
      accuracy: 12,
      attendance: {
        location: {
          capturedAt: "2026-07-15T07:59:55.000Z",
          provider: "GPS",
          isMock: false,
        },
      },
    }
    const parsed = parseMtmWorkdayEvent(payload, "event-location-v4", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(parsed.error).toBeNull()
    expect(parsed.input?.attendance?.location).toEqual({
      capturedAt: new Date("2026-07-15T07:59:55.000Z"),
      provider: "GPS",
      isMock: false,
    })
    expect(mtmWorkdayRequestHash(SCOPE, parsed.input!)).not.toBe(mtmWorkdayRequestHash(SCOPE, {
      ...parsed.input!,
      attendance: {
        ...parsed.input!.attendance,
        location: { ...parsed.input!.attendance!.location!, isMock: true },
      },
    }))

    const incomplete = parseMtmWorkdayEvent({ ...payload, accuracy: undefined }, "event-location-incomplete", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(incomplete.input).toBeNull()
    expect(incomplete.error).toContain("requires latitude, longitude and accuracy")
  })

  it("accepts a v5 Play Integrity transport token only as transient hashed evidence", () => {
    const payload = {
      action: "START",
      id: "workday-1",
      schemaVersion: 5,
      occurredAt: "2026-07-15T08:00:00.000Z",
      claimedAt: "2026-07-15T08:00:00.000Z",
      capturedAt: "2026-07-15T08:00:00.000Z",
      queuedAt: "2026-07-15T08:00:00.000Z",
      attendance: { playIntegrity: { token: "opaque-standard-api-token" } },
    }
    const parsed = parseMtmWorkdayEvent(payload, "event-integrity-v5", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(parsed.error).toBeNull()
    expect(parsed.input?.attendance?.playIntegrityToken).toBe("opaque-standard-api-token")
    expect(mtmWorkdayRequestHash(SCOPE, parsed.input!)).not.toBe(mtmWorkdayRequestHash(SCOPE, {
      ...parsed.input!,
      attendance: { ...parsed.input!.attendance, playIntegrityToken: "different-opaque-standard-api-token" },
    }))
    const legacy = parseMtmWorkdayEvent({ ...payload, schemaVersion: 4 }, "event-integrity-legacy", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))
    expect(legacy.input).toBeNull()
    expect(legacy.error).toContain("requires Workforce workday schemaVersion 5")
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

  it("creates an immutable pending-review case in the same workday mutation", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    vi.mocked(db.mtmAgentWorkday.create).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-delayed",
      workdayId: "workday-1",
      clientEventId: "event-delayed",
      type: "START",
      occurredAt: new Date("2026-07-15T07:40:00.000Z"),
      attendanceReviewState: "PENDING_REVIEW",
      attendanceReviewReasonCode: "DELAYED_CLAIM",
    } as never)
    vi.mocked(db.workforceAttendanceReviewCase.create).mockResolvedValue({ id: "review-1" } as never)
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T07:40:00.000Z",
    }, "event-delayed", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    const result = await applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)

    expect(result).toMatchObject({
      status: "ok",
      idempotent: false,
      review: { state: "PENDING_REVIEW", reasonCode: "DELAYED_CLAIM" },
    })
    expect(db.workforceAttendanceReviewCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        workdayId: "workday-1",
        workdayEventId: "event-delayed",
        status: "PENDING_REVIEW",
        reasonCode: "DELAYED_CLAIM",
        policyVersion: "c1-delay-review-v1",
        claimAgeSeconds: 1_200,
      }),
    })
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
      riskCodes: ["CLAIM_PRECEDES_ACCEPTED_EVENT"],
    })
    expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("returns a review-only duplicate-active-shift signal without weakening replay handling", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(db.mtmAgentWorkday.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(workday({ id: "active-workday", status: "PAUSED" }) as never)
    const parsed = parseMtmWorkdayEvent({
      action: "START",
      id: "new-workday",
      occurredAt: "2026-07-15T07:00:00.000Z",
    }, "event-new-start", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    await expect(applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_ACTIVE",
      riskCodes: ["DUPLICATE_ACTIVE_SHIFT_ATTEMPT"],
      allowedActions: ["RESUME", "FINISH"],
    })
    expect(db.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    expect(db.workforceAttendanceReviewCase.create).not.toHaveBeenCalled()
  })

  it("distinguishes a claim before workday start from a claim before a later accepted event", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday() as never)
    vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ occurredAt: new Date("2026-07-15T05:00:00.000Z") } as never)
    const parsed = parseMtmWorkdayEvent({
      action: "PAUSE",
      workdayId: "workday-1",
      occurredAt: "2026-07-15T04:59:59.000Z",
    }, "event-before-start", "Asia/Baku", new Date("2026-07-15T08:00:00.000Z"))

    await expect(applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
      riskCodes: ["CLAIM_BEFORE_WORKDAY_START", "CLAIM_PRECEDES_ACCEPTED_EVENT"],
    })
    expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  describe("the first transition after a manager reopen", () => {
    // FINISH 13:00, reopened by the manager at 13:20 (server time); the REOPEN
    // is recorded at the 13:00 finish it reopens.
    function reopenedDb() {
      const db = makeMtmPrismaMock()
      vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue(workday({
        status: "PAUSED",
        pausedAt: new Date("2026-07-15T13:00:00.000Z"),
      }) as never)
      vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({
          occurredAt: new Date("2026-07-15T13:00:00.000Z"),
          type: "REOPEN",
          appliedAt: new Date("2026-07-15T13:20:00.000Z"),
          serverReceivedAt: new Date("2026-07-15T13:20:00.000Z"),
        } as never)
      vi.mocked(db.mtmAgentWorkday.update).mockResolvedValue(workday() as never)
      vi.mocked(db.mtmAgentWorkdayEvent.create).mockResolvedValue({ id: "event-after-reopen" } as never)
      return db
    }

    it.each(["RESUME", "FINISH"] as const)("refuses a %s claiming the closed time before the reopen", async (action) => {
      const db = reopenedDb()
      const parsed = parseMtmWorkdayEvent({
        action,
        workdayId: "workday-1",
        occurredAt: "2026-07-15T13:06:00.000Z",
      }, `event-${action}`, "Asia/Baku", new Date("2026-07-15T13:21:00.000Z"))

      await expect(applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)).resolves.toMatchObject({
        status: "conflict",
        code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
        riskCodes: ["CLAIM_BEFORE_REOPEN"],
        recovery: { reason: { code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER", messageKey: "eventOrder" } },
      })
      expect(db.mtmAgentWorkday.update).not.toHaveBeenCalled()
      expect(db.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
      // The latest event is chosen by instant, then by server application time.
      expect(db.mtmAgentWorkdayEvent.findFirst).toHaveBeenLastCalledWith({
        where: { workdayId: "workday-1", organizationId: "org-1" },
        orderBy: [{ occurredAt: "desc" }, { appliedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        select: { occurredAt: true, type: true, appliedAt: true, serverReceivedAt: true },
      })
    })

    it("accepts a claim within the clock-skew allowance and banks the pause up to it", async () => {
      const db = reopenedDb()
      const parsed = parseMtmWorkdayEvent({
        action: "RESUME",
        workdayId: "workday-1",
        occurredAt: "2026-07-15T13:17:00.000Z",
      }, "event-resume-within-skew", "Asia/Baku", new Date("2026-07-15T13:21:00.000Z"))

      await expect(applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)).resolves.toMatchObject({ status: "ok" })
      expect(db.mtmAgentWorkday.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: "STARTED", pausedAt: null, totalPausedSeconds: 17 * 60 },
      }))
    })

    it("fails closed when the REOPEN carries no server time", async () => {
      const db = reopenedDb()
      vi.mocked(db.mtmAgentWorkdayEvent.findFirst)
        .mockReset()
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({
          occurredAt: new Date("2026-07-15T13:00:00.000Z"),
          type: "REOPEN",
          appliedAt: null,
          serverReceivedAt: null,
        } as never)
      const parsed = parseMtmWorkdayEvent({
        action: "RESUME",
        workdayId: "workday-1",
        occurredAt: "2026-07-15T13:30:00.000Z",
      }, "event-resume-unknown-reopen", "Asia/Baku", new Date("2026-07-15T13:31:00.000Z"))

      await expect(applyMtmWorkdayEvent(db as never, SCOPE, parsed.input!)).resolves.toMatchObject({
        status: "conflict",
        riskCodes: ["CLAIM_BEFORE_REOPEN"],
      })
    })
  })

  it.each(["reopen:operation-1", "reopen-undo:operation-1"])(
    "refuses a client event keyed like a manager workday action (%s)",
    (clientEventId) => {
      expect(parseMtmWorkdayEvent({
        action: "FINISH",
        workdayId: "workday-1",
        occurredAt: "2026-07-15T13:00:00.000Z",
      }, clientEventId, "Asia/Baku", new Date("2026-07-15T13:00:05.000Z"))).toEqual({
        input: null,
        error: "clientEventId uses a prefix reserved for manager workday actions",
      })
    },
  )

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
