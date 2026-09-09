import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * CRUD for user-defined task templates — Roadmap #21.
 *
 * GET    — list templates visible to the caller (own + shared org-wide)
 * POST   — create a template for the caller
 * PATCH  — handled by [id]/route.ts
 * DELETE — handled by [id]/route.ts
 *
 * Visibility rules mirror SavedView:
 *   - `isShared=true` → visible to everyone in the org
 *   - `isShared=false` → visible only to the creator
 *
 * `customFields` is a free-form `Record<fieldName, value>` and `checklist`
 * is `Array<{title: string, sortOrder?: number}>` — the consuming task
 * form interprets them at instantiation time.
 */

const checklistItemSchema = z.object({
  title: z.string().min(1).max(300),
  sortOrder: z.number().int().optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  taskTitle: z.string().min(1).max(300),
  taskDescription: z.string().max(5000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDateOffsetDays: z.number().int().min(0).max(3650).optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  relatedType: z.enum(["company", "contact", "deal", "lead", "ticket"]).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  checklist: z.array(checklistItemSchema).default([]),
  isShared: z.boolean().default(false),
})

export const GET = withRlsAuth("tasks", "read", async (_req, auth) => {
  const orgId = auth.orgId
  const userId = auth.userId

  try {
    const templates = await prisma.taskTemplate.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { userId },
          { isShared: true },
        ],
      },
      orderBy: [
        { usageCount: "desc" },
        { name: "asc" },
      ],
      include: {
        user: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ success: true, data: templates })
  } catch (e) {
    console.error("[task-templates GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  const orgId = auth.orgId
  const userId = auth.userId

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const template = await prisma.taskTemplate.create({
      data: {
        organizationId: orgId,
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        taskTitle: parsed.data.taskTitle,
        taskDescription: parsed.data.taskDescription,
        priority: parsed.data.priority,
        dueDateOffsetDays: parsed.data.dueDateOffsetDays,
        assignedTo: parsed.data.assignedTo,
        relatedType: parsed.data.relatedType,
        customFields: parsed.data.customFields as Prisma.InputJsonValue,
        checklist: parsed.data.checklist as Prisma.InputJsonValue,
        isShared: parsed.data.isShared,
      },
      include: { user: { select: { id: true, name: true } } },
    })

    logAudit(orgId, "create", "task_template", template.id, template.name)
    return NextResponse.json({ success: true, data: template }, { status: 201 })
  } catch (e) {
    console.error("[task-templates POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
