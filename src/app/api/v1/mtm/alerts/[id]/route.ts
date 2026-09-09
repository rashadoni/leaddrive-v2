import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { AlertUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

export const PATCH = withRouteFieldRlsAuth("write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const raw = await req.json()
    const parsed = parseBody(AlertUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const before = await prisma.mtmAlert.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, type: true, isResolved: true, agentId: true },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const data: any = {
      isResolved: body.isResolved,
      resolvedAt: body.isResolved ? new Date() : null,
      resolvedBy: body.resolvedBy ?? null,
    }

    const updated = await prisma.mtmAlert.updateMany({
      where: { id, organizationId: orgId },
      data,
    })
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: before.agentId,
      action: body.isResolved ? "ALERT_RESOLVE" : "ALERT_REOPEN",
      entity: "alert",
      entityId: id,
      metadataKind: body.isResolved ? "alert_resolve" : "alert_reopen",
      oldData: { isResolved: before.isResolved },
      newData: { isResolved: body.isResolved, resolvedBy: body.resolvedBy, alertType: before.type },
      req,
    }).catch((e) => console.warn("[MTM/alerts/[id] PATCH] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRouteFieldRlsAuth("delete", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const before = await prisma.mtmAlert.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, type: true, title: true, agentId: true },
    })
    const deleted = await prisma.mtmAlert.deleteMany({ where: { id, organizationId: orgId } })
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: before?.agentId,
      action: "ALERT_DELETE",
      entity: "alert",
      entityId: id,
      metadataKind: "alert_delete",
      oldData: before,
      req,
    }).catch((e) => console.warn("[MTM/alerts/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to delete" }, { status: 400 })
  }
})
