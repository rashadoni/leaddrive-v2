import { describe, expect, it } from "vitest"
import { BOARD_VIEWS, DEFAULT_BOARD_VIEW } from "@/lib/tasks/board-view"

describe("board view", () => {
  it("opens every board as the table, like a Bordio project, with Kanban and the tools as tabs", () => {
    expect(DEFAULT_BOARD_VIEW).toBe("list")
    expect(BOARD_VIEWS).toEqual(["board", "list", "calendar", "notes", "members", "reports"])
  })
})
