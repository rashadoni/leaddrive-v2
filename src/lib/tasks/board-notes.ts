import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type { Role } from "@/lib/permissions"
import { canEditTasks, canViewBoard, type BoardPermissionFlags } from "@/lib/tasks/board-permission"
import { resolveEffectiveBoardPermission } from "@/lib/tasks/board-hierarchy"

/**
 * «Qeydlər» — a board's notes (Bordio's Notes tool, owner 2026-11-06).
 *
 * Who may do what is the board's own rule, the one its tasks follow: reading
 * needs the board (canViewBoard — admin, a grant on the board or on its
 * department, its head), writing needs the right to edit its tasks
 * (canEditTasks). A manager who can see the board writes too: managers run
 * boards (they create them and hand out access). A board someone cannot see
 * answers 404, the same as a board that does not exist.
 */

export const NOTE_TITLE_MAX = 200
export const NOTE_CONTENT_MAX = 50_000

export const noteCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(NOTE_TITLE_MAX),
  content: z.string().max(NOTE_CONTENT_MAX).default(""),
})

export const noteUpdateSchema = z.strictObject({
  title: z.string().trim().min(1).max(NOTE_TITLE_MAX).optional(),
  content: z.string().max(NOTE_CONTENT_MAX).optional(),
}).refine((value) => value.title !== undefined || value.content !== undefined, "Nothing to change")

type Db = Prisma.TransactionClient | { division: Prisma.TransactionClient["division"]; boardPermission: Prisma.TransactionClient["boardPermission"] }

export interface BoardNoteAccess {
  found: boolean
  canRead: boolean
  canWrite: boolean
}

export async function boardNoteAccess(
  db: Db,
  args: { organizationId: string; userId: string | null | undefined; role: string; divisionId: string },
): Promise<BoardNoteAccess> {
  const { organizationId, userId, role, divisionId } = args
  const division = await db.division.findFirst({
    where: { id: divisionId, organizationId, isActive: true },
    select: { id: true, headUserId: true, parentDivisionId: true, parent: { select: { headUserId: true } } },
  })
  if (!division) return { found: false, canRead: false, canWrite: false }

  const [sectionRow, departmentRow] = userId
    ? await Promise.all([
        db.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId } } }),
        division.parentDivisionId
          ? db.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: division.parentDivisionId } } })
          : Promise.resolve(null),
      ])
    : [null, null]
  const perm = resolveEffectiveBoardPermission(sectionRow as BoardPermissionFlags | null, departmentRow as BoardPermissionFlags | null)
  const isDivisionHead = !!userId && (division.headUserId === userId || division.parent?.headUserId === userId)
  const access = { role: role as Role, perm, isOwnDivision: isDivisionHead, isDivisionHead }

  const canRead = canViewBoard(access)
  return {
    found: canRead,
    canRead,
    canWrite: canRead && (canEditTasks(access) || role === "manager"),
  }
}
