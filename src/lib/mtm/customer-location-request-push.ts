import { prisma } from "@/lib/prisma"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { pushConfigured } from "@/lib/mtm/push-send"
import { locationRequestNotificationLocale } from "@/lib/mtm/customer-location-request-notification"
import type { LocationRequestReviewer } from "@/lib/mtm/customer-location-request-notify"

/**
 * A request about a customer's place pops up on the manager's PHONE, as a new
 * attendance request does (attendance-request-push.ts).
 *
 * Owner, 2026-11-04: «проверь, чтоб пуш-уведомление приходило менеджеру».
 * Measured on production that day: of the two people who decide at the only
 * organization with field agents, one had six browser subscriptions and no
 * phone with the app, the other three phones with the app and no browser
 * subscription at all — the browser push of the CRM bell
 * (customer-location-request-notify.ts) could not reach her. The bell's push
 * and this one go together: whichever the manager has, it rings.
 *
 * Who: the same people the bell goes to, on their MTM manager cards — a login
 * without a card has no phone to reach — and never the agent who asked. The
 * push names the agent and nothing about the customer: it can show on a
 * locked screen. It goes into the app's high-importance "team-messages"
 * channel, so it pops up over the screen without a new build. The request is
 * decided in the CRM (Маршруты → Согласования), so the tap opens the app and no
 * screen of its own.
 *
 * Fire-and-forget at the caller: a push that did not go out never fails the request.
 */
const TEXT = {
  ru: {
    submitted: { title: "Адрес клиента: агент ждёт решения", body: (agent: string) => `${agent} предлагает новое место клиента. Решение — в CRM, «Маршруты → Согласования».` },
    confirmed: { title: "Адрес клиента: подтверждено на месте", body: (agent: string) => `${agent} на месте подтвердил новое место клиента. Решение — в CRM, «Маршруты → Согласования».` },
  },
  en: {
    submitted: { title: "Customer address: an agent is waiting for a decision", body: (agent: string) => `${agent} proposes a customer's new place. Decide in the CRM, «Routes → Approvals».` },
    confirmed: { title: "Customer address: confirmed on the spot", body: (agent: string) => `${agent} has confirmed a customer's new place on the spot. Decide in the CRM, «Routes → Approvals».` },
  },
  az: {
    submitted: { title: "Müştəri ünvanı: agent qərar gözləyir", body: (agent: string) => `${agent} müştərinin yeni yerini təklif edir. Qərar CRM-də, «Marşrutlar → Təsdiqlər».` },
    confirmed: { title: "Müştəri ünvanı: yerində təsdiqlənib", body: (agent: string) => `${agent} müştərinin yeni yerini yerində təsdiqlədi. Qərar CRM-də, «Marşrutlar → Təsdiqlər».` },
  },
} as const

export async function pushLocationRequestToReviewers(
  input: {
    organizationId: string
    requestId: string
    requestedByAgentId: string
    agentName: string
    reviewers: readonly LocationRequestReviewer[]
    event: "submitted" | "confirmed"
  },
  deps: { notify?: typeof notifyAgents; configured?: boolean } = {},
): Promise<{ cards: number }> {
  // Push off on this server: nobody to reach, so nothing is read either.
  if (!(deps.configured ?? pushConfigured())) return { cards: 0 }
  if (input.reviewers.length === 0) return { cards: 0 }
  const cards = await prisma.mtmAgent.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] },
      id: { not: input.requestedByAgentId },
      userId: { in: input.reviewers.map((reviewer) => reviewer.userId) },
    },
    select: { id: true, userId: true },
  }) as Array<{ id: string; userId: string | null }>
  if (cards.length === 0) return { cards: 0 }

  const language = new Map(input.reviewers.map((reviewer) => [reviewer.userId, locationRequestNotificationLocale(reviewer.preferredLanguage)]))
  const byLocale = new Map<keyof typeof TEXT, string[]>()
  for (const card of cards) {
    const locale = language.get(card.userId ?? "") ?? "az"
    byLocale.set(locale, [...(byLocale.get(locale) ?? []), card.id])
  }
  const notify = deps.notify ?? notifyAgents
  for (const [locale, agentIds] of byLocale) {
    const text = TEXT[locale][input.event]
    await notify({
      client: prisma,
      organizationId: input.organizationId,
      agentIds,
      title: text.title,
      body: text.body(input.agentName),
      data: { channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, kind: "customer_location_request", requestId: input.requestId },
      channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
    })
  }
  return { cards: cards.length }
}
