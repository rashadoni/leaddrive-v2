import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { notifyAgents } from "@/lib/mtm/push-notify"
import { formatDate } from "@/lib/format-date"
import { canReviewMtmRouteRequest } from "@/lib/mtm/route-permissions"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceRequests, requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { readAttendanceProjectionInTransaction } from "@/lib/mtm/attendance-report-store"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import {
  ATTENDANCE_EXPLANATION_LOOKBACK_DAYS, AttendanceExplanationAnswerSchema, AttendanceExplanationDecisionSchema, AttendanceExplanationError,
  AttendanceExplanationListSchema, AttendanceExplanationRequestSchema, attendanceExplanationCandidates,
  type AttendanceExplanationCandidate, type AttendanceExplanationDto, type AttendanceExplanationKind, type AttendanceExplanationStatus,
} from "@/lib/mtm/attendance-explanation-contract"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

export const ATTENDANCE_EXPLANATION_ENTITY = "mtm_attendance_explanation"
export const ATTENDANCE_EXPLANATION_NOTIFICATION_KIND = "mtm.attendanceExplanation.answered"
const MESSAGES = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
type Locale = keyof typeof MESSAGES
const localeOf = (value: string | null | undefined): Locale => value === "ru" || value === "en" ? value : "az"
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""))
const dayLabel = (date: string, locale: Locale) => formatDate(`${date}T12:00:00.000Z`, locale, { day: "numeric", month: "long", timeZone: "UTC" })
const key = (agentId: string, date: string, kind: string) => `${agentId}|${date}|${kind}`

const select = {
  id: true, agentId: true, workDate: true, kind: true, status: true, lateMinutes: true, requestedByUserId: true, requestedAt: true,
  answer: true, answeredAt: true, decidedByUserId: true, decidedAt: true,
} satisfies Prisma.MtmAttendanceExplanationSelect
type Row = Prisma.MtmAttendanceExplanationGetPayload<{ select: typeof select }>

async function dtos(db: Prisma.TransactionClient, organizationId: string, rows: Row[]): Promise<AttendanceExplanationDto[]> {
  const agents = await db.mtmAgent.findMany({ where: { organizationId, id: { in: [...new Set(rows.map(row => row.agentId))] } }, select: { id: true, name: true } })
  const userIds = [...new Set(rows.flatMap(row => [row.requestedByUserId, row.decidedByUserId]).filter((id): id is string => !!id))]
  const users = userIds.length ? await db.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : []
  const agentName = new Map(agents.map(agent => [agent.id, agent.name])), userName = new Map(users.map(user => [user.id, user.name]))
  return rows.map(row => ({
    id: row.id, employeeId: row.agentId, employeeName: agentName.get(row.agentId) ?? "—", date: row.workDate.toISOString().slice(0, 10),
    kind: row.kind as AttendanceExplanationKind, status: row.status as AttendanceExplanationStatus, lateMinutes: row.lateMinutes,
    requestedAt: row.requestedAt?.toISOString() ?? null, requestedByName: row.requestedByUserId ? userName.get(row.requestedByUserId) ?? null : null,
    answer: row.answer, answeredAt: row.answeredAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null, decidedByName: row.decidedByUserId ? userName.get(row.decidedByUserId) ?? null : null,
  }))
}

async function lockExplanations(db: Prisma.TransactionClient, organizationId: string) {
  await db.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-explanations:${organizationId}`}, 0))`
}

async function organizationToday(db: Prisma.TransactionClient, organizationId: string, now: Date) {
  const setting = await db.mtmSetting.findFirst({ where: { organizationId, key: "timezone" }, select: { value: true } })
  return currentDateKey(now, typeof setting?.value === "string" ? setting.value : "Asia/Baku")
}

/** Late or absent days of these people in the period, read from the one report. */
async function candidatesFor(db: Prisma.TransactionClient, organizationId: string, agentIds: string[], from: string, to: string, now: Date) {
  const report = await readAttendanceProjectionInTransaction(db, { organizationId, authorizedEmployeeIds: agentIds, query: { from, to, form: "ALL" }, now })
  return new Map(attendanceExplanationCandidates(report.rows).map(item => [key(item.employeeId, item.date, item.kind), item]))
}

/**
 * HR asks for explanations (Today → «Запросить объяснительную»). A day that
 * is not late or unexplained-absent is skipped, never turned into a request;
 * a day already asked or answered is left as it is. Each new request lands in
 * the employee's inbox in their language and as a push to their phone.
 */
export async function requestAttendanceExplanations(reviewer: AttendanceReviewer, raw: unknown, now = new Date()) {
  const parsed = AttendanceExplanationRequestSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_INVALID", 400)
  const items = [...new Map(parsed.data.items.map(item => [key(item.agentId, item.date, item.kind), item])).values()]
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const { organizationId, userId } = reviewer
    await lockExplanations(tx, organizationId)
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const agentIds = [...new Set(items.map(item => item.agentId))].sort()
    const targets = await tx.mtmAgent.findMany({ where: { organizationId, id: { in: agentIds }, status: "ACTIVE", ...ATTENDANCE_TRACKED_CARD_WHERE },
      select: { id: true, userId: true, user: { select: { preferredLanguage: true } } } })
    if (targets.length !== agentIds.length || targets.some(target => target.userId === userId || !canReviewMtmRouteRequest(actor, target.id))) {
      throw new AttendanceExplanationError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    }
    const today = await organizationToday(tx, organizationId, now)
    const dates = items.map(item => item.date).sort()
    if (dates[0] < addDateKeyDays(today, -ATTENDANCE_EXPLANATION_LOOKBACK_DAYS) || dates.at(-1)! > today) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_DATE_INVALID", 400)
    const candidates = await candidatesFor(tx, organizationId, agentIds, dates[0], dates.at(-1)!, now)
    const existing = await tx.mtmAttendanceExplanation.findMany({ where: { organizationId, agentId: { in: agentIds },
      workDate: { gte: new Date(`${dates[0]}T00:00:00Z`), lte: new Date(`${dates.at(-1)}T00:00:00Z`) } }, select: { agentId: true, workDate: true, kind: true } })
    const taken = new Set(existing.map(row => key(row.agentId, row.workDate.toISOString().slice(0, 10), row.kind)))
    const locale = new Map(targets.map(target => [target.id, localeOf(target.user?.preferredLanguage)]))
    let notNeeded = 0, already = 0
    const pushes: { agentId: string; title: string; body: string; id: string }[] = []
    for (const item of items) {
      const candidate = candidates.get(key(item.agentId, item.date, item.kind))
      if (!candidate) { notNeeded++; continue }
      if (taken.has(key(item.agentId, item.date, item.kind))) { already++; continue }
      const id = randomUUID()
      await tx.mtmAttendanceExplanation.create({ data: { id, organizationId, agentId: item.agentId, workDate: new Date(`${item.date}T00:00:00Z`), kind: item.kind,
        status: "REQUESTED", lateMinutes: candidate.lateMinutes, requestedByUserId: userId, requestedAt: now } })
      await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: item.agentId, action: "MTM_ATTENDANCE_EXPLANATION_REQUESTED",
        entity: ATTENDANCE_EXPLANATION_ENTITY, entityId: id, metadataKind: "mtm_attendance_explanation", newData: { date: item.date, kind: item.kind } } })
      const t = MESSAGES[locale.get(item.agentId)!], date = dayLabel(item.date, locale.get(item.agentId)!)
      const title = item.kind === "LATE" ? fill(t.explanationAskLate, { date, minutes: candidate.lateMinutes ?? 0 }) : fill(t.explanationAskAbsent, { date })
      // The inbox line says only the day and the kind; the answer stays in the app.
      await tx.mtmNotification.create({ data: { organizationId, agentId: item.agentId, type: "warning", title, body: t.explanationAskBody,
        metadata: { domain: "route", attendanceExplanationId: id, kind: item.kind, date: item.date } } })
      pushes.push({ agentId: item.agentId, title, body: t.explanationAskBody, id })
    }
    return { created: pushes.length, already, notNeeded, pushes }
  }, { timeout: 30_000 })
  // Fire-and-forget, as every push: one that did not go out never undoes the request.
  for (const push of result.pushes) {
    void notifyAgents({ client: prisma, organizationId: reviewer.organizationId, agentIds: [push.agentId], title: push.title, body: push.body,
      data: { target: "AttendanceExplanations", explanationId: push.id } }).catch(error => console.warn("[MTM/attendance/explanations] push failed", error))
  }
  return { created: result.created, already: result.already, notNeeded: result.notNeeded }
}

export async function listAttendanceExplanations(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceExplanationListSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const rows = await tx.mtmAttendanceExplanation.findMany({ where: { organizationId: reviewer.organizationId,
      workDate: { gte: new Date(`${parsed.data.from}T00:00:00Z`), lte: new Date(`${parsed.data.to}T00:00:00Z`) },
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }) },
    select, orderBy: [{ workDate: "desc" }, { agentId: "asc" }, { kind: "asc" }], take: 2001 })
    if (rows.length > 2000) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_TOO_MANY", 400)
    return { items: await dtos(tx, reviewer.organizationId, rows) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

/** HR accepts an answered explanation or does not; the employee is told. */
export async function decideAttendanceExplanation(reviewer: AttendanceReviewer, id: string, raw: unknown, now = new Date()) {
  const parsed = AttendanceExplanationDecisionSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const { organizationId, userId } = reviewer
    await lockExplanations(tx, organizationId)
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const row = await tx.mtmAttendanceExplanation.findFirst({ where: { id, organizationId }, select })
    if (!row) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_NOT_FOUND", 404)
    const agent = await tx.mtmAgent.findFirst({ where: { organizationId, id: row.agentId }, select: { userId: true, user: { select: { preferredLanguage: true } } } })
    if (!agent || agent.userId === userId || !canReviewMtmRouteRequest(actor, row.agentId)) throw new AttendanceExplanationError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const decision = parsed.data.decision
    if (row.status === decision) return { item: (await dtos(tx, organizationId, [row]))[0], idempotent: true }
    if (row.status !== "ANSWERED") throw new AttendanceExplanationError(row.status === "REQUESTED" ? "MTM_ATTENDANCE_EXPLANATION_NOT_ANSWERED" : "MTM_ATTENDANCE_EXPLANATION_DECIDED")
    const updated = await tx.mtmAttendanceExplanation.update({ where: { id }, data: { status: decision, decidedByUserId: userId, decidedAt: now }, select })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: row.agentId, action: "MTM_ATTENDANCE_EXPLANATION_DECIDED",
      entity: ATTENDANCE_EXPLANATION_ENTITY, entityId: id, metadataKind: "mtm_attendance_explanation", oldData: { status: row.status }, newData: { status: decision } } })
    const locale = localeOf(agent.user?.preferredLanguage), t = MESSAGES[locale]
    await tx.mtmNotification.create({ data: { organizationId, agentId: row.agentId, type: decision === "ACCEPTED" ? "info" : "warning",
      title: fill(decision === "ACCEPTED" ? t.explanationAccepted : t.explanationRejected, { date: dayLabel(row.workDate.toISOString().slice(0, 10), locale) }),
      metadata: { domain: "route", attendanceExplanationId: id, status: decision } } })
    return { item: (await dtos(tx, organizationId, [updated]))[0], idempotent: false }
  }, { timeout: 15_000 })
}

/** The app's «Объяснительные»: what HR asked, what was answered, and the
 * late or absent days of the last month the employee may still explain. */
export async function listOwnAttendanceExplanations(self: AttendanceSelf, now = new Date()) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceSelf(tx, self)
    const today = currentDateKey(now, timezone), from = addDateKeyDays(today, -ATTENDANCE_EXPLANATION_LOOKBACK_DAYS)
    const rows = await tx.mtmAttendanceExplanation.findMany({ where: { organizationId: self.organizationId, agentId: self.agentId,
      workDate: { gte: new Date(`${from}T00:00:00Z`) } }, select, orderBy: [{ workDate: "desc" }, { kind: "asc" }], take: 200 })
    const taken = new Set(rows.map(row => key(row.agentId, row.workDate.toISOString().slice(0, 10), row.kind)))
    const candidates: AttendanceExplanationCandidate[] = [...(await candidatesFor(tx, self.organizationId, [self.agentId], from, today, now)).values()]
      .filter(item => !taken.has(key(item.employeeId, item.date, item.kind)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
      .map(({ date, kind, lateMinutes }) => ({ date, kind, lateMinutes }))
    return { today, items: await dtos(tx, self.organizationId, rows), candidates }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

/**
 * The employee writes the explanation: an answer to HR's request, or on their
 * own for a late or absent day. It can be corrected until HR decides. The one
 * who asked is told in the CRM that the answer came.
 */
export async function answerOwnAttendanceExplanation(self: AttendanceSelf, raw: unknown, now = new Date()) {
  const parsed = AttendanceExplanationAnswerSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_INVALID", 400)
  const input = parsed.data
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceRequests(tx, self)
    await lockExplanations(tx, self.organizationId)
    const timezone = await requireAttendanceSelf(tx, self)
    const today = currentDateKey(now, timezone)
    if (input.date > today || input.date < addDateKeyDays(today, -ATTENDANCE_EXPLANATION_LOOKBACK_DAYS)) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_DATE_INVALID", 400)
    const workDate = new Date(`${input.date}T00:00:00Z`)
    const row = await tx.mtmAttendanceExplanation.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, workDate, kind: input.kind }, select })
    let saved: Row
    if (row) {
      if (row.status === "ACCEPTED" || row.status === "REJECTED") throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_DECIDED")
      if (row.status === "ANSWERED" && row.answer === input.text) return { item: (await dtos(tx, self.organizationId, [row]))[0], idempotent: true }
      saved = await tx.mtmAttendanceExplanation.update({ where: { id: row.id }, data: { status: "ANSWERED", answer: input.text, answeredAt: now }, select })
    } else {
      const candidate = (await candidatesFor(tx, self.organizationId, [self.agentId], input.date, input.date, now)).get(key(self.agentId, input.date, input.kind))
      if (!candidate) throw new AttendanceExplanationError("MTM_ATTENDANCE_EXPLANATION_NOT_NEEDED")
      saved = await tx.mtmAttendanceExplanation.create({ data: { id: randomUUID(), organizationId: self.organizationId, agentId: self.agentId, workDate, kind: input.kind,
        status: "ANSWERED", lateMinutes: candidate.lateMinutes, answer: input.text, answeredAt: now }, select })
    }
    await tx.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId, action: "MTM_ATTENDANCE_EXPLANATION_ANSWERED",
      entity: ATTENDANCE_EXPLANATION_ENTITY, entityId: saved.id, metadataKind: "mtm_attendance_explanation", newData: { date: input.date, kind: input.kind, requested: !!saved.requestedByUserId } } })
    if (saved.requestedByUserId) {
      const [reader] = await tx.$queryRaw<{ preferredLanguage: string | null }[]>`SELECT "preferredLanguage" FROM users WHERE "organizationId"=${self.organizationId} AND id=${saved.requestedByUserId} AND "isActive" AND "anonymizedAt" IS NULL`
      if (reader) {
        const agent = await tx.mtmAgent.findFirst({ where: { organizationId: self.organizationId, id: self.agentId }, select: { name: true } })
        const locale = localeOf(reader.preferredLanguage), t = MESSAGES[locale]
        await createNotification({ organizationId: self.organizationId, userId: saved.requestedByUserId, type: "info",
          title: fill(t.explanationAnsweredTitle, { name: agent?.name ?? "—", date: dayLabel(input.date, locale) }), message: t.explanationAnsweredBody,
          entityType: ATTENDANCE_EXPLANATION_ENTITY, entityId: saved.id, kind: ATTENDANCE_EXPLANATION_NOTIFICATION_KIND,
          idempotencyKey: `mtm-attendance-explanation:${saved.id}:${now.toISOString()}`, client: tx })
      }
    }
    return { item: (await dtos(tx, self.organizationId, [saved]))[0], idempotent: false }
  }, { timeout: 15_000 })
}
