/**
 * R11 Media — consumption event per-id (slice-2-mini).
 *
 * GET only — table is append-only at DB layer via
 * `media_consumption_events_no_update_trigger`. No PATCH/DELETE.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "media_consumption_events"

export const GET = withRlsAuth("media", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 })
  }

  try {
    const event = await prisma.mediaConsumptionEvent.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!event) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: event.id,
      action: "read",
      metadata: {
        contentId: event.contentId,
        subscriberId: event.subscriberId,
        placementId: event.placementId,
        eventKind: event.eventKind,
      },
    })

    return NextResponse.json({ event })
  } catch (err) {
    console.error("[media-consumption-events/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load event" },
      { status: 500 },
    )
  }
})
