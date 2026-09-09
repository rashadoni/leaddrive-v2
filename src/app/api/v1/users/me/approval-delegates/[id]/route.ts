/**
 * Single approval-delegate management — CLM Slice-3a.
 *
 * DELETE /api/v1/users/me/approval-delegates/:id
 *   Soft-deactivates the delegation (sets isActive=false).
 *   Only the owner (fromUserId = me) may deactivate their own delegations.
 *   Org-scoped.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

export const DELETE = withRlsSessionAuth(async (_req, session, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = session
  const { id } = await params

  try {
    // Verify ownership before deactivating
    const delegation = await prisma.userApprovalDelegate.findFirst({
      where: { id, organizationId: orgId, fromUserId: userId },
    })
    if (!delegation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (!delegation.isActive) {
      // Already deactivated — idempotent 200
      return NextResponse.json({ success: true, data: { id, isActive: false } })
    }

    await prisma.userApprovalDelegate.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true, data: { id, isActive: false } })
  } catch (e) {
    console.error("[approval-delegates DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
