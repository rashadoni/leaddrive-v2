import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import nodemailer from "nodemailer"
import { z } from "zod"

const testSchema = z.object({
  email: z.string().email("Неверный email"),
})

type SmtpSettings = {
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  smtpTls?: boolean
  fromEmail?: string
  fromName?: string
}

type OrganizationSettings = {
  smtp?: SmtpSettings
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const POST = withRls(async (req, { orgId }) => {
  try {
    const body = await req.json()
    const { email } = testSchema.parse(body)

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, name: true },
    })

    const settings = (org?.settings ?? {}) as OrganizationSettings
    const smtp = settings.smtp ?? {}

    if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPass) {
      return NextResponse.json({
        error: "SMTP не настроен. Сначала сохраните настройки SMTP.",
      }, { status: 400 })
    }

    const transporter = nodemailer.createTransport({
      host: smtp.smtpHost,
      port: smtp.smtpPort || 587,
      secure: smtp.smtpPort === 465,
      auth: {
        user: smtp.smtpUser,
        pass: smtp.smtpPass,
      },
      tls: smtp.smtpTls !== false ? {} : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })

    // Sanitize CRLF to prevent email header injection
    const stripCrlf = (s: string) => s.replace(/[\r\n]/g, "")
    const fromEmail = stripCrlf(smtp.fromEmail || smtp.smtpUser)
    const fromName = stripCrlf(smtp.fromName || org?.name || "LeadDrive CRM")

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: "✅ LeadDrive CRM — Тестовое письмо",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">LeadDrive CRM</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Тестовое письмо</p>
          </div>
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #059669; margin: 0 0 16px;">✅ SMTP настроен правильно!</h2>
            <p style="color: #374151; line-height: 1.6;">
              Это тестовое письмо отправлено через ваши SMTP настройки в LeadDrive CRM.
            </p>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0; color: #6b7280; font-size: 14px;"><strong>Сервер:</strong> ${smtp.smtpHost}:${smtp.smtpPort}</p>
              <p style="margin: 4px 0; color: #6b7280; font-size: 14px;"><strong>Отправитель:</strong> ${fromName} &lt;${fromEmail}&gt;</p>
              <p style="margin: 4px 0; color: #6b7280; font-size: 14px;"><strong>Дата:</strong> ${new Date().toLocaleString(undefined)}</p>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
              Отправлено из LeadDrive CRM v2
            </p>
          </div>
        </div>
      `,
    })

    return NextResponse.json({
      success: true,
      data: { messageId: info.messageId },
    })
  } catch (e: unknown) {
    const msg = getErrorMessage(e)
    let friendlyError = "SMTP connection failed. Check your settings."
    if (msg.includes("ECONNREFUSED")) friendlyError = "Не удалось подключиться к SMTP серверу. Проверьте хост и порт."
    else if (msg.includes("EAUTH") || msg.includes("535")) friendlyError = "Ошибка авторизации. Проверьте логин и пароль."
    else if (msg.includes("ETIMEDOUT")) friendlyError = "Таймаут подключения. Сервер не отвечает."
    else if (msg.includes("self signed")) friendlyError = "Ошибка сертификата SSL. Попробуйте отключить TLS."

    return NextResponse.json({ error: friendlyError }, { status: 400 })
  }
})
