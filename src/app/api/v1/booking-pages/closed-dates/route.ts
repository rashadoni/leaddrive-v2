/**
 * The days the salon does not work: PUT the whole list, get it back as saved.
 *
 * It belongs to the organization, not to one service, so it is kept in
 * `organizations.settings.bookingClosedDates` and read by every path that
 * computes free time — the public page, the staff day view, the WhatsApp agent
 * and a reschedule.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { orgContext } from "@/lib/booking/book"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { MAX_CLOSED_DATES, normalizeClosedDates, readClosedDates } from "@/lib/booking/closed-dates"

const bodySchema = z.object({
  dates: z.array(z.object({
    date: z.string().trim().max(10),
    note: z.string().trim().max(80).nullable().optional(),
  })).max(MAX_CLOSED_DATES),
}).strict()

export const PUT = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })

  // Yesterday's holiday changes nothing and only lengthens the list the owner
  // reads to answer «are we open on Saturday», so the day is cut on the
  // organization's own clock — not the server's.
  const { timezone } = await orgContext(auth.orgId)
  const today = dateInputValueInTimezone(new Date(), timezone)
  const dates = normalizeClosedDates(parsed.data.dates, today)

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  settings.bookingClosedDates = dates
  await prisma.organization.update({ where: { id: auth.orgId }, data: { settings: settings as never } })

  return NextResponse.json({ success: true, data: { closedDates: dates } })
})

export const GET = withRlsAuth("bookings", "read", async (_req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  return NextResponse.json({ success: true, data: { closedDates: readClosedDates(org?.settings) } })
})
