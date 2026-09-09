import type { Role } from "@/lib/permissions"
import { isAdminRole } from "./board-permission"

/**
 * Which division boards can a user SEE, expressed as a set of division IDs
 * (or "all" for admins). LeadDrive has no user↔division membership table, so a
 * user's accessible boards = BoardPermission.canView=true grants ∪ divisions
 * they head, MINUS any division with an explicit canView=false deny (deny beats
 * headship). The GET /tasks scope is then `divisionId IN (these) OR assignee=me
 * OR reporter=me`.
 *
 * DEPARTMENT CASCADE (nested boards): access to a department board cascades to
 * ALL of its child sections — UNLESS a section carries its own explicit
 * canView=false deny (a section-level row overrides the inherited department
 * grant). Because only departments may have children (hierarchy invariant B),
 * one extra query `parentDivisionId IN <accessible ids>` returns exactly the
 * children of the accessible departments — section ids in the set have no
 * children and contribute nothing.
 */

export interface BoardAccessClient {
  boardPermission: {
    findMany(args: {
      where: { organizationId: string; userId: string }
      select: { divisionId: true; canView: true }
    }): Promise<Array<{ divisionId: string; canView: boolean }>>
  }
  division: {
    findMany(args: {
      where: {
        organizationId: string
        headUserId?: string
        parentDivisionId?: { in: string[] }
      }
      select: { id: true }
    }): Promise<Array<{ id: string }>>
  }
}

export type AccessibleDivisions = "all" | string[]

export async function getAccessibleDivisionIds(
  client: BoardAccessClient,
  organizationId: string,
  userId: string,
  role: Role,
): Promise<AccessibleDivisions> {
  if (isAdminRole(role)) return "all"

  const [perms, headed] = await Promise.all([
    client.boardPermission.findMany({
      where: { organizationId, userId },
      select: { divisionId: true, canView: true },
    }),
    client.division.findMany({
      where: { organizationId, headUserId: userId },
      select: { id: true },
    }),
  ])

  // Explicit canView=false denies beat everything else (incl. headship).
  const denied = new Set(perms.filter((p) => !p.canView).map((p) => p.divisionId))
  const ids = new Set<string>()
  // The (userId,divisionId) unique index means a division can't be both granted
  // and denied for one user — but the `!denied` guard is kept as defense-in-depth
  // in case that constraint is ever relaxed.
  for (const p of perms) if (p.canView && !denied.has(p.divisionId)) ids.add(p.divisionId)
  for (const h of headed) if (!denied.has(h.id)) ids.add(h.id)

  // Department cascade: a directly-accessible department grants its child sections.
  // A section's own canView=false deny still wins (section overrides department).
  if (ids.size > 0) {
    const children = await client.division.findMany({
      where: { organizationId, parentDivisionId: { in: [...ids] } },
      select: { id: true },
    })
    for (const c of children) if (!denied.has(c.id)) ids.add(c.id)
  }

  return [...ids]
}
