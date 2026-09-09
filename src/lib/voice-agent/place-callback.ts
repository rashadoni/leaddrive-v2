import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getVoipProvider } from "@/lib/voip"
import {
  assertOutboundVoiceDispatchAllowed,
  OutboundVoiceDispatchPausedError,
} from "@/lib/voip/outbound-dispatch-lock"
import { evaluateManualLeadAiCallPolicy } from "@/lib/voice-agent/manual-lead-call"
import {
  lockVoiceContactPermission,
  lockVoiceLeadRow,
} from "@/lib/voice-agent/voice-permission-lock"
import { callbackGate } from "@/lib/voice-agent/callback-enabled"

/**
 * Place the one automatic callback a broken call has earned.
 *
 * This is a sibling of the manual lead call, not a caller of it. The two flows
 * differ in what they are: a manual call is a person acting on a lead they are
 * looking at, with a request to attribute it to and a page to answer. A
 * callback has no person in the moment, no request, and a parent call. Routing
 * one through the other's transaction would mean teaching that transaction to
 * pretend a user asked, which is exactly the fiction that later gets believed.
 *
 * What it does share are the primitives that make dialling safe — the dispatch
 * pause, the lead and contact-permission locks, and the policy evaluation that
 * owns consent and the daily quota. Those are reused unchanged.
 *
 * The one-retry guarantee is not enforced here. It is the unique index on
 * `continuesCallId`: two racing placements both reach the insert and the
 * database rejects the loser. Application-level checking is what this
 * deliberately does NOT rely on, because it cannot win that race.
 */

export type CallbackPlacementRefusal =
  | "kill_switch"
  | "not_enabled"
  | "already_placed"
  | "original_not_found"
  | "no_attributable_user"
  | "policy_blocked"
  | "provider_unavailable"
  | "number_changed"
  | "dispatch_paused"
  | "dispatch_rejected"
  | "placement_failed"

export type CallbackPlacement =
  | { placed: true; callLogId: string; providerCallId: string }
  | { placed: false; reason: CallbackPlacementRefusal }

const DISPATCH_LEASE_MS = 10 * 60 * 1_000

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

export async function placeCallback(params: {
  organizationId: string
  originalCallLogId: string
  now?: Date
}): Promise<CallbackPlacement> {
  const { organizationId, originalCallLogId } = params
  const now = params.now ?? new Date()

  return runWithTenant(organizationId, async () => {
    const original = await prisma.callLog.findFirst({
      where: { id: originalCallLogId, organizationId },
      select: {
        id: true,
        leadId: true,
        userId: true,
        channelConfigId: true,
        targetPhoneE164: true,
        continuedBy: { select: { id: true } },
      },
    })
    if (!original?.leadId) return { placed: false, reason: "original_not_found" as const }
    // A cheap early exit, not the guarantee. The guarantee is the unique index
    // below; this only avoids doing the work when the answer is already known.
    if (original.continuedBy) return { placed: false, reason: "already_placed" as const }

    const settings = await prisma.channelConfig.findFirst({
      where: { organizationId, channelType: "voip", isActive: true, id: original.channelConfigId ?? undefined },
      select: { settings: true },
    })
    const gate = callbackGate({ settings: settings?.settings })
    if (!gate.allowed) return { placed: false, reason: gate.reason }

    // Attribution: the callback belongs to whoever owned the conversation it
    // continues — the user who placed the original call, or, for an inbound
    // call that had no such user, whoever the lead is assigned to. Without
    // either there is nobody whose permissions and quota this call would be
    // spending, and inventing one would put a real call outside every limit.
    const lead = await prisma.lead.findFirst({
      where: { id: original.leadId, organizationId },
      select: { assignedTo: true },
    })
    const attributedUserId = original.userId ?? lead?.assignedTo ?? null
    if (!attributedUserId) return { placed: false, reason: "no_attributable_user" as const }

    const user = await prisma.user.findFirst({
      where: { id: attributedUserId, organizationId },
      select: { role: true },
    })
    if (!user) return { placed: false, reason: "no_attributable_user" as const }
    const auth = { orgId: organizationId, userId: attributedUserId, role: user.role }

    let prepared: {
      sessionId: string
      callLogId: string
      providerCallId: string
      targetDialNumber: string
      fromNumber: string
      providerSettings: unknown
    }
    try {
      prepared = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await assertOutboundVoiceDispatchAllowed({ tx, organizationId })
        await lockVoiceLeadRow(tx, organizationId, original.leadId as string)
        const evaluation = await evaluateManualLeadAiCallPolicy({
          db: tx,
          auth,
          leadId: original.leadId as string,
          now,
        })
        if (
          !evaluation.lead
          || !evaluation.targetPhoneE164
          || !evaluation.targetDialNumber
          || !evaluation.provider
        ) {
          throw new CallbackBlocked("provider_unavailable")
        }
        // The daily quota applies: the owner decided a callback spends it like
        // any other call, so a broken conversation cannot borrow against a
        // limit that has already been reached.
        if (!evaluation.preflight.eligible) throw new CallbackBlocked("policy_blocked")
        // Dial the number that broke, or nothing. The evaluator re-derives the
        // target from the lead's current phone, which is right for consent and
        // quota but wrong as an address: if anyone edits the lead between the
        // break and the callback, continuing "the conversation" would place a
        // cold automated call to a different person entirely.
        if (evaluation.targetPhoneE164 !== original.targetPhoneE164) {
          throw new CallbackBlocked("number_changed")
        }
        await lockVoiceContactPermission(tx, organizationId, evaluation.targetPhoneE164)

        const leaseUntil = new Date(now.getTime() + DISPATCH_LEASE_MS)
        const providerCallId = randomUUID()
        const callLog = await tx.callLog.create({
          data: {
            organizationId,
            direction: "outbound",
            fromNumber: evaluation.provider.fromNumber,
            toNumber: evaluation.targetPhoneE164,
            targetPhoneE164: evaluation.targetPhoneE164,
            status: "dispatching",
            provider: "asterisk",
            providerCallId,
            callSid: providerCallId,
            callMode: "ai",
            wasAnswered: false,
            channelConfigId: evaluation.provider.channelConfigId,
            leadId: evaluation.lead.id,
            userId: attributedUserId,
            // The insert that enforces one retry. A concurrent placement loses
            // here with P2002 rather than dialling the customer a second time.
            continuesCallId: original.id,
            consentAudit: {
              scope: "sales",
              consentConfirmed: true,
              basis: evaluation.consentBasis,
              // No human attested at this moment. The record says so rather
              // than naming someone who was not there: consent is inherited
              // from the call this one continues.
              attestedByUserId: null,
              attestedAt: now.toISOString(),
              automaticCallback: true,
              inheritedFromCallLogId: original.id,
            } satisfies Prisma.InputJsonObject,
            startedAt: now,
          },
          select: { id: true },
        })
        const session = await tx.voiceCallSession.create({
          data: {
            organizationId,
            activeOrganizationKey: organizationId,
            leadId: evaluation.lead.id,
            requestedByUserId: attributedUserId,
            assignedToSnapshot: evaluation.lead.assignedTo,
            activeLeadKey: evaluation.lead.id,
            activePhoneKey: evaluation.targetPhoneE164,
            targetPhoneE164: evaluation.targetPhoneE164,
            channelConfigId: evaluation.provider.channelConfigId,
            provider: "asterisk",
            providerCallId,
            callLogId: callLog.id,
            status: "dispatching",
            policySnapshot: evaluation.policySnapshot as Prisma.InputJsonValue,
            startedAt: now,
            leaseUntil,
          },
          select: { id: true },
        })
        return {
          sessionId: session.id,
          callLogId: callLog.id,
          providerCallId,
          targetDialNumber: evaluation.targetDialNumber,
          fromNumber: evaluation.provider.fromNumber,
          providerSettings: evaluation.provider.settings,
        }
      })
    } catch (error) {
      if (isUniqueConflict(error)) {
        // The race this whole design exists to lose safely.
        return { placed: false, reason: "already_placed" as const }
      }
      if (error instanceof CallbackBlocked) {
        return { placed: false, reason: error.reason }
      }
      if (error instanceof OutboundVoiceDispatchPausedError) {
        return { placed: false, reason: "dispatch_paused" as const }
      }
      // Everything else is a fault in this code, not a policy decision.
      // Reporting it as "dispatch_paused" produced a plausible, false
      // explanation that hid a wrong argument name for a whole release - the
      // log said the operator had paused outbound calls when nobody had.
      console.error("[voice-callback] placement threw", {
        originalCallLogId,
        errorType: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      })
      return { placed: false, reason: "placement_failed" as const }
    }

    let accepted = false
    try {
      const result = await getVoipProvider(prepared.providerSettings).initiateCall({
        toNumber: prepared.targetDialNumber,
        fromNumber: prepared.fromNumber,
        voiceAgent: true,
        correlationId: prepared.providerCallId,
      })
      accepted = result.success === true && result.callSid === prepared.providerCallId
    } catch {
      accepted = false
    }

    if (!accepted) {
      // The row stays, carrying continuesCallId, so the spent attempt is not
      // silently returned to the pool. "Once" means one dial, not one
      // conversation: a rejected dispatch has used the retry up.
      await prisma.$transaction([
        prisma.callLog.updateMany({
          where: { id: prepared.callLogId, organizationId, status: "dispatching" },
          data: { status: "failed", providerOutcome: "failed", endedAt: new Date() },
        }),
        prisma.voiceCallSession.updateMany({
          where: { id: prepared.sessionId, organizationId, status: "dispatching" },
          data: { status: "failed", outcome: "failed", endedAt: new Date(), leaseUntil: null, activeOrganizationKey: null },
        }),
      ])
      return { placed: false, reason: "dispatch_rejected" }
    }

    return {
      placed: true,
      callLogId: prepared.callLogId,
      providerCallId: prepared.providerCallId,
    }
  })
}

class CallbackBlocked extends Error {
  readonly reason: CallbackPlacementRefusal
  constructor(reason: CallbackPlacementRefusal) {
    super(reason)
    this.reason = reason
  }
}
