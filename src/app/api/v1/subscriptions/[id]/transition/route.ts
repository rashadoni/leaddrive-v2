/**
 * Subscription transition — D4 Phase 6 Block A slice 2.
 *
 *   POST /api/v1/subscriptions/[id]/transition
 *   Body: { to: SubscriptionStatus }
 *
 * Validates the proposed transition via `advanceSubscriptionState`,
 * writes the timestamp side-effect (cancelledAt / pausedAt / resumedAt
 * + nextBillingAt=null on cancel/pause), and emits a `SubscriptionEvent`
 * audit row inside the same transaction. `trialEnding` side-effect
 * emits TWO events (the `trial_ended` audit + the destination-specific
 * `activated` / `dunning_started`) so the audit log stays unambiguous
 * for slice-3 reporting.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { advanceSubscriptionState } from "@/lib/subscriptions/subscription-state-machine"
import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from "@/lib/subscriptions/types"
import { normalizeSubscriptionRow } from "@/lib/prisma-decimal"

const transitionSchema = z.object({
  to: z.enum(SUBSCRIPTION_STATUSES),
})

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("subscriptions", "write", async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = transitionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const existing = await prisma.subscription.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true, planId: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found in tenant" }, { status: 404 })
  }

  const move = advanceSubscriptionState({
    from: existing.status as SubscriptionStatus,
    to: parsed.data.to,
  })
  if (!move.ok) {
    return NextResponse.json({ error: move.error }, { status: 409 })
  }

  const now = new Date()

  // Build the update payload — only write timestamps + flags the SM
  // tells us to. The DB CHECK constraints
  // (subscriptions_cancelled_coherence_check + paused_coherence + temporal_order)
  // are defense-in-depth against any divergence.
  const update: {
    status: SubscriptionStatus
    cancelledAt?: Date | null
    pausedAt?: Date | null
    resumedAt?: Date | null
    nextBillingAt?: Date | null
  } = {
    status: parsed.data.to,
  }

  if (move.sideEffect === "cancelling") {
    update.cancelledAt = now
    update.nextBillingAt = null
  } else if (move.sideEffect === "pausing") {
    update.pausedAt = now
    update.resumedAt = null
    // Pause halts billing; nextBillingAt is nulled. On resume the caller
    // (slice 3 cron or admin) recomputes via calculateNextPeriod.
    update.nextBillingAt = null
  } else if (move.sideEffect === "resuming") {
    update.resumedAt = now
  }
  // `activating` / `suspending` / `trialEnding` write only status — no
  // timestamp side-effect on the row. The audit events below capture
  // the lifecycle change.

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const u = await tx.subscription.update({
      where: { id: existing.id },
      data: update,
    })

    // Compose the audit event chain. For `trialEnding` we emit TWO
    // events: `trial_ended` first, then the destination-specific event
    // (`activated` for trial→active, `dunning_started` for trial→past_due).
    const events: { eventType: string; metadata?: Record<string, unknown> }[] = []
    if (move.sideEffect === "trialEnding") {
      events.push({ eventType: "trial_ended" })
      events.push({
        eventType: parsed.data.to === "active" ? "activated" : "dunning_started",
      })
    } else if (move.sideEffect === "activating") {
      events.push({ eventType: "activated" })
    } else if (move.sideEffect === "pausing") {
      events.push({ eventType: "paused" })
    } else if (move.sideEffect === "resuming") {
      events.push({ eventType: "resumed" })
    } else if (move.sideEffect === "suspending") {
      events.push({ eventType: "dunning_started" })
    } else if (move.sideEffect === "cancelling") {
      events.push({ eventType: "cancelled" })
    }

    for (const ev of events) {
      await tx.subscriptionEvent.create({
        data: {
          organizationId: auth.orgId,
          subscriptionId: existing.id,
          eventType: ev.eventType,
          previousStatus: existing.status,
          newStatus: parsed.data.to,
          metadata: (ev.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        },
      })
    }

    return u
  })

  return NextResponse.json({ subscription: normalizeSubscriptionRow(updated), kind: move.sideEffect })
})
