import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import {
  agentSaidGoodbye,
  decideCallback,
  type CallbackDecision,
} from "@/lib/voice-agent/callback-decision"
import { placeCallback, type CallbackPlacement } from "@/lib/voice-agent/place-callback"

/**
 * The point where a finished call becomes a callback, or does not.
 *
 * This is the only place in the system that turns a webhook into an outgoing
 * phone call, so it is written to fail in one direction. Anything unexpected —
 * a missing row, a provider error, a bug in here — results in no call being
 * placed and the caller being told nothing went wrong. The opposite failure
 * mode, where an error somewhere causes a customer to be dialled, is the one
 * that cannot be taken back.
 *
 * It also never throws. Its caller is the PBX result webhook, which retries on
 * failure; an exception here would turn one broken call into repeated attempts
 * at re-processing a call result that had already been stored correctly.
 */

export type CallbackTriggerOutcome = {
  decision: CallbackDecision
  placement: CallbackPlacement | null
}

const NOT_CONSIDERED: CallbackTriggerOutcome = {
  decision: { callback: false, reason: "no_break_evidence" },
  placement: null,
}

export async function maybePlaceCallback(params: {
  organizationId: string
  callLogId: string
  turns: ReadonlyArray<{ role: string; text: string }>
  now?: Date
}): Promise<CallbackTriggerOutcome> {
  const { organizationId, callLogId } = params
  const now = params.now ?? new Date()

  try {
    const call = await runWithTenant(organizationId, () => prisma.callLog.findFirst({
      where: { id: callLogId, organizationId },
      select: {
        callMode: true,
        duration: true,
        agentMidUtterance: true,
        recoveryAttempts: true,
        continuesCallId: true,
        endedAt: true,
      },
    }))
    if (!call) return NOT_CONSIDERED

    const decision = decideCallback({
      agentMidUtterance: call.agentMidUtterance,
      recoveryAttempts: call.recoveryAttempts,
      // Read from the transcript, because the PBX cannot know whether the
      // conversation was actually finished — only whether audio was still owed.
      agentSaidGoodbye: agentSaidGoodbye(params.turns),
      continuesCallId: call.continuesCallId,
      callMode: call.callMode,
      durationSeconds: call.duration ?? 0,
      endedAt: call.endedAt ?? now,
      now,
    })

    if (!decision.callback) {
      logDecision(callLogId, decision, null)
      return { decision, placement: null }
    }

    const placement = await placeCallback({
      organizationId,
      originalCallLogId: callLogId,
      now,
    })
    logDecision(callLogId, decision, placement)
    return { decision, placement }
  } catch (error) {
    // Deliberately swallowed. A thrown error here would fail the PBX webhook,
    // which then retries a result that was already persisted correctly.
    console.error("[voice-callback] trigger failed", {
      callLogId,
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return NOT_CONSIDERED
  }
}

function logDecision(
  callLogId: string,
  decision: CallbackDecision,
  placement: CallbackPlacement | null,
) {
  // Every automatic dial, and every refusal to dial, leaves a line. When
  // someone asks "why did it call this customer" or "why didn't it", the answer
  // has to be recoverable without re-deriving it from the data.
  console.info("[voice-callback]", {
    callLogId,
    decision: decision.callback ? `place:${decision.reason}` : `skip:${decision.reason}`,
    placement: placement === null
      ? "none"
      : placement.placed
        ? `placed:${placement.callLogId}`
        : `refused:${placement.reason}`,
  })
}
