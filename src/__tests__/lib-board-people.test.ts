/**
 * A board task is given to the board's own people. Zeytun, 2026-11-13, an
 * employee on Pharmastore choosing her manager as the reporter: «digər
 * departamentlərdən adamların adlarını görməli deyiləm… bir sürü ad çıxır».
 */
import { describe, expect, it } from "vitest"
import { boardPeopleIds, withPeopleOnTask, type BoardPeopleClient } from "@/lib/tasks/board-people"

type Division = { id: string; organizationId: string; parentDivisionId: string | null; headUserId: string | null }
type Grant = { organizationId: string; userId: string; divisionId: string; canView: boolean }

// A stand-in that answers the two questions as the tables would — by the `where` it is given.
const client = (divisions: Division[], grants: Grant[]): BoardPeopleClient => ({
  division: {
    findFirst: async ({ where }) => {
      const found = divisions.find((d) => d.id === where.id && d.organizationId === where.organizationId)
      return found ? { id: found.id, parentDivisionId: found.parentDivisionId, headUserId: found.headUserId } : null
    },
  },
  boardPermission: {
    findMany: async ({ where }) => grants
      .filter((g) => g.organizationId === where.organizationId && where.divisionId.in.includes(g.divisionId))
      .map((g) => ({ userId: g.userId, divisionId: g.divisionId, canView: g.canView })),
  },
})

const ORG = "zeytun"
const DIVISIONS: Division[] = [
  { id: "digital", organizationId: ORG, parentDivisionId: null, headUserId: "sabina" },
  { id: "pharmastore", organizationId: ORG, parentDivisionId: "digital", headUserId: null },
  { id: "noreva", organizationId: ORG, parentDivisionId: "digital", headUserId: "gullu" },
  { id: "mx", organizationId: ORG, parentDivisionId: null, headUserId: null },
  { id: "empty", organizationId: ORG, parentDivisionId: null, headUserId: null },
  { id: "theirs", organizationId: "other", parentDivisionId: null, headUserId: "stranger" },
]
const GRANTS: Grant[] = [
  { organizationId: ORG, userId: "khayala", divisionId: "pharmastore", canView: true },
  { organizationId: ORG, userId: "aytan", divisionId: "digital", canView: true },
  { organizationId: ORG, userId: "rashida", divisionId: "digital", canView: true },
  { organizationId: ORG, userId: "rashida", divisionId: "pharmastore", canView: false },
  { organizationId: ORG, userId: "madina", divisionId: "mx", canView: true },
  { organizationId: ORG, userId: "ulviyya", divisionId: "mx", canView: true },
  { organizationId: "other", userId: "stranger", divisionId: "theirs", canView: true },
]
const people = async (board: string, org = ORG) => (await boardPeopleIds(client(DIVISIONS, GRANTS), org, board))?.sort() ?? null

describe("the people of a board", () => {
  it("are those let onto the board or onto its department, and the heads of both", async () => {
    // Khayala on the board itself, Aytan through the department, Sabina heads the department.
    expect(await people("pharmastore")).toEqual(["aytan", "khayala", "sabina"])
    // The board's own head joins them; nobody of the MX department is among them.
    expect(await people("noreva")).toEqual(["aytan", "gullu", "rashida", "sabina"])
    expect(await people("mx")).toEqual(["madina", "ulviyya"])
  })

  it("the board's own «no» beats the department's «yes»", async () => {
    expect(await people("pharmastore")).not.toContain("rashida")
    expect(await people("digital")).toContain("rashida")
  })

  it("a board nobody was put on, or one that does not exist, narrows nothing", async () => {
    expect(await people("empty")).toBeNull()
    expect(await people("no-such-board")).toBeNull()
  })

  it("another organization's board answers nothing about its people", async () => {
    expect(await people("theirs")).toBeNull()
    expect(await people("theirs", "other")).toEqual(["stranger"])
  })
})

describe("the people shown in a task's fields", () => {
  const board = [{ id: "khayala", name: "Khayala" }, { id: "sabina", name: "Sabina" }]

  it("keep whoever is already on the task, member of the board or not", () => {
    const shown = withPeopleOnTask(board, [{ id: "nazrin", name: "Nazrin" }, { id: "sabina", name: "Sabina" }, null, undefined, { id: "nazrin", name: "Nazrin" }])
    expect(shown.map((p) => p.name)).toEqual(["Khayala", "Nazrin", "Sabina"])
  })

  it("are the board's people as they came when nobody else is on the task", () => {
    expect(withPeopleOnTask(board, [{ id: "sabina", name: "Sabina" }, null])).toEqual(board)
  })
})
