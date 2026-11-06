/**
 * Every task of one board, for the board page.
 *
 * GET /api/v1/tasks answers at most 200 rows. The board asked for one page and
 * showed whatever came back, so a board past 200 tasks silently lost the rest —
 * open cards included, since the order is by lane position, not by state. It
 * became real when Zeytun's marketing board was brought over from Bordio with
 * 1772 tasks (2026-11-06). The first page says how many there are; the rest are
 * asked for at once. The list orders by id last, so pages never overlap or skip.
 */
export const BOARD_TASKS_PAGE = 200

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchAllBoardTasks<T extends { id: string }>(
  divisionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<T[]> {
  const page = async (offset: number): Promise<{ tasks: T[]; total: number }> => {
    const query = `divisionId=${encodeURIComponent(divisionId)}&limit=${BOARD_TASKS_PAGE}&offset=${offset}`
    const res = await fetchImpl(`/api/v1/tasks?${query}`, { credentials: "include" })
    if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`)
    const body = await res.json()
    const tasks: T[] = body?.data?.tasks ?? []
    return { tasks, total: Number(body?.data?.total ?? tasks.length) }
  }

  const first = await page(0)
  const offsets: number[] = []
  for (let offset = BOARD_TASKS_PAGE; offset < first.total; offset += BOARD_TASKS_PAGE) offsets.push(offset)
  const rest = await Promise.all(offsets.map(page))

  const seen = new Set<string>()
  const all: T[] = []
  for (const chunk of [first, ...rest]) {
    for (const task of chunk.tasks) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      all.push(task)
    }
  }
  return all
}
