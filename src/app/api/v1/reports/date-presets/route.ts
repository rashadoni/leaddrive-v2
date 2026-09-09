/**
 * GET /api/v1/reports/date-presets
 *
 * UI-facing catalog of date-range presets supported by the report engine.
 * Frontend uses this to render the "Date range" dropdown in the Report
 * Builder filters UI without hard-coding the list.
 *
 * Returns: `{ presets: [{ key, label }, ...] }`
 *
 * Part of I1 No-code Report Builder (Phase 1 Week 5-7 roadmap).
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { getDateRangePresets } from "@/lib/report-engine"

export const GET = withRls(async (_req, { orgId }) => {
  return NextResponse.json({ presets: getDateRangePresets() })
})
