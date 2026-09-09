import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"

type CommentLite = { id: string; userId: string | null; comment: string; isInternal: boolean; createdAt: Date }
type AuditLite = {
  id: string
  action: string
  entityName: string | null
  userId: string | null
  oldValue: unknown
  newValue: unknown
  createdAt: Date
}

const updateSchema = z.object({
  // Ticket fields
  subject: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"]).optional(),
  assignedTo: z.string().optional().nullable(),
  source: z.string().max(50).optional().nullable(),
  // Meta fields
  meta: z
    .object({
      complaintType: z.enum(["complaint", "suggestion"]).optional(),
      brand: z.string().max(200).optional().nullable(),
      productionArea: z.string().max(200).optional().nullable(),
      productCategory: z.string().max(200).optional().nullable(),
      complaintObject: z.string().max(300).optional().nullable(),
      complaintObjectDetail: z.string().max(300).optional().nullable(),
      responsibleDepartment: z.string().max(200).optional().nullable(),
      riskLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
      externalRegistryNumber: z.number().int().positive().optional().nullable(),
    })
    .optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: {
        complaintMeta: true,
        comments: { orderBy: { createdAt: "asc" } },
        contact: { select: { id: true, fullName: true, phone: true, email: true } },
      },
    })
    if (!ticket || !ticket.complaintMeta) {
      return NextResponse.json({ error: "Complaint not found" }, { status: 404 })
    }

    const userIds = [...new Set([
      ...ticket.comments.map((c: CommentLite) => c.userId).filter(Boolean),
      ticket.assignedTo,
    ].filter(Boolean))] as string[]
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(
      users.map((u: { id: string; name: string | null; email: string }) => [u.id, u.name || u.email]),
    )

    const audit = await prisma.auditLog.findMany({
      where: { organizationId: orgId, entityType: "complaint", entityId: id },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        action: true,
        entityName: true,
        userId: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
      },
    })
    const auditUserIds = [...new Set(audit.map((a: { userId: string | null }) => a.userId).filter(Boolean))] as string[]
    const auditUsers = auditUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: auditUserIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const auditUserMap = Object.fromEntries(
      auditUsers.map((u: { id: string; name: string | null; email: string }) => [u.id, u.name || u.email]),
    )

    return NextResponse.json({
      success: true,
      data: {
        ...ticket,
        assigneeName: ticket.assignedTo ? userMap[ticket.assignedTo] || null : null,
        comments: ticket.comments.map((c: CommentLite) => ({
          ...c,
          userName: c.userId ? userMap[c.userId] || "Support" : "Система",
        })),
        timeline: audit.map((a: AuditLite) => ({
          id: a.id,
          action: a.action,
          createdAt: a.createdAt,
          actor: a.userId ? auditUserMap[a.userId] || "Support" : "Система",
          oldValue: a.oldValue,
          newValue: a.newValue,
        })),
      },
    })
  } catch (e) {
    console.error("Complaint GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const d = parsed.data

  try {
    const existing = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: { complaintMeta: true },
    })
    if (!existing || !existing.complaintMeta) {
      return NextResponse.json({ error: "Complaint not found" }, { status: 404 })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.ticket.update({
        where: { id },
        data: {
          ...(d.subject !== undefined && { subject: d.subject }),
          ...(d.description !== undefined && { description: d.description }),
          ...(d.priority !== undefined && { priority: d.priority }),
          ...(d.status !== undefined && { status: d.status }),
          ...(d.assignedTo !== undefined && { assignedTo: d.assignedTo || null }),
          ...(d.source !== undefined && { source: d.source || null }),
          ...(d.status === "resolved" && { resolvedAt: new Date() }),
          ...(d.status === "closed" && { closedAt: new Date() }),
        },
      })

      if (d.meta) {
        await tx.complaintMeta.update({
          where: { ticketId: id },
          data: {
            ...(d.meta.complaintType !== undefined && { complaintType: d.meta.complaintType }),
            ...(d.meta.brand !== undefined && { brand: d.meta.brand }),
            ...(d.meta.productionArea !== undefined && { productionArea: d.meta.productionArea }),
            ...(d.meta.productCategory !== undefined && { productCategory: d.meta.productCategory }),
            ...(d.meta.complaintObject !== undefined && { complaintObject: d.meta.complaintObject }),
            ...(d.meta.complaintObjectDetail !== undefined && { complaintObjectDetail: d.meta.complaintObjectDetail }),
            ...(d.meta.responsibleDepartment !== undefined && { responsibleDepartment: d.meta.responsibleDepartment }),
            ...(d.meta.riskLevel !== undefined && { riskLevel: d.meta.riskLevel }),
            ...(d.meta.externalRegistryNumber !== undefined && { externalRegistryNumber: d.meta.externalRegistryNumber }),
          },
        })
      }
    })

    const updated = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: { complaintMeta: true },
    })

    const oldSnapshot: Record<string, unknown> = {
      status: existing.status,
      priority: existing.priority,
      assignedTo: existing.assignedTo,
      source: existing.source,
      ...(existing.complaintMeta
        ? {
            brand: existing.complaintMeta.brand,
            productCategory: existing.complaintMeta.productCategory,
            complaintObject: existing.complaintMeta.complaintObject,
            responsibleDepartment: existing.complaintMeta.responsibleDepartment,
            riskLevel: existing.complaintMeta.riskLevel,
          }
        : {}),
    }
    logAudit(orgId, "update", "complaint", id, existing.subject, {
      oldValue: oldSnapshot,
      newValue: { ...d, ...(d.meta || {}) },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("Complaint PATCH error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      select: { subject: true, complaintMeta: { select: { id: true } } },
    })
    if (!existing || !existing.complaintMeta) {
      return NextResponse.json({ error: "Complaint not found" }, { status: 404 })
    }
    await prisma.ticket.delete({ where: { id } })
    // A complaint IS a ticket — null out tasks linked to it (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "ticket", id)
    logAudit(orgId, "delete", "complaint", id, existing.subject)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("Complaint DELETE error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
