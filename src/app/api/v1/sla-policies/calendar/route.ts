import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { currentSlaCalendarSource } from "@/lib/ticketing/sla-calendar-policy"
import { SlaCalendarError } from "@/lib/ticketing/sla-business-calendar"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    return NextResponse.json({ success: true, data: await currentSlaCalendarSource(prisma, orgId) })
  } catch (error) {
    if (error instanceof SlaCalendarError) return NextResponse.json({ error: "Configure a valid organization-wide work calendar first.", code: error.code }, { status: 409 })
    return NextResponse.json({ error: "Calendar unavailable." }, { status: 500 })
  }
})
