import { prisma } from "@/lib/prisma"

/**
 * Finishes AI-call sessions that were abandoned mid-dispatch, and releases the
 * locks they were holding.
 *
 * A dispatch takes a lease. If whatever held it disappears — the process
 * restarts, the provider never answers, the request is cut off — the row keeps
 * `status = 'dispatching'` and `endedAt = null` forever, because nothing was
 * ever written to finish it. On 2026-08-13 that single row did three things,
 * each of which looked like a separate outage:
 *
 *  - it blocked EVERY deploy, because the pre-deploy check refuses to swap
 *    versions while a call may still be in progress;
 *  - after being finished by hand it still held `activeOrganizationKey`, so
 *    every lead in the organisation answered "a call is already queued";
 *  - and nothing on any screen explained either.
 *
 * The outcome recorded is `dispatch_uncertain`, not `failed`. We do not know
 * whether the call happened — the provider never told us — and a guess written
 * into a call record is worse than an honest "unknown".
 *
 * Two rules keep this from touching a live call:
 *  - only rows whose lease has EXPIRED are finished;
 *  - only the dispatch phase. Once a call is really up its status has moved on,
 *    and a long conversation must not be reaped for outliving its lease.
 */

export type StaleDispatchReaperResult = {
  finished: number
  locksReleased: number
}

export async function reapStaleVoiceDispatches(now = new Date()): Promise<StaleDispatchReaperResult> {
  const finished = await prisma.voiceCallSession.updateMany({
    where: {
      endedAt: null,
      // `dispatch_uncertain` is here for the same reason the other two are, and
      // it was the harder one to see. The AI-call route writes that status
      // itself when the provider's answer proves nothing, keeping the fences
      // and the lease on purpose so an operator can reconcile — but it writes
      // no `endedAt` and no block reason, and every path that could reconcile
      // needs both. This sweep skipped it (wrong status), the lock release
      // below skipped it (no `endedAt`), the operator's resolve endpoint could
      // not match it, and the station's own unknown-outcome callback is scoped
      // to human calls and answers 409 for an AI one. Nothing released
      // `activeOrganizationKey`, so every lead in the tenant answered "a call
      // is already queued" — with no way out at all. Production sat in exactly
      // that state on 2026-08-26.
      //
      // The window for reconciliation is the lease, not forever. Once it has
      // expired this row is finished like any other abandoned dispatch, and the
      // outcome stays honestly unknown.
      status: { in: ["prepared", "dispatching", "dispatch_uncertain"] },
      leaseUntil: { not: null, lt: now },
    },
    data: {
      status: "dispatch_uncertain",
      endedAt: now,
      blockReason: "dispatch lease expired without an outcome",
    },
  })

  // Separate from the write above on purpose: rows finished by an earlier
  // version — or by an operator in a hurry — kept their keys, and a finished
  // session holding the organisation key locks out every lead there is.
  const locksReleased = await prisma.voiceCallSession.updateMany({
    where: {
      endedAt: { not: null },
      OR: [
        { activeOrganizationKey: { not: null } },
        { activeLeadKey: { not: null } },
        { activePhoneKey: { not: null } },
      ],
    },
    data: { activeOrganizationKey: null, activeLeadKey: null, activePhoneKey: null },
  })

  return { finished: finished.count, locksReleased: locksReleased.count }
}
