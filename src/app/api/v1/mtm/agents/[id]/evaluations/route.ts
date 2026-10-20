import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  MTM_VISIT_EVALUATION_CRITERIA,
  readVisitEvaluationScores,
  visitEvaluationAverage,
} from "@/lib/mtm/joint-visit"

const DAYS = 30
const RECENT = 10

type EvaluationRow = {
  scores: unknown
  comment: string | null
  updatedAt: Date
  evaluator: { id: string; name: string }
  visit: {
    id: string
    checkInAt: Date
    customer: { id: string; name: string }
    contact: { id: string; displayName: string | null } | null
  }
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * GET /api/v1/mtm/agents/:id/evaluations — «Оценки руководителя» on the
 * agent's page (owner-approved mockup, 2026-10-20): the managers' ratings of
 * this agent's joint visits over the last 30 days, per criterion, and the
 * latest ones with their visits.
 *
 * For the office only. An agent never reads ratings — not his own either
 * («агент оценку не видит»): a field login is refused before anything is read.
 */
export const GET = withRouteFieldRlsAuth("read", async (
  _req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  if (actor.role === "AGENT") {
    return NextResponse.json({ error: "Ratings are for managers", code: "MTM_VISIT_EVALUATIONS_FORBIDDEN" }, { status: 403 })
  }
  if (!isAgentInRouteScope(actor, id)) {
    return NextResponse.json({ error: "Not found", code: "MTM_AGENT_NOT_FOUND" }, { status: 404 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const since = localDateKeyToUtc(addDateKeyDays(currentDateKey(new Date(), timezone), -(DAYS - 1)), timezone)
    const visitWindow = { deletedAt: null, checkInAt: { gte: since } }

    const [rows, jointVisits]: [EvaluationRow[], number] = await Promise.all([
      prisma.mtmVisitEvaluation.findMany({
        where: { organizationId: auth.orgId, agentId: id, visit: visitWindow },
        orderBy: { visit: { checkInAt: "desc" } },
        take: 500,
        select: {
          scores: true,
          comment: true,
          updatedAt: true,
          evaluator: { select: { id: true, name: true } },
          visit: {
            select: {
              id: true,
              checkInAt: true,
              customer: { select: { id: true, name: true } },
              contact: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
      prisma.mtmVisit.count({
        where: {
          organizationId: auth.orgId,
          agentId: id,
          ...visitWindow,
          participants: { some: { organizationId: auth.orgId, jointSessionId: { not: null } } },
        },
      }),
    ])

    const evaluations = rows.map((row: EvaluationRow) => {
      const scores = readVisitEvaluationScores(row.scores)
      return { ...row, scores, average: visitEvaluationAverage(scores) }
    })
    const rated = evaluations.filter((evaluation) => evaluation.average !== null)
    const criteria = MTM_VISIT_EVALUATION_CRITERIA.map((key) => {
      const values = evaluations.map((evaluation) => evaluation.scores[key]).filter((score): score is number => typeof score === "number")
      return {
        key,
        count: values.length,
        average: values.length ? roundOne(values.reduce((sum, score) => sum + score, 0) / values.length) : null,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        days: DAYS,
        timezone,
        jointVisits,
        evaluated: rated.length,
        // Every rated visit weighs the same, however many points it rated.
        average: rated.length ? roundOne(rated.reduce((sum, evaluation) => sum + (evaluation.average ?? 0), 0) / rated.length) : null,
        criteria,
        recent: evaluations.slice(0, RECENT).map((evaluation) => ({
          visitId: evaluation.visit.id,
          checkInAt: evaluation.visit.checkInAt,
          customer: evaluation.visit.customer,
          contact: evaluation.visit.contact,
          evaluator: evaluation.evaluator,
          average: evaluation.average,
          comment: evaluation.comment,
          updatedAt: evaluation.updatedAt,
        })),
      },
    })
  } catch (error) {
    console.error("[MTM/agents/[id]/evaluations GET]", error)
    return NextResponse.json({ error: "Failed to load ratings", code: "MTM_VISIT_EVALUATIONS_FAILED" }, { status: 500 })
  }
})
