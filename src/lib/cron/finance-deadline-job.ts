import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"

export interface FinanceDeadlineSummary {
  overdueBills: number
  overdueInvoices: number
  expiredContracts: number
  expiringContracts: number
}

async function executeFinanceDeadlineJob(): Promise<FinanceDeadlineSummary> {
  const now = new Date()
  const orgs = await prisma.organization.findMany({ select: { id: true } })
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

    if (bills.count > 0 || invoices.count > 0) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      const chatId = process.env.TELEGRAM_FINANCE_CHAT_ID
      if (botToken && chatId) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
        const text = `🔴 <b>[Auto-check] New overdue items</b>\n\nOverdue bills: ${bills.count}\nOverdue invoices: ${invoices.count}\n\n📎 <a href="${appUrl}/finance">Open finance</a>`
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        }).catch(() => {})
      }
    }

    if (expiredContracts.count > 0) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      const chatId = process.env.TELEGRAM_FINANCE_CHAT_ID
      if (botToken && chatId) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
        const text = `📋 <b>[Contracts] Status auto-update</b>\n\nExpired: ${expiredContracts.count}\n\n📎 <a href="${appUrl}/contracts">Open contracts</a>`
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        }).catch(() => {})
      }
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
