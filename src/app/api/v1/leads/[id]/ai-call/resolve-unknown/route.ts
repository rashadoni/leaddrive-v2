import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

import { isManagerOrAbove } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call"
import {
  buildUnresolvedOutboundCallWhere,
  OPERATOR_CLOSED_UNKNOWN_NO_REDIAL,
  PROVIDER_UNKNOWN_NO_REDIAL,
} from "@/lib/voice-agent/unresolved-call"
import { withRlsAuth } from "@/lib/with-rls"

type RouteContext = { params: Promise<{ id: string }> }

const requestSchema = z.object({
  resolution: z.literal("unknown_no_redial"),
  acknowledgeNoRedial: z.literal(true),
}).strict()

class UnknownCallNotFoundError extends Error {}
class UnknownCallConflictError extends Error {}

export const POST = withRlsAuth("voip", "write", async (request, auth, { params }: RouteContext) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const mutationGuard = guardInteractiveJsonMutation(request)
  if (mutationGuard) return mutationGuard
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { id: leadId } = await params
  const now = new Date()

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.voiceCallSession.findFirst({
        where: {
          organizationId: auth.orgId,
          leadId,
          provider: "asterisk",
          queueItem: { is: null },
          status: { in: ["dispatch_uncertain", "cancelled"] },
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          endedAt: { not: null },
          callLog: {
            is: {
              organizationId: auth.orgId,
              leadId,
              callMode: "ai",
              provider: "asterisk",
              providerOutcome: null,
              conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          callLogId: true,
          providerCallId: true,
          status: true,
          outcome: true,
          blockReason: true,
          activeOrganizationKey: true,
          endedAt: true,
          callLog: { select: { conversationOutcome: true, providerOutcome: true } },
        },
      })
      if (!session?.callLog || !session.callLogId) {
        const lead = await tx.lead.findFirst({
          where: { id: leadId, organizationId: auth.orgId },
          select: { phone: true },
        })
        const targetPhoneE164 = normalizeManualLeadPhone(lead?.phone)?.e164 ?? null
        if (!targetPhoneE164) throw new UnknownCallNotFoundError()

        // The fence is exact-phone scoped, so closing only the newest attempt
        // would leave the phone blocked and make the acknowledgement look
        // inert. Every attempt currently holding this phone is closed together.
        const humanCalls = await tx.callLog.findMany({
          where: buildUnresolvedOutboundCallWhere({
            organizationId: auth.orgId,
            targetPhoneE164,
            callModes: ["human"],
          }),
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            provider: true,
            providerCallId: true,
            conversationOutcome: true,
            endedAt: true,
          },
        })
        // A call event is keyed by its provider call id, so an attempt without
        // one cannot be acknowledged. That matches the previous behaviour.
        const closable = humanCalls.filter((call) => Boolean(call.providerCallId))
        if (closable.length === 0) {
          const alreadyClosed = await tx.callLog.findFirst({
            where: {
              organizationId: auth.orgId,
              direction: "outbound",
              targetPhoneE164,
              callMode: "human",
              conversationOutcome: OPERATOR_CLOSED_UNKNOWN_NO_REDIAL,
            },
            select: { id: true },
          })
          if (alreadyClosed) return "existing" as const
          throw new UnknownCallNotFoundError()
        }

        for (const call of closable) {
          const humanChanged = await tx.callLog.updateMany({
            where: {
              id: call.id,
              organizationId: auth.orgId,
              direction: "outbound",
              callMode: "human",
              // The provider is whatever placed the attempt. Pinning this to
              // asterisk left every legacy attempt from another provider
              // permanently unclosable.
              provider: call.provider,
              targetPhoneE164,
              providerCallId: call.providerCallId,
              providerOutcome: null,
              // Mirror the fence that selected this row. Demanding the
              // provider-unknown marker here is what made a legacy attempt --
              // which never terminated and so carries no conversation outcome
              // at all -- impossible to acknowledge.
              OR: [
                { endedAt: null },
                { conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL },
              ],
            },
            data: {
              conversationOutcome: OPERATOR_CLOSED_UNKNOWN_NO_REDIAL,
              // An attempt that never terminated keeps matching the fence
              // through its "never ended" branch, so the acknowledgement has
              // to record an end. A later provider callback still overwrites
              // the provider outcome and stays authoritative.
              ...(call.endedAt === null ? { endedAt: now } : {}),
            },
          })
          if (humanChanged.count !== 1) throw new UnknownCallConflictError()
        }

        await tx.callEvent.createMany({
          data: closable.map((call) => ({
            organizationId: auth.orgId,
            callLogId: call.id,
            provider: call.provider,
            providerCallId: call.providerCallId as string,
            eventType: "voice_provider_unknown_acknowledged",
            eventHash: "human-provider-unknown-acknowledged-v1",
            payload: {
              resolution: OPERATOR_CLOSED_UNKNOWN_NO_REDIAL,
              acknowledgedFromLeadId: leadId,
              resolvedByUserId: auth.userId,
              resolvedAt: now.toISOString(),
            },
          })),
          skipDuplicates: true,
        })
        return "recorded" as const
      }
      if (
        !["dispatch_uncertain", "cancelled"].includes(session.status)
        || session.blockReason !== PROVIDER_UNKNOWN_NO_REDIAL
        || session.endedAt === null
        || session.callLog.providerOutcome !== null
        || session.callLog.conversationOutcome !== PROVIDER_UNKNOWN_NO_REDIAL
      ) throw new UnknownCallConflictError()

      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: session.id,
          organizationId: auth.orgId,
          leadId,
          callLogId: session.callLogId,
          status: { in: ["dispatch_uncertain", "cancelled"] },
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          endedAt: { not: null },
        },
        data: {
          status: "cancelled",
          outcome: "operator_closed_unknown_no_redial",
          blockReason: "operator_closed_unknown_no_redial",
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
          leaseUntil: null,
        },
      })
      if (sessionChanged.count !== 1) throw new UnknownCallConflictError()

      const callChanged = await tx.callLog.updateMany({
        where: {
          id: session.callLogId,
          organizationId: auth.orgId,
          leadId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: session.providerCallId,
          providerOutcome: null,
          conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL,
        },
        data: { conversationOutcome: "operator_closed_unknown_no_redial" },
      })
      if (callChanged.count !== 1) throw new UnknownCallConflictError()

      await tx.callEvent.createMany({
        data: [{
          organizationId: auth.orgId,
          callLogId: session.callLogId,
          provider: "asterisk",
          providerCallId: session.providerCallId,
          eventType: "voice_provider_unknown_acknowledged",
          eventHash: "manual-provider-unknown-acknowledged-v1",
          payload: {
            resolution: "operator_closed_unknown_no_redial",
            resolvedByUserId: auth.userId,
            resolvedAt: now.toISOString(),
          },
        }],
        skipDuplicates: true,
      })
      return "recorded" as const
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ success: true, replayed: result === "existing" })
  } catch (error) {
    if (error instanceof UnknownCallNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (error instanceof UnknownCallConflictError) {
      return NextResponse.json({ error: "unknown_call_conflict" }, { status: 409 })
    }
    throw error
  }
})
