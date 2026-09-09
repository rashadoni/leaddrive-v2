import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * PATCH / DELETE on a single task template.
 *
 * Permission rules (same as SavedView):
 *   - Owner may always edit/delete.
 *   - Admin/superadmin may edit/delete any template in their org (so a
 *     leaving employee's shared templates can be cleaned up).
 *   - Anyone else: 403.
 *
 * Roadmap #21.
 */

const checklistItemSchema = z.object({
  title: z.string().min(1).max(300),
  sortOrder: z.number().int().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  taskTitle: z.string().min(1).max(300).optional(),
  taskDescription: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDateOffsetDays: z.number().int().min(0).max(3650).optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  relatedType: z.enum(["company", "contact", "deal", "lead", "ticket"]).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  checklist: z.array(checklistItemSchema).optional(),
  isShared: z.boolean().optional(),
})

async function ownerOrAdmin(templateId: string, orgId: string, userId: string, role: string) {
  const template = await prisma.taskTemplate.findFirst({
    where: { id: templateId, organizationId: orgId },
  })
  if (!template) return { template: null, allowed: false }
  const allowed = template.userId === userId || role === "admin" || role === "superadmin"
  return { template, allowed }
}

export const PATCH = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const role = auth.role
  const { id } = await params

  const { template, allowed } = await ownerOrAdmin(id, orgId, userId, role)
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Forbidden — only the template owner or an admin may edit it" }, { status: 403 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Carve out the JSON fields so we can cast them to InputJsonValue
    // separately — Prisma's typed update input doesn't accept
    // Record<string, unknown> directly for JSONB columns.
    const { customFields, checklist, ...rest } = parsed.data
    const data: Prisma.TaskTemplateUpdateInput = {
      ...rest,
      ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
      ...(checklist !== undefined ? { checklist: checklist as Prisma.InputJsonValue } : {}),
    }

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data,
      include: { user: { select: { id: true, name: true } } },
    })
    logAudit(orgId, "update", "task_template", id, updated.name)
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[task-templates PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tasks", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const role = auth.role
  const { id } = await params

  const { template, allowed } = await ownerOrAdmin(id, orgId, userId, role)
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Forbidden — only the template owner or an admin may delete it" }, { status: 403 })

  try {
    await prisma.taskTemplate.delete({ where: { id } })
    logAudit(orgId, "delete", "task_template", id, template.name)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[task-templates DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
