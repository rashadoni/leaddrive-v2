import { z } from "zod"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"
import { routeNoticeLocale } from "@/lib/mtm/route-notice"
import { readWorkingHours } from "@/lib/mtm/customer-hours"
import {
  MTM_HOURS_REQUEST_CUSTOMER_CHANGED,
  MTM_HOURS_REQUEST_NOT_FOUND,
  placeHoursUnchangedSince,
} from "@/lib/mtm/customer-hours-request"

type RouteContext = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(500).nullable().optional(),
  // «Принять» on a request whose place's hours were changed after the agent
  // asked: the manager was shown that and said yes. Without it such an
  // answer is 409, so a tab that never showed the warning cannot undo an edit.
  confirmHoursChanged: z.boolean().optional(),
})

class ConcurrentDecisionError extends Error {}
class HoursChangedError extends Error {}

/** The agent's words, in his app's language (az unless he chose ru or en). */
const DECISION_WORDS = {
  az: { approvedTitle: "Qəbul saatları dəyişdirildi", declinedTitle: "Qəbul saatları dəyişmədi", approved: "saatlar sizin göndərdiyiniz kimidir.", declined: "saatlar əvvəlki kimi qalır." },
  ru: { approvedTitle: "Часы приёма изменены", declinedTitle: "Часы приёма не изменены", approved: "часы теперь такие, как вы прислали.", declined: "часы остаются прежними." },
  en: { approvedTitle: "Visiting hours changed", declinedTitle: "Visiting hours unchanged", approved: "the hours are now as you sent them.", declined: "the hours stay as they were." },
} as const

/**
 * POST /api/v1/mtm/customer-hours-requests/:id/decision
 *
 * A manager's answer to «Часы не те?». `APPROVED` writes the agent's week as
 * the place's «часы приёма» — in the same transaction as the answer, and only
 * if the hours are still those the agent saw (else 409 unless confirmed).
 * `REJECTED` leaves the place as it is. Either way the agent is told.
 */
export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }
  const body = parsed.data
  const comment = body.comment || null

  const request = await prisma.mtmCustomerHoursRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: {
      customer: { select: { id: true, name: true } },
      requestedByAgent: { select: { appLanguage: true } },
    },
  })
  if (!request) return NextResponse.json({ error: "Not found", code: MTM_HOURS_REQUEST_NOT_FOUND }, { status: 404 })
  if (!canReviewMtmRouteRequest(actor, request.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }
  if (request.status !== "SUBMITTED") {
    if (request.status === body.decision) {
      return NextResponse.json({ success: true, data: { id, status: request.status, reviewedAt: request.reviewedAt }, idempotent: true })
    }
    return NextResponse.json({ error: "Request already decided", code: "APPROVAL_ALREADY_DECIDED", status: request.status }, { status: 409 })
  }
  const proposed = readWorkingHours(request.proposedHours)
  if (body.decision === "APPROVED" && !proposed) {
    return NextResponse.json({ error: "The proposed hours cannot be read", code: "MTM_HOURS_REQUEST_INVALID" }, { status: 422 })
  }

  const now = new Date()
  const words = DECISION_WORDS[routeNoticeLocale(request.requestedByAgent.appLanguage)]
  let replaced: unknown = request.previousHours
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.mtmCustomerHoursRequest.updateMany({
        where: { id, organizationId: auth.orgId, status: "SUBMITTED" },
        data: { status: body.decision, reviewedBy: auth.userId, decisionComment: comment, reviewedAt: now },
      })
      if (claimed.count !== 1) throw new ConcurrentDecisionError("Request changed concurrently")

      if (body.decision === "APPROVED" && proposed) {
        const customer = await tx.mtmCustomer.findFirst({
          where: { id: request.customerId, organizationId: auth.orgId, deletedAt: null },
          select: { workingHours: true, updatedAt: true },
        })
        if (!customer) throw new HoursChangedError("Place gone")
        if (!placeHoursUnchangedSince(request.previousHours, customer.workingHours) && !body.confirmHoursChanged) {
          throw new HoursChangedError("Hours changed")
        }
        replaced = customer.workingHours
        const written = await tx.mtmCustomer.updateMany({
          where: { id: request.customerId, organizationId: auth.orgId, deletedAt: null, updatedAt: customer.updatedAt },
          data: {
            workingHours: proposed as unknown as Prisma.InputJsonValue,
            workingHoursUpdatedAt: now,
            workingHoursUpdatedBy: auth.userId,
          },
        })
        if (written.count !== 1) throw new HoursChangedError("Place changed concurrently")
      }

      await enqueueMtmRouteNotification(tx, {
        organizationId: auth.orgId,
        agentId: request.requestedByAgentId,
        dedupeKey: `customer-hours-request:${id}:decision:${body.decision}`,
        title: body.decision === "APPROVED" ? words.approvedTitle : words.declinedTitle,
        body: body.decision === "APPROVED"
          ? `${request.customer.name}: ${words.approved}`
          : comment ? `${request.customer.name}: ${comment}` : `${request.customer.name}: ${words.declined}`,
        type: body.decision === "APPROVED" ? "info" : "task",
        metadata: { kind: "customer_hours_request_decision", requestId: id, customerId: request.customerId, decision: body.decision },
      })
    })
  } catch (error) {
    if (error instanceof HoursChangedError) {
      return NextResponse.json({ error: "The place's hours were changed after the agent asked", code: MTM_HOURS_REQUEST_CUSTOMER_CHANGED }, { status: 409 })
    }
    if (error instanceof ConcurrentDecisionError) {
      const current = await prisma.mtmCustomerHoursRequest.findFirst({
        where: { id, organizationId: auth.orgId },
        select: { status: true, reviewedAt: true },
      })
      if (current?.status === body.decision) {
        return NextResponse.json({ success: true, data: { id, status: current.status, reviewedAt: current.reviewedAt }, idempotent: true })
      }
      return NextResponse.json({ error: "Request changed concurrently", code: "APPROVAL_CONFLICT" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: request.requestedByAgentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer_hours_request",
    entityId: id,
    metadataKind: "customer_hours_decision",
    oldData: { status: "SUBMITTED", workingHours: replaced },
    newData: { status: body.decision, customerId: request.customerId, workingHours: body.decision === "APPROVED" ? proposed : replaced, comment },
    req,
  }).catch((error) => console.warn("[MTM/customer-hours-requests/decision] audit failed", error))

  return NextResponse.json({ success: true, data: { id, status: body.decision, reviewedAt: now } })
})
