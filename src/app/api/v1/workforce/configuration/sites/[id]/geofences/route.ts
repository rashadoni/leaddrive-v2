import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  createWorkforceSiteGeofenceRevision,
  WorkforceSiteGeofenceManagementError,
  WorkforceSiteGeofenceRevisionCreateSchema,
} from "@/lib/workforce/site-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

type RouteContext = { params: Promise<{ id: string }> }

const revisionSelect = {
  id: true,
  siteId: true,
  revision: true,
  kind: true,
  centerLatitude: true,
  centerLongitude: true,
  radiusMeters: true,
  calibrationReference: true,
  definitionHash: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
} as const

/** Read calibrated Workforce circle revisions, never Route customer geofences. */
export const GET = withWorkforceSessionAdminAuth<RouteContext>(async (_req: NextRequest, auth, { params }) => {
  try {
    const { id } = await params
    const revisions = await prisma.workforceSiteGeofenceRevision.findMany({
      where: { organizationId: auth.orgId, siteId: id },
      orderBy: { effectiveFrom: "asc" },
      select: revisionSelect,
    })
    return NextResponse.json({ success: true, data: { revisions } })
  } catch (error) {
    console.error("[workforce/configuration/sites geofences GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce site geofences" }, { status: 500 })
  }
})

/** Schedule the next calibrated circle revision; only server time picks "future". */
export const POST = withWorkforceSessionAdminAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const parsed = WorkforceSiteGeofenceRevisionCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce site geofence" }, { status: 400 })
  }
  try {
    const { id } = await params
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const revision = await createWorkforceSiteGeofenceRevision({
      organizationId: auth.orgId,
      siteId: id,
      createdByUserId: auth.userId,
      revision: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { revision } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceSiteGeofenceManagementError) {
      const status = error.code === "WORKFORCE_SITE_GEOFENCE_SITE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/sites geofences POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce site geofence" }, { status: 500 })
  }
})
