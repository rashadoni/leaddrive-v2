import { z } from "zod"
import type { Prisma, PrismaClient } from "@prisma/client"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"
import {
  MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT,
  readVisitEvaluationQuestionSnapshot,
  readVisitEvaluationScores,
  visitEvaluationAverage,
  type MtmVisitEvaluationQuestion,
  type MtmVisitEvaluationScores,
} from "@/lib/mtm/visit-evaluation-questions"

/**
 * Joint visit — a manager in the field with one agent (owner, 2026-10-20:
 * «менеджер может идти с агентом вместе к клиенту… во время визита менеджер
 * мог оценивать работу агента»). Owner-approved mockup, the same day:
 *
 * 1. The manager taps «Иду на визит с агентом» and picks an agent of his team:
 *    a session (`MtmJointFieldSession`). It ends with «Закончить совместный
 *    визит» or by itself at the end of that organization-local day.
 * 2. While it is open, the agent's «Я приехал — начать визит» asks «Этот
 *    визит — вместе с руководителем?». A «yes» rides the offline check-in and
 *    writes the manager as an OBSERVER participant pointing at the session.
 *    The session alone makes no visit joint: the agent says which were.
 * 3. The manager rates only such a visit: the company's questions
 *    (visit-evaluation-questions.ts; six until it edits them), 1..5 each, a
 *    skipped question did not come up; a comment. From the check-in until the
 *    end of the next organization-local day. Each rating keeps the list it was
 *    given against.
 *
 * The agent never reads a rating («агент оценку не видит»).
 */

export { readVisitEvaluationScores, visitEvaluationAverage }
export type { MtmVisitEvaluationQuestion, MtmVisitEvaluationScores }

export const MTM_VISIT_EVALUATION_COMMENT_MAX = 2000

/**
 * The shape of a rating: question id → 1..5. Whether those ids are questions
 * the company asks today is the next check (visitEvaluationScoresAgainst):
 * it needs the company's list.
 */
export const VisitEvaluationInputSchema = z.object({
  scores: z.record(z.string().min(1).max(40), z.number().int().min(1).max(5))
    .refine((scores) => Object.keys(scores).length > 0, { message: "Rate at least one point" })
    .refine((scores) => Object.keys(scores).length <= MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT, { message: "Too many points" }),
  comment: z.string().max(MTM_VISIT_EVALUATION_COMMENT_MAX).optional().nullable(),
}).strict()

/**
 * The scores of a new rating against the company's list of today. A question
 * the company no longer asks — deleted after the phone loaded the sheet, or
 * never its own — refuses the whole rating rather than losing the score the
 * manager gave: he is told the list changed and rates again.
 */
export function visitEvaluationScoresAgainst(
  scores: Record<string, number>,
  questions: readonly MtmVisitEvaluationQuestion[],
): { ok: true; scores: MtmVisitEvaluationScores } | { ok: false; unknown: string[] } {
  const asked = new Set(questions.map((question) => question.id))
  const unknown = Object.keys(scores).filter((id) => !asked.has(id))
  if (unknown.length) return { ok: false, unknown }
  return { ok: true, scores: readVisitEvaluationScores(scores, questions) }
}

/** A stored rating as every screen shows it: its own list, its scores on that list, their mean. */
export function storedVisitEvaluation(row: { scores: unknown; questions: unknown }): {
  questions: MtmVisitEvaluationQuestion[]
  scores: MtmVisitEvaluationScores
  average: number | null
} {
  const questions = readVisitEvaluationQuestionSnapshot(row.questions)
  const scores = readVisitEvaluationScores(row.scores, questions)
  return { questions, scores, average: visitEvaluationAverage(scores) }
}

/** A phone's clock and the server's disagree by this much without anyone lying. */
const CLOCK_SLACK_MS = 5 * 60_000

type SessionTimes = { startedAt: Date; endedAt: Date | null }

/** The first instant after the organization-local day the session started on. */
export function jointSessionDayEnd(startedAt: Date, timezone: string): Date {
  return localDateKeyToUtc(addDateKeyDays(currentDateKey(startedAt, timezone), 1), timezone)
}

/** Not ended by the manager, and its day not over. */
export function jointSessionIsOpen(session: SessionTimes, now: Date, timezone: string): boolean {
  return session.endedAt === null && now.getTime() < jointSessionDayEnd(session.startedAt, timezone).getTime()
}

/**
 * Did the session cover a check-in at `at`? The check-in time is the phone's,
 * possibly queued offline, so it is compared with a few minutes of slack.
 */
export function jointSessionCovers(session: SessionTimes, at: Date, timezone: string): boolean {
  const time = at.getTime()
  if (session.startedAt.getTime() - CLOCK_SLACK_MS > time) return false
  if (session.endedAt && session.endedAt.getTime() + CLOCK_SLACK_MS < time) return false
  return time < jointSessionDayEnd(session.startedAt, timezone).getTime()
}

/** The last instant a rating can be given or changed: the end of the day after the check-in. */
export function visitEvaluationDeadline(checkInAt: Date, timezone: string): Date {
  return localDateKeyToUtc(addDateKeyDays(currentDateKey(checkInAt, timezone), 2), timezone)
}

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Whom a manager may accompany: an ACTIVE field agent in his scope (the same
 * team «Команда» shows), never himself. Null when the agent is not one.
 */
export async function accompaniableAgent(
  db: Db,
  input: { organizationId: string; managerAgentId: string; managerRole: string; agentId: string },
): Promise<{ id: string; name: string } | null> {
  if (input.agentId === input.managerAgentId || !isValidMtmAgentRole(input.managerRole) || input.managerRole === "AGENT") return null
  const scope = await resolveAgentScope(db, {
    organizationId: input.organizationId,
    agentId: input.managerAgentId,
    role: input.managerRole,
  })
  if (scope.agentIds && !scope.agentIds.includes(input.agentId)) return null
  return db.mtmAgent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId, role: "AGENT", status: "ACTIVE" },
    select: { id: true, name: true },
  })
}

/**
 * Close every session of this manager that is still marked open, at the
 * moment it actually ended: now, or the end of its own day if that came first.
 */
export async function closeManagerJointSessions(
  db: Db,
  input: { organizationId: string; managerAgentId: string; now: Date; timezone: string },
): Promise<number> {
  const open = await db.mtmJointFieldSession.findMany({
    where: { organizationId: input.organizationId, managerAgentId: input.managerAgentId, endedAt: null },
    select: { id: true, startedAt: true },
  })
  for (const session of open) {
    const dayEnd = jointSessionDayEnd(session.startedAt, input.timezone)
    const endedAt = dayEnd.getTime() < input.now.getTime() ? dayEnd : input.now
    await db.mtmJointFieldSession.updateMany({
      where: { id: session.id, organizationId: input.organizationId, endedAt: null },
      data: { endedAt },
    })
  }
  return open.length
}

/** The managers in the field with this agent right now — what the check-in question names. */
export async function openJointSessionsForAgent(
  db: Db,
  input: { organizationId: string; agentId: string; now: Date; timezone: string },
): Promise<Array<{ id: string; startedAt: Date; manager: { id: string; name: string } }>> {
  const todayStart = localDateKeyToUtc(currentDateKey(input.now, input.timezone), input.timezone)
  const rows = await db.mtmJointFieldSession.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      endedAt: null,
      startedAt: { gte: todayStart },
      manager: { status: "ACTIVE" },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, manager: { select: { id: true, name: true } } },
  })
  return rows.filter((row) => jointSessionIsOpen({ startedAt: row.startedAt, endedAt: null }, input.now, input.timezone))
}

/**
 * The agent answered «yes, together with this manager» at check-in. Writes the
 * manager as an OBSERVER of the visit when one of his sessions with this agent
 * covered the check-in, and says whether it did. A «yes» that no session
 * backs — the manager had already ended it, or never started one — leaves the
 * visit as it is: the check-in itself is never refused for it.
 */
export async function attachJointManagerToVisit(
  db: Db,
  input: {
    organizationId: string
    visitId: string
    agentId: string
    managerAgentId: string
    checkInAt: Date
    timezone: string
  },
): Promise<boolean> {
  if (input.managerAgentId === input.agentId) return false
  const dayStart = localDateKeyToUtc(currentDateKey(input.checkInAt, input.timezone), input.timezone)
  const sessions = await db.mtmJointFieldSession.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      managerAgentId: input.managerAgentId,
      // The session of the check-in's own day, or of the day before when the
      // phone's clock sits just past midnight: jointSessionCovers decides.
      startedAt: { gte: new Date(dayStart.getTime() - 24 * 60 * 60_000), lte: new Date(input.checkInAt.getTime() + CLOCK_SLACK_MS) },
      manager: { status: "ACTIVE" },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true },
  })
  const session = sessions.find((row) => jointSessionCovers(row, input.checkInAt, input.timezone))
  if (!session) return false
  await db.mtmVisitParticipant.upsert({
    where: { visitId_agentId: { visitId: input.visitId, agentId: input.managerAgentId } },
    create: {
      organizationId: input.organizationId,
      visitId: input.visitId,
      agentId: input.managerAgentId,
      role: "OBSERVER",
      joinedAt: input.checkInAt,
      jointSessionId: session.id,
    },
    // The manager may already be on the visit from a route assignment: the
    // agent's answer adds the session to that row, it does not change its role.
    update: { jointSessionId: session.id },
  })
  return true
}

/** The manager this visit was joint with, by the agent's own answer; null if none. */
export function jointManagerOf(
  participants: Array<{ agentId: string; jointSessionId: string | null; agent?: { id: string; name: string } | null }>,
): { id: string; name: string | null } | null {
  const row = participants.find((participant) => participant.jointSessionId)
  return row ? { id: row.agentId, name: row.agent?.name ?? null } : null
}
