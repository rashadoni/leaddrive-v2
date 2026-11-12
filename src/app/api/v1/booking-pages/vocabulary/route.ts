/**
 * What this organisation calls what it books, and who does it.
 *
 *   GET → { vocabulary: { item, host, noHost } }
 *   PUT { item, host, noHost } → the vocabulary as stored
 *
 * One key in `organizations.settings`, set in place: the rest of that object
 * belongs to other screens and must not be read and written back around them.
 * Administrator only — it changes what every client of this organisation
 * reads, on the screens and inside the WhatsApp form.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { BOOKING_VOCABULARY_SETTING, readBookingVocabulary } from "@/lib/booking/vocabulary"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  return NextResponse.json({ success: true, data: { vocabulary: readBookingVocabulary(organization?.settings) } })
})

const body = z.object({
  item: z.string().max(30).nullable(),
  host: z.string().max(30).nullable(),
  noHost: z.boolean(),
})

export const PUT = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  // Read back through the same reader every screen uses: what is stored is
  // what they will show, not what the form happened to send.
  const value = readBookingVocabulary({ [BOOKING_VOCABULARY_SETTING]: parsed.data })
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{${BOOKING_VOCABULARY_SETTING}}', $2::jsonb) WHERE id = $1`,
    auth.orgId, JSON.stringify(value),
  )
  return NextResponse.json({ success: true, data: { vocabulary: value } })
})
