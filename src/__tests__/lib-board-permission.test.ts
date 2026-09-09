import { describe, it, expect } from "vitest"
import {
  canViewBoard,
  canEditTasks,
  canCreateTask,
  canComment,
  canMoveToStatus,
  canMoveToDone,
  isAdminRole,
  STATUS_RANK,
  type BoardAccessInput,
  type BoardPermissionFlags,
} from "@/lib/tasks/board-permission"
import { isManagerOrAbove } from "@/lib/constants"

const flags = (o: Partial<BoardPermissionFlags> = {}): BoardPermissionFlags => ({
  canView: false,
  canEdit: false,
  canMoveToTodo: false,
  canMoveToInProgress: false,
  canMoveToTesting: false,
  canMoveToReview: false,
  canMoveBack: false,
  canCreateTask: false,
  canComment: false,
  ...o,
})

const base = (o: Partial<BoardAccessInput> = {}): BoardAccessInput => ({
  role: "sales",
  perm: null,
  isOwnDivision: false,
  isDivisionHead: false,
  ...o,
})

describe("board-permission", () => {
  it("admin/superadmin bypass everything (incl. done)", () => {
    for (const role of ["admin", "superadmin"] as const) {
      const i = base({ role })
      expect(canViewBoard(i)).toBe(true)
      expect(canEditTasks(i)).toBe(true)
      expect(canCreateTask(i)).toBe(true)
      expect(canComment(i)).toBe(true)
      expect(canMoveToStatus(i, "done", "review")).toBe(true)
      expect(canMoveToStatus(i, "testing", "in_progress")).toBe(true)
    }
    expect(isAdminRole("admin")).toBe(true)
    expect(isAdminRole("sales")).toBe(false)
  })

  it("explicit canView=false DENIES even on the user's own division", () => {
    const i = base({ isOwnDivision: true, perm: flags({ canView: false, canEdit: true }) })
    expect(canViewBoard(i)).toBe(false) // deny beats own-division
    expect(canCreateTask(i)).toBe(false)
    expect(canComment(i)).toBe(false)
  })

  it("own division (no perm row) → view + create + comment, but NOT edit", () => {
    const i = base({ isOwnDivision: true })
    expect(canViewBoard(i)).toBe(true)
    expect(canCreateTask(i)).toBe(true)
    expect(canComment(i)).toBe(true)
    expect(canEditTasks(i)).toBe(false)
  })

  it("no perm + not own division → no access", () => {
    const i = base()
    expect(canViewBoard(i)).toBe(false)
    expect(canCreateTask(i)).toBe(false)
    expect(canComment(i)).toBe(false)
    expect(canEditTasks(i)).toBe(false)
  })

  it("explicit grant (canView=true) on a non-own division → view", () => {
    const i = base({ perm: flags({ canView: true }) })
    expect(canViewBoard(i)).toBe(true)
  })

  it("per-action flags gate forward moves, including the testing column", () => {
    const i = base({ perm: flags({ canView: true, canMoveToTesting: true }) })
    expect(canMoveToStatus(i, "testing", "in_progress")).toBe(true) // flag on
    expect(canMoveToStatus(i, "review", "testing")).toBe(false) // flag off
    expect(canMoveToStatus(i, "in_progress", "todo")).toBe(false) // flag off
  })

  it("backward moves require canMoveBack", () => {
    const noBack = base({ perm: flags({ canView: true, canMoveToTodo: true }) })
    expect(canMoveToStatus(noBack, "todo", "review")).toBe(false) // review→todo is backward
    const withBack = base({ perm: flags({ canView: true, canMoveBack: true }) })
    expect(canMoveToStatus(withBack, "todo", "review")).toBe(true)
    expect(canMoveToStatus(withBack, "backlog", "in_progress")).toBe(true)
  })

  it("done is role-gated (admin/manager/head), NOT flag-gated", () => {
    const salesAllFlags = base({
      role: "sales",
      perm: flags({ canView: true, canMoveToReview: true, canMoveBack: true }),
    })
    expect(canMoveToStatus(salesAllFlags, "done", "review")).toBe(false) // flags can't grant done
    expect(canMoveToStatus(base({ role: "manager" }), "done", "review")).toBe(true)
    expect(canMoveToStatus(base({ role: "sales", isDivisionHead: true }), "done", "review")).toBe(true)
    expect(canMoveToDone(base({ role: "manager" }))).toBe(true)
    expect(canMoveToDone(base({ role: "sales" }))).toBe(false)
  })

  it("STATUS_RANK orders the 6 columns and maps legacy statuses", () => {
    expect(STATUS_RANK.backlog).toBeLessThan(STATUS_RANK.todo)
    expect(STATUS_RANK.todo).toBeLessThan(STATUS_RANK.in_progress)
    expect(STATUS_RANK.in_progress).toBeLessThan(STATUS_RANK.testing)
    expect(STATUS_RANK.testing).toBeLessThan(STATUS_RANK.review)
    expect(STATUS_RANK.review).toBeLessThan(STATUS_RANK.done)
    expect(STATUS_RANK.pending).toBe(STATUS_RANK.todo) // legacy → todo rank
    expect(STATUS_RANK.completed).toBe(STATUS_RANK.done) // legacy → done rank
  })

  it("SECURITY: isAdminRole and isManagerOrAbove disagree on 'manager' (board isolation depends on it)", () => {
    // applyRecordFilter uses isManagerOrAbove (manager → unrestricted, no where.OR)
    // while getAccessibleDivisionIds uses isAdminRole (manager → NOT "all"). That
    // divergence makes the board-scope AND the SOLE board gate for managers —
    // nothing clobbers it. If a refactor ever aligns these helpers, managers
    // silently regain cross-department board read access. Lock the invariant.
    expect(isAdminRole("manager")).toBe(false)
    expect(isManagerOrAbove("manager")).toBe(true)
  })
})

describe("explicit canView=false is a HARD deny (section overrides dept grant)", () => {
  // Regression for the Codex P1: a section deny row that still carried edit/move
  // flags (e.g. a former member later denied) must not retain edit/move powers,
  // and a department head denied on a section must not be able to move to done.
  const deniedButPrivileged = flags({
    canView: false, canEdit: true, canCreateTask: true, canComment: true,
    canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true,
    canMoveToReview: true, canMoveBack: true,
  })

  it("blocks view/edit/create/comment despite leftover action flags", () => {
    const i = base({ role: "sales", perm: deniedButPrivileged })
    expect(canViewBoard(i)).toBe(false)
    expect(canEditTasks(i)).toBe(false)
    expect(canCreateTask(i)).toBe(false)
    expect(canComment(i)).toBe(false)
  })

  it("blocks every move, including done via inherited department headship", () => {
    const i = base({ role: "sales", perm: deniedButPrivileged, isDivisionHead: true })
    expect(canMoveToStatus(i, "in_progress", "todo")).toBe(false)
    expect(canMoveToStatus(i, "todo", "backlog")).toBe(false)
    expect(canMoveToStatus(i, "backlog", "todo")).toBe(false) // backward
    expect(canMoveToStatus(i, "done", "review")).toBe(false)
    expect(canMoveToDone(i)).toBe(false)
  })

  it("a manager denied on a section cannot move to done there", () => {
    const i = base({ role: "manager", perm: flags({ canView: false }) })
    expect(canMoveToDone(i)).toBe(false)
    expect(canMoveToStatus(i, "done", "review")).toBe(false)
  })

  it("admin still bypasses an explicit deny", () => {
    const i = base({ role: "admin", perm: deniedButPrivileged })
    expect(canViewBoard(i)).toBe(true)
    expect(canEditTasks(i)).toBe(true)
    expect(canMoveToStatus(i, "done", "review")).toBe(true)
  })
})
