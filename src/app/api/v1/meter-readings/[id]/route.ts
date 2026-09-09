/**
 * R6 Energy & Utilities — meter reading per-id (slice-2-mini).
 *
 * GET only — the underlying table is append-only at the DB layer
 * (`meter_readings_no_update_trigger`). Corrections happen via a new
 * POST with `source: "corrected"` + `supersedesReadingId` reference.
 *
 * No PATCH, no DELETE exposed.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "meter_readings"

export const GET = withRlsAuth("energy-utilities", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing reading id" },
      { status: 400 },
    )
  }

  try {
    const reading = await prisma.meterReading.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!reading) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Reading not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: reading.id,
      action: "read",
      metadata: {
        meteringPointId: reading.meteringPointId,
        source: reading.source,
        quality: reading.quality,
        supersedesReadingId: reading.supersedesReadingId,
      },
    })

    return NextResponse.json({ reading })
  } catch (err) {
    console.error("[meter-readings/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load reading" },
      { status: 500 },
    )
  }
})
