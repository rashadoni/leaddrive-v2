/**
 * Online booking pages of the organization (Settings → «Onlayn yazılış»).
 *   GET  → { pages, users, linkBase, currency }
 *   POST → create
 */
import type { Prisma } from "@prisma/client"
import { anthropicAvailable } from "@/lib/ai/gateway"
import { NextRequest, NextResponse } from "next/server"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { orgHasModule } from "@/lib/api-auth"
import { readClosedDates } from "@/lib/booking/closed-dates"
import { bookingPageUrl } from "@/lib/booking/book"
import { bookingAccess, bookingHostWhere } from "@/lib/booking/access"
import { bookingPageSchema, pageAddOnsData, pageHostVariantsData, pagePhotoData, pagePriceData, slugTaken } from "@/lib/booking/page-input"
import { resolveOrgDefaultCurrency } from "@/lib/org-default-currency"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const orgId = auth.orgId
  const [pages, users, upcoming, booked, currency, aiModule, organization] = await Promise.all([
    prisma.bookingPage.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: bookingHostWhere(orgId), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.booking.groupBy({
      by: ["bookingPageId"],
      where: { organizationId: orgId, status: "confirmed", startsAt: { gte: new Date() } },
      _count: { _all: true },
    }),
    // Every meeting ever made here, cancelled ones included: a service that
    // some visit still names cannot be deleted, only switched off.
    prisma.booking.groupBy({ by: ["bookingPageId"], where: { organizationId: orgId }, _count: { _all: true } }),
    // The symbol the price field shows while it is being typed. The saved row
    // carries its own code (`pagePriceData`), but a service that has no price
    // yet has none to read, and the browser must not guess: DEFAULT_CURRENCY
    // is "USD" in the bundle whatever the server runs on.
    resolveOrgDefaultCurrency(orgId),
    orgHasModule(orgId, "ai"),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ])
  return NextResponse.json({
    success: true,
    data: {
      linkBase: bookingPageUrl("").replace(/\/$/, ""),
      currency,
      /** Days the whole salon is closed — they belong to the organization. */
      closedDates: readClosedDates(organization?.settings),
      // Whether the form may offer to write the description. Both halves are
      // server-side facts: the organisation's module, and whether this host can
      // reach the model at all.
      ai: aiModule && await anthropicAvailable(orgId),
      users,
      pages: pages.map((page: (typeof pages)[number]) => ({
        ...page,
        // Decimal would reach the browser as an object in some serialisers; a
        // string is what the screens read, and what they read back on save.
        price: page.price === null ? null : String(page.price),
        url: bookingPageUrl(page.slug),
        upcoming: upcoming.find((row: { bookingPageId: string }) => row.bookingPageId === page.id)?._count._all ?? 0,
        everBooked: booked.some((row: { bookingPageId: string }) => row.bookingPageId === page.id),
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
  // A room this organisation does not have, or has switched off, is not a
  // place a client can be sent to.
  if (!await resourcesExist(auth.orgId, input.resourceIds)) return NextResponse.json({ error: "Unknown resource", code: "RESOURCES_REQUIRED" }, { status: 400 })
  try {
    const page = await prisma.bookingPage.create({
      data: {
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
        organizationId: auth.orgId,
        createdBy: auth.userId ?? null,
      },
    })
    return NextResponse.json({ success: true, data: page }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return NextResponse.json({ error: "Slug taken", code: "SLUG_TAKEN" }, { status: 409 })
    throw error
  }
})


/** Every id names a room this organisation has, switched on. */
async function resourcesExist(orgId: string, ids: string[] | undefined): Promise<boolean> {
  const wanted = new Set(ids ?? [])
  if (!wanted.size) return true
  const found = await prisma.bookingResource.count({ where: { organizationId: orgId, id: { in: [...wanted] }, isActive: true } })
  return found === wanted.size
}
