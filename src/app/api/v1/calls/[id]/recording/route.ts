import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { canReadCall } from "@/lib/calls/access"
import { isStationRecording, openStationRecording } from "@/lib/calls/station-recordings"

export const GET = withRls(async (_req: NextRequest, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      recordingUrl: true,
      conversationId: true,
      ticketId: true,
      dealId: true,
      leadId: true,
      companyId: true,
      contactId: true,
      callMode: true,
      userId: true,
    },
  })

  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canReadCall(session.role, call, session.userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!call.recordingUrl) {
    return NextResponse.json({ error: "Recording is not available for this call" }, { status: 404 })
  }

  if (isStationRecording(call.recordingUrl)) {
    // The line's own recording, kept sealed on disk: streamed here, never a
    // link. A reviewer under NDA reads the order, not the voices on it.
    if (session.role === "reviewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const opened = await openStationRecording(orgId, call.id).catch(() => null)
    if (!opened) return NextResponse.json({ error: "Recording is not available for this call" }, { status: 404 })
    return new NextResponse(Readable.toWeb(opened.stream) as ReadableStream, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(opened.size),
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="call-${call.id}.wav"`,
      },
    })
  }

  return NextResponse.redirect(call.recordingUrl)
})
