/**
 * Who stands as «Tapşırığı verən» (Bordio's «Reporter») on every new task of an
 * organization, unless the person making it picks somebody else.
 *
 * Nazrin, Zeytun's marketing head, 2026-11-18: «meni reporter kimi goymalidir
 * ki men gore bilim… ya da ele etmek olar ki men default butun tasklarda
 * reporter olum umumi admin kimi? her defe meni secmesinler?». Her people set
 * her as the reporter by hand on almost every task they open for themselves,
 * and sometimes forget. Owner, 2026-11-19: «у админа на всех задачах» — one
 * setting of the organization, chosen by its admin, for every new task.
 *
 * The reporter follows the task, so a message on it reaches her
 * (lib/tasks/task-notify.ts). Kept in `organizations.settings`; a person who
 * left (inactive or gone) is not put on anything.
 */
import type { Prisma } from "@prisma/client"

export const DEFAULT_REPORTER_KEY = "taskDefaultReporterId"

/** The id the settings name, or null when none is set. */
export function readDefaultReporterId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
  const value = (settings as Record<string, unknown>)[DEFAULT_REPORTER_KEY]
  return typeof value === "string" && value.trim() ? value : null
}

type Db = Pick<Prisma.TransactionClient, "organization" | "user">

/** The organization's default reporter when that person still works there, else null. */
export async function resolveDefaultReporter(db: Db, organizationId: string): Promise<{ id: string; name: string } | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  const id = readDefaultReporterId(org?.settings)
  if (!id) return null
  const user = await db.user.findFirst({ where: { id, organizationId, isActive: true }, select: { id: true, name: true } })
  return user ?? null
}
