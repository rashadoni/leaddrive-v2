import type { Prisma } from "@prisma/client"

/**
 * Who sees a board's reports (owner, 2026-11-13: «нужно ограничивать доступ к
 * отчётам пользователям. Чтоб только кому доступен он мог видеть»). The reports
 * name every colleague's numbers — closed tasks, workload, overdue — so an
 * admin closes them per person: `User.boardReportsHidden`.
 *
 * One setting, on the person. The admin (and superadmin) always sees them:
 * the flag is something an admin sets, and it must not lock the admin out.
 * Everyone else sees them unless the flag is set — as before the flag existed.
 * It narrows what the board's own access gives; it never opens a board.
 */
export function mayViewBoardReports(role: string, boardReportsHidden: boolean | null | undefined): boolean {
  if (role === "admin" || role === "superadmin") return true
  return !boardReportsHidden
}

/** The same answer for the caller of a request, read from their own row. */
export async function boardReportsOpenFor(
  db: Pick<Prisma.TransactionClient, "user">,
  organizationId: string,
  userId: string | null | undefined,
  role: string,
): Promise<boolean> {
  if (role === "admin" || role === "superadmin") return true
  if (!userId) return true // an API key acts as the organization, not as a person
  const row = await db.user.findFirst({ where: { id: userId, organizationId }, select: { boardReportsHidden: true } })
  return mayViewBoardReports(role, row?.boardReportsHidden)
}
