import { prisma } from "@/lib/prisma"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { jointSessionIsOpen, storedVisitEvaluation, visitEvaluationDeadline } from "@/lib/mtm/joint-visit"
import type { MtmVisitEvaluationQuestion } from "@/lib/mtm/visit-evaluation-questions"
import { jointPlanWindow, managerJointPlans } from "@/lib/mtm/joint-visit-plan"

/**
 * What the manager's phone shows of a joint visit — the «Совместный визит»
 * screen and the card on «Команда» (src/lib/mtm/joint-visit.ts). Read by the
 * manager's joint-visit routes after every change, so the phone redraws from
 * one answer.
 */

/** The two settings a joint visit reads: the company's day and the questions it rates by. */
export async function organizationJointVisitSettings(
  organizationId: string,
): Promise<{ timezone: string; questions: MtmVisitEvaluationQuestion[] }> {
  const settings = await getMtmSettings(organizationId)
  return {
    timezone: isValidTimezone(settings.timezone) ? settings.timezone : "UTC",
    questions: settings.visitEvaluationQuestions,
  }
}

export async function organizationTimezone(organizationId: string): Promise<string> {
  return (await organizationJointVisitSettings(organizationId)).timezone
}

type SessionRow = { id: string; startedAt: Date; endedAt: Date | null; agent: { id: string; name: string } }

type VisitRow = {
  id: string
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  agent: { id: string; name: string }
  customer: { id: string; name: string }
  contact: { id: string; displayName: string | null; specialtyName: string | null } | null
  participants: Array<{ jointSessionId: string | null }>
  evaluations: Array<{ scores: unknown; questions: unknown; comment: string | null; updatedAt: Date }>
}

export async function openSession(auth: MobileAuthResult, now: Date, timezone: string): Promise<SessionRow | null> {
  const rows: SessionRow[] = await prisma.mtmJointFieldSession.findMany({
    where: { organizationId: auth.orgId, managerAgentId: auth.agentId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true, agent: { select: { id: true, name: true } } },
  })
  return rows.find((row) => jointSessionIsOpen(row, now, timezone)) ?? null
}

export function sessionJson(session: SessionRow | null) {
  return session ? { id: session.id, startedAt: session.startedAt.toISOString(), agent: session.agent } : null
}

export async function jointState(auth: MobileAuthResult) {
  const now = new Date()
  const { timezone, questions } = await organizationJointVisitSettings(auth.orgId)
  const session = await openSession(auth, now, timezone)
  const scope = isValidMtmAgentRole(auth.role)
    ? await resolveAgentScope(prisma, { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role })
    : { agentIds: [] as string[] }
  // A visit checked in yesterday can still be rated today; one from the day
  // before cannot.
  const windowStart = localDateKeyToUtc(addDateKeyDays(currentDateKey(now, timezone), -1), timezone)
  const visits: VisitRow[] = await prisma.mtmVisit.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      ...(scope.agentIds ? { agentId: { in: scope.agentIds } } : {}),
      OR: [
        {
          participants: { some: { organizationId: auth.orgId, agentId: auth.agentId, jointSessionId: { not: null } } },
          checkInAt: { gte: windowStart },
        },
        ...(session
          ? [{
              agentId: session.agent.id,
              OR: [
                { checkInAt: { gte: session.startedAt } },
                // The visit the agent was already in when the manager joined.
                { status: "CHECKED_IN" as const, checkInAt: { gte: localDateKeyToUtc(currentDateKey(now, timezone), timezone) } },
              ],
            }]
          : []),
      ],
    },
    orderBy: { checkInAt: "asc" },
    take: 100,
    select: {
      id: true,
      status: true,
      checkInAt: true,
      checkOutAt: true,
      agent: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      contact: { select: { id: true, displayName: true, specialtyName: true } },
      participants: {
        where: { agentId: auth.agentId, jointSessionId: { not: null } },
        select: { jointSessionId: true },
      },
      evaluations: {
        where: { evaluatorAgentId: auth.agentId },
        select: { scores: true, questions: true, comment: true, updatedAt: true },
      },
    },
  })

  // Where he goes with whom, today and ahead (2026-10-30).
  const window = jointPlanWindow(now, timezone)
  const plans = await managerJointPlans(prisma, { organizationId: auth.orgId, managerAgentId: auth.agentId, from: window.today, to: window.last })

  return {
    timezone,
    now: now.toISOString(),
    today: window.today,
    // What the rating sheet asks, in this order: the company's list of today.
    // `criteria` is the same list as bare ids, for the phones that read it.
    questions,
    criteria: questions.map((question) => question.id),
    session: sessionJson(session),
    plans,
    visits: visits.map((visit) => {
      const joint = visit.participants.length > 0
      const deadline = visitEvaluationDeadline(visit.checkInAt, timezone)
      const evaluation = visit.evaluations[0]
      const stored = evaluation ? storedVisitEvaluation(evaluation) : null
      return {
        id: visit.id,
        status: visit.status,
        checkInAt: visit.checkInAt.toISOString(),
        checkOutAt: visit.checkOutAt?.toISOString() ?? null,
        agent: visit.agent,
        customer: visit.customer,
        contact: visit.contact,
        joint,
        canEvaluate: joint && now.getTime() < deadline.getTime(),
        evaluateUntil: deadline.toISOString(),
        evaluation: evaluation && stored
          ? {
              scores: stored.scores,
              // The list this rating was given against, which may differ from today's.
              questions: stored.questions,
              average: stored.average,
              comment: evaluation.comment,
              updatedAt: evaluation.updatedAt.toISOString(),
            }
          : null,
      }
    }),
  }
}

