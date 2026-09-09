import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { isValidDivisionKey } from "@/lib/tasks/task-key"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"
import { buildCanonicalColumns } from "@/lib/tasks/board-columns"
import { validateDivisionHierarchy, isHierarchyConstraintViolation } from "@/lib/tasks/board-hierarchy"
import { withRlsAuth } from "@/lib/with-rls"

const createDivisionSchema = z.object({
  key: z.string(), // validated via isValidDivisionKey after upper-casing
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  headUserId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  // Nested boards: create as a container department, or as a section under one.
  isDepartment: z.boolean().optional(),
  parentDivisionId: z.string().nullable().optional(),
})

/** GET /api/v1/divisions — list this org's boards (for the board picker). */
export const GET = withRlsAuth("tasks", "read", async (_req, auth) => {
  try {
    // Departmental isolation: a user only sees boards they can access
    // (admin → all; others → BoardPermission.canView grants ∪ boards they head).
    const accessible = await getAccessibleDivisionIds(prisma, auth.orgId, auth.userId, auth.role)
    const divisions = await prisma.division.findMany({
      where: {
        organizationId: auth.orgId,
        isActive: true, // archived boards (soft-deleted via DELETE) drop out of the list
        ...(accessible === "all" ? {} : { id: { in: accessible } }),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        head: { select: { id: true, name: true, avatar: true } },
        boardColumns: { orderBy: { sortOrder: "asc" } }, // board reads these as its visible columns (custom columns)
        _count: { select: { tasks: { where: { deletedAt: null } } } }, // soft-delete: extension doesn't reach relation _count (cf. e5112d83)
      },
    })
    return NextResponse.json({ success: true, data: { divisions } })
  } catch (e) {
    console.error("[divisions GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** POST /api/v1/divisions — create a board. Admin / manager only. */
export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isAdminRole(auth.role) && auth.role !== "manager") {
    return NextResponse.json(
      { error: "Forbidden", message: "Only admins/managers can create boards" },
      { status: 403 },
    )
  }

  const body = await req.json()
  const parsed = createDivisionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const key = parsed.data.key.toUpperCase()
  if (!isValidDivisionKey(key)) {
    return NextResponse.json(
      { error: "Invalid key — expected 1-16 uppercase letters/digits (e.g. KHS)" },
      { status: 400 },
    )
  }

  // Codex P0: the division head must belong to this org (no cross-tenant head).
  if (parsed.data.headUserId) {
    const u = await prisma.user.findFirst({
      where: { id: parsed.data.headUserId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!u) return NextResponse.json({ error: "Head user not found in this organization" }, { status: 400 })
  }

  // Nested-boards invariants (department↔section). divisionId=null → CREATE.
  const isDepartment = parsed.data.isDepartment ?? false
  const parentDivisionId = parsed.data.parentDivisionId ?? null
  const hierarchy = await validateDivisionHierarchy(prisma, {
    divisionId: null,
    organizationId: auth.orgId,
    isDepartment,
    parentDivisionId,
  })
  if (!hierarchy.ok) return NextResponse.json({ error: hierarchy.error }, { status: 400 })

  try {
    const division = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const d = await tx.division.create({
        data: {
          organizationId: auth.orgId,
          key,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          color: parsed.data.color ?? null,
          headUserId: parsed.data.headUserId ?? null,
          sortOrder: parsed.data.sortOrder ?? 0,
          isDepartment,
          parentDivisionId,
        },
      })
      // Seed the default six canonical columns so a new board is first-class in
      // the board_columns model (matches the migration's empty-columns default).
      // Departments are containers (no tasks, rendered as an overview), so they
      // need no Kanban columns.
      if (!isDepartment) {
        await tx.boardColumn.createMany({ data: buildCanonicalColumns(auth.orgId, d.id, []) })
      }
      return d
    })
    logAudit(auth.orgId, "create", "division", division.id, division.name)
    return NextResponse.json({ success: true, data: division }, { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: `Board key "${key}" already exists` }, { status: 400 })
    }
    if (isHierarchyConstraintViolation(e)) {
      return NextResponse.json({ error: "Board hierarchy rule violated (department/section)" }, { status: 400 })
    }
    console.error("[divisions POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
