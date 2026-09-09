import { describe, it, expect } from "vitest"
import {
  resolveLaneKey,
  foldToVisibleStage,
  buildCanonicalColumns,
  canonicalRank,
  resolveBoardDrop,
  CANONICAL_STAGES,
} from "@/lib/tasks/board-columns"

// A board that shows 4 of the 6 stages (testing + review hidden) — exactly the
// live HHH board shape. Phase 1 columns are canonical: key == mapsToStatus.
const HHH = ["backlog", "todo", "in_progress", "done"].map((k) => ({ key: k, mapsToStatus: k }))
const ALL = CANONICAL_STAGES.map((k) => ({ key: k, mapsToStatus: k }))

describe("board-columns — render-identity with the legacy fold", () => {
  it("existing task (NULL boardColumnKey) folds by status, hidden stage → nearest earlier visible", () => {
    // status in a hidden column (testing) folds to the nearest earlier visible (in_progress)
    expect(resolveLaneKey({ status: "testing", boardColumnKey: null }, HHH)).toBe("in_progress")
    // review hidden → folds earlier to in_progress too
    expect(resolveLaneKey({ status: "review", boardColumnKey: null }, HHH)).toBe("in_progress")
    // visible stages map to themselves
    expect(resolveLaneKey({ status: "backlog", boardColumnKey: null }, HHH)).toBe("backlog")
    expect(resolveLaneKey({ status: "done", boardColumnKey: null }, HHH)).toBe("done")
  })

  it("legacy statuses fold like the board's STATUS_TO_COLUMN (pending→todo, completed/cancelled→done)", () => {
    expect(resolveLaneKey({ status: "pending", boardColumnKey: null }, HHH)).toBe("todo")
    expect(resolveLaneKey({ status: "completed", boardColumnKey: null }, HHH)).toBe("done")
    expect(resolveLaneKey({ status: "cancelled", boardColumnKey: null }, HHH)).toBe("done")
  })

  it("explicit boardColumnKey wins WHEN it is a visible column", () => {
    expect(resolveLaneKey({ status: "in_progress", boardColumnKey: "todo" }, HHH)).toBe("todo")
  })

  it("explicit boardColumnKey is IGNORED when it points to a hidden/unknown column → folds by status", () => {
    // testing is hidden on HHH; a stale key folds by status instead of vanishing
    expect(resolveLaneKey({ status: "in_progress", boardColumnKey: "testing" }, HHH)).toBe("in_progress")
    expect(resolveLaneKey({ status: "done", boardColumnKey: "nonsense" }, HHH)).toBe("done")
  })

  it("all six visible → every status lands in its own lane", () => {
    for (const s of CANONICAL_STAGES) {
      expect(resolveLaneKey({ status: s, boardColumnKey: null }, ALL)).toBe(s)
    }
  })

  it("empty board → null (caller falls back to legacy render)", () => {
    expect(resolveLaneKey({ status: "todo", boardColumnKey: null }, [])).toBeNull()
  })
})

describe("foldToVisibleStage — earlier-preferred nearest visible", () => {
  it("prefers nearest earlier, then nearest later", () => {
    const visible = new Set(["backlog", "done"]) // todo/in_progress/testing/review hidden
    expect(foldToVisibleStage("in_progress", visible)).toBe("backlog") // earlier wins
    expect(foldToVisibleStage("backlog", visible)).toBe("backlog")
    // when nothing earlier is visible, take nearest later
    expect(foldToVisibleStage("todo", new Set(["review"]))).toBe("review")
  })
})

describe("buildCanonicalColumns — seed/sync shape", () => {
  it("empty keys ⇒ all six in canonical order, sortOrder 0..5, mapsToStatus==key", () => {
    const cols = buildCanonicalColumns("org1", "div1", [])
    expect(cols.map((c) => c.key)).toEqual([...CANONICAL_STAGES])
    expect(cols.map((c) => c.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])
    expect(cols.every((c) => c.mapsToStatus === c.key)).toBe(true)
    expect(cols.every((c) => c.organizationId === "org1" && c.divisionId === "div1")).toBe(true)
  })

  it("subset is emitted in CANONICAL order regardless of input order; non-canonical dropped", () => {
    const cols = buildCanonicalColumns("o", "d", ["done", "garbage", "backlog", "in_progress"])
    expect(cols.map((c) => c.key)).toEqual(["backlog", "in_progress", "done"])
    expect(cols.map((c) => c.sortOrder)).toEqual([0, 1, 2])
  })
})

describe("canonicalRank", () => {
  it("ranks canonical stages 0..5, unknown last", () => {
    expect(canonicalRank("backlog")).toBe(0)
    expect(canonicalRank("done")).toBe(5)
    expect(canonicalRank("whatever")).toBe(CANONICAL_STAGES.length)
  })
})

describe("resolveBoardDrop (Kanban drag-drop target resolution)", () => {
  const keys = ["backlog", "todo", "in_progress", "done"]
  it("returns the target column key when dropped on a different valid column", () => {
    expect(resolveBoardDrop({ overId: "in_progress", validColumnKeys: keys, currentColumnKey: "todo" })).toBe("in_progress")
  })
  it("no-op (null) when dropped back onto the card's own column", () => {
    expect(resolveBoardDrop({ overId: "todo", validColumnKeys: keys, currentColumnKey: "todo" })).toBeNull()
  })
  it("no-op when dropped outside any column (overId null)", () => {
    expect(resolveBoardDrop({ overId: null, validColumnKeys: keys, currentColumnKey: "todo" })).toBeNull()
  })
  it("no-op when dropped over an unknown id (not a board column)", () => {
    expect(resolveBoardDrop({ overId: "ghost", validColumnKeys: keys, currentColumnKey: "todo" })).toBeNull()
  })
  it("moves a column-less task (unknown current) into the target column", () => {
    expect(resolveBoardDrop({ overId: "done", validColumnKeys: keys, currentColumnKey: undefined })).toBe("done")
  })
})
