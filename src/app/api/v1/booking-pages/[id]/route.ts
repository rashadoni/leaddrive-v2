/**
 * Update one booking page. Bookings already made keep their time and host.
 *
 * DELETE removes a service that nothing points at — a test page, a draft
 * nobody booked. A service with meetings is never deleted: its name, its
 * length and its price are what those meetings say they were, and a list of
 * past visits that has forgotten what they were for is worse than a service
 * left switched off (owner, 2026-11-12: «вот например ты тестовое создал, как
 * его удалить?»).
 */
import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess, bookingHostWhere } from "@/lib/booking/access"
import { bookingPageSchema, pageAddOnsData, pageHostVariantsData, pagePhotoData, pagePriceData, slugTaken } from "@/lib/booking/page-input"

export const DELETE = withRlsAuth("bookings", "write", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const { id } = await params
  const page = await prisma.bookingPage.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Every meeting counts, not only the ones still ahead: a visit last spring
  // is still a visit, and the service is where its name came from.
  const meetings = await prisma.booking.count({ where: { organizationId: auth.orgId, bookingPageId: id } })
  if (meetings > 0) return NextResponse.json({ code: "PAGE_IN_USE", data: { meetings } }, { status: 409 })
  // Times held for a client are the one thing that may go with it: they are
  // offers of this service, they expire by themselves, and nothing outside
  // the conversation that holds them ever reads one again.
  await prisma.$transaction(async (tx) => {
    await tx.bookingOffer.deleteMany({ where: { organizationId: auth.orgId, bookingPageId: id } })
    await tx.bookingPage.delete({ where: { id } })
  })
  return NextResponse.json({ success: true, data: { id } })
})

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
  // A room this organisation does not have, or has switched off, is not a
  // place a client can be sent to. A room already on the service stays on it
  // even once it is switched off — the meetings it holds are real.
  const wantedResources = new Set(input.resourceIds ?? [])
  if (wantedResources.size) {
    const known = await prisma.bookingResource.count({ where: { organizationId: auth.orgId, id: { in: [...wantedResources] }, isActive: true } })
    if (known !== wantedResources.size) return NextResponse.json({ error: "Unknown resource", code: "RESOURCES_REQUIRED" }, { status: 400 })
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-page:${auth.orgId}:${id}`}))`
      await tx.bookingPage.updateMany({ where: { id, organizationId: auth.orgId }, data: {
        ...input,
        ...(await pagePriceData(auth.orgId, input.price)),
        hostVariants: pageHostVariantsData(input),
        addOns: pageAddOnsData(input),
        photoUrl: pagePhotoData(input),
        // A sum and a share are two answers to one question; the sum wins,
        // and the other column is cleared so no row holds both.
        depositAmount: input.depositAmount ?? null,
        depositPercent: input.depositAmount ? null : (input.depositPercent || null),
        category: input.category || null,
        repeatCycleDays: input.repeatCycleDays ?? null,
        weekly: input.weekly as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      } })
    })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
    throw error
  }
  return NextResponse.json({ success: true })
})
