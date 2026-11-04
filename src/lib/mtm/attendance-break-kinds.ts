import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { requireAttendanceQrAdmin } from "@/lib/mtm/attendance-qr-policy"
import { MTM_WORKDAY_PAUSE_EVENT_TYPES, mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import type { MtmWorkdayEventInput } from "@/lib/mtm/workday"
import { ATTENDANCE_BREAK_KIND_ID as KIND_ID } from "@/lib/mtm/attendance-break-contract"
import { ATTENDANCE_BREAK_KINDS_MAX, ATTENDANCE_BUILT_IN_BREAK_KINDS, attendanceBreakKindTotals, type AttendanceBreakKind, type AttendanceBreakKindTotal, type AttendanceBreakLabel } from "@/lib/mtm/attendance-break-kinds-names"

export { ATTENDANCE_BREAK_KINDS_MAX, ATTENDANCE_BUILT_IN_BREAK_KINDS, attendanceBreakKindTotals, type AttendanceBreakKind, type AttendanceBreakKindTotal, type AttendanceBreakLabel }

/**
 * Kinds of a break (owner, 2026-11-04: «отходит от компьютера, идёт покурить…
 * чтобы это тоже как-то могло фиксироваться»; mockup approved with «Давай,
 * делай»). Off by default: until the company turns it on, «Fasilə» stays one
 * tap and nothing in the app changes.
 *
 * A kind is a label on the PAUSE event, nothing more: where the employee was
 * is still never recorded (rule 3 of docs/mtm-attendance/README.md), and the
 * worked time is computed exactly as before. A daily limit only raises a
 * remark for HR — «Перекур 48 из 30 мин»; it takes no time off by itself.
 *
 * The three built-in kinds carry no stored name (`name: null`): every screen
 * shows them in its own language. A renamed or added kind keeps the words the
 * administrator typed. Each label keeps a copy of the kind's name and limit at
 * the moment of the break, so renaming or deleting a kind does not rewrite
 * yesterday's timesheet.
 */
export const ATTENDANCE_BREAK_KINDS_KEY = "attendanceBreakKinds"

export type AttendanceBreakKindSettings = { enabled: boolean; kinds: AttendanceBreakKind[] }
export const DEFAULT_ATTENDANCE_BREAK_KINDS: AttendanceBreakKindSettings = {
  enabled: false,
  kinds: [{ id: "smoke", name: null, limitMinutes: 30 }, { id: "lunch", name: null, limitMinutes: 60 }, { id: "personal", name: null, limitMinutes: null }],
}

const limit = z.number().int().min(1).max(720).nullable()
const StoredSchema = z.object({ enabled: z.boolean(), kinds: z.array(z.object({ id: z.string().regex(KIND_ID), name: z.string().min(1).max(40).nullable(), limitMinutes: limit }).strict()).max(ATTENDANCE_BREAK_KINDS_MAX) }).strict()
/** What the administrator sends: a new kind has no id yet. */
export const AttendanceBreakKindsInputSchema = z.object({
  enabled: z.boolean(),
  kinds: z.array(z.object({ id: z.string().regex(KIND_ID).nullable(), name: z.string().trim().max(40).nullable(), limitMinutes: limit }).strict()).max(ATTENDANCE_BREAK_KINDS_MAX),
}).strict()

type Tx = Prisma.TransactionClient
const isBuiltIn = (id: string) => (ATTENDANCE_BUILT_IN_BREAK_KINDS as readonly string[]).includes(id)

export function coerceAttendanceBreakKinds(value: unknown): AttendanceBreakKindSettings {
  const parsed = StoredSchema.safeParse(value)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_ATTENDANCE_BREAK_KINDS)
}
export async function readAttendanceBreakKinds(tx: Pick<Tx, "mtmSetting">, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_BREAK_KINDS_KEY } }, select: { value: true } })
  return coerceAttendanceBreakKinds(row?.value)
}
export async function readAttendanceBreakKindSettings(organizationId: string) {
  return readAttendanceBreakKinds(prisma, organizationId)
}

/** The whole list at once, by a current administrator; audited, an unchanged list writes nothing. */
export async function saveAttendanceBreakKinds(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceBreakKindsInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-break-kinds:${reviewer.organizationId}`},0))`
    await requireAttendanceQrAdmin(tx, reviewer)
    const before = await readAttendanceBreakKinds(tx, reviewer.organizationId)
    const seen = new Set<string>()
    const kinds: AttendanceBreakKind[] = []
    for (const kind of parsed.data.kinds) {
      const id = kind.id ?? `k-${randomUUID().slice(0, 8)}`
      if (seen.has(id)) throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_INVALID", 400)
      seen.add(id)
      // Only a built-in kind may stay nameless: it is named by each screen's language.
      const name = kind.name ? kind.name : null
      if (!name && !isBuiltIn(id)) throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_NAME_REQUIRED", 400)
      kinds.push({ id, name, limitMinutes: kind.limitMinutes })
    }
    if (parsed.data.enabled && !kinds.length) throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_EMPTY", 400)
    const next: AttendanceBreakKindSettings = { enabled: parsed.data.enabled, kinds }
    if (JSON.stringify(before) === JSON.stringify(next)) return { settings: next, changed: false }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_BREAK_KINDS_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_BREAK_KINDS_KEY, value: next }, update: { value: next } })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_BREAK_KINDS_CHANGED",
      entity: "settings", entityId: reviewer.organizationId, metadataKind: "mtm_attendance_breaks", oldData: before, newData: next } })
    return { settings: next, changed: true }
  }, { timeout: 15000 })
}

/**
 * Runs inside the canonical workday transaction, after a new PAUSE event: the
 * kind the employee chose, with a copy of its name and limit. Nothing is kept
 * when the company does not ask for kinds or no longer has that kind.
 */
export async function recordAttendanceBreakKind(tx: Tx, scope: { organizationId: string; agentId: string }, input: MtmWorkdayEventInput, eventId: string) {
  if (input.action !== "PAUSE" || !input.attendanceBreak) return
  const settings = await readAttendanceBreakKinds(tx, scope.organizationId)
  const kind = settings.enabled ? settings.kinds.find(item => item.id === input.attendanceBreak!.kindId) : undefined
  if (!kind) return
  await tx.$executeRaw`INSERT INTO mtm_attendance_break_labels(id,"organizationId","agentId","eventId","kindId","kindName","limitMinutes")
    VALUES (${randomUUID()},${scope.organizationId},${scope.agentId},${eventId},${kind.id},${kind.name},${kind.limitMinutes})`
}

/** Labels of the PAUSE events of these workdays, for the report. */
export async function readAttendanceBreakLabels(tx: Pick<Tx, "$queryRaw">, organizationId: string, workdayIds: readonly string[]) {
  const result = new Map<string, AttendanceBreakLabel[]>()
  if (!workdayIds.length) return result
  const rows = await tx.$queryRaw<{ workdayId: string; occurredAt: Date; kindId: string; kindName: string | null; limitMinutes: number | null }[]>`
    SELECT e."workdayId",e."occurredAt",l."kindId",l."kindName",l."limitMinutes" FROM mtm_attendance_break_labels l
    JOIN mtm_agent_workday_events e ON e."organizationId"=l."organizationId" AND e.id=l."eventId" AND e."agentId"=l."agentId"
    WHERE l."organizationId"=${organizationId} AND e."workdayId"=ANY(${[...workdayIds]}::text[]) LIMIT 200001`
  if (rows.length > 200000) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
  for (const row of rows) {
    const list = result.get(row.workdayId) ?? []
    list.push({ at: row.occurredAt.toISOString(), kindId: row.kindId, kindName: row.kindName, limitMinutes: row.limitMinutes })
    result.set(row.workdayId, list)
  }
  return result
}

/**
 * What the employee's own screen needs for today: the kinds to choose from,
 * how much of each is used, and the kind of the break going on now.
 */
export async function readOwnAttendanceBreakDay(tx: Pick<Tx, "$queryRaw" | "mtmSetting" | "mtmAgentWorkdayEvent">, scope: { organizationId: string; agentId: string }, workdayId: string | null, now = new Date()) {
  const settings = await readAttendanceBreakKinds(tx, scope.organizationId)
  if (!settings.enabled) return null
  let totals: AttendanceBreakKindTotal[] = [], current: string | null = null
  if (workdayId) {
    const events = await tx.mtmAgentWorkdayEvent.findMany({ where: { organizationId: scope.organizationId, agentId: scope.agentId, workdayId, type: { in: [...MTM_WORKDAY_PAUSE_EVENT_TYPES] } },
      select: { type: true, occurredAt: true, appliedAt: true }, orderBy: [{ occurredAt: "asc" }, { appliedAt: "asc" }, { id: "asc" }], take: 2001 })
    const labels = (await readAttendanceBreakLabels(tx, scope.organizationId, [workdayId])).get(workdayId) ?? []
    const pauses = mtmWorkdayPauses(events)
    totals = attendanceBreakKindTotals(pauses, labels, now)
    const open = pauses.find(pause => pause.to === null)
    current = open ? labels.find(label => new Date(label.at).getTime() === open.from.getTime())?.kindId ?? null : null
  }
  return {
    kinds: settings.kinds.map(kind => ({ ...kind, usedSeconds: totals.find(total => total.kindId === kind.id)?.seconds ?? 0 })),
    currentKindId: current,
  }
}
