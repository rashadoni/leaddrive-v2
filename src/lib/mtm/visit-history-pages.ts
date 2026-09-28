/**
 * «Визиты» read the period page by page.
 *
 * Audit 2026-09-24 on prod: with «Вся история» the screen stopped at the
 * latest 200 visits — it said «последние 200 из N» and offered no way to the
 * rest — and its summary put the period's total next to counts taken over
 * the 200 shown, so «Всего 1234 · Завершено 190» read as one set.
 */

export const VISIT_PAGE_SIZE = 200

/**
 * How many visits of the period are still unread. Pages are full up to the
 * last one, so with an exact total it is the total less the pages read.
 * Without one (a supervisor's bounded read), a full last page is the only
 * sign of more, and the read stops at its candidate limit.
 */
export function visitsRemainingInPeriod(input: {
  total: number | null
  totalExact: boolean
  candidateLimit: number | null
  pagesRead: number
  lastPageFull: boolean
  pageSize?: number
}): number {
  const pageSize = input.pageSize ?? VISIT_PAGE_SIZE
  const read = input.pagesRead * pageSize
  if (input.totalExact && input.total != null) return Math.max(0, input.total - read)
  if (!input.lastPageFull) return 0
  return read < (input.candidateLimit ?? Number.POSITIVE_INFINITY) ? pageSize : 0
}

/**
 * The live refresh re-reads only the first page. Visits that «Показать ещё»
 * brought below it stay — a list that shrinks back to 200 every 30 seconds
 * under the reader's scroll is worse than no button. A visit is kept only if
 * it is not newer than the first page's last one: anything newer that the
 * first page no longer holds was deleted.
 */
export function mergeFirstPageRefresh<T extends { id: string; checkInAt: string | Date }>(
  current: readonly T[],
  firstPage: readonly T[],
  pageSize = VISIT_PAGE_SIZE,
): T[] {
  const oldest = firstPage.at(-1)
  if (firstPage.length < pageSize || !oldest) return [...firstPage]
  const listed = new Set(firstPage.map((visit) => visit.id))
  const oldestAt = new Date(oldest.checkInAt).getTime()
  const older = current.filter((visit) => !listed.has(visit.id) && new Date(visit.checkInAt).getTime() <= oldestAt)
  return [...firstPage, ...older]
}
