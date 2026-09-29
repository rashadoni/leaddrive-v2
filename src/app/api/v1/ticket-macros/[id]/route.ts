import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import {
  MACRO_ASSIGNABLE_ROLES,
  actionAssigneeIds,
  canManageTicketMacros,
  normalizeMacroCategory,
} from "@/lib/ticket-macros/presentation"
import { macroActionsSchema } from "@/lib/ticket-macros/schema"
import { withRlsAuth } from "@/lib/with-rls"

const updateMacroSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1_000).nullable().optional(),
  category: z.string().transform(normalizeMacroCategory).pipe(z.string().min(1).max(80)).optional(),
  actions: macroActionsSchema.optional(),
  shortcutKey: z.string().regex(/^Alt\+[1-9]$/).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict()

export const GET = withRlsAuth("tickets", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const macro = await prisma.ticketMacro.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!macro) return NextResponse.json({ error: "Macro not found.", code: "MACRO_NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ success: true, data: macro })
  } catch (error) {
    console.error("[ticket-macros/:id GET]", error)
    return NextResponse.json({ error: "Failed to load ticket macro.", code: "MACRO_LOAD_FAILED" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("tickets", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!canManageTicketMacros(auth.role)) {
    return NextResponse.json({ error: "Forbidden", code: "MACRO_WRITE_FORBIDDEN" }, { status: 403 })
  }
  const { id } = await params
  const parsed = updateMacroSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid macro.", code: "MACRO_INVALID" }, { status: 400 })
  }

  try {
    const existing = await prisma.ticketMacro.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) return NextResponse.json({ error: "Macro not found.", code: "MACRO_NOT_FOUND" }, { status: 404 })

    if (parsed.data.actions) {
      const ids = actionAssigneeIds(parsed.data.actions)
      if (ids.length > 0) {
        const count = await prisma.user.count({
          where: {
            organizationId: auth.orgId,
            id: { in: ids },
            role: { in: [...MACRO_ASSIGNABLE_ROLES] },
            isActive: true,
          },
        })
        if (count !== ids.length) {
          return NextResponse.json({ error: "An assignee is not available in this organization.", code: "MACRO_ASSIGNEE_INVALID" }, { status: 400 })
        }
      }
    }
    if (parsed.data.shortcutKey) {
      const shortcut = await prisma.ticketMacro.findFirst({
        where: { organizationId: auth.orgId, id: { not: id }, shortcutKey: parsed.data.shortcutKey },
        select: { id: true },
      })
      if (shortcut) {
        return NextResponse.json({ error: "This shortcut is already assigned.", code: "MACRO_SHORTCUT_CONFLICT" }, { status: 409 })
      }
    }

    const updated = await prisma.ticketMacro.update({ where: { id }, data: parsed.data })
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("[ticket-macros/:id PUT]", error)
    return NextResponse.json({ error: "Failed to save ticket macro.", code: "MACRO_SAVE_FAILED" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tickets", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!canManageTicketMacros(auth.role)) {
    return NextResponse.json({ error: "Forbidden", code: "MACRO_WRITE_FORBIDDEN" }, { status: 403 })
  }
  const { id } = await params
  try {
    const existing = await prisma.ticketMacro.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: "Macro not found.", code: "MACRO_NOT_FOUND" }, { status: 404 })
    await prisma.ticketMacro.delete({ where: { id } })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error("[ticket-macros/:id DELETE]", error)
    return NextResponse.json({ error: "Failed to delete ticket macro.", code: "MACRO_DELETE_FAILED" }, { status: 500 })
  }
})
