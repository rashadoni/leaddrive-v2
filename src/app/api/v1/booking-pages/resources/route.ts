/**
 * Rooms, chairs, tables — the things a meeting can be put on that are not
 * people (src/lib/booking/book.ts, `bookableChairs`).
 *
 *   GET    → { resources: [{ id, name, weekly, isActive, upcoming }] }
 *   POST   { name, weekly? }        → the resource as stored
 *   PATCH  { id, name?, weekly?, isActive? } → the resource as stored
 *   DELETE ?id= → switched off, never deleted: meetings point at it.
 *
 * Administrator only, like every other thing that decides what clients can
 * book. A resource is deliberately not a user: nothing outside booking has to
 * learn about it, so no list of people and no login path can start showing
 * rooms by accident.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { parseWeeklyHours } from "@/lib/booking/availability"

const weekly = z.record(z.string(), z.array(z.object({ start: z.string(), end: z.string() })).max(6)).nullable().optional()

/** What is stored is what the reader accepts: anything else is no schedule. */
function hours(value: unknown): object | null {
  const parsed = parseWeeklyHours(value)
  return parsed ? parsed as unknown as object : null
}

async function listResources(orgId: string) {
  const [resources, booked] = await Promise.all([
    prisma.bookingResource.findMany({ where: { organizationId: orgId }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.booking.groupBy({
      by: ["resourceId"],
      where: { organizationId: orgId, status: "confirmed", startsAt: { gte: new Date() }, resourceId: { not: null } },
      _count: { _all: true },
    }),
  ])
  return resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    weekly: resource.weekly,
    isActive: resource.isActive,
    // What switching it off would take with it, said before it is done.
    upcoming: booked.find((row) => row.resourceId === resource.id)?._count._all ?? 0,
  }))
}

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  return NextResponse.json({ success: true, data: { resources: await listResources(auth.orgId) } })
})

const create = z.object({ name: z.string().trim().min(1).max(80), weekly })

export const POST = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = create.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  // Sixty is a floor of a building, not a mistake; two hundred is a mistake.
  if (await prisma.bookingResource.count({ where: { organizationId: auth.orgId } }) >= 200) {
    return NextResponse.json({ code: "TOO_MANY" }, { status: 409 })
  }
  const resource = await prisma.bookingResource.create({
    data: { organizationId: auth.orgId, name: parsed.data.name, weekly: hours(parsed.data.weekly) ?? undefined },
    select: { id: true, name: true, weekly: true, isActive: true },
  })
  return NextResponse.json({ success: true, data: { resource: { ...resource, upcoming: 0 } } }, { status: 201 })
})

const change = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80).optional(),
  weekly,
  isActive: z.boolean().optional(),
})

export const PATCH = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = change.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  const current = await prisma.bookingResource.findFirst({ where: { organizationId: auth.orgId, id: parsed.data.id }, select: { id: true } })
  if (!current) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  const resource = await prisma.bookingResource.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      // `weekly: null` is «whenever the service is open», which is a schedule
      // in its own right — absent means «leave it as it was».
      ...(parsed.data.weekly === undefined ? {} : { weekly: hours(parsed.data.weekly) ?? undefined }),
      ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
    },
    select: { id: true, name: true, weekly: true, isActive: true },
  })
  return NextResponse.json({ success: true, data: { resource } })
})

export const DELETE = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const id = new URL(req.url).searchParams.get("id") ?? ""
  const current = await prisma.bookingResource.findFirst({ where: { organizationId: auth.orgId, id }, select: { id: true } })
  if (!current) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  // Switched off, never deleted: meetings point at it, and a room that stops
  // being bookable must leave the meetings it already holds alone.
  await prisma.bookingResource.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ success: true, data: { id } })
})
