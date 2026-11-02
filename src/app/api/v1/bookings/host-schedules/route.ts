/**
 * When each host actually works. The booking page says when a service is
 * offered; this says when the person performing it is there, and free time is
 * the intersection. A host with no row here keeps the page's hours.
 */
import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingHostWhere, bookingAccess } from "@/lib/booking/access"
import { parseWeeklyHours } from "@/lib/booking/availability"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const [users, schedules] = await Promise.all([
    prisma.user.findMany({ where: bookingHostWhere(auth.orgId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.bookingHostSchedule.findMany({ where: { organizationId: auth.orgId }, select: { userId: true, weekly: true } }),
  ])
  return NextResponse.json({ success: true, data: { users, schedules } }, { headers: { "Cache-Control": "private, no-store" } })
})

const interval = z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()
const input = z.object({
  userId: z.string().min(1).max(64),
  /** null removes the schedule, so the host goes back to the page's hours. */
  weekly: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(interval).max(4)).nullable(),
}).strict()

export const PUT = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const { userId, weekly } = parsed.data
  if (!(await prisma.user.count({ where: bookingHostWhere(auth.orgId, [userId]) }))) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  // A day that ends before it starts would silently remove the host from the
  // whole day instead of failing, so the same reader the slot maths uses
  // decides whether this is a schedule at all.
  const hours = weekly === null ? null : parseWeeklyHours(weekly)
  if (weekly !== null && !hours) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  if (hours && Object.values(hours).every((day) => day.length === 0)) return NextResponse.json({ code: "SCHEDULE_EMPTY" }, { status: 400 })
  const stored = hours as unknown as Prisma.InputJsonValue
  await prisma.$transaction(async (tx) => {
    if (hours === null) await tx.bookingHostSchedule.deleteMany({ where: { organizationId: auth.orgId, userId } })
    else await tx.bookingHostSchedule.upsert({
      where: { organizationId_userId: { organizationId: auth.orgId, userId } },
      create: { organizationId: auth.orgId, userId, weekly: stored, createdBy: auth.userId },
      update: { weekly: stored },
    })
    await tx.auditLog.create({ data: { organizationId: auth.orgId, userId: auth.userId, action: "update", entityType: "booking_host_schedule", entityId: userId, newValue: { weekly: hours ?? null } as Prisma.InputJsonValue } })
  })
  return NextResponse.json({ success: true })
})
