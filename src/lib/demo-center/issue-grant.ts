import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getDemoModules } from "./catalog"
import { sendDemoAccessEmail } from "./email"
import { getDemoJourneyScenario } from "./journey"
import { issueCapabilityToken } from "./security"

/**
 * Issuing a demo link — one path, used by the admin screen and by the public
 * form (owner, 2026-09-23: the invitation must be in the prospect's inbox by
 * the time the form's «check your email» is read).
 *
 * The delicate part is the order, and it is the reason this is shared rather
 * than copied: the request row is claimed first, older grants for it are
 * revoked in the same transaction, the link is e-mailed only after the grant
 * exists, and the grant is marked SENT only if nothing revoked it while the
 * provider was sending. A failed delivery leaves DELIVERY_FAILED and no
 * usable link.
 */

const REVOCABLE_STATUSES = ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE", "DELIVERY_FAILED"]

class DemoGrantTransitionConflict extends Error {}

export interface DemoGrantOptions {
  readonly scenarioId?: string
  readonly moduleIds: readonly string[]
  readonly linkValidDays: number
  readonly sessionDurationMinutes: number
  readonly inactivityMinutes: number
  readonly locale: string
  readonly liveCallEnabled: boolean
}

export type IssueDemoGrantResult =
  | { ok: true; grantId: string }
  | {
      ok: false
      status: number
      error: string
      code: "rejected_meanwhile" | "delivery_failed" | "revoked_meanwhile"
    }

export async function issueDemoGrant(params: {
  request: { id: string; name: string; company: string; email: string }
  options: DemoGrantOptions
  /** Who the grant is issued on behalf of — an admin, or the sales manager the public form issues as. */
  actorUserId: string
  now?: Date
}): Promise<IssueDemoGrantResult> {
  const now = params.now ?? new Date()
  const requestId = params.request.id
  const options = params.options
  const linkExpiresAt = new Date(now.getTime() + options.linkValidDays * 86_400_000)
  const issued = issueCapabilityToken()
  const moduleIds = [...options.moduleIds]
  const moduleManifests = getDemoModules(moduleIds)
  // Callers validated the id already; an unknown one becomes «no scenario».
  const scenario = options.scenarioId ? getDemoJourneyScenario(options.scenarioId) : null

  const grant = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    // Lock the request row first in every issue/finalize path. This serializes
    // concurrent clicks with rejection and prevents a stale issue from
    // resurrecting a request that an administrator has already rejected.
    const claimedRequest = await tx.demoRequest.updateMany({
      where: { id: requestId, status: { not: "REJECTED" } },
      data: { status: "UNDER_REVIEW", reviewedBy: params.actorUserId, reviewedAt: now, rejectionReason: null },
    })
    if (!claimedRequest.count) return null

    const revoked = await tx.demoGrant.findMany({
      where: { requestId, status: { in: REVOCABLE_STATUSES } },
      select: { id: true },
    })
    if (revoked.length) {
      await tx.demoGrant.updateMany({
        where: { id: { in: revoked.map((item) => item.id) }, status: { in: REVOCABLE_STATUSES } },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: params.actorUserId,
          revocationReason: "Superseded by a newly issued demo",
          verificationHash: null,
          verificationExpiresAt: null,
          sessionHash: null,
        },
      })
      await tx.demoAccessEvent.createMany({
        data: revoked.map((item) => ({
          grantId: item.id,
          eventType: "REVOKED",
          metadata: { reason: "superseded" },
        })),
      })
    }

    return tx.demoGrant.create({
      data: {
        requestId,
        tokenHash: issued.tokenHash,
        tokenHint: issued.tokenHint,
        moduleIds,
        scenarioId: scenario?.scenarioId ?? null,
        // Pinned, not resolved at open time: a prospect finishes the manifest
        // they were granted even if a newer version ships mid-session.
        scenarioVersion: scenario?.version ?? null,
        // The admin allowed one real AI call to the prospect's proven phone,
        // and is the one on whose behalf it is placed.
        liveCallEnabled: Boolean(scenario) && options.liveCallEnabled,
        locale: options.locale,
        watermark: `${params.request.company} • ${params.request.email}`,
        linkExpiresAt,
        sessionDurationMinutes: options.sessionDurationMinutes,
        inactivityMinutes: options.inactivityMinutes,
        createdBy: params.actorUserId,
        events: {
          create: {
            eventType: "ISSUED",
            metadata: {
              scenarioId: scenario?.scenarioId ?? null,
              scenarioVersion: scenario?.version ?? null,
              moduleCount: moduleIds.length,
              liveCallEnabled: Boolean(scenario) && options.liveCallEnabled,
              linkValidDays: options.linkValidDays,
              sessionDurationMinutes: options.sessionDurationMinutes,
              inactivityMinutes: options.inactivityMinutes,
            },
          },
        },
      },
    })
  }))

  if (!grant) {
    return { ok: false, status: 409, code: "rejected_meanwhile", error: "The request was rejected while access was being issued" }
  }

  const delivery = await sendDemoAccessEmail({
    to: params.request.email,
    name: params.request.name,
    company: params.request.company,
    token: issued.token,
    moduleNames: scenario ? [scenario.title] : moduleManifests.map((module) => module.title),
    linkExpiresAt,
  })

  if (!delivery.success) {
    const recordedFailure = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
      const updated = await tx.demoGrant.updateMany({
        where: { id: grant.id, status: "ISSUING" },
        data: { status: "DELIVERY_FAILED", deliveryError: delivery.error || "Email delivery failed" },
      })
      if (!updated.count) return false
      await tx.demoAccessEvent.create({
        data: { grantId: grant.id, eventType: "DELIVERY_FAILED", metadata: { providerError: delivery.error || "unknown" } },
      })
      return true
    }))
    if (!recordedFailure) {
      return { ok: false, status: 409, code: "revoked_meanwhile", error: "Access was revoked while the email was being prepared" }
    }
    return {
      ok: false,
      status: 502,
      code: "delivery_failed",
      error: "The access email could not be delivered. No usable link was stored; retry to issue a fresh link.",
    }
  }

  const finalized = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    // Request-first locking matches reject/reissue ordering. Throwing on the
    // second compare-and-set rolls this update back instead of reviving a
    // grant that was revoked while the provider was sending the email.
    const requestUpdated = await tx.demoRequest.updateMany({
      where: { id: requestId, status: "UNDER_REVIEW" },
      data: { status: "FULFILLED" },
    })
    if (!requestUpdated.count) throw new DemoGrantTransitionConflict()

    const grantUpdated = await tx.demoGrant.updateMany({
      where: { id: grant.id, status: "ISSUING" },
      data: { status: "SENT", sentAt: new Date(), deliveryMessageId: delivery.messageId || null, deliveryError: null },
    })
    if (!grantUpdated.count) throw new DemoGrantTransitionConflict()

    await tx.demoAccessEvent.create({ data: { grantId: grant.id, eventType: "SENT" } })
    return true
  })).catch((error) => {
    if (error instanceof DemoGrantTransitionConflict) return false
    throw error
  })

  if (!finalized) {
    return {
      ok: false,
      status: 409,
      code: "revoked_meanwhile",
      error: "The email may have been delivered, but access was concurrently revoked. Issue a fresh link if needed.",
    }
  }

  return { ok: true, grantId: grant.id }
}
