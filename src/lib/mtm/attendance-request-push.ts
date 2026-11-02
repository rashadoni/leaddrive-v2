import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFirstReviewers } from "@/lib/mtm/attendance-request-notify"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { pushConfigured } from "@/lib/mtm/push-send"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

const messages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
type Locale = keyof typeof messages
const localeOf = (language: string | null | undefined): Locale => language === "ru" || language === "en" ? language : "az"

/**
 * A new attendance request pops up on the manager's phone.
 *
 * Owner, 2026-10-18: «пусть о новой заявке сотрудника руководителю приходит
 * пуш на телефон, как сообщение «Komandaya yaz»». Until then the request only
 * rang the CRM bell (attendance-request-notify.ts) and waited in «Təsdiqlər»
 * until the manager happened to open it — the employee who closed a forgotten
 * day could not start today until then.
 *
 * Who gets it: the same people the bell goes to (`attendanceRequestFirstReviewers`),
 * on their MTM manager cards — a login without a card has no phone to reach.
 * The push names the employee, the kind and the day: nothing about a customer,
 * and no reason text, since a push can show on a locked screen.
 *
 * It goes into the app's "team-messages" channel, the high-importance one a
 * manager's message already uses, so it pops up over the screen on every app
 * from 3.11.12 without a new build. `data.channel` names it for the app's own
 * handler too, which draws the push while the app is open.
 *
 * Runs after the request has committed, fire-and-forget: a push that did not
 * go out never fails the request.
 */
export async function pushAttendanceRequestToReviewers(
  input: { organizationId: string; agentId: string; request: AttendanceRequestDto },
  deps: { notify?: typeof notifyAgents; configured?: boolean } = {},
): Promise<{ cards: number }> {
  const { organizationId, agentId, request } = input
  // Push off on this server: nobody to reach, so nothing is read either.
  if (!(deps.configured ?? pushConfigured())) return { cards: 0 }
  const reviewers = await attendanceRequestFirstReviewers(prisma as unknown as Prisma.TransactionClient, { organizationId, agentId })
  if (reviewers.length === 0) return { cards: 0 }
  const [cards, employee] = await Promise.all([
    prisma.mtmAgent.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] },
        id: { not: agentId },
        userId: { in: reviewers.map((reviewer) => reviewer.id) },
      },
      select: { id: true, userId: true },
    }) as Promise<Array<{ id: string; userId: string | null }>>,
    prisma.mtmAgent.findFirst({ where: { organizationId, id: agentId }, select: { name: true } }) as Promise<{ name: string } | null>,
  ])
  if (cards.length === 0) return { cards: 0 }

  const language = new Map(reviewers.map((reviewer) => [reviewer.id, localeOf(reviewer.preferredLanguage)]))
  const byLocale = new Map<Locale, string[]>()
  for (const card of cards) {
    const locale = language.get(card.userId ?? "") ?? "az"
    byLocale.set(locale, [...(byLocale.get(locale) ?? []), card.id])
  }
  const notify = deps.notify ?? notifyAgents
  for (const [locale, agentIds] of byLocale) {
    const t = messages[locale]
    await notify({
      client: prisma,
      organizationId,
      agentIds,
      title: t.requestNotificationTitle,
      body: attendanceRequestPushBody(request, employee?.name ?? "", locale),
      data: { target: "Approvals", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, requestId: request.id },
      channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
    })
  }
  return { cards: cards.length }
}

/** «Seymur Məmmədov — Vaxt düzəlişi, 13.10» — who, what, which day. */
export function attendanceRequestPushBody(request: AttendanceRequestDto, employeeName: string, locale: Locale): string {
  const kind = request.details.kind === "TIME_CORRECTION"
    ? messages[locale].requestsTimeCorrection
    : attendanceDayKindLabel(request.details.dayKind, locale)
  const day = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`
  const days = request.startDate === request.endDate || request.details.kind === "TIME_CORRECTION"
    ? day(request.startDate)
    : `${day(request.startDate)}–${day(request.endDate)}`
  return [employeeName.trim(), `${kind}, ${days}`].filter(Boolean).join(" — ")
}
