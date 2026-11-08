import { describe, expect, it } from "vitest"
import { boardIdFromPath, boardNavTree, boardTabRows, type TabDivision } from "@/lib/tasks/board-tabs"

const BOARDS: TabDivision[] = [
  { id: "dig", name: "Digital Marketing", isDepartment: true, sortOrder: 1 },
  { id: "trad", name: "Traditional Marketing", isDepartment: true, sortOrder: 2 },
  { id: "dig-ph", name: "Pharmastore", parentDivisionId: "dig", sortOrder: 2, _count: { tasks: 732 } },
  { id: "dig-zey", name: "Zeytun", parentDivisionId: "dig", sortOrder: 1, _count: { tasks: 380 } },
  { id: "trad-zey", name: "Zeytun", parentDivisionId: "trad", sortOrder: 1, _count: { tasks: 37 } },
  { id: "general", name: "Ümumi Marketinq", sortOrder: 0 },
]

describe("boardTabRows", () => {
  it("lists the folders and stand-alone boards on the first row, the open folder's projects on the second", () => {
    const rows = boardTabRows(BOARDS, "dig-ph")
    expect(rows.places.map((tab) => [tab.name, tab.active, tab.isDepartment])).toEqual([
      ["Ümumi Marketinq", false, false], ["Digital Marketing", true, true], ["Traditional Marketing", false, true],
    ])
    expect(rows.projects).toEqual({
      departmentId: "dig",
      allActive: false,
      items: [
        { id: "dig-zey", name: "Zeytun", count: 380, active: false },
        { id: "dig-ph", name: "Pharmastore", count: 732, active: true },
      ],
    })
  })

  it("marks «all» on the department itself, and keeps same-named projects of different folders apart", () => {
    const rows = boardTabRows(BOARDS, "trad")
    expect(rows.projects?.allActive).toBe(true)
    expect(rows.projects?.items.map((tab) => tab.id)).toEqual(["trad-zey"])
  })

  it("has no second row on a stand-alone board", () => {
    const rows = boardTabRows(BOARDS, "general")
    expect(rows.projects).toBeNull()
    expect(rows.places.find((tab) => tab.active)?.id).toBe("general")
  })

  it("shows a section as a place of its own when its folder is not open to the caller", () => {
    const visible = BOARDS.filter((board) => board.id !== "dig" && board.id !== "dig-zey")
    const rows = boardTabRows(visible, "dig-ph")
    expect(rows.places.map((tab) => tab.id)).toContain("dig-ph")
    expect(rows.projects).toBeNull()
  })
})

describe("boardNavTree — the sidebar's folders and boards", () => {
  it("puts stand-alone boards and folders in order, each folder with its own boards and counts", () => {
    expect(boardNavTree(BOARDS).map((node) => [node.name, node.isDepartment, node.children.map((child) => [child.id, child.count])])).toEqual([
      ["Ümumi Marketinq", false, []],
      ["Digital Marketing", true, [["dig-zey", 380], ["dig-ph", 732]]],
      ["Traditional Marketing", true, [["trad-zey", 37]]],
    ])
  })

  it("stands a board alone when its folder is not the person's to open", () => {
    const tree = boardNavTree(BOARDS.filter((division) => division.id !== "dig"))
    expect(tree.map((node) => node.id)).toEqual(["general", "dig-zey", "dig-ph", "trad"])
    expect(tree.find((node) => node.id === "dig-zey")).toMatchObject({ isDepartment: false, children: [] })
  })

  it("reads the open board from the address", () => {
    expect([boardIdFromPath("/boards/dig-ph"), boardIdFromPath("/boards/dig-ph/settings"), boardIdFromPath("/boards"), boardIdFromPath("/tasks/1")])
      .toEqual(["dig-ph", "dig-ph", null, null])
  })
})
