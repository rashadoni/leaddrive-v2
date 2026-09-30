import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { listWorkforceCalendarOverrides, reverseWorkforceCalendarMovedDay } from "@/lib/workforce/calendar-configuration"
import { WorkforceCalendarMovedDayReverseSchema } from "@/lib/workforce/calendar-configuration-contract"
import {
  calendarPairGeneration, calendarReversalReceiptSchema, calendarRowFromSnapshot,
  type CalendarReversalRow,
} from "@/lib/workforce/calendar-moved-day-pair"

const db = prisma as unknown as ReturnType<typeof import("./mocks/mtm-prisma").makeMtmPrismaMock>
const organizationId = "org-reversal-unit"

function pair(teamId: string | null = null): [CalendarReversalRow, CalendarReversalRow] {
  const base = {
    organizationId, name: "Moved company day", teamId, agentId: null,
    source: "ADMIN", createdBy: "original-scheduler", updatedBy: "original-scheduler",
    createdAt: new Date("2026-09-29T09:00:00.000Z"),
    updatedAt: new Date("2026-09-29T09:00:00.001Z"), deletedAt: null,
  }
  return [
    { ...base, id: "source-generation-one", date: new Date("2026-10-05T00:00:00Z"),
      kind: "MOVED_DAY_OFF", movedToDate: new Date("2026-10-10T00:00:00Z"), routePlanningAllowed: true },
    { ...base, id: "destination-generation-one", date: new Date("2026-10-10T00:00:00Z"),
      kind: "MOVED_WORKDAY", movedToDate: new Date("2026-10-05T00:00:00Z"), routePlanningAllowed: false },
  ]
}

function input(rows = pair()): Parameters<typeof reverseWorkforceCalendarMovedDay>[0] {
  return {
    organizationId, updatedByUserId: "reversing-scheduler", currentDate: "2026-09-30",
    audit: { actorUserId: "reversing-scheduler", ipAddress: "203.0.113.21", userAgent: "unit-reversal" },
    draft: {
      operation: "REVERSE_MOVE_WORKDAY", scope: rows[0].teamId ? "TEAM" : "ORGANIZATION",
      ...(rows[0].teamId ? { teamId: rows[0].teamId } : {}),
      sourceDate: "2026-10-05", destinationDate: "2026-10-10",
      pairGenerationId: calendarPairGeneration(...rows),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.mtmWorkCalendarDay.findMany.mockReset().mockResolvedValue(pair())
  db.mtmWorkCalendarDay.updateMany.mockReset().mockResolvedValue({ count: 1 })
  db.mtmAuditLog.findMany.mockReset().mockResolvedValue([])
  db.mtmAuditLog.create.mockReset().mockResolvedValue({ id: "audit-reversal-one" })
  db.$queryRaw.mockReset().mockResolvedValue([{ id: "team-one", name: "Team One", code: "ONE", isActive: true }])
  db.$executeRaw.mockReset().mockResolvedValue(0)
})

async function recordedReversal(rows = pair()) {
  await reverseWorkforceCalendarMovedDay(input(rows))
  const receipt = (db.mtmAuditLog.create.mock.calls[0][0] as {
    data: { actorUserId: string; oldData: unknown; newData: unknown }
  }).data
  const after = calendarReversalReceiptSchema.parse(receipt.newData)
  const posts = after.rows.map(calendarRowFromSnapshot)
  db.mtmAuditLog.findMany.mockResolvedValue([receipt])
  db.mtmWorkCalendarDay.findMany.mockReset().mockResolvedValue(posts)
  db.mtmWorkCalendarDay.updateMany.mockClear()
  db.mtmAuditLog.create.mockClear()
  return { receipt, posts }
}

describe("Generation-bound moved-day reversal", () => {
  it("accepts only a strict generation and whole ORG/TEAM pair", () => {
    expect(WorkforceCalendarMovedDayReverseSchema.parse(input().draft)).toEqual(input().draft)
    for (const change of [
      { scope: "AGENT", agentId: "agent-one" }, { pairGenerationId: "source-row-id" },
      { destinationDate: "2026-02-30" }, { destinationDate: "2026-10-05" },
      { name: "replacement" }, { routePlanningAllowed: true }, { source: "ADMIN" },
      { createdBy: "caller" }, { teamId: "unexpected-team" }, { scope: "TEAM" },
    ]) expect(WorkforceCalendarMovedDayReverseSchema.safeParse({ ...input().draft, ...change }).success).toBe(false)
  })

  it("changes generation for either physical half and for tenant/scope", () => {
    const rows = pair()
    const original = calendarPairGeneration(...rows)
    expect(original).toMatch(/^[a-f0-9]{64}$/)
    for (const changed of [
      [{ ...rows[0], id: "new-source" }, rows[1]],
      [rows[0], { ...rows[1], id: "new-destination" }],
      [{ ...rows[0], organizationId: "other" }, rows[1]],
      [{ ...rows[0], teamId: "team-one" }, rows[1]],
    ] as [CalendarReversalRow, CalendarReversalRow][]) expect(calendarPairGeneration(...changed)).not.toBe(original)
  })

  it("exposes only source generation after one bounded out-of-window partner read", async () => {
    const rows = pair()
    db.mtmWorkCalendarDay.findMany.mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce([rows[1]])
    const days = await listWorkforceCalendarOverrides({
      organizationId, currentDate: "2026-09-30", start: "2026-10-05", endExclusive: "2026-10-06", scope: "ORGANIZATION",
    })
    expect(days).toEqual([{
      date: "2026-10-05", kind: "MOVED_DAY_OFF", name: rows[0].name,
      pairedDate: "2026-10-10", pairGenerationId: calendarPairGeneration(...rows),
    }])
    expect(db.mtmWorkCalendarDay.findMany).toHaveBeenCalledTimes(2)
    expect(db.mtmWorkCalendarDay.findMany.mock.calls[1][0]).toMatchObject({
      where: { organizationId, teamId: null, agentId: null, deletedAt: null, date: { in: [rows[1].date] } },
    })
    expect(Object.keys(days[0]).sort()).toEqual(["date", "kind", "name", "pairGenerationId", "pairedDate"])
  })

  it.each(["missing", "legacy", "label", "reciprocal", "foreign"])("omits action for %s partner", async (state) => {
    const rows = pair()
    if (state === "legacy") rows[1].routePlanningAllowed = null
    if (state === "label") rows[1].name = "different"
    if (state === "reciprocal") rows[1].movedToDate = null
    if (state === "foreign") rows[1].organizationId = "foreign"
    db.mtmWorkCalendarDay.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(state === "missing" ? [] : [rows[1]])
    const days = await listWorkforceCalendarOverrides({
      organizationId, currentDate: "2026-09-30", start: "2026-10-01", endExclusive: "2026-11-01", scope: "ORGANIZATION",
    })
    expect(days.every((day) => day.pairGenerationId === undefined)).toBe(true)
  })

  it("binds every CAS field, locks before reads and writes exactly one complete audit", async () => {
    const rows = pair()
    const result = await reverseWorkforceCalendarMovedDay(input(rows))
    expect(result.reversed).toBe(true)
    expect(db.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "ReadCommitted", timeout: 10_000 })
    expect(db.$executeRaw).toHaveBeenCalledTimes(4)
    expect(db.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(db.mtmAuditLog.findMany.mock.invocationCallOrder[0])
    const updates = db.mtmWorkCalendarDay.updateMany.mock.calls.map(([query]) => query as { where: unknown; data: { deletedAt: Date; updatedAt: Date; updatedBy: string } })
    expect(updates).toHaveLength(2)
    expect(updates[0].where).toEqual(rows[0])
    expect(updates[1].where).toEqual(rows[1])
    expect(updates[0].data).toEqual(updates[1].data)
    expect(updates[0].data.updatedAt).toEqual(updates[0].data.deletedAt)
    expect(updates[0].data.updatedBy).toBe("reversing-scheduler")
    expect(db.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    const audit = (db.mtmAuditLog.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(audit).toMatchObject({ action: "WORKFORCE_CALENDAR_MOVED_DAY_REVERSED", entityId: input().draft.pairGenerationId, actorUserId: "reversing-scheduler" })
    expect(calendarReversalReceiptSchema.parse(audit.oldData).rows.every((row) => row.deletedAt === null)).toBe(true)
    expect(calendarReversalReceiptSchema.parse(audit.newData).rows.every((row) => row.deletedAt !== null)).toBe(true)
  })

  it("replays only receipt IDs for another actor after the dates, without new writes", async () => {
    await recordedReversal()
    const retry = input()
    retry.currentDate = "2027-11-01"
    retry.updatedByUserId = "another-scheduler"
    retry.audit.actorUserId = "another-scheduler"
    expect((await reverseWorkforceCalendarMovedDay(retry)).reversed).toBe(false)
    expect(db.mtmWorkCalendarDay.findMany).toHaveBeenCalledTimes(1)
    expect(db.mtmWorkCalendarDay.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId, id: { in: ["source-generation-one", "destination-generation-one"] } },
    })
    expect(db.mtmWorkCalendarDay.updateMany).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it.each(["duplicate", "version", "actor", "snapshot", "active", "missing-original", "malformed-time"])("rejects %s receipt replay", async (state) => {
    const { receipt, posts } = await recordedReversal()
    const old = calendarReversalReceiptSchema.parse(receipt.oldData)
    const after = calendarReversalReceiptSchema.parse(receipt.newData)
    let changed: unknown = receipt
    if (state === "version") changed = { ...receipt, newData: { ...after, version: 2 } }
    if (state === "actor") changed = { ...receipt, actorUserId: "forged-actor" }
    if (state === "snapshot") changed = { ...receipt, oldData: { ...old, rows: [{ ...old.rows[0], createdBy: "forged" }, old.rows[1]] } }
    if (state === "malformed-time") changed = { ...receipt, newData: { ...after, reversedAt: "invalid" } }
    db.mtmAuditLog.findMany.mockResolvedValue(state === "duplicate" ? [receipt, receipt] : [changed])
    if (state === "active") db.mtmWorkCalendarDay.findMany.mockResolvedValue(pair())
    if (state === "missing-original") db.mtmWorkCalendarDay.findMany.mockResolvedValue([posts[0]])
    await expect(reverseWorkforceCalendarMovedDay(input())).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED" })
    expect(db.mtmWorkCalendarDay.updateMany).not.toHaveBeenCalled()
  })

  it("rejects old generation on half replacement and never writes", async () => {
    const replacement = pair()
    replacement[1].id = "replacement-destination"
    db.mtmWorkCalendarDay.findMany.mockResolvedValue(replacement)
    await expect(reverseWorkforceCalendarMovedDay(input())).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED" })
    expect(db.mtmWorkCalendarDay.updateMany).not.toHaveBeenCalled()
  })

  it("refuses changed inherited Route eligibility before any CAS", async () => {
    const rows = pair("team-one")
    db.mtmWorkCalendarDay.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([
      { ...rows[0], id: "parent", teamId: null, kind: "COMPANY_HOLIDAY", routePlanningAllowed: false },
    ])
    await expect(reverseWorkforceCalendarMovedDay(input(rows))).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED" })
    expect(db.mtmWorkCalendarDay.updateMany).not.toHaveBeenCalled()
  })

  it("throws on second CAS zero rows and never writes audit (real rollback has separate PG proof)", async () => {
    db.mtmWorkCalendarDay.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await expect(reverseWorkforceCalendarMovedDay(input())).rejects.toMatchObject({ code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED" })
    expect(db.mtmWorkCalendarDay.updateMany).toHaveBeenCalledTimes(2)
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("keeps generic transaction errors as unknown outcome", async () => {
    const unknown = Object.assign(new Error("unconfirmed commit"), { code: "P2028" })
    db.mtmAuditLog.create.mockRejectedValueOnce(unknown)
    await expect(reverseWorkforceCalendarMovedDay(input())).rejects.toBe(unknown)
  })
})
