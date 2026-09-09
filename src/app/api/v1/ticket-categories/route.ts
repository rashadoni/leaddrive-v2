import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  TICKET_CATEGORY_SCOPES,
  TICKET_PRIORITY_LEVELS,
  inferTicketCategoryScope,
  normalizeTicketCategorySlug,
  type TicketCategoryScope,
} from "@/lib/ticketing/categories"
import {
  TicketingValidationError,
  assertTicketCategoryParent,
  assertTicketCategoryQueue,
  buildTicketCategoryTree,
  normalizeNullableString,
} from "@/lib/ticketing/category-service"

const createTicketCategorySchema = z.object({
  name: z.string().min(1).max(120),
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

export const GET = withRlsAuth("tickets", "read", async (req: NextRequest, auth) => {
  const { searchParams } = new URL(req.url)
  const search = normalizeNullableString(searchParams.get("search"))
  const includeInactive = searchParams.get("includeInactive") === "true"
  const flatOnly = searchParams.get("flat") === "true"
  const scope = parseScope(searchParams.get("scope"))

  try {
    const where: Prisma.TicketCategoryWhereInput = { organizationId: auth.orgId }
    const andFilters: Prisma.TicketCategoryWhereInput[] = []

    if (!includeInactive) where.isActive = true
    if (scope) {
      andFilters.push(scope === "both" ? { scope: "both" } : { OR: [{ scope }, { scope: "both" }] })
    }
    if (search) {
      andFilters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { slug: { contains: normalizeTicketCategorySlug(search), mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      })
    }
    if (andFilters.length > 0) where.AND = andFilters

    const categories = await prisma.ticketCategory.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        defaultQueue: { select: { id: true, name: true } },
        _count: { select: { children: true, tickets: true } },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        categories,
        tree: flatOnly ? [] : buildTicketCategoryTree(categories),
        total: categories.length,
      },
    })
  } catch (e) {
    console.error("[ticket-categories GET]", e)
    return NextResponse.json({ error: "Failed to load ticket categories" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tickets", "write", async (req: NextRequest, auth) => {
  const body = await req.json()
  const parsed = createTicketCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const parentId = await assertTicketCategoryParent(auth.orgId, parsed.data.parentId)
    const defaultQueueId = await assertTicketCategoryQueue(auth.orgId, parsed.data.defaultQueueId)
    const slug = normalizeTicketCategorySlug(parsed.data.slug || parsed.data.name)
    const scope = parsed.data.scope || inferTicketCategoryScope(slug)

    const category = await prisma.ticketCategory.create({
      data: {
        organizationId: auth.orgId,
        parentId,
        name: parsed.data.name.trim(),
        slug,
        description: normalizeNullableString(parsed.data.description),
        scope,
        defaultPriority: parsed.data.defaultPriority ?? null,
        defaultQueueId,
        isPortalVisible: parsed.data.isPortalVisible ?? true,
        isActive: parsed.data.isActive ?? true,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    })

    return NextResponse.json({ success: true, data: category }, { status: 201 })
  } catch (e) {
    return handleTicketCategoryError(e, "POST")
  }
})

function parseScope(value: string | null): TicketCategoryScope | null {
  return TICKET_CATEGORY_SCOPES.includes(value as TicketCategoryScope)
    ? (value as TicketCategoryScope)
    : null
}

function handleTicketCategoryError(error: unknown, operation: string): NextResponse {
  if (error instanceof TicketingValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  const err = error as { code?: string }
  if (err.code === "P2002") {
    return NextResponse.json({ error: "Category slug already exists in this organization" }, { status: 409 })
  }

  console.error(`[ticket-categories ${operation}]`, error)
  return NextResponse.json({ error: "Failed to save ticket category" }, { status: 500 })
}
