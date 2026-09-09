import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { DEFAULT_EVENT_TYPES } from "@/lib/constants"
import { slugifyConfigName } from "@/lib/tasks/config-type"

/**
 * Org-wide configurable Event types (Bordio "Event types") — the channel/source
 * axis on tasks (914 LINE, SOCIAL MEDIA, …). Mirrors /api/v1/task-types: name is
 * the immutable machine value written to Task.eventType; displayName/color edit
 * freely; validated dynamically (see isValidEventType).
 */

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color must be a #RRGGBB hex").optional(),
  sortOrder: z.number().int().optional(),
})

const reorderSchema = z.array(z.object({ id: z.string(), sortOrder: z.number().int() }))

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const activeOnly = new URL(req.url).searchParams.get("activeOnly") === "true"
  try {
    const types = await prisma.eventType.findMany({
      where: { organizationId: orgId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { sortOrder: "asc" },
    })
    if (types.length === 0) {
      return NextResponse.json({
        success: true,
        data: DEFAULT_EVENT_TYPES.map((t, i) => ({
          id: `default-${t.name}`, organizationId: orgId, isActive: true, ...t, sortOrder: i,
        })),
      })
    }
    return NextResponse.json({ success: true, data: types })
  } catch {
    return NextResponse.json({
      success: true,
      data: DEFAULT_EVENT_TYPES.map((t, i) => ({
        id: `default-${t.name}`, organizationId: orgId, isActive: true, ...t, sortOrder: i,
      })),
    })
  }
})

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const name = slugifyConfigName(parsed.data.displayName)

  try {
    const max = await prisma.eventType.aggregate({
      where: { organizationId: auth.orgId },
      _max: { sortOrder: true },
    })
    const sortOrder = parsed.data.sortOrder ?? (max._max.sortOrder ?? -1) + 1

    const created = await prisma.eventType.create({
      data: {
        organizationId: auth.orgId,
        name,
        displayName: parsed.data.displayName,
        color: parsed.data.color ?? "#6B7280",
        sortOrder,
      },
    })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "An event type with this name already exists" }, { status: 400 })
    }
    console.error("[event-types POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// Bulk reorder: body = [{ id, sortOrder }]. Org-scoped, single transaction.
export const PATCH = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const parsed = reorderSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid reorder data" }, { status: 400 })

  try {
    await prisma.$transaction(
      parsed.data.map((item) =>
        prisma.eventType.updateMany({
          where: { id: item.id, organizationId: auth.orgId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    )
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[event-types PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
