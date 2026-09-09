import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { validateDivisionHierarchy, isHierarchyConstraintViolation } from "@/lib/tasks/board-hierarchy"
import type { Role } from "@/lib/permissions"
import { withRlsAuth } from "@/lib/with-rls"

// Board admin = the roles allowed to create/edit/archive boards + manage access.
function isBoardAdmin(role: Role) {
  return isAdminRole(role) || role === "manager"
}

// `key` is intentionally NOT editable — it is the taskKey prefix (KHS-NN) and
// changing it would orphan every existing task's key. Edit the rest.
const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  headUserId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  // per-board SLA cycle-time target in calendar days (Board Reports #14). null clears
  // it → the SLA report falls back to the global default.
  slaTargetDays: z.number().int().min(1).max(365).nullable().optional(),
  // Nested boards: convert to/from a department, or (re)assign the parent department.
  isDepartment: z.boolean().optional(),
  parentDivisionId: z.string().nullable().optional(),
})

/** PATCH /api/v1/divisions/[id] — edit a board (admin/manager). */
export const PATCH = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isBoardAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins/managers can edit boards" }, { status: 403 })
  }
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Org-scope: the board must belong to this org before we touch it.
  const existing = await prisma.division.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, isDepartment: true, parentDivisionId: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Codex P0 parity: a head reassignment must stay in-org (no cross-tenant head).
  if (parsed.data.headUserId) {
    const u = await prisma.user.findFirst({ where: { id: parsed.data.headUserId, organizationId: auth.orgId }, select: { id: true } })
    if (!u) return NextResponse.json({ error: "Head user not found in this organization" }, { status: 400 })
  }

  // Nested-boards invariants — validate the state the row will END UP with, so a
  // patch touching only one of {isDepartment, parentDivisionId} is checked against
  // the other's stored value (cf. the related-entity "ends up with" pattern below).
  if (parsed.data.isDepartment !== undefined || parsed.data.parentDivisionId !== undefined) {
    const hierarchy = await validateDivisionHierarchy(prisma, {
      divisionId: id,
      organizationId: auth.orgId,
      isDepartment: parsed.data.isDepartment ?? existing.isDepartment,
      parentDivisionId:
        parsed.data.parentDivisionId !== undefined
          ? parsed.data.parentDivisionId
          : existing.parentDivisionId,
    })
    if (!hierarchy.ok) return NextResponse.json({ error: hierarchy.error }, { status: 400 })
  }

  try {
    // Columns are no longer edited here — the board editor uses the dedicated
    // PUT /api/v1/divisions/[id]/columns route. This PATCH covers name / color /
    // description / head / sortOrder / archive only.
    const division = await prisma.division.update({ where: { id }, data: { ...parsed.data } })
    logAudit(auth.orgId, "update", "division", division.id, division.name, { newValue: parsed.data })
    return NextResponse.json({ success: true, data: division })
  } catch (e) {
    if (isHierarchyConstraintViolation(e)) {
      return NextResponse.json({ error: "Board hierarchy rule violated (department/section)" }, { status: 400 })
    }
    console.error("[divisions PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * DELETE /api/v1/divisions/[id] — soft-archive a board (admin/manager).
 * Soft (isActive=false) rather than a hard delete: the board drops out of the
 * list (GET filters isActive=true) but its tasks + history survive. Tasks keep
 * their divisionId, so they stay isolated to the (now-archived) board's members.
 *
 * Archiving a DEPARTMENT also detaches its child sections (parentDivisionId=NULL)
 * so they survive as standalone boards rather than hanging under a hidden parent.
 * The FK's onDelete: SetNull only fires on a HARD row delete (e.g. org cascade);
 * a soft-archive never triggers it, so we detach explicitly here.
 */
export const DELETE = withRlsAuth("tasks", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isBoardAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins/managers can archive boards" }, { status: 403 })
  }
  const { id } = await params
  try {
    // updateMany with the org filter is the org-scope guard (no cross-tenant archive).
    const count = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const archived = await tx.division.updateMany({ where: { id, organizationId: auth.orgId }, data: { isActive: false } })
      if (archived.count === 0) return 0
      // Detach child sections (no-op for a non-department — invariant (B) means it
      // has none). They become standalone active boards, not orphans of a hidden parent.
      await tx.division.updateMany({
        where: { organizationId: auth.orgId, parentDivisionId: id },
        data: { parentDivisionId: null },
      })
      return archived.count
    })
    if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    logAudit(auth.orgId, "archive", "division", id)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[divisions DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
