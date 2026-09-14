import type { Prisma } from "@prisma/client"

/**
 * «Tarixsiz» — open tasks that have no due date.
 *
 * Prod 2026-09-14: the web said Anar Mammadov had three tasks waiting
 * («Gözləyir: 3» — Tapşırıq 6/7/8 from June, no customer, no due date) while
 * his phone said there was nothing to do. Neither side had a rule that hid
 * them: the phone counts every PENDING/OVERDUE task it receives as "to do".
 * Both lists sort by due date with undated rows LAST, so the three sat on the
 * last row of page 3 on the web, and the phone — which calls the same list
 * without a limit, i.e. the default 50 — most likely never received them.
 *
 * The web therefore does not redefine "open"; it lifts undated open tasks
 * into their own group above the paginated list, so a count and the rows it
 * counts are on the same screen. Nothing is deleted or re-dated.
 *
 * Opt-in (`?undated=group`) and web-only: the legacy phone contract and the
 * forms that read this endpoint for their filters keep the exact list they had.
 */
export const MTM_TASK_OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "OVERDUE"] as const

/** How many undated open tasks the group shows at most. */
export const MTM_UNDATED_TASK_GROUP_LIMIT = 50

export function mtmUndatedTaskGroupApplies(input: {
  principal: "web" | "mobile"
  requested: string | null
  status: string
}): boolean {
  if (input.principal !== "web" || input.requested !== "group") return false
  return !input.status || (MTM_TASK_OPEN_STATUSES as readonly string[]).includes(input.status)
}

export function mtmUndatedOpenTaskWhere(): Prisma.MtmTaskWhereInput {
  return { dueDate: null, status: { in: [...MTM_TASK_OPEN_STATUSES] } }
}
