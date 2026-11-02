/** Update one booking page. Bookings already made keep their time and host. */
import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess, bookingHostWhere } from "@/lib/booking/access"
import { bookingPageSchema, slugTaken } from "@/lib/booking/page-input"

export const PATCH = withRlsAuth("bookings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const { id } = await params
  const parsed = bookingPageSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message, code: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data
  const existing = await prisma.bookingPage.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (await slugTaken(input.slug, id)) return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
  const hostsOk = await prisma.user.count({ where: bookingHostWhere(auth.orgId, input.hostIds) })
  if (hostsOk !== new Set(input.hostIds).size) return NextResponse.json({ error: "Unknown host", code: "HOSTS_REQUIRED" }, { status: 400 })
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-page:${auth.orgId}:${id}`}))`
      await tx.bookingPage.updateMany({ where: { id, organizationId: auth.orgId }, data: { ...input, weekly: input.weekly as unknown as Prisma.InputJsonValue, version: { increment: 1 } } })
    })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
    throw error
  }
  return NextResponse.json({ success: true })
})
