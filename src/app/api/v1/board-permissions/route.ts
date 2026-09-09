import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import type { Role } from "@/lib/permissions"
import { withRlsAuth } from "@/lib/with-rls"

const FLAG_KEYS = [
  "canView",
  "canEdit",
  "canMoveToTodo",
  "canMoveToInProgress",
  "canMoveToTesting",
  "canMoveToReview",
  "canMoveBack",
  "canCreateTask",
  "canComment",
] as const

const upsertSchema = z.object({
  userId: z.string(),
  divisionId: z.string(),
  canView: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canMoveToTodo: z.boolean().optional(),
  canMoveToInProgress: z.boolean().optional(),
  canMoveToTesting: z.boolean().optional(),
  canMoveToReview: z.boolean().optional(),
  canMoveBack: z.boolean().optional(),
  canCreateTask: z.boolean().optional(),
  canComment: z.boolean().optional(),
})

// Managing per-user board grants is an admin / manager action.
function isBoardAdmin(role: Role) {
  return isAdminRole(role) || role === "manager"
}

/** GET /api/v1/board-permissions?divisionId=&userId= — list grants. */
export const GET = withRlsAuth("tasks", "read", async (req, auth) => {
  if (!isBoardAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const divisionId = sp.get("divisionId") || undefined
  const userId = sp.get("userId") || undefined
  try {
    const permissions = await prisma.boardPermission.findMany({
      where: {
        organizationId: auth.orgId,
        ...(divisionId ? { divisionId } : {}),
        ...(userId ? { userId } : {}),
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    return NextResponse.json({ success: true, data: { permissions } })
  } catch (e) {
    console.error("[board-permissions GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** POST /api/v1/board-permissions — create/update a grant (upsert on user+division). */
export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isBoardAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Codex P0: user AND division must both belong to this org (the DB coherence
  // trigger also enforces this; here we fail fast with a clean 400).
  const [u, d] = await Promise.all([
    prisma.user.findFirst({ where: { id: parsed.data.userId, organizationId: auth.orgId }, select: { id: true } }),
    prisma.division.findFirst({ where: { id: parsed.data.divisionId, organizationId: auth.orgId }, select: { id: true } }),
  ])
  if (!u) return NextResponse.json({ error: "User not found in this organization" }, { status: 400 })
  if (!d) return NextResponse.json({ error: "Division not found in this organization" }, { status: 400 })

  const flags: Record<string, boolean> = {}
  for (const k of FLAG_KEYS) if (parsed.data[k] !== undefined) flags[k] = parsed.data[k] as boolean

  try {
    const perm = await prisma.boardPermission.upsert({
      where: { userId_divisionId: { userId: parsed.data.userId, divisionId: parsed.data.divisionId } },
      create: { organizationId: auth.orgId, userId: parsed.data.userId, divisionId: parsed.data.divisionId, ...flags },
      update: flags,
    })
    logAudit(auth.orgId, "upsert", "board_permission", perm.id, undefined, { newValue: flags })
    return NextResponse.json({ success: true, data: perm })
  } catch (e) {
    console.error("[board-permissions POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** DELETE /api/v1/board-permissions?id= OR ?userId=&divisionId= — revoke a grant. */
export const DELETE = withRlsAuth("tasks", "delete", async (req, auth) => {
  if (!isBoardAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const id = sp.get("id")
  const userId = sp.get("userId")
  const divisionId = sp.get("divisionId")
  try {
    // Idempotent revoke: deleting an already-absent grant still returns 200 so
    // the board member-diff (allSettled) doesn't surface spurious failures for a
    // member who was already removed. But we DO audit-log when a row actually
    // went away — revoking board access is a security-relevant action, mirroring
    // the grant audit in POST above (closes a one-sided audit-trail gap).
    if (id) {
      const { count } = await prisma.boardPermission.deleteMany({ where: { id, organizationId: auth.orgId } })
      if (count > 0) logAudit(auth.orgId, "delete", "board_permission", id, undefined, { oldValue: { id } })
    } else if (userId && divisionId) {
      const { count } = await prisma.boardPermission.deleteMany({ where: { userId, divisionId, organizationId: auth.orgId } })
      if (count > 0) logAudit(auth.orgId, "delete", "board_permission", `${userId}:${divisionId}`, undefined, { oldValue: { userId, divisionId } })
    } else {
      return NextResponse.json({ error: "Provide ?id or ?userId & ?divisionId" }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[board-permissions DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
