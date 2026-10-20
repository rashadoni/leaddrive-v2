import { prisma } from "@/lib/prisma"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"

/**
 * The agent learns that his manager is going on visits with him (owner,
 * 2026-10-20: «если менеджер планирует двойной визит, то должно придти
 * уведомление тому агенту… как всплывающее окно»).
 *
 * One line in the agent's bell and a push in the high-importance channel the
 * app draws over the screen, like a team message — the same way «Написать
 * команде» reaches him. The text is the manager's name and what to do at the
 * next check-in; nothing about any client, since a push shows on a locked
 * screen. It is in the agent's own language: the language of the CRM login
 * his card is linked to, Azerbaijani without one.
 */

type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, { title: (name: string) => string; body: string }> = {
  az: {
    title: (name) => `${name} bu gün sizinlə birgə vizitdədir`,
    body: "Vizitə başlayanda «Bəli, rəhbərlə birgə» seçin — onda rəhbər vizitinizi qiymətləndirə biləcək.",
  },
  ru: {
    title: (name) => `${name} сегодня с вами на визитах`,
    body: "При начале визита ответьте «Да, вместе с руководителем» — тогда руководитель сможет его оценить.",
  },
  en: {
    title: (name) => `${name} is on visits with you today`,
    body: "When you start a visit, answer «Yes, with my manager» — then your manager can rate it.",
  },
}

export function jointVisitLocale(value: string | null | undefined): Locale {
  return value === "ru" || value === "en" ? value : "az"
}

export function jointVisitNotice(locale: Locale, managerName: string): { title: string; body: string } {
  const copy = COPY[locale]
  return { title: copy.title(managerName), body: copy.body }
}

/**
 * Write the bell line, then push. Called inside the request's tenant scope;
 * the push is fire-and-forget, and neither ever undoes the session.
 */
export async function notifyAgentOfJointVisit(input: {
  organizationId: string
  managerAgentId: string
  agentId: string
  sessionId: string
}): Promise<void> {
  const [manager, agent] = await Promise.all([
    prisma.mtmAgent.findFirst({ where: { id: input.managerAgentId, organizationId: input.organizationId }, select: { name: true } }),
    prisma.mtmAgent.findFirst({
      where: { id: input.agentId, organizationId: input.organizationId },
      select: { user: { select: { preferredLanguage: true } } },
    }),
  ])
  if (!manager || !agent) return
  const notice = jointVisitNotice(jointVisitLocale(agent.user?.preferredLanguage), manager.name)
  await prisma.mtmNotification.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      type: "info",
      title: notice.title,
      body: notice.body,
      metadata: { domain: "route", jointSessionId: input.sessionId, managerAgentId: input.managerAgentId },
    },
  })
  void notifyAgents({
    client: prisma,
    organizationId: input.organizationId,
    agentIds: [input.agentId],
    title: notice.title,
    body: notice.body,
    // `channel` lets the open app draw it over the screen too; `target` is where a tap belongs.
    data: { target: "Route", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, jointSessionId: input.sessionId },
    channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
  }).catch((error) => console.warn("[mtm/joint-visit] push failed", error))
}
