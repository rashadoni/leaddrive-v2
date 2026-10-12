import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { locales } from "@/i18n/routing"
import {
  MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY,
  MTM_LOCATION_REQUEST_NOTIFICATION_KIND,
  locationRequestNotificationText,
} from "@/lib/mtm/customer-location-request-notification"

/** Reviewer cards: the roles `canReviewMtmRouteRequest` lets decide a request. */
const REVIEWER_CARD_ROLES = ["ADMIN", "MANAGER", "SUPERVISOR"] as const
/** Nobody is told by the hundred: beyond this an organization is not a team that decides. */
const MAX_RECIPIENTS = 50

export interface LocationRequestReviewer {
  userId: string
  /** Their own choice, or — having made none — the language most of their colleagues chose. */
  preferredLanguage: string | null
}

/**
 * The language of an organization, for a person who never chose one.
 *
 * The interface language lives in a browser cookie; `User.preferredLanguage`
 * is set only where somebody set it. On the day this was written the director
 * of the first tenant to use «Клиент здесь» read the CRM in Azerbaijani and
 * had no language on his card, so he would have been written to in the
 * application's default. What the organization's people did choose is the
 * better guess: the most frequent choice, ties in the order of `locales`.
 */
export function organizationLanguage(choices: ReadonlyArray<{ language: string | null; count: number }>): string | null {
  let best: { language: string; count: number } | null = null
  for (const locale of locales) {
    const count = choices.filter((choice) => choice.language === locale).reduce((sum, choice) => sum + choice.count, 0)
    if (count > 0 && (!best || count > best.count)) best = { language: locale, count }
  }
  return best?.language ?? null
}

/**
 * Who may decide a request sent by `requestedByAgentId` — asked of the same
 * rule the decision route applies (`resolveMtmRouteActor` + `canReviewMtmRouteRequest`),
 * so nobody is told about a request they would be refused at.
 *
 * Candidates are the organization's web administrators and everyone who holds
 * an active reviewer card; the rule then drops whoever does not have the
 * requesting agent in scope, and the requester himself.
 */
export async function locationRequestReviewers(input: {
  organizationId: string
  requestedByAgentId: string
}): Promise<LocationRequestReviewer[]> {
  const cards: Array<{ userId: string | null }> = await prisma.mtmAgent.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      role: { in: [...REVIEWER_CARD_ROLES] },
      userId: { not: null },
    },
    select: { userId: true },
  })
  const cardUserIds = [...new Set(cards.flatMap((card) => (card.userId ? [card.userId] : [])))]
  const users: Array<{ id: string; role: string; preferredLanguage: string | null }> = await prisma.user.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      anonymizedAt: null,
      OR: [{ role: { in: ["admin", "superadmin"] } }, ...(cardUserIds.length > 0 ? [{ id: { in: cardUserIds } }] : [])],
    },
    orderBy: { id: "asc" },
    take: MAX_RECIPIENTS,
    select: { id: true, role: true, preferredLanguage: true },
  })

  // Asked only when somebody among them chose no language.
  let fallback: string | null = null
  if (users.some((user) => !user.preferredLanguage)) {
    const chosen: Array<{ preferredLanguage: string | null; _count?: { _all?: number } | null }> = await prisma.user.groupBy({
      by: ["preferredLanguage"],
      where: { organizationId: input.organizationId, isActive: true, anonymizedAt: null, preferredLanguage: { not: null } },
      _count: { _all: true },
    })
    fallback = organizationLanguage(chosen.map((row) => ({ language: row.preferredLanguage, count: row._count?._all ?? 0 })))
  }

  const reviewers: LocationRequestReviewer[] = []
  for (const user of users) {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: input.organizationId,
      userId: user.id,
      webRole: user.role,
    })
    if (actor && canReviewMtmRouteRequest(actor, input.requestedByAgentId)) {
      reviewers.push({ userId: user.id, preferredLanguage: user.preferredLanguage ?? fallback })
    }
  }
  return reviewers
}

/**
 * Tells everyone who may decide the request that it is waiting: a row in the
 * bell (which the open CRM turns into a pop-up within ten seconds), a browser
 * push, and an email for the manager who is not looking at the CRM at all —
 * the agent who sent it may be standing at the customer's door.
 *
 * Call inside the tenant scope of the request that created the row. Never
 * throws: a notification that could not be written must not cost the agent
 * his request. One notification per recipient per request, however many times
 * the phone repeats the sending. Returns how many people were told.
 */
export async function notifyLocationRequestReviewers(input: {
  organizationId: string
  requestId: string
  requestedByAgentId: string
  customerName: string
  movedMeters: number | null
}): Promise<number> {
  try {
    const [reviewers, agent] = await Promise.all([
      locationRequestReviewers(input),
      prisma.mtmAgent.findFirst({
        where: { id: input.requestedByAgentId, organizationId: input.organizationId },
        select: { name: true },
      }) as Promise<{ name: string | null } | null>,
    ])
    const agentName = agent?.name?.trim() || "—"
    const customerName = input.customerName.trim() || "—"
    let told = 0
    for (const reviewer of reviewers) {
      const text = locationRequestNotificationText(reviewer.preferredLanguage, {
        agentName,
        customerName,
        movedMeters: input.movedMeters,
      })
      const row = await createNotification({
        organizationId: input.organizationId,
        userId: reviewer.userId,
        type: "warning",
        title: text.title,
        message: text.message,
        entityType: MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY,
        entityId: input.requestId,
        push: true,
        email: true,
        kind: MTM_LOCATION_REQUEST_NOTIFICATION_KIND,
        idempotencyKey: `mtm-location-request-submitted:${input.requestId}`,
      })
      if (row) told += 1
    }
    return told
  } catch (error) {
    console.warn("[MTM/location-request] reviewers were not notified", error)
    return 0
  }
}
