/**
 * The employee's own notices in the organization's bot: the same ones the bell
 * pushes to the browser, through the same gate — section access and the
 * person's «Bildirişlər» preferences — so Telegram has no switches of its own
 * (owner: one setting, not two levels). Called from deliverNotificationPush
 * after that gate said yes.
 *
 * Task and lead notices are written in Azerbaijani from the record itself (the
 * bell's titles are a mix of English and Russian); anything else is sent as
 * the bell wrote it. A task the employee gave themselves is not announced.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { APP_URL } from "@/lib/domains"
import { sendMessage } from "./bot-api"
import { decryptBotToken } from "./bot-config"

export interface StaffNotice {
  organizationId: string
  userId: string
  title: string
  message: string
  entityType?: string
  entityId?: string
  kind?: string
  /** The CRM path the bell links to. */
  path: string
}

function bakuTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const baku = new Date(date.getTime() + 4 * 3600_000)
  return `${pad(baku.getUTCDate())}.${pad(baku.getUTCMonth() + 1)}.${baku.getUTCFullYear()} ${pad(baku.getUTCHours())}:${pad(baku.getUTCMinutes())}`
}

/** The text of the notice, or null when there is nothing to tell. */
export async function staffNoticeText(notice: StaffNotice): Promise<string | null> {
  const { organizationId: orgId, userId, entityType, entityId } = notice
  if (entityType === "task" && entityId) {
    const task = await prisma.task.findFirst({ where: { id: entityId, organizationId: orgId }, select: { title: true, dueDate: true, createdBy: true, assignedTo: true } })
    if (!task || task.assignedTo !== userId) return null
    if (notice.kind === "task.created" && task.createdBy === userId) return null
    const giver = task.createdBy ? await prisma.user.findFirst({ where: { id: task.createdBy, organizationId: orgId }, select: { name: true } }) : null
    return [
      `Sizə tapşırıq verildi: «${task.title}»`,
      task.dueDate ? `Müddət: ${bakuTime(task.dueDate)}` : null,
      giver?.name ? `Verən: ${giver.name}` : null,
    ].filter(Boolean).join("\n")
  }
  if (entityType === "lead" && entityId) {
    const lead = await prisma.lead.findFirst({ where: { id: entityId, organizationId: orgId }, select: { contactName: true, companyName: true, assignedTo: true } })
    if (!lead || lead.assignedTo !== userId) return null
    return `Sizə lid təyin edildi: «${lead.contactName}»${lead.companyName ? ` (${lead.companyName})` : ""}`
  }
  return [notice.title, notice.message].filter((part) => part?.trim()).join("\n")
}

/** Best-effort: a bot that is off, a person not linked or Telegram down simply means no Telegram notice. */
export async function sendStaffTelegramNotice(notice: StaffNotice): Promise<boolean> {
  try {
    return await runWithTenant(notice.organizationId, async () => {
      const link = await prisma.telegramStaffLink.findFirst({
        where: { organizationId: notice.organizationId, userId: notice.userId, bot: { isActive: true } },
        select: { chatId: true, bot: { select: { tokenCiphertext: true } } },
      })
      if (!link) return false
      const text = await staffNoticeText(notice)
      if (!text) return false
      const url = `${APP_URL.replace(/\/$/, "")}${notice.path.startsWith("/") ? notice.path : `/${notice.path}`}`
      await sendMessage(decryptBotToken(notice.organizationId, link.bot.tokenCiphertext), link.chatId, text, [[{ text: "CRM-də aç", url }]])
      return true
    })
  } catch {
    return false
  }
}
