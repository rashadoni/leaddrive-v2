import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingContext, bookingFilters } from "@/lib/booking/queries"

/** Counts every visible meeting; the selected day's agenda uses cursor pagination. */
export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = bookingFilters.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success || !parsed.data.from || !parsed.data.to) return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
  const f = parsed.data
  const from = new Date(f.from!), to = new Date(f.to!)
  if (to.getTime() - from.getTime() > 43 * 86400_000) return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
  const context = await bookingContext(access)
  const conditions = [Prisma.sql`b."organizationId" = ${access.orgId}`, Prisma.sql`b."startsAt" >= ${from} AND b."startsAt" < ${to}`]
  if (access.hostIds !== null) conditions.push(Prisma.sql`b."hostUserId" IN (${Prisma.join(access.hostIds)})`)
  if (f.host) conditions.push(Prisma.sql`b."hostUserId" = ${f.host}`)
  if (f.page) conditions.push(Prisma.sql`b."bookingPageId" = ${f.page}`)
  if (f.status !== "all") conditions.push(Prisma.sql`b."status" = ${f.status}`)
  if (f.search) {
    if (access.phoneRestricted && f.search.replace(/\D/g, "").length >= 7) conditions.push(Prisma.sql`FALSE`)
    // LIKE metacharacters are escaped: search has the same literal semantics as Prisma contains.
    const pattern = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`
    conditions.push(access.phoneRestricted
      ? Prisma.sql`(b.name ILIKE ${pattern} OR (b.snapshot->>'title' ILIKE ${pattern} OR p.title ILIKE ${pattern}))`
      : Prisma.sql`(b.name ILIKE ${pattern} OR (b.snapshot->>'title' ILIKE ${pattern} OR p.title ILIKE ${pattern}) OR b.phone ILIKE ${pattern} OR b.email ILIKE ${pattern})`)
  }
  const days = await prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
    SELECT to_char(b."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${context.timezone}, 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM bookings b JOIN booking_pages p ON p.id = b."bookingPageId" AND p."organizationId" = b."organizationId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY day ORDER BY day
  `)
  return NextResponse.json({ success: true, data: { days, timezone: context.timezone } }, { headers: { "Cache-Control": "private, no-store" } })
})
