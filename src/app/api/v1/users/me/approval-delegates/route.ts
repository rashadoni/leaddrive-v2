/**
 * Approval-delegate management — CLM Slice-3a.
 *
 * Self-service: each user manages their own out-of-office (OOO) delegations.
 * All endpoints are org-scoped (session.orgId).
 *
 * GET  /api/v1/users/me/approval-delegates
 *   Returns the caller's active + upcoming delegations (fromUserId = me).
 *
 * POST /api/v1/users/me/approval-delegates
 *   Creates a new delegation.
 *   Body: { toUserId, startDate, endDate, reason? }
 *   Validates:
 *     • toUser is a same-org user (not self)
 *     • endDate > startDate
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

const createSchema = z.object({
  toUserId: z.string().min(1, "toUserId is required"),
  startDate: z.string().datetime({ message: "startDate must be a valid ISO datetime" }),
  endDate: z.string().datetime({ message: "endDate must be a valid ISO datetime" }),
  reason: z.string().max(100).optional(),
})

export const GET = withRlsSessionAuth(async (_req: NextRequest, session) => {
  const { orgId, userId } = session

  try {
    const delegations = await prisma.userApprovalDelegate.findMany({
      where: {
        organizationId: orgId,
        fromUserId: userId,
        isActive: true,
      },
      include: {
        toUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { startDate: "asc" },
    })

    return NextResponse.json({ success: true, data: delegations })
  } catch (e) {
    console.error("[approval-delegates GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsSessionAuth(async (req: NextRequest, session) => {
  const { orgId, userId } = session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { toUserId, startDate, endDate, reason } = parsed.data

  // Business rule: cannot delegate to self
  if (toUserId === userId) {
    return NextResponse.json({ error: "Cannot delegate to yourself" }, { status: 400 })
  }

  const start = new Date(startDate)
  const end = new Date(endDate)

  // Business rule: endDate must be after startDate
  if (end <= start) {
    return NextResponse.json(
      { error: "endDate must be after startDate" },
      { status: 400 },
    )
  }

  try {
    // Validate toUser is a same-org member
    const toUser = await prisma.user.findFirst({
      where: { id: toUserId, organizationId: orgId, isActive: true },
      select: { id: true, name: true, email: true },
    })
    if (!toUser) {
      return NextResponse.json(
        { error: "Delegate user not found in your organization" },
        { status: 400 },
      )
    }

    // FIX 7: Reject if caller already has an ACTIVE delegation whose window overlaps.
    // Overlap condition: existing.startDate < new.endDate AND existing.endDate > new.startDate
    const overlapping = await prisma.userApprovalDelegate.findFirst({
      where: {
        organizationId: orgId,
        fromUserId: userId,
        isActive: true,
        startDate: { lt: end },
        endDate: { gt: start },
      },
      select: { id: true, startDate: true, endDate: true },
    })
    if (overlapping) {
      return NextResponse.json(
        {
          error:
            "An active delegation already exists whose window overlaps the requested period. " +
            "Deactivate the existing delegation first.",
        },
        { status: 409 },
      )
    }

    const delegation = await prisma.userApprovalDelegate.create({
      data: {
        organizationId: orgId,
        fromUserId: userId,
        toUserId,
        startDate: start,
        endDate: end,
        reason: reason ?? null,
        isActive: true,
      },
      include: {
        toUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    })

    return NextResponse.json({ success: true, data: delegation }, { status: 201 })
  } catch (e) {
    console.error("[approval-delegates POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
