import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { supportUxV2CanaryEnabled } from "@/lib/support-ux-rollout"
import { withRlsAuth } from "@/lib/with-rls"

export const dynamic = "force-dynamic"

/**
 * Authenticated tenant projection used by Support clients to select the
 * reversible state contract. Missing, malformed or unreadable state fails
 * closed in the client: only an explicit `enabled: true` activates v2 writes.
 */
export const GET = withRlsAuth("tickets", "read", async (_req, auth) => {
  const organization = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { features: true },
  })

  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }

  return NextResponse.json(
    { success: true, data: { enabled: supportUxV2CanaryEnabled(organization.features) } },
    { headers: { "Cache-Control": "private, no-store" } },
  )
})
