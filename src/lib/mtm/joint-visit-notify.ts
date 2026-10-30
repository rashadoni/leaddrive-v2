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
      metadata: { domain: "route", event: "joint_visit_session", jointSessionId: input.sessionId, managerAgentId: input.managerAgentId },
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

// ── Planned joint visits (2026-10-30) ───────────────────────────────────

const PLAN_COPY: Record<Locale, {
  day: (date: string, today: string) => string
  plannedTitle: (name: string, day: string) => string
  plannedBody: (clients: string) => string
  plannedPush: (count: number) => string
  cancelledTitle: (name: string, day: string) => string
  cancelledBody: (clients: string) => string
}> = {
  az: {
    day: (date, today) => (date === today ? "bu gün" : date === addDays(today, 1) ? "sabah" : shortDate(date)),
    plannedTitle: (name, day) => `${name} ${day} sizinlə birgə vizitə gedəcək`,
    plannedBody: (clients) => `${clients}. Marşrutunuzda «Birgə vizit» kimi qeyd olunub; vizitə başlayanda «Bəli, rəhbərlə birgə» seçin.`,
    plannedPush: (count) => `${count} müştəri marşrutunuzda «Birgə vizit» kimi qeyd olunub.`,
    cancelledTitle: (name, day) => `${name} ${day} birgə viziti ləğv etdi`,
    cancelledBody: (clients) => `${clients} — artıq birgə vizit deyil.`,
  },
  ru: {
    day: (date, today) => (date === today ? "сегодня" : date === addDays(today, 1) ? "завтра" : shortDate(date)),
    plannedTitle: (name, day) => `${name} ${day} идёт с вами на визит`,
    plannedBody: (clients) => `${clients}. В маршруте отмечено «Совместный визит»; при начале визита ответьте «Да, вместе с руководителем».`,
    plannedPush: (count) => `Клиентов с отметкой «Совместный визит» в вашем маршруте: ${count}.`,
    cancelledTitle: (name, day) => `${name} отменил(а) совместный визит ${day}`,
    cancelledBody: (clients) => `${clients} — больше не совместный визит.`,
  },
  en: {
    day: (date, today) => (date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : shortDate(date)),
    plannedTitle: (name, day) => `${name} is joining your visits ${day}`,
    plannedBody: (clients) => `${clients}. Marked «Joint visit» on your route; when you start the visit, answer «Yes, with my manager».`,
    plannedPush: (count) => `${count} client(s) on your route are marked «Joint visit».`,
    cancelledTitle: (name, day) => `${name} cancelled the joint visit ${day}`,
    cancelledBody: (clients) => `${clients} — no longer a joint visit.`,
  },
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** «31.10» — the day and month, the way the app writes dates. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}

/** «Dr. Aliyeva (Central Clinic), City Pharmacy». */
export function jointPlanClients(clients: Array<{ customerName: string; contactName: string | null }>): string {
  return clients.map((client) => (client.contactName ? `${client.contactName} (${client.customerName})` : client.customerName)).join(", ")
}

export function jointPlanNotice(
  locale: Locale,
  input: { kind: "planned" | "cancelled"; managerName: string; date: string; today: string; clients: Array<{ customerName: string; contactName: string | null }> },
): { title: string; body: string; push: string } {
  const copy = PLAN_COPY[locale]
  const day = copy.day(input.date, input.today)
  const clients = jointPlanClients(input.clients)
  return input.kind === "planned"
    ? { title: copy.plannedTitle(input.managerName, day), body: copy.plannedBody(clients), push: copy.plannedPush(input.clients.length) }
    : { title: copy.cancelledTitle(input.managerName, day), body: copy.cancelledBody(clients), push: copy.cancelledTitle(input.managerName, day) }
}

/**
 * The agent learns where his manager goes with him (owner, 2026-10-30: «у
 * агента будет уведомление, что менеджер куда собирается сделать визит
 * вместе»). The bell line names the clients — it is read inside the app; the
 * push names only the manager, the day and how many, since a push shows on a
 * locked screen. A tap opens his route of that day.
 */
export async function notifyAgentOfJointVisitPlan(input: {
  organizationId: string
  managerAgentId: string
  agentId: string
  kind: "planned" | "cancelled"
  date: string
  today: string
  planIds: string[]
  clients: Array<{ customerName: string; contactName: string | null }>
}): Promise<void> {
  if (input.clients.length === 0) return
  const [manager, agent] = await Promise.all([
    prisma.mtmAgent.findFirst({ where: { id: input.managerAgentId, organizationId: input.organizationId }, select: { name: true } }),
    prisma.mtmAgent.findFirst({
      where: { id: input.agentId, organizationId: input.organizationId },
      select: { user: { select: { preferredLanguage: true } } },
    }),
  ])
  if (!manager || !agent) return
  const notice = jointPlanNotice(jointVisitLocale(agent.user?.preferredLanguage), { ...input, managerName: manager.name })
  const event = input.kind === "planned" ? "joint_visit_planned" : "joint_visit_cancelled"
  await prisma.mtmNotification.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      type: "info",
      title: notice.title,
      body: notice.body,
      metadata: { domain: "route", event, date: input.date, jointVisitPlanIds: input.planIds, managerAgentId: input.managerAgentId },
    },
  })
  void notifyAgents({
    client: prisma,
    organizationId: input.organizationId,
    agentIds: [input.agentId],
    title: notice.title,
    body: notice.push,
    data: { target: "Route", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, event, date: input.date },
    channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
  }).catch((error) => console.warn("[mtm/joint-visit] plan push failed", error))
}
