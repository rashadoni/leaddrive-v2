import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { resolveCapabilitiesOverview } from "@/lib/capabilities-overview"

export const GET = withRlsAuth("settings", "read", async (_req, auth) => {
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { plan: true, addons: true, features: true, modules: true, settings: true },
  })
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  const installedAppsCount = await prisma.appInstallation.count({
    where: { organizationId: auth.orgId, uninstalledAt: null },
  })
  return NextResponse.json({ data: resolveCapabilitiesOverview(org, auth, installedAppsCount) }, {
    headers: { "Cache-Control": "private, no-store" },
  })
})
