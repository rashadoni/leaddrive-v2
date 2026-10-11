import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { isAgentInRouteScope } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  locationShareLinkAccessFor,
  locationShareLinkNotFound,
  locationShareLinkRateLimited,
  locationShareLinkWriteDenied,
} from "@/lib/mtm/location-share-access"

// One allowance with making a link (../route.ts): the key is the same.
const WRITE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }

/**
 * DELETE /api/v1/mtm/locations/share-links/:id
 *
 * Revokes a link: from this moment it answers nobody. The row is kept and
 * marked — the journal says who revoked what, and that entry has to keep
 * pointing at something.
 *
 * Deliberately not behind the organization's switch. Switching the links off
 * revokes every working link by itself (PUT /api/v1/mtm/settings), so there is
 * normally nothing left to revoke then — but revoking is never the thing that
 * is refused: a row that save somehow missed must not have to wait for the
 * links to be switched on again.
 *
 * A link of another organization, one that never existed, one already revoked
 * and one of an employee outside this manager's scope answer the same 404,
 * and the statement that writes carries the organization and «not revoked»
 * itself: nothing here leans on the row having been found a moment ago.
 */
export const DELETE = withRouteFieldWebRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const orgId = auth.orgId
  try {
    const access = await locationShareLinkAccessFor(auth)
    if (access.kind !== "writer") return locationShareLinkWriteDenied(access)
    if (!checkRateLimit(`mtm-location-share-links-write:${orgId}:${auth.userId}`, WRITE_RATE_LIMIT)) return locationShareLinkRateLimited()
    const { id } = await params
    const link = await prisma.mtmLocationShareLink.findFirst({
      where: { id, organizationId: orgId, revokedAt: null },
      select: { id: true, agentId: true, expiresAt: true },
    })
    if (!link || !isAgentInRouteScope(access.actor, link.agentId)) return locationShareLinkNotFound()

    const revokedAt = new Date()
    const revoked = await prisma.mtmLocationShareLink.updateMany({
      where: { id, organizationId: orgId, revokedAt: null },
      data: { revokedAt, revokedBy: auth.userId },
    })
    // Somebody else revoked it first: there is nothing of ours to record.
    if (revoked.count === 0) return locationShareLinkNotFound()

    await writeMtmAudit({
      organizationId: orgId,
      // The employee the link showed: his managers find the row by him.
      agentId: link.agentId,
      action: "LOCATION_SHARE_LINK_REVOKE",
      entity: "location_share_link",
      entityId: id,
      metadataKind: "location_share_link",
      // Until when it would have worked, and when it was stopped.
      newData: { expiresAt: link.expiresAt.toISOString(), revokedAt: revokedAt.toISOString() },
      req,
    }).catch((error) => console.warn("[MTM/locations/share-links/[id] DELETE] audit failed", error))

    return NextResponse.json({ success: true, data: { id, revokedAt } })
  } catch (e) {
    console.error("[MTM/locations/share-links/[id] DELETE]", e)
    return NextResponse.json({ error: "Failed to revoke the location link", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 })
  }
})
