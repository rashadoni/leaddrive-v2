import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { locationRequestReviewers } from "@/lib/mtm/customer-location-request-notify"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { pushConfigured } from "@/lib/mtm/push-send"
import {
  MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_ENTITY,
  MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_KIND,
  contactCreateRequestNotificationText,
} from "@/lib/mtm/contact-create-request-notification"

/** The roles the decision route lets decide (`canManageFieldMasterData`): Administrator, Manager, Admin. */
const REVIEWER_CARD_ROLES = ["ADMIN", "MANAGER", "SUPERVISOR"] as const
const MAX_CARDS = 50

/**
 * The MTM cards that may decide a request sent by `requestedByAgentId`, asked
 * of the rule the decision route applies — the role, the requesting agent in
 * the card's scope, not the requester himself. A card without a CRM login is
 * included: its phone is the only place its holder can be reached.
 */
export async function contactCreateRequestReviewerCards(input: {
  organizationId: string
  requestedByAgentId: string
}): Promise<Array<{ id: string; userId: string | null }>> {
  const cards: Array<{ id: string; userId: string | null }> = await prisma.mtmAgent.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      role: { in: [...REVIEWER_CARD_ROLES] },
      id: { not: input.requestedByAgentId },
    },
    orderBy: { id: "asc" },
    take: MAX_CARDS,
    select: { id: true, userId: true },
  })
  const reviewers: Array<{ id: string; userId: string | null }> = []
  for (const card of cards) {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: input.organizationId,
      userId: card.userId ?? "",
      webRole: "",
      agentId: card.id,
    })
    if (actor && canReviewMtmRouteRequest(actor, input.requestedByAgentId)) reviewers.push(card)
  }
  return reviewers
}

/**
 * Tells everyone who may decide a new-doctor request that it is waiting
 * (owner, 2026-10-20: «запросы на нового врача от агента не могу найти, куда
 * пришло»; «чтоб приходило…»): a row in the CRM bell with a browser push, for
 * every login that may decide; and a push to the MTM app of every manager card
 * that may decide, into the «team-messages» channel that pops up over the
 * screen. The app's bell already lists the waiting request under «Təsdiqlər».
 *
 * Call after the request has been saved, inside the tenant scope of the request
 * that saved it. Never throws: a notification that could not go out must not
 * cost the agent his request. One bell row per person per request.
 */
export async function notifyContactCreateRequestReviewers(
  input: { organizationId: string; requestId: string; requestedByAgentId: string; doctorName: string; clinicName: string },
  deps: { notify?: typeof notifyAgents; configured?: boolean } = {},
): Promise<{ web: number; phones: number }> {
  let web = 0
  let phones = 0
  try {
    const [reviewers, agent] = await Promise.all([
      locationRequestReviewers({ organizationId: input.organizationId, requestedByAgentId: input.requestedByAgentId }),
      prisma.mtmAgent.findFirst({
        where: { id: input.requestedByAgentId, organizationId: input.organizationId },
        select: { name: true },
      }) as Promise<{ name: string | null } | null>,
    ])
    const text = { agentName: agent?.name ?? "", doctorName: input.doctorName, clinicName: input.clinicName }

    for (const reviewer of reviewers) {
      const words = contactCreateRequestNotificationText(reviewer.preferredLanguage, text)
      const row = await createNotification({
        organizationId: input.organizationId,
        userId: reviewer.userId,
        type: "info",
        title: words.title,
        message: words.message,
        entityType: MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_ENTITY,
        entityId: input.requestId,
        push: true,
        kind: MTM_CONTACT_CREATE_REQUEST_NOTIFICATION_KIND,
        idempotencyKey: `mtm-contact-create-request-submitted:${input.requestId}`,
      })
      if (row) web += 1
    }

    // The phone: only where pushes are configured — otherwise nothing to reach.
    if (deps.configured ?? pushConfigured()) {
      const cards = await contactCreateRequestReviewerCards(input)
      // A card's language is its login's; a card without a login is told in Azerbaijani, the app's default.
      const language = new Map(reviewers.map((reviewer) => [reviewer.userId, reviewer.preferredLanguage]))
      const byLanguage = new Map<string, string[]>()
      for (const card of cards) {
        const locale = (card.userId ? language.get(card.userId) : null) ?? "az"
        byLanguage.set(locale, [...(byLanguage.get(locale) ?? []), card.id])
      }
      const notify = deps.notify ?? notifyAgents
      for (const [locale, agentIds] of byLanguage) {
        const words = contactCreateRequestNotificationText(locale, text)
        await notify({
          client: prisma,
          organizationId: input.organizationId,
          agentIds,
          title: words.title,
          body: words.message,
          data: { target: "Approvals", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, requestId: input.requestId, kind: "contactCreateRequest" },
          channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
        })
        phones += agentIds.length
      }
    }
  } catch (error) {
    console.warn("[MTM/contact-create-request] reviewers were not notified", error)
  }
  return { web, phones }
}
