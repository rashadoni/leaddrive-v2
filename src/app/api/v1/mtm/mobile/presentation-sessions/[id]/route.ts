import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import {
  boundedActiveDurationSeconds,
  normalizeViewedPages,
  PresentationSessionProgressSchema,
} from "@/lib/mtm/presentation-session"
import { withMobileRls } from "@/lib/with-mobile-rls"

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  const parsed = PresentationSessionProgressSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid presentation progress",
      code: "MTM_PRESENTATION_PROGRESS_INVALID",
      details: parsed.error.flatten(),
    }, { status: 400 })
  }

  const { id } = await params
  try {
    const session = await prisma.mtmPresentationSession.findFirst({
      where: { id, organizationId: auth.orgId, agentId: auth.agentId },
    })
    if (!session) {
      return NextResponse.json({ error: "Session not found", code: "MTM_PRESENTATION_SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (session.closedAt) {
      return NextResponse.json({ success: true, data: session, idempotent: true })
    }

    const lastViewedAt = new Date(parsed.data.lastViewedAt)
    const closedAt = parsed.data.closedAt ? new Date(parsed.data.closedAt) : null
    const nowWithTolerance = Date.now() + 5 * 60 * 1000
    if (
      lastViewedAt < session.openedAt ||
      lastViewedAt.getTime() > nowWithTolerance ||
      (closedAt && (closedAt < lastViewedAt || closedAt.getTime() > nowWithTolerance))
    ) {
      return NextResponse.json({
        error: "Presentation timeline is invalid",
        code: "MTM_PRESENTATION_TIMELINE_INVALID",
      }, { status: 422 })
    }

    const invalidEvent = parsed.data.pageEvents.some((event) => {
      const viewedAt = new Date(event.viewedAt)
      return viewedAt < session.openedAt || viewedAt > lastViewedAt
    })
    if (invalidEvent) {
      return NextResponse.json({
        error: "Page event is outside the presentation timeline",
        code: "MTM_PRESENTATION_PAGE_EVENT_INVALID",
      }, { status: 422 })
    }

    const pagesViewed = normalizeViewedPages([
      ...parsed.data.pagesViewed,
      ...(parsed.data.lastPage ? [parsed.data.lastPage] : []),
    ])
    const activeDurationSeconds = boundedActiveDurationSeconds({
      openedAt: session.openedAt,
      lastViewedAt,
      requestedSeconds: parsed.data.activeDurationSeconds,
    })

    const updated = await prisma.mtmPresentationSession.update({
      where: { id: session.id },
      data: {
        lastViewedAt,
        closedAt,
        activeDurationSeconds,
        pageCount: parsed.data.pageCount ?? session.pageCount,
        lastPage: parsed.data.lastPage ?? session.lastPage,
        pagesViewed,
        pageEvents: parsed.data.pageEvents,
        closeLat: closedAt ? parsed.data.closeLocation?.latitude ?? null : session.closeLat,
        closeLng: closedAt ? parsed.data.closeLocation?.longitude ?? null : session.closeLng,
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("[MTM/mobile/presentation-sessions/[id] PATCH]", error)
    return NextResponse.json({
      error: "Failed to save presentation progress",
      code: "MTM_PRESENTATION_SESSION_UPDATE_FAILED",
    }, { status: 500 })
  }
})
