import { NextResponse } from "next/server"
import { z } from "zod"
import { createCalendarEvent, listCalendarEvents } from "@/lib/google-calendar"
import { withRls } from "@/lib/with-rls"

const createEventSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
})

export const GET = withRls(async (req, { session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get("days") || "7")

  try {
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + days * 86400000).toISOString()
    const events = await listCalendarEvents(session.userId, timeMin, timeMax)

    return NextResponse.json({ success: true, data: events })
  } catch (error: any) {
    if (error.message?.includes("not connected")) {
      return NextResponse.json({ error: "Google Calendar not connected. Please re-authenticate with Google." }, { status: 403 })
    }
    console.error("[Google Calendar] Error:", error)
    return NextResponse.json({ error: "Failed to fetch calendar events" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = createEventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const event = await createCalendarEvent(session.userId, parsed.data)
    return NextResponse.json({ success: true, data: event }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("not connected")) {
      return NextResponse.json({ error: "Google Calendar not connected" }, { status: 403 })
    }
    console.error("[Google Calendar] Error:", error)
    return NextResponse.json({ error: "Failed to create calendar event" }, { status: 500 })
  }
})
