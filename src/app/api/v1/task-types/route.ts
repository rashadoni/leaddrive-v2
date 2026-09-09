import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { DEFAULT_TASK_TYPES } from "@/lib/constants"
import { slugifyConfigName } from "@/lib/tasks/config-type"
import { withRls, withRlsAuth } from "@/lib/with-rls"

/**
 * Org-wide configurable Task types (Bordio-style "Task types").
 *
 * Task.type stays a String, validated dynamically against an active TaskType.name
 * (same canonical-string + config-table shape as Task.status + board_columns).
 * `name` is the immutable machine value written to Task.type; `displayName`/`color`
 * are freely editable. Mirrors the pipeline-stages CRUD/auth conventions.
 */

const createSchema = z.object({
  // The machine name (Task.type value) is ALWAYS derived from displayName, never
  // accepted from the client, so it stays a predictable, immutable slug.
  displayName: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color must be a #RRGGBB hex").optional(),
  sortOrder: z.number().int().optional(),
})

const reorderSchema = z.array(z.object({ id: z.string(), sortOrder: z.number().int() }))

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const activeOnly = new URL(req.url).searchParams.get("activeOnly") === "true"
  try {
    const types = await prisma.taskType.findMany({
      where: { organizationId: orgId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: { sortOrder: "asc" },
    })
    // A brand-new org (pre-seed) or a transient empty read falls back to the
    // legacy 5 so board dropdowns / card rendering never break.
    if (types.length === 0) {
      return NextResponse.json({
        success: true,
        data: DEFAULT_TASK_TYPES.map((t, i) => ({
          id: `default-${t.name}`, organizationId: orgId, isActive: true, ...t, sortOrder: i,
        })),
      })
    }
    return NextResponse.json({ success: true, data: types })
  } catch {
    return NextResponse.json({
      success: true,
      data: DEFAULT_TASK_TYPES.map((t, i) => ({
        id: `default-${t.name}`, organizationId: orgId, isActive: true, ...t, sortOrder: i,
      })),
    })
  }
})

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const name = slugifyConfigName(parsed.data.displayName)

  try {
    // Place new types at the end by default.
    const max = await prisma.taskType.aggregate({
      where: { organizationId: auth.orgId },
      _max: { sortOrder: true },
    })
    const sortOrder = parsed.data.sortOrder ?? (max._max.sortOrder ?? -1) + 1

    const created = await prisma.taskType.create({
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
      return NextResponse.json({ error: "A task type with this name already exists" }, { status: 400 })
    }
    console.error("[task-types POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// Bulk reorder: body = [{ id, sortOrder }]. Org-scoped, single transaction.
export const PATCH = withRlsAuth("settings", "write", async (req, auth) => {
  const parsed = reorderSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid reorder data" }, { status: 400 })

  try {
    await prisma.$transaction(
      parsed.data.map((item) =>
        prisma.taskType.updateMany({
          where: { id: item.id, organizationId: auth.orgId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    )
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[task-types PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
