/**
 * POST /api/v1/dashboard/widgets/validate
 *
 * Validate a `DashboardLayoutPayload` ahead of save. UI calls this on
 * every drop / resize so the user sees feedback before submitting the
 * whole layout. Returns `{ valid: boolean, issues: ValidationIssue[] }`.
 *
 * Part of I2 No-code Dashboard Builder (Phase 2 slice 1).
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { validateLayout, type DashboardLayoutPayload } from "@/lib/dashboard/widgets"

export const POST = withRls(async (req, { orgId }) => {

  let body: { layout?: DashboardLayoutPayload }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.layout) {
    return NextResponse.json({ error: "layout payload required" }, { status: 400 })
  }

  const result = validateLayout(body.layout)
  return NextResponse.json(result)
})
