import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"

export const calendarPairSelect = {
  id: true, organizationId: true, date: true, kind: true, name: true,
  teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true,
  source: true, deletedAt: true,
} satisfies Prisma.MtmWorkCalendarDaySelect

export const calendarReversalSelect = {
  ...calendarPairSelect,
  createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MtmWorkCalendarDaySelect

export type CalendarPairRow = Prisma.MtmWorkCalendarDayGetPayload<{ select: typeof calendarPairSelect }>
export type CalendarReversalRow = Prisma.MtmWorkCalendarDayGetPayload<{ select: typeof calendarReversalSelect }>

export function calendarPairMatches(
  source: CalendarPairRow | undefined,
  destination: CalendarPairRow | undefined,
  target: { organizationId: string; teamId: string | null; sourceDate: string; destinationDate: string },
): boolean {
  return Boolean(source && destination
    && source.id !== destination.id
    && source.organizationId === target.organizationId && destination.organizationId === target.organizationId
    && source.teamId === target.teamId && destination.teamId === target.teamId
    && source.agentId === null && destination.agentId === null
    && source.date.toISOString().slice(0, 10) === target.sourceDate
    && destination.date.toISOString().slice(0, 10) === target.destinationDate
    && target.sourceDate !== target.destinationDate
    && source.kind === "MOVED_DAY_OFF" && destination.kind === "MOVED_WORKDAY"
    && source.movedToDate?.toISOString().slice(0, 10) === target.destinationDate
    && destination.movedToDate?.toISOString().slice(0, 10) === target.sourceDate
    && typeof source.name === "string" && source.name.length > 0 && source.name.length <= 160
    && source.name.trim() === source.name && destination.name === source.name
    && source.source === "ADMIN" && destination.source === "ADMIN"
    && typeof source.routePlanningAllowed === "boolean" && typeof destination.routePlanningAllowed === "boolean")
}

/** Both physical IDs are bound: whole-pair and one-half ABA change the token. */
export function calendarPairGeneration(source: CalendarPairRow, destination: CalendarPairRow): string {
  return createHash("sha256").update(JSON.stringify([
    "workforce-calendar-moved-day-pair-v1", source.organizationId,
    source.teamId === null ? "ORGANIZATION" : "TEAM", source.teamId,
    source.id, destination.id, source.date.toISOString().slice(0, 10), destination.date.toISOString().slice(0, 10),
  ])).digest("hex")
}

const timestamp = z.string().datetime().refine((value) => {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
})
const date = z.string().refine(isDateKey)
const snapshotSchema = z.object({
  id: z.string().min(1), organizationId: z.string().min(1), date,
  kind: z.enum(["MOVED_DAY_OFF", "MOVED_WORKDAY"]), name: z.string().min(1).max(160),
  teamId: z.string().min(1).nullable(), agentId: z.null(), movedToDate: date,
  routePlanningAllowed: z.boolean(), source: z.literal("ADMIN"),
  createdBy: z.string().nullable(), updatedBy: z.string().nullable(),
  createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp.nullable(),
}).strict()

export const calendarReversalReceiptSchema = z.object({
  version: z.literal(1), operation: z.literal("REVERSE_MOVE_WORKDAY"),
  pairGenerationId: z.string().regex(/^[a-f0-9]{64}$/),
  organizationId: z.string().min(1), scope: z.enum(["ORGANIZATION", "TEAM"]),
  teamId: z.string().min(1).nullable(), sourceDate: date, destinationDate: date,
  actorUserId: z.string().min(1), reversedAt: timestamp,
  rows: z.tuple([snapshotSchema, snapshotSchema]),
}).strict()

export type CalendarReversalReceipt = z.infer<typeof calendarReversalReceiptSchema>

export function calendarReversalSnapshot(row: CalendarReversalRow) {
  return {
    id: row.id, organizationId: row.organizationId, date: row.date.toISOString().slice(0, 10),
    kind: row.kind, name: row.name, teamId: row.teamId, agentId: row.agentId,
    movedToDate: row.movedToDate?.toISOString().slice(0, 10) ?? null,
    routePlanningAllowed: row.routePlanningAllowed, source: row.source,
    createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

/** Exact snapshots have a canonical field order, also after strict parsing. */
export function calendarSnapshotEquals(row: CalendarReversalRow, snapshot: CalendarReversalReceipt["rows"][number]): boolean {
  return JSON.stringify(calendarReversalSnapshot(row)) === JSON.stringify(snapshot)
}

export function calendarRowFromSnapshot(snapshot: CalendarReversalReceipt["rows"][number]): CalendarReversalRow {
  return {
    ...snapshot, date: new Date(`${snapshot.date}T00:00:00.000Z`),
    movedToDate: new Date(`${snapshot.movedToDate}T00:00:00.000Z`),
    createdAt: new Date(snapshot.createdAt), updatedAt: new Date(snapshot.updatedAt),
    deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
  }
}
