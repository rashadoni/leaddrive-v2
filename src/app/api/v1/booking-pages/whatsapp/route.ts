/**
 * «Запись через WhatsApp» on the services screen: whether the booking agent
 * answers clients on WhatsApp (src/lib/booking/whatsapp-agent.ts), and on which
 * number. One key in organizations.settings, set in place.
 *   GET → { setting: { mode, channelConfigId }, channels: [{ id, name }] }
 *   PUT { mode, channelConfigId } → the setting as stored
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { readWhatsAppBookingSetting, WHATSAPP_BOOKING_SETTING } from "@/lib/booking/whatsapp-setting"
import { readAutonomyRules } from "@/lib/booking/whatsapp-rules"

async function whatsappChannels(orgId: string) {
  const rows = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, configName: true, displayName: true },
  })
  return rows.map((row) => ({ id: row.id, name: row.displayName || row.configName }))
}

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const [organization, channels] = await Promise.all([
    prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } }),
    whatsappChannels(auth.orgId),
  ])
  return NextResponse.json({ success: true, data: { setting: readWhatsAppBookingSetting(organization?.settings), channels } })
})

const interval = z.object({ start: z.string(), end: z.string() })
const body = z.object({
  mode: z.enum(["off", "book"]),
  channelConfigId: z.string().min(1).max(64).nullable(),
  // Every rule is a narrowing of «everything»; null means «do not narrow».
  rules: z.object({
    serviceIds: z.array(z.string().min(1).max(64)).max(200).nullable(),
    hostIds: z.array(z.string().min(1).max(64)).max(200).nullable(),
    hours: z.record(z.string(), z.array(interval).max(6)).nullable(),
    maxPrice: z.number().min(0).max(1_000_000_000).nullable(),
    newClients: z.boolean(),
  }).optional(),
  // The approved template names. A screen that does not know them leaves them
  // out and keeps what is stored; "" clears one.
  reminderTemplate: z.string().max(200).nullable().optional(),
  changeTemplate: z.string().max(200).nullable().optional(),
  cancelTemplate: z.string().max(200).nullable().optional(),
})

export const PUT = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  const channels = await whatsappChannels(auth.orgId)
  // Turning it on needs a number to answer from; naming one that is not this
  // organization's WhatsApp is refused rather than silently widened to all.
  if (parsed.data.mode === "book" && !channels.length) return NextResponse.json({ code: "NO_WHATSAPP" }, { status: 409 })
  if (parsed.data.channelConfigId && !channels.some((channel) => channel.id === parsed.data.channelConfigId)) {
    return NextResponse.json({ code: "UNKNOWN_CHANNEL" }, { status: 400 })
  }
  // Read back through the same reader the agent uses: what is stored is what
  // it will obey, not what the form happened to send.
  //
  // The key is replaced whole below, so anything this body does not carry has
  // to be carried over by hand. Until 2026-11-10 it was not, and saving the
  // card silently dropped the approved template names — the reminders and the
  // change notices then fell back to «cannot reach them outside 24 hours».
  const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const stored = readWhatsAppBookingSetting(organization?.settings)
  const keep = (sent: string | null | undefined, current: string | null) =>
    sent === undefined ? current : sent && sent.trim() ? sent.trim() : null
  const value = {
    mode: parsed.data.mode,
    channelConfigId: parsed.data.channelConfigId,
    rules: readAutonomyRules(parsed.data.rules),
    reminderTemplate: keep(parsed.data.reminderTemplate, stored.reminderTemplate),
    changeTemplate: keep(parsed.data.changeTemplate, stored.changeTemplate),
    cancelTemplate: keep(parsed.data.cancelTemplate, stored.cancelTemplate),
  }
  // One key, set in place: the rest of settings belongs to other screens and
  // must not be read and written back around it.
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{${WHATSAPP_BOOKING_SETTING}}', $2::jsonb) WHERE id = $1`,
    auth.orgId, JSON.stringify(value),
  )
  return NextResponse.json({ success: true, data: { setting: value } })
})
