/**
 * Times a WhatsApp client chose that the salon's own rules send to a person
 * (src/lib/booking/whatsapp-rules.ts).
 *   GET  → { requests: [...] } — oldest first, the queue to work through
 *   POST { id, approve } → confirm the booking, or let the time go
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { reviewPendingOffer } from "@/lib/booking/whatsapp-agent"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const pending = await prisma.bookingOffer.findMany({
    where: {
      organizationId: auth.orgId, status: "pending",
      // A request for a time that has already passed is not a decision any more.
      startsAt: { gt: new Date() },
      // A coordinator sees the masters they may act for, an administrator all.
      ...(access.writableHostIds === null ? {} : { hostUserId: { in: access.writableHostIds } }),
    },
    orderBy: { startsAt: "asc" },
    take: 50,
    select: { id: true, bookingPageId: true, hostUserId: true, startsAt: true, endsAt: true, reviewReason: true, createdAt: true, request: true, conversationId: true },
  })
  const pageIds = [...new Set(pending.map((offer) => offer.bookingPageId))]
  const hostIds = [...new Set(pending.map((offer) => offer.hostUserId))]
  const [pages, hosts, clients] = await Promise.all([
    pageIds.length ? prisma.bookingPage.findMany({ where: { organizationId: auth.orgId, id: { in: pageIds } }, select: { id: true, title: true, durationMinutes: true, price: true, priceCurrency: true } }) : [],
    hostIds.length ? prisma.user.findMany({ where: { organizationId: auth.orgId, id: { in: hostIds } }, select: { id: true, name: true } }) : [],
    // The client's number lives on their messages, not on the held time.
    pending.length ? prisma.channelMessage.findMany({
      where: { organizationId: auth.orgId, conversationId: { in: [...new Set(pending.map((offer) => offer.conversationId))] }, direction: "inbound", channelType: "whatsapp" },
      orderBy: { createdAt: "desc" },
      select: { conversationId: true, from: true, metadata: true },
    }) : [],
  ])
  const clientOf = (conversationId: string) => {
    const message = clients.find((row: (typeof clients)[number]) => row.conversationId === conversationId)
    const metadata = message?.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : null
    return { name: (message?.from ?? "").trim(), phone: typeof metadata?.waPhone === "string" ? `+${metadata.waPhone}` : null }
  }
  return NextResponse.json({
    success: true,
    data: {
      requests: pending.map((offer) => {
        const page = pages.find((item: (typeof pages)[number]) => item.id === offer.bookingPageId)
        const request = offer.request && typeof offer.request === "object" && !Array.isArray(offer.request) ? offer.request as Record<string, unknown> : {}
        return {
          id: offer.id,
          startsAt: offer.startsAt.toISOString(),
          endsAt: offer.endsAt.toISOString(),
          createdAt: offer.createdAt.toISOString(),
          reason: offer.reviewReason,
          service: page ? { title: page.title, durationMinutes: page.durationMinutes, price: page.price === null ? null : String(page.price), priceCurrency: page.priceCurrency } : null,
          hostName: hosts.find((host: (typeof hosts)[number]) => host.id === offer.hostUserId)?.name ?? null,
          client: clientOf(offer.conversationId),
          asked: typeof request.text === "string" ? request.text : "",
        }
      }),
    },
  }, { headers: { "Cache-Control": "private, no-store" } })
})

const body = z.object({ id: z.string().min(1).max(64), approve: z.boolean() })

export const POST = withRlsAuth("bookings", "write", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID" }, { status: 400 })
  // Confirming books a meeting for a master: the same permission as booking
  // one by hand, not merely the right to see the queue.
  const offer = await prisma.bookingOffer.findFirst({ where: { id: parsed.data.id, organizationId: auth.orgId, status: "pending" }, select: { hostUserId: true } })
  if (!offer) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  if (access.writableHostIds !== null && !access.writableHostIds.includes(offer.hostUserId)) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  }
  const outcome = await reviewPendingOffer({ organizationId: auth.orgId, offerId: parsed.data.id, approve: parsed.data.approve, userId: auth.userId })
  const status = outcome === "not_pending" ? 404 : outcome === "taken" ? 409 : 200
  return NextResponse.json({ success: status === 200, data: { outcome } }, { status })
})
