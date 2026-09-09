import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { generateInvoiceHtml, getEmailTemplate } from "@/lib/invoice-html"
import { assertSafeMailHeaderValue, createSecureSmtpTransport } from "@/lib/secure-smtp"

const sendSchema = z.object({
  recipientEmail: z.string().email(),
  subject: z.string().optional(),
  message: z.string().optional(),
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: "asc" } }, company: true, contact: true },
    })
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })

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
    // Sanitize CRLF to prevent email header injection
    const stripCrlf = (s: string) => s.replace(/[\r\n]/g, "")
    const smtpFrom = stripCrlf(((smtp?.fromEmail || smtp?.from || smtpUser) as string) || "")
    const fromName = stripCrlf((smtp?.fromName as string) || (invoiceSettings.companyName as string) || org?.name || "LeadDrive")

    if (!smtpHost) {
      return NextResponse.json({ error: "SMTP not configured" }, { status: 400 })
    }

    const transporter = createSecureSmtpTransport({
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
    })

    const d = parsed.data
    const lang = (invoice.documentLanguage as string) || "az"
    const locale = lang === "ru" ? "ru-RU" : lang === "en" ? "en-US" : "az-AZ"
    const formatMoney = (n: unknown) => Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2 })
    const formatDate = (dt: unknown) => dt ? new Date(dt as string).toLocaleDateString(locale) : "—"

    // Generate email template based on document language (with custom templates if configured)
    const customEmailTemplates = (invoiceSettings.emailTemplates as Record<string, Record<string, string>>) || undefined
    const emailData = getEmailTemplate(lang, {
      orgName: fromName,
      invoiceNumber: invoice.invoiceNumber || "",
      total: formatMoney(invoice.totalAmount),
      currency: (invoice.currency as string) || DEFAULT_CURRENCY,
      dueDate: formatDate(invoice.dueDate),
      customMessage: d.message || undefined,
    }, customEmailTemplates)

    // Use custom subject if provided, otherwise use template
    const subject = assertSafeMailHeaderValue("Subject", d.subject || emailData.subject)

    // Generate invoice HTML with stamp for attachment
    const invoiceHtml = generateInvoiceHtml(invoice, org?.name || "", invoiceSettings, true)

    await transporter.sendMail({
      from: `"${fromName}" <${smtpFrom}>`,
      to: assertSafeMailHeaderValue("Recipient", d.recipientEmail),
      subject,
      html: emailData.html,
      attachments: [
        {
          filename: `${invoice.invoiceNumber || "invoice"}.html`,
          content: Buffer.from(invoiceHtml, "utf-8"),
          contentType: "text/html",
        },
      ],
    })

    await prisma.invoice.updateMany({
      where: { id, organizationId: orgId },
      data: {
        status: invoice.status === "draft" ? "sent" : invoice.status,
        sentAt: new Date(),
        recipientEmail: d.recipientEmail,
      },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
