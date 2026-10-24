import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { BOOKING_ROLES, bookingAccess } from "@/lib/booking/access"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const [users, grants] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: auth.orgId, isActive: true, role: { in: [...BOOKING_ROLES] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.bookingCoordinatorGrant.findMany({ where: { organizationId: auth.orgId }, select: { coordinatorUserId: true, hostUserId: true, canManage: true } }),
  ])
  return NextResponse.json({ success: true, data: { users, grants } }, { headers: { "Cache-Control": "private, no-store" } })
})

const input = z.object({ coordinatorUserId: z.string().min(1).max(64), hostIds: z.array(z.string().min(1).max(64)).max(100), canManage: z.boolean() }).strict()

export const PUT = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const { coordinatorUserId, canManage } = parsed.data
  const hostIds = [...new Set(parsed.data.hostIds)].filter((id) => id !== coordinatorUserId)
  const ids = [...new Set([coordinatorUserId, ...hostIds])]
  const count = await prisma.user.count({ where: { organizationId: auth.orgId, id: { in: ids }, isActive: true, role: { in: [...BOOKING_ROLES] } } })
  if (count !== ids.length) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-grants:${auth.orgId}:${coordinatorUserId}`}))`
    await tx.bookingCoordinatorGrant.deleteMany({ where: { organizationId: auth.orgId, coordinatorUserId } })
    if (hostIds.length) await tx.bookingCoordinatorGrant.createMany({ data: hostIds.map((hostUserId) => ({ organizationId: auth.orgId, coordinatorUserId, hostUserId, canManage, createdBy: auth.userId! })) })
    await tx.auditLog.create({ data: { organizationId: auth.orgId, userId: auth.userId, action: "update", entityType: "booking_coordinator", entityId: coordinatorUserId, newValue: { hostIds, canManage } } })
  })
  return NextResponse.json({ success: true })
})
