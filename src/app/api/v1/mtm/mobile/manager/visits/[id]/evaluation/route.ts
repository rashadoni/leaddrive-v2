import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"
import { sanitizeOperationalText } from "@/lib/mtm/operational-announcement"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  MTM_VISIT_EVALUATION_COMMENT_MAX,
  VisitEvaluationInputSchema,
  storedVisitEvaluation,
  visitEvaluationDeadline,
  visitEvaluationScoresAgainst,
} from "@/lib/mtm/joint-visit"
import { organizationJointVisitSettings } from "@/lib/mtm/joint-visit-manager"

function refuse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status })
}

/**
 * PUT /api/v1/mtm/mobile/manager/visits/:id/evaluation — the manager's rating
 * of the agent's work on a joint visit (src/lib/mtm/joint-visit.ts).
 *
 * Only on a visit the agent himself marked as joint with this manager, only
 * while its agent is in his team, and only until the end of the day after the
 * check-in. Saving again replaces his rating; it stays one row per manager.
 *
 * The points are the company's questions of today (MTM setting
 * `visitEvaluationQuestions`): a score for a question it no longer asks
 * refuses the save with the list as it is now, and the saved row keeps a copy
 * of that list — a later edit of the questions changes no rating given.
 */
export const PUT = withMobileRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  const { id } = await params

  const parsed = VisitEvaluationInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return refuse(400, "MTM_VISIT_EVALUATION_INVALID", parsed.error.issues[0]?.message ?? "Invalid rating")
  }

  try {
    const visit = await prisma.mtmVisit.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        deletedAt: null,
        participants: { some: { organizationId: auth.orgId, agentId: auth.agentId, jointSessionId: { not: null } } },
      },
      select: { id: true, agentId: true, checkInAt: true },
    })
    if (!visit) {
      return refuse(404, "MTM_VISIT_EVALUATION_NOT_JOINT", "The agent did not mark this visit as joint with you")
    }
    const scope = isValidMtmAgentRole(auth.role)
      ? await resolveAgentScope(prisma, { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role })
      : { agentIds: [] as string[] }
    if (visit.agentId === auth.agentId || (scope.agentIds && !scope.agentIds.includes(visit.agentId))) {
      return refuse(404, "MTM_VISIT_EVALUATION_NOT_JOINT", "The agent did not mark this visit as joint with you")
    }
    const { timezone, questions } = await organizationJointVisitSettings(auth.orgId)
    if (Date.now() >= visitEvaluationDeadline(visit.checkInAt, timezone).getTime()) {
      return refuse(409, "MTM_VISIT_EVALUATION_CLOSED", "The rating of this visit can no longer be changed")
    }

    const checked = visitEvaluationScoresAgainst(parsed.data.scores, questions)
    if (!checked.ok) {
      return NextResponse.json({
        success: false,
        error: "The company's evaluation questions have changed",
        code: "MTM_VISIT_EVALUATION_QUESTIONS_CHANGED",
        data: { questions },
      }, { status: 409 })
    }
    const scores = checked.scores
    const comment = parsed.data.comment
      ? sanitizeOperationalText(parsed.data.comment, MTM_VISIT_EVALUATION_COMMENT_MAX) || null
      : null
    const saved = await prisma.mtmVisitEvaluation.upsert({
      where: { visitId_evaluatorAgentId: { visitId: visit.id, evaluatorAgentId: auth.agentId } },
      create: {
        organizationId: auth.orgId,
        visitId: visit.id,
        agentId: visit.agentId,
        evaluatorAgentId: auth.agentId,
        scores: scores as Prisma.InputJsonObject,
        questions: questions as unknown as Prisma.InputJsonArray,
        comment,
      },
      update: { scores: scores as Prisma.InputJsonObject, questions: questions as unknown as Prisma.InputJsonArray, comment },
      select: { id: true, scores: true, questions: true, comment: true, createdAt: true, updatedAt: true },
    })

    // The journal says that a rating was given, not what it was: the rated
    // agent may read his own journal lines.
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "VISIT_EVALUATION_SAVE",
      entity: "visit",
      entityId: visit.id,
      metadataKind: "joint_visit",
      newData: { agentId: visit.agentId, channel: "mobile" },
      req,
    }).catch((error) => console.warn("[MTM/mobile/manager/visits/[id]/evaluation PUT] audit failed", error))

    const stored = storedVisitEvaluation(saved)
    return NextResponse.json({
      success: true,
      data: {
        evaluation: {
          scores: stored.scores,
          questions: stored.questions,
          average: stored.average,
          comment: saved.comment,
          updatedAt: saved.updatedAt.toISOString(),
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/manager/visits/[id]/evaluation PUT]", error)
    return refuse(500, "MTM_VISIT_EVALUATION_UNAVAILABLE", "Failed to save the rating")
  }
}, { requiredCapability: "route-field" })
