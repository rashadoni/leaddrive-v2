/**
 * The links that open a screen on the wall (/board/<token>).
 *
 *   GET    → { links: [{ id, title, url, hostIds, columns, createdAt, today }] }
 *   POST   { title, hostIds, columns } → the link, with its address
 *   PATCH  { id, title, hostIds, columns } → the same screen, changed in place
 *   DELETE { id } → revoked; the address stops working and the row stays
 *
 * `hostIds` are the screen's columns: masters and rooms alike (a meeting
 * booked on a room stands in the room's column — src/lib/booking/board.ts).
 * `today` is what the screen holds today and whose meetings it leaves out, so
 * a screen that looks empty explains itself in the settings.
 *
 * Administrator only, like everything that sets the section up. The token is
 * the whole permission the screen has, so it is generated here and never
 * taken from the caller.
 */
import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { boardLinksToday, readBoardColumns, type BoardToday } from "@/lib/booking/board"
import { bookingBoardUrl } from "@/lib/booking/book"

const NOTHING_TODAY: BoardToday = { shown: 0, elsewhere: [] }

/**
 * Only this organization's own masters and rooms may become columns: a screen
 * is not a way to read another tenant's day.
 */
async function ownChairs(organizationId: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return true
  const [people, rooms] = await Promise.all([
    prisma.user.count({ where: { organizationId, id: { in: ids } } }),
    prisma.bookingResource.count({ where: { organizationId, id: { in: ids } } }),
  ])
  return people + rooms === ids.length
}

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const rows = await prisma.bookingBoardLink.findMany({
    where: { organizationId: auth.orgId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, token: true, hostIds: true, columns: true, createdAt: true },
  })
  const today = await boardLinksToday(auth.orgId, rows)
  return NextResponse.json({ success: true, data: { links: rows.map(({ token, ...row }) => ({ ...row, url: bookingBoardUrl(token), today: today.get(row.id) ?? NOTHING_TODAY })) } })
})

const body = z.object({
  title: z.string().trim().min(1).max(60),
  hostIds: z.array(z.string().min(1).max(64)).max(50),
  columns: z.number().int(),
})

export const POST = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  if (!await ownChairs(auth.orgId, parsed.data.hostIds)) return NextResponse.json({ code: "UNKNOWN_HOST" }, { status: 400 })
  const row = await prisma.bookingBoardLink.create({
    data: {
      organizationId: auth.orgId,
      token: randomBytes(24).toString("base64url"),
      title: parsed.data.title,
      hostIds: parsed.data.hostIds,
      columns: readBoardColumns(parsed.data.columns),
      createdBy: auth.userId,
    },
    select: { id: true, title: true, token: true, hostIds: true, columns: true, createdAt: true },
  })
  const { token, ...rest } = row
  const today = (await boardLinksToday(auth.orgId, [rest])).get(rest.id) ?? NOTHING_TODAY
  return NextResponse.json({ success: true, data: { link: { ...rest, url: bookingBoardUrl(token), today } } }, { status: 201 })
})

export const DELETE = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const id = new URL(req.url).searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  // Revoked, not deleted: a screen that went dark leaves who turned it off.
  const done = await prisma.bookingBoardLink.updateMany({
    where: { id, organizationId: auth.orgId, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  })
  if (!done.count) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  return NextResponse.json({ success: true })
})

/**
 * Change a screen without changing its address.
 *
 * A monitor on a wall has the link typed into it once; making a second link to
 * add one more master is how a screen ends up showing yesterday's set forever
 * (owner, 2026-11-11).
 */
export const PATCH = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = body.extend({ id: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  if (!await ownChairs(auth.orgId, parsed.data.hostIds)) return NextResponse.json({ code: "UNKNOWN_HOST" }, { status: 400 })
  // A revoked screen is not edited back to life: it is gone on purpose.
  const done = await prisma.bookingBoardLink.updateMany({
    where: { id: parsed.data.id, organizationId: auth.orgId, isActive: true },
    data: { title: parsed.data.title, hostIds: parsed.data.hostIds, columns: readBoardColumns(parsed.data.columns) },
  })
  if (!done.count) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  const row = await prisma.bookingBoardLink.findFirstOrThrow({
    where: { id: parsed.data.id, organizationId: auth.orgId },
    select: { id: true, title: true, token: true, hostIds: true, columns: true, createdAt: true },
  })
  const { token, ...rest } = row
  const today = (await boardLinksToday(auth.orgId, [rest])).get(rest.id) ?? NOTHING_TODAY
  return NextResponse.json({ success: true, data: { link: { ...rest, url: bookingBoardUrl(token), today } } })
})
