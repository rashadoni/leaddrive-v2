import { prisma } from "@/lib/prisma"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents, pushBody } from "@/lib/mtm/push-notify"
import { mtmTaskDueHasMeaningfulTime } from "@/lib/mtm/task-due"
import { dateInputValueInTimezone, formatInTimezone, isValidTimezone } from "@/lib/timezone"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"

/**
 * The agent learns at once that someone gave him a task (owner, 2026-10-20:
 * «я создал задачу для агента… должно было придти всплывающее окно как задача
 * в приложение, а его не было»). Until then a task created in the panel was
 * only a row: the agent found it when he happened to open «Задачи».
 *
 * One line in the agent's bell and a push in the high-importance channel the
 * app draws over the screen, like a team message. The text is who gave the
 * task, the task's own words and its deadline; never the client's name, since
 * a push shows on a locked screen.
 *
 * The bell line carries `assignedTaskId`, not `taskId`: the app (≤ 3.11.42)
 * reads every row with a `taskId` as «task returned» and would print that
 * title over this one. Without it the app shows the server's own words.
 */

type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  title: (name: string) => string
  today: string
  tomorrow: string
  due: (when: string) => string
  intlLocale: string
}> = {
  az: {
    title: (name) => `${name} sizə yeni tapşırıq verdi`,
    today: "bu gün",
    tomorrow: "sabah",
    due: (when) => `son müddət: ${when}`,
    intlLocale: "az-AZ",
  },
  ru: {
    title: (name) => `Новая задача от ${name}`,
    today: "сегодня",
    tomorrow: "завтра",
    due: (when) => `срок ${when}`,
    intlLocale: "ru-RU",
  },
  en: {
    title: (name) => `New task from ${name}`,
    today: "today",
    tomorrow: "tomorrow",
    due: (when) => `due ${when}`,
    intlLocale: "en-GB",
  },
}

export function taskNoticeLocale(value: string | null | undefined): Locale {
  return value === "ru" || value === "en" ? value : "az"
}

function nextDayKey(dayKey: string): string {
  const next = new Date(`${dayKey}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** «сегодня до 18:00», «завтра», «23 окт., 18:00» — in the organization's timezone. */
export function taskDueWords(locale: Locale, due: Date, now: Date, timezone: string): string {
  const copy = COPY[locale]
  const zone = isValidTimezone(timezone) ? timezone : "UTC"
  const dueDay = dateInputValueInTimezone(due, zone)
  const today = dateInputValueInTimezone(now, zone)
  const time = mtmTaskDueHasMeaningfulTime(due, zone)
    ? formatInTimezone(due, zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, copy.intlLocale)
    : null
  const day = dueDay === today
    ? copy.today
    : dueDay === nextDayKey(today)
      ? copy.tomorrow
      : formatInTimezone(due, zone, { day: "numeric", month: "short" }, copy.intlLocale)
  if (!time) return day
  return locale === "ru" ? `${day} до ${time}` : `${day} ${time}`
}

export function taskAssignedNotice(input: {
  locale: Locale
  giverName: string
  taskTitle: string
  dueDate: Date | null
  now: Date
  timezone: string
}): { title: string; body: string } {
  const copy = COPY[input.locale]
  const parts = [input.taskTitle.replace(/\s+/g, " ").trim()]
  if (input.dueDate) parts.push(copy.due(taskDueWords(input.locale, input.dueDate, input.now, input.timezone)))
  return { title: copy.title(input.giverName), body: pushBody(parts.join(" · ")) }
}

/**
 * Write the bell line, then push. Called inside the request's tenant scope
 * after the task is saved; the push is fire-and-forget, and neither ever
 * undoes the task. Nothing is sent when the agent gave the task to himself.
 */
export async function notifyAgentOfAssignedTask(input: {
  organizationId: string
  taskId: string
  agentId: string
  taskTitle: string
  dueDate: Date | null
  timezone: string
  giverAgentId: string | null
  giverName: string | null
  now?: Date
}): Promise<void> {
  if (input.giverAgentId && input.giverAgentId === input.agentId) return
  const [agent, giver] = await Promise.all([
    prisma.mtmAgent.findFirst({
      where: { id: input.agentId, organizationId: input.organizationId },
      select: AGENT_LANGUAGE_SELECT,
    }),
    input.giverAgentId
      ? prisma.mtmAgent.findFirst({ where: { id: input.giverAgentId, organizationId: input.organizationId }, select: { name: true } })
      : Promise.resolve(null),
  ])
  if (!agent) return
  const giverName = giver?.name?.trim() || input.giverName?.trim()
  const locale = taskNoticeLocale(agentLanguage(agent))
  const notice = taskAssignedNotice({
    locale,
    giverName: giverName || { az: "Rəhbər", ru: "руководителя", en: "your manager" }[locale],
    taskTitle: input.taskTitle,
    dueDate: input.dueDate,
    now: input.now ?? new Date(),
    timezone: input.timezone,
  })
  await prisma.mtmNotification.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      type: "task",
      title: notice.title,
      body: notice.body,
      metadata: { domain: "task", event: "task_assigned", assignedTaskId: input.taskId, giverAgentId: input.giverAgentId },
    },
  })
  void notifyAgents({
    client: prisma,
    organizationId: input.organizationId,
    agentIds: [input.agentId],
    title: notice.title,
    body: notice.body,
    // `channel` lets the open app draw it over the screen too; `target` is where a tap belongs.
    data: { target: "Tasks", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, assignedTaskId: input.taskId },
    channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
  }).catch((error) => console.warn("[mtm/tasks] push failed", error))
}
