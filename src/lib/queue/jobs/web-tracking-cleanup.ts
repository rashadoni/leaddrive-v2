/**
 * C1 web-tracking retention job — deletes raw WebAction rows older than each
 * org's `retentionDays` and web sessions whose actions are all gone (their
 * lastSeenAt is past the same cutoff). Sessions that C2 has stitched to a
 * contact are KEPT (contactId != null) — they are the contact's history;
 * only their raw actions expire.
 *
 * Pure function: takes a Prisma client, returns counts. No HTTP, no env,
 * no auth — those are the caller's responsibility. Caller must run with
 * RLS bypassed (cross-tenant sweep).
 *
 * Batched per org; deleteMany by the indexed (organizationId, createdAt) /
 * (organizationId, lastSeenAt) pairs. Idempotent — safe to retry.
 */
import type { PrismaClient } from "@prisma/client"

export interface WebTrackingCleanupResult {
  orgsProcessed: number
  deletedActions: number
  deletedSessions: number
}

export async function runWebTrackingCleanup(
  prisma: Pick<PrismaClient, "webTrackingConfig" | "webAction" | "webSession">,
  now: Date = new Date()
): Promise<WebTrackingCleanupResult> {
  const configs = await prisma.webTrackingConfig.findMany({
    select: { organizationId: true, retentionDays: true },
  })

  let deletedActions = 0
  let deletedSessions = 0

  for (const cfg of configs) {
    const cutoff = new Date(now.getTime() - cfg.retentionDays * 24 * 60 * 60 * 1000)
    const actions = await prisma.webAction.deleteMany({
      where: { organizationId: cfg.organizationId, createdAt: { lt: cutoff } },
    })
    const sessions = await prisma.webSession.deleteMany({
      where: {
        organizationId: cfg.organizationId,
        lastSeenAt: { lt: cutoff },
        contactId: null,
      },
    })
    deletedActions += actions.count
    deletedSessions += sessions.count
  }

  return { orgsProcessed: configs.length, deletedActions, deletedSessions }
}
