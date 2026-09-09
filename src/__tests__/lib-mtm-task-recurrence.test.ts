import type { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  MTM_TASK_RECURRENCE_PREVIEW_MAX,
  mtmTaskRecurrenceSourceKey,
  nextMtmTaskRecurrenceOccurrence,
  previewMtmTaskRecurrence,
  resolveMtmTaskTenantLocalDateTime,
  spawnNextMtmTaskRecurrenceInTransaction,
  type MtmTaskRecurrenceSchedule,
  type MtmTaskRecurrenceSource,
} from "@/lib/mtm/task-recurrence"

function dailySchedule(overrides: Partial<MtmTaskRecurrenceSchedule> = {}): MtmTaskRecurrenceSchedule {
  return {
    scheduledStartAt: new Date("2026-07-01T08:00:00.000Z"),
    dueDate: new Date("2026-07-01T09:00:00.000Z"),
    recurrenceRule: "DAILY",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceTimezone: "UTC",
    ...overrides,
  }
}

function recurrenceSource(overrides: Partial<MtmTaskRecurrenceSource> = {}): MtmTaskRecurrenceSource {
  return {
    id: "task-root",
    agentId: "agent-1",
    customerId: "customer-1",
    taskGroupDictionaryId: "dictionary-1",
    taskGroupCode: "FIELD_VISIT",
    title: "Visit pharmacy",
    description: "Check stock",
    priority: "HIGH",
    scheduledStartAt: new Date("2026-01-31T08:00:00.000Z"),
    dueDate: new Date("2026-01-31T09:00:00.000Z"),
    recurrenceRule: "MONTHLY",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceTimezone: "UTC",
    recurrenceAnchorScheduledStartAt: null,
    recurrenceAnchorDueDate: null,
    recurrenceCursorScheduledStartAt: null,
    recurrenceCursorDueDate: null,
    recurrenceParentId: null,
    ...overrides,
  }
}

function transactionMock() {
  return {
    $queryRaw: vi.fn(),
    mtmTask: {
      create: vi.fn().mockResolvedValue({ id: "task-next" }),
    },
    mtmTaskEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-next" }),
    },
  }
}

function sqlText(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?")
}

describe("MTM tenant-local task recurrence", () => {
  it("resolves a spring gap with the same explicit first-valid-minute policy", () => {
    expect(resolveMtmTaskTenantLocalDateTime(
      "2026-03-08T02:30",
      "America/New_York",
    )).toEqual({
      instant: new Date("2026-03-08T07:00:00.000Z"),
      resolution: { kind: "SHIFTED_FORWARD", shiftedMinutes: 30 },
    })
  })

  it("resolves a fall ambiguity to the earlier instant", () => {
    expect(resolveMtmTaskTenantLocalDateTime(
      "2026-11-01T01:30",
      "America/New_York",
    )).toEqual({
      instant: new Date("2026-11-01T05:30:00.000Z"),
      resolution: { kind: "AMBIGUOUS_EARLIER", shiftedMinutes: 0 },
    })
  })

  it("advances a daily wall time through a spring-forward gap and restores the anchor time", () => {
    const root = dailySchedule({
      scheduledStartAt: new Date("2026-03-07T07:30:00.000Z"), // 02:30 America/New_York
      dueDate: null,
      recurrenceTimezone: "America/New_York",
    })

    const springForward = nextMtmTaskRecurrenceOccurrence(root)
    expect(springForward?.scheduledStartAt).toEqual(new Date("2026-03-08T07:00:00.000Z"))
    expect(springForward?.dst.scheduledStartAt).toEqual({
      kind: "SHIFTED_FORWARD",
      shiftedMinutes: 30,
    })

    const followingDay = nextMtmTaskRecurrenceOccurrence({
      ...root,
      scheduledStartAt: springForward!.scheduledStartAt,
    }, root)
    expect(followingDay?.scheduledStartAt).toEqual(new Date("2026-03-09T06:30:00.000Z"))
    expect(followingDay?.dst.scheduledStartAt).toEqual({ kind: "EXACT", shiftedMinutes: 0 })
  })

  it("chooses the earlier instant for an ambiguous fall-back wall time", () => {
    const occurrence = nextMtmTaskRecurrenceOccurrence(dailySchedule({
      scheduledStartAt: new Date("2026-10-31T05:30:00.000Z"), // 01:30 EDT
      dueDate: null,
      recurrenceTimezone: "America/New_York",
    }))

    expect(occurrence?.scheduledStartAt).toEqual(new Date("2026-11-01T05:30:00.000Z"))
    expect(occurrence?.dst.scheduledStartAt).toEqual({
      kind: "AMBIGUOUS_EARLIER",
      shiftedMinutes: 0,
    })
  })

  it("keeps a weekly tenant-local wall time stable across DST", () => {
    const occurrence = nextMtmTaskRecurrenceOccurrence(dailySchedule({
      scheduledStartAt: new Date("2026-03-01T14:00:00.000Z"), // 09:00 EST
      dueDate: null,
      recurrenceRule: "WEEKLY",
      recurrenceTimezone: "America/New_York",
    }))

    expect(occurrence?.scheduledStartAt).toEqual(new Date("2026-03-08T13:00:00.000Z"))
    expect(occurrence?.dst.scheduledStartAt).toEqual({ kind: "EXACT", shiftedMinutes: 0 })
  })

  it("clamps a monthly anchor day and returns to it in a longer month", () => {
    const root = dailySchedule({
      scheduledStartAt: null,
      dueDate: new Date("2026-01-31T09:00:00.000Z"),
      recurrenceRule: "MONTHLY",
    })
    const february = nextMtmTaskRecurrenceOccurrence(root)
    const march = nextMtmTaskRecurrenceOccurrence({
      ...root,
      dueDate: february!.dueDate,
    }, root)

    expect(february?.dueDate).toEqual(new Date("2026-02-28T09:00:00.000Z"))
    expect(march?.dueDate).toEqual(new Date("2026-03-31T09:00:00.000Z"))

    const leapFebruary = nextMtmTaskRecurrenceOccurrence({
      ...root,
      dueDate: new Date("2028-01-31T09:00:00.000Z"),
    })
    expect(leapFebruary?.dueDate).toEqual(new Date("2028-02-29T09:00:00.000Z"))
  })

  it("treats recurrenceUntil as an inclusive local due-date boundary", () => {
    const included = nextMtmTaskRecurrenceOccurrence(dailySchedule({
      scheduledStartAt: new Date("2026-07-01T04:00:00.000Z"), // 08:00 Asia/Baku
      dueDate: new Date("2026-07-01T05:00:00.000Z"), // 09:00 Asia/Baku
      recurrenceUntil: new Date("2026-07-01T20:00:00.000Z"), // local midnight starting July 2
      recurrenceTimezone: "Asia/Baku",
    }))
    expect(included?.dueDate).toEqual(new Date("2026-07-02T05:00:00.000Z"))

    const overnightBeyondUntil = nextMtmTaskRecurrenceOccurrence(dailySchedule({
      scheduledStartAt: new Date("2026-07-01T19:00:00.000Z"), // July 1, 23:00 local
      dueDate: new Date("2026-07-01T21:00:00.000Z"), // July 2, 01:00 local
      recurrenceUntil: new Date("2026-07-01T20:00:00.000Z"), // local July 2 boundary
      recurrenceTimezone: "Asia/Baku",
    }))
    expect(overnightBeyondUntil).toBeNull()
  })

  it("hard-bounds recurrence previews and reports remaining occurrences", () => {
    const preview = previewMtmTaskRecurrence(dailySchedule(), { limit: 10_000 })

    expect(preview.limit).toBe(MTM_TASK_RECURRENCE_PREVIEW_MAX)
    expect(preview.occurrences).toHaveLength(MTM_TASK_RECURRENCE_PREVIEW_MAX)
    expect(preview.hasMore).toBe(true)
    expect(preview.wasLimitClamped).toBe(true)

    const ended = previewMtmTaskRecurrence(dailySchedule({
      recurrenceUntil: new Date("2026-07-03T00:00:00.000Z"),
    }), { limit: 10 })
    expect(ended.occurrences.map((occurrence) => occurrence.dueDate?.toISOString())).toEqual([
      "2026-07-02T09:00:00.000Z",
      "2026-07-03T09:00:00.000Z",
    ])
    expect(ended.hasMore).toBe(false)
  })

  it("uses the due date first in a deterministic recurrence source key", () => {
    expect(mtmTaskRecurrenceSourceKey("task-root", {
      scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
      dueDate: new Date("2026-02-28T09:00:00.000Z"),
    })).toBe("task-recurrence:task-root:2026-02-28T09:00:00.000Z")
  })
})

describe("MTM exact-once recurrence spawn", () => {
  it("locks, checks raw tombstones, then creates the task and immutable event", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([]) // advisory lock SELECT
      .mockResolvedValueOnce([]) // sourceKey lookup
    const occurredAt = new Date("2026-02-01T10:00:00.000Z")

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource(),
        tenantTimezone: "Asia/Baku",
        occurredAt,
      },
    )

    expect(result).toMatchObject({
      status: "created",
      taskId: "task-next",
      sourceKey: "task-recurrence:task-root:2026-02-28T09:00:00.000Z",
    })
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    const lockCall = tx.$queryRaw.mock.calls[0]
    expect(sqlText(lockCall)).toContain("pg_advisory_xact_lock")
    expect(sqlText(lockCall)).toContain("hashtextextended")
    expect(lockCall[1]).toBe("mtm-task-recurrence:org-1:task-root")
    expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('"id"')
    expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('"deletedAt"')
    expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('"sourceKey" IN (?, ?)')
    expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('"recurrenceParentId" = ?')
    expect(sqlText(tx.$queryRaw.mock.calls[1]).match(/IS NOT DISTINCT FROM/g)).toHaveLength(2)
    expect(sqlText(tx.$queryRaw.mock.calls[1])).not.toMatch(/"deletedAt"\s+IS\s+NULL/)
    expect(tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.mtmTask.create.mock.invocationCallOrder[0])
    expect(tx.mtmTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        copiedFromId: null,
        sourceKey: "task-recurrence:task-root:2026-02-28T09:00:00.000Z",
        scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        dueDate: new Date("2026-02-28T09:00:00.000Z"),
        recurrenceTimezone: "UTC",
        recurrenceAnchorScheduledStartAt: new Date("2026-01-31T08:00:00.000Z"),
        recurrenceAnchorDueDate: new Date("2026-01-31T09:00:00.000Z"),
        recurrenceCursorScheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        recurrenceCursorDueDate: new Date("2026-02-28T09:00:00.000Z"),
        recurrenceParentId: "task-root",
      }),
      select: { id: true },
    })
    expect(tx.mtmTaskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        taskId: "task-next",
        agentId: "agent-1",
        type: "CREATED",
        occurredAt,
        toStatus: "PENDING",
        evidence: expect.objectContaining({
          kind: "MTM_TASK_RECURRENCE",
          rootTaskId: "task-root",
          recurrenceTimezone: "UTC",
        }),
      }),
    })
  })

  it("advances a monthly legacy root from its immutable cursor after a THIS-only exception", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource({
          scheduledStartAt: new Date("2026-02-05T08:00:00.000Z"),
          dueDate: new Date("2026-02-05T09:00:00.000Z"),
          recurrenceRule: "MONTHLY",
          recurrenceCursorScheduledStartAt: new Date("2026-01-31T08:00:00.000Z"),
          recurrenceCursorDueDate: new Date("2026-01-31T09:00:00.000Z"),
          recurrenceAnchorScheduledStartAt: null,
          recurrenceAnchorDueDate: null,
        }),
        tenantTimezone: "UTC",
      },
    )

    expect(result.occurrence).toMatchObject({
      scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
      dueDate: new Date("2026-02-28T09:00:00.000Z"),
    })
    expect(tx.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        dueDate: new Date("2026-02-28T09:00:00.000Z"),
        recurrenceCursorScheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        recurrenceCursorDueDate: new Date("2026-02-28T09:00:00.000Z"),
      }),
    }))
  })

  it.each([
    ["existing", null],
    ["tombstoned", new Date("2026-02-10T10:00:00.000Z")],
  ] as const)("returns %s without recreating a matching raw sourceKey row", async (status, deletedAt) => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "task-prior",
        deletedAt,
        sourceKey: "task-recurrence:task-root:2026-02-28T09:00:00.000Z",
        scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        dueDate: new Date("2026-02-28T09:00:00.000Z"),
        recurrenceCursorScheduledStartAt: null,
        recurrenceCursorDueDate: null,
      }])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource(),
        tenantTimezone: "UTC",
      },
    )

    expect(result).toMatchObject({ status, taskId: "task-prior" })
    expect(tx.mtmTask.create).not.toHaveBeenCalled()
    expect(tx.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it.each([
    ["existing", null],
    ["tombstoned", new Date("2026-02-20T10:00:00.000Z")],
  ] as const)("returns a rescheduled sourceKey alias as %s using immutable occurrence facts", async (status, deletedAt) => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "task-rescheduled-child",
        deletedAt,
        sourceKey: "task-recurrence:task-root:old-planned-time",
        scheduledStartAt: new Date("2026-03-05T08:00:00.000Z"),
        dueDate: new Date("2026-03-05T09:00:00.000Z"),
        recurrenceCursorScheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
        recurrenceCursorDueDate: new Date("2026-02-28T09:00:00.000Z"),
      }])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource(),
        tenantTimezone: "UTC",
      },
    )

    expect(result).toMatchObject({
      status,
      taskId: "task-rescheduled-child",
      sourceKey: "task-recurrence:task-root:2026-02-28T09:00:00.000Z",
    })
    const lookupCall = tx.$queryRaw.mock.calls[1]
    expect(sqlText(lookupCall)).toContain('"sourceKey" IN (?, ?)')
    expect(sqlText(lookupCall)).toContain('"recurrenceParentId" = ?')
    expect(sqlText(lookupCall)).toContain('WHEN "recurrenceCursorScheduledStartAt" IS NOT NULL')
    expect(sqlText(lookupCall)).toContain('THEN "recurrenceCursorDueDate"')
    expect(sqlText(lookupCall).match(/IS NOT DISTINCT FROM/g)).toHaveLength(2)
    expect(lookupCall[1]).toBe("org-1")
    expect(lookupCall[2]).toBe("task-recurrence:task-root:2026-02-28T09:00:00.000Z")
    expect(lookupCall[3]).toBe("task-recurrence:task-root:2026-02-28T09:00:00.000Z:from:task-root")
    expect(lookupCall[4]).toBe("task-root")
    expect(lookupCall[5]).toEqual(new Date("2026-02-28T08:00:00.000Z"))
    expect(lookupCall[6]).toEqual(new Date("2026-02-28T09:00:00.000Z"))
    expect(tx.mtmTask.create).not.toHaveBeenCalled()
    expect(tx.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("uses a deterministic alias when a stale canonical key belongs to another cursor", async () => {
    const tx = transactionMock()
    const canonical = "task-recurrence:task-root:2026-02-28T09:00:00.000Z"
    const alias = `${canonical}:from:task-root`
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "task-stale-key-owner",
        deletedAt: null,
        sourceKey: canonical,
        scheduledStartAt: new Date("2026-03-31T08:00:00.000Z"),
        dueDate: new Date("2026-03-31T09:00:00.000Z"),
        recurrenceCursorScheduledStartAt: new Date("2026-03-31T08:00:00.000Z"),
        recurrenceCursorDueDate: new Date("2026-03-31T09:00:00.000Z"),
      }])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource(),
        tenantTimezone: "UTC",
      },
    )

    expect(result).toMatchObject({ status: "created", sourceKey: alias })
    expect(tx.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceKey: alias }),
    }))
  })

  it("rejects ambiguous rows instead of confusing distinct recurrence facts", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "task-by-key",
          deletedAt: null,
          sourceKey: "task-recurrence:task-root:2026-02-28T09:00:00.000Z",
          scheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
          dueDate: new Date("2026-02-28T09:00:00.000Z"),
          recurrenceCursorScheduledStartAt: null,
          recurrenceCursorDueDate: null,
        },
        {
          id: "task-by-planned-facts",
          deletedAt: null,
          sourceKey: "task-recurrence:task-root:old-planned-time",
          scheduledStartAt: new Date("2026-03-05T08:00:00.000Z"),
          dueDate: new Date("2026-03-05T09:00:00.000Z"),
          recurrenceCursorScheduledStartAt: new Date("2026-02-28T08:00:00.000Z"),
          recurrenceCursorDueDate: new Date("2026-02-28T09:00:00.000Z"),
        },
      ])

    await expect(spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource(),
        tenantTimezone: "UTC",
      },
    )).rejects.toThrow("Multiple recurrence tasks claim the same occurrence")
    expect(tx.mtmTask.create).not.toHaveBeenCalled()
    expect(tx.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("uses the raw root anchor so a February child returns to day 31", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "task-root",
        scheduledStartAt: null,
        dueDate: new Date("2026-01-31T09:00:00.000Z"),
        recurrenceTimezone: "UTC",
      }])
      .mockResolvedValueOnce([])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource({
          id: "task-february",
          scheduledStartAt: null,
          dueDate: new Date("2026-02-28T09:00:00.000Z"),
          recurrenceTimezone: null,
          recurrenceParentId: "task-root",
        }),
        tenantTimezone: "Asia/Baku",
      },
    )

    expect(result.status).toBe("created")
    expect(result.occurrence?.dueDate).toEqual(new Date("2026-03-31T09:00:00.000Z"))
    expect(tx.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dueDate: new Date("2026-03-31T09:00:00.000Z"),
        recurrenceAnchorDueDate: new Date("2026-01-31T09:00:00.000Z"),
        recurrenceParentId: "task-root",
      }),
    }))
  })

  it("honors and propagates an explicit edit-future anchor instead of reverting to the root", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "task-root",
        scheduledStartAt: new Date("2026-01-31T08:00:00.000Z"),
        dueDate: new Date("2026-01-31T09:00:00.000Z"),
        recurrenceTimezone: "UTC",
        recurrenceAnchorScheduledStartAt: null,
        recurrenceAnchorDueDate: null,
      }])
      .mockResolvedValueOnce([])

    const result = await spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource({
          id: "task-february-15",
          scheduledStartAt: new Date("2026-02-15T08:00:00.000Z"),
          dueDate: new Date("2026-02-15T09:00:00.000Z"),
          recurrenceAnchorScheduledStartAt: new Date("2026-02-15T08:00:00.000Z"),
          recurrenceAnchorDueDate: new Date("2026-02-15T09:00:00.000Z"),
          recurrenceParentId: "task-root",
        }),
        tenantTimezone: "UTC",
      },
    )

    expect(result.status).toBe("created")
    expect(result.occurrence?.scheduledStartAt).toEqual(new Date("2026-03-15T08:00:00.000Z"))
    expect(result.occurrence?.dueDate).toEqual(new Date("2026-03-15T09:00:00.000Z"))
    expect(tx.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduledStartAt: new Date("2026-03-15T08:00:00.000Z"),
        dueDate: new Date("2026-03-15T09:00:00.000Z"),
        recurrenceAnchorScheduledStartAt: new Date("2026-02-15T08:00:00.000Z"),
        recurrenceAnchorDueDate: new Date("2026-02-15T09:00:00.000Z"),
      }),
    }))
  })

  it("refuses a recurrence root that is absent from the tenant-scoped raw lookup", async () => {
    const tx = transactionMock()
    tx.$queryRaw
      .mockResolvedValueOnce([]) // advisory lock SELECT
      .mockResolvedValueOnce([]) // scoped root lookup

    await expect(spawnNextMtmTaskRecurrenceInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: "org-1",
        sourceTask: recurrenceSource({
          id: "task-child",
          recurrenceParentId: "root-from-another-tenant",
        }),
        tenantTimezone: "UTC",
      },
    )).rejects.toThrow("Recurrence root is not available in the organization scope")
    expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('WHERE "organizationId" = ?')
    expect(tx.$queryRaw.mock.calls[1][1]).toBe("org-1")
    expect(tx.mtmTask.create).not.toHaveBeenCalled()
    expect(tx.mtmTaskEvent.create).not.toHaveBeenCalled()
  })
})
