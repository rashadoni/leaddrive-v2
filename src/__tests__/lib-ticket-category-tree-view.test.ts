import { describe, expect, it } from "vitest"
import { filterCategoryTree, flattenVisibleCategoryTree } from "@/lib/ticketing/category-tree-view"

type Node = { id: string; active: boolean; children?: Node[] }

const tree: Node[] = [{
  id: "root",
  active: false,
  children: [{
    id: "child",
    active: true,
    children: [{ id: "grandchild", active: true, children: [] }],
  }],
}]

describe("ticket category tree view", () => {
  it("keeps a non-matching ancestor as hierarchy context", () => {
    const filtered = filterCategoryTree(tree, (node) => node.active)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toMatchObject({ id: "root", contextOnly: true })
    expect(filtered[0].children[0]).toMatchObject({ id: "child", contextOnly: false })
  })

  it("hides descendants of a collapsed category in the unfiltered tree", () => {
    const filtered = filterCategoryTree(tree, () => true)
    const rows = flattenVisibleCategoryTree(filtered, new Set(["root"]), false)

    expect(rows.map((row) => row.id)).toEqual(["root"])
  })

  it("forces the complete matching path open while filtering", () => {
    const filtered = filterCategoryTree(tree, (node) => node.id === "grandchild")
    const rows = flattenVisibleCategoryTree(filtered, new Set(["root", "child"]), true)

    expect(rows.map((row) => [row.id, row.depth, row.contextOnly])).toEqual([
      ["root", 0, true],
      ["child", 1, true],
      ["grandchild", 2, false],
    ])
  })
})
