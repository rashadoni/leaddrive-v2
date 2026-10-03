import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import {
  MACRO_ASSIGNABLE_ROLES,
  actionAssigneeIds,
  allMacroCategories,
  canManageTicketMacros,
  normalizeMacroCategory,
} from "@/lib/ticket-macros/presentation"
import { macroActionsSchema, macroActionSchema } from "@/lib/ticket-macros/schema"
import { supportUxV2CanaryEnabled } from "@/lib/support-ux-rollout"
import { observeSupportUxOperation } from "@/lib/support-ux-observation"
import { withRlsAuth } from "@/lib/with-rls"

const createMacroSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1_000).nullable().optional(),
  category: z.string().transform(normalizeMacroCategory).pipe(z.string().min(1).max(80)).default("general"),
  actions: macroActionsSchema,
  shortcutKey: z.string().regex(/^Alt\+[1-9]$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
}).strict()

async function invalidAssignee(orgId: string, actions: z.infer<typeof macroActionSchema>[]) {
  const ids = actionAssigneeIds(actions)
  if (ids.length === 0) return false
  const count = await prisma.user.count({
    where: {
      organizationId: orgId,
      id: { in: ids },
      role: { in: [...MACRO_ASSIGNABLE_ROLES] },
      isActive: true,
    },
  })
  return count !== ids.length
}

export const GET = withRlsAuth("tickets", "read", (_req, auth) => observeSupportUxOperation(
  { orgId: auth.orgId, operation: "CATEGORY_LIST" }, async (setMode) => {
  try {
    const [macros, organization, agents] = await Promise.all([
      prisma.ticketMacro.findMany({
        where: { organizationId: auth.orgId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true, features: true } }),
      prisma.user.findMany({
        where: {
          organizationId: auth.orgId,
          role: { in: [...MACRO_ASSIGNABLE_ROLES] },
          isActive: true,
        },
        select: { id: true, name: true, role: true, isActive: true, isAvailable: true },
        orderBy: { name: "asc" },
      }),
    ])

    if (organization) setMode(supportUxV2CanaryEnabled(organization.features) ? "database" : "browser")
    return NextResponse.json({
      success: true,
      data: macros,
      categories: allMacroCategories(organization?.settings, macros.map((macro) => macro.category)),
      agents,
      permissions: { canWrite: canManageTicketMacros(auth.role) },
    })
  } catch (error) {
    console.error("[ticket-macros GET]", error)
    return NextResponse.json({ error: "Failed to load ticket macros.", code: "MACRO_LOAD_FAILED" }, { status: 500 })
  }
}))

export const POST = withRlsAuth("tickets", "write", async (req, auth) => {
  if (!canManageTicketMacros(auth.role)) {
    return NextResponse.json({ error: "Forbidden", code: "MACRO_WRITE_FORBIDDEN" }, { status: 403 })
  }

  const parsed = createMacroSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid macro.", code: "MACRO_INVALID" }, { status: 400 })
  }

  try {
    if (await invalidAssignee(auth.orgId, parsed.data.actions)) {
      return NextResponse.json({ error: "An assignee is not available in this organization.", code: "MACRO_ASSIGNEE_INVALID" }, { status: 400 })
    }
    if (parsed.data.shortcutKey) {
      const shortcut = await prisma.ticketMacro.findFirst({
        where: { organizationId: auth.orgId, shortcutKey: parsed.data.shortcutKey },
        select: { id: true },
      })
      if (shortcut) {
        return NextResponse.json({ error: "This shortcut is already assigned.", code: "MACRO_SHORTCUT_CONFLICT" }, { status: 409 })
      }
    }

    const macro = await prisma.ticketMacro.create({
      data: {
        organizationId: auth.orgId,
        createdBy: auth.userId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: macro }, { status: 201 })
  } catch (error) {
    console.error("[ticket-macros POST]", error)
    return NextResponse.json({ error: "Failed to save ticket macro.", code: "MACRO_SAVE_FAILED" }, { status: 500 })
  }
})
