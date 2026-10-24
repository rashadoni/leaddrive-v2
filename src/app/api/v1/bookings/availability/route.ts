import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess, bookingScope } from "@/lib/booking/access"
import { activeHosts, loadBusyByHost, orgContext } from "@/lib/booking/book"
import { computeSlots, type BusyInterval } from "@/lib/booking/availability"
import { bookingRules } from "@/lib/booking/commands"
import { bookingCalendarBusy } from "@/lib/booking/calendar-busy"
import { BookingCommandError } from "@/lib/booking/command-error"
import { localDateTimeToUtc } from "@/lib/timezone"

const input = z.object({ pageId: z.string().min(1).max(64), hostId: z.string().max(64).optional(), bookingId: z.string().max(64).optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = input.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const f = parsed.data
  if (f.bookingId && !f.hostId) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const booking = f.bookingId ? await prisma.booking.findFirst({ where: { AND: [bookingScope(access, true), { id: f.bookingId }] }, select: { bookingPageId: true } }) : null
  if (f.bookingId && (!booking || booking.bookingPageId !== f.pageId)) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  const page = await prisma.bookingPage.findFirst({ where: { id: f.pageId, organizationId: auth.orgId, ...(booking ? {} : { isActive: true }) } })
  if (!page) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  const org = await orgContext(auth.orgId)
  const hosts = (await activeHosts(auth.orgId, page.hostIds)).filter((host) => (!f.hostId || f.hostId === host.id) && (access.writableHostIds === null || access.writableHostIds.includes(host.id)))
  try {
    const from = localDateTimeToUtc(`${f.day}T00:00`, org.timezone)
    const next = new Date(`${f.day}T12:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    const to = localDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, org.timezone)
    const busy = f.bookingId ? new Map<string, BusyInterval[]>() : await loadBusyByHost(auth.orgId, hosts.map((host) => host.id), from, to)
    if (f.bookingId) {
      for (const host of hosts) {
        const external = await bookingCalendarBusy(auth.orgId, host.id, from, to, f.bookingId)
        const internal = await prisma.booking.findMany({ where: { organizationId: auth.orgId, hostUserId: host.id, status: "confirmed", id: { not: f.bookingId }, startsAt: { lt: new Date(to.getTime() + 240 * 60_000) }, endsAt: { gt: new Date(from.getTime() - 240 * 60_000) } }, select: { startsAt: true, endsAt: true, bufferBefore: true, bufferAfter: true } })
        busy.set(host.id, [...external.intervals, ...internal.map((row) => ({ start: row.startsAt, end: row.endsAt, bufferBeforeMinutes: row.bufferBefore, bufferAfterMinutes: row.bufferAfter }))])
      }
    }
    const days = computeSlots({ rules: bookingRules(page, org.timezone), hostIds: hosts.map((host) => host.id), busyByHost: busy, now: new Date() }).filter((item) => item.date === f.day)
    return NextResponse.json({ success: true, data: { page: { orgName: org.name, title: page.title, description: page.description, durationMinutes: page.durationMinutes, locationType: page.locationType, locationText: page.locationText, hostNames: hosts.map((host) => host.name), timezone: org.timezone }, hosts: hosts.map(({ id, name }) => ({ id, name })), days } }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof BookingCommandError) return NextResponse.json({ code: error.code }, { status: error.status })
    throw error
  }
})
