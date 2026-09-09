import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceHrmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const DELETE = withWorkforceHrmRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({
      error: "Forbidden",
      code: "MTM_CALENDAR_SCOPE_DENIED",
    }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.mtmWorkCalendarDay.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const deletedAt = new Date()
  const result = await prisma.mtmWorkCalendarDay.updateMany({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    data: { deletedAt, updatedBy: auth.userId || null },
  })
  if (result.count !== 1) {
    return NextResponse.json({
      error: "Calendar day changed concurrently",
      code: "MTM_CALENDAR_CONFLICT",
    }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: null,
    action: "WORK_CALENDAR_DELETE",
    entity: "work_calendar_day",
    entityId: id,
    metadataKind: "work_calendar_day",
    oldData: existing,
    newData: { deletedAt },
    req,
  }).catch((error) => console.warn("[MTM/work-calendar DELETE] audit failed", error))

  return NextResponse.json({ success: true })
})
