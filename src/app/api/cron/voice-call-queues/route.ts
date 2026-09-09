import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  processSequentialVoiceQueueOrganization,
  type VoiceQueueWorkerResult,
} from "@/lib/voice-agent/queue-worker"
import {
  reconcileUncertainVoiceSessionFinality,
  type ProviderFinalityReconciliationResult,
} from "@/lib/voice-agent/provider-finality"
import { reapStaleVoiceDispatches } from "@/lib/voice-agent/stale-dispatch-reaper"

export const dynamic = "force-dynamic"

const MAX_ORGANIZATIONS_PER_TICK = 20

/**
 * Advances at most one durable state transition per organisation. The worker
 * itself rechecks the tenant+server feature gate, so an authenticated cron tick
 * is a no-op while queue execution is disabled.
 */
export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  return runWithRlsBypass(async () => {
    // Before anything else, and regardless of whether the queue is enabled: a
    // dispatch nobody finished blocks deploys and locks out every lead in the
    // organisation. It has to be swept even when the queue itself is off,
    // which is exactly the state this cron spends most of its life in.
    const reaped = await reapStaleVoiceDispatches()
    if (reaped.finished || reaped.locksReleased) {
      console.log("[voice-call-queues] reaped stale dispatches", reaped)
    }
    const finalityPilotOrganizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || ""
    const finalityEnabled = process.env.VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED === "true"
      && process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED === "true"
      && finalityPilotOrganizationId.length > 0
    const [queueRows, activeItemRows, uncertainSessionRows] = await Promise.all([
      prisma.voiceCallQueue.findMany({
        where: { status: { in: ["running", "paused", "attention_required"] } },
        select: { organizationId: true },
        distinct: ["organizationId"],
        take: MAX_ORGANIZATIONS_PER_TICK,
      }),
      prisma.voiceCallQueueItem.findMany({
        where: {
          status: { in: ["claimed", "dispatching", "waiting_terminal", "dispatch_uncertain"] },
          activeOrganizationKey: { not: null },
        },
        select: { organizationId: true },
        distinct: ["organizationId"],
        take: MAX_ORGANIZATIONS_PER_TICK,
      }),
      finalityEnabled
        ? prisma.voiceCallSession.findMany({
            where: {
              organizationId: finalityPilotOrganizationId,
              provider: "asterisk",
              status: "dispatch_uncertain",
              endedAt: null,
              activeOrganizationKey: finalityPilotOrganizationId,
            },
            select: { organizationId: true },
            distinct: ["organizationId"],
            take: MAX_ORGANIZATIONS_PER_TICK,
          })
        : Promise.resolve([]),
    ])
    const organizationIds = Array.from(new Set([
      ...uncertainSessionRows.map((row: { organizationId: string }) => row.organizationId),
      ...activeItemRows.map((row: { organizationId: string }) => row.organizationId),
      ...queueRows.map((row: { organizationId: string }) => row.organizationId),
    ])).slice(0, MAX_ORGANIZATIONS_PER_TICK)

    const totals: Record<VoiceQueueWorkerResult["status"], number> = {
      disabled: 0,
      idle: 0,
      waiting_terminal: 0,
      terminal_reconciled: 0,
      blocked: 0,
      deferred: 0,
      dispatching: 0,
      provider_failed: 0,
      dispatch_uncertain: 0,
    }
    const finalityTotals: Record<ProviderFinalityReconciliationResult["status"], number> = {
      disabled: 0,
      idle: 0,
      active: 0,
      unknown: 0,
      stale: 0,
      not_accepted: 0,
      terminal: 0,
    }
    for (const organizationId of organizationIds) {
      if (finalityEnabled && organizationId === finalityPilotOrganizationId) {
        const finality = await reconcileUncertainVoiceSessionFinality({
          db: prisma,
          organizationId,
        })
        finalityTotals[finality.status] += 1
      }
      const result = await processSequentialVoiceQueueOrganization({
        db: prisma,
        organizationId,
      })
      totals[result.status] += 1
    }

    return NextResponse.json({
      success: true,
      data: { organizationsChecked: organizationIds.length, totals, finalityTotals, reaped },
    })
  })
}
