import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const channelSchema = z.array(z.enum(["inApp", "email", "telegram"])).default(["telegram"])

const notifSettingsSchema = z.object({
  recipientEmail: z.union([z.literal(""), z.string().email().max(200)]).default(""),
  overdue: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
  advance: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
    daysBeforeDeadline: z.number().min(1).max(30).default(7),
  }).default({ enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 }),
  paymentOrders: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
  billPayments: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
})

export type FinanceNotifSettings = z.infer<typeof notifSettingsSchema>

const DEFAULTS: FinanceNotifSettings = {
  recipientEmail: "",
  overdue: { enabled: true, channels: ["telegram"] },
  advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 },
  paymentOrders: { enabled: true, channels: ["telegram"] },
  billPayments: { enabled: true, channels: ["telegram"] },
}

// GET — fetch notification settings
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = (org?.settings as Record<string, any>) || {}
  const notifSettings = settings.financeNotifications || DEFAULTS

  return NextResponse.json({ data: notifSettings })
}

// PUT — update notification settings
export async function PUT(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = notifSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = (org?.settings as Record<string, any>) || {}
  settings.financeNotifications = parsed.data

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings },
  })

  return NextResponse.json({ data: parsed.data })
}
