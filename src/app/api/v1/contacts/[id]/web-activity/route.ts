/**
 * C3 (Creatio 10X roadmap) — a contact's website activity for the contact card.
 *
 * GET /api/v1/contacts/[id]/web-activity
 *
 * Returns the contact's stitched web sessions (C2 wrote WebSession.contactId),
 * newest first, each with its actions (pageviews + custom events, oldest
 * first — reading order within a visit). Caps keep the payload card-sized:
 * this is a timeline block, not an export.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const MAX_SESSIONS = 30
const MAX_ACTIONS_PER_SESSION = 50

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // Fail-closed existence check: RLS already scopes rows to the org, so a
  // foreign contact id simply finds nothing → 404, indistinguishable from
  // a deleted contact.
  const contact = await prisma.contact.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 })
  }

  const sessions = await prisma.webSession.findMany({
    where: { organizationId: orgId, contactId: id },
    orderBy: { startedAt: "desc" },
    take: MAX_SESSIONS,
    select: {
      id: true,
      startedAt: true,
      lastSeenAt: true,
      pageViews: true,
      entryUrl: true,
      referrer: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      actions: {
        orderBy: { createdAt: "asc" },
        take: MAX_ACTIONS_PER_SESSION,
        select: { id: true, type: true, name: true, url: true, createdAt: true },
      },
    },
  })

  // One aggregate covers both header numbers: the true session count (also
  // drives `truncated`) and the ALL-sessions page-view sum — summing only the
  // returned page would silently undercount whenever the list is capped.
  const totals = await prisma.webSession.aggregate({
    where: { organizationId: orgId, contactId: id },
    _count: true,
    _sum: { pageViews: true },
  })
  const totalSessions = totals._count
  const totalPageViews = totals._sum.pageViews ?? 0

  return NextResponse.json({
    success: true,
    data: {
      totalSessions,
      totalPageViews,
      truncated: totalSessions > sessions.length,
      sessions: sessions.map((s: (typeof sessions)[number]) => ({
        id: s.id,
        startedAt: s.startedAt,
        lastSeenAt: s.lastSeenAt,
        durationMinutes: Math.max(0, Math.round((s.lastSeenAt.getTime() - s.startedAt.getTime()) / 60000)),
        pageViews: s.pageViews,
        entryUrl: s.entryUrl,
        referrer: s.referrer,
        utmSource: s.utmSource,
        utmMedium: s.utmMedium,
        utmCampaign: s.utmCampaign,
        actions: s.actions,
      })),
    },
  })
})
