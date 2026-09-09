import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Update / delete a single org event type. `name` (the machine value stored in
 * Task.eventType) is IMMUTABLE — renaming edits displayName only. Delete is
 * blocked while tasks still use the value; deactivate (isActive=false) instead.
 * Mirrors /api/v1/task-types/[id].
 */

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color must be a #RRGGBB hex").optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

export const PUT = withRlsAuth("settings", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.eventType.findFirst({ where: { id, organizationId: auth.orgId } })
  if (!existing) return NextResponse.json({ error: "Event type not found" }, { status: 404 })

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const updated = await prisma.eventType.update({ where: { id }, data: parsed.data })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRlsAuth("settings", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.eventType.findFirst({ where: { id, organizationId: auth.orgId } })
  if (!existing) return NextResponse.json({ error: "Event type not found" }, { status: 404 })

  // Block hard-delete while in use; the UI offers Deactivate (PUT isActive=false).
  const inUse = await prisma.task.count({
    where: { organizationId: auth.orgId, eventType: existing.name, deletedAt: null },
  })
  if (inUse > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${inUse} task(s) use this event type. Deactivate it instead.`, taskCount: inUse },
      { status: 400 },
    )
  }

  await prisma.eventType.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
