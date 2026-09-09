/**
 * Division (board) hierarchy — the two-level Department → Section model.
 *
 *   Department  isDepartment=true,  parentDivisionId=null,  holds NO tasks,
 *               may have child sections.
 *   Section     isDepartment=false, parentDivisionId=<dept> (or null = a plain
 *               standalone board), holds tasks, has NO children.
 *
 * The whole model is encoded by two invariants, enforced here (route layer) and
 * mirrored by the divisions_parent_coherence_trigger (same-org parent) at the DB:
 *   (A) a department may not have a parent          → departments can't nest
 *   (B) only a department may have children         → caps depth at exactly 2
 *       (B subsumes "a section can't have children": a nested board is a section
 *        = non-department, so (B) forbids it children → max depth 2)
 *   (C) a parent must exist, be same-org, be a department, and not be self
 *   (D) a department holds no tasks (container-only)
 *
 * This file also carries the PERMISSION-INHERITANCE helpers (Phase 2) so all
 * "division tree" logic lives in one place.
 */

import type { BoardPermissionFlags } from "./board-permission"

// ── Hierarchy validation (route layer) ──────────────────────────────────────

/** Minimal injectable client so the validator is unit-testable (cf. board-access.ts). */
export interface HierarchyValidationClient {
  division: {
    findFirst(args: {
      where: { id: string; organizationId: string }
      select: { id: true; isDepartment: true }
    }): Promise<{ id: string; isDepartment: boolean } | null>
    count(args: { where: { organizationId: string; parentDivisionId: string } }): Promise<number>
  }
  task: {
    count(args: { where: { organizationId: string; divisionId: string; deletedAt: null } }): Promise<number>
  }
}

/** The division's state AFTER the create/patch is applied. */
export interface DivisionHierarchyState {
  /** The row's id, or null when validating a CREATE (no id yet → no tasks/children). */
  divisionId: string | null
  organizationId: string
  isDepartment: boolean
  parentDivisionId: string | null
}

export type HierarchyValidationResult = { ok: true } | { ok: false; error: string }

/**
 * True when a thrown DB error is one of the hierarchy CHECK / coherence-trigger
 * rejections (migration 20260624000000). validateDivisionHierarchy catches the
 * common sequential case with a clean 400; this lets a route map the rare
 * concurrent-race rejection that slips through to the DB to a 400 too (not a 500).
 */
export function isHierarchyConstraintViolation(err: unknown): boolean {
  const e = err as { message?: string; code?: string; meta?: { code?: string } }
  // Postgres check_violation = SQLSTATE 23514 (the CHECK + every hierarchy trigger
  // raise it). Match the code first so this survives any RAISE-text edit; keep the
  // message fragments as a fallback for Prisma error shapes that don't surface it.
  if (e?.meta?.code === "23514") return true
  const msg = e?.message ?? ""
  return (
    msg.includes("23514") ||
    msg.includes("divisions_department_no_parent_chk") ||
    msg.includes("must be a department") ||
    msg.includes("a department cannot hold tasks") ||
    msg.includes("only a department may have child") ||
    msg.includes("cannot place a task on a department")
  )
}

/**
 * Validate a division's resulting hierarchy state. Returns the first violated
 * invariant as a 400-able message, or `{ ok: true }`. Pass a Prisma client or a
 * transaction client as `client`.
 */
export async function validateDivisionHierarchy(
  client: HierarchyValidationClient,
  state: DivisionHierarchyState,
): Promise<HierarchyValidationResult> {
  const { divisionId, organizationId, isDepartment, parentDivisionId } = state

  // (A) a department may not have a parent.
  if (isDepartment && parentDivisionId) {
    return { ok: false, error: "A department cannot be placed under another board" }
  }

  // (C) parent must be a real, same-org department and not self.
  if (parentDivisionId) {
    if (divisionId && parentDivisionId === divisionId) {
      return { ok: false, error: "A board cannot be its own parent" }
    }
    const parent = await client.division.findFirst({
      where: { id: parentDivisionId, organizationId },
      select: { id: true, isDepartment: true },
    })
    if (!parent) {
      return { ok: false, error: "Parent department not found in this organization" }
    }
    if (!parent.isDepartment) {
      return { ok: false, error: "A board can only be placed under a department" }
    }
  }

  // The remaining checks need the row to already exist (CREATE has no tasks/children yet).
  if (divisionId) {
    // (B) only a department may have children → also caps depth at 2.
    if (!isDepartment) {
      const childCount = await client.division.count({
        where: { organizationId, parentDivisionId: divisionId },
      })
      if (childCount > 0) {
        return {
          ok: false,
          error: "This board has sections under it — only a department can; detach them first",
        }
      }
    }
    // (D) a department holds no tasks (container-only).
    if (isDepartment) {
      const taskCount = await client.task.count({
        where: { organizationId, divisionId, deletedAt: null },
      })
      if (taskCount > 0) {
        return {
          ok: false,
          error: "A department cannot hold tasks — move its tasks into a section first",
        }
      }
    }
  }

  return { ok: true }
}

// ── Permission inheritance ──────────────────────────────────────────────────

/**
 * The EFFECTIVE BoardPermission row for a (user, section): a section's own
 * explicit row wins outright — including a `canView=false` deny — otherwise the
 * parent department's row is inherited, otherwise null (no explicit grant; the
 * pure functions then fall back to role / own-division as today).
 *
 * Pairs with an effective head signal the caller computes separately
 * (`headsSection || headsParentDepartment`) so a department head gets head powers
 * — incl. the role-gated move-to-`done` — across every section. The pure
 * resolvers in board-permission.ts are unchanged: they just receive the
 * effective `perm` + `isDivisionHead` instead of the section-only ones.
 */
export function resolveEffectiveBoardPermission(
  sectionRow: BoardPermissionFlags | null,
  departmentRow: BoardPermissionFlags | null,
): BoardPermissionFlags | null {
  return sectionRow ?? departmentRow
}

// ── Department aggregation (Phase 3) ────────────────────────────────────────

export interface DepartmentSectionsClient {
  division: {
    findMany(args: {
      where: { organizationId: string; parentDivisionId: string; isActive: boolean }
      select: { id: true }
    }): Promise<Array<{ id: string }>>
  }
}

/**
 * The ACTIVE child section ids of a department — the set the department's combined
 * board + Reports aggregate over. Callers intersect this with the user's accessible
 * set (so a section-scoped user only aggregates their own sections) and with an
 * optional `?sections=` UI filter.
 */
export async function getDepartmentSectionIds(
  client: DepartmentSectionsClient,
  organizationId: string,
  departmentId: string,
): Promise<string[]> {
  const rows = await client.division.findMany({
    where: { organizationId, parentDivisionId: departmentId, isActive: true },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

// Re-export the flags type so callers import the hierarchy + perm shape from one place.
export type { BoardPermissionFlags }
