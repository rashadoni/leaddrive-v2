/**
 * Online booking pages of the organization (Settings → «Onlayn yazılış»).
 *   GET  → { pages, users, linkBase }
 *   POST → create
 */
import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingPageUrl } from "@/lib/booking/book"
import { bookingAccess, bookingHostWhere } from "@/lib/booking/access"
import { bookingPageSchema, slugTaken } from "@/lib/booking/page-input"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const orgId = auth.orgId
  const [pages, users, upcoming] = await Promise.all([
    prisma.bookingPage.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: bookingHostWhere(orgId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.booking.groupBy({
      by: ["bookingPageId"],
      where: { organizationId: orgId, status: "confirmed", startsAt: { gte: new Date() } },
      _count: { _all: true },
    }),
  ])
  return NextResponse.json({
    success: true,
    data: {
      linkBase: bookingPageUrl("").replace(/\/$/, ""),
      users,
      pages: pages.map((page: (typeof pages)[number]) => ({
        ...page,
        url: bookingPageUrl(page.slug),
        upcoming: upcoming.find((row: { bookingPageId: string }) => row.bookingPageId === page.id)?._count._all ?? 0,
      })),
    },
  })
})

export const POST = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = bookingPageSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message, code: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data
  if (await slugTaken(input.slug)) return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
  const hostsOk = await prisma.user.count({ where: bookingHostWhere(auth.orgId, input.hostIds) })
  if (hostsOk !== new Set(input.hostIds).size) return NextResponse.json({ error: "Unknown host", code: "HOSTS_REQUIRED" }, { status: 400 })
  try {
    const page = await prisma.bookingPage.create({
      data: { ...input, weekly: input.weekly as unknown as Prisma.InputJsonValue, organizationId: auth.orgId, createdBy: auth.userId ?? null },
    })
    return NextResponse.json({ success: true, data: page }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
    throw error
  }
})

