import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  createWorkforceSite,
  WorkforceSiteCreateSchema,
  WorkforceSiteManagementError,
} from "@/lib/workforce/site-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const siteSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  timezone: true,
  addressLabel: true,
  responsibleTeamId: true,
  status: true,
  createdAt: true,
  archivedAt: true,
} as const

/** Workforce-only site inventory. Route customers/geofences are never queried. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const sites = await prisma.workforceSite.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: siteSelect,
    })
    return NextResponse.json({ success: true, data: { sites } })
  } catch (error) {
    console.error("[workforce/configuration/sites GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce sites" }, { status: 500 })
  }
})

/** Create an active site record only; it does not yet schedule or monitor anyone. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceSiteCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce site" }, { status: 400 })
  }
  try {
    const site = await createWorkforceSite({
      organizationId: auth.orgId,
      createdByUserId: auth.userId,
      site: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { site } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceSiteManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[workforce/configuration/sites POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce site" }, { status: 500 })
  }
})
