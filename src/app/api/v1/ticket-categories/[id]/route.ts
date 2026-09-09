import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  TICKET_CATEGORY_SCOPES,
  TICKET_PRIORITY_LEVELS,
  normalizeTicketCategorySlug,
} from "@/lib/ticketing/categories"
import {
  TicketingValidationError,
  assertTicketCategoryParent,
  assertTicketCategoryQueue,
  normalizeNullableString,
} from "@/lib/ticketing/category-service"

const updateTicketCategorySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(120).optional().nullable(),
  parentId: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  scope: z.enum(TICKET_CATEGORY_SCOPES).optional(),
  defaultPriority: z.enum(TICKET_PRIORITY_LEVELS).optional().nullable(),
  defaultQueueId: z.string().optional().nullable(),
  isPortalVisible: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const GET = withRlsAuth("tickets", "read", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const category = await prisma.ticketCategory.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, slug: true, isActive: true, sortOrder: true },
        },
        defaultQueue: { select: { id: true, name: true } },
        _count: { select: { children: true, tickets: true } },
      },
    })
    if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true, data: category })
  } catch (e) {
    console.error("[ticket-categories/:id GET]", e)
    return NextResponse.json({ error: "Failed to load ticket category" }, { status: 500 })
  }
})

const updateTicketCategory = withRlsAuth("tickets", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateTicketCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const existing = await prisma.ticketCategory.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updateData: Prisma.TicketCategoryUncheckedUpdateInput = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim()
    if (parsed.data.slug !== undefined && parsed.data.slug !== null) {
      updateData.slug = normalizeTicketCategorySlug(parsed.data.slug)
    }
    if (parsed.data.parentId !== undefined) {
      updateData.parentId = await assertTicketCategoryParent(auth.orgId, parsed.data.parentId, id)
    }
    if (parsed.data.description !== undefined) {
      updateData.description = normalizeNullableString(parsed.data.description)
    }
    if (parsed.data.scope !== undefined) updateData.scope = parsed.data.scope
    if (parsed.data.defaultPriority !== undefined) updateData.defaultPriority = parsed.data.defaultPriority
    if (parsed.data.defaultQueueId !== undefined) {
      updateData.defaultQueueId = await assertTicketCategoryQueue(auth.orgId, parsed.data.defaultQueueId)
    }
    if (parsed.data.isPortalVisible !== undefined) updateData.isPortalVisible = parsed.data.isPortalVisible
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder

    const category = await prisma.ticketCategory.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: category })
  } catch (e) {
    return handleTicketCategoryError(e, "PATCH")
  }
})

export const PATCH = updateTicketCategory
export const PUT = updateTicketCategory

export const DELETE = withRlsAuth("tickets", "delete", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.ticketCategory.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const category = await prisma.ticketCategory.update({
      where: { id },
      data: { isActive: false, isPortalVisible: false },
    })

    return NextResponse.json({ success: true, data: category })
  } catch (e) {
    console.error("[ticket-categories/:id DELETE]", e)
    return NextResponse.json({ error: "Failed to delete ticket category" }, { status: 500 })
  }
})

function handleTicketCategoryError(error: unknown, operation: string): NextResponse {
  if (error instanceof TicketingValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  const err = error as { code?: string }
  if (err.code === "P2002") {
    return NextResponse.json({ error: "Category slug already exists in this organization" }, { status: 409 })
  }

  console.error(`[ticket-categories/:id ${operation}]`, error)
  return NextResponse.json({ error: "Failed to save ticket category" }, { status: 500 })
}
