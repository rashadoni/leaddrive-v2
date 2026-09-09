/**
 * Finance Multi-Channel Notifications
 * Sends payment-related alerts via Telegram, Email, and In-App
 * Respects per-org notification settings from Organization.settings.financeNotifications
 */

import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { APP_URL } from "@/lib/domains"
import { getCurrencySymbol } from "@/lib/constants"

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const CHAT_ID = process.env.TELEGRAM_FINANCE_CHAT_ID || ""

interface NotifChannelSettings {
  enabled: boolean
  channels: string[]
}

interface FinanceNotifSettings {
  recipientEmail: string
  overdue: NotifChannelSettings
  advance: NotifChannelSettings & { daysBeforeDeadline: number }
  paymentOrders: NotifChannelSettings
  billPayments: NotifChannelSettings
}

const DEFAULTS: FinanceNotifSettings = {
  recipientEmail: "",
  overdue: { enabled: true, channels: ["telegram"] },
  advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 },
  paymentOrders: { enabled: true, channels: ["telegram"] },
  billPayments: { enabled: true, channels: ["telegram"] },
}

/** Load notification settings for an organization */
async function getNotifSettings(orgId?: string): Promise<FinanceNotifSettings> {
  if (!orgId) return DEFAULTS
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })
    const settings = (org?.settings as Record<string, any>) || {}
    return { ...DEFAULTS, ...settings.financeNotifications }
  } catch {
    return DEFAULTS
  }
}

/** Send notification to all enabled channels for a category */
async function sendToChannels(
  category: NotifChannelSettings,
  settings: FinanceNotifSettings,
  orgId: string | undefined,
  telegramText: string,
  emailSubject: string,
  emailHtml: string,
  inAppTitle: string,
  inAppMessage: string,
  entityType?: string,
  entityId?: string,
) {
  if (!category.enabled) return

  const promises: Promise<any>[] = []

  // Telegram
  if (category.channels.includes("telegram")) {
    promises.push(sendTelegram(telegramText))
  }

  // Email
  if (category.channels.includes("email") && settings.recipientEmail && orgId) {
    promises.push(
      sendEmail({
        to: settings.recipientEmail,
        subject: emailSubject,
        html: emailHtml,
        organizationId: orgId,
      }).catch((e) => console.error("[Finance Email]", e))
    )
  }

  // In-App notification — create for all admin users in org
  if (category.channels.includes("inApp") && orgId) {
    promises.push(
      (async () => {
        try {
          const admins = await prisma.user.findMany({
            where: { organizationId: orgId, role: "admin" },
            select: { id: true },
          })
          // Fallback: if no admins found, get all users
          const users = admins.length > 0 ? admins : await prisma.user.findMany({
            where: { organizationId: orgId },
            select: { id: true },
            take: 5,
          })
          await prisma.notification.createMany({
            data: users.map((u: any) => ({
              organizationId: orgId!,
              userId: u.id,
              type: "finance",
              title: inAppTitle,
              message: inAppMessage,
              entityType: entityType || "finance",
              entityId: entityId || "",
            })),
          })
        } catch (e) {
          console.error("[Finance InApp]", e)
        }
      })()
    )
  }

  await Promise.allSettled(promises)
}

async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Finance TG] Bot not configured, skipping notification")
    return false
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
    })
    if (!res.ok) {
      console.error("[Finance TG] Send failed:", await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error("[Finance TG] Error:", e)
    return false
  }
}

/** Get advance warning days from org settings */
export async function getAdvanceDays(orgId?: string): Promise<number> {
  const settings = await getNotifSettings(orgId)
  return settings.advance.daysBeforeDeadline
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString(undefined)
}

// ─── Notification types ────────────────────────────────────────────────

/** New overdue bills detected */
export async function notifyOverdueBills(bills: { billNumber: string; vendorName: string; amount: number; dueDate: Date | string }[], orgId?: string) {
  if (bills.length === 0) return
  const settings = await getNotifSettings(orgId)
  const total = bills.reduce((s, b) => s + b.amount, 0)
  const cur = getCurrencySymbol()
  const list = bills.slice(0, 10).map((b) => `${b.billNumber} — ${b.vendorName}: ${fmt(b.amount)} ${cur} (due ${fmtDate(b.dueDate)})`).join("\n")

  let tgText = `🔴 <b>Overdue: ${bills.length} bill(s) for ${fmt(total)} ${cur}</b>\n\n`
  bills.slice(0, 10).forEach((b) => { tgText += `• ${b.billNumber} — ${b.vendorName}: <b>${fmt(b.amount)} ${cur}</b> (due ${fmtDate(b.dueDate)})\n` })
  if (bills.length > 10) tgText += `\n...and ${bills.length - 10} more\n`
  tgText += `\n📎 <a href="${APP_URL}/finance?tab=payables">Open payables</a>`

  const emailHtml = `<h2>Overdue: ${bills.length} bill(s) for ${fmt(total)} ${cur}</h2><ul>${bills.slice(0, 10).map((b) => `<li>${b.billNumber} — ${b.vendorName}: <b>${fmt(b.amount)} ${cur}</b></li>`).join("")}</ul><p><a href="${APP_URL}/finance?tab=payables">Open payables</a></p>`

  await sendToChannels(settings.overdue, settings, orgId, tgText,
    `Overdue: ${bills.length} bill(s) for ${fmt(total)} ${cur}`, emailHtml,
    "Overdue payments", `${bills.length} bill(s) for ${fmt(total)} ${cur}`, "bill")
}

/** New overdue invoices detected */
export async function notifyOverdueInvoices(invoices: { invoiceNumber: string; companyName: string; amount: number; dueDate: Date | string }[], orgId?: string) {
  if (invoices.length === 0) return
  const settings = await getNotifSettings(orgId)
  const total = invoices.reduce((s, b) => s + b.amount, 0)

  const cur = getCurrencySymbol()
  let tgText = `🔴 <b>Overdue A/R: ${invoices.length} invoice(s) for ${fmt(total)} ${cur}</b>\n\n`
  invoices.slice(0, 10).forEach((inv) => { tgText += `• ${inv.invoiceNumber} — ${inv.companyName}: <b>${fmt(inv.amount)} ${cur}</b>\n` })
  tgText += `\n📎 <a href="${APP_URL}/finance?tab=receivables">Open receivables</a>`

  const emailHtml = `<h2>Overdue A/R: ${invoices.length} invoice(s) for ${fmt(total)} ${cur}</h2><ul>${invoices.slice(0, 10).map((inv) => `<li>${inv.invoiceNumber} — ${inv.companyName}: <b>${fmt(inv.amount)} ${cur}</b></li>`).join("")}</ul><p><a href="${APP_URL}/finance?tab=receivables">Open receivables</a></p>`

  await sendToChannels(settings.overdue, settings, orgId, tgText,
    `Overdue A/R: ${invoices.length} invoice(s) for ${fmt(total)} ${cur}`, emailHtml,
    "Overdue invoices", `${invoices.length} invoice(s) for ${fmt(total)} ${cur}`, "invoice")
}

/** Upcoming deadlines */
export async function notifyUpcomingDeadlines(
  bills: { billNumber: string; vendorName: string; amount: number; dueDate: Date | string }[],
  invoices: { invoiceNumber: string; companyName: string; amount: number; dueDate: Date | string }[],
  daysAhead: number,
  orgId?: string,
) {
  if (bills.length === 0 && invoices.length === 0) return
  const settings = await getNotifSettings(orgId)

  const cur = getCurrencySymbol()
  let tgText = `⏰ <b>Deadlines in the next ${daysAhead} day(s)</b>\n`
  let emailHtml = `<h2>Deadlines in the next ${daysAhead} day(s)</h2>`
  let summary = ""

  if (bills.length > 0) {
    const total = bills.reduce((s, b) => s + b.amount, 0)
    tgText += `\n<b>📤 To pay (${bills.length}, ${fmt(total)} ${cur}):</b>\n`
    emailHtml += `<h3>To pay (${bills.length}, ${fmt(total)} ${cur})</h3><ul>`
    bills.slice(0, 5).forEach((b) => {
      tgText += `• ${b.billNumber} — ${b.vendorName}: ${fmt(b.amount)} ${cur} (due ${fmtDate(b.dueDate)})\n`
      emailHtml += `<li>${b.billNumber} — ${b.vendorName}: ${fmt(b.amount)} ${cur}</li>`
    })
    emailHtml += "</ul>"
    summary += `${bills.length} to pay`
  }
  if (invoices.length > 0) {
    const total = invoices.reduce((s, b) => s + b.amount, 0)
    tgText += `\n<b>📥 Awaiting payment (${invoices.length}, ${fmt(total)} ${cur}):</b>\n`
    emailHtml += `<h3>Awaiting payment (${invoices.length}, ${fmt(total)} ${cur})</h3><ul>`
    invoices.slice(0, 5).forEach((inv) => {
      tgText += `• ${inv.invoiceNumber} — ${inv.companyName}: ${fmt(inv.amount)} ${cur}\n`
      emailHtml += `<li>${inv.invoiceNumber} — ${inv.companyName}: ${fmt(inv.amount)} ${cur}</li>`
    })
    emailHtml += "</ul>"
    summary += `${summary ? ", " : ""}${invoices.length} awaiting`
  }
  tgText += `\n📎 <a href="${APP_URL}/finance?tab=payments">Open payments</a>`
  emailHtml += `<p><a href="${APP_URL}/finance?tab=payments">Open payments</a></p>`

  await sendToChannels(settings.advance, settings, orgId, tgText,
    `Deadlines: ${summary}`, emailHtml,
    "Upcoming deadlines", summary)
}

/** Payment order executed */
export async function notifyPaymentOrderExecuted(order: {
  orderNumber: string; counterpartyName: string; amount: number; currency: string; purpose: string
}, orgId?: string) {
  const settings = await getNotifSettings(orgId)
  const tgText = `✅ <b>Payment order executed</b>\n\n📋 ${order.orderNumber}\n🏢 ${order.counterpartyName}\n💰 <b>${fmt(order.amount)} ${order.currency}</b>\n📝 ${order.purpose}\n\n📎 <a href="${APP_URL}/finance?tab=payments">Open payments</a>`
  const emailHtml = `<h2>Payment order executed</h2><p><b>${order.orderNumber}</b> — ${order.counterpartyName}</p><p>Amount: <b>${fmt(order.amount)} ${order.currency}</b></p><p>${order.purpose}</p><p><a href="${APP_URL}/finance?tab=payments">Open payments</a></p>`

  await sendToChannels(settings.paymentOrders, settings, orgId, tgText,
    `PO ${order.orderNumber} executed — ${fmt(order.amount)} ${order.currency}`, emailHtml,
    "Payment order executed", `${order.orderNumber}: ${fmt(order.amount)} ${order.currency} — ${order.counterpartyName}`, "payment_order")
}

/** Payment order submitted for approval */
export async function notifyPaymentOrderPending(order: {
  orderNumber: string; counterpartyName: string; amount: number; currency: string; purpose: string
}, orgId?: string) {
  const settings = await getNotifSettings(orgId)
  const tgText = `🔔 <b>Payment order pending approval</b>\n\n📋 ${order.orderNumber}\n🏢 ${order.counterpartyName}\n💰 <b>${fmt(order.amount)} ${order.currency}</b>\n📝 ${order.purpose}\n\n📎 <a href="${APP_URL}/finance?tab=payments">Approve / Reject</a>`
  const emailHtml = `<h2>Payment order pending approval</h2><p><b>${order.orderNumber}</b> — ${order.counterpartyName}</p><p>Amount: <b>${fmt(order.amount)} ${order.currency}</b></p><p>${order.purpose}</p><p><a href="${APP_URL}/finance?tab=payments">Approve / Reject</a></p>`

  await sendToChannels(settings.paymentOrders, settings, orgId, tgText,
    `PO ${order.orderNumber} pending — ${fmt(order.amount)} ${order.currency}`, emailHtml,
    "Payment order pending", `${order.orderNumber}: ${fmt(order.amount)} ${order.currency} — ${order.counterpartyName}`, "payment_order")
}

/** Bill payment recorded */
export async function notifyBillPaymentRecorded(bill: {
  billNumber: string; vendorName: string; paymentAmount: number; remainingBalance: number; currency: string
}, orgId?: string) {
  const settings = await getNotifSettings(orgId)
  const emoji = bill.remainingBalance <= 0 ? "✅" : "💸"
  const status = bill.remainingBalance <= 0 ? "Fully paid" : `Remaining: ${fmt(bill.remainingBalance)} ${bill.currency}`

  const tgText = `${emoji} <b>Bill payment recorded</b>\n\n📋 ${bill.billNumber} — ${bill.vendorName}\n💰 Paid: <b>${fmt(bill.paymentAmount)} ${bill.currency}</b>\n📊 ${status}\n\n📎 <a href="${APP_URL}/finance?tab=payables">Open payables</a>`
  const emailHtml = `<h2>Bill payment: ${bill.billNumber}</h2><p>${bill.vendorName}</p><p>Paid: <b>${fmt(bill.paymentAmount)} ${bill.currency}</b></p><p>${status}</p><p><a href="${APP_URL}/finance?tab=payables">Open payables</a></p>`

  await sendToChannels(settings.billPayments, settings, orgId, tgText,
    `Payment: ${bill.billNumber} — ${fmt(bill.paymentAmount)} ${bill.currency}`, emailHtml,
    "Bill payment recorded", `${bill.billNumber}: ${fmt(bill.paymentAmount)} ${bill.currency}. ${status}`, "bill")
}
