import { describe, it, expect, vi } from "vitest"
import { getAccessibleDivisionIds, type BoardAccessClient } from "@/lib/tasks/board-access"

function mockClient(
  perms: Array<{ divisionId: string; canView: boolean }>,
  headed: Array<{ id: string }>,
) {
  const boardPermission = { findMany: vi.fn().mockResolvedValue(perms) }
  const division = { findMany: vi.fn().mockResolvedValue(headed) }
  return {
    client: { boardPermission, division } as unknown as BoardAccessClient,
    boardPermission,
    division,
  }
}

describe("getAccessibleDivisionIds", () => {
  it("returns \"all\" for admin/superadmin without querying", async () => {
    const { client, boardPermission, division } = mockClient([], [])
    expect(await getAccessibleDivisionIds(client, "org1", "u1", "admin")).toBe("all")
    expect(await getAccessibleDivisionIds(client, "org1", "u1", "superadmin")).toBe("all")
    expect(boardPermission.findMany).not.toHaveBeenCalled()
    expect(division.findMany).not.toHaveBeenCalled()
  })

  it("unions canView grants with headed divisions (deduped)", async () => {
    const { client } = mockClient(
      [
        { divisionId: "A", canView: true },
        { divisionId: "B", canView: true },
      ],
      [{ id: "B" }, { id: "D" }], // B overlaps a grant, D is head-only
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "sales")) as string[]
    expect(new Set(res)).toEqual(new Set(["A", "B", "D"]))
  })

  it("excludes divisions explicitly denied (canView=false), even if headed", async () => {
    const { client } = mockClient(
      [
        { divisionId: "A", canView: true },
        { divisionId: "E", canView: false }, // explicit deny
      ],
      [{ id: "E" }], // user heads E but is denied → excluded
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "support")) as string[]
    expect(res).toEqual(["A"])
  })

  it("returns [] when the user has no grants and heads nothing", async () => {
    const { client } = mockClient([], [])
    expect(await getAccessibleDivisionIds(client, "org1", "u1", "viewer")).toEqual([])
  })
})

// Tree-aware mock: the headship query returns `headed`; the cascade query
// (where.parentDivisionId.in) returns the children of those parents.
function mockTreeClient(
  perms: Array<{ divisionId: string; canView: boolean }>,
  headed: Array<{ id: string }>,
  childrenByParent: Record<string, string[]>,
) {
  const boardPermission = { findMany: vi.fn().mockResolvedValue(perms) }
  const division = {
    findMany: vi.fn().mockImplementation(async (args: { where?: { parentDivisionId?: { in: string[] } } }) => {
      const parents = args?.where?.parentDivisionId?.in
      if (parents) return parents.flatMap((p) => (childrenByParent[p] ?? []).map((id) => ({ id })))
      return headed // headship query
    }),
  }
  return { client: { boardPermission, division } as unknown as BoardAccessClient, boardPermission, division }
}

describe("getAccessibleDivisionIds — department cascade", () => {
  it("a department grant cascades to all its child sections", async () => {
    const { client } = mockTreeClient(
      [{ divisionId: "DEPT", canView: true }],
      [],
      { DEPT: ["S1", "S2"] },
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "sales")) as string[]
    expect(new Set(res)).toEqual(new Set(["DEPT", "S1", "S2"]))
  })

  it("a section canView=false deny overrides the inherited department grant", async () => {
    const { client } = mockTreeClient(
      [
        { divisionId: "DEPT", canView: true },
        { divisionId: "S2", canView: false }, // explicit section deny
      ],
      [],
      { DEPT: ["S1", "S2"] },
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "sales")) as string[]
    expect(new Set(res)).toEqual(new Set(["DEPT", "S1"])) // S2 excluded
  })

  it("heading a department cascades head access to all its sections", async () => {
    const { client } = mockTreeClient([], [{ id: "DEPT" }], { DEPT: ["S1", "S2"] })
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "support")) as string[]
    expect(new Set(res)).toEqual(new Set(["DEPT", "S1", "S2"]))
  })

  it("a department deny + a direct child grant → only that child (no dept, no cascade)", async () => {
    const { client } = mockTreeClient(
      [
        { divisionId: "DEPT", canView: false }, // dept denied → not in ids, no cascade
        { divisionId: "S1", canView: true }, // but this child granted directly
      ],
      [],
      { DEPT: ["S1", "S2"] },
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "sales")) as string[]
    expect(res).toEqual(["S1"]) // DEPT excluded, S2 never cascaded
  })

  it("a section-only grant sees just that section — no siblings, no department", async () => {
    // user granted S1 directly; S1 is a leaf (no children) so cascade adds nothing.
    const { client } = mockTreeClient(
      [{ divisionId: "S1", canView: true }],
      [],
      { DEPT: ["S1", "S2"] }, // S1's sibling S2 must NOT leak in
    )
    const res = (await getAccessibleDivisionIds(client, "org1", "u1", "viewer")) as string[]
    expect(res).toEqual(["S1"])
  })
})
