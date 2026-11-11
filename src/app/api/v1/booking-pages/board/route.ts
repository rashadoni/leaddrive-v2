/**
 * The links that open a screen on the wall (/board/<token>).
 *
 *   GET    → { links: [{ id, title, url, hostIds, columns, createdAt }] }
 *   POST   { title, hostIds, columns } → the link, with its address
 *   DELETE { id } → revoked; the address stops working and the row stays
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
import { readBoardColumns } from "@/lib/booking/board"
import { bookingBoardUrl } from "@/lib/booking/book"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const rows = await prisma.bookingBoardLink.findMany({
    where: { organizationId: auth.orgId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, token: true, hostIds: true, columns: true, createdAt: true },
  })
  return NextResponse.json({ success: true, data: { links: rows.map(({ token, ...row }) => ({ ...row, url: bookingBoardUrl(token) })) } })
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
  // Only this organization's people may become columns: a screen is not a way
  // to read another tenant's day.
  const hosts = parsed.data.hostIds.length
    ? await prisma.user.findMany({ where: { organizationId: auth.orgId, id: { in: parsed.data.hostIds } }, select: { id: true } })
    : []
  if (hosts.length !== parsed.data.hostIds.length) return NextResponse.json({ code: "UNKNOWN_HOST" }, { status: 400 })
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
  return NextResponse.json({ success: true, data: { link: { ...rest, url: bookingBoardUrl(token) } } }, { status: 201 })
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
