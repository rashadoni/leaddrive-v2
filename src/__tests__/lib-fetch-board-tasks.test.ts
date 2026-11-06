import { describe, expect, it } from "vitest"
import { BOARD_TASKS_PAGE, fetchAllBoardTasks } from "@/lib/tasks/fetch-board-tasks"

// A board of `total` tasks behind the real paging contract of GET /api/v1/tasks
// (limit ≤ 200, offset, data.total). The board used to read one page only.
function boardOf(total: number) {
  const asked: string[] = []
  const tasks = Array.from({ length: total }, (_, i) => ({ id: `t${i}`, status: i < 1700 ? "done" : "todo" }))
  const fetchImpl = async (input: string) => {
    asked.push(input)
    const url = new URL(input, "http://crm.test")
    const limit = Number(url.searchParams.get("limit"))
    const offset = Number(url.searchParams.get("offset"))
    expect(limit).toBeLessThanOrEqual(200)
    return new Response(JSON.stringify({ success: true, data: { tasks: tasks.slice(offset, offset + limit), total, limit } }))
  }
  return { asked, fetchImpl }
}

describe("fetchAllBoardTasks", () => {
  it("brings every task of a board far past one page — the open ones at the end included", async () => {
    const { asked, fetchImpl } = boardOf(1772)
    const tasks = await fetchAllBoardTasks<{ id: string; status: string }>("div 1", fetchImpl)

    expect(tasks).toHaveLength(1772)
    expect(tasks.filter((task) => task.status === "todo")).toHaveLength(72)
    expect(asked).toHaveLength(Math.ceil(1772 / BOARD_TASKS_PAGE))
    expect(asked[0]).toBe("/api/v1/tasks?divisionId=div%201&limit=200&offset=0")
  })

  it("asks once for a small board and once for an empty one", async () => {
    const small = boardOf(37)
    const empty = boardOf(0)
    expect(await fetchAllBoardTasks("b", small.fetchImpl)).toHaveLength(37)
    expect(await fetchAllBoardTasks("b", empty.fetchImpl)).toEqual([])
    expect([small.asked.length, empty.asked.length]).toEqual([1, 1])
  })

  it("keeps one copy of a task two pages both returned, and fails loudly on a refused page", async () => {
    let call = 0
    const overlapping = async () => {
      call += 1
      const tasks = call === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }, { id: "c" }]
      return new Response(JSON.stringify({ data: { tasks, total: 201 } }))
    }
    expect((await fetchAllBoardTasks("b", overlapping)).map((task) => task.id)).toEqual(["a", "b", "c"])

    const refused = async () => new Response("{}", { status: 403 })
    await expect(fetchAllBoardTasks("b", refused)).rejects.toThrow("Failed to load tasks (403)")
  })
})
