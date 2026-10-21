import { prisma } from "@/lib/prisma"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import {
  MTM_VISIT_EVALUATION_CRITERIA,
  jointSessionIsOpen,
  readVisitEvaluationScores,
  visitEvaluationAverage,
  visitEvaluationDeadline,
} from "@/lib/mtm/joint-visit"

/**
 * What the manager's phone shows of a joint visit — the «Совместный визит»
 * screen and the card on «Команда» (src/lib/mtm/joint-visit.ts). Read by the
 * manager's joint-visit routes after every change, so the phone redraws from
 * one answer.
 */

export async function organizationTimezone(organizationId: string): Promise<string> {
  const settings = await getMtmSettings(organizationId)
  return isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
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
  evaluations: Array<{ scores: unknown; comment: string | null; updatedAt: Date }>
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
  const timezone = await organizationTimezone(auth.orgId)
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
        select: { scores: true, comment: true, updatedAt: true },
      },
    },
  })

  return {
    timezone,
    now: now.toISOString(),
    criteria: MTM_VISIT_EVALUATION_CRITERIA,
    session: sessionJson(session),
    visits: visits.map((visit) => {
      const joint = visit.participants.length > 0
      const deadline = visitEvaluationDeadline(visit.checkInAt, timezone)
      const evaluation = visit.evaluations[0]
      const scores = evaluation ? readVisitEvaluationScores(evaluation.scores) : null
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
        evaluation: evaluation && scores
          ? {
              scores,
              average: visitEvaluationAverage(scores),
              comment: evaluation.comment,
              updatedAt: evaluation.updatedAt.toISOString(),
            }
          : null,
      }
    }),
  }
}

