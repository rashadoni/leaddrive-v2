/**
 * Every task of one board, for the board page.
 *
 * GET /api/v1/tasks answers at most 200 rows. The board asked for one page and
 * showed whatever came back, so a board past 200 tasks silently lost the rest —
 * open cards included, since the order is by lane position, not by state. It
 * became real when Zeytun's marketing board was brought over from Bordio with
 * 1772 tasks (2026-11-06). The first page says how many there are; the rest are
 * asked for at once. The list orders by id last, so pages never overlap or skip.
 *
 * A board's page is 1000, not the list's usual 200 (2026-11-09): each further
 * page was asked only after the first had answered, so a board past 200 tasks —
 * six of Zeytun's, up to 732 — drew its table one whole round trip later. GET
 * /api/v1/tasks takes up to this many only when the request names a board.
 */
export const BOARD_TASKS_PAGE = 1000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchAllBoardTasks<T extends { id: string }>(
  divisionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<T[]> {
  return fetchAllTasks<T>(`divisionId=${encodeURIComponent(divisionId)}`, fetchImpl)
}

/**
 * Every task of a folder's boards (`divisionIds=a,b,…`) — the folder opens as
 * its list, and a list that stops at 200 rows hides the rest (owner,
 * 2026-11-11: «по умолчанию чтоб были показаны не как канбан а как список»).
 */
export async function fetchAllFolderTasks<T extends { id: string }>(
  sectionIds: readonly string[],
  fetchImpl: FetchLike = fetch,
): Promise<T[]> {
  if (!sectionIds.length) return []
  return fetchAllTasks<T>(`divisionIds=${encodeURIComponent(sectionIds.join(","))}`, fetchImpl)
}

async function fetchAllTasks<T extends { id: string }>(scope: string, fetchImpl: FetchLike): Promise<T[]> {
  const page = async (offset: number): Promise<{ tasks: T[]; total: number }> => {
    const query = `${scope}&limit=${BOARD_TASKS_PAGE}&offset=${offset}`
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
