/**
 * The order of a board's list (src/lib/tasks/board-list-order.ts): open tasks
 * keep their place on the board, finished ones come newest-closed first, and a
 * column picked in the header orders by that column with ties in that order.
 */
import { describe, expect, it } from "vitest"
import { boardListOrder } from "@/lib/tasks/board-list-order"

const t = (id: string, status: string, more: Record<string, unknown> = {}) => ({ id, title: id, status, ...more })
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe("boardListOrder", () => {
  it("keeps open tasks as given and puts finished ones newest-closed first, cancelled by their last change", () => {
    const rows = [
      t("open-a", "todo"),
      t("old", "done", { completedAt: "2026-11-01T10:00:00Z" }),
      t("today", "completed", { completedAt: "2026-11-16T10:00:00Z" }),
      t("open-b", "in_progress"),
      t("cancelled", "cancelled", { updatedAt: "2026-11-10T10:00:00Z" }),
      t("never-stamped", "done"),
    ]
    expect(ids(boardListOrder(rows))).toEqual(["open-a", "open-b", "today", "cancelled", "old", "never-stamped"])
    // The input is not reordered in place.
    expect(ids(rows)[0]).toBe("open-a")
  })

  it("two closed at the same moment keep the board's order", () => {
    const at = "2026-11-16T10:00:00Z"
    expect(ids(boardListOrder([t("first", "done", { completedAt: at }), t("second", "done", { completedAt: at })]))).toEqual(["first", "second"])
  })

  it("sorts by name the way a person reads numbers, both ways", () => {
    const rows = [t("10 Nizami", "todo"), t("2 Yasamal", "todo"), t("İnşaatçılar", "todo")]
    expect(ids(boardListOrder(rows, "name", { locale: "az" }))).toEqual(["2 Yasamal", "10 Nizami", "İnşaatçılar"])
    expect(ids(boardListOrder(rows, "name_desc", { locale: "az" }))).toEqual(["İnşaatçılar", "10 Nizami", "2 Yasamal"])
  })

  it("sorts by priority with Bordio's critical above urgent, and by due date with the undated last either way", () => {
    const rows = [
      t("low", "todo", { priority: "low", dueDate: "2026-11-20" }),
      t("critical", "todo", { priority: "critical" }),
      t("urgent", "todo", { priority: "urgent", dueDate: "2026-11-18" }),
    ]
    expect(ids(boardListOrder(rows, "priority"))).toEqual(["critical", "urgent", "low"])
    expect(ids(boardListOrder(rows, "priority_desc"))).toEqual(["low", "urgent", "critical"])
    expect(ids(boardListOrder(rows, "date_asc"))).toEqual(["urgent", "low", "critical"])
    expect(ids(boardListOrder(rows, "date_desc"))).toEqual(["low", "urgent", "critical"])
  })

  it("sorts by status in the board's own column order, then the usual stages", () => {
    const rows = [t("done", "done"), t("review", "review"), t("todo", "todo"), t("odd", "archived")]
    expect(ids(boardListOrder(rows, "status", { statusOrder: ["review", "todo", "done"] }))).toEqual(["review", "todo", "done", "odd"])
    expect(ids(boardListOrder(rows, "status"))).toEqual(["todo", "review", "done", "odd"])
  })
})
