import { describe, it, expect, vi } from "vitest"
import {
  validateDivisionHierarchy,
  resolveEffectiveBoardPermission,
  type HierarchyValidationClient,
  type BoardPermissionFlags,
} from "@/lib/tasks/board-hierarchy"

function flags(over: Partial<BoardPermissionFlags> = {}): BoardPermissionFlags {
  return {
    canView: true,
    canEdit: false,
    canMoveToTodo: false,
    canMoveToInProgress: false,
    canMoveToTesting: false,
    canMoveToReview: false,
    canMoveBack: false,
    canCreateTask: false,
    canComment: false,
    ...over,
  }
}

/**
 * Mock client for the hierarchy validator. `parent` is the row returned by the
 * parent lookup (null = parent not found); `childCount`/`taskCount` feed the
 * "only departments may have children" (B) and "container-only" (D) checks.
 */
function mockClient(opts: {
  parent?: { id: string; isDepartment: boolean } | null
  childCount?: number
  taskCount?: number
}) {
  const division = {
    findFirst: vi.fn().mockResolvedValue(opts.parent ?? null),
    count: vi.fn().mockResolvedValue(opts.childCount ?? 0),
  }
  const task = { count: vi.fn().mockResolvedValue(opts.taskCount ?? 0) }
  return { client: { division, task } as unknown as HierarchyValidationClient, division, task }
}

const ORG = "org1"

describe("validateDivisionHierarchy", () => {
  it("(A) rejects a department that has a parent", async () => {
    const { client } = mockClient({})
    const res = await validateDivisionHierarchy(client, {
      divisionId: "d1",
      organizationId: ORG,
      isDepartment: true,
      parentDivisionId: "dept",
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("under another board") })
  })

  it("(C) rejects a parent that does not resolve in this org", async () => {
    const { client } = mockClient({ parent: null })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "s1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: "ghost",
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("not found") })
  })

  it("(C) rejects a parent that is not a department", async () => {
    const { client } = mockClient({ parent: { id: "p", isDepartment: false } })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "s1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: "p",
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("under a department") })
  })

  it("(C) rejects self-parenting", async () => {
    const { client, division } = mockClient({ parent: { id: "s1", isDepartment: true } })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "s1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: "s1",
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("its own parent") })
    // short-circuits before hitting the DB parent lookup
    expect(division.findFirst).not.toHaveBeenCalled()
  })

  it("(B) rejects a non-department that still has children (depth cap)", async () => {
    const { client } = mockClient({ parent: { id: "dept", isDepartment: true }, childCount: 2 })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "s1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: "dept",
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("sections under it") })
  })

  it("(D) rejects a department that still holds tasks (container-only)", async () => {
    const { client } = mockClient({ taskCount: 3 })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "d1",
      organizationId: ORG,
      isDepartment: true,
      parentDivisionId: null,
    })
    expect(res).toEqual({ ok: false, error: expect.stringContaining("cannot hold tasks") })
  })

  it("accepts a valid section under a department", async () => {
    const { client } = mockClient({ parent: { id: "dept", isDepartment: true }, childCount: 0 })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "s1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: "dept",
    })
    expect(res).toEqual({ ok: true })
  })

  it("accepts creating an empty department (no id → no task/children checks)", async () => {
    const { client, division, task } = mockClient({})
    const res = await validateDivisionHierarchy(client, {
      divisionId: null,
      organizationId: ORG,
      isDepartment: true,
      parentDivisionId: null,
    })
    expect(res).toEqual({ ok: true })
    expect(division.count).not.toHaveBeenCalled()
    expect(task.count).not.toHaveBeenCalled()
  })

  it("accepts a plain standalone board (not a department, no parent)", async () => {
    const { client } = mockClient({ childCount: 0 })
    const res = await validateDivisionHierarchy(client, {
      divisionId: "b1",
      organizationId: ORG,
      isDepartment: false,
      parentDivisionId: null,
    })
    expect(res).toEqual({ ok: true })
  })
})

describe("resolveEffectiveBoardPermission", () => {
  it("a section's own row wins outright (overrides the department grant)", () => {
    const section = flags({ canView: true, canEdit: true })
    const dept = flags({ canView: true, canCreateTask: true })
    expect(resolveEffectiveBoardPermission(section, dept)).toBe(section)
  })

  it("a section canView=false deny wins over a department grant", () => {
    const denySection = flags({ canView: false })
    const dept = flags({ canView: true, canEdit: true })
    const eff = resolveEffectiveBoardPermission(denySection, dept)
    expect(eff).toBe(denySection)
    expect(eff?.canView).toBe(false)
  })

  it("inherits the department row when the section has no row of its own", () => {
    const dept = flags({ canView: true, canEdit: true, canMoveToInProgress: true })
    expect(resolveEffectiveBoardPermission(null, dept)).toBe(dept)
  })

  it("returns null when neither section nor department has a row", () => {
    expect(resolveEffectiveBoardPermission(null, null)).toBeNull()
  })

  it("a department canView=false deny is inherited by a section with no row of its own", () => {
    const denyDept = flags({ canView: false })
    const eff = resolveEffectiveBoardPermission(null, denyDept)
    expect(eff).toBe(denyDept)
    expect(eff?.canView).toBe(false) // section without its own row inherits the dept deny
  })
})
