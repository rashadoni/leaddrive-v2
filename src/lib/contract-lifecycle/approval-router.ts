/**
 * Approval-chain router — Slice 3e-1 (parallel levels).
 *
 * Pure decision engine: given the current chain of ContractApprovalStage
 * rows and a decision (approve / reject) on a specific stage, compute
 * the new stage states and whether the chain as a whole has been
 * approved/rejected.
 *
 * ─── Parallel-level model ─────────────────────────────────────────────────
 *
 * A "level" = all stages sharing the same `order` value. Each level has
 * one of three resolution modes (parallelMode on every stage in the level):
 *
 *   all    — ALL stages must be approved for the level to pass.
 *             ANY reject makes the level — and chain — rejected.
 *             (A single-stage "all" level == old sequential behavior.)
 *
 *   any    — FIRST approval passes the level; remaining pending stages
 *             are marked "skipped". ALL stages must reject to reject the level.
 *
 *   quorum — Level passes when approvedCount >= quorumThreshold (K).
 *             Level rejects when rejectedCount > levelSize - K
 *             (quorum is now mathematically impossible).
 *             Remaining pending stages after quorum reached → skipped.
 *
 * The chain advances level-by-level (lowest order with pending stages =
 * current level). Chain APPROVED when the last level passes. Chain REJECTED
 * when any level rejects (all later pending stages → skipped).
 *
 * ─── Backward-compatibility guarantee ────────────────────────────────────
 *
 * A chain where every level has exactly one stage + parallelMode "all"
 * (or parallelMode absent / null — defaults to "all") produces EXACTLY
 * the same updates and flags as the pre-Slice-3e-1 sequential router.
 * Proven by the "backward_compat" test suite in
 * src/__tests__/lib-approval-router-parallel.test.ts.
 *
 * ─── Return shape (for 3e-2 route wiring) ────────────────────────────────
 *
 *   RouteApprovalResult (ok: true):
 *     updates:          ApprovalStageUpdate[] — apply ALL, not just acted stage.
 *                       Each entry has stageId (when input provided it) + order.
 *                       3e-2 should use stageId for updateMany by PK; order is
 *                       retained for current callers that use it as the WHERE key.
 *     chainApproved:    boolean — advance Contract.status → "approved".
 *     chainRejected:    boolean — advance Contract.status → "rejected".
 *     nextPendingOrder: number|null — write to Contract.currentApprovalStage.
 *     levelComplete:    boolean — whether the current level resolved this turn.
 *
 * Pure synchronous. NO Prisma / IO. Caller runs updates in one transaction.
 *
 * ─── Invariants assumed about the input chain ─────────────────────────────
 *   • `stages` is non-empty.
 *   • `order` values form contiguous 1..maxOrder with no gaps; multiple
 *     stages MAY share the same order (that is one level).
 *   • All stages with order < currentLevelOrder MUST be terminal
 *     (approved / skipped / rejected / superseded).
 *   • All stages in a level share the same parallelMode + quorumThreshold.
 *   • The acted-on stage MUST be in the CURRENT level (lowest order with
 *     any pending stage) AND must be "pending".
 */
import {
  STAGE_DECISIONS,
  type ApprovalStageState,
  type ApprovalStageUpdate,
  type ParallelMode,
  type RouteApprovalInput,
  type RouteApprovalResult,
} from "./types"

// ── Internal helpers ─────────────────────────────────────────────────────

/** Resolve effective parallelMode — absent/null defaults to "all". */
function resolveMode(mode: ParallelMode | null | undefined): ParallelMode {
  if (mode === "any" || mode === "quorum") return mode
  return "all"
}

/**
 * Validate the chain for structural integrity.
 *
 * With parallel levels the invariant changes: orders are contiguous 1..maxOrder
 * (no gaps in the set of distinct order values), but the SAME order may appear
 * multiple times (parallel level). Terminal stages must form a "closed prefix":
 * once we encounter the first level that has ANY pending stage, every higher-
 * order stage must also be pending (or effectively pending — no terminal stage
 * may sit above a still-pending level).
 */
function validateChain(
  stages: readonly ApprovalStageState[]
): { ok: true; sorted: readonly ApprovalStageState[] } | { ok: false; error: string } {
  if (stages.length === 0) {
    return { ok: false, error: "approval chain must have at least one stage" }
  }

  const sorted = [...stages].sort((a, b) => a.order - b.order)

  // Collect distinct order values and verify they are contiguous 1..maxOrder.
  const distinctOrders = [...new Set(sorted.map((s) => s.order))].sort((a, b) => a - b)
  for (let i = 0; i < distinctOrders.length; i++) {
    if (distinctOrders[i] !== i + 1) {
      return {
        ok: false,
        error: `approval chain orders must be contiguous 1..N (distinct); got [${distinctOrders.join(", ")}]`,
      }
    }
  }

  // Gap-in-advance check (level granularity): no terminal LEVEL may sit above
  // a level that has any pending stage.
  // A level is "has-pending" if at least one stage in it is pending.
  // A level is "fully-terminal" if every stage in it is terminal.
  let sawPendingLevel = false
  for (const order of distinctOrders) {
    const levelStages = sorted.filter((s) => s.order === order)
    const hasPending = levelStages.some((s) => s.status === "pending")
    const fullyTerminal = levelStages.every(
      (s) => s.status !== "pending"
    )

    if (hasPending) {
      sawPendingLevel = true
    } else if (sawPendingLevel && fullyTerminal) {
      return {
        ok: false,
        error: `chain has fully-terminal level at order ${order} after a pending level — gap in advance`,
      }
    }
  }

  return { ok: true, sorted }
}

// ── Level evaluation ─────────────────────────────────────────────────────

type LevelOutcome = "approved" | "rejected" | "undecided"

/**
 * Evaluate a level (all stages at the same order) after the acted-on
 * stage's decision has been tentatively applied (as `tentativeStatus`
 * for the target stage, actual `status` for all others).
 *
 * Returns the level outcome (approved / rejected / undecided).
 */
function evaluateLevel(
  levelStages: readonly ApprovalStageState[],
  actedStageId: string | null | undefined,
  actedOrder: number,
  tentativeStatus: "approved" | "rejected"
): LevelOutcome {
  // Build effective statuses: replace acted stage's status with the tentative.
  const statuses = levelStages.map((s) => {
    const isActed = actedStageId != null
      ? s.stageId === actedStageId
      : s.order === actedOrder && s.stageId == null
    // If stageId not available, fall back to first-match on order (single-stage levels).
    return isActed ? tentativeStatus : s.status
  })

  const size = statuses.length
  const approvedCount = statuses.filter((s) => s === "approved").length
  const rejectedCount = statuses.filter((s) => s === "rejected").length
  const pendingCount = statuses.filter((s) => s === "pending").length

  const mode = resolveMode(levelStages[0]?.parallelMode)

  if (mode === "all") {
    if (rejectedCount > 0) return "rejected"
    if (pendingCount > 0) return "undecided"
    return "approved"
  }

  if (mode === "any") {
    if (approvedCount > 0) return "approved"
    if (pendingCount > 0) return "undecided"
    // All decided, no approvals → all rejected.
    return "rejected"
  }

  // quorum
  const k = levelStages[0]?.quorumThreshold ?? 1
  if (approvedCount >= k) return "approved"
  // Quorum now impossible when rejectedCount > (size - k).
  if (rejectedCount > size - k) return "rejected"
  return "undecided"
}

// ── Main export ──────────────────────────────────────────────────────────

export function routeApproval(input: RouteApprovalInput): RouteApprovalResult {
  if (!(STAGE_DECISIONS as readonly string[]).includes(input.decision)) {
    return { ok: false, error: `decision "${String(input.decision)}" is not "approve" or "reject"` }
  }
  if (typeof input.decidedBy !== "string" || input.decidedBy.length === 0) {
    return { ok: false, error: "decidedBy is required (the acting user's id)" }
  }
  if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) {
    return { ok: false, error: "at must be a valid Date" }
  }

  const chainCheck = validateChain(input.stages)
  if (!chainCheck.ok) return { ok: false, error: chainCheck.error }
  const sorted = chainCheck.sorted

  // ── Locate the acted-on stage ─────────────────────────────────────────
  // Prefer stageId lookup (parallel levels may have multiple stages at same order).
  // Fall back to order-only for backward-compat ONLY when stageId was not provided.
  // If stageId IS provided but not found → return an error immediately (no silent fallback).
  let target: ApprovalStageState | undefined
  if (input.stageId != null) {
    target = sorted.find((s) => s.stageId === input.stageId)
    // stageId provided but not found → hard error, no fallback.
    if (target === undefined) {
      return { ok: false, error: `stage with id "${input.stageId}" not found in chain` }
    }
  } else {
    // Legacy path: find by order. For parallel levels, locate the FIRST pending
    // stage at the given order that could be the target (validation below will
    // confirm it's in the current level).
    target = sorted.find((s) => s.order === input.stageOrder)
  }

  if (!target) {
    return { ok: false, error: `stage with order ${input.stageOrder} not found in chain` }
  }
  if (target.status !== "pending") {
    return {
      ok: false,
      error: `stage (order=${target.order}${target.stageId ? `, id=${target.stageId}` : ""}) is "${target.status}" — only "pending" stages can be acted on`,
    }
  }

  // ── Current level = lowest order with any pending stage ───────────────
  const lowestPendingOrder = sorted.find((s) => s.status === "pending")?.order
  if (lowestPendingOrder === undefined) {
    return { ok: false, error: "chain has no pending stage — cannot act" }
  }
  if (target.order !== lowestPendingOrder) {
    return {
      ok: false,
      error: `stage (order=${target.order}) is not in the current-pending level (expected order ${lowestPendingOrder})`,
    }
  }

  const currentOrder = lowestPendingOrder
  const levelStages = sorted.filter((s) => s.order === currentOrder)

  // Identify acted stage within the level. For single-stage levels the stageId
  // may be absent — the evaluateLevel helper handles this gracefully.
  const actedStageId = target.stageId ?? null
  const tentativeStatus: "approved" | "rejected" =
    input.decision === "approve" ? "approved" : "rejected"

  // ── Build updates array ───────────────────────────────────────────────
  const updates: ApprovalStageUpdate[] = []

  const acted: ApprovalStageUpdate = {
    stageId: actedStageId,
    order: target.order,
    status: tentativeStatus,
    decidedBy: input.decidedBy,
    decidedAt: input.at,
  }
  updates.push(acted)

  // Evaluate the level outcome with the tentative decision applied.
  const outcome = evaluateLevel(levelStages, actedStageId, currentOrder, tentativeStatus)

  if (outcome === "undecided") {
    // Level still in progress — no chain advance.
    return {
      ok: true,
      updates,
      chainApproved: false,
      chainRejected: false,
      nextPendingOrder: currentOrder,
      levelComplete: false,
    }
  }

  if (outcome === "rejected") {
    // Level rejected → chain rejected. Mark ALL later pending stages as skipped.
    for (const s of sorted) {
      if (s.order > currentOrder && s.status === "pending") {
        updates.push({
          stageId: s.stageId ?? null,
          order: s.order,
          status: "skipped",
          decidedBy: input.decidedBy,
          decidedAt: input.at,
        })
      }
    }
    return {
      ok: true,
      updates,
      chainApproved: false,
      chainRejected: true,
      nextPendingOrder: null,
      levelComplete: true,
    }
  }

  // outcome === "approved": level passed.
  // For "any" and "quorum" modes, skip remaining pending stages in this level.
  for (const s of levelStages) {
    const isActed = actedStageId != null ? s.stageId === actedStageId : s.order === currentOrder && s === target
    if (!isActed && s.status === "pending") {
      updates.push({
        stageId: s.stageId ?? null,
        order: s.order,
        status: "skipped",
        decidedBy: input.decidedBy,
        decidedAt: input.at,
      })
    }
  }

  // Advance to next level.
  const nextStageInChain = sorted.find((s) => s.order > currentOrder && s.status === "pending")

  if (!nextStageInChain) {
    // No more levels — chain fully approved.
    return {
      ok: true,
      updates,
      chainApproved: true,
      chainRejected: false,
      nextPendingOrder: null,
      levelComplete: true,
    }
  }

  return {
    ok: true,
    updates,
    chainApproved: false,
    chainRejected: false,
    nextPendingOrder: nextStageInChain.order,
    levelComplete: true,
  }
}
