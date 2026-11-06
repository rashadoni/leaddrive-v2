import { describe, expect, it } from "vitest"
import { DEFAULT_BOARD_VIEW, readBoardView, rememberBoardView } from "@/lib/tasks/board-view"

function memoryStorage() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map }
}

describe("board view", () => {
  it("opens a board as the table, like a Bordio project", () => {
    expect(DEFAULT_BOARD_VIEW).toBe("list")
    expect(readBoardView("div-1", memoryStorage())).toBe("list")
    expect(readBoardView("div-1", null)).toBe("list")
  })

  it("keeps the view a person picked, per board", () => {
    const storage = memoryStorage()
    rememberBoardView("div-1", "board", storage)
    expect(readBoardView("div-1", storage)).toBe("board")
    expect(readBoardView("div-2", storage)).toBe("list")
  })

  it("falls back to the table on garbage or a storage that throws", () => {
    const storage = memoryStorage()
    storage.map.set("ld.board-view.div-1", "kanban-v0")
    expect(readBoardView("div-1", storage)).toBe("list")

    const blocked = { getItem: () => { throw new Error("SecurityError") }, setItem: () => { throw new Error("QuotaExceeded") } }
    expect(readBoardView("div-1", blocked)).toBe("list")
    expect(() => rememberBoardView("div-1", "board", blocked)).not.toThrow()
  })
})
