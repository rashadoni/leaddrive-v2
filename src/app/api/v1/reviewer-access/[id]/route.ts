import { NextResponse } from "next/server"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/permissions"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Close a reviewer's access now. The grant keeps its row as the record of
 * what was given; the login is deactivated and every open session of it is
 * revoked on the reviewer's next request (`passwordChangedAt` advances the
 * session fingerprint, src/lib/auth.ts).
 */
export const DELETE = withRlsSessionAuth<RouteContext>(async (_req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const grant = await prisma.reviewerAccessGrant.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, userId: true, revokedAt: true, user: { select: { email: true } } },
  })
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (grant.revokedAt) return NextResponse.json({ success: true, data: { id: grant.id, revokedAt: grant.revokedAt } })

  const now = new Date()
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.reviewerAccessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: now, revokedByUserId: auth.userId },
    })
    await tx.user.update({
      where: { id: grant.userId },
      data: { isActive: false, passwordChangedAt: now },
    })
  })
  await logAudit(auth.orgId, "reviewer_access_revoked", "user", grant.userId, grant.user.email, {
    userId: auth.userId,
    newValue: { revokedAt: now },
  })
  return NextResponse.json({ success: true, data: { id: grant.id, revokedAt: now } })
})
