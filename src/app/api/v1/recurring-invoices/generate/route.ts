import { NextResponse } from "next/server"
import type { RecurringInvoiceItem } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import { calculateItemTotal, calculateInvoiceTotals, calculateDueDate } from "@/lib/invoice-calculations"
import { formatMonthYear } from "@/lib/invoice-templates"
import { generateInvoiceHtml, getEmailTemplate } from "@/lib/invoice-html"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { addDays, addWeeks, addMonths, addYears } from "date-fns"
import crypto from "crypto"
import { assertSafeMailHeaderValue, createSecureSmtpTransport } from "@/lib/secure-smtp"

function calculateNextRunDate(current: Date, frequency: string, interval: number): Date {
  switch (frequency) {
    case "daily": return addDays(current, interval)
    case "weekly": return addWeeks(current, interval)
    case "monthly": return addMonths(current, interval)
    case "quarterly": return addMonths(current, interval * 3)
    case "yearly": return addYears(current, interval)
    default: return addMonths(current, interval)
  }
}

async function sendInvoiceEmail(
  invoiceId: string,
  orgId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: "asc" } }, company: true, contact: true },
    })
    if (!invoice || !invoice.recipientEmail) {
      return { success: false, error: "No recipient email" }
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, name: true },
    })
    const settings = (org?.settings as Record<string, unknown>) || {}
    const smtp = settings.smtp as Record<string, unknown> | undefined
    const invoiceSettings = (settings.invoice as Record<string, unknown>) || {}

    const smtpHost = (smtp?.smtpHost || smtp?.host) as string | undefined
    const smtpPort = Number(smtp?.smtpPort || smtp?.port) || 587
    const smtpUser = (smtp?.smtpUser || smtp?.user) as string | undefined
    const smtpPass = (smtp?.smtpPass || smtp?.pass) as string | undefined
    const stripCrlf = (s: string) => s.replace(/[\r\n]/g, "")
    const smtpFrom = stripCrlf(((smtp?.fromEmail || smtp?.from || smtpUser) as string) || "")
    const fromName = stripCrlf((smtp?.fromName as string) || (invoiceSettings.companyName as string) || org?.name || "LeadDrive")

    if (!smtpHost) return { success: false, error: "SMTP not configured" }

    const transporter = createSecureSmtpTransport({
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
    })

    const lang = (invoice.documentLanguage as string) || "az"
    const locale = lang === "ru" ? "ru-RU" : lang === "en" ? "en-US" : "az-AZ"
    const formatMoney = (n: unknown) => Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2 })
    const formatDate = (dt: unknown) => dt ? new Date(dt as string).toLocaleDateString(locale) : "—"

    const customEmailTemplates = (invoiceSettings.emailTemplates as Record<string, Record<string, string>>) || undefined
    const emailData = getEmailTemplate(lang, {
      orgName: fromName,
      invoiceNumber: invoice.invoiceNumber || "",
      total: formatMoney(invoice.totalAmount),
      currency: (invoice.currency as string) || DEFAULT_CURRENCY,
      dueDate: formatDate(invoice.dueDate),
    }, customEmailTemplates)

    const invoiceHtml = generateInvoiceHtml(invoice, org?.name || "", invoiceSettings, true)

    await transporter.sendMail({
      from: `"${fromName}" <${smtpFrom}>`,
      to: assertSafeMailHeaderValue("Recipient", invoice.recipientEmail),
      subject: assertSafeMailHeaderValue("Subject", emailData.subject),
      html: emailData.html,
      attachments: [
        {
          filename: `${invoice.invoiceNumber || "invoice"}.html`,
          content: Buffer.from(invoiceHtml, "utf-8"),
          contentType: "text/html",
        },
      ],
    })

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "sent", sentAt: new Date() },
    })

    return { success: true }
  } catch (e) {
    console.error("Send invoice email error:", e)
    return { success: false, error: "Failed to send email" }
  }
}

export const POST = withRls(async (_req, { orgId }) => {
  try {
    const now = new Date()
    const recurring = await prisma.recurringInvoice.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        nextRunDate: { lte: now },
      },
      include: { items: true },
    })

    const report: Array<{
      invoiceNumber: string
      company?: string
      status: "generated" | "sent" | "send_failed"
      error?: string
    }> = []

    for (const rec of recurring) {
      if (rec.maxOccurrences && rec.totalGenerated >= rec.maxOccurrences) {
        await prisma.recurringInvoice.update({ where: { id: rec.id }, data: { isActive: false } })
        continue
      }
      if (rec.endDate && rec.endDate < now) {
        await prisma.recurringInvoice.update({ where: { id: rec.id }, data: { isActive: false } })
        continue
      }

      const invoiceNumber = await generateInvoiceNumber(orgId)
      const items = rec.items.map((item: RecurringInvoiceItem) => ({
        productId: item.productId || undefined,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        total: calculateItemTotal({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount }),
        sortOrder: item.sortOrder,
        customFields: item.customFields || undefined,
      }))

      const totals = calculateInvoiceTotals(
        items.map((i: Pick<RecurringInvoiceItem, "quantity" | "unitPrice" | "discount">) => ({
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount,
        })),
        "percentage", 0, rec.taxRate, rec.includeVat
      )

      const issueDate = new Date()
      const dueDate = calculateDueDate(issueDate, rec.paymentTerms)

      const template = rec.titleTemplate
      let invoiceTitle = rec.title
      if (template) {
        const monthYear = formatMonthYear(issueDate, "az")
        const [monthName, yearStr] = monthYear.split(" ")
        invoiceTitle = template
          .replace(/\{month\}/gi, monthName || "")
          .replace(/\{year\}/gi, yearStr || String(issueDate.getFullYear()))
          .replace(/\{number\}/gi, String(rec.totalGenerated + 1))
      }

      // Get company name for report
      let companyName = ""
      if (rec.companyId) {
        const company = await prisma.company.findUnique({ where: { id: rec.companyId }, select: { name: true } })
        companyName = company?.name || ""
      }

      const invoice = await prisma.invoice.create({
        data: {
          organizationId: orgId,
          invoiceNumber,
          title: invoiceTitle,
          recurringInvoiceId: rec.id,
          companyId: rec.companyId || undefined,
          contactId: rec.contactId || undefined,
          dealId: rec.dealId || undefined,
          contractId: rec.contractId || undefined,
          currency: rec.currency,
          includeVat: rec.includeVat,
          taxRate: rec.taxRate,
          voen: rec.voen,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          paidAmount: 0,
          balanceDue: totals.totalAmount,
          issueDate,
          dueDate,
          paymentTerms: rec.paymentTerms,
          recipientEmail: rec.recipientEmail,
          notes: rec.notes,
          termsAndConditions: rec.termsAndConditions,
          viewToken: crypto.randomUUID(),
          items: { create: items },
        },
      })

      const nextRunDate = calculateNextRunDate(rec.nextRunDate || now, rec.frequency, rec.intervalCount)
      await prisma.recurringInvoice.update({
        where: { id: rec.id },
        data: { lastRunDate: now, nextRunDate, totalGenerated: { increment: 1 } },
      })

      // Auto-send if enabled
      if (rec.autoSend && rec.recipientEmail) {
        const sendResult = await sendInvoiceEmail(invoice.id, orgId)
        report.push({
          invoiceNumber,
          company: companyName,
          status: sendResult.success ? "sent" : "send_failed",
          error: sendResult.error,
        })
      } else {
        report.push({ invoiceNumber, company: companyName, status: "generated" })
      }
    }

    const sent = report.filter((r) => r.status === "sent").length
    const failed = report.filter((r) => r.status === "send_failed").length
    const generated = report.length

    return NextResponse.json({
      success: true,
      data: {
        generated,
        sent,
        failed,
        report,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
