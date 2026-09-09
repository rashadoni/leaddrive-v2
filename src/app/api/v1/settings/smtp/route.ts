import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { z } from "zod"

const smtpSchema = z.object({
  smtpHost: z.string().min(1, "SMTP хост обязателен"),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1, "Логин обязателен"),
  smtpPass: z.string().min(1, "Пароль обязателен"),
  smtpTls: z.boolean().default(true),
  fromEmail: z.string().email("Неверный email отправителя"),
  fromName: z.string().optional(),
})

export const GET = withRls(async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = (org?.settings as any) || {}
  const smtp = settings.smtp || {}

  return NextResponse.json({
    success: true,
    data: {
      smtpHost: smtp.smtpHost || "",
      smtpPort: smtp.smtpPort || 587,
      smtpUser: smtp.smtpUser || "",
      smtpPass: smtp.smtpPass ? "••••••••" : "",
      smtpTls: smtp.smtpTls !== false,
      fromEmail: smtp.fromEmail || "",
      fromName: smtp.fromName || "",
      isConfigured: !!(smtp.smtpHost && smtp.smtpUser && smtp.smtpPass),
    },
  })
})

export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  try {
    const body = await req.json()
    const data = smtpSchema.parse(body)

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const currentSettings = (org?.settings as any) || {}
    const currentSmtp = currentSettings.smtp || {}

    // If password is masked, keep the old one
    const smtpPass = data.smtpPass === "••••••••" ? currentSmtp.smtpPass : data.smtpPass

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: {
          ...currentSettings,
          smtp: {
            smtpHost: data.smtpHost,
            smtpPort: data.smtpPort,
            smtpUser: data.smtpUser,
            smtpPass: smtpPass,
            smtpTls: data.smtpTls,
            fromEmail: data.fromEmail,
            fromName: data.fromName || "",
          },
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    if (e.name === "ZodError") {
      return NextResponse.json({ error: e.issues?.[0]?.message || "Validation error" }, { status: 400 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
