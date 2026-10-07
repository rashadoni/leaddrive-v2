import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { APP_URL } from "@/lib/domains"
import { financeTelegramTarget, readFinanceNotifSettings } from "@/lib/finance/notification-settings"
import { sendFinanceTelegram } from "@/lib/finance/telegram-send"

export interface FinanceDeadlineSummary {
  overdueBills: number
  overdueInvoices: number
  expiredContracts: number
  expiringContracts: number
}

async function executeFinanceDeadlineJob(): Promise<FinanceDeadlineSummary> {
  const now = new Date()
  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } })
  const summary: FinanceDeadlineSummary = {
    overdueBills: 0,
    overdueInvoices: 0,
    expiredContracts: 0,
    expiringContracts: 0,
  }

  for (const org of orgs) {
    const [bills, invoices] = await Promise.all([
      prisma.bill.updateMany({
        where: {
          organizationId: org.id,
          dueDate: { lt: now },
          status: { in: ["pending", "partially_paid"] },
          balanceDue: { gt: 0 },
        },
        data: { status: "overdue" },
      }),
      prisma.invoice.updateMany({
        where: {
          organizationId: org.id,
          dueDate: { lt: now },
          status: { in: ["sent", "viewed", "partially_paid"] },
          balanceDue: { gt: 0 },
        },
        data: { status: "overdue" },
      }),
    ])
    summary.overdueBills += bills.count
    summary.overdueInvoices += invoices.count

    const expiredContracts = await prisma.contract.updateMany({
      where: {
        organizationId: org.id,
        endDate: { lt: now },
        status: { in: ["active", "renewing", "expiring"] },
      },
      data: { status: "expired" },
    })
    summary.expiredContracts += expiredContracts.count

    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    summary.expiringContracts += await prisma.contract.count({
      where: {
        organizationId: org.id,
        endDate: { gt: now, lte: thirtyDaysFromNow },
        status: { in: ["active", "renewing"] },
      },
    })

    // Each organization hears about its own items in its own chat, through its
    // own bot, and only if it asked for overdue notices in Telegram. This loop
    // used to post every organization's counts to one installation-wide chat.
    const notif = readFinanceNotifSettings(org.settings)
    const telegram = notif.overdue.enabled && notif.overdue.channels.includes("telegram")
      ? financeTelegramTarget(notif)
      : null
    if (!telegram) continue

    if (bills.count > 0 || invoices.count > 0) {
      await sendFinanceTelegram(
        telegram,
        `🔴 <b>[Auto-check] New overdue items</b>\n\nOverdue bills: ${bills.count}\nOverdue invoices: ${invoices.count}\n\n📎 <a href="${APP_URL}/finance">Open finance</a>`,
      )
    }

    if (expiredContracts.count > 0) {
      await sendFinanceTelegram(
        telegram,
        `📋 <b>[Contracts] Status auto-update</b>\n\nExpired: ${expiredContracts.count}\n\n📎 <a href="${APP_URL}/contracts">Open contracts</a>`,
      )
    }
  }

  console.log(
    `[Finance Cron] overdue bills=${summary.overdueBills}, overdue invoices=${summary.overdueInvoices}, expired contracts=${summary.expiredContracts}, expiring contracts=${summary.expiringContracts}`,
  )
  return summary
}

export function runFinanceDeadlineJob() {
  return runWithRlsBypass(() =>
    withJobLease(
      { name: "finance-deadlines", ttlMs: 15 * 60_000 },
      executeFinanceDeadlineJob,
    ),
  )
}
