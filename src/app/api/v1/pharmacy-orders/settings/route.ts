import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { logAudit, prisma } from "@/lib/prisma"
import { normalizeNoticePhone, readManagerNoticeSettings } from "@/lib/pharmacy-orders/manager-notice"
import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withRlsAuth } from "@/lib/with-rls"

/** Who gets the WhatsApp message about a new phone order, and whether a WhatsApp channel is there to send it. */
export const GET = withRlsAuth("mtm", "read", async (_req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const [org, channel] = await Promise.all([
    runWithRlsBypass(() => prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })),
    prisma.channelConfig.findFirst({ where: { organizationId: auth.orgId, channelType: "whatsapp", isActive: true }, select: { configName: true } }),
  ])
  return NextResponse.json({ data: { phones: readManagerNoticeSettings(org?.settings).phones, whatsapp: channel?.configName ?? null } })
})

const bodySchema = z.strictObject({ phones: z.array(z.string().max(40)).max(5) })

/** An admin or manager sets the numbers; anything that is not a phone number is refused, not dropped. */
export const PUT = withRlsAuth("mtm", "write", async (req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (!["admin", "manager"].includes(auth.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 })
  const phones = parsed.data.phones.map(phone => phone.trim()).filter(Boolean).map(normalizeNoticePhone)
  if (phones.some(phone => phone === null)) return NextResponse.json({ error: "invalid_phone" }, { status: 400 })
  const unique = [...new Set(phones as string[])]
  await runWithRlsBypass(() => prisma.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
    const settings = (org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}) as Record<string, unknown>
    const section = (settings.pharmacyPhoneOrders && typeof settings.pharmacyPhoneOrders === "object" ? settings.pharmacyPhoneOrders : {}) as Record<string, unknown>
    await tx.organization.update({ where: { id: auth.orgId },
      data: { settings: { ...settings, pharmacyPhoneOrders: { ...section, managerWhatsApp: unique } } } })
  }))
  logAudit(auth.orgId, "update", "organization", auth.orgId, "pharmacy phone orders: manager WhatsApp", { newValue: { count: unique.length } })
  return NextResponse.json({ data: { phones: unique } })
})
