/**
 * Can this number show a form inside WhatsApp?
 *
 * GET  → { supported, flows?, booking?, reason?, detail? }
 * POST   → { ok, flowId, steps } — create the booking form on this account and
 *          publish it, reporting every step in Meta's own words.
 * DELETE → { ok, detail } — take an unpublished form back off the account.
 *
 * The answer comes from Meta, not from us: the number runs in coexistence and
 * nobody documents whether Flows survive that, so the screen asks and shows
 * what came back (src/lib/booking/whatsapp-flow.ts). Administrator only — the
 * reply carries the account's other Flows, which are its business.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingDb as prisma } from "@/lib/booking/db"
import { readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"
import { deleteBookingFlow, ensureBookingFlow, flowsCapability } from "@/lib/booking/whatsapp-flow"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const setting = readWhatsAppBookingSetting(organization?.settings)
  const capability = await flowsCapability(auth.orgId, { channelConfigId: setting.channelConfigId })
  return NextResponse.json({ success: true, data: capability }, { headers: { "Cache-Control": "private, no-store" } })
})

export const POST = withRlsAuth("bookings", "write", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const setting = readWhatsAppBookingSetting(organization?.settings)
  const result = await ensureBookingFlow(auth.orgId, { channelConfigId: setting.channelConfigId })
  return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "private, no-store" } })
})

export const DELETE = withRlsAuth("bookings", "write", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const setting = readWhatsAppBookingSetting(organization?.settings)
  const result = await deleteBookingFlow(auth.orgId, { channelConfigId: setting.channelConfigId })
  return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "private, no-store" } })
})
